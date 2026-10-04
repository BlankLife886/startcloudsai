package commerceset

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// AdoptInput is an image the user edited in the assistant's image viewer.
// The caller has checked that the files belong to the user.
type AdoptInput struct {
	ShotID   string
	FileKey  string
	ThumbKey string
	Note     string
}

// Adopt puts an edited image in place of a shot. The user made and looked at
// the edit, so it counts as checked; it costs nothing here because the edit
// was paid for as its own assistant run.
func (s Service) Adopt(ctx context.Context, userID, setID uuid.UUID, in AdoptInput) error {
	if strings.TrimSpace(in.FileKey) == "" || strings.TrimSpace(in.ShotID) == "" {
		return invalid("缺少要替换的图片")
	}
	return s.St.Tx(ctx, func(tx pgx.Tx) error {
		set, err := store.LockUserCommerceSet(ctx, tx, userID, setID)
		if err != nil {
			return err
		}
		if set == nil {
			return fmt.Errorf("commerce set not found")
		}
		for index := range set.Shots {
			shot := &set.Shots[index]
			if shot.ID != in.ShotID {
				continue
			}
			if attempt := latest(*shot); attempt != nil && attempt.FileKey == in.FileKey {
				return nil
			}
			now := s.now()
			shot.Attempts = append(shot.Attempts, store.CommerceSetAttempt{
				Via: store.CommerceEditedByUser, FileKey: in.FileKey, ThumbKey: in.ThumbKey,
				Note: truncate(strings.TrimSpace(in.Note), 500), CreatedAt: now,
				Review: &store.CommerceSetReview{Pass: true, CheckedAt: now},
			})
			return store.SaveCommerceSet(ctx, tx, set)
		}
		return invalid("套图里没有这张图")
	})
}
