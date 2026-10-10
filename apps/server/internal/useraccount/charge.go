package useraccount

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// ChargeRequest names the charge to explain: a creation record id (task or
// assistant run), a wallet entry id, or an API call id, as returned by the
// records tool. Empty means the most recent charge.
type ChargeRequest struct {
	ID string `json:"id,omitempty"`
}

// ChargeSource is the work a charge belongs to.
type ChargeSource struct {
	Type            string `json:"type"`
	TypeLabel       string `json:"typeLabel"`
	WorkspaceLabel  string `json:"workspaceLabel,omitempty"`
	Model           string `json:"model,omitempty"`
	Status          string `json:"status,omitempty"`
	StatusLabel     string `json:"statusLabel,omitempty"`
	Time            string `json:"time,omitempty"`
	Prompt          string `json:"prompt,omitempty"`
	RequestedImages int    `json:"requestedImages,omitempty"`
	Images          int    `json:"images,omitempty"`
	APIKey          string `json:"apiKey,omitempty"`
	Link            string `json:"link,omitempty"`
}

// ChargeEntry is one wallet movement for the charge.
type ChargeEntry struct {
	Time   string `json:"time"`
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Points int64  `json:"points"`
	Note   string `json:"note,omitempty"`
}

// ChargeTotals adds the entries up. NetPoints is what the work finally cost:
// charged plus manual deductions, minus refunds and failure compensation.
// Reserved points are not a cost; they are either charged or returned.
type ChargeTotals struct {
	ReservedPoints     int64 `json:"reservedPoints"`
	ChargedPoints      int64 `json:"chargedPoints"`
	ReturnedPoints     int64 `json:"returnedPoints"`
	RefundedPoints     int64 `json:"refundedPoints"`
	CompensationPoints int64 `json:"compensationPoints"`
	DeductedPoints     int64 `json:"deductedPoints"`
	NetPoints          int64 `json:"netPoints"`
	// PendingPoints are still reserved while the work runs.
	PendingPoints int64 `json:"pendingPoints"`
}

// ChargeExplanation is the answer to "这笔扣费是怎么回事".
type ChargeExplanation struct {
	Timezone string        `json:"timezone"`
	Found    bool          `json:"found"`
	Message  string        `json:"message,omitempty"`
	Source   *ChargeSource `json:"source,omitempty"`
	Entries  []ChargeEntry `json:"entries"`
	Totals   ChargeTotals  `json:"totals"`
	// Summary is a plain-language walk through the entries, built from the
	// numbers above so the model can quote it verbatim.
	Summary []string `json:"summary"`
}

const (
	sourceTask         = "task"
	sourceAssistantRun = "assistant_run"
	sourceAPI          = "api_call"
	sourceLedger       = "ledger"
	failureBonusSource = "task_failure_bonus"
)

var apiLedgerSources = []string{store.DeveloperAPIImageLedgerSource, store.DeveloperAPIChatLedgerSource, "open_api_responses_chat"}

var chargeStatusLabels = map[string]string{
	"queued": "排队中", "running": "运行中", "succeeded": "成功", "failed": "失败", "canceled": "已取消",
	"cancelled": "已取消", "pending": "等待返回", "expired": "超时退回",
}

// target is a resolved charge: the ledger source it was written under and,
// for a single wallet entry, that entry's id.
type target struct {
	kind       string
	ledgerType string
	id         string
	entryID    string
}

func truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit]) + "…"
}

