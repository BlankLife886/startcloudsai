package auth

import (
	"fmt"
	"sync"
	"time"
)

// LoginLimiter 登录防爆破限制器（进程内存实现，适用于单实例部署）。
//
// 策略：
//   - 同一邮箱连续失败 emailMaxFails 次 → 锁定 emailLockDur；
//   - 同一 IP 在滑动窗口内失败 ipMaxFails 次 → 锁定 ipLockDur；
//   - 登录成功清零对应邮箱计数（IP 计数保留，防止换号爆破）。
type LoginLimiter struct {
	mu      sync.Mutex
	emails  map[string]*limitEntry
	ips     map[string]*limitEntry
	lastGC  time.Time
	nowFunc func() time.Time

	emailMaxFails int
	emailLockDur  time.Duration
	ipMaxFails    int
	ipLockDur     time.Duration
	window        time.Duration
}

type limitEntry struct {
	fails       int
	windowStart time.Time
	lockedUntil time.Time
}

func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{
		emails:        make(map[string]*limitEntry),
		ips:           make(map[string]*limitEntry),
		nowFunc:       time.Now,
		emailMaxFails: 5,
		emailLockDur:  15 * time.Minute,
		ipMaxFails:    20,
		ipLockDur:     time.Hour,
		window:        15 * time.Minute,
	}
}

// NewRedeemLimiter 兑换码防爆破：单用户 1 小时内失败 10 次锁 1 小时
// （key 用用户 id，IP 维度不启用——调用方传空串）。
func NewRedeemLimiter() *LoginLimiter {
	return &LoginLimiter{
		emails:        make(map[string]*limitEntry),
		ips:           make(map[string]*limitEntry),
		nowFunc:       time.Now,
		emailMaxFails: 10,
		emailLockDur:  time.Hour,
		ipMaxFails:    100,
		ipLockDur:     time.Hour,
		window:        time.Hour,
	}
}

// Check 返回 nil 表示允许尝试登录；否则返回剩余锁定时长。
func (l *LoginLimiter) Check(email, ip string) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.nowFunc()
	l.gcLocked(now)
	for _, e := range []*limitEntry{l.emails[email], l.ips[ip]} {
		if e != nil && now.Before(e.lockedUntil) {
			return e.lockedUntil.Sub(now), false
		}
	}
	return 0, true
}

// Reserve atomically checks the lock and records the attempt, preventing a
// concurrent burst from passing between separate Check and Fail calls.
func (l *LoginLimiter) Reserve(email, ip string) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.nowFunc()
	l.gcLocked(now)
	for _, e := range []*limitEntry{l.emails[email], l.ips[ip]} {
		if e != nil && now.Before(e.lockedUntil) {
			return e.lockedUntil.Sub(now), false
		}
	}
	l.bump(l.emails, email, now, l.emailMaxFails, l.emailLockDur)
	l.bump(l.ips, ip, now, l.ipMaxFails, l.ipLockDur)
	return 0, true
}

// Fail 记录一次失败尝试。
func (l *LoginLimiter) Fail(email, ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.nowFunc()
	l.bump(l.emails, email, now, l.emailMaxFails, l.emailLockDur)
	l.bump(l.ips, ip, now, l.ipMaxFails, l.ipLockDur)
}

// Success 登录成功，清零该邮箱的失败计数。
func (l *LoginLimiter) Success(email string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.emails, email)
}

func (l *LoginLimiter) SuccessAttempt(email, ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.emails, email)
	if ip != "" {
		delete(l.ips, ip)
	}
}

func (l *LoginLimiter) bump(m map[string]*limitEntry, key string, now time.Time, maxFails int, lockDur time.Duration) {
	if key == "" {
		return
	}
	e := m[key]
	if e == nil || now.Sub(e.windowStart) > l.window {
		e = &limitEntry{windowStart: now}
		m[key] = e
	}
	e.fails++
	if e.fails >= maxFails {
		e.lockedUntil = now.Add(lockDur)
		e.fails = 0
		e.windowStart = now
	}
}

// gcLocked 清理过期条目，最多每分钟一次。
func (l *LoginLimiter) gcLocked(now time.Time) {
	if now.Sub(l.lastGC) < time.Minute {
		return
	}
	l.lastGC = now
	for _, m := range []map[string]*limitEntry{l.emails, l.ips} {
		for key, e := range m {
			if now.Sub(e.windowStart) > l.window && !now.Before(e.lockedUntil) {
				delete(m, key)
			}
		}
	}
}

// LockMessage 生成用户可读的锁定提示。
func LockMessage(d time.Duration) string {
	minutes := int(d.Minutes()) + 1
	return fmt.Sprintf("尝试次数过多，请 %d 分钟后再试", minutes)
}
