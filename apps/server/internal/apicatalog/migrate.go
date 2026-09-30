package apicatalog

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ContractLockSettingKey holds when subscription price locks stop applying to
// /v1 image calls. Before the catalog, image calls quoted through the site
// task pricer and so honoured locks; the catalog prices the API itself, and
// the change is announced like a price increase.
const ContractLockSettingKey = "developer_api_contract_lock_until"

// ContractLockNotice is how long locks keep applying after the migration.
const ContractLockNotice = 7 * 24 * time.Hour

// MigrationKey is one API Key as the migration sees it: its former
// site-model allowlist (the dropped user_api_keys.allowed_model_ids column).
type MigrationKey struct {
	ID              string
	Label           string
	Owner           string
	AllowedModelIDs []string
}

// LegacyModel is what a site model said about /v1 before the catalog: the
// "developerApi" switch (absent meant on) and "developerApiMaxConcurrency"
// in the stored model configuration JSON. The fields are no longer part of
// modelconfig.Model; only the one-time migration reads them.
type LegacyModel struct {
	Offered        bool
	MaxConcurrency int
}

// Legacy maps site model ids to their former /v1 settings.
type Legacy map[string]LegacyModel

// Of returns a model's former settings; a model without them was offered.
func (l Legacy) Of(id string) LegacyModel {
	if model, ok := l[id]; ok {
		return model
	}
	return LegacyModel{Offered: true}
}

// ParseLegacy reads the former /v1 settings from stored model config JSON.
func ParseLegacy(raw []byte) Legacy {
	var stored struct {
		Models []struct {
			ID             string `json:"id"`
			Offered        *bool  `json:"developerApi"`
			MaxConcurrency int    `json:"developerApiMaxConcurrency"`
		} `json:"models"`
	}
	legacy := Legacy{}
	if json.Unmarshal(raw, &stored) != nil {
		return legacy
	}
	for _, model := range stored.Models {
		legacy[model.ID] = LegacyModel{Offered: model.Offered == nil || *model.Offered, MaxConcurrency: model.MaxConcurrency}
	}
	return legacy
}

// MigrationInput is everything BuildPlan reads.
type MigrationInput struct {
	Config   modelconfig.Config
	Legacy   Legacy
	Keys     []MigrationKey
	Policies []MigrationPolicy
}

// MigrationPolicy is one stored copy of a subscription policy.
type MigrationPolicy struct {
	Table  string // plans | subscriptions | subscription_credit_lots
	ID     string
	Policy store.SubscriptionPolicy
}

// Plan is the full migration, computed without touching the database so it
// can be reviewed (dry run) before it is applied.
type Plan struct {
	Entries  []*store.DeveloperAPIModel
	Keys     []KeyChange
	Policies []PolicyChange
	Notes    []string
}

type KeyChange struct {
	Key      MigrationKey
	Mapped   []string // catalog ids
	Merged   []string // site model ids folded into a live entry of the same name
	Dropped  []string // site model ids with no catalog entry
	Drafts   []string // catalog ids that are drafts (not callable until published)
	NoneLive bool     // restricted Key left without a callable model
}

type PolicyChange struct {
	Source     MigrationPolicy
	Updated    store.SubscriptionPolicy
	DroppedAPI bool // model-restricted plan whose models map to no API model
}

func modelByID(cfg modelconfig.Config) map[string]modelconfig.Model {
	byID := make(map[string]modelconfig.Model, len(cfg.Models))
	for _, model := range cfg.Models {
		byID[model.ID] = model
	}
	return byID
}

