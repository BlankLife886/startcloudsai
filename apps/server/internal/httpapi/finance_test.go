// finance/summary 聚合：revenue/spend 按天补零、grant/refund 汇总、days clamp。
package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func TestFinanceSummaryAggregation(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st}
	ctx := context.Background()

	// 收入 + 入账：完成一笔 990 分订单（grant 1000 + bonus 200）
	user, order := makeOrder(t, st)
	if _, err := srv.completeOrder(ctx, order); err != nil {
		t.Fatalf("complete order: %v", err)
	}
	// admin_adjust：正数计入 grant，负数不计
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, aerr := wallet.AdminAdjust(ctx, tx, user.ID, 50, "adj-plus", "测试加款"); aerr != nil {
			return aerr
		}
		_, aerr := wallet.AdminAdjust(ctx, tx, user.ID, -10, "adj-minus", "测试扣款")
		return aerr
	})
	if err != nil {
		t.Fatalf("admin adjust: %v", err)
	}

	// 消耗：任务结算 spend（t2i 单价 20）
	settled, _, err := taskflow.CreateTask(ctx, st, user.ID, taskflow.CreateInput{Type: "t2i", Prompt: "p", Count: 1})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := st.Pool.Exec(ctx,
		`UPDATE tasks SET status = 'running', started_at = now() WHERE id = $1`, settled.ID); err != nil {
		t.Fatalf("force running: %v", err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, merr := taskflow.MarkSucceeded(ctx, tx, settled, []string{"tasks/x/0.png"}, nil, time.Now().UTC())
		return merr
	}); err != nil {
		t.Fatalf("mark succeeded: %v", err)
	}

	// 退还：取消任务 → release 计入 refund
	canceled, _, err := taskflow.CreateTask(ctx, st, user.ID, taskflow.CreateInput{Type: "t2i", Prompt: "p", Count: 1})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := taskflow.CancelTask(ctx, st, user.ID, canceled.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	data, err := financeSummaryData(ctx, st.Pool, 1) // clamp 到 7
	if err != nil {
		t.Fatalf("finance summary: %v", err)
	}

	revenueDaily := data["revenueDaily"].([]gin.H)
	spendDaily := data["spendDaily"].([]gin.H)
	if len(revenueDaily) != 7 || len(spendDaily) != 7 {
		t.Fatalf("daily len = (%d, %d), want (7, 7)", len(revenueDaily), len(spendDaily))
	}
	today := time.Now().UTC().Format("2006-01-02")
	for i, row := range revenueDaily {
		want := int64(0)
		if row["date"] == today {
			want = 990
		}
		if row["amountCents"].(int64) != want {
			t.Fatalf("revenueDaily[%d] = %v, want %d", i, row, want)
		}
	}
	last := spendDaily[len(spendDaily)-1]
	if last["date"] != today || last["amountCents"].(int64) != 20 {
		t.Fatalf("spendDaily 今日 = %v, want 20", last)
	}
	for _, row := range spendDaily[:len(spendDaily)-1] {
		if row["amountCents"].(int64) != 0 {
			t.Fatalf("历史日期应补零: %v", row)
		}
	}

	totals := data["totals"].(gin.H)
	if totals["revenueCents"].(int64) != 990 {
		t.Fatalf("revenueCents = %v, want 990", totals["revenueCents"])
	}
	if totals["spendCents"].(int64) != 20 {
		t.Fatalf("spendCents = %v, want 20", totals["spendCents"])
	}
	// grant = 订单入账 1200 + admin_adjust 正数 50（负数 -10 不计）
	if totals["grantCents"].(int64) != 1250 {
		t.Fatalf("grantCents = %v, want 1250", totals["grantCents"])
	}
	if totals["refundCents"].(int64) != 20 {
		t.Fatalf("refundCents = %v, want 20", totals["refundCents"])
	}
}

func TestFinanceSummaryDaysClamp(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()

	data, err := financeSummaryData(ctx, st.Pool, 200) // clamp 到 90
	if err != nil {
		t.Fatalf("finance summary: %v", err)
	}
	if n := len(data["revenueDaily"].([]gin.H)); n != 90 {
		t.Fatalf("revenueDaily len = %d, want 90", n)
	}
	totals := data["totals"].(gin.H)
	for _, key := range []string{"revenueCents", "spendCents", "grantCents", "refundCents"} {
		if totals[key].(int64) != 0 {
			t.Fatalf("%s = %v, want 0", key, totals[key])
		}
	}
}
