package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/providerclient"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const (
	openAIChatSourceType = store.DeveloperAPIChatLedgerSource
	// Messages may carry Base64 images, so the body limit is larger than JSON's default.
	openAIChatMaxRequestBytes = 48 << 20
	// The HTTP server's write timeout is 310 seconds; a completion must end first.
	openAIChatTimeout = 300 * time.Second
	// A non-streamed completion is buffered to swap its model name.
	openAIChatMaxResponseBytes = 64 << 20
)

// openAIChatCompletions is a passthrough of the upstream's OpenAI-compatible
// /v1/chat/completions. The body is forwarded unchanged except for the model,
// which is swapped for the upstream model name and swapped back in the
// response, so tools, images and streaming work as the upstream supports them.
// Charging follows who ended the request. A completed answer is charged. An
// upstream or platform failure is released. A caller that disconnects is
// charged if it already received content (streaming) or once the upstream
// finishes (non-streamed), and released if a stream had delivered nothing.
// Nothing is retried.
func (s *Server) openAIChatCompletions(c *gin.Context) {
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
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		failOpenAIImage(c, imageBodyError(err))
		return
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		failOpenAIImage(c, imageParameterError("body", "请求体必须是 JSON 对象"))
		return
	}
	var requestedModel string
	if raw, ok := fields["model"]; ok && json.Unmarshal(raw, &requestedModel) != nil {
		failOpenAIImage(c, imageParameterError("model", "model 必须是字符串"))
		return
	}
	stream := false
	if raw, ok := fields["stream"]; ok && json.Unmarshal(raw, &stream) != nil {
		failOpenAIImage(c, imageParameterError("stream", "stream 必须是 true 或 false"))
		return
	}
	if _, ok := fields["messages"]; !ok {
		failOpenAIImage(c, imageParameterError("messages", "缺少 messages"))
		return
	}

	cfg, err := modelconfig.Runtime(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	entries, err := s.developerCatalog(c.Request.Context())
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	resolved, err := resolveDeveloperModel(c, entries, cfg, key, "chat", requestedModel)
	if err != nil {
		failOpenAI(c, err, "model")
		return
	}
	selection := &resolved.Selection
	if strings.TrimSpace(selection.Provider.BaseURL) == "" || strings.TrimSpace(selection.Provider.APIKey) == "" {
		failOpenAI(c, apperr.E("provider_misconfigured", "所选对话模型的上游服务尚未配置好，暂不可调用，请联系平台", http.StatusBadGateway), "model")
		return
	}
	client, err := providerclient.ChatForSelection(selection, "")
	if err != nil {
		failOpenAI(c, apperr.E("provider_misconfigured", "所选对话模型的上游服务尚未配置好，暂不可调用，请联系平台", http.StatusBadGateway), "model")
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}

	// A stream stops generating when its caller leaves; a non-streamed answer is
	// finished regardless, since it is charged once produced.
	base := c.Request.Context()
	if !stream {
		base = context.WithoutCancel(base)
	}
	ctx, cancel := context.WithTimeout(base, openAIChatTimeout)
	defer cancel()
	billing, err := s.openOpenAIChatBilling(c, user.ID, key, cfg, resolved)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	defer billing.release("request_aborted")

	fields["model"], _ = json.Marshal(selection.Model.UpstreamModel)
	payload, _ := json.Marshal(fields)
	response, err := client.PostChatCompletions(ctx, payload)
	if err != nil {
		upstreamErr := developerUpstreamError(err)
		billing.release(openAIErrorCode(upstreamErr))
		failOpenAI(c, upstreamErr, "")
		return
	}
	defer response.Body.Close()
	publicModel := resolved.Entry.APIName
	if stream {
		s.relayOpenAIChatStream(c, response.Body, billing, publicModel)
		return
	}
	s.relayOpenAIChatResponse(c, response.Body, billing, publicModel)
}

func openAIErrorCode(err error) string {
	if appErr, ok := apperr.As(err); ok {
		return appErr.Code
	}
	return "upstream_error"
}

// openAIChatChunk is what one completion object says about the request.
type openAIChatChunk struct {
	usage       json.RawMessage
	finished    bool   // a choice reported a finish_reason
	hasContent  bool   // the object carries answer text or tool calls
	upstreamErr string // an error the upstream sent inside a 200 response
}