// ExplainCharge reconstructs one charge from the wallet ledger and the work
// it paid for. Ownership is checked on every lookup.
func ExplainCharge(ctx context.Context, q store.Q, userID uuid.UUID, req ChargeRequest, loc *time.Location) (*ChargeExplanation, error) {
	if userID == uuid.Nil {
		return nil, invalid("缺少用户")
	}
	result := &ChargeExplanation{Timezone: loc.String(), Entries: []ChargeEntry{}, Summary: []string{}}
	id := strings.TrimSpace(req.ID)
	if len(id) > 120 {
		return nil, invalid("记录 ID 过长")
	}
	found, err := resolveTarget(ctx, q, userID, id)
	if err != nil {
		return nil, err
	}
	if found == nil {
		result.Message = "没有找到这条记录。它可能不属于当前账号，或已被删除；可以先用 my_records_list 查到记录再解释。"
		if id == "" {
			result.Message = "还没有任何扣费记录。"
		}
		return result, nil
	}
	result.Found = true
	if result.Source, err = describeSource(ctx, q, userID, *found, loc); err != nil {
		return nil, err
	}
	if err := loadEntries(ctx, q, userID, *found, loc, result); err != nil {
		return nil, err
	}
	result.Summary = summarize(result.Source, result.Entries, result.Totals)
	return result, nil
}

func resolveTarget(ctx context.Context, q store.Q, userID uuid.UUID, id string) (*target, error) {
	if id == "" {
		var ledgerType, sourceID string
		err := q.QueryRow(ctx, `SELECT source_type, split_part(source_id, '/', 1) FROM wallet_ledger
			WHERE user_id = $1 AND kind IN ('freeze', 'spend') AND source_id IS NOT NULL
				AND source_type = ANY($2)
			ORDER BY created_at DESC, id DESC LIMIT 1`,
			userID, append([]string{sourceTask, sourceAssistantRun}, apiLedgerSources...)).Scan(&ledgerType, &sourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return targetForLedgerSource(ledgerType, sourceID, ""), nil
	}
	if parsed, err := uuid.Parse(id); err == nil {
		id = parsed.String()
		var ledgerType, sourceID string
		err := q.QueryRow(ctx, `SELECT source_type, split_part(COALESCE(source_id, ''), '/', 1) FROM wallet_ledger
			WHERE user_id = $1 AND id = $2`, userID, parsed).Scan(&ledgerType, &sourceID)
		if err == nil {
			return targetForLedgerSource(ledgerType, sourceID, id), nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		var exists bool
		if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE user_id = $1 AND id = $2)`, userID, parsed).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			return &target{kind: sourceTask, ledgerType: sourceTask, id: id}, nil
		}
		if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assistant_runs WHERE user_id = $1 AND id = $2)`, userID, parsed).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			return &target{kind: sourceAssistantRun, ledgerType: sourceAssistantRun, id: id}, nil
		}
	}
	var ledgerType string
	err := q.QueryRow(ctx, `SELECT source_type FROM developer_api_billing_requests WHERE user_id = $1 AND billing_id = $2`,
		userID, id).Scan(&ledgerType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &target{kind: sourceAPI, ledgerType: ledgerType, id: id}, nil
}

// targetForLedgerSource maps a wallet entry to the work behind it. Entries
// with no work behind them (top-ups, check-in rewards) explain themselves.
func targetForLedgerSource(ledgerType, sourceID, entryID string) *target {
	switch {
	case ledgerType == sourceTask || ledgerType == failureBonusSource:
		if sourceID != "" {
			return &target{kind: sourceTask, ledgerType: sourceTask, id: sourceID}
		}
	case ledgerType == sourceAssistantRun:
		if sourceID != "" {
			return &target{kind: sourceAssistantRun, ledgerType: sourceAssistantRun, id: sourceID}
		}
	case store.Contains(apiLedgerSources, ledgerType):
		if sourceID != "" {
			return &target{kind: sourceAPI, ledgerType: ledgerType, id: sourceID}
		}
	}
	return &target{kind: sourceLedger, ledgerType: ledgerType, id: sourceID, entryID: entryID}
}

