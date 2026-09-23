package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const (
	openAIImageBillingSource      = "openai_image_request"
	directImagePersistenceTimeout = 10 * time.Second
)

func openAIImageSelections(cfg modelconfig.Config, key *store.UserAPIKey) []modelconfig.Selection {
	all := modelconfig.PublicModelsForWorkspace(cfg, modelconfig.WorkspaceT2I, modelconfig.ModelKindImage)
	result := make([]modelconfig.Selection, 0, len(all))
	for _, selection := range all {
		if selection.Provider.Adapter != modelconfig.AdapterOpenAI || !selection.Model.Available() {
			continue
		}
		if key != nil && len(key.AllowedModelIDs) > 0 && !store.Contains(key.AllowedModelIDs, selection.Model.ID) {
			continue
		}
		result = append(result, selection)
	}
	return result
}

func matchOpenAIImageSelection(cfg modelconfig.Config, key *store.UserAPIKey, requested string) *modelconfig.Selection {
	selections := openAIImageSelections(cfg, key)
	requested = strings.TrimSpace(requested)
	for index := range selections {
		selection := &selections[index]
		if openAIWireModelEqual(openAIPublicModelID(selection.Model), requested) || selection.Model.ID == requested {
			return selection
		}
	}
	if openAIWireImageModelFamily(requested) {
		for index := range selections {
			if openAIWireImageModelFamily(openAIPublicModelID(selections[index].Model)) {
				return &selections[index]
			}
		}
	}
	return nil
}

func openAIImageBillingID(keyID uuid.UUID, idempotencyKey string) string {
	sum := sha256.Sum256([]byte(keyID.String() + "\x00" + idempotencyKey))
	return "openai-image:" + hex.EncodeToString(sum[:])
}

func detachedOpenAIImagePersistenceContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), directImagePersistenceTimeout)
}

func directImageErrorAmbiguous(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var networkErr *c2a.NetworkError
	if errors.As(err, &networkErr) {
		return true
	}
	var upstreamErr *c2a.UpstreamError
	if errors.As(err, &upstreamErr) {
		return upstreamErr.StatusCode == 0 || upstreamErr.StatusCode == http.StatusRequestTimeout || upstreamErr.StatusCode >= http.StatusInternalServerError
	}
	if appErr, ok := apperr.As(err); ok {
		return appErr.Status >= http.StatusInternalServerError
	}
	return false
}

func directImageAccountingErrorCode(err error) string {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "request_timeout"
	}
	var networkErr *c2a.NetworkError
	if errors.As(err, &networkErr) {
		return "upstream_network_error"
	}
	if appErr, ok := apperr.As(err); ok && appErr.Code != "" {
		return appErr.Code
	}
	var upstreamErr *c2a.UpstreamError
	if errors.As(err, &upstreamErr) {
		return "upstream_error"
	}
	return "upstream_error"
}

