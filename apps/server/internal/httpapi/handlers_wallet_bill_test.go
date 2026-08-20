package httpapi

import (
	"context"
	"encoding/csv"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func insertLedger(t *testing.T, env *communityEnv, userID uuid.UUID, kind, sourceType string, delta int64, sourceID, reason string) {
	t.Helper()
	if _, err := env.st.Pool.Exec(context.Background(),
		`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason)
		 VALUES ($1, $2, $3, 0, $4, $5, $6)`,
		userID, kind, delta, sourceType, sourceID, reason); err != nil {
		t.Fatalf("insert ledger %s/%s: %v", kind, sourceType, err)
	}
}

func TestWalletSummaryGroupsIncomeAndConsumedPoints(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, token := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	taskID := env.newSucceededTask(t, user.ID)

	insertLedger(t, env, user.ID, "grant", "daily_checkin", 10, user.ID.String()+":2026-08-01", "签到奖励")
	insertLedger(t, env, user.ID, "grant", "daily_checkin", 15, user.ID.String()+":2026-08-02", "签到奖励")
	insertLedger(t, env, user.ID, "grant", "trial_access", 200, uuid.NewString(), "体验积分")
	insertLedger(t, env, user.ID, "grant", "usage_milestone", 50, uuid.NewString(), "激励积分")
	insertLedger(t, env, user.ID, "grant", "growth_group", 30, uuid.NewString(), "拼团积分")
	insertLedger(t, env, user.ID, "grant", "feedback_adoption", 80, uuid.NewString(), "建议采纳")
	insertLedger(t, env, user.ID, "grant", "task_failure_bonus", 8, uuid.NewString(), "失败补偿")
	insertLedger(t, env, user.ID, "grant", "redeem_code", 100, uuid.NewString(), "兑换码")
	insertLedger(t, env, user.ID, "spend", "task", 0, taskID.String(), "任务结算：消耗冻结 20 分")
	insertLedger(t, env, user.ID, "release", "task", 12, taskID.String()+"/1", "任务失败解冻")
	insertLedger(t, env, user.ID, "admin_adjust", "admin", -5, uuid.NewString(), "人工扣减")

	anonymous := env.do(t, http.MethodGet, "/api/v1/me/wallet/summary", nil, "")
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous summary status=%d body=%s", anonymous.Code, anonymous.Body.String())
	}

	w := env.do(t, http.MethodGet, "/api/v1/me/wallet/summary", nil, token)
	data, _ := decode(t, w)
	if w.Code != http.StatusOK {
		t.Fatalf("summary status=%d body=%s", w.Code, w.Body.String())
	}
	if data["consumedCents"] != float64(25) || data["consumedCount"] != float64(2) {
		t.Fatalf("consumed = %#v count=%#v", data["consumedCents"], data["consumedCount"])
	}
	if data["refundCents"] != float64(12) || data["incomeCents"] != float64(493) {
		t.Fatalf("refund=%#v income=%#v", data["refundCents"], data["incomeCents"])
	}

	got := map[string][2]float64{}
	items, _ := data["items"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		id, _ := item["id"].(string)
		got[id] = [2]float64{item["cents"].(float64), item["count"].(float64)}
	}
	want := map[string][2]float64{
		"daily_checkin":      {25, 2},
		"usage_milestone":    {50, 1},
		"growth_group":       {30, 1},
		"feedback_adoption":  {80, 1},
		"task_failure_bonus": {8, 1},
		"redeem_code":        {100, 1},
	}
	for id, pair := range want {
		if got[id] != pair {
			t.Fatalf("%s = %#v, want %#v (all=%#v)", id, got[id], pair, got)
		}
	}
	if _, ok := got["trial_access"]; ok {
		t.Fatalf("trial_access should be omitted from summary items: %#v", got)
	}
}

func TestWalletExportWritesSummaryAndLedgerCSV(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, token := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	insertLedger(t, env, user.ID, "grant", "daily_checkin", 25, uuid.NewString(), "连续签到奖励")

	anonymous := env.do(t, http.MethodGet, "/api/v1/me/wallet/export", nil, "")
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous export status=%d", anonymous.Code)
	}

	w := env.do(t, http.MethodGet, "/api/v1/me/wallet/export", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("export status=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("content-type = %s", w.Header().Get("Content-Type"))
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), "starclouds-wallet-") {
		t.Fatalf("disposition = %s", w.Header().Get("Content-Disposition"))
	}
	body := strings.TrimPrefix(w.Body.String(), "\ufeff")
	reader := csv.NewReader(strings.NewReader(body))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if !strings.Contains(body, "签到积分") || !strings.Contains(body, "合计消耗") || !strings.Contains(body, "连续签到奖励") {
		t.Fatalf("csv missing expected labels: %s", body)
	}
	if len(records) < 8 {
		t.Fatalf("csv rows = %d, body=%s", len(records), w.Body.String())
	}
}

func TestWalletLedgerSupportsPageAndTotal(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, token := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	insertLedger(t, env, user.ID, "grant", "daily_checkin", 10, uuid.NewString(), "a")
	insertLedger(t, env, user.ID, "grant", "daily_checkin", 20, uuid.NewString(), "b")
	insertLedger(t, env, user.ID, "grant", "redeem_code", 30, uuid.NewString(), "c")

	invalid := env.do(t, http.MethodGet, "/api/v1/me/wallet/entries?page=0&limit=2", nil, token)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid page status=%d body=%s", invalid.Code, invalid.Body.String())
	}

	first := env.do(t, http.MethodGet, "/api/v1/me/wallet/entries?page=1&limit=2", nil, token)
	firstData, _ := decode(t, first)
	if first.Code != http.StatusOK || firstData["total"] != float64(3) || firstData["page"] != float64(1) {
		t.Fatalf("page1 status=%d data=%#v", first.Code, firstData)
	}
	if items, _ := firstData["items"].([]any); len(items) != 2 {
		t.Fatalf("page1 items = %#v", firstData["items"])
	}

	second := env.do(t, http.MethodGet, "/api/v1/me/wallet/entries?page=2&limit=2", nil, token)
	secondData, _ := decode(t, second)
	if second.Code != http.StatusOK || secondData["page"] != float64(2) {
		t.Fatalf("page2 status=%d data=%#v", second.Code, secondData)
	}
	if items, _ := secondData["items"].([]any); len(items) != 1 {
		t.Fatalf("page2 items = %#v", secondData["items"])
	}
}
