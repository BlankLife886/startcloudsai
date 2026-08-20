package httpapi

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type walletIncomeSpec struct {
	ID    string
	Label string
	Hint  string
}

var walletIncomeCatalog = []walletIncomeSpec{
	{"daily_checkin", "签到积分", "每日签到到账，连续签到奖励更高"},
	{"trial_access", "体验积分", "体验活动领取，仅限获批功能使用"},
	{"usage_milestone", "激励积分", "创作用量达标后自动发放（越用越多）"},
	{"growth_group", "拼团积分", "好友拼团满员后到账"},
	{"feedback_adoption", "建议采纳", "产品建议被采纳后发放"},
	{"task_failure_bonus", "失败补偿", "生成失败后的补偿积分"},
	{"redeem_code", "兑换码入账", "使用兑换码充入的积分"},
	{"order", "套餐入账", "购买套餐到账"},
	{"subscription_daily", "订阅每日发放", "会员订阅按日发放"},
	{"signup_bonus", "注册赠送", "新账号注册奖励"},
	{"admin", "人工调整", "客服或管理员入账"},
	{"other", "其他入账", "未归入以上渠道的入账"},
}

var walletIncomeByID = func() map[string]walletIncomeSpec {
	out := make(map[string]walletIncomeSpec, len(walletIncomeCatalog))
	for _, spec := range walletIncomeCatalog {
		out[spec.ID] = spec
	}
	return out
}()

func walletIncomeID(sourceType string) string {
	if _, ok := walletIncomeByID[sourceType]; ok {
		return sourceType
	}
	return "other"
}

func walletIncomeLabel(sourceType string) string {
	return walletIncomeByID[walletIncomeID(sourceType)].Label
}

func walletKindLabel(kind string, delta int64) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "grant":
		return "入账"
	case "spend":
		return "消费"
	case "freeze":
		return "冻结"
	case "release", "refund":
		return "退款"
	case "admin_adjust":
		if delta < 0 {
			return "人工扣减"
		}
		return "人工调整"
	default:
		return kind
	}
}

func walletCreditBucketLabel(bucket string) string {
	switch bucket {
	case "trial":
		return "体验积分"
	case "mixed":
		return "混合"
	default:
		return "普通积分"
	}
}

func ledgerConsumedCents(entry *store.LedgerEntry, task *store.Task, run *store.AssistantRun) int64 {
	if entry == nil {
		return 0
	}
	if entry.Kind == "admin_adjust" && entry.DeltaCents < 0 {
		return -entry.DeltaCents
	}
	if entry.Kind != "spend" {
		if entry.DeltaCents < 0 {
			return -entry.DeltaCents
		}
		return 0
	}
	if entry.DeltaCents != 0 {
		if entry.DeltaCents < 0 {
			return -entry.DeltaCents
		}
		return entry.DeltaCents
	}
	reason := ""
	if entry.Reason != nil {
		reason = *entry.Reason
	}
	if _, amount, ok := strings.Cut(reason, "消耗冻结 "); ok {
		amount = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(amount, " 分"), "分"))
		if n, err := strconv.ParseInt(amount, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	if task != nil && task.CostCents > 0 {
		return task.CostCents
	}
	if run != nil && run.CostCents > 0 {
		return run.CostCents
	}
	return 0
}

func walletSummaryDict(stats *store.WalletLedgerStats) gin.H {
	if stats == nil {
		stats = &store.WalletLedgerStats{}
	}
	byID := make(map[string]store.WalletSourceTotal, len(stats.Income))
	for _, item := range stats.Income {
		id := walletIncomeID(item.SourceType)
		current := byID[id]
		current.SourceType = id
		current.Cents += item.Cents
		current.Count += item.Count
		byID[id] = current
	}
	items := make([]gin.H, 0, len(walletIncomeCatalog))
	for _, spec := range walletIncomeCatalog {
		if spec.ID == "trial_access" {
			continue
		}
		item := byID[spec.ID]
		items = append(items, gin.H{
			"id":    spec.ID,
			"label": spec.Label,
			"hint":  spec.Hint,
			"cents": item.Cents,
			"count": item.Count,
		})
	}
	return gin.H{
		"consumedCents": stats.ConsumedCents,
		"consumedCount": stats.ConsumedCount,
		"refundCents":   stats.RefundCents,
		"refundCount":   stats.RefundCount,
		"incomeCents":   stats.IncomeCents,
		"incomeCount":   stats.IncomeCount,
		"entryCount":    stats.EntryCount,
		"items":         items,
	}
}

func (s *Server) myWalletSummary(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	stats, err := store.UserWalletLedgerStats(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, walletSummaryDict(stats))
}

