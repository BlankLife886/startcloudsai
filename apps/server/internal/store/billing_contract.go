package store

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"time"
)

type BillingContract struct {
	ConcurrencyBonus     *int      `json:"concurrencyBonus,omitempty"`
	ID                   uuid.UUID `json:"id"`
	PriceBookID          string    `json:"priceBookId"`
	CapturedAt           time.Time `json:"capturedAt"`
	PlanRevision         int       `json:"planRevision"`
	TaskConcurrency      int       `json:"taskConcurrency,omitempty"`
	AssistantConcurrency int       `json:"assistantConcurrency,omitempty"`
	LockModelPrices      bool      `json:"lockModelPrices"`
	AllowTopupPriceLock  bool      `json:"allowTopupPriceLock"`
}

func (c *BillingContract) CoversEntitlements(old *BillingContract) bool {
	return old == nil || c != nil && c.ExtraConcurrency() >= old.ExtraConcurrency() && (!old.LockModelPrices || c.LockModelPrices) && (!old.AllowTopupPriceLock || c.AllowTopupPriceLock)
}

func (c BillingContract) ExtraConcurrency() int {
	if c.ConcurrencyBonus != nil {
		return max(*c.ConcurrencyBonus, 0)
	}
	// Preserve the combined capacity of legacy contracts without rewriting their price books.
	return max(c.TaskConcurrency+c.AssistantConcurrency-DefaultUserConcurrency, 0)
}

func (c BillingContract) MarshalJSON() ([]byte, error) {
	type contract BillingContract
	normalized := contract(c)
	bonus := c.ExtraConcurrency()
	normalized.ConcurrencyBonus = &bonus
	return json.Marshal(normalized)
}

type BillingDecision struct {
	ConcurrencyBonus     int        `json:"concurrencyBonus"`
	ConcurrencyLimit     int        `json:"concurrencyLimit"`
	SubscriptionID       *uuid.UUID `json:"subscriptionId,omitempty"`
	ContractID           *uuid.UUID `json:"contractId,omitempty"`
	PriceBookID          string     `json:"priceBookId,omitempty"`
	Source               string     `json:"source"`
	PublicUnitPoints     int64      `json:"publicUnitPoints"`
	UnitPoints           int64      `json:"unitPoints"`
	Count                int64      `json:"count"`
	SubscriptionPoints   int64      `json:"subscriptionPoints"`
	TopupPoints          int64      `json:"topupPoints"`
	TrialPoints          int64      `json:"trialPoints"`
	OtherPoints          int64      `json:"otherPoints"`
	TaskConcurrency      int        `json:"taskConcurrency,omitempty"`
	AssistantConcurrency int        `json:"assistantConcurrency,omitempty"`
	Reason               string     `json:"reason,omitempty"`
}

type billingDecisionKey struct{}
type billingChannelKey struct{}

func WithBillingChannel(ctx context.Context, channel string) context.Context {
	return context.WithValue(ctx, billingChannelKey{}, channel)
}
func BillingChannel(ctx context.Context) string {
	value, _ := ctx.Value(billingChannelKey{}).(string)
	if value == "" {
		return "web"
	}
	return value
}
func WithBillingDecision(ctx context.Context, d *BillingDecision) context.Context {
	return context.WithValue(ctx, billingDecisionKey{}, d)
}
func BillingDecisionFrom(ctx context.Context) *BillingDecision {
	d, _ := ctx.Value(billingDecisionKey{}).(*BillingDecision)
	return d
}

func ActiveBillingSubscription(ctx context.Context, q Q, userID uuid.UUID, locked bool) (*Subscription, error) {
	sql := `SELECT ` + subscriptionCols + ` FROM subscriptions s WHERE user_id=$1 AND status='active' AND starts_at<=$2 AND ends_at>$2 AND billing_contract IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=s.id AND c.status IN ('reviewing','processing','pending')) ORDER BY created_at DESC LIMIT 1`
	if locked {
		sql += ` FOR UPDATE OF s`
	}
	sub, err := scanSubscription(q.QueryRow(ctx, sql, userID, BillingTime(ctx)))
	return nilOnNoRows(sub, err)
}

func SaveBillingDecision(ctx context.Context, q Q, userID uuid.UUID, sourceType, sourceID string, d *BillingDecision) error {
	if d == nil {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO billing_decisions(user_id,source_type,source_id,subscription_id,contract_id,price_book_id,snapshot) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7) ON CONFLICT(source_type,source_id) DO UPDATE SET snapshot=EXCLUDED.snapshot`, userID, sourceType, sourceID, d.SubscriptionID, d.ContractID, d.PriceBookID, d)
	return err
}

func ListPlanVersions(ctx context.Context, q Q, id uuid.UUID) ([]json.RawMessage, error) {
	rows, err := q.Query(ctx, `SELECT snapshot FROM plan_versions WHERE plan_id=$1 ORDER BY revision DESC LIMIT 100`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, rows.Err()
}
