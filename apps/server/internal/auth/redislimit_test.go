package auth

import (
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// unreachableLimiter 指向一个不会有人监听的端口，用来模拟 Redis 故障。
func unreachableLimiter() *RedisLimiter {
	return &RedisLimiter{
		client:    redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", DialTimeout: 50 * time.Millisecond}),
		namespace: "user-login",
		policy: limiterPolicy{
			emailMaxFails: 5, emailLockDur: 15 * time.Minute,
			ipMaxFails: 20, ipLockDur: time.Hour, window: 15 * time.Minute,
		},
	}
}

// Redis 抖动不能变成全站登录故障：Check 只负责读取"是否已被锁定"，读不到时必须
// 放行。每封验证码在 Postgres 事务里仍然最多只允许 5 次尝试，爆破防护不依赖这层。
func TestRedisLimiterCheckAllowsWhenRedisIsDown(t *testing.T) {
	l := unreachableLimiter()
	defer l.Close()

	remain, allowed := l.Check("user@gmail.com", "203.0.113.7")
	if !allowed {
		t.Fatalf("Redis 故障时登录被拦住了，剩余锁定 %v", remain)
	}
}

// 相对地，Reserve 会写入计数，Redis 不可用时无法保证配额，继续保持 fail-closed。
func TestRedisLimiterReserveStaysClosedWhenRedisIsDown(t *testing.T) {
	l := unreachableLimiter()
	defer l.Close()

	if _, allowed := l.Reserve("admin@gmail.com", "203.0.113.7"); allowed {
		t.Fatal("Redis 故障时 Reserve 不应放行")
	}
}
