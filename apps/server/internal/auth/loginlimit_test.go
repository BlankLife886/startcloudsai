package auth

import (
	"testing"
	"time"
)

func newTestLimiter(now *time.Time) *LoginLimiter {
	l := NewLoginLimiter()
	l.nowFunc = func() time.Time { return *now }
	return l
}

func TestEmailLockAfterFiveFails(t *testing.T) {
	now := time.Now()
	l := newTestLimiter(&now)

	for i := 0; i < 4; i++ {
		l.Fail("a@b.com", "1.1.1.1")
		if _, allowed := l.Check("a@b.com", "1.1.1.1"); !allowed {
			t.Fatalf("第 %d 次失败后不应锁定", i+1)
		}
	}
	l.Fail("a@b.com", "1.1.1.1")
	remain, allowed := l.Check("a@b.com", "1.1.1.1")
	if allowed {
		t.Fatal("第 5 次失败后应锁定")
	}
	if remain <= 0 || remain > 15*time.Minute {
		t.Fatalf("锁定时长异常: %v", remain)
	}

	// 其他邮箱同 IP 仍可尝试（IP 阈值 20 未到）
	if _, allowed := l.Check("c@d.com", "1.1.1.1"); !allowed {
		t.Fatal("其他邮箱不应被 email 锁定波及")
	}

	// 锁定到期后恢复
	now = now.Add(16 * time.Minute)
	if _, allowed := l.Check("a@b.com", "1.1.1.1"); !allowed {
		t.Fatal("锁定到期后应恢复")
	}
}

func TestIPLockAfterTwentyFails(t *testing.T) {
	now := time.Now()
	l := newTestLimiter(&now)

	for i := 0; i < 19; i++ {
		l.Fail("u"+string(rune('a'+i%26))+"@mail.com", "9.9.9.9")
	}
	if _, allowed := l.Check("fresh@mail.com", "9.9.9.9"); !allowed {
		t.Fatal("19 次失败不应锁定 IP")
	}
	l.Fail("another@mail.com", "9.9.9.9")
	if _, allowed := l.Check("fresh@mail.com", "9.9.9.9"); allowed {
		t.Fatal("同 IP 20 次失败后应锁定该 IP（换邮箱也无效）")
	}
	// 其他 IP 不受影响
	if _, allowed := l.Check("fresh@mail.com", "8.8.8.8"); !allowed {
		t.Fatal("其他 IP 不应被波及")
	}
}

func TestSuccessResetsEmailCounter(t *testing.T) {
	now := time.Now()
	l := newTestLimiter(&now)

	for i := 0; i < 4; i++ {
		l.Fail("a@b.com", "1.1.1.1")
	}
	l.Success("a@b.com")
	for i := 0; i < 4; i++ {
		l.Fail("a@b.com", "1.1.1.1")
	}
	if _, allowed := l.Check("a@b.com", "1.1.1.1"); !allowed {
		t.Fatal("成功后计数应清零，累计 4 次失败不应锁定")
	}
}

func TestWindowExpiryResetsCounter(t *testing.T) {
	now := time.Now()
	l := newTestLimiter(&now)

	for i := 0; i < 4; i++ {
		l.Fail("a@b.com", "1.1.1.1")
	}
	now = now.Add(16 * time.Minute)
	l.Fail("a@b.com", "1.1.1.1")
	if _, allowed := l.Check("a@b.com", "1.1.1.1"); !allowed {
		t.Fatal("窗口过期后旧失败不应累计")
	}
}
