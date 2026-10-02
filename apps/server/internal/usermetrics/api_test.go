package usermetrics

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (f fixture) apiKey(user uuid.UUID, label string) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO user_api_keys (user_id, key_prefix, key_hash, label)
		VALUES ($1, 'sk-test', $2, $3) RETURNING id`, user, uuid.NewString(), label).Scan(&id); err != nil {
		f.t.Fatalf("insert api key: %v", err)
	}
	return id
}

func (f fixture) apiCall(user uuid.UUID, key *uuid.UUID, source, model, status string, price int64, at time.Time) string {
	f.t.Helper()
	id := "bill-" + uuid.NewString()
	f.exec(`INSERT INTO developer_api_billing_requests (billing_id, source_type, user_id, api_key_id, price_cents, status, expires_at, created_at, api_model_name)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`, id, source, user, key, price, status, at, model)
	return id
}

func TestQueryCountsDeveloperAPICallsLikeTheConsole(t *testing.T) {
	f := setup(t)
	user := f.user("dev")
	other := f.user("other")
	prod := f.apiKey(user, "生产")
	test := f.apiKey(user, "测试")
	day := time.Date(2026, 3, 10, 9, 0, 0, 0, shanghai)

	f.apiCall(user, &prod, store.DeveloperAPIChatLedgerSource, "gpt-x", "succeeded", 30, day)
	f.apiCall(user, &prod, store.DeveloperAPIImageLedgerSource, "img-1", "succeeded", 200, day.Add(time.Hour))
	f.apiCall(user, &test, store.DeveloperAPIChatLedgerSource, "gpt-x", "failed", 30, day.Add(2*time.Hour))
	f.apiCall(user, &test, store.DeveloperAPIChatLedgerSource, "gpt-x", "expired", 30, day.Add(3*time.Hour))
	f.apiCall(user, nil, store.DeveloperAPIChatLedgerSource, "gpt-x", "pending", 30, day.Add(4*time.Hour))
	f.apiCall(other, nil, store.DeveloperAPIChatLedgerSource, "gpt-x", "succeeded", 999, day)

	result, err := Query(f.ctx, f.st, user, Request{
		Metrics:   []Metric{MetricAPICalls, MetricAPISucceeded, MetricAPIFailed, MetricAPIFailureRate, MetricAPISpendPoints},
		TimeRange: TimeRange{Preset: RangeThisMonth},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	want := map[Metric]float64{MetricAPICalls: 5, MetricAPISucceeded: 2, MetricAPIFailed: 2, MetricAPIFailureRate: 50, MetricAPISpendPoints: 230}
	for metric, value := range want {
		if result.Totals[metric] != value {
			t.Errorf("%s = %v, want %v", metric, result.Totals[metric], value)
		}
	}

	// The summary on the wallet page counts the same succeeded spend.
	points, calls, err := store.UserAPISpend(f.ctx, f.st.Pool, user, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if float64(points) != result.Totals[MetricAPISpendPoints] || calls != 2 {
		t.Fatalf("api usage summary = %d points / %d calls, metrics = %v", points, calls, result.Totals)
	}

	byKey, err := Query(f.ctx, f.st, user, Request{
		Metrics:    []Metric{MetricAPICalls, MetricAPISpendPoints},
		Dimensions: []Dimension{DimAPIKey},
		TimeRange:  TimeRange{Preset: RangeThisMonth},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][2]float64{}
	for _, row := range byKey.Rows {
		got[row.Labels[DimAPIKey]] = [2]float64{row.Values[MetricAPICalls], row.Values[MetricAPISpendPoints]}
	}
	if got["生产"] != [2]float64{2, 230} || got["测试"] != [2]float64{2, 0} || got["未命名或已删除的 Key"] != [2]float64{1, 0} {
		t.Fatalf("by key = %v", got)
	}

	failed, err := Query(f.ctx, f.st, user, Request{
		Metrics:   []Metric{MetricAPICalls},
		Filters:   Filters{Status: "failed", APIKey: "测试"},
		TimeRange: TimeRange{Preset: RangeThisMonth},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Totals[MetricAPICalls] != 1 {
		t.Fatalf("filtered calls = %v", failed.Totals)
	}
}

func TestQueryMixesAPIWithCreationsAndRejectsMismatchedFilters(t *testing.T) {
	f := setup(t)
	user := f.user("mixed")
	day := time.Date(2026, 3, 10, 9, 0, 0, 0, shanghai)
	f.task(user, "t2i", "m", "succeeded", day, 1, 10, 10, "")
	f.apiCall(user, nil, store.DeveloperAPIChatLedgerSource, "gpt-x", "succeeded", 5, day)

	result, err := Query(f.ctx, f.st, user, Request{
		Metrics:    []Metric{MetricCreations, MetricAPICalls},
		Dimensions: []Dimension{DimDay},
		TimeRange:  TimeRange{From: "2026-03-10", To: "2026-03-10"},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if result.Totals[MetricCreations] != 1 || result.Totals[MetricAPICalls] != 1 {
		t.Fatalf("totals = %v", result.Totals)
	}

	for name, req := range map[string]Request{
		"api key on creations":  {Metrics: []Metric{MetricCreations}, Filters: Filters{APIKey: "x"}},
		"source on api":         {Metrics: []Metric{MetricAPICalls}, Filters: Filters{Source: "order"}},
		"api key dim on ledger": {Metrics: []Metric{MetricSpendPoints}, Dimensions: []Dimension{DimAPIKey}},
	} {
		if _, err := Query(context.Background(), f.st, user, req, now); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

func TestLedgerFactsFileAPISpendUnderAPIWorkspace(t *testing.T) {
	f := setup(t)
	user := f.user("apispend")
	day := time.Date(2026, 3, 10, 9, 0, 0, 0, shanghai)
	f.exec(`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, settled_points, created_at)
		VALUES ($1, 'spend', 0, 0, $2, 'bill-1', 40, $3)`, user, store.DeveloperAPIChatLedgerSource, day)

	result, err := Query(f.ctx, f.st, user, Request{
		Metrics:    []Metric{MetricSpendPoints},
		Dimensions: []Dimension{DimWorkspace},
		TimeRange:  TimeRange{Preset: RangeThisMonth},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 1 || result.Rows[0].Keys[DimWorkspace] != "developer_api" || result.Rows[0].Labels[DimWorkspace] != "API 调用" {
		t.Fatalf("rows = %+v", result.Rows)
	}
}

func TestListRecordsListsAPICalls(t *testing.T) {
	f := setup(t)
	user := f.user("apirecords")
	key := f.apiKey(user, "生产")
	day := time.Date(2026, 3, 10, 9, 0, 0, 0, shanghai)
	f.apiCall(user, &key, store.DeveloperAPIImageLedgerSource, "img-1", "succeeded", 200, day)
	failedID := f.apiCall(user, &key, store.DeveloperAPIChatLedgerSource, "gpt-x", "failed", 30, day.Add(time.Hour))

	result, err := ListRecords(f.ctx, f.st, user, RecordsRequest{Type: RecordAPICalls, Filters: Filters{Status: "failed"}, TimeRange: TimeRange{Preset: RangeThisMonth}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Records) != 1 {
		t.Fatalf("records = %+v", result.Records)
	}
	record := result.Records[0]
	if record.ID != failedID || record.StatusLabel != "失败" || record.Points != 0 || record.Link != "/developer-api" || record.Note != "对话 · Key：生产" {
		t.Fatalf("record = %+v", record)
	}
}
