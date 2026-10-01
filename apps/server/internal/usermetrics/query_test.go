package usermetrics

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

type fixture struct {
	t   *testing.T
	st  *store.Store
	ctx context.Context
}

func (f fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.st.Pool.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("exec %q: %v", strings.SplitN(strings.TrimSpace(sql), "\n", 2)[0], err)
	}
}

func (f fixture) user(name string) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO users (email, username, password_hash, role, status)
		VALUES ($1, $2, 'x', 'user', 'active') RETURNING id`, name+"@example.com", name).Scan(&id); err != nil {
		f.t.Fatalf("insert user: %v", err)
	}
	return id
}

// task inserts a finished image task and returns its id.
func (f fixture) task(user uuid.UUID, kind, model, status string, at time.Time, images int, seconds int, cost int64, params string) uuid.UUID {
	f.t.Helper()
	outputs := "[]"
	if images > 0 {
		keys := make([]string, images)
		for index := range keys {
			keys[index] = `"k` + uuid.NewString() + `.png"`
		}
		outputs = "[" + strings.Join(keys, ",") + "]"
	}
	if params == "" {
		params = "{}"
	}
	var id uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO tasks (user_id, type, status, prompt, params, count, output_keys, cost_cents, model,
			created_at, started_at, finished_at)
		VALUES ($1, $2, $3, 'p', $4::jsonb, 1, $5::jsonb, $6, $7, $8::timestamptz, $8::timestamptz, $8::timestamptz + make_interval(secs => $9::int))
		RETURNING id`, user, kind, status, params, outputs, cost, model, at, seconds).Scan(&id); err != nil {
		f.t.Fatalf("insert task: %v", err)
	}
	return id
}

func (f fixture) ledger(user uuid.UUID, kind string, delta int64, sourceType, sourceID string, at time.Time) {
	f.t.Helper()
	var source any
	if sourceID != "" {
		source = sourceID
	}
	f.exec(`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
		VALUES ($1, $2, $3, 0, $4, $5, $6)`, user, kind, delta, sourceType, source, at)
}

func (f fixture) assistantRun(user uuid.UUID, status string, at time.Time, images int, model string) uuid.UUID {
	f.t.Helper()
	var conversation, userMessage, assistantMessage, run uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO assistant_conversations (user_id) VALUES ($1) RETURNING id`, user).Scan(&conversation); err != nil {
		f.t.Fatalf("insert conversation: %v", err)
	}
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO assistant_messages (conversation_id, role) VALUES ($1, 'user') RETURNING id`, conversation).Scan(&userMessage); err != nil {
		f.t.Fatalf("insert user message: %v", err)
	}
	imageList := make([]string, images)
	for index := range imageList {
		imageList[index] = `{"fileKey":"a` + uuid.NewString() + `"}`
	}
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO assistant_messages (conversation_id, role, kind, metadata)
		VALUES ($1, 'assistant', 'image', jsonb_build_object('images', $2::jsonb)) RETURNING id`,
		conversation, "["+strings.Join(imageList, ",")+"]").Scan(&assistantMessage); err != nil {
		f.t.Fatalf("insert assistant message: %v", err)
	}
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO assistant_runs (user_id, conversation_id, user_message_id, assistant_message_id,
			mode, status, prompt, params, created_at, started_at, finished_at)
		VALUES ($1, $2, $3, $4, 'image', $5, 'p', jsonb_build_object('_modelDisplayName', $6::text), $7::timestamptz, $7::timestamptz, $7::timestamptz + interval '20 seconds')
		RETURNING id`, user, conversation, userMessage, assistantMessage, status, model, at).Scan(&run); err != nil {
		f.t.Fatalf("insert assistant run: %v", err)
	}
	return run
}

func setup(t *testing.T) fixture {
	return fixture{t: t, st: testdb.Setup(t), ctx: context.Background()}
}

var shanghai = time.FixedZone("CST", 8*3600)

// now is 2026-03-15 12:00 Beijing time.
var now = time.Date(2026, 3, 15, 12, 0, 0, 0, shanghai)

