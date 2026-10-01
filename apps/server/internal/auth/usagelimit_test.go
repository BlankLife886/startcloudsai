package auth

import (
	"context"
	"testing"
	"time"
)

func TestMemoryUsageLimiterCountsCostsAndExpires(t *testing.T) {
	limiter := NewMemoryUsageLimiter()
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }
	if _, allowed, err := limiter.Take(context.Background(), "upload", "user", 10, 6, time.Minute); err != nil || !allowed {
		t.Fatalf("first take allowed=%v err=%v", allowed, err)
	}
	retry, allowed, err := limiter.Take(context.Background(), "upload", "user", 10, 5, time.Minute)
	if err != nil || allowed || retry <= 0 {
		t.Fatalf("overflow allowed=%v retry=%v err=%v", allowed, retry, err)
	}
	now = now.Add(time.Minute)
	if _, allowed, err := limiter.Take(context.Background(), "upload", "user", 10, 5, time.Minute); err != nil || !allowed {
		t.Fatalf("expired window allowed=%v err=%v", allowed, err)
	}
}

func TestUsageLimiterSeparatesScopesAndSubjects(t *testing.T) {
	limiter := NewMemoryUsageLimiter()
	for _, item := range [][2]string{{"task", "a"}, {"task", "b"}, {"upload", "a"}} {
		if _, allowed, err := limiter.Take(context.Background(), item[0], item[1], 1, 1, time.Minute); err != nil || !allowed {
			t.Fatalf("take %v allowed=%v err=%v", item, allowed, err)
		}
	}
}
