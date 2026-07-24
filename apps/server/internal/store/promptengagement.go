package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type PromptEngagementState struct {
	Liked     bool
	Favorited bool
}

func PromptEngagementStates(ctx context.Context, q Q, userID uuid.UUID, promptIDs []uuid.UUID) (map[uuid.UUID]PromptEngagementState, error) {
	out := make(map[uuid.UUID]PromptEngagementState, len(promptIDs))
	if userID == uuid.Nil || len(promptIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT prompt_id, liked, favorited
		FROM prompt_user_engagement WHERE user_id = $1 AND prompt_id = ANY($2::uuid[])`, userID, promptIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var state PromptEngagementState
		if err := rows.Scan(&id, &state.Liked, &state.Favorited); err != nil {
			return nil, err
		}
		out[id] = state
	}
	return out, rows.Err()
}

func SetPromptReaction(ctx context.Context, q Q, userID, promptID uuid.UUID, reaction string, active bool) (likeCount, favoriteCount, useCount int, err error) {
	if _, err = q.Exec(ctx, `INSERT INTO prompt_user_engagement (user_id, prompt_id)
		VALUES ($1, $2) ON CONFLICT (user_id, prompt_id) DO NOTHING`, userID, promptID); err != nil {
		return
	}
	column, counter := "liked", "like_count"
	if reaction == "favorite" {
		column, counter = "favorited", "favorite_count"
	}
	var previous bool
	if err = q.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM prompt_user_engagement
		WHERE user_id = $1 AND prompt_id = $2 FOR UPDATE`, column), userID, promptID).Scan(&previous); err != nil {
		return
	}
	delta := 0
	if previous != active {
		if active {
			delta = 1
		} else {
			delta = -1
		}
		if _, err = q.Exec(ctx, fmt.Sprintf(`UPDATE prompt_user_engagement
			SET %s = $3, updated_at = now() WHERE user_id = $1 AND prompt_id = $2`, column), userID, promptID, active); err != nil {
			return
		}
	}
	err = q.QueryRow(ctx, fmt.Sprintf(`UPDATE prompt_library
		SET %s = GREATEST(0, %s + $2) WHERE id = $1
		RETURNING like_count, favorite_count, use_count`, counter, counter), promptID, delta).
		Scan(&likeCount, &favoriteCount, &useCount)
	return
}

func RecordPromptUse(ctx context.Context, q Q, userID, promptID uuid.UUID) (likeCount, favoriteCount, useCount int, err error) {
	now := time.Now().UTC()
	if _, err = q.Exec(ctx, `INSERT INTO prompt_user_engagement
		(user_id, prompt_id, use_count, last_used_at, updated_at)
		VALUES ($1, $2, 1, $3, $3)
		ON CONFLICT (user_id, prompt_id) DO UPDATE SET
			use_count = prompt_user_engagement.use_count + 1,
			last_used_at = EXCLUDED.last_used_at,
			updated_at = EXCLUDED.updated_at`, userID, promptID, now); err != nil {
		return
	}
	err = q.QueryRow(ctx, `UPDATE prompt_library SET use_count = use_count + 1 WHERE id = $1
		RETURNING like_count, favorite_count, use_count`, promptID).
		Scan(&likeCount, &favoriteCount, &useCount)
	return
}
