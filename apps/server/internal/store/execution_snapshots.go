package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Execution snapshots have no public serializer and must never be merged into
// task params or assistant message metadata, even when their keys are encrypted.
func GetExecutionSnapshot(ctx context.Context, q Q, source string, id uuid.UUID, slot string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := q.QueryRow(ctx, `SELECT config FROM execution_snapshots WHERE source_type=$1 AND source_id=$2 AND slot=$3`, source, id, slot).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return raw, err
}

// BindExecutionSnapshot is first-writer-wins, including concurrent legacy
// workers. Always return the persisted winner rather than the caller's draft.
func BindExecutionSnapshot(ctx context.Context, q Q, source string, id uuid.UUID, slot string, raw json.RawMessage) (json.RawMessage, error) {
	if id == uuid.Nil || !json.Valid(raw) {
		return nil, errors.New("invalid execution snapshot")
	}
	digest := sha256.Sum256(raw)
	// Parent row locks serialize first binding with deletion/its cleanup trigger,
	// preventing a late legacy worker from recreating an orphaned credential row.
	if _, err := q.Exec(ctx, `WITH task_source AS (
		SELECT id FROM tasks WHERE $1='task' AND id=$2 FOR KEY SHARE
	), assistant_source AS (
		SELECT id FROM assistant_runs WHERE $1='assistant_run' AND id=$2 FOR KEY SHARE
	), source AS (
		SELECT id FROM task_source UNION ALL SELECT id FROM assistant_source
	)
	INSERT INTO execution_snapshots(source_type,source_id,slot,config,config_hash)
		SELECT $1,id,$3,$4,$5 FROM source ON CONFLICT (source_type,source_id,slot) DO NOTHING`, source, id, slot, raw, hex.EncodeToString(digest[:])); err != nil {
		return nil, err
	}
	bound, err := GetExecutionSnapshot(ctx, q, source, id, slot)
	if err == nil && len(bound) == 0 {
		err = errors.New("execution source no longer exists")
	}
	return bound, err
}
