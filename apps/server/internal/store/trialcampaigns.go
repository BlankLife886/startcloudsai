package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const trialCampaignCols = `id, title, feature_keys, access_mode, capacity, display_offset,
	status, created_by, activated_at, closed_at, expires_at, created_at, updated_at`

const trialCampaignSelectCols = `c.id, c.title, c.feature_keys, c.access_mode, c.capacity, c.display_offset,
	c.status, c.created_by, c.activated_at, c.closed_at, c.expires_at, c.created_at, c.updated_at`

func scanTrialCampaign(row pgx.Row) (*TrialCampaign, error) {
	var item TrialCampaign
	err := row.Scan(
		&item.ID, &item.Title, &item.FeatureKeys, &item.AccessMode, &item.Capacity,
		&item.DisplayOffset, &item.Status, &item.CreatedBy, &item.ActivatedAt,
		&item.ClosedAt, &item.ExpiresAt, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func GetActiveTrialCampaign(ctx context.Context, q Q) (*TrialCampaign, error) {
	item, err := scanTrialCampaign(q.QueryRow(ctx,
		`SELECT `+trialCampaignSelectCols+`
		 FROM trial_campaigns c
		 WHERE c.status = 'active' AND c.expires_at > now()
		 LIMIT 1`))
	return nilOnNoRows(item, err)
}

func GetTrialCampaign(ctx context.Context, q Q, id uuid.UUID) (*TrialCampaign, error) {
	item, err := scanTrialCampaign(q.QueryRow(ctx,
		`SELECT `+trialCampaignSelectCols+` FROM trial_campaigns c WHERE c.id = $1`, id))
	return nilOnNoRows(item, err)
}

func GetTrialCampaignForUpdate(ctx context.Context, q Q, id uuid.UUID) (*TrialCampaign, error) {
	item, err := scanTrialCampaign(q.QueryRow(ctx,
		`SELECT `+trialCampaignSelectCols+` FROM trial_campaigns c WHERE c.id = $1 FOR UPDATE`, id))
	return nilOnNoRows(item, err)
}

func ListTrialCampaigns(ctx context.Context, q Q) ([]*TrialCampaign, error) {
	rows, err := q.Query(ctx,
		`SELECT `+trialCampaignSelectCols+`,
		        (SELECT count(*) FROM trial_access_applications a WHERE a.campaign_id = c.id),
		        (SELECT COALESCE(max(application_no), 0) + 1 FROM trial_access_applications a WHERE a.campaign_id = c.id)
		 FROM trial_campaigns c
		 ORDER BY (c.status = 'active') DESC, c.created_at DESC, c.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*TrialCampaign, 0)
	for rows.Next() {
		var item TrialCampaign
		if err := rows.Scan(
			&item.ID, &item.Title, &item.FeatureKeys, &item.AccessMode, &item.Capacity,
			&item.DisplayOffset, &item.Status, &item.CreatedBy, &item.ActivatedAt,
			&item.ClosedAt, &item.ExpiresAt, &item.CreatedAt, &item.UpdatedAt, &item.AppliedCount, &item.NextApplicationNo,
		); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}

func InsertTrialCampaign(ctx context.Context, q Q, title string, featureKeys []string, accessMode string, capacity, displayOffset int64, expiresAt time.Time, createdBy uuid.UUID, at time.Time) (*TrialCampaign, error) {
	return scanTrialCampaign(q.QueryRow(ctx,
		`INSERT INTO trial_campaigns
		 (title, feature_keys, access_mode, capacity, display_offset, expires_at, created_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		 RETURNING `+trialCampaignCols,
		title, featureKeys, accessMode, capacity, displayOffset, expiresAt, createdBy, at))
}

func UpdateTrialCampaign(ctx context.Context, q Q, id uuid.UUID, title string, featureKeys []string, accessMode string, capacity, displayOffset int64, expiresAt, at time.Time) (*TrialCampaign, error) {
	return scanTrialCampaign(q.QueryRow(ctx,
		`UPDATE trial_campaigns c
		 SET title = $2, feature_keys = $3, access_mode = $4, capacity = $5,
		     display_offset = $6, expires_at = $7, updated_at = $8
		 WHERE id = $1
		 RETURNING `+trialCampaignCols,
		id, title, featureKeys, accessMode, capacity, displayOffset, expiresAt, at))
}

func TrialCampaignIsOpen(item *TrialCampaign, at time.Time) bool {
	return item != nil && item.Status == "active" && item.ExpiresAt.After(at)
}

func CloseExpiredTrialCampaigns(ctx context.Context, q Q, at time.Time) (int64, error) {
	var expiredCount, notificationCount int64
	err := q.QueryRow(ctx,
		`WITH expired AS (
			UPDATE trial_campaigns
			SET status = 'closed', closed_at = expires_at, updated_at = $1
			WHERE status = 'active' AND expires_at <= $1
			RETURNING id, title
		), notified AS (
			INSERT INTO notifications (user_id, kind, title, body)
			SELECT DISTINCT
			       application.user_id,
			       'trial_access',
			       '体验活动已结束',
			       CASE application.status
			           WHEN 'pending' THEN '「' || expired.title || '」已到期，本期申请不再继续审核。'
			           ELSE '「' || expired.title || '」已到期，体验积分已暂停使用，未使用余额仍会保留。'
			       END
			FROM expired
			JOIN trial_access_applications application ON application.campaign_id = expired.id
			WHERE application.status IN ('pending', 'approved')
			RETURNING id
		)
		SELECT (SELECT count(*) FROM expired), (SELECT count(*) FROM notified)`, at,
	).Scan(&expiredCount, &notificationCount)
	return expiredCount, err
}

// LockTrialCampaignLifecycle serializes activation and closure. Operations that
// depend on an active campaign take the shared form so closure has a clean,
// transactional boundary without serializing users against each other.
func LockTrialCampaignLifecycle(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('trial_campaign_lifecycle'))`)
	return err
}

func LockTrialCampaignLifecycleShared(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock_shared(hashtext('trial_campaign_lifecycle'))`)
	return err
}

func ActivateTrialCampaign(ctx context.Context, q Q, id uuid.UUID, at time.Time) (bool, error) {
	if _, err := q.Exec(ctx,
		`UPDATE trial_campaigns
		 SET status = 'closed', closed_at = $2, updated_at = $2
		 WHERE status = 'active' AND id <> $1`, id, at); err != nil {
		return false, err
	}
	tag, err := q.Exec(ctx,
		`UPDATE trial_campaigns
		 SET status = 'active', activated_at = $2, closed_at = NULL, updated_at = $2
		 WHERE id = $1 AND status <> 'active' AND expires_at > $2`, id, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func CloseTrialCampaign(ctx context.Context, q Q, id uuid.UUID, at time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE trial_campaigns
		 SET status = 'closed', closed_at = $2, updated_at = $2
		 WHERE id = $1 AND status = 'active'`, id, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func DeleteTrialCampaign(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx,
		`DELETE FROM trial_campaigns c
		 WHERE c.id = $1 AND c.status <> 'active'
		   AND NOT EXISTS (SELECT 1 FROM trial_access_applications a WHERE a.campaign_id = c.id)`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
