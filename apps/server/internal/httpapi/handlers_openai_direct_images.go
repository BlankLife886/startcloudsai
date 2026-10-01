package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const (
	openAIImageBillingSource      = store.DeveloperAPIImageLedgerSource
	directImagePersistenceTimeout = 10 * time.Second
	// A request can never legitimately stay pending this long; the reclaim job
	// releases reservations left by a process that stopped mid-request.
	developerAPIPendingTimeout = time.Hour
)

// newOpenAIImageBillingID names one /v1 image request in the wallet ledger.
// Every request is independent: the gateway never retries, so there is no
// client-supplied key to derive it from.
func newOpenAIImageBillingID() string {
	return "openai-image:" + uuid.NewString()
}

func detachedOpenAIImagePersistenceContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), directImagePersistenceTimeout)
}

// openAIImage is the stateless developer image gateway. It deliberately does
// not create a site task: the upstream request is the only generation
// execution, and the local database stores only wallet/API usage accounting.
// A request is charged when the upstream delivers an image and released when
// the upstream or the platform fails; the gateway never retries, because not
// every upstream can retry safely. A caller that disconnects while waiting is
// still charged once the image is produced: the upstream work was done.
func (s *Server) openAIImage(c *gin.Context, editing bool) {
	c.Header("Cache-Control", "no-store")
	user, err := s.requireUser(c)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	key := openAPIKeyFromContext(c)
	if key == nil {
		failOpenAI(c, apperr.E("api_key_required", "缺少 API Key：请在请求头加上 Authorization: Bearer <API_KEY>", http.StatusUnauthorized), "")
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}

	originalRequest := c.Request
	// Only the gateway's own wait limit stops the upstream call, not the caller leaving.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(originalRequest.Context()), openAIImageWaitTimeout)
	c.Request = originalRequest.WithContext(ctx)
	defer func() {
		c.Request = originalRequest
		cancel()
	}()
	defer func() {
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
	}()

	var request openAIImageRequest
	var files []*multipart.FileHeader
	if editing {
		request, files, err = decodeOpenAIImageMultipart(c.Request)
	} else {
		request, err = decodeOpenAIImageJSON(c.Request)
	}
	if err != nil {
		failOpenAIImage(c, err)
		return
	}

	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	entries, err := s.developerCatalog(ctx)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	resolved, err := resolveDeveloperModel(c, entries, cfg, key, "image", request.Model)
	if err != nil {
		failOpenAI(c, err, "model")
		return
	}
	selection := &resolved.Selection
	if strings.TrimSpace(selection.Provider.BaseURL) == "" || strings.TrimSpace(selection.Provider.APIKey) == "" {
		failOpenAI(c, apperr.E("provider_misconfigured", "所选图片模型的上游服务尚未配置好，暂不可调用，请联系平台", http.StatusBadGateway), "model")
		return
	}
	params, err := openAIImageParams(request, selection.Model, len(files))
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	images := make([]c2a.StreamImage, 0, len(files))
	for _, file := range files {
		image, inspectErr := s.inspectOpenAIReferenceImage(c, user, file)
		if inspectErr != nil {
			failOpenAIImage(c, inspectErr)
			return
		}
		images = append(images, image)
	}

	// Subscription price locks stopped applying to /v1 when the catalog took
	// over pricing; they are honoured until the announced cut-off.
	quoteUsers := []uuid.UUID{}
	if lockActive, lockErr := apicatalog.ContractLockActive(ctx, s.St.Pool, time.Now()); lockErr != nil {
		failOpenAI(c, lockErr, "")
		return
	} else if lockActive && resolved.Entry.PriceMode == store.DeveloperAPIPriceFollow {
		quoteUsers = append(quoteUsers, user.ID)
	}
	// The catalog price is the public price (it holds announced increases
	// back); a still-honoured subscription lock is resolved against it.
	basePrice := apicatalog.UnitPrice(cfg, *resolved, time.Now())
	quote, err := taskflow.QuoteSelectedImage(ctx, s.St.Pool, cfg, modelconfig.WorkspaceT2I, *selection, taskflow.CreateInput{
		Type: "t2i", Prompt: request.Prompt, Params: params, Count: request.N,
		InputKeys: make([]string, len(images)),
	}, basePrice, quoteUsers...)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	upstreamCost := modelconfig.ResolveUpstreamCost(selection.Model, 0, 0)
	if basePrice == 0 && !selection.Model.AllowZeroPrice {
		failOpenAI(c, apperr.E("model_zero_price_blocked", "所选图片模型尚未设置价格，暂不可调用，请联系平台", http.StatusServiceUnavailable), "model")
		return
	}
	if basePrice < upstreamCost && !selection.Model.AllowLossLeader {
		failOpenAI(c, apperr.E("model_price_inverted", "所选图片模型的价格配置异常，暂不可调用，请联系平台", http.StatusServiceUnavailable), "model")
		return
	}

	release, err := s.acquireDeveloperModelSlot(ctx, resolved.Entry)
	if err != nil {
		failOpenAI(c, err, "model")
		return
	}
	defer release()

	feature := developerFeature("image")
	billingCtx := wallet.WithSubscriptionScope(ctx, "api", resolved.Entry.ID)
	billingCtx = store.WithBillingDecision(billingCtx, quote.Billing)
	billing, err := s.reserveDeveloperAPIRequest(billingCtx, developerAPIReservation{
		SourceType: openAIImageBillingSource, BillingID: newOpenAIImageBillingID(),
		UserID: user.ID, KeyID: key.ID, ModelID: selection.Model.ID, Feature: feature, PriceCents: quote.TotalPriceCents,
		APIModelID: resolved.Entry.ID, APIModelName: resolved.Entry.APIName,
	})
	if err != nil {
		failOpenAI(c, err, "")
		return
	}

	// openAIImageParams drops output_format for models without a format selector.
	outputFormat, _ := params["outputFormat"].(string)
	options := c2a.ImageOptions{
		Quality:               request.Quality,
		TransparentBackground: request.Background == "transparent",
		Background:            request.Background,
		OutputFormat:          outputFormat,
		ModerationLevel:       request.Moderation,
		ResponseFormat:        request.ResponseFormat,
		User:                  request.User,
	}
	client := c2a.NewWithPolicy(selection.Provider.BaseURL, selection.Provider.APIKey, selection.Provider.TimeoutSecs, s.Cfg.C2APrivateNetworkAllowed()).WithStandardImages()
	var upstream c2a.StandardImageResponse
	if editing {
		upstream, err = client.EditImagesStandardStream(ctx, request.Prompt, selection.Model.UpstreamModel, request.N, images, openAIRequestSize(request), options)
	} else {
		upstream, err = client.GenerateImagesStandard(ctx, request.Prompt, selection.Model.UpstreamModel, request.N, openAIRequestSize(request), options)
	}
	var result *openAIImageResponse
	if err == nil {
		result, err = directOpenAIImageResponse(upstream, request.ResponseFormat)
	}
	record := directImageProfit{UserID: user.ID, APIKeyID: key.ID, Selection: selection, Request: request, Editing: editing, UpstreamCost: upstreamCost}
	if err != nil {
		err = developerUpstreamError(err)
		s.releaseDeveloperAPIRequest(billingCtx, billing, user.ID)
		s.recordOpenAIImageProfitLogged(billingCtx, record, billing, "failed", openAIErrorCode(err))
		failOpenAI(c, err, "")
		return
	}
	// c.Request carries the detached context; the caller's own connection
	// state is on the original request.
	if originalRequest.Context().Err() != nil {
		record.Note = "client_disconnected"
	}
	if err := s.settleDeveloperAPIRequest(billingCtx, billing, user.ID); err != nil {
		// The image exists but the charge could not be written. Hand the image
		// over anyway; the reclaim job releases the reservation later, so the
		// caller is never charged for a request we could not account for.
		log.Printf("developer API image settlement failed billing_id=%s: %v", billing.BillingID, err)
		s.recordOpenAIImageProfitLogged(billingCtx, record, billing, "failed", "billing_settlement_failed")
	} else {
		s.recordOpenAIImageProfitLogged(billingCtx, record, billing, "succeeded", "")
	}
	c.JSON(http.StatusOK, result)
}

