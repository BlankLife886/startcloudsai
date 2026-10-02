package assistantproactive

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

type activity struct {
	t    *testing.T
	ctx  context.Context
	st   *store.Store
	user uuid.UUID
}

func newActivity(t *testing.T, balance int64) *activity {
	t.Helper()
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("a-%s@test.dev", uuid.NewString()[:8]), "u", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if balance > 0 {
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			_, err := wallet.Grant(ctx, tx, user.ID, balance, "grant", "signup_bonus", user.ID.String(), nil)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	return &activity{t: t, ctx: ctx, st: st, user: user.ID}
}

// task records one finished generation and, when it succeeded, its spend.
func (a *activity) task(at time.Time, status string, cost int64) {
	a.t.Helper()
	var id uuid.UUID
	if err := a.st.Pool.QueryRow(a.ctx, `INSERT INTO tasks (user_id, type, status, prompt, count, output_keys, cost_cents, created_at, started_at, finished_at)
		VALUES ($1, 'ecommerce_design', $2, 'x', 1, '[]', $3, $4, $4, $4) RETURNING id`, a.user, status, cost, at).Scan(&id); err != nil {
		a.t.Fatal(err)
	}
	if status == "succeeded" && cost > 0 {
		if _, err := a.st.Pool.Exec(a.ctx, `INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
			VALUES ($1, 'spend', $2, 0, 'task', $3, $4)`, a.user, -cost, id.String(), at); err != nil {
			a.t.Fatal(err)
		}
	}
}

func (a *activity) inboxMessages() []*store.AssistantMessage {
	a.t.Helper()
	var id *uuid.UUID
	if err := a.st.Pool.QueryRow(a.ctx, `SELECT inbox_conversation_id FROM assistant_proactive_settings WHERE user_id = $1`, a.user).Scan(&id); err != nil || id == nil {
		return nil
	}
	messages, err := store.ListAssistantMessages(a.ctx, a.st.Pool, *id, 50)
	if err != nil {
		a.t.Fatal(err)
	}
	return messages
}

// 2026-10-02 14:00 in Shanghai.
var afternoon = time.Date(2026, 10, 2, 6, 0, 0, 0, time.UTC)

func TestAlertsFireOncePerDayIntoTheInbox(t *testing.T) {
	a := newActivity(t, 30)
	// Last week: 70 points in total, a 10-point daily average.
	for day := 1; day <= 7; day++ {
		a.task(afternoon.AddDate(0, 0, -day), "succeeded", 10)
	}
	// Today: 300 points, and 3 failures out of 6.
	for index := 0; index < 3; index++ {
		a.task(afternoon.Add(-time.Duration(index+1)*time.Hour), "succeeded", 100)
		a.task(afternoon.Add(-time.Duration(index+1)*time.Hour), "failed", 0)
	}

	sent, err := SendAlerts(a.ctx, a.st, afternoon)
	if err != nil {
		t.Fatal(err)
	}
	messages := a.inboxMessages()
	if sent != 3 || len(messages) != 3 {
		t.Fatalf("sent = %d messages = %d", sent, len(messages))
	}
	joined := ""
	for _, message := range messages {
		joined += message.Content + "\n"
	}
	for _, want := range []string{"可用 30 积分", "已经消耗 300 积分", "日均（10 积分）的 30.0 倍", "6 次生成里有 3 次失败（50%）"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in:\n%s", want, joined)
		}
	}
	var bell int
	if err := a.st.Pool.QueryRow(a.ctx, `SELECT count(*) FROM notifications WHERE user_id = $1 AND kind = 'assistant'`, a.user).Scan(&bell); err != nil || bell != 3 {
		t.Fatalf("bell = %d %v", bell, err)
	}

	// Later the same day nothing repeats; the next day they can fire again.
	if sent, _ := SendAlerts(a.ctx, a.st, afternoon.Add(3*time.Hour)); sent != 0 {
		t.Fatalf("repeated the same day: %d", sent)
	}
	// The user deleted the inbox: the next alert creates a new one.
	if _, err := a.st.Pool.Exec(a.ctx, `DELETE FROM assistant_conversations WHERE user_id = $1`, a.user); err != nil {
		t.Fatal(err)
	}
	a.task(afternoon.Add(20*time.Hour), "succeeded", 1)
	if sent, err := SendAlerts(a.ctx, a.st, afternoon.Add(21*time.Hour)); err != nil || sent == 0 || len(a.inboxMessages()) == 0 {
		t.Fatalf("next day: sent = %d err = %v", sent, err)
	}
}

