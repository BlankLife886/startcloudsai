package assistantproactive

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// setLookback limits the sweep to recent work; older sets were either
// announced already or abandoned.
const setLookback = 7 * 24 * time.Hour

// AnnounceFinishedSets tells users about e-commerce sets whose images have
// all finished since the last announcement (a first run or a redo batch).
// It returns how many were announced. A set is announced once per batch even
// when notices are off, so switching them on later does not replay old news.
func AnnounceFinishedSets(ctx context.Context, st *store.Store, service commerceset.Service, now time.Time) (int, error) {
	rows, err := st.Pool.Query(ctx, `SELECT id FROM assistant_commerce_sets
		WHERE status = 'generating' AND updated_at > $1
		ORDER BY updated_at LIMIT 200`, now.Add(-setLookback))
	if err != nil {
		return 0, err
	}
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	announced := 0
	for _, id := range ids {
		posted, err := announceSet(ctx, st, service, id, now)
		if err != nil {
			return announced, fmt.Errorf("announce set %s: %w", id, err)
		}
		if posted {
			announced++
		}
	}
	return announced, nil
}

func announceSet(ctx context.Context, st *store.Store, service commerceset.Service, id uuid.UUID, now time.Time) (bool, error) {
	posted := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var userID uuid.UUID
		var announcedAttempts int
		err := tx.QueryRow(ctx, `SELECT user_id, announced_attempts FROM assistant_commerce_sets
			WHERE id = $1 AND status = 'generating' FOR UPDATE SKIP LOCKED`, id).Scan(&userID, &announcedAttempts)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		set, err := store.GetUserCommerceSet(ctx, tx, userID, id)
		if err != nil || set == nil {
			return err
		}
		attempts := 0
		for _, shot := range set.Shots {
			// Discarded attempts still count: the number only grows, so a
			// rewound set is announced again when its next round finishes.
			attempts += len(shot.Attempts) + len(shot.Discarded)
		}
		if attempts == 0 || attempts <= announcedAttempts {
			return nil
		}
		view, err := service.BuildView(ctx, set)
		if err != nil {
			return err
		}
		if view.Done < view.Total {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE assistant_commerce_sets SET announced_attempts = $2 WHERE id = $1`, id, attempts); err != nil {
			return err
		}
		settings, err := Get(ctx, tx, userID)
		if err != nil || !settings.TaskNotices {
			return err
		}
		posted, err = Post(ctx, tx, setMessage(set, view, attempts), now)
		return err
	})
	return posted, err
}

func setMessage(set *store.CommerceSet, view *commerceset.View, attempts int) Message {
	name := strings.Join(nonEmpty(view.ProductName, view.Platform), " · ")
	if name == "" {
		name = "电商套图"
	} else {
		name = "「" + name + "」"
	}
	succeeded, failed := 0, []string{}
	for _, shot := range view.Shots {
		if shot.Status == "succeeded" {
			succeeded++
		} else {
			failed = append(failed, shot.Label)
		}
	}
	title := "电商套图已完成"
	summary := fmt.Sprintf("%d 张全部出图", succeeded)
	if len(failed) > 0 {
		title = "电商套图已结束，有图片失败"
		summary = fmt.Sprintf("%d 张完成，%d 张失败（%s，积分已退回）", succeeded, len(failed), strings.Join(failed, "、"))
	}
	text := fmt.Sprintf("这套%s做好了：%s。打开下面的卡片会自动检查成片，没通过的可以直接重做。", name, summary)
	if succeeded == 0 {
		text = fmt.Sprintf("这套%s没有生成成功：%s。可以在下面的卡片上重做。", name, summary)
	}
	return Message{
		UserID: set.UserID, ConversationID: set.ConversationID, Kind: "task_done",
		Title: title, Text: text, Body: fmt.Sprintf("%s：%s", strings.Trim(name, "「」"), summary),
		DataViews:  []map[string]any{{"tool": "commerce_set_status", "view": "commerce_set", "data": view}},
		SourceType: "assistant_set", SourceID: sourceID(set.ID.String(), fmt.Sprint(attempts)),
	}
}

func nonEmpty(values ...string) []string {
	out := []string{}
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}
