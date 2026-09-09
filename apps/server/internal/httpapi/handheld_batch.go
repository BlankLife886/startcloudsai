package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

type handheldBatchResult struct {
	batch   *store.EcommerceHandheldBatch
	items   []*store.EcommerceHandheldItem
	tasks   []*store.Task
	created bool
}

func handheldRequestIdentity(userID uuid.UUID, body handheldJobIn, headerKey string) (uuid.UUID, string, error) {
	key := strings.TrimSpace(body.IdempotencyKey)
	if key == "" {
		key = strings.TrimSpace(headerKey)
	}
	if len(key) > 128 {
		return uuid.Nil, "", apperr.E("validation_error", "idempotencyKey 不能超过128字节", 422)
	}
	body.IdempotencyKey = ""
	raw, err := json.Marshal(body)
	if err != nil {
		return uuid.Nil, "", err
	}
	digest := sha256.Sum256(raw)
	id := uuid.New()
	if key != "" {
		id = uuid.NewSHA1(userID, []byte("handheld-batch:"+key))
	}
	return id, hex.EncodeToString(digest[:]), nil
}

func loadHandheldBatchResult(ctx context.Context, q store.Q, userID, batchID uuid.UUID, requestHash string) (*handheldBatchResult, error) {
	batch, err := store.GetEcommerceHandheldBatch(ctx, q, userID, batchID)
	if err != nil || batch == nil {
		return nil, err
	}
	if batch.JobSpec["_requestHash"] != requestHash {
		return nil, apperr.E("idempotency_conflict", "同一批次重试的参数不能改变，请重新确认后提交", 409)
	}
	items, err := store.ListEcommerceHandheldItems(ctx, q, userID, batchID)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		if item.TaskID != nil {
			ids = append(ids, *item.TaskID)
		}
	}
	byID, err := store.GetTasksByIDs(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	result := &handheldBatchResult{batch: batch, items: items, tasks: make([]*store.Task, 0, len(ids))}
	for _, id := range ids {
		if task := byID[id]; task != nil {
			result.tasks = append(result.tasks, task)
		}
	}
	return result, nil
}

func (s *Server) createHandheldBatchAtomic(ctx context.Context, batch *store.EcommerceHandheldBatch, spec handheldSpecIn, requestHash string) (*handheldBatchResult, error) {
	var result *handheldBatchResult
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserTaskCreation(ctx, tx, batch.UserID); err != nil {
			return err
		}
		existing, err := loadHandheldBatchResult(ctx, tx, batch.UserID, batch.ID, requestHash)
		if err != nil {
			return err
		}
		if existing != nil {
			result = existing
			return nil
		}
		batch.JobSpec = handheldSpecMap(spec)
		batch.JobSpec["_requestHash"] = requestHash
		batch.TotalCostCents = 0
		if err := store.InsertEcommerceHandheldBatch(ctx, tx, batch); err != nil {
			return err
		}
		keys := make([]string, 0, len(spec.Inputs))
		for ordinal, input := range spec.Inputs {
			keys = append(keys, input.Key)
			if err := store.InsertEcommerceHandheldInput(ctx, tx, &store.EcommerceHandheldInput{BatchID: batch.ID, Role: input.Role, ObjectKey: input.Key, Ordinal: ordinal}); err != nil {
				return err
			}
		}
		result = &handheldBatchResult{batch: batch, created: true}
		productID := ""
		if batch.ProductID != nil {
			productID = batch.ProductID.String()
		}
		for index, shot := range spec.Shots {
			prompt := compileHandheldPrompt(batch.ProductSnapshot, spec, shot)
			item := &store.EcommerceHandheldItem{
				ID:      uuid.NewSHA1(batch.ID, []byte(fmt.Sprintf("item:%d", index))),
				BatchID: batch.ID, UserID: batch.UserID, ItemIndex: index, Label: shot.Label,
				Prompt: prompt, ShotSpec: map[string]any{"id": shot.ID, "label": shot.Label, "direction": shot.Direction, "aspectRatio": shot.AspectRatio, "prompt": prompt},
				Status: "queued", QAStatus: "pending", ReviewStatus: "unreviewed",
			}
			if err := store.InsertEcommerceHandheldItem(ctx, tx, item); err != nil {
				return err
			}
			idem := "handheld:" + item.ID.String()
			params := handheldGenerationParams(nil, batch.ModelID, shot.AspectRatio, batch.ID, item.ID, index, len(spec.Shots), productID, batch.ProductSnapshot, batch.JobSpec, spec.Inputs)
			task, _, err := taskflow.CreateTaskInTx(ctx, tx, batch.UserID, taskflow.CreateInput{
				Type: "ecommerce_design", Prompt: prompt, Params: params, InputKeys: keys, Count: 1, IdempotencyKey: &idem,
			}, nil)
			if err != nil {
				return err
			}
			item.TaskID = &task.ID
			if err := store.AttachEcommerceHandheldItemTask(ctx, tx, batch.UserID, item.ID, task.ID); err != nil {
				return err
			}
			if err := store.InsertEcommerceHandheldQualityReport(ctx, tx, item.ID); err != nil {
				return err
			}
			batch.TotalCostCents += task.CostCents
			result.items = append(result.items, item)
			result.tasks = append(result.tasks, task)
		}
		batch.Status = "generating"
		_, err = tx.Exec(ctx, `UPDATE ecommerce_handheld_batches SET status=$3,total_cost_cents=$4,updated_at=now() WHERE id=$1 AND user_id=$2`, batch.ID, batch.UserID, batch.Status, batch.TotalCostCents)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
