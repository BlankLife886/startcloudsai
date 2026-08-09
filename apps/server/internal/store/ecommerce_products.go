package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const ecommerceProductCols = `id, user_id, sku, title, brand, category, selling_points,
	target_audience, material, color, dimensions, platform, market, language,
	asset_ids, protected_elements, status, created_at, updated_at`

// LockUserEcommerceProductCreation serializes the product count-and-insert
// admission check for one user across API instances.
func LockUserEcommerceProductCreation(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, userID.String())
	return err
}

type NewEcommerceProduct struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	SKU               string
	Title             string
	Brand             string
	Category          string
	SellingPoints     string
	TargetAudience    string
	Material          string
	Color             string
	Dimensions        string
	Platform          string
	Market            string
	Language          string
	AssetIDs          []string
	ProtectedElements []string
	Status            string
}

func escapeEcommerceSearch(value string) string {
	value = strings.ReplaceAll(value, `\`, `\`+`\`)
	value = strings.ReplaceAll(value, `%`, `\`+`%`)
	return strings.ReplaceAll(value, `_`, `\`+`_`)
}

func scanEcommerceProduct(row interface{ Scan(...any) error }) (*EcommerceProduct, error) {
	var product EcommerceProduct
	err := row.Scan(
		&product.ID, &product.UserID, &product.SKU, &product.Title, &product.Brand,
		&product.Category, &product.SellingPoints, &product.TargetAudience,
		&product.Material, &product.Color, &product.Dimensions, &product.Platform,
		&product.Market, &product.Language, &product.AssetIDs, &product.ProtectedElements,
		&product.Status, &product.CreatedAt, &product.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &product, nil
}

func InsertEcommerceProduct(ctx context.Context, q Q, input NewEcommerceProduct) (*EcommerceProduct, error) {
	if input.ID == uuid.Nil {
		input.ID = uuid.New()
	}
	if input.Status == "" {
		input.Status = "active"
	}
	if input.AssetIDs == nil {
		input.AssetIDs = []string{}
	}
	if input.ProtectedElements == nil {
		input.ProtectedElements = []string{}
	}
	return scanEcommerceProduct(q.QueryRow(ctx,
		`INSERT INTO ecommerce_products
			(id, user_id, sku, title, brand, category, selling_points, target_audience,
			 material, color, dimensions, platform, market, language, asset_ids,
			 protected_elements, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		 RETURNING `+ecommerceProductCols,
		input.ID, input.UserID, input.SKU, input.Title, input.Brand, input.Category,
		input.SellingPoints, input.TargetAudience, input.Material, input.Color,
		input.Dimensions, input.Platform, input.Market, input.Language, input.AssetIDs,
		input.ProtectedElements, input.Status))
}

func GetEcommerceProduct(ctx context.Context, q Q, userID, id uuid.UUID) (*EcommerceProduct, error) {
	product, err := scanEcommerceProduct(q.QueryRow(ctx,
		`SELECT `+ecommerceProductCols+` FROM ecommerce_products WHERE user_id = $1 AND id = $2`, userID, id))
	return nilOnNoRows(product, err)
}

func GetEcommerceProductForUpdate(ctx context.Context, q Q, userID, id uuid.UUID) (*EcommerceProduct, error) {
	product, err := scanEcommerceProduct(q.QueryRow(ctx,
		`SELECT `+ecommerceProductCols+` FROM ecommerce_products WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, id))
	return nilOnNoRows(product, err)
}

func ListEcommerceProducts(ctx context.Context, q Q, userID uuid.UUID, search, status string, limit int, cursor *Cursor) ([]*EcommerceProduct, error) {
	search = strings.TrimSpace(search)
	status = strings.TrimSpace(status)
	sql := `SELECT ` + ecommerceProductCols + ` FROM ecommerce_products WHERE user_id = $1`
	args := []any{userID}
	if search != "" {
		args = append(args, "%"+escapeEcommerceSearch(search)+"%")
		sql += fmt.Sprintf(` AND (title ILIKE $%d ESCAPE E'\\' OR sku ILIKE $%d ESCAPE E'\\' OR brand ILIKE $%d ESCAPE E'\\' OR category ILIKE $%d ESCAPE E'\\')`, len(args), len(args), len(args), len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	sql, args = appendCursorUpdated(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*EcommerceProduct, 0, limit+1)
	for rows.Next() {
		product, scanErr := scanEcommerceProduct(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, product)
	}
	return items, rows.Err()
}

func appendCursorUpdated(sql string, args []any, cursor *Cursor, limit int) (string, []any) {
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (updated_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY updated_at DESC, id DESC LIMIT $%d`, len(args))
	return sql, args
}

func UpdateEcommerceProduct(ctx context.Context, q Q, input NewEcommerceProduct) (*EcommerceProduct, error) {
	if input.AssetIDs == nil {
		input.AssetIDs = []string{}
	}
	if input.ProtectedElements == nil {
		input.ProtectedElements = []string{}
	}
	return scanEcommerceProduct(q.QueryRow(ctx,
		`UPDATE ecommerce_products SET
			sku = $3, title = $4, brand = $5, category = $6, selling_points = $7,
			target_audience = $8, material = $9, color = $10, dimensions = $11,
			platform = $12, market = $13, language = $14, asset_ids = $15,
			protected_elements = $16, status = $17, updated_at = now()
		 WHERE user_id = $1 AND id = $2
		 RETURNING `+ecommerceProductCols,
		input.UserID, input.ID, input.SKU, input.Title, input.Brand, input.Category,
		input.SellingPoints, input.TargetAudience, input.Material, input.Color,
		input.Dimensions, input.Platform, input.Market, input.Language, input.AssetIDs,
		input.ProtectedElements, input.Status))
}

func DeleteEcommerceProduct(ctx context.Context, q Q, userID, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM ecommerce_products WHERE user_id = $1 AND id = $2`, userID, id)
	return err
}

func CountEcommerceProducts(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM ecommerce_products WHERE user_id = $1`, userID).Scan(&count)
	return count, err
}

func CountEcommerceProductsUsingAsset(ctx context.Context, q Q, userID, assetID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM ecommerce_products
		 WHERE user_id = $1 AND asset_ids ? $2`, userID, assetID.String()).Scan(&count)
	return count, err
}