// rewriteOpenAIChatPayload swaps the upstream model name in one completion
// object for the caller's model name and reports what the object carries.
func rewriteOpenAIChatPayload(raw []byte, publicModel string) (out []byte, chunk openAIChatChunk, err error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, chunk, err
	}
	if rawError, ok := object["error"]; ok && string(rawError) != "null" {
		var detail struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(rawError, &detail) != nil || detail.Message == "" {
			detail.Message = string(rawError)
		}
		chunk.upstreamErr = detail.Message
		return nil, chunk, nil
	}
	if _, ok := object["model"]; ok {
		object["model"], _ = json.Marshal(publicModel)
	}
	type content struct {
		Content   string          `json:"content"`
		ToolCalls json.RawMessage `json:"tool_calls"`
	}
	var choices []struct {
		FinishReason *string `json:"finish_reason"`
		Delta        content `json:"delta"`
		Message      content `json:"message"`
	}
	_ = json.Unmarshal(object["choices"], &choices)
	for _, choice := range choices {
		if choice.FinishReason != nil && *choice.FinishReason != "" {
			chunk.finished = true
		}
		for _, part := range []content{choice.Delta, choice.Message} {
			if part.Content != "" || (len(part.ToolCalls) > 0 && string(part.ToolCalls) != "null") {
				chunk.hasContent = true
			}
		}
	}
	if rawUsage, ok := object["usage"]; ok && string(rawUsage) != "null" {
		chunk.usage = rawUsage
	}
	out, err = json.Marshal(object)
	return out, chunk, err
}

func (s *Server) relayOpenAIChatResponse(c *gin.Context, body io.Reader, billing *openAIChatBilling, publicModel string) {
	raw, err := io.ReadAll(io.LimitReader(body, openAIChatMaxResponseBytes+1))
	if err == nil && len(raw) > openAIChatMaxResponseBytes {
		err = errors.New("upstream chat response exceeds the relay limit")
	}
	if err != nil {
		upstreamErr := developerUpstreamError(err)
		billing.release(openAIErrorCode(upstreamErr))
		failOpenAI(c, upstreamErr, "")
		return
	}
	out, chunk, err := rewriteOpenAIChatPayload(raw, publicModel)
	if err != nil || chunk.upstreamErr != "" {
		failure := developerUpstreamError(&sub2api.UpstreamError{Status: http.StatusBadGateway, Message: chunk.upstreamErr})
		billing.release(openAIErrorCode(failure))
		failOpenAI(c, failure, "")
		return
	}
	billing.usage = chunk.usage
	if c.Request.Context().Err() != nil {
		billing.note = "client_disconnected"
	}
	if err := billing.settle(); err != nil {
		// The answer exists; deliver it. The reclaim job releases the
		// reservation later, so an unrecorded charge is never taken.
		log.Printf("developer API chat settlement failed billing_id=%s: %v", billing.billing.BillingID, err)
	}
	c.Data(http.StatusOK, "application/json", out)
}

// relayOpenAIChatStream copies the upstream SSE stream line by line, swapping
// the model name in every data event. The request is charged once the
// upstream finishes a choice or sends [DONE]. An upstream error event, a broken
// stream or the gateway's own time limit end it with an OpenAI-style error
// event and release the credits. A caller that disconnects is charged if it
// had already received answer content, and released otherwise.
func (s *Server) relayOpenAIChatStream(c *gin.Context, body io.Reader, billing *openAIChatBilling, publicModel string) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher, _ := c.Writer.(http.Flusher)
	flush := func() {
		if flusher != nil {
			flusher.Flush()
		}
	}
	fail := func(err error) {
		appErr, _ := apperr.As(developerUpstreamError(err))
		billing.release(appErr.Code)
		event, _ := json.Marshal(gin.H{"error": gin.H{"message": appErr.Message, "type": openAIErrorType(appErr.Status), "code": appErr.Code, "param": nil}})
		_, _ = c.Writer.WriteString("data: " + string(event) + "\n\n")
		flush()
	}
	delivered := false
	callerLeft := func() {
		if delivered {
			billing.note = "client_disconnected"
			if err := billing.settle(); err != nil {
				log.Printf("developer API chat settlement failed billing_id=%s: %v", billing.billing.BillingID, err)
			}
		}
		// Otherwise the deferred release refunds a stream that delivered nothing.
	}
	reader := bufio.NewReaderSize(body, 64<<10)
	completed := false
	for {
		line, readErr := reader.ReadString('\n')
		chunkHasContent := false
		if trimmed := strings.TrimRight(line, "\r\n"); strings.HasPrefix(trimmed, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
			if data == "[DONE]" {
				completed = true
			} else if data != "" {
				out, chunk, err := rewriteOpenAIChatPayload([]byte(data), publicModel)
				switch {
				case err != nil:
					fail(err)
					return
				case chunk.upstreamErr != "":
					fail(&sub2api.UpstreamError{Status: http.StatusBadGateway, Message: chunk.upstreamErr})
					return
				}
				if chunk.usage != nil {
					billing.usage = chunk.usage
				}
				completed = completed || chunk.finished
				chunkHasContent = chunk.hasContent
				line = "data: " + string(out) + "\n"
			}
		}
		if line != "" {
			if _, err := c.Writer.WriteString(line); err != nil {
				callerLeft()
				return
			}
			delivered = delivered || chunkHasContent
			if strings.TrimSpace(line) == "" {
				flush()
			}
		}
		if readErr != nil {
			flush()
			if completed {
				break
			}
			if c.Request.Context().Err() != nil {
				callerLeft()
				return
			}
			if readErr == io.EOF {
				readErr = io.ErrUnexpectedEOF
			}
			fail(readErr)
			return
		}
	}
	if err := billing.settle(); err != nil {
		log.Printf("developer API chat settlement failed billing_id=%s: %v", billing.billing.BillingID, err)
	}
}

