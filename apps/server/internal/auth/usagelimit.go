package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// UsageLimiter applies an atomic cost against a fixed-duration window.
type UsageLimiter interface {
	Take(ctx context.Context, scope, subject string, limit, cost int64, window time.Duration) (time.Duration, bool, error)
	Close() error
}

var usageScript = redis.NewScript(`
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local cost = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if current + cost > limit then
  return {0, redis.call('PTTL', KEYS[1])}
end
local updated = redis.call('INCRBY', KEYS[1], cost)
if current == 0 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
return {1, redis.call('PTTL', KEYS[1])}
`)

type RedisUsageLimiter struct{ client *redis.Client }

func NewRedisUsageLimiter(redisURL string) (*RedisUsageLimiter, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis usage limiter URL: %w", err)
	}
	opts.PoolSize = 8
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect redis usage limiter: %w", err)
	}
	return &RedisUsageLimiter{client: client}, nil
}

func usageKey(scope, subject string) string {
	digest := sha256.Sum256([]byte(subject))
	return "starclouds:usage:" + scope + ":" + hex.EncodeToString(digest[:])
}

func (l *RedisUsageLimiter) Take(ctx context.Context, scope, subject string, limit, cost int64, window time.Duration) (time.Duration, bool, error) {
	if l == nil || l.client == nil || scope == "" || subject == "" || limit <= 0 || cost <= 0 || window <= 0 {
		return 0, false, fmt.Errorf("invalid usage limit")
	}
	result, err := usageScript.Run(ctx, l.client, []string{usageKey(scope, subject)}, cost, limit, window.Milliseconds()).Int64Slice()
	if err != nil {
		return 0, false, err
	}
	if len(result) != 2 {
		return 0, false, fmt.Errorf("invalid usage limiter response")
	}
	retryAfter := time.Duration(max(result[1], 0)) * time.Millisecond
	return retryAfter, result[0] == 1, nil
}

func (l *RedisUsageLimiter) Close() error {
	if l == nil || l.client == nil {
		return nil
	}
	return l.client.Close()
}

type memoryUsageEntry struct {
	value     int64
	expiresAt time.Time
}

type MemoryUsageLimiter struct {
	mu      sync.Mutex
	entries map[string]memoryUsageEntry
	now     func() time.Time
}

func NewMemoryUsageLimiter() *MemoryUsageLimiter {
	return &MemoryUsageLimiter{entries: map[string]memoryUsageEntry{}, now: time.Now}
}

func (l *MemoryUsageLimiter) Take(_ context.Context, scope, subject string, limit, cost int64, window time.Duration) (time.Duration, bool, error) {
	if l == nil || scope == "" || subject == "" || limit <= 0 || cost <= 0 || window <= 0 {
		return 0, false, fmt.Errorf("invalid usage limit")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.entries) > 4096 {
		for existingKey, existing := range l.entries {
			if !existing.expiresAt.After(now) {
				delete(l.entries, existingKey)
			}
		}
	}
	key := usageKey(scope, subject)
	entry := l.entries[key]
	if !entry.expiresAt.After(now) {
		entry = memoryUsageEntry{expiresAt: now.Add(window)}
	}
	if entry.value+cost > limit {
		l.entries[key] = entry
		return entry.expiresAt.Sub(now), false, nil
	}
	entry.value += cost
	l.entries[key] = entry
	return entry.expiresAt.Sub(now), true, nil
}

func (*MemoryUsageLimiter) Close() error { return nil }
