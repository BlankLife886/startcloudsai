package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type BlockedGalleryUser struct {
	UserID    uuid.UUID
	Username  string
	AvatarURL *string
	CreatedAt time.Time
}

func (u *BlockedGalleryUser) CursorKey() (time.Time, uuid.UUID) {
	return u.CreatedAt, u.UserID
}

func UpsertGallerySubmissionReport(
	ctx context.Context,
	q Q,
	submissionID, reporterUserID, authorUserID uuid.UUID,
	reason, detail string,
) error {
	_, err := q.Exec(ctx, `
		INSERT INTO gallery_submission_reports
			(submission_id, reporter_user_id, author_user_id, reason, detail)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (submission_id, reporter_user_id) DO UPDATE SET
			author_user_id = EXCLUDED.author_user_id,
			reason = EXCLUDED.reason,
			detail = EXCLUDED.detail,
			status = 'open',
			updated_at = now(),
			reviewed_at = NULL`,
		submissionID, reporterUserID, authorUserID, reason, detail)
	return err
}

func BlockGalleryUser(ctx context.Context, q Q, blockerUserID, blockedUserID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
		VALUES ($1, $2)
		ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
		blockerUserID, blockedUserID)
	return err
}

func ListBlockedGalleryUsers(
	ctx context.Context,
	q Q,
	blockerUserID uuid.UUID,
	limit int,
	cursor *Cursor,
) ([]*BlockedGalleryUser, error) {
	sql := `
		SELECT users.id, users.username, users.avatar_url, blocks.created_at
		FROM user_blocks blocks
		JOIN users ON users.id = blocks.blocked_user_id
		WHERE blocks.blocker_user_id = $1`
	args := []any{blockerUserID}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (
			blocks.created_at < $%d OR
			(blocks.created_at = $%d AND blocks.blocked_user_id < $%d)
		)`, len(args)-1, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY blocks.created_at DESC, blocks.blocked_user_id DESC LIMIT $%d`, len(args))
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*BlockedGalleryUser, 0, limit+1)
	for rows.Next() {
		var item BlockedGalleryUser
		if err := rows.Scan(&item.UserID, &item.Username, &item.AvatarURL, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}

func UnblockGalleryUser(ctx context.Context, q Q, blockerUserID, blockedUserID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		DELETE FROM user_blocks
		WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
		blockerUserID, blockedUserID)
	return err
}