// BuildPlan maps today's /v1 behaviour onto catalog entries:
//   - every model /v1 offers today becomes a live entry under its current
//     public name, so no caller's code changes;
//   - a site model referenced by a Key or a plan but not offered today is
//     folded into the live entry with the same name and kind if there is one
//     (an older copy of the same model), dropped if it is disabled on the
//     site, and otherwise kept as a draft for an admin to review;
//   - Keys and subscription policies are rewritten to catalog ids.
func BuildPlan(in MigrationInput, now time.Time) Plan {
	cfg, legacy, keys, policies := in.Config, in.Legacy, in.Keys, in.Policies
	plan := Plan{}
	byID := modelByID(cfg)
	byTarget := map[string]*store.DeveloperAPIModel{}
	taken := map[string]bool{}
	published := now.UTC()

	for _, selected := range LegacyOffered(cfg, legacy) {
		kind, _ := KindOf(selected.Model)
		entry := &store.DeveloperAPIModel{
			ID: NewID(), APIName: strings.TrimSpace(selected.Model.Name), Aliases: []string{}, Kind: kind,
			TargetModelID: selected.Model.ID, Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFollow,
			MaxConcurrency: legacy.Of(selected.Model.ID).MaxConcurrency, Description: selected.Model.Description, PublishedAt: &published,
		}
		plan.Entries = append(plan.Entries, entry)
		byTarget[entry.TargetModelID] = entry
		taken[NormalizeName(entry.APIName)] = true
	}

	liveByName := map[string]*store.DeveloperAPIModel{}
	for _, entry := range plan.Entries {
		liveByName[entry.Kind+"|"+NormalizeName(entry.APIName)] = entry
	}
	// resolve returns the entry a referenced site model maps to; merged is true
	// when it was folded into a live entry of the same name.
	resolve := func(modelID string) (entry *store.DeveloperAPIModel, merged bool, ok bool) {
		if entry, ok := byTarget[modelID]; ok {
			return entry, false, true
		}
		model, ok := byID[modelID]
		if !ok {
			return nil, false, false
		}
		kind, ok := KindOf(model)
		if !ok {
			return nil, false, false
		}
		if live := liveByName[kind+"|"+NormalizeName(model.Name)]; live != nil {
			return live, true, true
		}
		if !model.Enabled {
			return nil, false, false
		}
		name := strings.TrimSpace(model.Name)
		if name == "" {
			name = model.ID
		}
		candidate := name
		for n := 2; taken[NormalizeName(candidate)]; n++ {
			candidate = fmt.Sprintf("%s-%d", name, n)
		}
		taken[NormalizeName(candidate)] = true
		entry = &store.DeveloperAPIModel{
			ID: NewID(), APIName: candidate, Aliases: []string{}, Kind: kind, TargetModelID: model.ID,
			Status: store.DeveloperAPIModelDraft, PriceMode: store.DeveloperAPIPriceFollow,
			MaxConcurrency: legacy.Of(model.ID).MaxConcurrency, Description: model.Description,
		}
		plan.Entries = append(plan.Entries, entry)
		byTarget[model.ID] = entry
		reason := draftReason(cfg, legacy, model)
		plan.Notes = append(plan.Notes, fmt.Sprintf("草稿「%s」→ 站内模型「%s」（%s）", candidate, name, reason))
		return entry, false, true
	}

	for _, key := range keys {
		if len(key.AllowedModelIDs) == 0 {
			continue
		}
		change := KeyChange{Key: key}
		seen := map[string]bool{}
		for _, modelID := range key.AllowedModelIDs {
			entry, merged, ok := resolve(modelID)
			if !ok {
				change.Dropped = append(change.Dropped, modelID)
				continue
			}
			if merged {
				change.Merged = append(change.Merged, modelID)
			}
			if seen[entry.ID] {
				continue
			}
			seen[entry.ID] = true
			change.Mapped = append(change.Mapped, entry.ID)
			if entry.Status == store.DeveloperAPIModelDraft {
				change.Drafts = append(change.Drafts, entry.ID)
			}
		}
		change.NoneLive = len(change.Mapped) == len(change.Drafts)
		plan.Keys = append(plan.Keys, change)
	}

	for _, source := range policies {
		policy := source.Policy
		updated := policy
		changed := false
		if len(policy.FeatureKeys) > 0 {
			features := append([]string{}, policy.FeatureKeys...)
			if store.Contains(policy.FeatureKeys, "text_to_image") && !store.Contains(features, FeatureImage) {
				features = append(features, FeatureImage)
				changed = true
			}
			if store.Contains(policy.FeatureKeys, "ai_assistant") && !store.Contains(features, FeatureChat) {
				features = append(features, FeatureChat)
				changed = true
			}
			updated.FeatureKeys = features
		}
		dropped := false
		if len(policy.ModelIDs) > 0 && store.Contains(policy.Channels, "api") {
			apiIDs := []string{}
			for _, modelID := range policy.ModelIDs {
				if entry, _, ok := resolve(modelID); ok && !store.Contains(apiIDs, entry.ID) {
					apiIDs = append(apiIDs, entry.ID)
				}
			}
			updated.APIModelIDs = apiIDs
			dropped = len(apiIDs) == 0
			changed = true
		}
		if changed {
			plan.Policies = append(plan.Policies, PolicyChange{Source: source, Updated: updated, DroppedAPI: dropped})
		}
	}
	return plan
}

