package auth

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// ConcurrencyLimiter protects expensive streaming endpoints. A lease has a
// TTL so a crashed process cannot leave a subject permanently blocked.
type ConcurrencyLimiter interface {
	Acquire(ctx context.Context, scope, subject string, limit int64, ttl time.Duration) (bool, error)
	Release(ctx context.Context, scope, subject string) error
	Close() error
}

var acquireConcurrencyScript = redis.NewScript(`
local value = tonumber(redis.call('GET', KEYS[1]) or '0')
if value >= tonumber(ARGV[1]) then return 0 end
value = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`)

var releaseConcurrencyScript = redis.NewScript(`
local value = tonumber(redis.call('GET', KEYS[1]) or '0')
if value <= 1 then redis.call('DEL', KEYS[1]); return 0 end
return redis.call('DECR', KEYS[1])
`)

type RedisConcurrencyLimiter struct{ client *redis.Client }

func NewRedisConcurrencyLimiter(redisURL string) (*RedisConcurrencyLimiter, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis concurrency limiter URL: %w", err)
	}
	opts.PoolSize = 8
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect redis concurrency limiter: %w", err)
	}
	return &RedisConcurrencyLimiter{client: client}, nil
}

func (l *RedisConcurrencyLimiter) Acquire(ctx context.Context, scope, subject string, limit int64, ttl time.Duration) (bool, error) {
	if l == nil || l.client == nil || scope == "" || subject == "" || limit <= 0 || ttl <= 0 {
		return false, fmt.Errorf("invalid concurrency limit")
	}
	result, err := acquireConcurrencyScript.Run(ctx, l.client, []string{usageKey("concurrency:"+scope, subject)}, limit, ttl.Milliseconds()).Int()
	return result == 1, err
}

func (l *RedisConcurrencyLimiter) Release(ctx context.Context, scope, subject string) error {
	if l == nil || l.client == nil || scope == "" || subject == "" {
		return nil
	}
	return releaseConcurrencyScript.Run(ctx, l.client, []string{usageKey("concurrency:"+scope, subject)}).Err()
}

func (l *RedisConcurrencyLimiter) Close() error { return l.client.Close() }

type MemoryConcurrencyLimiter struct {
	mu      sync.Mutex
	entries map[string]int64
}

func NewMemoryConcurrencyLimiter() *MemoryConcurrencyLimiter {
	return &MemoryConcurrencyLimiter{entries: map[string]int64{}}
}

func (l *MemoryConcurrencyLimiter) Acquire(_ context.Context, scope, subject string, limit int64, _ time.Duration) (bool, error) {
	if l == nil || scope == "" || subject == "" || limit <= 0 {
		return false, fmt.Errorf("invalid concurrency limit")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	key := usageKey("concurrency:"+scope, subject)
	if l.entries[key] >= limit {
		return false, nil
	}
	l.entries[key]++
	return true, nil
}

func (l *MemoryConcurrencyLimiter) Release(_ context.Context, scope, subject string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := usageKey("concurrency:"+scope, subject)
	if l.entries[key] <= 1 {
		delete(l.entries, key)
	} else {
		l.entries[key]--
	}
	return nil
}

func (*MemoryConcurrencyLimiter) Close() error { return nil }
