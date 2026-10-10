package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// modelNotFoundError names the model the caller asked for, so a typo is
// obvious; the same answer covers models not offered to this Key.
func modelNotFoundError(requested string) error {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return imageParameterError("model", "缺少 model：请填写 GET /v1/models 返回的模型名")
	}
	return apperr.E("model_not_found", fmt.Sprintf("模型 %q 不存在，或未开放给这把 API Key；可用模型见 GET /v1/models", requested), http.StatusNotFound)
}

// developerUpstreamError explains a failed generation to the /v1 caller:
// whether it is theirs to fix and that nothing was charged. Callers never see
// the upstream's own message, status or address, which would reveal the
// provider; the raw cause is only logged for the platform.
// An upstream 401/403/404 describes our provider credentials or routing, never
// the caller's API Key, so it is reported as a platform problem.
func developerUpstreamError(err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return apperr.E("request_timeout", fmt.Sprintf("超过 %d 秒仍未完成，本次不扣费，可稍后重试", int(openAIImageWaitTimeout.Seconds())), http.StatusGatewayTimeout)
	}
	status, known := 0, false
	var imageErr *c2a.UpstreamError
	var chatErr *sub2api.UpstreamError
	switch {
	case errors.As(err, &imageErr):
		status, known = imageErr.StatusCode, true
	case errors.As(err, &chatErr):
		status, known = chatErr.Status, true
	}
	log.Printf("developer API upstream failure status=%d: %s", status, truncateRunes(err.Error(), 500))
	var networkErr *c2a.NetworkError
	var netErr net.Error
	if !known && (errors.As(err, &networkErr) || errors.As(err, &netErr) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)) {
		return apperr.E("upstream_unreachable", "模型服务连接中断，本次不扣费，请稍后重试", http.StatusBadGateway)
	}
	switch {
	case !known:
		return apperr.E("upstream_error", "模型服务处理失败，本次不扣费，请稍后重试", http.StatusBadGateway)
	case status == http.StatusBadRequest || status == http.StatusRequestEntityTooLarge || status == http.StatusUnprocessableEntity:
		return apperr.E("upstream_rejected", "请求未被模型接受，请检查提示词、参考图和参数后重试，本次不扣费", http.StatusBadRequest)
	case status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound:
		return apperr.E("upstream_misconfigured", "该模型暂时不可用（平台侧问题，与你的 API Key 无关），本次不扣费，请稍后重试或联系平台", http.StatusBadGateway)
	case status == http.StatusTooManyRequests:
		return apperr.E("upstream_rate_limited", "该模型当前请求较多，本次不扣费，请稍后再发", http.StatusTooManyRequests)
	default:
		return apperr.E("upstream_error", "模型服务暂时出错，本次不扣费，请稍后重试", http.StatusBadGateway)
	}
}

// openAIContentPolicyCode 与 OpenAI 被内容安全拒绝时返回的 code 一致。
const openAIContentPolicyCode = "content_policy_violation"

// developerUpstreamReason 取出上游失败时返回的说明文字，供内容违规识别使用；
// 不是上游失败（如超时、断网）时返回空字符串。
func developerUpstreamReason(err error) string {
	var imageErr *c2a.UpstreamError
	var chatErr *sub2api.UpstreamError
	switch {
	case err == nil:
		return ""
	case errors.As(err, &imageErr):
		return imageErr.Message
	case errors.As(err, &chatErr):
		return chatErr.Message
	}
	return ""
}

// developerContentPolicyError tells the caller the image was refused for its
// content and whether that was charged, without the upstream's own wording.
func developerContentPolicyError(reason string, charged bool) error {
	log.Printf("developer API content policy rejection charged=%t: %s", charged, truncateRunes(reason, 500))
	message := "内容不符合安全规范，本次生成被拒绝，按本次价格扣费"
	if !charged {
		message = "内容不符合安全规范，本次生成被拒绝；在每日免扣次数内，不扣费"
	}
	return apperr.E(openAIContentPolicyCode, message, http.StatusBadRequest)
}