// openAIImage is the stateless developer image gateway. It deliberately does
// not create a site task: the upstream request remains the only generation
// execution, while the local database stores only wallet/API usage accounting.
func (s *Server) openAIImage(c *gin.Context, editing bool) {
	c.Header("Cache-Control", "no-store")
	user, err := s.requireUser(c)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	key := openAPIKeyFromContext(c)
	if key == nil {
		failOpenAI(c, apperr.E("api_key_required", "An API Key is required.", http.StatusUnauthorized), "")
		return
	}
	if editing && !apiKeyHasScope(key, "files:write") {
		failOpenAI(c, apperr.E("api_key_scope_denied", "Image editing requires files:write permission.", http.StatusForbidden), "")
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}

	originalRequest := c.Request
	ctx, cancel := context.WithTimeout(originalRequest.Context(), openAIImageWaitTimeout)
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
		request, files, err = decodeOpenAIImageMultipart(c.Request, s.Cfg.UploadMaxBytes)
	} else {
		request, err = decodeOpenAIImageJSON(c.Request)
	}
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if len(idempotencyKey) > 128 {
		failOpenAIImage(c, imageParameterError("Idempotency-Key", "Idempotency-Key must not exceed 128 bytes."))
		return
	}
	if idempotencyKey == "" {
		idempotencyKey = uuid.NewString()
	}
	c.Header("Idempotency-Key", idempotencyKey)

	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	selection := matchOpenAIImageSelection(cfg, key, request.Model)
	if selection == nil {
		failOpenAI(c, apperr.E("model_not_found", "The requested image model does not exist or is not available to this API Key.", http.StatusNotFound), "model")
		return
	}
	if strings.TrimSpace(selection.Provider.BaseURL) == "" || strings.TrimSpace(selection.Provider.APIKey) == "" {
		failOpenAI(c, apperr.E("provider_misconfigured", "The selected image model has no usable provider configuration.", http.StatusBadGateway), "model")
		return
	}
	params, err := openAIImageParams(request, selection.Model, len(files))
	if err != nil {
		failOpenAIImage(c, err)
		return
	}

	inputImages := make([]string, 0, len(files))
	for _, file := range files {
		data, readErr := s.readOpenAIDirectImage(c, user, file)
		if readErr != nil {
			failOpenAIImage(c, readErr)
			return
		}
		inputImages = append(inputImages, base64.StdEncoding.EncodeToString(data))
	}

	quote, err := taskflow.QuoteTaskPrice(ctx, s.St.Pool, taskflow.CreateInput{
		Type: "t2i", Prompt: request.Prompt, Params: params, Count: request.N,
		InputKeys: make([]string, len(inputImages)),
	}, user.ID)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	basePrice := modelconfig.ResolveWorkspacePrice(cfg, modelconfig.WorkspaceT2I, selection.Model).EffectiveCents
	upstreamCost := modelconfig.ResolveUpstreamCost(selection.Model, 0, 0)
	if basePrice == 0 && !selection.Model.AllowZeroPrice {
		failOpenAI(c, apperr.E("model_zero_price_blocked", "The selected image model is not ready for billing.", http.StatusServiceUnavailable), "model")
		return
	}
	if basePrice < upstreamCost && !selection.Model.AllowLossLeader {
		failOpenAI(c, apperr.E("model_price_inverted", "The selected image model is temporarily unavailable.", http.StatusServiceUnavailable), "model")
		return
	}

	feature, _ := trialfeature.ForTask("t2i", params)
	billingID := openAIImageBillingID(key.ID, idempotencyKey)
	billingCtx := wallet.WithSubscriptionScope(ctx, "api", selection.Model.ID)
	billingCtx = store.WithBillingDecision(billingCtx, quote.Billing)
	priceCents := quote.TotalPriceCents
	previouslySettled := false
	reserved := false
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		spend, err := store.GetLedgerEntry(ctx, tx, "spend", openAIImageBillingSource, billingID)
		if err != nil {
			return err
		}
		if spend != nil {
			previouslySettled = true
			return nil
		}
		released, err := store.GetLedgerEntry(ctx, tx, "release", openAIImageBillingSource, billingID)
		if err != nil {
			return err
		}
		if released != nil {
			return apperr.E("idempotency_key_reused", "This Idempotency-Key belongs to a failed request and cannot be reused.", http.StatusConflict)
		}
		freeze, err := store.GetLedgerEntry(ctx, tx, "freeze", openAIImageBillingSource, billingID)
		if err != nil {
			return err
		}
		if freeze == nil {
			if err := store.RecordAPIKeyRequest(ctx, tx, key.ID, user.ID, selection.Model.ID, priceCents, time.Now().UTC()); err != nil {
				return mapOpenAIAPIKeyUsageError(err)
			}
		}
		if err := trialfeature.Authorize(ctx, tx, user.ID, feature); err != nil {
			return err
		}
		if priceCents > 0 {
			if _, err := wallet.FreezeFeatureCredits(billingCtx, tx, user.ID, priceCents, feature.Key, openAIImageBillingSource, billingID, nil); err != nil {
				return err
			}
			reserved = true
		}
		return nil
	}); err != nil {
		failOpenAI(c, err, "")
		return
	}

	options := c2a.ImageOptions{
		Quality:               request.Quality,
		TransparentBackground: request.Background == "transparent",
		Background:            request.Background,
		OutputFormat:          request.OutputFormat,
		ModerationLevel:       request.Moderation,
		ResponseFormat:        request.ResponseFormat,
		User:                  request.User,
	}
	client := c2a.NewWithPolicy(selection.Provider.BaseURL, selection.Provider.APIKey, selection.Provider.TimeoutSecs, s.Cfg.C2APrivateNetworkAllowed()).WithStandardImages()
	var upstream c2a.StandardImageResponse
	if editing {
		upstream, err = client.EditImagesStandard(ctx, idempotencyKey, request.Prompt, selection.Model.UpstreamModel, request.N, inputImages, openAIRequestSize(request), options)
	} else {
		upstream, err = client.GenerateImagesStandard(ctx, idempotencyKey, request.Prompt, selection.Model.UpstreamModel, request.N, openAIRequestSize(request), options)
	}
	if err != nil {
		s.finalizeOpenAIImageFailure(billingCtx, user.ID, key.ID, selection, request, editing, priceCents, upstreamCost, billingID, previouslySettled, reserved, err)
		failOpenAI(c, directImageUpstreamError(err), "")
		return
	}

	result, err := directOpenAIImageResponse(upstream, request.ResponseFormat)
	if err != nil {
		s.finalizeOpenAIImageFailure(billingCtx, user.ID, key.ID, selection, request, editing, priceCents, upstreamCost, billingID, previouslySettled, reserved, err)
		failOpenAI(c, err, "")
		return
	}
	if err := s.finalizeOpenAIImageSuccess(billingCtx, user.ID, key.ID, selection, request, editing, priceCents, upstreamCost, billingID, previouslySettled, reserved); err != nil {
		// The upstream result was already generated. Do not release a successful
		// charge on a transient settlement failure; leave the reservation for the
		// accounting repair path and return a retryable server error.
		failOpenAI(c, err, "")
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) finalizeOpenAIImageFailure(parent context.Context, userID, apiKeyID uuid.UUID, selection *modelconfig.Selection, request openAIImageRequest, editing bool, priceCents, upstreamCost int64, billingID string, previouslySettled, reserved bool, upstreamErr error) {
	if previouslySettled {
		return
	}
	persistCtx, cancel := detachedOpenAIImagePersistenceContext(parent)
	defer cancel()
	status := "failed"
	if directImageErrorAmbiguous(upstreamErr) {
		status = "canceled"
	} else if reserved {
		if err := s.releaseOpenAIImageBilling(persistCtx, persistCtx, userID, priceCents, billingID); err != nil {
			log.Printf("developer API image release pending billing_id=%s: %v", billingID, err)
			status = "canceled"
		}
	}
	if err := s.recordOpenAIImageProfit(persistCtx, userID, apiKeyID, selection, request, editing, billingID, status, priceCents, upstreamCost, directImageAccountingErrorCode(upstreamErr)); err != nil {
		log.Printf("developer API image profit record failed billing_id=%s status=%s: %v", billingID, status, err)
	}
}

