package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const growthGroupCols = `id, campaign_key, code, owner_id, status, target_members, reward_cents,
	expires_at, completed_at, created_at, updated_at`
const growthGroupJoinedCols = `g.id, g.campaign_key, g.code, g.owner_id, g.status, g.target_members, g.reward_cents,
	g.expires_at, g.completed_at, g.created_at, g.updated_at`

func scanGrowthGroup(row pgx.Row) (*GrowthGroup, error) {
	var item GrowthGroup
	err := row.Scan(&item.ID, &item.CampaignKey, &item.Code, &item.OwnerID, &item.Status,
		&item.TargetMembers, &item.RewardCents, &item.ExpiresAt, &item.CompletedAt,
		&item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func LockGrowthParticipation(ctx context.Context, q Q, campaignKey string, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, campaignKey+":"+userID.String())
	return err
}

func FindUserGrowthGroup(ctx context.Context, q Q, campaignKey string, userID uuid.UUID) (*GrowthGroup, error) {
	item, err := scanGrowthGroup(q.QueryRow(ctx, `SELECT `+growthGroupJoinedCols+`
		FROM growth_groups g JOIN growth_group_members m ON m.group_id=g.id
		WHERE m.campaign_key=$1 AND m.user_id=$2 AND (g.status='completed' OR (g.status='active' AND g.expires_at>now()))
		ORDER BY g.created_at DESC LIMIT 1`, campaignKey, userID))
	return nilOnNoRows(item, err)
}

func GetGrowthGroupByCodeForUpdate(ctx context.Context, q Q, campaignKey, code string) (*GrowthGroup, error) {
	item, err := scanGrowthGroup(q.QueryRow(ctx, `SELECT `+growthGroupCols+`
		FROM growth_groups WHERE campaign_key=$1 AND code=$2 FOR UPDATE`, campaignKey, code))
	return nilOnNoRows(item, err)
}

func InsertGrowthGroup(ctx context.Context, q Q, campaignKey, code string, ownerID uuid.UUID, target int, reward int64, expiresAt time.Time) (*GrowthGroup, error) {
	return scanGrowthGroup(q.QueryRow(ctx, `INSERT INTO growth_groups
		(campaign_key,code,owner_id,target_members,reward_cents,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+growthGroupCols,
		campaignKey, code, ownerID, target, reward, expiresAt))
}

func InsertGrowthGroupMember(ctx context.Context, q Q, groupID uuid.UUID, campaignKey string, userID uuid.UUID, role string) error {
	_, err := q.Exec(ctx, `INSERT INTO growth_group_members (group_id,campaign_key,user_id,role) VALUES ($1,$2,$3,$4)`, groupID, campaignKey, userID, role)
	return err
}

func CountGrowthGroupMembers(ctx context.Context, q Q, groupID uuid.UUID) (int, error) {
	var count int
	err := q.QueryRow(ctx, `SELECT count(*) FROM growth_group_members WHERE group_id=$1`, groupID).Scan(&count)
	return count, err
}

func CompleteGrowthGroup(ctx context.Context, q Q, groupID uuid.UUID, at time.Time) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE growth_groups SET status='completed', completed_at=$2, updated_at=$2
		WHERE id=$1 AND status='active'`, groupID, at)
	return tag.RowsAffected() > 0, err
}

func ExpireGrowthGroup(ctx context.Context, q Q, groupID uuid.UUID, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE growth_groups SET status='expired', updated_at=$2
		WHERE id=$1 AND status='active'`, groupID, at)
	return err
}

func ListGrowthGroupMembers(ctx context.Context, q Q, groupID uuid.UUID) ([]*GrowthGroupMember, error) {
	rows, err := q.Query(ctx, `SELECT m.user_id, u.username, m.role, m.joined_at
		FROM growth_group_members m JOIN users u ON u.id=m.user_id
		WHERE m.group_id=$1 ORDER BY m.joined_at, m.user_id`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*GrowthGroupMember, 0)
	for rows.Next() {
		var item GrowthGroupMember
		if err := rows.Scan(&item.UserID, &item.Username, &item.Role, &item.JoinedAt); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}

func CountSucceededTaskOutputsSince(ctx context.Context, q Q, userID uuid.UUID, since time.Time) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT coalesce(sum(jsonb_array_length(output_keys)),0)
		FROM tasks WHERE user_id=$1 AND status='succeeded' AND finished_at >= $2`, userID, since).Scan(&count)
	return count, err
}

func CountLedgerEntriesSince(ctx context.Context, q Q, userID uuid.UUID, sourceType string, since time.Time) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger
		WHERE user_id=$1 AND source_type=$2 AND created_at >= $3`, userID, sourceType, since).Scan(&count)
	return count, err
}
