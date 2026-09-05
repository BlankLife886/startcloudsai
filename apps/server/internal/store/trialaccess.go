package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const trialAccessBaseCols = `id, user_id, campaign_id, application_no, feature_key, feature_keys, occupation, reason, status, review_note,
	reviewed_by, reviewed_at, redemption_code_id, created_at, updated_at`

const trialAccessJoinedCols = `a.id, a.user_id, a.campaign_id, a.application_no, a.feature_key, a.feature_keys, a.occupation, a.reason, a.status, a.review_note,
	a.reviewed_by, a.reviewed_at, a.redemption_code_id, a.created_at, a.updated_at,
	u.email, u.username, r.code, r.grant_cents, r.expires_at, r.status, r.redeemed_at,
	COALESCE(ARRAY(
		SELECT e.feature_key
		FROM user_trial_feature_entitlements e
		JOIN trial_campaigns campaign ON campaign.id = a.campaign_id
		WHERE e.application_id = a.id
		  AND e.revoked_at IS NULL
		  AND campaign.status = 'active'
		  AND campaign.expires_at > now()
		ORDER BY e.feature_key
	), ARRAY[]::text[])`

func scanTrialAccessBase(row pgx.Row) (*TrialAccessApplication, error) {
	var item TrialAccessApplication
	err := row.Scan(
		&item.ID, &item.UserID, &item.CampaignID, &item.ApplicationNo, &item.FeatureKey, &item.FeatureKeys, &item.Occupation, &item.Reason, &item.Status,
		&item.ReviewNote, &item.ReviewedBy, &item.ReviewedAt, &item.RedemptionCodeID,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func scanTrialAccessJoined(row pgx.Row) (*TrialAccessApplication, error) {
	var item TrialAccessApplication
	err := row.Scan(
		&item.ID, &item.UserID, &item.CampaignID, &item.ApplicationNo, &item.FeatureKey, &item.FeatureKeys, &item.Occupation, &item.Reason, &item.Status,
		&item.ReviewNote, &item.ReviewedBy, &item.ReviewedAt, &item.RedemptionCodeID,
		&item.CreatedAt, &item.UpdatedAt, &item.UserEmail, &item.Username,
		&item.RedemptionCode, &item.GrantCents, &item.CodeExpiresAt, &item.CodeStatus,
		&item.CodeRedeemedAt, &item.ActiveFeatureKeys,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func trialAccessJoinSQL() string {
	return ` FROM trial_access_applications a
		JOIN users u ON u.id = a.user_id
		LEFT JOIN redemption_codes r ON r.id = a.redemption_code_id`
}

func GetTrialAccessApplicationByUser(ctx context.Context, q Q, userID uuid.UUID) (*TrialAccessApplication, error) {
	item, err := scanTrialAccessJoined(q.QueryRow(ctx,
		`SELECT `+trialAccessJoinedCols+trialAccessJoinSQL()+` WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 1`, userID))
	return nilOnNoRows(item, err)
}

func GetTrialAccessApplicationByUserAndCampaign(ctx context.Context, q Q, userID, campaignID uuid.UUID) (*TrialAccessApplication, error) {
	item, err := scanTrialAccessJoined(q.QueryRow(ctx,
		`SELECT `+trialAccessJoinedCols+trialAccessJoinSQL()+` WHERE a.user_id = $1 AND a.campaign_id = $2`, userID, campaignID))
	return nilOnNoRows(item, err)
}

func GetTrialAccessApplicationForUpdate(ctx context.Context, q Q, id uuid.UUID) (*TrialAccessApplication, error) {
	item, err := scanTrialAccessJoined(q.QueryRow(ctx,
		`SELECT `+trialAccessJoinedCols+trialAccessJoinSQL()+` WHERE a.id = $1 FOR UPDATE OF a`, id))
	return nilOnNoRows(item, err)
}

func GetTrialAccessApplication(ctx context.Context, q Q, id uuid.UUID) (*TrialAccessApplication, error) {
	item, err := scanTrialAccessJoined(q.QueryRow(ctx,
		`SELECT `+trialAccessJoinedCols+trialAccessJoinSQL()+` WHERE a.id = $1`, id))
	return nilOnNoRows(item, err)
}

func InsertTrialAccessApplication(ctx context.Context, q Q, userID, campaignID uuid.UUID, applicationNo int64, featureKeys []string, occupation, reason string) (*TrialAccessApplication, error) {
	if len(featureKeys) == 0 {
		return nil, fmt.Errorf("trial application requires at least one feature")
	}
	return scanTrialAccessBase(q.QueryRow(ctx,
		`INSERT INTO trial_access_applications (user_id, campaign_id, application_no, feature_key, feature_keys, occupation, reason)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+trialAccessBaseCols,
		userID, campaignID, applicationNo, featureKeys[0], featureKeys, occupation, reason))
}

func LockTrialAccessCapacity(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('trial_access_capacity'))`)
	return err
}

func NextTrialAccessApplicationNo(ctx context.Context, q Q, campaignID uuid.UUID) (int64, error) {
	var next int64
	err := q.QueryRow(ctx,
		`SELECT COALESCE(MAX(application_no), 0) + 1 FROM trial_access_applications WHERE campaign_id = $1`, campaignID).Scan(&next)
	return next, err
}

func CountAllTrialAccessApplications(ctx context.Context, q Q, campaignID uuid.UUID) (int64, error) {
	count, _, err := TrialCampaignApplicationStats(ctx, q, campaignID)
	return count, err
}

func TrialCampaignApplicationStats(ctx context.Context, q Q, campaignID uuid.UUID) (int64, int64, error) {
	var count, nextApplicationNo int64
	err := q.QueryRow(ctx,
		`SELECT count(*), COALESCE(max(application_no), 0) + 1
		 FROM trial_access_applications WHERE campaign_id = $1`, campaignID,
	).Scan(&count, &nextApplicationNo)
	return count, nextApplicationNo, err
}

// ReapplyTrialAccessApplication 只允许被拒绝的申请重新提交。
func ReapplyTrialAccessApplication(ctx context.Context, q Q, userID, campaignID uuid.UUID, applicationNo int64, featureKeys []string, occupation, reason string, at time.Time) (bool, error) {
	if len(featureKeys) == 0 {
		return false, fmt.Errorf("trial application requires at least one feature")
	}
	tag, err := q.Exec(ctx,
		`UPDATE trial_access_applications
		 SET application_no = $3, feature_key = $4, feature_keys = $5, occupation = $6, reason = $7,
		     status = 'pending', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL,
		     redemption_code_id = NULL, created_at = $8, updated_at = $8
		 WHERE user_id = $1 AND campaign_id = $2 AND status = 'rejected'`,
		userID, campaignID, applicationNo, featureKeys[0], featureKeys, occupation, reason, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func GrantTrialFeatureEntitlement(ctx context.Context, q Q, userID uuid.UUID, featureKey string, applicationID uuid.UUID, grantedAt time.Time) error {
	_, err := q.Exec(ctx,
		`INSERT INTO user_trial_feature_entitlements (user_id, feature_key, application_id, granted_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, feature_key) DO UPDATE
		 SET application_id = EXCLUDED.application_id, granted_at = EXCLUDED.granted_at, revoked_at = NULL`,
		userID, featureKey, applicationID, grantedAt)
	return err
}

func HasActiveTrialFeatureEntitlement(ctx context.Context, q Q, userID uuid.UUID, featureKey string) (bool, error) {
	var active bool
	err := q.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1
			FROM user_trial_feature_entitlements e
			JOIN trial_access_applications a ON a.id = e.application_id
			JOIN trial_campaigns c ON c.id = a.campaign_id
			WHERE e.user_id = $1 AND e.feature_key = $2 AND e.revoked_at IS NULL
			  AND c.status = 'active'
			  AND c.expires_at > now()
		)`, userID, featureKey).Scan(&active)
	return active, err
}

// ReviewTrialAccessApplication 条件更新 pending 申请，防止并发重复发码。
func ReviewTrialAccessApplication(ctx context.Context, q Q, id uuid.UUID, status string, reviewNote *string, reviewedBy uuid.UUID, reviewedAt time.Time, codeID *uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE trial_access_applications
		 SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = $5,
		     redemption_code_id = $6, updated_at = $5
		 WHERE id = $1 AND status = 'pending'`, id, status, reviewNote, reviewedBy, reviewedAt, codeID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func ReplaceTrialAccessRewardCode(ctx context.Context, q Q, id, codeID, reviewedBy uuid.UUID, reviewNote *string, at time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE trial_access_applications
		 SET redemption_code_id = $2, review_note = COALESCE($3, review_note),
		     reviewed_by = $4, reviewed_at = $5, updated_at = $5
		 WHERE id = $1 AND status = 'approved'`,
		id, codeID, reviewNote, reviewedBy, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func ListTrialAccessApplications(ctx context.Context, q Q, campaignID uuid.UUID, status, search string, limit int, cursor *Cursor) ([]*TrialAccessApplication, error) {
	sql := `SELECT ` + trialAccessJoinedCols + trialAccessJoinSQL() + ` WHERE a.campaign_id = $1`
	args := []any{campaignID}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND a.status = $%d`, len(args))
	}
	if search = strings.TrimSpace(search); search != "" {
		args = append(args, "%"+search+"%")
		sql += fmt.Sprintf(` AND (u.email ILIKE $%d OR u.username ILIKE $%d OR a.occupation ILIKE $%d)`, len(args), len(args), len(args))
	}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (a.created_at < $%d OR (a.created_at = $%d AND a.id < $%d))`, len(args)-1, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY a.created_at DESC, a.id DESC LIMIT $%d`, len(args))

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*TrialAccessApplication, 0)
	for rows.Next() {
		item, scanErr := scanTrialAccessJoined(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CountTrialAccessApplications(ctx context.Context, q Q, campaignID uuid.UUID, status, search string) (int64, error) {
	sql := `SELECT count(*) FROM trial_access_applications a JOIN users u ON u.id = a.user_id WHERE a.campaign_id = $1`
	args := []any{campaignID}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND a.status = $%d`, len(args))
	}
	if search = strings.TrimSpace(search); search != "" {
		args = append(args, "%"+search+"%")
		sql += fmt.Sprintf(` AND (u.email ILIKE $%d OR u.username ILIKE $%d OR a.occupation ILIKE $%d)`, len(args), len(args), len(args))
	}
	var count int64
	err := q.QueryRow(ctx, sql, args...).Scan(&count)
	return count, err
}