// openAIChatBilling tracks the credit reservation of one completion. Every
// write uses a context detached from the client request: a caller that
// disconnects mid-stream must not leave its reservation frozen. The handler
// always defers release, which also frees the model's concurrency slot.
type openAIChatBilling struct {
	s            *Server
	parent       context.Context
	apiKeyID     uuid.UUID
	userID       uuid.UUID
	selection    *modelconfig.Selection
	billing      *developerAPIBilling
	upstreamCost int64
	usage        json.RawMessage
	note         string // why a settled request ended unusually, e.g. client_disconnected
	freeSlot     func()
	finished     bool
}

func (s *Server) openOpenAIChatBilling(c *gin.Context, userID uuid.UUID, key *store.UserAPIKey, cfg modelconfig.Config, resolved *apicatalog.Resolved) (*openAIChatBilling, error) {
	selection := &resolved.Selection
	priceCents := apicatalog.UnitPrice(cfg, *resolved, time.Now())
	upstreamCost := modelconfig.ResolveUpstreamCost(selection.Model, 0, 0)
	if priceCents == 0 && !selection.Model.AllowZeroPrice {
		return nil, apperr.E("model_zero_price_blocked", "所选对话模型尚未设置价格，暂不可调用，请联系平台", http.StatusServiceUnavailable)
	}
	if priceCents < upstreamCost && !selection.Model.AllowLossLeader {
		return nil, apperr.E("model_price_inverted", "所选对话模型的价格配置异常，暂不可调用，请联系平台", http.StatusServiceUnavailable)
	}
	freeSlot, err := s.acquireDeveloperModelSlot(c.Request.Context(), resolved.Entry)
	if err != nil {
		return nil, err
	}
	feature := developerFeature("chat")
	ctx := wallet.WithSubscriptionScope(c.Request.Context(), "api", resolved.Entry.ID)
	billing, err := s.reserveDeveloperAPIRequest(ctx, developerAPIReservation{
		SourceType: openAIChatSourceType, BillingID: "chatcmpl-bill-" + uuid.NewString(),
		UserID: userID, KeyID: key.ID, ModelID: selection.Model.ID, Feature: feature, PriceCents: priceCents,
		APIModelID: resolved.Entry.ID, APIModelName: resolved.Entry.APIName,
	})
	if err != nil {
		freeSlot()
		return nil, err
	}
	return &openAIChatBilling{s: s, parent: c.Request.Context(), apiKeyID: key.ID, userID: userID,
		selection: selection, billing: billing, upstreamCost: upstreamCost, freeSlot: freeSlot}, nil
}

func (b *openAIChatBilling) settle() error {
	if b.finished {
		return nil
	}
	if err := b.s.settleDeveloperAPIRequest(b.parent, b.billing, b.userID); err != nil {
		return err
	}
	b.finished = true
	b.recordProfit("succeeded", "")
	return nil
}

func (b *openAIChatBilling) release(errorCode string) {
	if b.freeSlot != nil {
		defer func() { b.freeSlot(); b.freeSlot = nil }()
	}
	if b.finished {
		return
	}
	b.finished = true
	b.s.releaseDeveloperAPIRequest(b.parent, b.billing, b.userID)
	b.recordProfit("failed", errorCode)
}

func (b *openAIChatBilling) recordProfit(status, errorCode string) {
	ctx, cancel := detachedOpenAIImagePersistenceContext(b.parent)
	defer cancel()
	revenue, cost := b.billing.PriceCents, b.upstreamCost
	if status != "succeeded" {
		revenue, cost = 0, 0
	}
	metadata := map[string]any{"source": "developer_api", "transport": "direct", "operation": "chat"}
	if errorCode != "" {
		metadata["errorCode"] = errorCode
	}
	if b.usage != nil {
		// Kept for per-token pricing and cost review; billing is per request today.
		metadata["usage"] = b.usage
	}
	if b.note != "" {
		metadata["note"] = b.note
	}
	if err := store.UpsertUsageProfitEntry(ctx, b.s.St.Pool, store.UsageProfitEntry{
		SourceType: store.DeveloperAPIProfitSourceType, SourceID: b.billing.BillingID, UserID: b.userID, APIKeyID: &b.apiKeyID,
		EventStatus: status, Workspace: modelconfig.WorkspaceAssistant, ProviderID: b.selection.Provider.ID,
		RouteID: b.selection.Provider.RouteID, ModelID: b.selection.Model.ID, Units: 1,
		RevenueCents: revenue, UpstreamCostCents: cost, Metadata: metadata, CreatedAt: time.Now().UTC(),
	}); err != nil {
		log.Printf("developer API chat profit record failed billing_id=%s status=%s: %v", b.billing.BillingID, status, err)
	}
}
