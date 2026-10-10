package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestDeveloperUpstreamErrorExplainsTheCause(t *testing.T) {
	for _, test := range []struct {
		name          string
		err           error
		status        int
		code          string
		contains      []string
		mustNotAppear []string
	}{
		{"rejections never echo the upstream message", &c2a.UpstreamError{StatusCode: 400, Message: "Provider API error: rejected by the safety system, see https://provider.internal/docs key sk-abcdefghijklmnopqrstuv"},
			http.StatusBadRequest, "upstream_rejected", []string{"请检查提示词", "不扣费"}, []string{"Provider", "safety system", "provider.internal", "sk-abcdefghijklmnop", "HTTP 400", "上游"}},
		{"provider auth is not the caller's key", &c2a.UpstreamError{StatusCode: 401, Message: "invalid upstream key sk-secretsecretsecret"},
			http.StatusBadGateway, "upstream_misconfigured", []string{"与你的 API Key 无关"}, []string{"secret", "HTTP 401", "上游"}},
		{"rate limit", &sub2api.UpstreamError{Status: 429, Message: "slow down"},
			http.StatusTooManyRequests, "upstream_rate_limited", []string{"请稍后再发"}, []string{"slow down", "上游"}},
		{"server error", &sub2api.UpstreamError{Status: 503, Message: "overloaded"},
			http.StatusBadGateway, "upstream_error", []string{"不扣费"}, []string{"overloaded", "HTTP 503", "上游"}},
		{"network failure", &c2a.NetworkError{Message: "上游连接失败：dial tcp 10.0.0.5:443", Err: context.Canceled},
			http.StatusBadGateway, "upstream_unreachable", []string{"连接中断"}, []string{"10.0.0.5", "上游"}},
		{"timeout", &c2a.SynchronousImageError{Err: context.DeadlineExceeded},
			http.StatusGatewayTimeout, "request_timeout", []string{"240 秒"}, []string{"上游"}},
		{"unclassified errors stay generic", errString("pq: relation users does not exist"),
			http.StatusBadGateway, "upstream_error", []string{"不扣费"}, []string{"relation", "上游"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			appErr, ok := apperr.As(developerUpstreamError(test.err))
			if !ok || appErr.Status != test.status || appErr.Code != test.code {
				t.Fatalf("got %#v", appErr)
			}
			for _, want := range test.contains {
				if !strings.Contains(appErr.Message, want) {
					t.Fatalf("message %q lacks %q", appErr.Message, want)
				}
			}
			for _, hidden := range test.mustNotAppear {
				if strings.Contains(appErr.Message, hidden) {
					t.Fatalf("message %q leaks %q", appErr.Message, hidden)
				}
			}
		})
	}
}

type errString string

func (e errString) Error() string { return string(e) }

func TestModelNotFoundNamesTheRequestedModel(t *testing.T) {
	appErr, ok := apperr.As(modelNotFoundError(" gpt-imgae-2 "))
	if !ok || appErr.Code != "model_not_found" || !strings.Contains(appErr.Message, `"gpt-imgae-2"`) || !strings.Contains(appErr.Message, "GET /v1/models") {
		t.Fatalf("got %#v", appErr)
	}
}

func TestDeveloperContentPolicyErrorHidesTheUpstreamReason(t *testing.T) {
	appErr, ok := apperr.As(developerContentPolicyError("Provider API error: rejected by OpenAI safety system", true))
	if !ok || appErr.Code != openAIContentPolicyCode || strings.Contains(appErr.Message, "OpenAI") || strings.Contains(appErr.Message, "Provider") || !strings.Contains(appErr.Message, "扣费") {
		t.Fatalf("got %#v", appErr)
	}
}

func TestChatPayloadKeepsOnlyStandardFields(t *testing.T) {
	out, _, err := rewriteOpenAIChatPayload([]byte(`{"id":"x","object":"chat.completion","created":1,"model":"vendor/model","provider":"Vendor","system_fingerprint":"fp","choices":[],"usage":{"total_tokens":1}}`), "public-model")
	if err != nil {
		t.Fatal(err)
	}
	for _, leaked := range []string{"Vendor", "vendor/model", "system_fingerprint", "provider"} {
		if strings.Contains(string(out), leaked) {
			t.Fatalf("payload %s leaks %q", out, leaked)
		}
	}
	if !strings.Contains(string(out), `"model":"public-model"`) || !strings.Contains(string(out), `"usage"`) {
		t.Fatalf("payload %s lost standard fields", out)
	}
}