func modelDisplay(model string, params map[string]any) string {
	if value, ok := params["_modelDisplayName"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return model
}

func describeSource(ctx context.Context, q store.Q, userID uuid.UUID, t target, loc *time.Location) (*ChargeSource, error) {
	source := &ChargeSource{Type: t.kind}
	switch t.kind {
	case sourceTask:
		source.TypeLabel, source.Link = "创作任务", "/history"
		parsed, err := uuid.Parse(t.id)
		if err != nil {
			return source, nil
		}
		task, err := store.GetUserTask(ctx, q, userID, parsed)
		if err != nil || task == nil {
			// A deleted task still has its wallet entries; explain those.
			return source, err
		}
		source.WorkspaceLabel = workspaceLabel(task.Type)
		source.Model = modelDisplay(task.Model, task.Params)
		source.Status, source.StatusLabel = task.Status, chargeStatusLabels[task.Status]
		source.Time = formatTime(&task.CreatedAt, loc)
		source.Prompt = truncate(task.Prompt, 80)
		source.RequestedImages = task.Count
		source.Images = len(task.OutputKeys) + task.DeletedOutputCount
	case sourceAssistantRun:
		source.TypeLabel, source.Link = "AI 助手", "/assistant"
		parsed, err := uuid.Parse(t.id)
		if err != nil {
			return source, nil
		}
		run, err := store.GetUserAssistantRun(ctx, q, userID, parsed)
		if err != nil || run == nil {
			return source, err
		}
		source.WorkspaceLabel = workspaceLabel("assistant")
		source.Model = modelDisplay("", run.Params)
		source.Status, source.StatusLabel = run.Status, chargeStatusLabels[run.Status]
		source.Time = formatTime(&run.CreatedAt, loc)
		source.Prompt = truncate(run.Prompt, 80)
		source.Link = "/assistant?c=" + run.ConversationID.String()
	case sourceAPI:
		source.TypeLabel, source.Link = "API 调用", "/developer-api"
		source.WorkspaceLabel = workspaceLabel("developer_api")
		var created time.Time
		var kind string
		err := q.QueryRow(ctx, `WITH api AS (`+store.UserAPIFactsSQL+`)
			SELECT created_at, model, status, api_key, kind FROM api WHERE id = $2`, userID, t.id).
			Scan(&created, &source.Model, &source.Status, &source.APIKey, &kind)
		if errors.Is(err, pgx.ErrNoRows) {
			return source, nil
		}
		if err != nil {
			return nil, err
		}
		source.StatusLabel = chargeStatusLabels[source.Status]
		source.Time = formatTime(&created, loc)
		if kind == "image" {
			source.TypeLabel = "API 调用（图片）"
		} else {
			source.TypeLabel = "API 调用（对话）"
		}
	default:
		source.TypeLabel = sourceLabel(t.ledgerType)
		source.Link = "/wallet"
	}
	return source, nil
}

func workspaceLabel(workspace string) string {
	if label, ok := usermetrics.WorkspaceLabels[workspace]; ok {
		return label
	}
	return workspace
}

func sourceLabel(sourceType string) string {
	if label, ok := usermetrics.SourceLabels[sourceType]; ok {
		return label
	}
	return "其他"
}

// loadEntries reads the charge's wallet entries through the shared ledger
// facts, so every amount uses the wallet page's formula.
func loadEntries(ctx context.Context, q store.Q, userID uuid.UUID, t target, loc *time.Location, result *ChargeExplanation) error {
	where := `(source_type = $2 AND split_part(source_id, '/', 1) = $3)
		OR ($2 = 'task' AND source_type = '` + failureBonusSource + `' AND source_id = $3)`
	args := []any{userID, t.ledgerType, t.id}
	if t.kind == sourceLedger {
		where = `id = $2`
		args = []any{userID, t.entryID}
	}
	rows, err := q.Query(ctx, `WITH ledger AS (`+store.UserLedgerFactsSQL+`)
		SELECT created_at, kind, source_type, freeze_points, spend_points, refund_points, income_points, deduct_points, reason
		FROM ledger WHERE `+where+` ORDER BY created_at, id`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	totals := &result.Totals
	for rows.Next() {
		var created time.Time
		var kind, ledgerType, reason string
		var freeze, spend, release, income, deduct int64
		if err := rows.Scan(&created, &kind, &ledgerType, &freeze, &spend, &release, &income, &deduct, &reason); err != nil {
			return err
		}
		entry := ChargeEntry{Time: formatTime(&created, loc), Kind: kind, Note: truncate(reason, 60)}
		switch {
		case kind == "freeze":
			entry.Label, entry.Points = "预留", freeze
			totals.ReservedPoints += freeze
		case kind == "spend":
			entry.Label, entry.Points = "结算扣费", spend
			totals.ChargedPoints += spend
		case kind == "release":
			entry.Label, entry.Points = "退回可用余额", release
			totals.ReturnedPoints += release
		case kind == "refund":
			entry.Label, entry.Points = "退款入账", income
			totals.RefundedPoints += income
		case ledgerType == failureBonusSource:
			entry.Label, entry.Points = "失败补偿", income
			totals.CompensationPoints += income
		case kind == "admin_adjust" && deduct > 0:
			entry.Label, entry.Points = "人工扣减", deduct
			totals.DeductedPoints += deduct
		default:
			entry.Label, entry.Points = sourceLabel(ledgerType), income
		}
		result.Entries = append(result.Entries, entry)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	totals.NetPoints = totals.ChargedPoints + totals.DeductedPoints - totals.RefundedPoints - totals.CompensationPoints
	if result.Source != nil && (result.Source.Status == "queued" || result.Source.Status == "running" || result.Source.Status == "pending") {
		totals.PendingPoints = max(totals.ReservedPoints-totals.ChargedPoints-totals.ReturnedPoints, 0)
	}
	return nil
}

func summarize(source *ChargeSource, entries []ChargeEntry, totals ChargeTotals) []string {
	lines := []string{}
	if source.Type == sourceLedger {
		for _, entry := range entries {
			lines = append(lines, fmt.Sprintf("这是一条“%s”记录：%s %d 积分，与任何创作任务无关。", source.TypeLabel, entry.Label, entry.Points))
		}
		return lines
	}
	if source.Type == sourceAPI && totals.ReservedPoints == 0 && totals.ChargedPoints == 0 && totals.ReturnedPoints == 0 {
		lines = append(lines, "这次 API 调用没有产生扣费。")
		return lines
	}
	if totals.ReservedPoints > 0 {
		lines = append(lines, fmt.Sprintf("提交时预留了 %d 积分。", totals.ReservedPoints))
	}
	switch {
	case totals.PendingPoints > 0:
		lines = append(lines, fmt.Sprintf("还在进行中，%d 积分仍在预留，结束后按实际结果结算，没用到的会自动退回。", totals.PendingPoints))
	case totals.ChargedPoints > 0 && totals.ReturnedPoints > 0:
		lines = append(lines, fmt.Sprintf("按实际结果扣费 %d 积分，多预留或没有产出的 %d 积分已退回可用余额。", totals.ChargedPoints, totals.ReturnedPoints))
	case totals.ChargedPoints > 0:
		lines = append(lines, fmt.Sprintf("按实际结果扣费 %d 积分。", totals.ChargedPoints))
	case totals.ReturnedPoints > 0:
		lines = append(lines, fmt.Sprintf("没有成功产出，预留的 %d 积分已全部退回，没有扣费。", totals.ReturnedPoints))
	}
	if source.RequestedImages > 0 && source.Status == "succeeded" && source.Images > 0 && source.Images < source.RequestedImages {
		lines = append(lines, fmt.Sprintf("请求 %d 张，实际产出 %d 张。", source.RequestedImages, source.Images))
	}
	if totals.RefundedPoints > 0 {
		lines = append(lines, fmt.Sprintf("之后退款 %d 积分。", totals.RefundedPoints))
	}
	if totals.CompensationPoints > 0 {
		lines = append(lines, fmt.Sprintf("另外发放了 %d 积分失败补偿。", totals.CompensationPoints))
	}
	if totals.DeductedPoints > 0 {
		lines = append(lines, fmt.Sprintf("平台人工扣减 %d 积分。", totals.DeductedPoints))
	}
	if totals.PendingPoints == 0 {
		lines = append(lines, fmt.Sprintf("合计实际花费 %d 积分。", totals.NetPoints))
	}
	return lines
}
