package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
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

var (
	upstreamReasonURL    = regexp.MustCompile(`(?i)\b(?:https?|wss?)://\S+`)
	upstreamReasonSecret = regexp.MustCompile(`(?i)\b(?:sk|pk|rk|key|token|bearer)[-_ ]?[A-Za-z0-9_\-]{12,}`)
	upstreamReasonSpaces = regexp.MustCompile(`\s+`)
)

// upstreamReason keeps an upstream error message readable for the caller while
// removing what identifies our provider: URLs, credential-like tokens and
// overlong bodies.
func upstreamReason(message string) string {
	message = upstreamReasonURL.ReplaceAllString(message, "[链接已隐藏]")
	message = upstreamReasonSecret.ReplaceAllString(message, "[已隐藏]")
	message = strings.TrimSpace(upstreamReasonSpaces.ReplaceAllString(message, " "))
	if runes := []rune(message); len(runes) > 300 {
		message = string(runes[:300]) + "…"
	}
	return message
}

func withUpstreamReason(summary, reason string) string {
	if reason = upstreamReason(reason); reason != "" {
		return summary + "：" + reason
	}
	return summary
}

// developerUpstreamError explains an upstream failure to the /v1 caller: what
// happened, whether it is the caller's to fix, and that nothing was charged.
// An upstream 401/403/404 describes our provider credentials or routing, never
// the caller's API Key, so it is reported as a platform problem.
func developerUpstreamError(err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return apperr.E("request_timeout", fmt.Sprintf("等待上游超过 %d 秒仍未返回，本次不扣费", int(openAIImageWaitTimeout.Seconds())), http.StatusGatewayTimeout)
	}
	status, reason, known := 0, "", false
	var imageErr *c2a.UpstreamError
	var chatErr *sub2api.UpstreamError
	switch {
	case errors.As(err, &imageErr):
		status, reason, known = imageErr.StatusCode, imageErr.Message, true
	case errors.As(err, &chatErr):
		status, reason, known = chatErr.Status, chatErr.Message, true
	}
	var networkErr *c2a.NetworkError
	var netErr net.Error
	if !known && (errors.As(err, &networkErr) || errors.As(err, &netErr) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)) {
		return apperr.E("upstream_unreachable", "连接上游服务失败或连接中途断开，本次不扣费", http.StatusBadGateway)
	}
	switch {
	case !known:
		// Unclassified errors may carry internal details; say only what happened.
		return apperr.E("upstream_error", "上游服务处理失败，本次不扣费", http.StatusBadGateway)
	case status == http.StatusBadRequest || status == http.StatusRequestEntityTooLarge || status == http.StatusUnprocessableEntity:
		return apperr.E("upstream_rejected", withUpstreamReason(fmt.Sprintf("上游拒绝了这次请求（HTTP %d），本次不扣费", status), reason), http.StatusBadRequest)
	case status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound:
		return apperr.E("upstream_misconfigured", fmt.Sprintf("平台的上游服务配置异常（上游返回 HTTP %d），与你的 API Key 无关，本次不扣费，请联系平台处理", status), http.StatusBadGateway)
	case status == http.StatusTooManyRequests:
		return apperr.E("upstream_rate_limited", withUpstreamReason("上游当前限流（HTTP 429），本次不扣费，请稍后再发", reason), http.StatusTooManyRequests)
	case status == 0:
		return apperr.E("upstream_error", withUpstreamReason("上游返回了无法处理的结果，本次不扣费", reason), http.StatusBadGateway)
	default:
		return apperr.E("upstream_error", withUpstreamReason(fmt.Sprintf("上游服务出错（HTTP %d），本次不扣费", status), reason), http.StatusBadGateway)
	}
}