func (s *Server) myWalletExport(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	wallet, err := store.GetWallet(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if wallet == nil {
		wallet = &store.Wallet{}
	}
	stats, err := store.UserWalletLedgerStats(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	entries, err := store.ListAllUserLedger(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	tasksByID, runsByID, err := loadLedgerRelated(ctx, s.St.Pool, entries)
	if err != nil {
		fail(c, err)
		return
	}

	var output bytes.Buffer
	output.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&output)
	stamp := time.Now().In(promptDayLocation).Format("2006-01-02 15:04:05")
	_ = writer.Write([]string{"星空云绘积分账单"})
	_ = writer.Write([]string{"导出时间", stamp})
	_ = writer.Write([]string{"账号", user.Email})
	_ = writer.Write([]string{"可用余额", strconv.FormatInt(wallet.BalanceCents+wallet.TrialBalanceCents, 10)})
	_ = writer.Write([]string{"冻结中", strconv.FormatInt(wallet.FrozenCents+wallet.TrialFrozenCents, 10)})
	_ = writer.Write([]string{"普通积分", strconv.FormatInt(wallet.BalanceCents, 10)})
	_ = writer.Write([]string{"体验积分余额", strconv.FormatInt(wallet.TrialBalanceCents, 10)})
	_ = writer.Write([]string{})
	_ = writer.Write([]string{"汇总项目", "积分", "笔数", "说明"})
	summary := walletSummaryDict(stats)
	_ = writer.Write([]string{"合计消耗", fmt.Sprint(summary["consumedCents"]), fmt.Sprint(summary["consumedCount"]), "已结算的创作消耗，不含仍在冻结中的预扣"})
	_ = writer.Write([]string{"失败退回", fmt.Sprint(summary["refundCents"]), fmt.Sprint(summary["refundCount"]), "任务失败或取消后解冻退回可用余额"})
	_ = writer.Write([]string{"合计入账", fmt.Sprint(summary["incomeCents"]), fmt.Sprint(summary["incomeCount"]), "所有渠道累计到账"})
	if rawItems, ok := summary["items"].([]gin.H); ok {
		for _, item := range rawItems {
			_ = writer.Write([]string{
				fmt.Sprint(item["label"]),
				fmt.Sprint(item["cents"]),
				fmt.Sprint(item["count"]),
				fmt.Sprint(item["hint"]),
			})
		}
	}
	_ = writer.Write([]string{})
	_ = writer.Write([]string{"时间", "生成耗时", "项目", "说明", "模型", "类型", "变动", "结余", "来源", "积分池"})
	for _, entry := range entries {
		dict := decorateLedgerEntry(entry, tasksByID, runsByID)
		task, _ := dict["task"].(gin.H)
		title := walletExportTitle(entry, task)
		note := ""
		if reason, ok := dict["reason"].(*string); ok && reason != nil {
			note = strings.TrimSpace(*reason)
		} else if text, ok := dict["reason"].(string); ok {
			note = strings.TrimSpace(text)
		}
		model := ""
		elapsed := ""
		if task != nil {
			if value, ok := task["modelName"].(string); ok {
				model = strings.TrimSpace(value)
			}
			elapsed = formatExportDuration(stringValue(task["startedAt"]), stringValue(task["finishedAt"]))
		}
		delta := ledgerExportDelta(entry, tasksByID, runsByID)
		_ = writer.Write([]string{
			entry.CreatedAt.In(promptDayLocation).Format("2006-01-02 15:04:05"),
			elapsed,
			title,
			note,
			model,
			walletKindLabel(entry.Kind, entry.DeltaCents),
			formatExportDelta(delta),
			strconv.FormatInt(entry.BalanceAfterCents, 10),
			walletIncomeLabel(entry.SourceType),
			walletCreditBucketLabel(entry.CreditBucket),
		})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		fail(c, err)
		return
	}

	filename := "starclouds-wallet-" + time.Now().In(promptDayLocation).Format("20060102-150405") + ".csv"
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, "text/csv; charset=utf-8", output.Bytes())
}

func walletExportTitle(entry *store.LedgerEntry, task gin.H) string {
	if task != nil {
		if name := strings.TrimSpace(fmt.Sprint(task["displayName"])); name != "" && name != "<nil>" {
			return name
		}
	}
	if entry.Kind == "spend" || entry.Kind == "freeze" || entry.Kind == "release" {
		return "AI 任务"
	}
	return walletIncomeLabel(entry.SourceType)
}

func ledgerExportDelta(entry *store.LedgerEntry, tasksByID map[uuid.UUID]*store.Task, runsByID map[uuid.UUID]*store.AssistantRun) int64 {
	if entry.Kind == "spend" || (entry.Kind == "admin_adjust" && entry.DeltaCents < 0) {
		sourceID, ok := ledgerSourceUUID(entry)
		var task *store.Task
		var run *store.AssistantRun
		if ok && entry.SourceType == "task" {
			task = tasksByID[sourceID]
		}
		if ok && entry.SourceType == "assistant_run" {
			run = runsByID[sourceID]
		}
		return -ledgerConsumedCents(entry, task, run)
	}
	return entry.DeltaCents
}

func formatExportDelta(delta int64) string {
	if delta > 0 {
		return "+" + strconv.FormatInt(delta, 10)
	}
	return strconv.FormatInt(delta, 10)
}

func formatExportDuration(started, finished string) string {
	start, okStart := parseExportTime(started)
	end, okEnd := parseExportTime(finished)
	if !okStart || !okEnd || end.Before(start) {
		return ""
	}
	seconds := int64(end.Sub(start).Round(time.Second) / time.Second)
	if seconds < 0 {
		return ""
	}
	if seconds < 60 {
		return fmt.Sprintf("%d 秒", seconds)
	}
	minutes := seconds / 60
	rest := seconds % 60
	if rest == 0 {
		return fmt.Sprintf("%d 分", minutes)
	}
	return fmt.Sprintf("%d 分 %d 秒", minutes, rest)
}

func parseExportTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, value)
	}
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(*string); ok {
		if text == nil {
			return ""
		}
		return *text
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}