// acquireDeveloperModelSlot holds one of the API model's /v1 concurrency
// slots when the admin set a limit; 0 (the default) means unlimited. The
// lease outlives the longest request so a crashed process cannot keep a slot.
func (s *Server) acquireDeveloperModelSlot(ctx context.Context, entry *store.DeveloperAPIModel) (func(), error) {
	limit := int64(entry.MaxConcurrency)
	if limit <= 0 || s.ConcurrencyLimiter == nil {
		return func() {}, nil
	}
	allowed, err := s.ConcurrencyLimiter.Acquire(ctx, "developer-api-model", entry.ID, limit, openAIImageWaitTimeout+time.Minute)
	if err != nil {
		return nil, apperr.E("security_limit_unavailable", "请求限流服务暂时不可用，请稍后重试", http.StatusServiceUnavailable)
	}
	if !allowed {
		return nil, apperr.E("model_concurrency_limited", fmt.Sprintf("模型 %q 同时进行的请求已达上限（%d 个），请稍后再发", entry.APIName, limit), http.StatusTooManyRequests)
	}
	return func() {
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), directImagePersistenceTimeout)
		defer cancel()
		_ = s.ConcurrencyLimiter.Release(releaseCtx, "developer-api-model", entry.ID)
	}, nil
}

type developerAPIReservation struct {
	SourceType, BillingID, ModelID string
	// APIModelID is the catalog entry: it is what the Key allowlist, the
	// subscription api scope and the call history refer to.
	APIModelID, APIModelName string
	UserID, KeyID            uuid.UUID
	Feature                  trialfeature.Feature
	PriceCents               int64
}