func TestAlertsRespectTheSwitchAndQuietUsers(t *testing.T) {
	a := newActivity(t, 30)
	a.task(afternoon.Add(-time.Hour), "succeeded", 5)
	off := false
	if _, err := Update(a.ctx, a.st.Pool, a.user, Patch{Alerts: &off}); err != nil {
		t.Fatal(err)
	}
	if sent, err := SendAlerts(a.ctx, a.st, afternoon); err != nil || sent != 0 {
		t.Fatalf("sent while off: %d %v", sent, err)
	}

	// A healthy, normal day raises nothing.
	b := newActivity(t, 1000)
	for day := 0; day <= 7; day++ {
		b.task(afternoon.AddDate(0, 0, -day).Add(-time.Hour), "succeeded", 20)
	}
	if findings, err := Evaluate(b.ctx, b.st, b.user, afternoon); err != nil || len(findings) != 0 {
		t.Fatalf("findings = %+v %v", findings, err)
	}
}

func TestReportsAreSentOncePerPeriodAfterNine(t *testing.T) {
	a := newActivity(t, 1000)
	weekly := ReportWeekly
	if _, err := Update(a.ctx, a.st.Pool, a.user, Patch{ReportSchedule: &weekly}); err != nil {
		t.Fatal(err)
	}
	// 2026-10-05 is a Monday; the report covers 2026-09-28 to 2026-10-04.
	monday := time.Date(2026, 10, 5, 0, 30, 0, 0, time.UTC) // 08:30 Shanghai
	a.task(time.Date(2026, 9, 30, 4, 0, 0, 0, time.UTC), "succeeded", 120)
	a.task(time.Date(2026, 10, 1, 4, 0, 0, 0, time.UTC), "succeeded", 60)
	a.task(time.Date(2026, 9, 24, 4, 0, 0, 0, time.UTC), "succeeded", 90)

	if sent, err := SendReports(a.ctx, a.st, monday); err != nil || sent != 0 {
		t.Fatalf("sent before nine: %d %v", sent, err)
	}
	if sent, err := SendReports(a.ctx, a.st, monday.Add(time.Hour)); err != nil || sent != 1 {
		t.Fatalf("sent at nine: %d %v", sent, err)
	}
	messages := a.inboxMessages()
	if len(messages) != 1 {
		t.Fatalf("messages = %d", len(messages))
	}
	text := messages[0].Content
	for _, want := range []string{"周报", "2026-09-28 至 2026-10-04", "共消耗 180 积分（比上一期多 100%）", "创作 2 次"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in %s", want, text)
		}
	}
	views, _ := messages[0].Metadata["dataViews"].([]any)
	if len(views) != 1 || views[0].(map[string]any)["view"] != "stats" {
		t.Fatalf("views = %#v", messages[0].Metadata["dataViews"])
	}
	// Same week again: nothing; settings keep the time it was sent.
	if sent, _ := SendReports(a.ctx, a.st, monday.Add(5*time.Hour)); sent != 0 {
		t.Fatal("sent the same week twice")
	}
	if got, _ := Get(a.ctx, a.st.Pool, a.user); got.ReportLastSentAt == nil {
		t.Fatal("last sent time not kept")
	}
}

func TestReportPeriods(t *testing.T) {
	loc := mustLocation()
	sunday := time.Date(2026, 10, 4, 10, 0, 0, 0, loc)
	if _, _, ok := reportPeriod(ReportWeekly, sunday); ok {
		t.Fatal("weekly report due on a Sunday")
	}
	if _, start, ok := reportPeriod(ReportWeekly, sunday.AddDate(0, 0, 1)); !ok || start.Format("2006-01-02") != "2026-09-28" {
		t.Fatalf("weekly on Monday = %s %v", start, ok)
	}
	if _, start, _ := reportPeriod(ReportDaily, sunday); start.Format("2006-01-02") != "2026-10-03" {
		t.Fatalf("daily = %s", start)
	}
	if _, _, ok := reportPeriod(ReportOff, sunday); ok {
		t.Fatal("off has a period")
	}
}