func TestQueryBreaksDownSpendAndActivityByWorkspace(t *testing.T) {
	f := setup(t)
	user := f.user("alice")
	other := f.user("bob")
	march := time.Date(2026, 3, 3, 10, 0, 0, 0, shanghai)

	ecommerce := f.task(user, "ecommerce_design", "", "succeeded", march, 4, 30, 400, `{"_modelDisplayName":"高清模型"}`)
	f.ledger(user, "spend", -400, "task", ecommerce.String(), march)
	t2i := f.task(user, "t2i", "", "failed", march.Add(time.Hour), 0, 0, 0, `{"_modelDisplayName":"标准模型"}`)
	_ = t2i
	run := f.assistantRun(user, "succeeded", march.Add(2*time.Hour), 2, "标准模型")
	f.ledger(user, "spend", -60, "assistant_run", run.String(), march.Add(2*time.Hour))
	// 助手出图写的历史镜像任务不能把创作算两遍。
	f.task(user, "t2i", "", "succeeded", march.Add(2*time.Hour), 2, 20, 0, `{"_historyMirror":true}`)
	// 入账不属于任何功能的消耗。
	f.ledger(user, "grant", 1000, "order", "order-1", march)
	// 别人的数据绝不能出现。
	otherTask := f.task(other, "ecommerce_design", "", "succeeded", march, 9, 10, 900, "")
	f.ledger(other, "spend", -900, "task", otherTask.String(), march)

	result, err := Query(f.ctx, f.st, user, Request{
		Metrics:    []Metric{MetricSpendPoints, MetricCreations, MetricImages},
		Dimensions: []Dimension{DimWorkspace},
		TimeRange:  TimeRange{Preset: RangeThisMonth},
		Timezone:   "Asia/Shanghai",
	}, now)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.Totals[MetricSpendPoints] != 460 || result.Totals[MetricCreations] != 3 || result.Totals[MetricImages] != 6 {
		t.Fatalf("totals = %+v", result.Totals)
	}
	byWorkspace := map[string]Row{}
	for _, row := range result.Rows {
		byWorkspace[row.Keys[DimWorkspace]] = row
	}
	if len(byWorkspace) != 3 {
		t.Fatalf("rows = %+v", result.Rows)
	}
	if row := byWorkspace["ecommerce_design"]; row.Values[MetricSpendPoints] != 400 || row.Labels[DimWorkspace] != "AI 电商" {
		t.Fatalf("ecommerce row = %+v", row)
	}
	if row := byWorkspace["assistant"]; row.Values[MetricSpendPoints] != 60 || row.Values[MetricImages] != 2 || row.Values[MetricCreations] != 1 {
		t.Fatalf("assistant row = %+v", row)
	}
	if result.Rows[0].Keys[DimWorkspace] != "ecommerce_design" {
		t.Fatalf("rows should sort by the first metric, got %+v", result.Rows[0])
	}
}

func TestQueryMatchesWalletSummaryExactly(t *testing.T) {
	f := setup(t)
	user := f.user("carol")
	at := time.Date(2026, 3, 2, 9, 0, 0, 0, shanghai)

	paid := f.task(user, "t2i", "", "succeeded", at, 1, 5, 120, "")
	f.ledger(user, "spend", -120, "task", paid.String(), at)
	// 早期记录：spend 的 delta 为 0，钱包回退到关联任务的实扣。
	legacy := f.task(user, "t2i", "", "succeeded", at, 1, 5, 75, "")
	f.ledger(user, "spend", 0, "task", legacy.String(), at)
	// 冻结说明里带金额的记录。
	f.exec(`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason, created_at)
		VALUES ($1, 'spend', 0, 0, 'task', $2, '消耗冻结 33 积分', $3)`, user, uuid.NewString(), at)
	// 订阅内部划转不算消耗。
	f.ledger(user, "spend", -500, "subscription_cycle_expiry", "lot-1", at)
	f.ledger(user, "admin_adjust", -40, "admin", "adj-1", at)
	f.ledger(user, "admin_adjust", 15, "admin", "adj-2", at)
	f.ledger(user, "release", 20, "task", uuid.NewString(), at)
	f.ledger(user, "grant", 2000, "order", "order-9", at)
	f.ledger(user, "refund", 30, "task", uuid.NewString(), at)

	wallet, err := store.UserWalletLedgerStats(f.ctx, f.st.Pool, user)
	if err != nil {
		t.Fatalf("wallet stats: %v", err)
	}
	result, err := Query(f.ctx, f.st, user, Request{
		Metrics:   []Metric{MetricSpendPoints, MetricDeductPoints, MetricRefundPoints, MetricIncomePoints},
		TimeRange: TimeRange{Preset: RangeAllTime},
	}, now)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	consumed := int64(result.Totals[MetricSpendPoints] + result.Totals[MetricDeductPoints])
	if consumed != wallet.ConsumedCents {
		t.Fatalf("spend+deduct = %d, wallet consumed = %d", consumed, wallet.ConsumedCents)
	}
	if int64(result.Totals[MetricRefundPoints]) != wallet.RefundCents {
		t.Fatalf("refund = %v, wallet = %d", result.Totals[MetricRefundPoints], wallet.RefundCents)
	}
	if int64(result.Totals[MetricIncomePoints]) != wallet.IncomeCents {
		t.Fatalf("income = %v, wallet = %d", result.Totals[MetricIncomePoints], wallet.IncomeCents)
	}
	if result.Totals[MetricSpendPoints] != 120+75+33 {
		t.Fatalf("spend = %v", result.Totals[MetricSpendPoints])
	}
}

