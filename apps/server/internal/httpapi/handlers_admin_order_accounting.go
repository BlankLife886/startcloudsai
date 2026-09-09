package httpapi

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func accountingFilter(c *gin.Context) (store.OrderFilter, error) {
	f := store.OrderFilter{Status: c.Query("status"), Kind: c.Query("kind"), PaymentMethod: c.Query("paymentMethod"), RefundState: c.Query("refundState"), Delivery: c.Query("delivery"), Search: strings.TrimSpace(c.Query("search"))}
	if value := c.Query("planId"); value != "" {
		id, err := uuid.Parse(value)
		if err != nil {
			return f, apperr.E("validation_error", "无效的套餐编号", 422)
		}
		f.PlanID = &id
	}
	if value := c.Query("planRevision"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > 2147483647 || f.PlanID == nil {
			return f, apperr.E("validation_error", "套餐版本须与套餐编号一起筛选", 422)
		}
		f.PlanRevision = &n
	}
	for _, field := range []struct {
		value   string
		allowed []string
	}{{f.Status, store.OrderStatuses}, {f.Kind, []string{"topup", "recharge", "subscription", "upgrade", "legacy"}}, {f.PaymentMethod, []string{"alipay", "wechat"}}, {f.RefundState, []string{"none", "pending", "completed", "unallocated"}}, {f.Delivery, []string{"delivered", "missing", "pending", "not_due"}}} {
		if field.value != "" && !store.Contains(field.allowed, field.value) {
			return f, apperr.E("validation_error", "无效的订单筛选条件", 422)
		}
	}
	if len([]rune(f.Search)) > 200 {
		return f, apperr.E("validation_error", "搜索内容最多200字", 422)
	}
	if value := c.Query("userId"); value != "" {
		id, err := uuid.Parse(value)
		if err != nil {
			return f, apperr.E("validation_error", "无效的用户编号", 422)
		}
		f.UserID = &id
	}
	for _, field := range []struct {
		key string
		dst **time.Time
		end bool
	}{{"createdFrom", &f.From, false}, {"createdTo", &f.To, true}} {
		if value := c.Query(field.key); value != "" {
			at, err := time.ParseInLocation("2006-01-02", value, promptDayLocation)
			if err != nil {
				return f, apperr.E("validation_error", "日期须为YYYY-MM-DD", 422)
			}
			if field.end {
				at = at.AddDate(0, 0, 1)
			}
			*field.dst = &at
		}
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		return f, apperr.E("validation_error", "结束日期不能早于开始日期", 422)
	}
	for _, field := range []struct {
		key string
		dst **int64
	}{{"minAmount", &f.MinAmount}, {"maxAmount", &f.MaxAmount}} {
		if value := c.Query(field.key); value != "" {
			n, err := lanjingpay.ParseCents(value)
			if err != nil || n < 0 || n > 1000000000 {
				return f, apperr.E("validation_error", "金额须为范围内的非负数，最多两位小数", 422)
			}
			*field.dst = &n
		}
	}
	if f.MinAmount != nil && f.MaxAmount != nil && *f.MinAmount > *f.MaxAmount {
		return f, apperr.E("validation_error", "最高金额不能小于最低金额", 422)
	}
	return f, nil
}

func accountingOrderDict(a *store.AccountingOrder) gin.H {
	d := adminOrderDict(a.Order, &store.User{ID: a.UserID, Email: a.Email, Username: a.Username})
	d["userId"], d["userEmail"], d["username"] = a.UserID, a.Email, a.Username
	d["finance"] = a.Finance
	return d
}