type developerAPIBilling struct {
	SourceType   string
	BillingID    string
	PriceCents   int64
	Reserved     bool
	UsageEventID *uuid.UUID
}

type directImageProfit struct {
	UserID, APIKeyID uuid.UUID
	Selection        *modelconfig.Selection
	Request          openAIImageRequest
	Editing          bool
	UpstreamCost     int64
	Note             string // client_disconnected when the caller left before the image arrived
}

// reserveDeveloperAPIRequest counts the request against the Key's quota,
// freezes its credits and records it as pending. The pending row lets the
// reclaim job release the reservation if the process stops mid-request.
func (s *Server) reserveDeveloperAPIRequest(ctx context.Context, open developerAPIReservation) (*developerAPIBilling, error) {
	billing := &developerAPIBilling{SourceType: open.SourceType, BillingID: open.BillingID, PriceCents: open.PriceCents}
	now := time.Now().UTC()
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := trialfeature.Authorize(ctx, tx, open.UserID, open.Feature); err != nil {
			return err
		}
		eventID, err := store.RecordAPIKeyRequest(ctx, tx, open.KeyID, open.UserID, open.APIModelID, open.PriceCents, now)
		if err != nil {
			return mapOpenAIAPIKeyUsageError(err)
		}
		if eventID != uuid.Nil {
			billing.UsageEventID = &eventID
		}
		if open.PriceCents > 0 {
			if _, err := wallet.FreezeFeatureCredits(ctx, tx, open.UserID, open.PriceCents, open.Feature.Key, open.SourceType, open.BillingID, nil); err != nil {
				return err
			}
			billing.Reserved = true
		}
		return store.InsertDeveloperAPIRequest(ctx, tx, store.DeveloperAPIRequest{
			BillingID: open.BillingID, SourceType: open.SourceType, UserID: &open.UserID, APIKeyID: &open.KeyID,
			UsageEventID: billing.UsageEventID, PriceCents: open.PriceCents, APIModelID: open.APIModelID, APIModelName: open.APIModelName,
			Status:    store.DeveloperAPIRequestPending,
			ExpiresAt: now.Add(developerAPIPendingTimeout),
		})
	})
	if err != nil {
		return nil, err
	}
	return billing, nil
}

