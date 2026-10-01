package apicatalog

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Lifecycle and scheduled pricing (docs/DEVELOPER_API_MODEL_CATALOG.md
// sections 5 and 6.4). Request paths evaluate both lazily from the stored
// fields, so a late sweep never lets a retired model run or an announced
// price apply early; Reconcile records what came due and sends notices.

const (
	// DeprecationNoticeSettingKey holds the minimum days between deprecating
	// an API model and its sunset.
	DeprecationNoticeSettingKey  = "developer_api_deprecation_notice_days"
	DefaultDeprecationNoticeDays = 7
	MaxDeprecationNoticeDays     = 365
	// PriceIncreaseNotice is how long an announced increase waits.
	PriceIncreaseNotice = 7 * 24 * time.Hour
	// RetiredHiddenAfter hides retired entries from the console model page.
	RetiredHiddenAfter = 90 * 24 * time.Hour
)

var beijing = time.FixedZone("CST", 8*3600)

// FormatBeijing renders a time the way notices show it.
func FormatBeijing(t time.Time) string {
	return t.In(beijing).Format("2006年1月2日 15:04")
}

// DeprecationNoticeDays reads the configured notice period.
func DeprecationNoticeDays(ctx context.Context, q store.Q) (int, error) {
	raw, err := store.GetAppSetting(ctx, q, DeprecationNoticeSettingKey)
	if err != nil || len(raw) == 0 {
		return DefaultDeprecationNoticeDays, err
	}
	var days int
	if json.Unmarshal(raw, &days) != nil || days < 1 || days > MaxDeprecationNoticeDays {
		return DefaultDeprecationNoticeDays, nil
	}
	return days, nil
}

// SetDeprecationNoticeDays stores the notice period.
func SetDeprecationNoticeDays(ctx context.Context, q store.Q, days int) error {
	if days < 1 || days > MaxDeprecationNoticeDays {
		return fmt.Errorf("弃用预告期须为 1-%d 天", MaxDeprecationNoticeDays)
	}
	return store.SetAppSetting(ctx, q, DeprecationNoticeSettingKey, []byte(strconv.Itoa(days)), time.Now().UTC())
}

// EffectivePrice is the per-call price at now for a given site price.
// A fixed entry charges its price, or the pending one once due. A following
// entry charges the lower of the site price and its committed price (the
// pending one once due): site decreases apply at once, increases only after
// their notice.
func EffectivePrice(entry *store.DeveloperAPIModel, site int64, now time.Time) int64 {
	pendingDue := entry.PendingPriceCents != nil && entry.PendingPriceAt != nil && !now.Before(*entry.PendingPriceAt)
	if entry.PriceMode == store.DeveloperAPIPriceFixed {
		if pendingDue {
			return *entry.PendingPriceCents
		}
		if entry.PriceCents != nil {
			return *entry.PriceCents
		}
		return site
	}
	base := site
	if entry.CommittedPriceCents != nil {
		base = *entry.CommittedPriceCents
	}
	if pendingDue {
		base = *entry.PendingPriceCents
	}
	return min(base, site)
}

// UpcomingPrice is an announced change that has not taken effect yet.
func UpcomingPrice(entry *store.DeveloperAPIModel, now time.Time) (int64, time.Time, bool) {
	if entry.PendingPriceCents == nil || entry.PendingPriceAt == nil || !now.Before(*entry.PendingPriceAt) {
		return 0, time.Time{}, false
	}
	return *entry.PendingPriceCents, *entry.PendingPriceAt, true
}

// SettlePrice brings an entry's pricing fields up to date against the site
// price, holding increases for an in-service entry behind PriceIncreaseNotice.
// current is what the entry charged before this change (its effective price
// at now); for a new or unpublished entry pass the target price. It reports
// whether a new increase was announced.
//
// For a fixed entry, target is the requested price; for a following entry it
// is the site price.
func SettlePrice(entry *store.DeveloperAPIModel, current, target int64, inService bool, now time.Time) bool {
	if !inService || target <= current {
		entry.PendingPriceCents, entry.PendingPriceAt = nil, nil
		setCharged(entry, target)
		return false
	}
	setCharged(entry, current)
	if entry.PendingPriceCents != nil && entry.PendingPriceAt != nil && now.Before(*entry.PendingPriceAt) && target <= *entry.PendingPriceCents {
		// A smaller increase than announced keeps the announced date.
		price := target
		entry.PendingPriceCents = &price
		return false
	}
	price, at := target, now.Add(PriceIncreaseNotice)
	entry.PendingPriceCents, entry.PendingPriceAt = &price, &at
	return true
}

func setCharged(entry *store.DeveloperAPIModel, price int64) {
	value := price
	if entry.PriceMode == store.DeveloperAPIPriceFixed {
		entry.PriceCents = &value
		entry.CommittedPriceCents = nil
		return
	}
	entry.CommittedPriceCents = &value
}

// ReconcileResult counts what a sweep changed.
type ReconcileResult struct {
	Retired   int
	Announced int
	Applied   int
}

// Reconcile retires entries past their sunset, applies due prices, follows
// site price changes (announcing increases), and notifies affected users.
// It runs every minute from the worker and after model configuration saves.
func Reconcile(ctx context.Context, pool *pgxpool.Pool, now time.Time) (ReconcileResult, error) {
	var result ReconcileResult
	cfg, err := modelconfig.Load(ctx, pool)
	if err != nil {
		return result, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	entries, err := store.LockDeveloperAPIModels(ctx, tx)
	if err != nil {
		return result, err
	}
	names := map[string]string{}
	for _, entry := range entries {
		names[entry.ID] = entry.APIName
	}
	for _, entry := range entries {
		before := *entry
		changed, err := reconcileEntry(ctx, tx, cfg, entry, names, now, &result)
		if err != nil {
			return result, err
		}
		if !changed {
			continue
		}
		if _, err := store.UpdateDeveloperAPIModel(ctx, tx, entry); err != nil {
			return result, err
		}
		action := "reconcile"
		if before.Status != entry.Status {
			action = "auto_retire"
		}
		if err := store.InsertDeveloperAPIModelEvent(ctx, tx, entry.ID, nil, action, "", &before, entry); err != nil {
			return result, err
		}
	}
	return result, tx.Commit(ctx)
}

func reconcileEntry(ctx context.Context, tx pgx.Tx, cfg modelconfig.Config, entry *store.DeveloperAPIModel, names map[string]string, now time.Time, result *ReconcileResult) (bool, error) {
	if entry.Status == store.DeveloperAPIModelRetired {
		return false, nil
	}
	if entry.StatusAt(now) == store.DeveloperAPIModelRetired {
		entry.Status = store.DeveloperAPIModelRetired
		retired := *entry.SunsetAt
		entry.RetiredAt = &retired
		entry.PendingPriceCents, entry.PendingPriceAt = nil, nil
		result.Retired++
		return true, NotifyRetired(ctx, tx, entry, names, now)
	}
	model, found := siteModelOK(cfg, entry.TargetModelID)
	if !found {
		return false, nil
	}
	site := SitePrice(cfg, entry, model)
	snapshot := priceFields(entry)
	current := EffectivePrice(entry, site, now)
	if entry.PendingPriceAt != nil && !now.Before(*entry.PendingPriceAt) {
		result.Applied++
		entry.PendingPriceCents, entry.PendingPriceAt = nil, nil
		setCharged(entry, current)
	}
	target := site
	if entry.PriceMode == store.DeveloperAPIPriceFixed {
		target = current
		if pending, _, ok := UpcomingPrice(entry, now); ok {
			target = pending
		}
	}
	announced := SettlePrice(entry, current, target, entry.InServiceAt(now), now)
	if announced {
		result.Announced++
		if err := NotifyPriceIncrease(ctx, tx, entry, current, now); err != nil {
			return false, err
		}
	}
	return snapshot != priceFields(entry), nil
}

func siteModelOK(cfg modelconfig.Config, id string) (modelconfig.Model, bool) {
	for _, model := range cfg.Models {
		if model.ID == id {
			return model, true
		}
	}
	return modelconfig.Model{}, false
}

func priceFields(entry *store.DeveloperAPIModel) string {
	value := func(v *int64) string {
		if v == nil {
			return "-"
		}
		return strconv.FormatInt(*v, 10)
	}
	at := "-"
	if entry.PendingPriceAt != nil {
		at = entry.PendingPriceAt.UTC().Format(time.RFC3339Nano)
	}
	return value(entry.PriceCents) + "|" + value(entry.CommittedPriceCents) + "|" + value(entry.PendingPriceCents) + "|" + at
}

func notify(ctx context.Context, q store.Q, entry *store.DeveloperAPIModel, now time.Time, title, body string) error {
	users, err := store.DeveloperAPIModelAudience(ctx, q, entry.ID, now)
	if err != nil {
		return err
	}
	for _, id := range users {
		userID := id
		if err := store.InsertNotification(ctx, q, &userID, "system", title, &body); err != nil {
			return err
		}
	}
	return nil
}

func replacementNote(entry *store.DeveloperAPIModel, names map[string]string) string {
	if entry.ReplacementID == nil || names[*entry.ReplacementID] == "" {
		return ""
	}
	return "，建议改用「" + names[*entry.ReplacementID] + "」"
}

// NotifyPriceIncrease tells users of an entry about an announced increase.
func NotifyPriceIncrease(ctx context.Context, q store.Q, entry *store.DeveloperAPIModel, current int64, now time.Time) error {
	body := fmt.Sprintf("API 调用模型「%s」将于 %s（北京时间）起由 %d 积分/次调整为 %d 积分/次，此前的调用仍按原价计费。详情见API 调用控制台「模型」页。",
		entry.APIName, FormatBeijing(*entry.PendingPriceAt), current, *entry.PendingPriceCents)
	return notify(ctx, q, entry, now, "API 调用价格调整预告", body)
}

// NotifyDeprecated tells users of an entry about its planned retirement.
func NotifyDeprecated(ctx context.Context, q store.Q, entry *store.DeveloperAPIModel, names map[string]string, now time.Time) error {
	body := fmt.Sprintf("API 调用模型「%s」将于 %s（北京时间）下线%s。下线后调用会返回 410 错误，请在此之前更新代码中的 model 参数和 Key 的指定模型。",
		entry.APIName, FormatBeijing(*entry.SunsetAt), replacementNote(entry, names))
	return notify(ctx, q, entry, now, "API 调用模型下线预告", body)
}

// NotifyRetired tells users of an entry that it has stopped.
func NotifyRetired(ctx context.Context, q store.Q, entry *store.DeveloperAPIModel, names map[string]string, now time.Time) error {
	body := fmt.Sprintf("API 调用模型「%s」已下线，调用会返回 410 错误%s。", entry.APIName, replacementNote(entry, names))
	return notify(ctx, q, entry, now, "API 调用模型已下线", body)
}