func (s *Server) adminAccountingOrders(c *gin.Context, _ *store.User) {
	f, err := accountingFilter(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	tx, err := s.St.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx)
	rows, err := store.ListOrderAccounting(ctx, tx, f, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	summary, err := store.SummarizeOrderAccounting(ctx, tx, f)
	if err != nil {
		fail(c, err)
		return
	}
	page := buildPage(rows, limit, accountingOrderDict)
	page["total"], page["summary"] = summary.Total, summary
	c.Header("Cache-Control", "no-store")
	ok(c, page)
}

type orderTimelineEvent struct {
	At     time.Time `json:"at"`
	Title  string    `json:"title"`
	Detail string    `json:"detail"`
	Actor  string    `json:"actor"`
}

func (s *Server) adminOrderAccountingDetail(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	tx, err := s.St.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx)
	rows, err := store.ListOrderAccounting(ctx, tx, store.OrderFilter{ID: &id}, 1, nil)
	if err != nil {
		fail(c, err)
		return
	}
	if len(rows) == 0 {
		fail(c, apperr.E("not_found", "订单不存在", 404))
		return
	}
	a := rows[0]
	d := accountingOrderDict(a)
	var planSnapshot json.RawMessage
	err = tx.QueryRow(ctx, `SELECT snapshot FROM plan_versions WHERE plan_id=$1 AND revision=$2`, a.PlanID, a.PlanRevision).Scan(&planSnapshot)
	if err != nil && err != pgx.ErrNoRows {
		fail(c, err)
		return
	}
	d["planSnapshot"] = planSnapshot
	var benefit *store.BillingContract
	var upgrade *store.SubscriptionChange
	changes := []*store.SubscriptionChange{}
	if a.SubscriptionChangeID != nil {
		upgrade, err = store.GetSubscriptionChange(ctx, tx, *a.SubscriptionChangeID, false)
		if err != nil {
			fail(c, err)
			return
		}
		if upgrade != nil {
			benefit = upgrade.Snapshot.Contract
		}
	}
	if a.Finance.SubscriptionID != nil {
		sub, err := store.GetSubscription(ctx, tx, *a.Finance.SubscriptionID)
		if err != nil {
			fail(c, err)
			return
		}
		if sub != nil {
			d["currentSubscription"] = subscriptionDict(sub, s.subscriptionNow())
		}
		changes, err = store.ListSubscriptionChangesForSubscription(ctx, tx, *a.Finance.SubscriptionID, 101)
		if err != nil {
			fail(c, err)
			return
		}
		d["changesHasMore"] = len(changes) > 100
		if len(changes) > 100 {
			changes = changes[:100]
		}
		if a.SubscriptionChangeID == nil && sub != nil {
			var source json.RawMessage
			err = tx.QueryRow(ctx, `SELECT snapshot->'sourcePlan'->'contract' FROM subscription_changes WHERE subscription_id=$1 AND kind='upgrade' AND status='completed' ORDER BY completed_at,created_at,id LIMIT 1`, sub.ID).Scan(&source)
			if err == pgx.ErrNoRows {
				benefit = sub.Contract
			} else if err != nil {
				fail(c, err)
				return
			} else if len(source) > 0 {
				if err = json.Unmarshal(source, &benefit); err != nil {
					fail(c, err)
					return
				}
			}
		}
	}
	d["benefitRecord"], d["upgrade"], d["changes"] = benefit, upgrade, changes
	timeline := []orderTimelineEvent{{At: a.CreatedAt, Title: "创建订单", Actor: a.Email}}
	if a.Finance.ReceiptConfirmed && a.PaidAt != nil {
		timeline = append(timeline, orderTimelineEvent{At: *a.PaidAt, Title: "确认收款", Detail: fmt.Sprintf("%d.%02d元", a.Finance.ReceivedCents/100, a.Finance.ReceivedCents%100), Actor: "平台"})
	}
	if a.CompletedAt != nil {
		timeline = append(timeline, orderTimelineEvent{At: *a.CompletedAt, Title: "订单完成", Detail: "权益状态以发放记录为准", Actor: "平台"})
	}
	events, err := tx.Query(ctx, `SELECT created_at,'支付回调',outcome||CASE WHEN signature_valid THEN '（验签通过）' ELSE '（验签未通过）' END,'支付渠道' FROM payment_callback_events WHERE order_id=$1
 UNION ALL SELECT checked_at,'支付对账',outcome,'平台' FROM payment_reconciliations WHERE order_id=$1
 UNION ALL SELECT e.occurred_at,'订阅变更',e.public_message,COALESCE((SELECT username FROM admin_accounts WHERE id=e.actor_id),'用户或系统') FROM subscription_change_events e JOIN subscription_changes ch ON ch.id=e.change_id WHERE ch.subscription_id=$2
 ORDER BY 1 DESC LIMIT 201`, id, a.Finance.SubscriptionID)
	if err != nil {
		fail(c, err)
		return
	}
	eventCount := 0
	for events.Next() {
		var e orderTimelineEvent
		if err = events.Scan(&e.At, &e.Title, &e.Detail, &e.Actor); err != nil {
			break
		}
		eventCount++
		if eventCount <= 200 {
			timeline = append(timeline, e)
		}
	}
	if err == nil {
		err = events.Err()
	}
	events.Close()
	if err != nil {
		fail(c, err)
		return
	}
	d["timelineHasMore"] = eventCount > 200
	sort.SliceStable(timeline, func(i, j int) bool { return timeline[i].At.Before(timeline[j].At) })
	d["timeline"] = timeline
	c.Header("Cache-Control", "no-store")
	ok(c, d)
}