func TestQueryDailyTrendFillsGapsAndCompares(t *testing.T) {
	f := setup(t)
	user := f.user("dave")
	// 2026-03-09 23:30 UTC 是北京时间 3 月 10 日。
	f.task(user, "t2i", "", "succeeded", time.Date(2026, 3, 9, 23, 30, 0, 0, time.UTC), 2, 10, 0, "")
	f.task(user, "t2i", "", "succeeded", time.Date(2026, 3, 12, 8, 0, 0, 0, shanghai), 1, 10, 0, "")
	f.task(user, "t2i", "", "failed", time.Date(2026, 3, 12, 9, 0, 0, 0, shanghai), 0, 10, 0, "")
	// 上一个 7 天里的一次创作。
	f.task(user, "t2i", "", "succeeded", time.Date(2026, 3, 5, 9, 0, 0, 0, shanghai), 1, 10, 0, "")

	result, err := Query(f.ctx, f.st, user, Request{
		Metrics:           []Metric{MetricCreations, MetricSuccessRate},
		Dimensions:        []Dimension{DimDay},
		TimeRange:         TimeRange{Preset: RangeLast7Days},
		Timezone:          "Asia/Shanghai",
		CompareToPrevious: true,
	}, now)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Rows) != 7 || result.Rows[0].Keys[DimDay] != "2026-03-09" || result.Rows[6].Keys[DimDay] != "2026-03-15" {
		t.Fatalf("expected 7 consecutive days, got %+v", result.Rows)
	}
	if result.Rows[1].Values[MetricCreations] != 1 || result.Rows[3].Values[MetricCreations] != 2 {
		t.Fatalf("day buckets wrong: %+v", result.Rows)
	}
	if result.Totals[MetricSuccessRate] != 66.7 {
		t.Fatalf("success rate = %v", result.Totals[MetricSuccessRate])
	}
	if result.PreviousTotals[MetricCreations] != 1 || result.PreviousRange == nil || result.PreviousRange.From != "2026-03-02" {
		t.Fatalf("previous = %+v %+v", result.PreviousTotals, result.PreviousRange)
	}
}

func TestQueryRejectsIncompatibleRequests(t *testing.T) {
	cases := []Request{
		{},
		{Metrics: []Metric{"revenue"}},
		{Metrics: []Metric{MetricSpendPoints}, Dimensions: []Dimension{DimStatus}},
		{Metrics: []Metric{MetricCreations}, Dimensions: []Dimension{DimSource}},
		{Metrics: []Metric{MetricCreations}, Dimensions: []Dimension{DimDay, DimMonth}},
		{Metrics: []Metric{MetricSpendPoints}, Filters: Filters{Status: "failed"}},
		{Metrics: []Metric{MetricCreations}, TimeRange: TimeRange{From: "2020-01-01", To: "2026-01-01"}},
		{Metrics: []Metric{MetricCreations}, TimeRange: TimeRange{Preset: "forever"}},
	}
	for index, req := range cases {
		_, err := Query(context.Background(), nil, uuid.New(), req, now)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d: expected ErrInvalid, got %v", index, err)
		}
	}
}

func TestListRecordsReturnsOnlyOwnRecordsWithLinks(t *testing.T) {
	f := setup(t)
	user := f.user("erin")
	other := f.user("frank")
	at := time.Date(2026, 3, 10, 10, 0, 0, 0, shanghai)
	cheap := f.task(user, "t2i", "", "succeeded", at, 1, 5, 10, "")
	f.ledger(user, "spend", -10, "task", cheap.String(), at)
	pricey := f.task(user, "ecommerce_design", "", "succeeded", at.Add(time.Hour), 4, 5, 300, "")
	f.ledger(user, "spend", -300, "task", pricey.String(), at.Add(time.Hour))
	run := f.assistantRun(user, "succeeded", at.Add(2*time.Hour), 1, "标准模型")
	f.ledger(user, "spend", -50, "assistant_run", run.String(), at.Add(2*time.Hour))
	foreign := f.task(other, "t2i", "", "succeeded", at, 1, 5, 999, "")
	f.ledger(other, "spend", -999, "task", foreign.String(), at)

	result, err := ListRecords(f.ctx, f.st, user, RecordsRequest{
		Type: RecordSpend, Sort: SortLargest, TimeRange: TimeRange{Preset: RangeThisMonth}, Limit: 2,
	}, now)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(result.Records) != 2 || !result.HasMore {
		t.Fatalf("records = %+v", result)
	}
	if first := result.Records[0]; first.Points != 300 || first.WorkspaceLabel != "AI 电商" || first.Link != "/history" {
		t.Fatalf("first = %+v", first)
	}
	if second := result.Records[1]; second.Points != 50 || !strings.HasPrefix(second.Link, "/assistant?c=") {
		t.Fatalf("second = %+v", second)
	}

	creations, err := ListRecords(f.ctx, f.st, user, RecordsRequest{
		Type: RecordCreations, TimeRange: TimeRange{Preset: RangeThisMonth}, Filters: Filters{Status: "succeeded"},
	}, now)
	if err != nil {
		t.Fatalf("list creations: %v", err)
	}
	if len(creations.Records) != 3 || creations.Records[0].ID != run.String() || creations.Records[0].Time != "2026-03-10 12:00" {
		t.Fatalf("creations = %+v", creations.Records)
	}
	for _, record := range creations.Records {
		if record.ID == foreign.String() {
			t.Fatal("another user's record leaked")
		}
	}

	if _, err := ListRecords(f.ctx, f.st, user, RecordsRequest{Type: RecordSpend, Filters: Filters{Status: "failed"}}, now); !errors.Is(err, ErrInvalid) {
		t.Fatalf("status filter on spend should be invalid, got %v", err)
	}
}