func draftReason(cfg modelconfig.Config, legacy Legacy, model modelconfig.Model) string {
	reasons := []string{}
	if !legacy.Of(model.ID).Offered {
		reasons = append(reasons, "未开启开发者 API")
	}
	if !model.Enabled {
		reasons = append(reasons, "站内已停用")
	}
	if !model.Available() {
		reasons = append(reasons, "维护中")
	}
	routed := false
	for _, provider := range cfg.Providers {
		if provider.ID == model.ProviderID {
			routed = provider.Enabled && provider.Adapter == modelconfig.AdapterOpenAI
		}
	}
	if !routed {
		reasons = append(reasons, "线路不是 OpenAI 协议或已停用")
	}
	workspace := modelconfig.WorkspaceT2I
	if model.Kind == modelconfig.ModelKindChat {
		workspace = modelconfig.WorkspaceAssistant
	}
	bound := false
	for _, selected := range modelconfig.PublicModelsForWorkspace(cfg, workspace, model.Kind) {
		if selected.Model.ID == model.ID {
			bound = true
		}
	}
	if !bound {
		label := "文生图"
		if workspace == modelconfig.WorkspaceAssistant {
			label = "AI 助手"
		}
		reasons = append(reasons, "未绑定「"+label+"」")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "与已开放模型同名")
	}
	return strings.Join(reasons, "、")
}

// Report renders the plan for review in Chinese.
func (p Plan) Report(cfg modelconfig.Config) string {
	var b strings.Builder
	byEntry := map[string]*store.DeveloperAPIModel{}
	live, draft := []*store.DeveloperAPIModel{}, []*store.DeveloperAPIModel{}
	for _, entry := range p.Entries {
		byEntry[entry.ID] = entry
		if entry.Status == store.DeveloperAPIModelLive {
			live = append(live, entry)
		} else {
			draft = append(draft, entry)
		}
	}
	byID := modelByID(cfg)
	targetName := func(id string) string {
		if model, ok := byID[id]; ok {
			return model.Name
		}
		return id
	}
	fmt.Fprintf(&b, "开发者 API 模型目录迁移报告\n\n")
	fmt.Fprintf(&b, "一、上线（%d 个）：名称与现在 /v1 完全一致，调用方无需改动\n", len(live))
	for _, entry := range live {
		fmt.Fprintf(&b, "  - [%s] %s\n", kindLabel(entry.Kind), entry.APIName)
	}
	fmt.Fprintf(&b, "\n二、草稿（%d 个）：被 Key 或套餐引用、但现在 /v1 调不到，需要你确认后发布\n", len(draft))
	for _, note := range p.Notes {
		fmt.Fprintf(&b, "  - %s\n", note)
	}
	fmt.Fprintf(&b, "\n三、Key（%d 把设置了指定模型）\n", len(p.Keys))
	sorted := append([]KeyChange{}, p.Keys...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].NoneLive && !sorted[j].NoneLive })
	for _, change := range sorted {
		names := func(ids []string, draftOnly bool) []string {
			out := []string{}
			for _, id := range ids {
				if entry := byEntry[id]; entry != nil && (entry.Status == store.DeveloperAPIModelDraft) == draftOnly {
					out = append(out, entry.APIName)
				}
			}
			return out
		}
		status := "正常"
		if change.NoneLive {
			status = "⚠ 迁移后仍无可调用模型"
		}
		fmt.Fprintf(&b, "  - 「%s」%s：%s\n", change.Key.Label, change.Key.Owner, status)
		if liveNames := names(change.Mapped, false); len(liveNames) > 0 {
			fmt.Fprintf(&b, "      可调用：%s\n", strings.Join(liveNames, "、"))
		}
		if draftNames := names(change.Mapped, true); len(draftNames) > 0 {
			fmt.Fprintf(&b, "      映射到草稿（发布后可调用）：%s\n", strings.Join(draftNames, "、"))
		}
		if len(change.Merged) > 0 {
			merged := []string{}
			for _, id := range change.Merged {
				merged = append(merged, targetName(id))
			}
			fmt.Fprintf(&b, "      归并到同名上线模型（旧条目已停用）：%s\n", strings.Join(merged, "、"))
		}
		if len(change.Dropped) > 0 {
			dropped := []string{}
			for _, id := range change.Dropped {
				dropped = append(dropped, targetName(id))
			}
			fmt.Fprintf(&b, "      移除（站内已停用、/v1 不支持或已删除）：%s\n", strings.Join(dropped, "、"))
		}
	}
	fmt.Fprintf(&b, "\n四、订阅策略（%d 份需要改写）\n", len(p.Policies))
	if len(p.Policies) == 0 {
		fmt.Fprintf(&b, "  - 没有限定模型或功能的套餐与订阅，无需改写\n")
	}
	for _, change := range p.Policies {
		line := fmt.Sprintf("  - %s %s", change.Source.Table, change.Source.ID)
		if change.DroppedAPI {
			line += "：限定的模型都不在 API 目录中，API 渠道将无可用模型"
		}
		fmt.Fprintln(&b, line)
	}
	fmt.Fprintf(&b, "\n五、其他\n")
	fmt.Fprintf(&b, "  - API 调用改用专用功能标识，体验积分不再用于 API\n")
	fmt.Fprintf(&b, "  - 订阅锁价对 API 生图再保留 %d 天，之后按目录价格扣费；执行时给近 30 天用过 API 生图的订阅用户发站内消息\n", int(ContractLockNotice.Hours()/24))
	return b.String()
}

