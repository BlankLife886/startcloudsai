package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type SecurityRiskEvent struct {
	ID             int64          `json:"id"`
	UserID         *uuid.UUID     `json:"userId"`
	APIKeyID       *uuid.UUID     `json:"apiKeyId"`
	ClientIP       *string        `json:"clientIp"`
	Category       string         `json:"category"`
	Severity       string         `json:"severity"`
	Score          int            `json:"score"`
	Action         string         `json:"action"`
	Reason         string         `json:"reason"`
	Metadata       map[string]any `json:"metadata"`
	ResolvedAt     *time.Time     `json:"resolvedAt"`
	ResolutionNote *string        `json:"resolutionNote"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type NewSecurityRiskEvent struct {
	UserID   *uuid.UUID
	APIKeyID *uuid.UUID
	ClientIP string
	Category string
	Severity string
	Score    int
	Action   string
	Reason   string
	Metadata map[string]any
}

func InsertSecurityRiskEvent(ctx context.Context, q Q, item NewSecurityRiskEvent) error {
	metadata, err := json.Marshal(item.Metadata)
	if err != nil {
		metadata = []byte(`{}`)
	}
	_, err = q.Exec(ctx, `INSERT INTO security_risk_events
		(user_id,api_key_id,client_ip,category,severity,score,action,reason,metadata)
		VALUES ($1,$2,NULLIF($3,'')::inet,$4,$5,$6,$7,$8,$9)`, item.UserID, item.APIKeyID,
		item.ClientIP, item.Category, item.Severity, item.Score, item.Action, item.Reason, metadata)
	return err
}

func ListSecurityRiskEvents(ctx context.Context, q Q, unresolvedOnly bool, limit int) ([]*SecurityRiskEvent, error) {
	limit = min(max(limit, 1), 200)
	rows, err := q.Query(ctx, `SELECT id,user_id,api_key_id,host(client_ip),category,severity,score,action,
		reason,metadata,resolved_at,resolution_note,created_at FROM security_risk_events
		WHERE ($1=false OR resolved_at IS NULL) ORDER BY id DESC LIMIT $2`, unresolvedOnly, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*SecurityRiskEvent, 0, limit)
	for rows.Next() {
		item := &SecurityRiskEvent{}
		var raw []byte
		if err := rows.Scan(&item.ID, &item.UserID, &item.APIKeyID, &item.ClientIP, &item.Category,
			&item.Severity, &item.Score, &item.Action, &item.Reason, &raw, &item.ResolvedAt,
			&item.ResolutionNote, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Metadata = map[string]any{}
		_ = json.Unmarshal(raw, &item.Metadata)
		items = append(items, item)
	}
	return items, rows.Err()
}

func ResolveSecurityRiskEvent(ctx context.Context, q Q, id int64, adminID uuid.UUID, note string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE security_risk_events SET resolved_at=now(),resolved_by=$2,
		resolution_note=NULLIF($3,'') WHERE id=$1 AND resolved_at IS NULL`, id, adminID, strings.TrimSpace(note))
	return tag.RowsAffected() > 0, err
}

func UpsertSecurityBlock(ctx context.Context, q Q, subjectType, subjectValue, scope, reason string, expiresAt time.Time) error {
	_, err := q.Exec(ctx, `INSERT INTO security_blocks (subject_type,subject_value,scope,reason,expires_at)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subject_type,subject_value,scope) WHERE revoked_at IS NULL
		DO UPDATE SET reason=EXCLUDED.reason,expires_at=GREATEST(security_blocks.expires_at,EXCLUDED.expires_at)`,
		subjectType, subjectValue, scope, reason, expiresAt)
	return err
}

func IsSecurityBlocked(ctx context.Context, q Q, subjectType, subjectValue, scope string, now time.Time) (bool, time.Time, error) {
	var expiresAt time.Time
	err := q.QueryRow(ctx, `SELECT expires_at FROM security_blocks WHERE subject_type=$1 AND subject_value=$2
		AND revoked_at IS NULL AND expires_at>$4 AND (scope='*' OR scope=$3)
		ORDER BY expires_at DESC LIMIT 1`, subjectType, subjectValue, scope, now).Scan(&expiresAt)
	if err == pgx.ErrNoRows {
		return false, time.Time{}, nil
	}
	return err == nil, expiresAt, err
}

