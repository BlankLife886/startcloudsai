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
		{"content policy reason passes through", &c2a.UpstreamError{StatusCode: 400, Message: "Your request was rejected by the safety system."},
			http.StatusBadRequest, "upstream_rejected", []string{"HTTP 400", "safety system", "不扣费"}, nil},
		{"provider details are hidden", &c2a.UpstreamError{StatusCode: 400, Message: "bad size, see https://provider.internal/docs key sk-abcdefghijklmnopqrstuv"},
			http.StatusBadRequest, "upstream_rejected", []string{"bad size", "[链接已隐藏]", "[已隐藏]"}, []string{"provider.internal", "sk-abcdefghijklmnop"}},
		{"provider auth is not the caller's key", &c2a.UpstreamError{StatusCode: 401, Message: "invalid upstream key sk-secretsecretsecret"},
			http.StatusBadGateway, "upstream_misconfigured", []string{"HTTP 401", "与你的 API Key 无关"}, []string{"secret"}},
		{"upstream rate limit", &sub2api.UpstreamError{Status: 429, Message: "slow down"},
			http.StatusTooManyRequests, "upstream_rate_limited", []string{"HTTP 429", "slow down"}, nil},
		{"upstream server error", &sub2api.UpstreamError{Status: 503, Message: "overloaded"},
			http.StatusBadGateway, "upstream_error", []string{"HTTP 503", "overloaded"}, nil},
		{"network failure", &c2a.NetworkError{Message: "上游连接失败：dial tcp 10.0.0.5:443", Err: context.Canceled},
			http.StatusBadGateway, "upstream_unreachable", []string{"连接上游服务失败"}, []string{"10.0.0.5"}},
		{"gateway timeout", &c2a.SynchronousImageError{Err: context.DeadlineExceeded},
			http.StatusGatewayTimeout, "request_timeout", []string{"240 秒"}, nil},
		{"unclassified errors stay generic", errString("pq: relation users does not exist"),
			http.StatusBadGateway, "upstream_error", []string{"上游服务处理失败"}, []string{"relation"}},
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
