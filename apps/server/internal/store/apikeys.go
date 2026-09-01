package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrAPIKeyInactive     = errors.New("api key is inactive")
	ErrAPIKeyDailyLimit   = errors.New("api key daily limit exceeded")
	ErrAPIKeyMonthlyLimit = errors.New("api key monthly limit exceeded")
	ErrAPIKeyModelDenied  = errors.New("api key model denied")
)

type UserAPIKey struct {
	ID                     uuid.UUID
	UserID                 uuid.UUID
	KeyPrefix              string
	KeyHash                string
	Label                  string
	Status                 string
	Scopes                 []string
	AllowedModelIDs        []string
	DailyTaskLimit         int
	MonthlyTaskLimit       int
	DailySpendLimitCents   int64
	MonthlySpendLimitCents int64
	IPAllowlist            []string
	RateLimitPerMinute     int
	DailyByteLimit         int64
	AutoFrozenAt           *time.Time
	FreezeReason           *string
	ExpiresAt              *time.Time
	LastUsedAt             *time.Time
	LastUsedIP             *string
	LastError              *string
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// #nosec G101 -- this is a list of SQL column names, not credential values.
const userAPIKeyCols = `id,user_id,key_prefix,key_hash,label,status,scopes,allowed_model_ids,
	daily_task_limit,monthly_task_limit,daily_spend_limit_cents,monthly_spend_limit_cents,
	ip_allowlist,rate_limit_per_minute,daily_byte_limit,auto_frozen_at,freeze_reason,
	expires_at,last_used_at,last_used_ip,last_error,created_at,updated_at`

func scanUserAPIKey(row pgx.Row) (*UserAPIKey, error) {
	var key UserAPIKey
	err := row.Scan(&key.ID, &key.UserID, &key.KeyPrefix, &key.KeyHash, &key.Label, &key.Status,
		&key.Scopes, &key.AllowedModelIDs, &key.DailyTaskLimit, &key.MonthlyTaskLimit,
		&key.DailySpendLimitCents, &key.MonthlySpendLimitCents, &key.IPAllowlist,
		&key.RateLimitPerMinute, &key.DailyByteLimit, &key.AutoFrozenAt, &key.FreezeReason, &key.ExpiresAt,
		&key.LastUsedAt, &key.LastUsedIP, &key.LastError, &key.CreatedAt, &key.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func InsertUserAPIKey(ctx context.Context, q Q, key *UserAPIKey) (*UserAPIKey, error) {
	if key.ID == uuid.Nil {
		key.ID = uuid.New()
	}
	if key.RateLimitPerMinute == 0 {
		key.RateLimitPerMinute = 120
	}
	if key.DailyByteLimit == 0 {
		key.DailyByteLimit = 2 << 30
	}
	if key.IPAllowlist == nil {
		key.IPAllowlist = []string{}
	}
	return scanUserAPIKey(q.QueryRow(ctx, `INSERT INTO user_api_keys (
		id,user_id,key_prefix,key_hash,label,scopes,allowed_model_ids,daily_task_limit,monthly_task_limit,
		daily_spend_limit_cents,monthly_spend_limit_cents,ip_allowlist,rate_limit_per_minute,daily_byte_limit,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING `+userAPIKeyCols,
		key.ID, key.UserID, key.KeyPrefix, key.KeyHash, key.Label, key.Scopes, key.AllowedModelIDs,
		key.DailyTaskLimit, key.MonthlyTaskLimit, key.DailySpendLimitCents, key.MonthlySpendLimitCents,
		key.IPAllowlist, key.RateLimitPerMinute, key.DailyByteLimit, key.ExpiresAt))
}

func ListUserAPIKeys(ctx context.Context, q Q, userID uuid.UUID) ([]*UserAPIKey, error) {
	rows, err := q.Query(ctx, `SELECT `+userAPIKeyCols+` FROM user_api_keys WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserAPIKey, 0)
	for rows.Next() {
		item, err := scanUserAPIKey(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetUserAPIKeyByHash(ctx context.Context, q Q, hash string) (*UserAPIKey, error) {
	item, err := scanUserAPIKey(q.QueryRow(ctx, `SELECT `+userAPIKeyCols+` FROM user_api_keys WHERE key_hash=$1`, hash))
	return nilOnNoRows(item, err)
}

func GetUserAPIKey(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAPIKey, error) {
	item, err := scanUserAPIKey(q.QueryRow(ctx, `SELECT `+userAPIKeyCols+` FROM user_api_keys WHERE id=$1 AND user_id=$2`, id, userID))
	return nilOnNoRows(item, err)
}

func RevokeUserAPIKey(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE user_api_keys SET status='revoked',updated_at=now()
		WHERE id=$1 AND user_id=$2 AND status IN ('active','frozen')`, id, userID)
	return tag.RowsAffected() > 0, err
}

func TouchUserAPIKey(ctx context.Context, q Q, id uuid.UUID, ip string, lastError *string) error {
	_, err := q.Exec(ctx, `UPDATE user_api_keys SET last_used_at=now(),last_used_ip=NULLIF($2,''),last_error=$3,updated_at=now()
		WHERE id=$1`, id, ip, lastError)
	return err
}

func CountActiveUserAPIKeys(ctx context.Context, q Q, userID uuid.UUID) (int, error) {
	var count int
	err := q.QueryRow(ctx, `SELECT count(*) FROM user_api_keys WHERE user_id=$1 AND status IN ('active','frozen')`, userID).Scan(&count)
	return count, err
}

func RecordAPIKeyTaskCreation(ctx context.Context, q Q, apiKeyID, userID, taskID uuid.UUID, modelID string, reservedCents int64, now time.Time) error {
	key, err := scanUserAPIKey(q.QueryRow(ctx, `SELECT `+userAPIKeyCols+` FROM user_api_keys WHERE id=$1 AND user_id=$2 FOR UPDATE`, apiKeyID, userID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrAPIKeyInactive
		}
		return err
	}
	if key.Status != "active" || (key.ExpiresAt != nil && !key.ExpiresAt.After(now)) {
		return ErrAPIKeyInactive
	}
	if len(key.AllowedModelIDs) > 0 {
		allowed := false
		for _, id := range key.AllowedModelIDs {
			if id == modelID {
				allowed = true
				break
			}
		}
		if !allowed {
			return ErrAPIKeyModelDenied
		}
	}
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	var dayTasks, monthTasks int
	var daySpend, monthSpend int64
	err = q.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE created_at >= $2), count(*) FILTER (WHERE created_at >= $3),
		COALESCE(SUM(reserved_cents) FILTER (WHERE created_at >= $2),0),
		COALESCE(SUM(reserved_cents) FILTER (WHERE created_at >= $3),0)
		FROM api_key_usage_events WHERE api_key_id=$1`, apiKeyID, dayStart, monthStart).Scan(
		&dayTasks, &monthTasks, &daySpend, &monthSpend)
	if err != nil {
		return err
	}
	if dayTasks+1 > key.DailyTaskLimit || daySpend+reservedCents > key.DailySpendLimitCents {
		return ErrAPIKeyDailyLimit
	}
	if monthTasks+1 > key.MonthlyTaskLimit || monthSpend+reservedCents > key.MonthlySpendLimitCents {
		return ErrAPIKeyMonthlyLimit
	}
	_, err = q.Exec(ctx, `INSERT INTO api_key_usage_events (api_key_id,user_id,task_id,model_id,reserved_cents,created_at)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (task_id) DO NOTHING`, apiKeyID, userID, taskID, modelID, max(reservedCents, 0), now)
	return err
}

type APIKeyUsageSummary struct {
	TodayTasks      int64 `json:"todayTasks"`
	MonthTasks      int64 `json:"monthTasks"`
	TodaySpendCents int64 `json:"todaySpendCents"`
	MonthSpendCents int64 `json:"monthSpendCents"`
	TodayBytes      int64 `json:"todayBytes"`
}

func GetAPIKeyUsageSummary(ctx context.Context, q Q, keyID uuid.UUID, now time.Time) (APIKeyUsageSummary, error) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	var out APIKeyUsageSummary
	err := q.QueryRow(ctx, `SELECT count(*) FILTER (WHERE created_at >= $2),count(*) FILTER (WHERE created_at >= $3),
		COALESCE(SUM(reserved_cents) FILTER (WHERE created_at >= $2),0),COALESCE(SUM(reserved_cents) FILTER (WHERE created_at >= $3),0)
		FROM api_key_usage_events WHERE api_key_id=$1`, keyID, dayStart, monthStart).Scan(
		&out.TodayTasks, &out.MonthTasks, &out.TodaySpendCents, &out.MonthSpendCents)
	if err == nil {
		err = q.QueryRow(ctx, `SELECT COALESCE(SUM(request_bytes+response_bytes),0) FROM api_key_access_events
			WHERE api_key_id=$1 AND created_at >= $2`, keyID, dayStart).Scan(&out.TodayBytes)
	}
	return out, err
}
