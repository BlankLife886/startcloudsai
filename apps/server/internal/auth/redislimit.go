package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type AttemptLimiter interface {
	Check(email, ip string) (time.Duration, bool)
	Reserve(email, ip string) (time.Duration, bool)
	Fail(email, ip string)
	Success(email string)
	SuccessAttempt(email, ip string)
}

var reserveScript = redis.NewScript(`
local email_ttl = redis.call('PTTL', KEYS[2])
local ip_ttl = redis.call('PTTL', KEYS[4])
if email_ttl > 0 or ip_ttl > 0 then
  if email_ttl > ip_ttl then return email_ttl else return ip_ttl end
end
if ARGV[4] == '1' then
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  if count >= tonumber(ARGV[2]) then redis.call('SET', KEYS[2], '1', 'PX', ARGV[3]); redis.call('DEL', KEYS[1]) end
end
if ARGV[8] == '1' then
  local count = redis.call('INCR', KEYS[3])
  if count == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[5]) end
  if count >= tonumber(ARGV[6]) then redis.call('SET', KEYS[4], '1', 'PX', ARGV[7]); redis.call('DEL', KEYS[3]) end
end
return 0
`)

type RedisLimiter struct {
	client    *redis.Client
	namespace string
	policy    limiterPolicy
}

type limiterPolicy struct {
	emailMaxFails int
	emailLockDur  time.Duration
	ipMaxFails    int
	ipLockDur     time.Duration
	window        time.Duration
}

var failScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
if count >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
end
return count
`)

func NewRedisLoginLimiter(redisURL, namespace string, redeem bool) (*RedisLimiter, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	opts.PoolSize = 4
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect redis limiter: %w", err)
	}
	policy := limiterPolicy{emailMaxFails: 5, emailLockDur: 15 * time.Minute, ipMaxFails: 20, ipLockDur: time.Hour, window: 15 * time.Minute}
	if redeem {
		policy = limiterPolicy{emailMaxFails: 10, emailLockDur: time.Hour, ipMaxFails: 100, ipLockDur: time.Hour, window: time.Hour}
	}
	return &RedisLimiter{client: client, namespace: namespace, policy: policy}, nil
}

func (l *RedisLimiter) Close() error { return l.client.Close() }

func (l *RedisLimiter) key(kind, value, suffix string) string {
	digest := sha256.Sum256([]byte(value))
	return "starclouds:limit:" + l.namespace + ":" + kind + ":" + hex.EncodeToString(digest[:]) + ":" + suffix
}

func (l *RedisLimiter) Check(email, ip string) (time.Duration, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	keys := make([]string, 0, 2)
	if email != "" {
		keys = append(keys, l.key("email", email, "lock"))
	}
	if ip != "" {
		keys = append(keys, l.key("ip", ip, "lock"))
	}
	if len(keys) == 0 {
		return 0, true
	}
	pipe := l.client.Pipeline()
	cmds := make([]*redis.DurationCmd, 0, len(keys))
	for _, key := range keys {
		cmds = append(cmds, pipe.PTTL(ctx, key))
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		log.Printf("redis limiter check failed: %v", err)
		return time.Minute, false
	}
	var longest time.Duration
	for _, cmd := range cmds {
		if ttl := cmd.Val(); ttl > longest {
			longest = ttl
		}
	}
	return longest, longest <= 0
}

func (l *RedisLimiter) Reserve(email, ip string) (time.Duration, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := reserveScript.Run(ctx, l.client, []string{
		l.key("email", email, "count"), l.key("email", email, "lock"), l.key("ip", ip, "count"), l.key("ip", ip, "lock"),
	}, l.policy.window.Milliseconds(), l.policy.emailMaxFails, l.policy.emailLockDur.Milliseconds(), boolInt(email != ""),
		l.policy.window.Milliseconds(), l.policy.ipMaxFails, l.policy.ipLockDur.Milliseconds(), boolInt(ip != "")).Int64()
	if err != nil {
		log.Printf("redis limiter reserve failed: %v", err)
		return time.Minute, false
	}
	if result > 0 {
		return time.Duration(result) * time.Millisecond, false
	}
	return 0, true
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (l *RedisLimiter) failOne(ctx context.Context, kind, value string, maxFails int, lockDur time.Duration) error {
	if value == "" {
		return nil
	}
	return failScript.Run(ctx, l.client,
		[]string{l.key(kind, value, "count"), l.key(kind, value, "lock")},
		l.policy.window.Milliseconds(), maxFails, lockDur.Milliseconds()).Err()
}

func (l *RedisLimiter) Fail(email, ip string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := l.failOne(ctx, "email", email, l.policy.emailMaxFails, l.policy.emailLockDur); err != nil {
		log.Printf("redis limiter email update failed: %v", err)
	}
	if err := l.failOne(ctx, "ip", ip, l.policy.ipMaxFails, l.policy.ipLockDur); err != nil {
		log.Printf("redis limiter IP update failed: %v", err)
	}
}

func (l *RedisLimiter) Success(email string) {
	if email == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := l.client.Del(ctx, l.key("email", email, "count"), l.key("email", email, "lock")).Err(); err != nil {
		log.Printf("redis limiter reset failed: %v", err)
	}
}

func (l *RedisLimiter) SuccessAttempt(email, ip string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	keys := []string{l.key("email", email, "count"), l.key("email", email, "lock")}
	if ip != "" {
		keys = append(keys, l.key("ip", ip, "count"), l.key("ip", ip, "lock"))
	}
	if err := l.client.Del(ctx, keys...).Err(); err != nil {
		log.Printf("redis limiter success update failed: %v", err)
	}
}