// releaseDeveloperAPIRequest returns a failed request's credits and Key quota.
// Upstream or platform failures and timeouts are released. A caller leaving is
// not a failure by itself: an image or non-streamed answer that is produced is
// still charged, and a stream is released only if it delivered no content
// (see openAIChatCompletions). If the release cannot be written,
// the pending row stays and the reclaim job releases it after it expires.
func (s *Server) releaseDeveloperAPIRequest(parent context.Context, billing *developerAPIBilling, userID uuid.UUID) {
	ctx, cancel := detachedOpenAIImagePersistenceContext(parent)
	defer cancel()
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		if billing.Reserved {
			if _, err := wallet.ReleaseFeatureCredits(ctx, tx, userID, billing.PriceCents, billing.SourceType, billing.BillingID, nil); err != nil {
				return err
			}
		}
		if billing.UsageEventID != nil {
			if err := store.DeleteAPIKeyUsageEvent(ctx, tx, *billing.UsageEventID); err != nil {
				return err
			}
		}
		return store.MarkDeveloperAPIRequest(ctx, tx, billing.BillingID, store.DeveloperAPIRequestFailed)
	})
	if err != nil {
		log.Printf("developer API release deferred to reclaim billing_id=%s: %v", billing.BillingID, err)
	}
}

func (s *Server) settleDeveloperAPIRequest(parent context.Context, billing *developerAPIBilling, userID uuid.UUID) error {
	ctx, cancel := detachedOpenAIImagePersistenceContext(parent)
	defer cancel()
	return s.St.Tx(ctx, func(tx pgx.Tx) error {
		if billing.Reserved {
			if _, err := wallet.SettleFeatureCredits(ctx, tx, userID, billing.PriceCents, billing.SourceType, billing.BillingID, nil); err != nil {
				return err
			}
		}
		return store.MarkDeveloperAPIRequest(ctx, tx, billing.BillingID, store.DeveloperAPIRequestSucceeded)
	})
}

func (s *Server) recordOpenAIImageProfitLogged(parent context.Context, record directImageProfit, billing *developerAPIBilling, status, errorCode string) {
	ctx, cancel := detachedOpenAIImagePersistenceContext(parent)
	defer cancel()
	if err := s.recordOpenAIImageProfit(ctx, record, billing, status, errorCode); err != nil {
		log.Printf("developer API image profit record failed billing_id=%s status=%s: %v", billing.BillingID, status, err)
	}
}

func (s *Server) recordOpenAIImageProfit(ctx context.Context, record directImageProfit, billing *developerAPIBilling, status, errorCode string) error {
	operation := "generation"
	if record.Editing {
		operation = "edit"
	}
	revenue := billing.PriceCents
	cost := record.UpstreamCost * int64(record.Request.N)
	if status != "succeeded" {
		revenue = 0
		cost = 0
	}
	metadata := map[string]any{
		"source":         "developer_api",
		"transport":      "direct",
		"operation":      operation,
		"requestedUnits": record.Request.N,
		"responseFormat": record.Request.ResponseFormat,
	}
	if errorCode != "" {
		metadata["errorCode"] = errorCode
	}
	if record.Note != "" {
		metadata["note"] = record.Note
	}
	return store.UpsertUsageProfitEntry(ctx, s.St.Pool, store.UsageProfitEntry{
		SourceType: store.DeveloperAPIProfitSourceType, SourceID: billing.BillingID, UserID: record.UserID, APIKeyID: &record.APIKeyID,
		EventStatus: status, Workspace: modelconfig.WorkspaceT2I, ProviderID: record.Selection.Provider.ID,
		RouteID: record.Selection.Provider.RouteID, ModelID: record.Selection.Model.ID, Units: record.Request.N,
		RevenueCents: revenue, UpstreamCostCents: cost, Metadata: metadata, CreatedAt: time.Now().UTC(),
	})
}

func openAIRequestSize(request openAIImageRequest) string {
	if request.Size == "auto" {
		return ""
	}
	return request.Size
}

