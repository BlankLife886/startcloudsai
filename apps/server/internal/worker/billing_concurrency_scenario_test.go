package worker

import (
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

func (e *billingScenario) hold() { e.mu.Lock(); e.gate = make(chan struct{}); e.mu.Unlock() }
func (e *billingScenario) release() {
	e.mu.Lock()
	if e.gate != nil {
		close(e.gate)
		e.gate = nil
	}
	e.mu.Unlock()
}
func (e *billingScenario) waitActive(want int) {
	e.t.Helper()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		e.mu.Lock()
		n := e.active
		e.mu.Unlock()
		if n == want {
			return
		}
		select {
		case <-e.ctx.Done():
			e.t.Fatal(e.ctx.Err())
		case <-deadline.C:
			e.t.Fatalf("only %d model requests active; wanted %d", n, want)
		case <-tick.C:
		}
	}
}
func (e *billingScenario) executeTogether(ids []uuid.UUID) ([]*store.AssistantRun, func()) {
	e.t.Helper()
	var claims, finished sync.WaitGroup
	var mu sync.Mutex
	claimed := []*store.AssistantRun{}
	errs := []error{}
	start := make(chan struct{})
	claims.Add(len(ids))
	finished.Add(len(ids))
	for _, id := range ids {
		go func(id uuid.UUID) {
			defer finished.Done()
			<-start
			run, err := e.worker.claimAssistantRun(e.ctx, id, "parallel-"+uuid.NewString())
			mu.Lock()
			if err != nil {
				errs = append(errs, err)
			}
			if run != nil {
				claimed = append(claimed, run)
			}
			mu.Unlock()
			claims.Done()
			if err == nil && run != nil {
				if err = e.worker.executeAssistantRun(e.ctx, run); err != nil {
					mu.Lock()
					errs = append(errs, err)
					mu.Unlock()
				}
			}
		}(id)
	}
	close(start)
	claims.Wait()
	return claimed, func() {
		finished.Wait()
		mu.Lock()
		defer mu.Unlock()
		for _, err := range errs {
			e.t.Error(err)
		}
	}
}

func TestBillingScenarioMultiUser(t *testing.T) {
	e := newBillingScenario(t)
	users := []scenarioAccount{e.account("普通用户"), e.account("订阅加2用户"), e.account("订阅加4用户")}
	limits := []int{4, 6, 8}
	e.pack(users[0], false)
	e.buy(users[1], e.plan("并发加2", 1990, 100, 1, 2, true, false))
	e.buy(users[2], e.plan("并发加4", 3990, 100, 2, 4, true, false))
	ids := []uuid.UUID{}
	for i, a := range users {
		for j := 0; j < limits[i]+2; j++ {
			workspace := modelconfig.WorkspaceAssistant
			if j%2 == 1 {
				workspace = modelconfig.WorkspaceCanvas
			}
			ids = append(ids, e.queueRun(a, workspace))
		}
	}
	e.hold()
	claimed, finish := e.executeTogether(ids)
	defer func(done func()) { e.release(); done() }(finish)
	e.waitActive(12)
	for i, a := range users {
		account, err := store.GetUserConcurrency(e.ctx, e.st.Pool, a.ID)
		if err != nil {
			e.release()
			finish()
			t.Fatal(err)
		}
		scenarioCheck(t, a.Name+"生图额度保留订阅加成", limits[i], account.ImageLimit)
		scenarioCheck(t, a.Name+"对话额度独立", 4, account.ChatLimit)
		scenarioCheck(t, a.Name+"数据库对话运行数", int64(4), account.ChatRunning)
		scenarioCheck(t, a.Name+"对话不占生图名额", int64(0), account.ImageRunning)
		e.mu.Lock()
		peak := e.peakUsers[a.ID.String()]
		e.mu.Unlock()
		scenarioCheck(t, a.Name+"实际对话请求并发峰值", 4, peak)
	}
	scenarioCheck(t, "三个用户各占满四个对话名额", 12, len(claimed))
	var cancelled uuid.UUID
	for _, id := range ids {
		run, _ := store.GetAssistantRun(e.ctx, e.st.Pool, id)
		if run.UserID == users[0].ID && run.Status == "queued" {
			cancelled = id
			break
		}
	}
	if cancelled == uuid.Nil {
		e.release()
		finish()
		t.Fatal("missing queued normal-user run")
	}
	e.must("PATCH", "/api/v1/assistant/runs/"+cancelled.String(), users[0].Token, map[string]any{"status": "canceled"})
	e.release()
	finish()
	for _, id := range ids {
		run, _ := store.GetAssistantRun(e.ctx, e.st.Pool, id)
		if run.Status == "queued" {
			next, err := e.worker.claimAssistantRun(e.ctx, id, "drain-"+uuid.NewString())
			if err != nil || next == nil {
				t.Fatalf("drain=%v", err)
			}
			if err = e.worker.executeAssistantRun(e.ctx, next); err != nil {
				t.Fatal(err)
			}
		}
	}
	for i, a := range users {
		var settled int64
		if err := e.st.Pool.QueryRow(e.ctx, `SELECT COALESCE(sum(cost_cents),0) FROM assistant_runs WHERE user_id=$1`, a.ID).Scan(&settled); err != nil {
			t.Fatal(err)
		}
		wallet, err := store.GetWallet(e.ctx, e.st.Pool, a.ID)
		if err != nil {
			t.Fatal(err)
		}
		count := limits[i] + 2
		if i == 0 {
			count--
		}
		scenarioCheck(t, a.Name+"实际结算积分", int64(count*3), settled)
		scenarioCheck(t, a.Name+"完成后钱包无残留冻结", int64(0), wallet.FrozenCents+wallet.SubscriptionFrozenCents+wallet.TrialFrozenCents)
	}
	additional := []uuid.UUID{}
	for range 6 {
		additional = append(additional, e.queueRun(users[2], modelconfig.WorkspaceAssistant))
	}
	e.hold()
	_, finish = e.executeTogether(additional)
	defer func(done func()) { e.release(); done() }(finish)
	e.waitActive(4)
	extra, status, _ := e.queue(users[2], modelconfig.WorkspaceAssistant, false)
	e.release()
	finish()
	scenarioCheck(t, "生图订阅8名额不能绕过对话4名额限制", 409, status)
	for _, id := range additional {
		run, err := store.GetAssistantRun(e.ctx, e.st.Pool, id)
		if err != nil {
			t.Fatal(err)
		}
		if run.Status == "queued" {
			claimed, err := e.worker.claimAssistantRun(e.ctx, id, "finish-queued")
			if err != nil || claimed == nil {
				t.Fatalf("remaining chat claim=%v", err)
			}
			if err := e.worker.executeAssistantRun(e.ctx, claimed); err != nil {
				t.Fatal(err)
			}
		}
	}
	if extra != uuid.Nil {
		run, err := e.worker.claimAssistantRun(e.ctx, extra, "extra")
		if err != nil || run == nil {
			t.Fatalf("extra claim=%v", err)
		}
		if err = e.worker.executeAssistantRun(e.ctx, run); err != nil {
			t.Fatal(err)
		}
	}
}
