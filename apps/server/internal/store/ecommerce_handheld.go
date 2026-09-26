package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func jsonMap(value map[string]any) []byte {
	if value == nil {
		value = map[string]any{}
	}
	data, _ := json.Marshal(value)
	return data
}

func scanJSONMap(raw []byte) map[string]any {
	value := map[string]any{}
	_ = json.Unmarshal(raw, &value)
	return value
}

func ListEcommerceHandheldCatalog(ctx context.Context, q Q, kind string) ([]*EcommerceHandheldCatalogItem, error) {
	sql := `SELECT id, kind, label, image_key, metadata, sort, active, created_at, updated_at FROM ecommerce_handheld_catalog WHERE active`
	args := []any{}
	if kind != "" {
		args = append(args, kind)
		sql += fmt.Sprintf(" AND kind = $%d", len(args))
	}
	sql += ` ORDER BY kind, sort, created_at, id`
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*EcommerceHandheldCatalogItem{}
	for rows.Next() {
		item := &EcommerceHandheldCatalogItem{}
		var metadata []byte
		if err := rows.Scan(&item.ID, &item.Kind, &item.Label, &item.ImageKey, &metadata, &item.Sort, &item.Active, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Metadata = scanJSONMap(metadata)
		out = append(out, item)
	}
	return out, rows.Err()
}

func InsertEcommerceHandheldProject(ctx context.Context, q Q, p *EcommerceHandheldProject) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return q.QueryRow(ctx, `INSERT INTO ecommerce_handheld_projects (id,user_id,product_id,name,product_snapshot,draft) VALUES ($1,$2,$3,$4,$5,$6) RETURNING created_at,updated_at`, p.ID, p.UserID, p.ProductID, p.Name, jsonMap(p.ProductSnapshot), jsonMap(p.Draft)).Scan(&p.CreatedAt, &p.UpdatedAt)
}

