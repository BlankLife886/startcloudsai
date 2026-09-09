package contractpricing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

// Only billing rules are copied. Provider credentials, prompts and upstream costs never enter a price book.
func Capture(ctx context.Context, q store.Q, policy store.SubscriptionPolicy, revision int, at time.Time) (*store.BillingContract, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	book := modelconfig.Config{Version: 1, Workspaces: map[string]modelconfig.WorkspaceBinding{}}
	for _, m := range cfg.Models {
		if !m.Public || !m.Enabled {
			continue
		}
		item := modelconfig.Model{ID: m.ID, Name: m.Name, Kind: m.Kind, Tool: m.Tool, UpstreamModel: m.UpstreamModel, PriceCents: m.PriceCents, DiscountPriceCents: m.DiscountPriceCents, ReasoningPricing: m.ReasoningPricing, SupportedReasoningEfforts: m.SupportedReasoningEfforts}
		if m.ImageUpscalePricing != nil {
			p := *m.ImageUpscalePricing
			p.HighUpstreamCostCents = 0
			item.ImageUpscalePricing = &p
		}
		book.Models = append(book.Models, item)
	}
	sort.Slice(book.Models, func(i, j int) bool { return book.Models[i].ID < book.Models[j].ID })
	for key, w := range cfg.Workspaces {
		book.Workspaces[key] = modelconfig.WorkspaceBinding{ModelPricing: w.ModelPricing}
	}
	raw, err := json.Marshal(book)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	id := hex.EncodeToString(hash[:])
	if _, err := q.Exec(ctx, `INSERT INTO billing_price_books(id,snapshot) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, json.RawMessage(raw)); err != nil {
		return nil, err
	}
	bonus := policy.ExtraConcurrency()
	if bonus < 0 || bonus > 1000 {
		return nil, fmt.Errorf("invalid subscription concurrency bonus")
	}
	return &store.BillingContract{ID: uuid.New(), PriceBookID: id, CapturedAt: at, PlanRevision: revision, ConcurrencyBonus: &bonus, LockModelPrices: policy.ModelPricesLocked(), AllowTopupPriceLock: policy.AllowTopupPriceLock}, nil
}

type Request struct {
	UserID                                                                uuid.UUID
	Feature, Workspace, ModelID, Channel, ReasoningScope, ReasoningEffort string
	PublicUnitPoints, Count                                               int64
	InputLongEdge                                                         int
	ScaleFactor                                                           float64
}

func Resolve(ctx context.Context, q store.Q, in Request) (*store.BillingDecision, error) {
	d := &store.BillingDecision{Source: "public", PublicUnitPoints: in.PublicUnitPoints, UnitPoints: in.PublicUnitPoints, Count: in.Count}
	if in.UserID == uuid.Nil {
		return d, nil
	}
	base, err := store.BaseUserConcurrency(ctx, q)
	if err != nil {
		return nil, err
	}
	d.ConcurrencyLimit = base
	sub, err := store.ActiveBillingSubscription(ctx, q, in.UserID, true)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return d, nil
	}
	c := sub.Contract
	d.SubscriptionID = &sub.ID
	d.ContractID = &c.ID
	d.ConcurrencyBonus = c.ExtraConcurrency()
	d.ConcurrencyLimit = base + d.ConcurrencyBonus
	if !c.LockModelPrices || !sub.Policy.Allows(in.Feature, in.Channel, in.ModelID) {
		d.Reason = "订阅不包含本次锁价权益"
		return d, nil
	}
	var book modelconfig.Config
	if err := q.QueryRow(ctx, `SELECT snapshot FROM billing_price_books WHERE id=$1`, c.PriceBookID).Scan(&book); err != nil {
		return nil, err
	}
	var model *modelconfig.Model
	for i := range book.Models {
		if book.Models[i].ID == in.ModelID {
			model = &book.Models[i]
			break
		}
	}
	if model == nil {
		d.Reason = "该模型不在原订阅价格保护范围内，采用当前价格"
		return d, nil
	}
	price := modelconfig.ResolveWorkspacePrice(book, in.Workspace, *model)
	if model.Tool == modelconfig.ImageToolUpscale {
		price = modelconfig.ResolveImageUpscalePrice(*model, in.InputLongEdge, in.ScaleFactor)
	}
	unit := price.EffectiveCents
	if in.ReasoningScope != "" && !price.Overridden {
		unit = modelconfig.ResolveReasoningPrice(*model, in.ReasoningEffort, in.ReasoningScope).EffectiveCents
	}
	if unit < 0 || in.Count <= 0 || unit > 1000000000/in.Count {
		return d, nil
	}
	var normal, subAvailable, eligible int64
	if err := q.QueryRow(ctx, `SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, in.UserID).Scan(&normal); err != nil {
		return nil, err
	}
	if err := store.ExpireSubscriptionCredits(ctx, q, in.UserID, store.BillingTime(ctx)); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE subscription_id=$1 AND NOT refund_hold AND NOT upgrade_hold AND expires_at>$2`, sub.ID, store.BillingTime(ctx)).Scan(&subAvailable); err != nil {
		return nil, err
	}
	if c.AllowTopupPriceLock {
		if err := q.QueryRow(ctx, `SELECT COALESCE(sum(available_points),0) FROM topup_credit_lots WHERE user_id=$1 AND price_lock_eligible`, in.UserID).Scan(&eligible); err != nil {
			return nil, err
		}
	}
	if subAvailable+min(normal, eligible) < unit*in.Count {
		d.Reason = "锁价余额不足或额度包不符合资格，采用当前价格"
		return d, nil
	}
	d.Source = "subscription_contract"
	d.UnitPoints = unit
	d.PriceBookID = c.PriceBookID
	return d, nil
}
