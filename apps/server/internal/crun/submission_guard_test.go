package crun

import (
	"context"
	"errors"
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/upstreamguard"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSubmissionGuardDoesNotChargeEstimateOrSendCanceledCreate(t *testing.T) {
	var estimates, creates atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/client/job/EstimateTask" {
			estimates.Add(1)
			fmt.Fprint(w, `{"code":200,"data":{"estimated_credits":1,"balance":20,"affordable":true}}`)
			return
		}
		creates.Add(1)
		fmt.Fprint(w, `{"code":200,"data":{"task_id":"unexpected"}}`)
	}))
	defer server.Close()
	client, err := New(server.URL, "test", "test-model", 5)
	if err != nil {
		t.Fatal(err)
	}
	checks := 0
	ctx := upstreamguard.With(context.Background(), func(context.Context) error { checks++; return context.Canceled })
	_, err = client.CreateBackgroundRemovalTask(ctx, "https://example.test/input.png")
	var uncertain *SubmissionUncertainError
	if !upstreamguard.WasNotSent(err) || errors.As(err, &uncertain) || estimates.Load() != 1 || creates.Load() != 0 || checks != 1 {
		t.Fatalf("err=%v estimates=%d creates=%d checks=%d", err, estimates.Load(), creates.Load(), checks)
	}
}
