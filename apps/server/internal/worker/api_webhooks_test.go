package worker

import (
	"testing"
	"time"
)

func TestWebhookSignature(t *testing.T) {
	got := webhookSignature("secret", "1700000000", []byte(`{"id":"evt"}`))
	want := "v1=7c757099788fba43a4fe1e0c3b767303fdd971ab6183bc900d3de418c62b08b0"
	if got != want {
		t.Fatalf("signature = %q", got)
	}
}

func TestWebhookRetryDelayIsBounded(t *testing.T) {
	if got := webhookRetryDelay(0); got != 30*time.Second {
		t.Fatalf("first retry = %v", got)
	}
	if got := webhookRetryDelay(100); got != 24*time.Hour {
		t.Fatalf("bounded retry = %v", got)
	}
}
