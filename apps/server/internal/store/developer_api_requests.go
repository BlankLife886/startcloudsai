package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Developer API direct-request billing states. A request is pending while the
// gateway waits for the upstream, and expired once the reclaim job has
// released an abandoned reservation.
const (
	DeveloperAPIRequestPending   = "pending"
	DeveloperAPIRequestSucceeded = "succeeded"
	DeveloperAPIRequestFailed    = "failed"
	DeveloperAPIRequestExpired   = "expired"
)

type DeveloperAPIRequest struct {
	BillingID    string
	SourceType   string
	UserID       *uuid.UUID
	APIKeyID     *uuid.UUID
	UsageEventID *uuid.UUID
	PriceCents   int64
	Status       string
	ExpiresAt    time.Time
	SettledAt    *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

const developerAPIRequestCols = `billing_id,source_type,user_id,api_key_id,usage_event_id,
	price_cents,status,expires_at,settled_at,created_at,updated_at`

func scanDeveloperAPIRequest(row interface{ Scan(...any) error }) (*DeveloperAPIRequest, error) {
	var item DeveloperAPIRequest
	err := row.Scan(&item.BillingID, &item.SourceType, &item.UserID, &item.APIKeyID, &item.UsageEventID,
		&item.PriceCents, &item.Status, &item.ExpiresAt,
		&item.SettledAt, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// LockDeveloperAPIRequest reads a request state row under FOR UPDATE. It
// returns nil when the billing id has never been recorded.
func LockDeveloperAPIRequest(ctx context.Context, q Q, billingID string) (*DeveloperAPIRequest, error) {
	item, err := scanDeveloperAPIRequest(q.QueryRow(ctx, `SELECT `+developerAPIRequestCols+`
		FROM developer_api_billing_requests WHERE billing_id=$1 FOR UPDATE`, billingID))
	return nilOnNoRows(item, err)
}

func GetDeveloperAPIRequest(ctx context.Context, q Q, billingID string) (*DeveloperAPIRequest, error) {
	item, err := scanDeveloperAPIRequest(q.QueryRow(ctx, `SELECT `+developerAPIRequestCols+`
		FROM developer_api_billing_requests WHERE billing_id=$1`, billingID))
	return nilOnNoRows(item, err)
}

func InsertDeveloperAPIRequest(ctx context.Context, q Q, item DeveloperAPIRequest) error {
	_, err := q.Exec(ctx, `INSERT INTO developer_api_billing_requests
		(billing_id,source_type,user_id,api_key_id,usage_event_id,price_cents,status,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		item.BillingID, item.SourceType, item.UserID, item.APIKeyID, item.UsageEventID,
		max(item.PriceCents, 0), item.Status, item.ExpiresAt)
	return err
}

// MarkDeveloperAPIRequest records a request's final state. settled_at is set
// when the request succeeds.
func MarkDeveloperAPIRequest(ctx context.Context, q Q, billingID, status string) error {
	_, err := q.Exec(ctx, `UPDATE developer_api_billing_requests
		SET status=$2,
		    settled_at=CASE WHEN $2='succeeded' THEN COALESCE(settled_at, now()) ELSE settled_at END,
		    updated_at=now()
		WHERE billing_id=$1`, billingID, status)
	return err
}

// ListExpiredDeveloperAPIRequests returns pending requests whose process never
// finished them. Callers must re-check each row under LockDeveloperAPIRequest.
func ListExpiredDeveloperAPIRequests(ctx context.Context, q Q, now time.Time, limit int) ([]*DeveloperAPIRequest, error) {
	rows, err := q.Query(ctx, `SELECT `+developerAPIRequestCols+`
		FROM developer_api_billing_requests
		WHERE status='pending' AND expires_at < $1
		ORDER BY expires_at LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*DeveloperAPIRequest, 0)
	for rows.Next() {
		item, err := scanDeveloperAPIRequest(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// DeleteAPIKeyUsageEvent removes a quota event for a request that definitely
// did not reach a billable result, so failed calls do not consume Key quota.
func DeleteAPIKeyUsageEvent(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM api_key_usage_events WHERE id=$1 AND task_id IS NULL`, id)
	return err
}

// MarkDeveloperAPIProfitEntry updates the profitability row of a direct
// developer-API request without rewriting its revenue or cost columns.
func MarkDeveloperAPIProfitEntry(ctx context.Context, q Q, billingID, status, errorCode string) error {
	_, err := q.Exec(ctx, `UPDATE usage_profit_ledger
		SET event_status=$2,
		    revenue_cents=CASE WHEN $2='succeeded' THEN revenue_cents ELSE 0 END,
		    upstream_cost_cents=CASE WHEN $2='succeeded' THEN upstream_cost_cents ELSE 0 END,
		    metadata=metadata || jsonb_build_object('errorCode', $3::text)
		WHERE source_type=$4 AND source_id=$1`, billingID, status, errorCode, DeveloperAPIProfitSourceType)
	return err
}

// DeveloperAPICall is one /v1 request as the developer console shows it: what
// was called, with which Key, and what it cost. Upstream cost is not exposed.
type DeveloperAPICall struct {
	SourceType       string
	Status           string
	PriceCents       int64
	CreatedAt        time.Time
	KeyLabel         *string
	KeyPrefix        *string
	ModelID          string
	Units            int
	Operation        string
	ErrorCode        string
	Note             string
	PromptTokens     *int64
	CompletionTokens *int64
	TotalTokens      *int64
}

const developerAPICallWhere = ` FROM developer_api_billing_requests r
	WHERE r.user_id = $1 AND ($2::uuid IS NULL OR r.api_key_id = $2)`

func developerAPICallArgs(userID uuid.UUID, keyID *uuid.UUID) []any {
	return []any{userID, keyID}
}

// CountDeveloperAPICallsCapped counts the rows ListDeveloperAPICalls pages over.
func CountDeveloperAPICallsCapped(ctx context.Context, q Q, userID uuid.UUID, keyID *uuid.UUID) (CappedCount, error) {
	return countCapped(ctx, q, developerAPICallWhere, developerAPICallArgs(userID, keyID))
}

// ListDeveloperAPICalls returns a user's /v1 requests, newest first,
// optionally limited to one Key.
func ListDeveloperAPICalls(ctx context.Context, q Q, userID uuid.UUID, keyID *uuid.UUID, limit, offset int) ([]*DeveloperAPICall, error) {
	tokens := func(field string) string {
		return fmt.Sprintf(`CASE WHEN jsonb_typeof(p.metadata->'usage'->'%[1]s') = 'number'
			THEN (p.metadata->'usage'->>'%[1]s')::numeric::bigint END`, field)
	}
	args := append(developerAPICallArgs(userID, keyID), max(limit, 1), max(offset, 0))
	rows, err := q.Query(ctx, `SELECT r.source_type, r.status, r.price_cents, r.created_at, k.label, k.key_prefix,
			COALESCE(p.model_id, ''), COALESCE(p.units, 0),
			COALESCE(p.metadata->>'operation', ''), COALESCE(p.metadata->>'errorCode', ''), COALESCE(p.metadata->>'note', ''),
			`+tokens("prompt_tokens")+`, `+tokens("completion_tokens")+`, `+tokens("total_tokens")+`
		FROM (SELECT r.*`+developerAPICallWhere+`
			ORDER BY r.created_at DESC, r.billing_id DESC LIMIT $3 OFFSET $4) r
		LEFT JOIN user_api_keys k ON k.id = r.api_key_id
		LEFT JOIN usage_profit_ledger p ON p.source_type = $5 AND p.source_id = r.billing_id AND p.billing_generation = 0
		ORDER BY r.created_at DESC, r.billing_id DESC`, append(args, DeveloperAPIProfitSourceType)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*DeveloperAPICall, 0)
	for rows.Next() {
		var item DeveloperAPICall
		if err := rows.Scan(&item.SourceType, &item.Status, &item.PriceCents, &item.CreatedAt, &item.KeyLabel, &item.KeyPrefix,
			&item.ModelID, &item.Units, &item.Operation, &item.ErrorCode, &item.Note,
			&item.PromptTokens, &item.CompletionTokens, &item.TotalTokens); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}