func kindLabel(kind string) string {
	if kind == "chat" {
		return "对话"
	}
	return "图片"
}

// LoadMigrationInput reads what BuildPlan needs. The legacy Key allowlist
// column is gone once migration 00174 has run; the catalog is built before
// that (see BackfillSchemaVersion), and afterwards no Key has one.
func LoadMigrationInput(ctx context.Context, q store.Q) (MigrationInput, error) {
	in := MigrationInput{Legacy: Legacy{}, Keys: []MigrationKey{}}
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return in, err
	}
	in.Config = cfg
	raw, err := store.GetAppSetting(ctx, q, modelconfig.SettingKey)
	if err != nil {
		return in, err
	}
	in.Legacy = ParseLegacy(raw)
	var hasColumn bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema=current_schema() AND table_name='user_api_keys' AND column_name='allowed_model_ids')`).Scan(&hasColumn); err != nil {
		return in, err
	}
	if hasColumn {
		rows, err := q.Query(ctx, `SELECT k.id::text,k.label,COALESCE(u.email,''),k.allowed_model_ids
			FROM user_api_keys k LEFT JOIN users u ON u.id=k.user_id
			WHERE k.status<>'revoked' ORDER BY k.created_at`)
		if err != nil {
			return in, err
		}
		for rows.Next() {
			var key MigrationKey
			if err := rows.Scan(&key.ID, &key.Label, &key.Owner, &key.AllowedModelIDs); err != nil {
				rows.Close()
				return in, err
			}
			in.Keys = append(in.Keys, key)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return in, err
		}
	}
	policies := []MigrationPolicy{}
	for _, source := range []struct{ table, query string }{
		{"plans", `SELECT id::text,subscription_policy FROM plans WHERE subscription_policy IS NOT NULL`},
		{"subscriptions", `SELECT id::text,policy_snapshot FROM subscriptions WHERE policy_snapshot IS NOT NULL`},
		{"subscription_credit_lots", `SELECT id::text,policy FROM subscription_credit_lots WHERE available_points>0 OR frozen_points>0`},
	} {
		rows, err := q.Query(ctx, source.query)
		if err != nil {
			return in, err
		}
		for rows.Next() {
			var id string
			var raw []byte
			if err := rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return in, err
			}
			var policy store.SubscriptionPolicy
			if len(raw) == 0 || json.Unmarshal(raw, &policy) != nil {
				continue
			}
			policies = append(policies, MigrationPolicy{Table: source.table, ID: id, Policy: policy})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return in, err
		}
	}
	in.Policies = policies
	return in, nil
}

// Apply writes the plan in one transaction. It refuses to run twice.
func Apply(ctx context.Context, tx pgx.Tx, cfg modelconfig.Config, plan Plan, now time.Time) error {
	count, err := store.CountDeveloperAPIModels(ctx, tx)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("API 模型目录已有 %d 个条目，迁移只能执行一次", count)
	}
	for _, entry := range plan.Entries {
		if _, err := store.InsertDeveloperAPIModel(ctx, tx, entry); err != nil {
			return fmt.Errorf("写入 API 模型 %s: %w", entry.APIName, err)
		}
		if err := store.InsertDeveloperAPIModelEvent(ctx, tx, entry.ID, nil, "migrate", "目录初始化", nil, entry); err != nil {
			return err
		}
	}
	for _, change := range plan.Keys {
		mapped := change.Mapped
		if mapped == nil {
			mapped = []string{}
		}
		if _, err := tx.Exec(ctx, `UPDATE user_api_keys SET allowed_api_model_ids=$2,updated_at=now() WHERE id=$1::uuid`, change.Key.ID, mapped); err != nil {
			return err
		}
	}
	for _, change := range plan.Policies {
		raw, err := json.Marshal(change.Updated)
		if err != nil {
			return err
		}
		column := map[string]string{"plans": "subscription_policy", "subscriptions": "policy_snapshot", "subscription_credit_lots": "policy"}[change.Source.Table]
		if _, err := tx.Exec(ctx, `UPDATE `+change.Source.Table+` SET `+column+`=$2 WHERE id=$1::uuid`, change.Source.ID, raw); err != nil {
			return err
		}
	}
	// Existing call history keeps the name the model had when it was called.
	names := map[string]string{}
	for _, model := range cfg.Models {
		names[model.ID] = strings.TrimSpace(model.Name)
	}
	for id, name := range names {
		if _, err := tx.Exec(ctx, `UPDATE developer_api_billing_requests r SET api_model_name=$2
			FROM usage_profit_ledger p WHERE p.source_id=r.billing_id AND p.model_id=$1 AND r.api_model_name IS NULL`, id, name); err != nil {
			return err
		}
	}
	until := now.UTC().Add(ContractLockNotice)
	lockUntil, _ := json.Marshal(until)
	if err := store.SetAppSetting(ctx, tx, ContractLockSettingKey, lockUntil, now.UTC()); err != nil {
		return err
	}
	return notifyContractLockEnd(ctx, tx, now, until)
}

// notifyContractLockEnd tells subscribers who used /v1 image calls in the
// last 30 days that subscription price locks stop covering the API.
func notifyContractLockEnd(ctx context.Context, tx pgx.Tx, now, until time.Time) error {
	rows, err := tx.Query(ctx, `SELECT DISTINCT r.user_id FROM developer_api_billing_requests r
		JOIN subscriptions s ON s.user_id=r.user_id AND s.status='active' AND s.ends_at > $1
		WHERE r.source_type=$2 AND r.status='succeeded' AND r.created_at > $1::timestamptz - interval '30 days' AND r.user_id IS NOT NULL`,
		now.UTC(), store.DeveloperAPIImageLedgerSource)
	if err != nil {
		return err
	}
	users := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		users = append(users, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	date := until.In(time.FixedZone("CST", 8*3600)).Format("2006年1月2日 15:04")
	body := "开发者 API 生图目前按订阅锁定的价格扣费。自 " + date + "（北京时间）起，API 调用将统一按开发者控制台「模型」页显示的价格扣费，不再享受订阅锁价；站内创作的锁价不受影响。"
	for _, id := range users {
		userID := id
		if err := store.InsertNotification(ctx, tx, &userID, "system", "开发者 API 价格调整通知", &body); err != nil {
			return err
		}
	}
	return nil
}