func RevokeSecurityBlock(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE security_blocks SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, id)
	return tag.RowsAffected() > 0, err
}

type SecurityBlock struct {
	ID           uuid.UUID  `json:"id"`
	SubjectType  string     `json:"subjectType"`
	SubjectValue string     `json:"subjectValue"`
	Scope        string     `json:"scope"`
	Reason       string     `json:"reason"`
	ExpiresAt    time.Time  `json:"expiresAt"`
	RevokedAt    *time.Time `json:"revokedAt"`
	CreatedAt    time.Time  `json:"createdAt"`
}

func ListSecurityBlocks(ctx context.Context, q Q, activeOnly bool, limit int) ([]*SecurityBlock, error) {
	rows, err := q.Query(ctx, `SELECT id,subject_type,subject_value,scope,reason,expires_at,revoked_at,created_at
		FROM security_blocks WHERE ($1=false OR (revoked_at IS NULL AND expires_at>now()))
		ORDER BY created_at DESC LIMIT $2`, activeOnly, min(max(limit, 1), 200))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*SecurityBlock{}
	for rows.Next() {
		item := &SecurityBlock{}
		if err := rows.Scan(&item.ID, &item.SubjectType, &item.SubjectValue, &item.Scope, &item.Reason,
			&item.ExpiresAt, &item.RevokedAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type APIKeyRecentIP struct {
	IP         string    `json:"ip"`
	Requests   int64     `json:"requests"`
	LastUsedAt time.Time `json:"lastUsedAt"`
}

func InsertAPIKeyAccessEvent(ctx context.Context, q Q, keyID, userID uuid.UUID, ip, method, route string, status int, requestBytes, responseBytes int64) error {
	_, err := q.Exec(ctx, `INSERT INTO api_key_access_events
		(api_key_id,user_id,client_ip,method,route,status_code,request_bytes,response_bytes)
		VALUES ($1,$2,NULLIF($3,'')::inet,$4,$5,$6,$7,$8)`, keyID, userID, ip, method, route,
		status, max(requestBytes, 0), max(responseBytes, 0))
	return err
}

func ListAPIKeyRecentIPs(ctx context.Context, q Q, keyID uuid.UUID, limit int) ([]APIKeyRecentIP, error) {
	rows, err := q.Query(ctx, `SELECT host(client_ip),count(*),max(created_at) FROM api_key_access_events
		WHERE api_key_id=$1 AND client_ip IS NOT NULL GROUP BY client_ip ORDER BY max(created_at) DESC LIMIT $2`, keyID, min(max(limit, 1), 20))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []APIKeyRecentIP{}
	for rows.Next() {
		var item APIKeyRecentIP
		if err := rows.Scan(&item.IP, &item.Requests, &item.LastUsedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func FreezeUserAPIKey(ctx context.Context, q Q, id uuid.UUID, reason string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE user_api_keys SET status='frozen',auto_frozen_at=now(),freeze_reason=$2,
		updated_at=now() WHERE id=$1 AND status='active'`, id, strings.TrimSpace(reason))
	return tag.RowsAffected() > 0, err
}

func UnfreezeUserAPIKey(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE user_api_keys SET status='active',auto_frozen_at=NULL,freeze_reason=NULL,
		updated_at=now() WHERE id=$1 AND status='frozen'`, id)
	return tag.RowsAffected() > 0, err
}

func IsUploadHashBlocked(ctx context.Context, q Q, hash string) (bool, string, error) {
	var reason string
	err := q.QueryRow(ctx, `SELECT reason FROM upload_hash_blocklist WHERE sha256=$1 AND active=true`, strings.ToLower(hash)).Scan(&reason)
	if err == pgx.ErrNoRows {
		return false, "", nil
	}
	return err == nil, reason, err
}

func UpsertUploadHashBlock(ctx context.Context, q Q, hash, reason string, adminID uuid.UUID) error {
	_, err := q.Exec(ctx, `INSERT INTO upload_hash_blocklist (sha256,reason,created_by) VALUES ($1,$2,$3)
		ON CONFLICT (sha256) DO UPDATE SET reason=EXCLUDED.reason,active=true,updated_at=now()`,
		strings.ToLower(hash), strings.TrimSpace(reason), adminID)
	return err
}

func DisableUploadHashBlock(ctx context.Context, q Q, hash string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE upload_hash_blocklist SET active=false,updated_at=now() WHERE sha256=$1 AND active=true`, strings.ToLower(hash))
	return tag.RowsAffected() > 0, err
}

type UploadHashBlock struct {
	SHA256    string    `json:"sha256"`
	Reason    string    `json:"reason"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func ListUploadHashBlocks(ctx context.Context, q Q, limit int) ([]*UploadHashBlock, error) {
	rows, err := q.Query(ctx, `SELECT sha256,reason,active,created_at,updated_at FROM upload_hash_blocklist
		ORDER BY updated_at DESC LIMIT $1`, min(max(limit, 1), 200))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*UploadHashBlock{}
	for rows.Next() {
		item := &UploadHashBlock{}
		if err := rows.Scan(&item.SHA256, &item.Reason, &item.Active, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type PaymentReconciliation struct {
	ID                      int64     `json:"id"`
	OrderID                 uuid.UUID `json:"orderId"`
	Provider                string    `json:"provider"`
	LocalStatus             string    `json:"localStatus"`
	ProviderState           *int      `json:"providerState"`
	ExpectedAmountCents     int64     `json:"expectedAmountCents"`
	ProviderAmountCents     *int64    `json:"providerAmountCents"`
	ProviderPaidAmountCents *int64    `json:"providerPaidAmountCents"`
	Outcome                 string    `json:"outcome"`
	Detail                  *string   `json:"detail"`
	CheckedAt               time.Time `json:"checkedAt"`
}

func InsertPaymentCallbackEvent(ctx context.Context, q Q, fingerprint string, orderID *uuid.UUID, providerOrderID string, amount, paidAmount *int64, ip string, signatureValid bool, outcome, detail string) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO payment_callback_events
		(fingerprint,order_id,provider_order_id,amount_cents,paid_amount_cents,client_ip,signature_valid,outcome,detail)
		VALUES ($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,'')::inet,$7,$8,NULLIF($9,''))
		ON CONFLICT (fingerprint) DO UPDATE SET replay_count=payment_callback_events.replay_count+1,last_seen_at=now()`,
		fingerprint, orderID, providerOrderID, amount, paidAmount, ip, signatureValid, outcome, detail)
	return tag.RowsAffected() > 0, err
}

func InsertPaymentReconciliation(ctx context.Context, q Q, item PaymentReconciliation) error {
	_, err := q.Exec(ctx, `INSERT INTO payment_reconciliations
		(order_id,provider,local_status,provider_state,expected_amount_cents,provider_amount_cents,provider_paid_amount_cents,outcome,detail)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, item.OrderID, item.Provider, item.LocalStatus,
		item.ProviderState, item.ExpectedAmountCents, item.ProviderAmountCents, item.ProviderPaidAmountCents,
		item.Outcome, item.Detail)
	return err
}

func ListPaymentReconciliations(ctx context.Context, q Q, issuesOnly bool, limit int) ([]*PaymentReconciliation, error) {
	rows, err := q.Query(ctx, `SELECT id,order_id,provider,local_status,provider_state,expected_amount_cents,
		provider_amount_cents,provider_paid_amount_cents,outcome,detail,checked_at FROM payment_reconciliations
		WHERE ($1=false OR outcome<>'matched') ORDER BY id DESC LIMIT $2`, issuesOnly, min(max(limit, 1), 200))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*PaymentReconciliation{}
	for rows.Next() {
		item := &PaymentReconciliation{}
		if err := rows.Scan(&item.ID, &item.OrderID, &item.Provider, &item.LocalStatus, &item.ProviderState,
			&item.ExpectedAmountCents, &item.ProviderAmountCents, &item.ProviderPaidAmountCents,
			&item.Outcome, &item.Detail, &item.CheckedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