func directOpenAIImageResponse(upstream c2a.StandardImageResponse, requestedFormat string) (*openAIImageResponse, error) {
	result := &openAIImageResponse{Created: upstream.Created, Data: make([]openAIImageData, 0, len(upstream.Data))}
	for _, item := range upstream.Data {
		switch requestedFormat {
		case "url":
			if item.URL == "" {
				return nil, apperr.E("image_result_unavailable", "上游没有返回图片链接（url），本次不扣费", http.StatusBadGateway)
			}
			result.Data = append(result.Data, openAIImageData{URL: item.URL})
		default:
			if item.B64JSON == "" {
				return nil, apperr.E("image_result_unavailable", "上游没有返回图片数据（b64_json），本次不扣费", http.StatusBadGateway)
			}
			result.Data = append(result.Data, openAIImageData{B64JSON: item.B64JSON})
		}
	}
	if len(result.Data) == 0 {
		return nil, apperr.E("image_result_unavailable", "上游没有返回任何图片，本次不扣费", http.StatusBadGateway)
	}
	return result, nil
}

func mapOpenAIAPIKeyUsageError(err error) error {
	switch {
	case errors.Is(err, store.ErrAPIKeyInactive):
		return apperr.E("api_key_invalid", "API Key 已被撤销或冻结", http.StatusUnauthorized)
	case errors.Is(err, store.ErrAPIKeyDailyLimit):
		return apperr.E("api_key_daily_limit", "这把 API Key 今日的请求数或积分预算已用完，按 UTC 日重置（北京时间 08:00）", http.StatusTooManyRequests)
	case errors.Is(err, store.ErrAPIKeyMonthlyLimit):
		return apperr.E("api_key_monthly_limit", "这把 API Key 本月的请求数或积分预算已用完，按 UTC 自然月重置", http.StatusTooManyRequests)
	case errors.Is(err, store.ErrAPIKeyModelDenied):
		return apperr.E("api_key_model_denied", "这把 API Key 不允许调用所选模型，可在控制台调整它的可用模型", http.StatusForbidden)
	default:
		return err
	}
}

// inspectOpenAIReferenceImage reads a reference image once from the
// multipart spool file to hash it against the security blocklist and detect
// its format, then returns it as a stream for the upstream request. The file
// is never held in memory as a whole. Content moderation is the upstream's.
func (s *Server) inspectOpenAIReferenceImage(c *gin.Context, user *store.User, header *multipart.FileHeader) (c2a.StreamImage, error) {
	file, err := header.Open()
	if err != nil {
		return c2a.StreamImage{}, apperr.E("unsupported_file", "参考图读取失败，请重新上传", http.StatusBadRequest)
	}
	defer file.Close()
	head := make([]byte, 512)
	read, _ := io.ReadFull(file, head)
	head = head[:read]
	hasher := sha256.New()
	hasher.Write(head)
	size, err := io.Copy(hasher, file)
	if err != nil {
		return c2a.StreamImage{}, apperr.E("unsupported_file", "参考图读取失败，请重新上传", http.StatusBadRequest)
	}
	if int64(read)+size == 0 {
		return c2a.StreamImage{}, apperr.E("unsupported_file", "有一张参考图是空文件", http.StatusBadRequest)
	}
	_, contentType := sniffImage(head)
	if contentType == "" {
		return c2a.StreamImage{}, apperr.E("unsupported_file", "参考图只支持 PNG、JPEG、WebP 格式", http.StatusBadRequest)
	}
	hashText := hex.EncodeToString(hasher.Sum(nil))
	blocked, reason, err := store.IsUploadHashBlocked(c.Request.Context(), s.St.Pool, hashText)
	if err != nil {
		return c2a.StreamImage{}, err
	}
	if blocked {
		key := openAPIKeyFromContext(c)
		s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &user.ID, APIKeyID: &key.ID,
			ClientIP: c.ClientIP(), Category: "blocked_upload", Severity: "high", Score: 80, Action: "blocked",
			Reason: "API 调用输入图片命中安全黑名单", Metadata: map[string]any{"sha256": hashText, "rule": reason}})
		return c2a.StreamImage{}, apperr.E("upload_blocked", "参考图命中平台安全黑名单，已拒绝", http.StatusUnprocessableEntity)
	}
	return c2a.StreamImage{
		ContentType: contentType,
		Open:        func() (io.ReadCloser, error) { return header.Open() },
	}, nil
}
