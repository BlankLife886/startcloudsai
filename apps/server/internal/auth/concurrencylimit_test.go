package auth

import (
	"context"
	"testing"
	"time"
)

func TestMemoryConcurrencyLimiterReleasesCapacity(t *testing.T) {
	limiter := NewMemoryConcurrencyLimiter()
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		allowed, err := limiter.Acquire(ctx, "download", "user", 2, time.Minute)
		if err != nil || !allowed {
			t.Fatalf("acquire %d allowed=%v err=%v", i, allowed, err)
		}
	}
	if allowed, err := limiter.Acquire(ctx, "download", "user", 2, time.Minute); err != nil || allowed {
		t.Fatalf("third acquire allowed=%v err=%v", allowed, err)
	}
	if err := limiter.Release(ctx, "download", "user"); err != nil {
		t.Fatal(err)
	}
	if allowed, err := limiter.Acquire(ctx, "download", "user", 2, time.Minute); err != nil || !allowed {
		t.Fatalf("acquire after release allowed=%v err=%v", allowed, err)
	}
}