func (s *Server) finalizeOpenAIImageSuccess(parent context.Context, userID, apiKeyID uuid.UUID, selection *modelconfig.Selection, request openAIImageRequest, editing bool, priceCents, upstreamCost int64, billingID string, previouslySettled, reserved bool) error {
	persistCtx, cancel := detachedOpenAIImagePersistenceContext(parent)
	defer cancel()
	if reserved && !previouslySettled {
		if err := s.settleOpenAIImageBilling(persistCtx, persistCtx, userID, priceCents, billingID); err != nil {
			if recordErr := s.recordOpenAIImageProfit(persistCtx, userID, apiKeyID, selection, request, editing, billingID, "canceled", priceCents, upstreamCost, "billing_settlement_failed"); recordErr != nil {
				log.Printf("developer API image settlement failure record failed billing_id=%s: %v", billingID, recordErr)
			}
			return err
		}
	}
	if !previouslySettled {
		if err := s.recordOpenAIImageProfit(persistCtx, userID, apiKeyID, selection, request, editing, billingID, "succeeded", priceCents, upstreamCost, ""); err != nil {
			log.Printf("developer API image profit record failed billing_id=%s status=succeeded: %v", billingID, err)
		}
	}
	return nil
}

func (s *Server) recordOpenAIImageProfit(ctx context.Context, userID, apiKeyID uuid.UUID, selection *modelconfig.Selection, request openAIImageRequest, editing bool, billingID, status string, priceCents, upstreamCost int64, errorCode string) error {
	operation := "generation"
	if editing {
		operation = "edit"
	}
	units := request.N
	revenue := priceCents
	cost := upstreamCost * int64(request.N)
	if status != "succeeded" {
		revenue = 0
		cost = 0
	}
	metadata := map[string]any{
		"source":         "developer_api",
		"transport":      "direct",
		"operation":      operation,
		"requestedUnits": request.N,
		"responseFormat": request.ResponseFormat,
	}
	if errorCode != "" {
		metadata["errorCode"] = errorCode
	}
	return store.UpsertUsageProfitEntry(ctx, s.St.Pool, store.UsageProfitEntry{
		SourceType: store.DeveloperAPIProfitSourceType, SourceID: billingID, UserID: userID, APIKeyID: &apiKeyID,
		EventStatus: status, Workspace: modelconfig.WorkspaceT2I, ProviderID: selection.Provider.ID,
		RouteID: selection.Provider.RouteID, ModelID: selection.Model.ID, Units: units,
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
				return nil, apperr.E("image_result_unavailable", "The upstream image provider did not return a URL.", http.StatusBadGateway)
			}
			result.Data = append(result.Data, openAIImageData{URL: item.URL})
		default:
			if item.B64JSON == "" {
				return nil, apperr.E("image_result_unavailable", "The upstream image provider did not return b64_json data.", http.StatusBadGateway)
			}
			result.Data = append(result.Data, openAIImageData{B64JSON: item.B64JSON})
		}
	}
	if len(result.Data) == 0 {
		return nil, apperr.E("image_result_unavailable", "The upstream image provider returned no images.", http.StatusBadGateway)
	}
	return result, nil
}

