package c2a

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/upstreamguard"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSubmissionGuardBlocksEveryImageCreateEndpoint(t *testing.T) {
	var sent atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { sent.Add(1); w.Write([]byte(`{}`)) }))
	defer server.Close()
	client := NewWithPolicy(server.URL, "test", 5, true)
	ctx := upstreamguard.With(context.Background(), func(context.Context) error { return context.Canceled })
	for _, path := range []string{"/api/image-tasks/generations", "/api/image-tasks/edits", "/v1/images/generations", "/v1/images/edits", "/v1/editable-file-tasks"} {
		_, err := client.doRequest(ctx, http.MethodPost, path, map[string]any{"prompt": "test"}, 0)
		if !upstreamguard.WasNotSent(err) {
			t.Fatalf("path=%s err=%v", path, err)
		}
	}
	if sent.Load() != 0 {
		t.Fatal("a canceled generation reached HTTP")
	}
}