func GetEcommerceHandheldProject(ctx context.Context, q Q, userID, id uuid.UUID) (*EcommerceHandheldProject, error) {
	p := &EcommerceHandheldProject{}
	var snapshot, draft []byte
	err := q.QueryRow(ctx, `SELECT id,user_id,product_id,name,product_snapshot,draft,created_at,updated_at FROM ecommerce_handheld_projects WHERE id=$1 AND user_id=$2`, id, userID).Scan(&p.ID, &p.UserID, &p.ProductID, &p.Name, &snapshot, &draft, &p.CreatedAt, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.ProductSnapshot = scanJSONMap(snapshot)
	p.Draft = scanJSONMap(draft)
	return p, nil
}

func ListEcommerceHandheldProjects(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]*EcommerceHandheldProject, error) {
	rows, err := q.Query(ctx, `SELECT id,user_id,product_id,name,product_snapshot,draft,created_at,updated_at FROM ecommerce_handheld_projects WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*EcommerceHandheldProject{}
	for rows.Next() {
		p := &EcommerceHandheldProject{}
		var snapshot, draft []byte
		if err := rows.Scan(&p.ID, &p.UserID, &p.ProductID, &p.Name, &snapshot, &draft, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.ProductSnapshot = scanJSONMap(snapshot)
		p.Draft = scanJSONMap(draft)
		out = append(out, p)
	}
	return out, rows.Err()
}

func UpdateEcommerceHandheldProjectDraft(ctx context.Context, q Q, userID, id uuid.UUID, draft map[string]any) error {
	tag, err := q.Exec(ctx, `UPDATE ecommerce_handheld_projects SET draft=$3,updated_at=now() WHERE id=$1 AND user_id=$2`, id, userID, jsonMap(draft))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func InsertEcommerceHandheldBatch(ctx context.Context, q Q, b *EcommerceHandheldBatch) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return q.QueryRow(ctx, `INSERT INTO ecommerce_handheld_batches (id,user_id,project_id,product_id,parent_batch_id,status,model_id,product_snapshot,job_spec,item_count,total_cost_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING created_at,updated_at`, b.ID, b.UserID, b.ProjectID, b.ProductID, b.ParentBatchID, b.Status, b.ModelID, jsonMap(b.ProductSnapshot), jsonMap(b.JobSpec), b.ItemCount, b.TotalCostCents).Scan(&b.CreatedAt, &b.UpdatedAt)
}

func InsertEcommerceHandheldItem(ctx context.Context, q Q, item *EcommerceHandheldItem) error {
	if item.ID == uuid.Nil {
		item.ID = uuid.New()
	}
	return q.QueryRow(ctx, `INSERT INTO ecommerce_handheld_items (id,batch_id,user_id,task_id,parent_item_id,item_index,label,prompt,shot_spec,status,qa_status,review_status,review_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING created_at,updated_at`, item.ID, item.BatchID, item.UserID, item.TaskID, item.ParentItemID, item.ItemIndex, item.Label, item.Prompt, jsonMap(item.ShotSpec), item.Status, item.QAStatus, item.ReviewStatus, item.ReviewNote).Scan(&item.CreatedAt, &item.UpdatedAt)
}

func AttachEcommerceHandheldItemTask(ctx context.Context, q Q, userID, itemID, taskID uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE ecommerce_handheld_items SET task_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2`, itemID, userID, taskID)
	return err
}

// RetryEcommerceHandheldItem replaces the task attached to one terminal item.
// It is intended to run in the same transaction that creates newTaskID so a
// concurrent retry cannot create or charge a second replacement task.
func RetryEcommerceHandheldItem(ctx context.Context, q Q, userID, itemID, expectedTaskID, newTaskID uuid.UUID, retryCostCents int64) (uuid.UUID, bool, error) {
	var batchID uuid.UUID
	err := q.QueryRow(ctx, `
		UPDATE ecommerce_handheld_items AS item
		   SET task_id=$4,
		       status='queued',
		       qa_status='pending',
		       review_status='unreviewed',
		       review_note='',
		       updated_at=now()
		  FROM tasks AS previous
		 WHERE item.id=$1
		   AND item.user_id=$2
		   AND item.task_id=$3
		   AND previous.id=$3
		   AND previous.user_id=$2
		   AND previous.status IN ('failed','canceled')
		 RETURNING item.batch_id`, itemID, userID, expectedTaskID, newTaskID).Scan(&batchID)
	if err == pgx.ErrNoRows {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	if _, err := q.Exec(ctx, `
		UPDATE ecommerce_handheld_quality_reports
		   SET status='pending', detector='manual_required', checks='[]'::jsonb,
		       score=NULL, summary='等待视觉检测器', updated_at=now()
		 WHERE item_id=$1`, itemID); err != nil {
		return uuid.Nil, false, err
	}
	if _, err := q.Exec(ctx, `
		UPDATE ecommerce_handheld_batches
		   SET status='generating', total_cost_cents=total_cost_cents+$3, updated_at=now()
		 WHERE id=$1 AND user_id=$2`, batchID, userID, retryCostCents); err != nil {
		return uuid.Nil, false, err
	}
	return batchID, true, nil
}

func InsertEcommerceHandheldInput(ctx context.Context, q Q, input *EcommerceHandheldInput) error {
	if input.ID == uuid.Nil {
		input.ID = uuid.New()
	}
	return q.QueryRow(ctx, `INSERT INTO ecommerce_handheld_inputs (id,batch_id,item_id,role,object_key,ordinal) VALUES ($1,$2,$3,$4,$5,$6) RETURNING created_at`, input.ID, input.BatchID, input.ItemID, input.Role, input.ObjectKey, input.Ordinal).Scan(&input.CreatedAt)
}

func InsertEcommerceHandheldQualityReport(ctx context.Context, q Q, itemID uuid.UUID) error {
	_, err := q.Exec(ctx, `INSERT INTO ecommerce_handheld_quality_reports (id,item_id,status,detector,checks,summary) VALUES ($1,$2,'pending','manual_required','[]','等待视觉检测器') ON CONFLICT (item_id) DO NOTHING`, uuid.New(), itemID)
	return err
}

func GetEcommerceHandheldBatch(ctx context.Context, q Q, userID, id uuid.UUID) (*EcommerceHandheldBatch, error) {
	b := &EcommerceHandheldBatch{}
	var snapshot, spec []byte
	err := q.QueryRow(ctx, `SELECT id,user_id,project_id,product_id,parent_batch_id,status,model_id,product_snapshot,job_spec,item_count,total_cost_cents,created_at,updated_at FROM ecommerce_handheld_batches WHERE id=$1 AND user_id=$2`, id, userID).Scan(&b.ID, &b.UserID, &b.ProjectID, &b.ProductID, &b.ParentBatchID, &b.Status, &b.ModelID, &snapshot, &spec, &b.ItemCount, &b.TotalCostCents, &b.CreatedAt, &b.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b.ProductSnapshot = scanJSONMap(snapshot)
	b.JobSpec = scanJSONMap(spec)
	return b, nil
}

func ListEcommerceHandheldItems(ctx context.Context, q Q, userID, batchID uuid.UUID) ([]*EcommerceHandheldItem, error) {
	rows, err := q.Query(ctx, `SELECT id,batch_id,user_id,task_id,parent_item_id,item_index,label,prompt,shot_spec,status,qa_status,review_status,review_note,created_at,updated_at FROM ecommerce_handheld_items WHERE batch_id=$1 AND user_id=$2 ORDER BY item_index,id`, batchID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*EcommerceHandheldItem{}
	for rows.Next() {
		i := &EcommerceHandheldItem{}
		var spec []byte
		if err := rows.Scan(&i.ID, &i.BatchID, &i.UserID, &i.TaskID, &i.ParentItemID, &i.ItemIndex, &i.Label, &i.Prompt, &spec, &i.Status, &i.QAStatus, &i.ReviewStatus, &i.ReviewNote, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, err
		}
		i.ShotSpec = scanJSONMap(spec)
		out = append(out, i)
	}
	return out, rows.Err()
}

func ListEcommerceHandheldInputs(ctx context.Context, q Q, batchID uuid.UUID) ([]*EcommerceHandheldInput, error) {
	rows, err := q.Query(ctx, `SELECT id,batch_id,item_id,role,object_key,ordinal,created_at FROM ecommerce_handheld_inputs WHERE batch_id=$1 ORDER BY ordinal,id`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*EcommerceHandheldInput{}
	for rows.Next() {
		i := &EcommerceHandheldInput{}
		if err := rows.Scan(&i.ID, &i.BatchID, &i.ItemID, &i.Role, &i.ObjectKey, &i.Ordinal, &i.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func GetEcommerceHandheldItem(ctx context.Context, q Q, userID, id uuid.UUID) (*EcommerceHandheldItem, error) {
	i := &EcommerceHandheldItem{}
	var spec []byte
	err := q.QueryRow(ctx, `SELECT id,batch_id,user_id,task_id,parent_item_id,item_index,label,prompt,shot_spec,status,qa_status,review_status,review_note,created_at,updated_at FROM ecommerce_handheld_items WHERE id=$1 AND user_id=$2`, id, userID).Scan(&i.ID, &i.BatchID, &i.UserID, &i.TaskID, &i.ParentItemID, &i.ItemIndex, &i.Label, &i.Prompt, &spec, &i.Status, &i.QAStatus, &i.ReviewStatus, &i.ReviewNote, &i.CreatedAt, &i.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	i.ShotSpec = scanJSONMap(spec)
	return i, nil
}

func UpdateEcommerceHandheldBatchStatus(ctx context.Context, q Q, userID, batchID uuid.UUID, status string) error {
	_, err := q.Exec(ctx, `UPDATE ecommerce_handheld_batches SET status=$3,updated_at=now() WHERE id=$1 AND user_id=$2`, batchID, userID, status)
	return err
}