func directImageUpstreamError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	var upstream *c2a.UpstreamError
	if errors.As(err, &upstream) {
		status := upstream.StatusCode
		if status < http.StatusBadRequest || status >= http.StatusInternalServerError {
			status = http.StatusBadGateway
		}
		return apperr.E("upstream_error", "The upstream image provider rejected the request.", status)
	}
	return err
}

func mapOpenAIAPIKeyUsageError(err error) error {
	switch {
	case errors.Is(err, store.ErrAPIKeyInactive):
		return apperr.E("api_key_invalid", "API Key is no longer active.", http.StatusUnauthorized)
	case errors.Is(err, store.ErrAPIKeyDailyLimit):
		return apperr.E("api_key_daily_limit", "API Key daily request or spend limit exceeded.", http.StatusTooManyRequests)
	case errors.Is(err, store.ErrAPIKeyMonthlyLimit):
		return apperr.E("api_key_monthly_limit", "API Key monthly request or spend limit exceeded.", http.StatusTooManyRequests)
	case errors.Is(err, store.ErrAPIKeyModelDenied):
		return apperr.E("api_key_model_denied", "This API Key is not allowed to use the selected model.", http.StatusForbidden)
	default:
		return err
	}
}

func (s *Server) settleOpenAIImageBilling(ctx context.Context, billingCtx context.Context, userID uuid.UUID, amount int64, billingID string) error {
	return s.St.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.SettleFeatureCredits(billingCtx, tx, userID, amount, openAIImageBillingSource, billingID, nil)
		return err
	})
}

func (s *Server) releaseOpenAIImageBilling(ctx context.Context, billingCtx context.Context, userID uuid.UUID, amount int64, billingID string) error {
	return s.St.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.ReleaseFeatureCredits(billingCtx, tx, userID, amount, openAIImageBillingSource, billingID, nil)
		return err
	})
}

func (s *Server) readOpenAIDirectImage(c *gin.Context, user *store.User, header *multipart.FileHeader) ([]byte, error) {
	data, err := readUploadFile(header, s.Cfg.UploadMaxBytes)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	hashText := hex.EncodeToString(hash[:])
	blocked, reason, err := store.IsUploadHashBlocked(c.Request.Context(), s.St.Pool, hashText)
	if err != nil {
		return nil, err
	}
	if blocked {
		key := openAPIKeyFromContext(c)
		s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &user.ID, APIKeyID: &key.ID,
			ClientIP: c.ClientIP(), Category: "blocked_upload", Severity: "high", Score: 80, Action: "blocked",
			Reason: "开发者 API 输入图片命中安全黑名单", Metadata: map[string]any{"sha256": hashText, "rule": reason}})
		return nil, apperr.E("upload_blocked", "The input image did not pass security checks.", http.StatusUnprocessableEntity)
	}
	_, contentType := sniffImage(data)
	if contentType == "" {
		return nil, apperr.E("unsupported_file", "image: only png, jpg, and webp images are supported.", http.StatusBadRequest)
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return nil, apperr.E("unsupported_file", "The input image is too large or unreadable.", http.StatusBadRequest)
	}
	if address := strings.TrimSpace(s.Cfg.UploadClamAVAddr); address != "" {
		if err := scanWithClamAV(c.Request.Context(), address, data, s.Cfg.UploadScanTimeout); err != nil {
			return nil, apperr.E("upload_scanner_unavailable", "The image security scanner is temporarily unavailable.", http.StatusServiceUnavailable)
		}
	}
	if endpoint := strings.TrimSpace(s.Cfg.UploadReviewURL); endpoint != "" {
		if err := reviewUploadContent(c.Request.Context(), endpoint, s.Cfg.UploadReviewKey, contentType, hashText, data, s.Cfg.UploadScanTimeout, s.Cfg.AppEnv != "production"); err != nil {
			return nil, apperr.E("upload_review_unavailable", "The image content review service is temporarily unavailable.", http.StatusServiceUnavailable)
		}
	}
	return data, nil
}