func exportMoney(v *int64) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", float64(*v)/100)
}

func (s *Server) recordBillingExport(c *gin.Context, action string, rows int, filters any) error {
	value, ok := c.Get(ctxAdminUserKey)
	if !ok {
		return apperr.E("admin_required", "需要管理员权限", 403)
	}
	admin := value.(*store.User)
	raw, err := json.Marshal(gin.H{"rows": rows, "filters": filters})
	if err != nil {
		return err
	}
	entry := buildAuditEntry(admin, "GET", c.Request.URL.Path, c.Param("id"), 200, c.ClientIP(), raw)
	entry.Action = action
	return store.InsertAuditLog(c.Request.Context(), s.St.Pool, entry)
}

var accountingKindLabels = map[string]string{"topup": "固定额度包", "recharge": "自定义充值", "subscription": "订阅开通", "upgrade": "升级补差价", "legacy": "历史记录"}
var accountingDeliveryLabels = map[string]string{"delivered": "已发放", "pending": "待发放", "missing": "缺少发放记录", "not_due": "尚未收款"}

func (s *Server) adminExportOrderAccounting(c *gin.Context, _ *store.User) {
	f, err := accountingFilter(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	tx, err := s.St.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx)
	rows, err := store.ListOrderAccounting(ctx, tx, f, 5000, nil)
	if err != nil {
		fail(c, err)
		return
	}
	if len(rows) > 5000 {
		fail(c, apperr.E("validation_error", "单次最多导出5000笔，请缩小筛选范围", 422))
		return
	}
	var output bytes.Buffer
	output.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&output)
	_ = writer.Write([]string{"平台订单号", "用户", "用户名", "订单类型", "套餐", "平台状态", "订单金额(元)", "确认实收(元)", "本单已退(元)", "本单净收款(元)", "退款归属说明", "到账状态", "一次性积分", "赠送积分", "套餐版本", "充值每元积分", "接受订阅锁价", "渠道单号", "创建时间", "支付时间", "订阅周期(天)", "每24小时积分", "订阅额外并发(已记录)", "关联订阅编号"})
	for _, a := range rows {
		note := ""
		if a.Finance.RefundNeedsAllocation {
			note = "关联订阅存在退款，未记录逐单归属；空值不是零"
		}
		rate := ""
		if a.RechargePolicy != nil {
			rate = fmt.Sprint(a.RechargePolicy.PointsPerYuan)
		}
		paidAt := ""
		if a.PaidAt != nil {
			paidAt = a.PaidAt.In(promptDayLocation).Format(time.DateTime)
		}
		bonus, sid := "", ""
		if a.SubscriptionPolicy.ConcurrencyBonus != nil {
			bonus = fmt.Sprint(*a.SubscriptionPolicy.ConcurrencyBonus)
		}
		if a.Finance.SubscriptionID != nil {
			sid = a.Finance.SubscriptionID.String()
		}
		_ = writer.Write(safeCSVRow(a.ID.String(), a.Email, a.Username, accountingKindLabels[a.Finance.Kind], ptrString(a.PlanName), a.Status, exportMoney(&a.AmountCents), exportMoney(&a.Finance.ReceivedCents), exportMoney(a.Finance.RefundedCents), exportMoney(a.Finance.NetCents), note, accountingDeliveryLabels[a.Finance.Delivery], fmt.Sprint(a.GrantCents), fmt.Sprint(a.BonusCents), fmt.Sprint(a.PlanRevision), rate, fmt.Sprint(a.PriceLockEligible), ptrString(a.ProviderOrderID), a.CreatedAt.In(promptDayLocation).Format(time.DateTime), paidAt, fmt.Sprint(a.PlanDurationDays), fmt.Sprint(a.PlanDailyGrantCents), bonus, sid))
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		fail(c, err)
		return
	}
	if err := tx.Rollback(ctx); err != nil {
		fail(c, err)
		return
	}
	if err := s.recordBillingExport(c, "orders.export", len(rows), f); err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Disposition", `attachment; filename="orders-`+time.Now().UTC().Format("20060102-150405")+`.csv"`)
	c.Data(200, "text/csv; charset=utf-8", output.Bytes())
}
