package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const ecommerceTryonCatalogCols = `id, kind, label, image_key, apparel, metadata, sort, active, created_at, updated_at`

func scanEcommerceTryonCatalogItem(row pgx.Row) (*EcommerceTryonCatalogItem, error) {
	var item EcommerceTryonCatalogItem
	var metadata []byte
	if err := row.Scan(
		&item.ID, &item.Kind, &item.Label, &item.ImageKey, &item.Apparel,
		&metadata, &item.Sort, &item.Active, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.Metadata = scanJSONMap(metadata)
	return &item, nil
}

func InsertEcommerceTryonCatalogItem(ctx context.Context, q Q, item *EcommerceTryonCatalogItem) (*EcommerceTryonCatalogItem, error) {
	if item.ID == uuid.Nil {
		item.ID = uuid.New()
	}
	return scanEcommerceTryonCatalogItem(q.QueryRow(ctx,
		`INSERT INTO ecommerce_tryon_catalog (id, kind, label, image_key, apparel, metadata, sort, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING `+ecommerceTryonCatalogCols,
		item.ID, item.Kind, item.Label, item.ImageKey, item.Apparel, jsonMap(item.Metadata), item.Sort, item.Active))
}

func GetEcommerceTryonCatalogItem(ctx context.Context, q Q, id uuid.UUID) (*EcommerceTryonCatalogItem, error) {
	item, err := scanEcommerceTryonCatalogItem(q.QueryRow(ctx,
		`SELECT `+ecommerceTryonCatalogCols+` FROM ecommerce_tryon_catalog WHERE id = $1`, id))
	return nilOnNoRows(item, err)
}

func ListEcommerceTryonCatalog(ctx context.Context, q Q, kind string, activeOnly bool) ([]*EcommerceTryonCatalogItem, error) {
	sql := `SELECT ` + ecommerceTryonCatalogCols + ` FROM ecommerce_tryon_catalog`
	args := make([]any, 0, 2)
	where := make([]string, 0, 2)
	if kind != "" {
		args = append(args, kind)
		where = append(where, fmt.Sprintf("kind = $%d", len(args)))
	}
	if activeOnly {
		where = append(where, "active")
	}
	if len(where) > 0 {
		sql += ` WHERE ` + where[0]
		for i := 1; i < len(where); i++ {
			sql += ` AND ` + where[i]
		}
	}
	sql += ` ORDER BY kind ASC, sort ASC, created_at ASC, id ASC`
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*EcommerceTryonCatalogItem, 0)
	for rows.Next() {
		item, err := scanEcommerceTryonCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func CountEcommerceTryonCatalogByKind(ctx context.Context, q Q, kind string) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM ecommerce_tryon_catalog WHERE kind = $1`, kind).Scan(&n)
	return n, err
}

func MaxEcommerceTryonCatalogSort(ctx context.Context, q Q, kind string) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT COALESCE(MAX(sort), 0) FROM ecommerce_tryon_catalog WHERE kind = $1`, kind).Scan(&n)
	return n, err
}

func UpdateEcommerceTryonCatalogItem(ctx context.Context, q Q, item *EcommerceTryonCatalogItem) error {
	_, err := q.Exec(ctx,
		`UPDATE ecommerce_tryon_catalog
		 SET label = $2, apparel = $3, metadata = $4, sort = $5, active = $6, updated_at = now()
		 WHERE id = $1`,
		item.ID, item.Label, item.Apparel, jsonMap(item.Metadata), item.Sort, item.Active)
	return err
}

func UpdateEcommerceTryonCatalogImage(ctx context.Context, q Q, id uuid.UUID, imageKey string) error {
	tag, err := q.Exec(ctx,
		`UPDATE ecommerce_tryon_catalog SET image_key = $2, updated_at = now() WHERE id = $1`,
		id, imageKey)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func DeleteEcommerceTryonCatalogItem(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM ecommerce_tryon_catalog WHERE id = $1`, id)
	return err
}

func applyCatalogOrderedIDs(allIDs, orderedIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(orderedIDs) == 0 {
		return allIDs, nil
	}
	selected := make(map[uuid.UUID]bool, len(orderedIDs))
	for _, id := range orderedIDs {
		if selected[id] {
			return nil, fmt.Errorf("duplicate catalog id %s", id)
		}
		selected[id] = true
	}
	selectedSlots := make([]int, 0, len(orderedIDs))
	for index, id := range allIDs {
		if selected[id] {
			selectedSlots = append(selectedSlots, index)
		}
	}
	if len(selectedSlots) != len(orderedIDs) {
		return nil, fmt.Errorf("one or more catalog ids do not exist in this kind")
	}
	next := append([]uuid.UUID(nil), allIDs...)
	for index, slot := range selectedSlots {
		next[slot] = orderedIDs[index]
	}
	return next, nil
}

// ReorderEcommerceTryonCatalog replaces the selected items in their current
// kind slots and then normalizes sort values. Items outside the selection keep
// their relative positions, so filtered sorting is safe.
func ReorderEcommerceTryonCatalog(ctx context.Context, q Q, kind string, orderedIDs []uuid.UUID) error {
	if kind == "" || len(orderedIDs) == 0 {
		return nil
	}
	rows, err := q.Query(ctx,
		`SELECT id FROM ecommerce_tryon_catalog WHERE kind = $1 ORDER BY sort ASC, created_at ASC, id ASC FOR UPDATE`,
		kind)
	if err != nil {
		return err
	}
	allIDs := make([]uuid.UUID, 0, len(orderedIDs))
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		allIDs = append(allIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	next, err := applyCatalogOrderedIDs(allIDs, orderedIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE ecommerce_tryon_catalog AS catalog
		SET sort = (ordered.position * 10)::integer, updated_at = now()
		FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
		WHERE catalog.id = ordered.id`, next)
	return err
}
