package httpapi

import (
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const maxEcommerceProducts = 1000

type ecommerceProductInput struct {
	SKU               *string   `json:"sku"`
	Title             *string   `json:"title"`
	Brand             *string   `json:"brand"`
	Category          *string   `json:"category"`
	SellingPoints     *string   `json:"sellingPoints"`
	TargetAudience    *string   `json:"targetAudience"`
	Material          *string   `json:"material"`
	Color             *string   `json:"color"`
	Dimensions        *string   `json:"dimensions"`
	Platform          *string   `json:"platform"`
	Market            *string   `json:"market"`
	Language          *string   `json:"language"`
	AssetIDs          *[]string `json:"assetIds"`
	ProtectedElements *[]string `json:"protectedElements"`
	Status            *string   `json:"status"`
}

func validateEcommerceProductText(name, value string, max int, required bool) error {
	if required && value == "" {
		return apperr.E("validation_error", name+": 不能为空", 422)
	}
	if utf8.RuneCountInString(value) > max {
		return apperr.E("validation_error", name+": 内容过长", 422)
	}
	return nil
}

func normalizeEcommerceList(values []string, maxItems, maxLength int) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > maxLength {
			return nil, apperr.E("validation_error", "列表项内容过长", 422)
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	if len(result) > maxItems {
		return nil, apperr.E("validation_error", "列表项数量超出限制", 422)
	}
	return result, nil
}

func (s *Server) resolveEcommerceAssetIDs(c *gin.Context, q store.Q, userID uuid.UUID, ids []string) ([]string, error) {
	if len(ids) < 1 || len(ids) > 6 {
		return nil, apperr.E("validation_error", "assetIds: 须选择 1-6 张商品图", 422)
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	parsed := make([]uuid.UUID, 0, len(ids))
	for _, raw := range ids {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			return nil, apperr.E("validation_error", "assetIds: 包含无效素材", 422)
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		parsed = append(parsed, id)
	}
	assets, err := store.GetUserAssetsByIDsForShare(c.Request.Context(), q, userID, parsed)
	if err != nil {
		return nil, err
	}
	if len(assets) != len(parsed) {
		return nil, apperr.E("validation_error", "assetIds: 只能选择自己的素材", 422)
	}
	result := make([]string, 0, len(parsed))
	for _, id := range parsed {
		result = append(result, id.String())
	}
	return result, nil
}

func (s *Server) normalizeEcommerceProductInput(c *gin.Context, q store.Q, userID uuid.UUID, body ecommerceProductInput, existing *store.EcommerceProduct) (store.NewEcommerceProduct, error) {
	input := store.NewEcommerceProduct{
		UserID:            userID,
		Status:            "active",
		AssetIDs:          []string{},
		ProtectedElements: []string{},
	}
	if existing != nil {
		input.ID = existing.ID
		input.SKU = existing.SKU
		input.Title = existing.Title
		input.Brand = existing.Brand
		input.Category = existing.Category
		input.SellingPoints = existing.SellingPoints
		input.TargetAudience = existing.TargetAudience
		input.Material = existing.Material
		input.Color = existing.Color
		input.Dimensions = existing.Dimensions
		input.Platform = existing.Platform
		input.Market = existing.Market
		input.Language = existing.Language
		input.AssetIDs = append([]string(nil), existing.AssetIDs...)
		input.ProtectedElements = append([]string(nil), existing.ProtectedElements...)
		input.Status = existing.Status
	}
	if body.SKU != nil {
		input.SKU = strings.ToUpper(strings.TrimSpace(*body.SKU))
	}
	if body.Title != nil {
		input.Title = strings.TrimSpace(*body.Title)
	}
	if body.Brand != nil {
		input.Brand = strings.TrimSpace(*body.Brand)
	}
	if body.Category != nil {
		input.Category = strings.TrimSpace(*body.Category)
	}
	if body.SellingPoints != nil {
		input.SellingPoints = strings.TrimSpace(*body.SellingPoints)
	}
	if body.TargetAudience != nil {
		input.TargetAudience = strings.TrimSpace(*body.TargetAudience)
	}
	if body.Material != nil {
		input.Material = strings.TrimSpace(*body.Material)
	}
	if body.Color != nil {
		input.Color = strings.TrimSpace(*body.Color)
	}
	if body.Dimensions != nil {
		input.Dimensions = strings.TrimSpace(*body.Dimensions)
	}
	if body.Platform != nil {
		input.Platform = strings.TrimSpace(*body.Platform)
	}
	if body.Market != nil {
		input.Market = strings.TrimSpace(*body.Market)
	}
	if body.Language != nil {
		input.Language = strings.TrimSpace(*body.Language)
	}
	if body.Status != nil {
		input.Status = strings.TrimSpace(*body.Status)
	}

	fields := map[string]string{
		"title": input.Title, "sku": input.SKU, "brand": input.Brand,
		"category": input.Category, "targetAudience": input.TargetAudience,
		"material": input.Material, "color": input.Color, "dimensions": input.Dimensions,
		"platform": input.Platform, "market": input.Market, "language": input.Language,
	}
	for name, value := range fields {
		max := 120
		if name == "sku" {
			max = 80
		}
		if err := validateEcommerceProductText(name, value, max, name == "title"); err != nil {
			return input, err
		}
	}
	if err := validateEcommerceProductText("sellingPoints", input.SellingPoints, 1200, false); err != nil {
		return input, err
	}
	if input.Status != "active" && input.Status != "archived" {
		return input, apperr.E("validation_error", "status: 无效状态", 422)
	}
	if body.AssetIDs != nil {
		ids, err := s.resolveEcommerceAssetIDs(c, q, userID, *body.AssetIDs)
		if err != nil {
			return input, err
		}
		input.AssetIDs = ids
	}
	if len(input.AssetIDs) < 1 || len(input.AssetIDs) > 6 {
		return input, apperr.E("validation_error", "assetIds: 须选择 1-6 张商品图", 422)
	}
	if body.ProtectedElements != nil {
		items, err := normalizeEcommerceList(*body.ProtectedElements, 12, 80)
		if err != nil {
			return input, err
		}
		input.ProtectedElements = items
	}
	return input, nil
}

func ecommerceProductDict(product *store.EcommerceProduct, assets []*store.UserAsset) gin.H {
	assetMap := make(map[uuid.UUID]*store.UserAsset, len(assets))
	for _, asset := range assets {
		assetMap[asset.ID] = asset
	}
	assetItems := make([]gin.H, 0, len(product.AssetIDs))
	for _, rawID := range product.AssetIDs {
		id, err := uuid.Parse(rawID)
		if err != nil {
			continue
		}
		if asset := assetMap[id]; asset != nil {
			assetItems = append(assetItems, userAssetDict(asset))
		}
	}
	return gin.H{
		"id": product.ID.String(), "sku": product.SKU, "title": product.Title,
		"brand": product.Brand, "category": product.Category,
		"sellingPoints": product.SellingPoints, "targetAudience": product.TargetAudience,
		"material": product.Material, "color": product.Color, "dimensions": product.Dimensions,
		"platform": product.Platform, "market": product.Market, "language": product.Language,
		"assetIds": product.AssetIDs, "protectedElements": product.ProtectedElements,
		"assets": assetItems, "status": product.Status,
		"createdAt": isoValue(product.CreatedAt), "updatedAt": isoValue(product.UpdatedAt),
	}
}

func (s *Server) ecommerceProductResponse(c *gin.Context, product *store.EcommerceProduct) (gin.H, error) {
	ids := make([]uuid.UUID, 0, len(product.AssetIDs))
	for _, rawID := range product.AssetIDs {
		if id, err := uuid.Parse(rawID); err == nil {
			ids = append(ids, id)
		}
	}
	assets, err := store.GetUserAssetsByIDs(c.Request.Context(), s.St.Pool, product.UserID, ids)
	if err != nil {
		return nil, err
	}
	return ecommerceProductDict(product, assets), nil
}

func (s *Server) listEcommerceProducts(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && status != "active" && status != "archived" {
		fail(c, apperr.E("validation_error", "status: 无效状态", 422))
		return
	}
	search := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(search) > 120 {
		fail(c, apperr.E("validation_error", "q: 内容过长", 422))
		return
	}
	rows, err := store.ListEcommerceProducts(c.Request.Context(), s.St.Pool, user.ID, search, status, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	assetIDs := make([]uuid.UUID, 0, len(rows)*2)
	assetIDSet := make(map[uuid.UUID]struct{}, len(rows)*2)
	for _, product := range rows {
		for _, rawID := range product.AssetIDs {
			if id, parseErr := uuid.Parse(rawID); parseErr == nil {
				if _, exists := assetIDSet[id]; exists {
					continue
				}
				assetIDSet[id] = struct{}{}
				assetIDs = append(assetIDs, id)
			}
		}
	}
	assets, err := store.GetUserAssetsByIDs(c.Request.Context(), s.St.Pool, user.ID, assetIDs)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, product := range rows {
		items = append(items, ecommerceProductDict(product, assets))
	}
	var next any
	if hasMore && len(rows) > 0 {
		created, id := rows[len(rows)-1].CursorKey()
		next = encodeCursor(created, id)
	}
	ok(c, gin.H{"items": items, "nextCursor": next})
}

func (s *Server) createEcommerceProduct(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body ecommerceProductInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Title == nil || body.AssetIDs == nil {
		fail(c, apperr.E("validation_error", "title 和 assetIds 不能为空", 422))
		return
	}
	ctx := c.Request.Context()
	var product *store.EcommerceProduct
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserEcommerceProductCreation(ctx, tx, user.ID); err != nil {
			return err
		}
		count, err := store.CountEcommerceProducts(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if count >= maxEcommerceProducts {
			return apperr.E("ecommerce_product_limit", "商品数量已达上限", 409)
		}
		input, err := s.normalizeEcommerceProductInput(c, tx, user.ID, body, nil)
		if err != nil {
			return err
		}
		product, err = store.InsertEcommerceProduct(ctx, tx, input)
		return err
	})
	if err != nil {
		if store.IsUniqueViolation(err, "uq_ecommerce_products_user_sku") {
			fail(c, apperr.E("ecommerce_product_exists", "SKU 已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	response, err := s.ecommerceProductResponse(c, product)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, response)
}

func (s *Server) getEcommerceProduct(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	product, err := store.GetEcommerceProduct(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if product == nil {
		fail(c, apperr.E("not_found", "商品不存在", 404))
		return
	}
	response, err := s.ecommerceProductResponse(c, product)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, response)
}

func (s *Server) updateEcommerceProduct(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body ecommerceProductInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var product *store.EcommerceProduct
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		existing, err := store.GetEcommerceProductForUpdate(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if existing == nil {
			return apperr.E("not_found", "商品不存在", 404)
		}
		input, err := s.normalizeEcommerceProductInput(c, tx, user.ID, body, existing)
		if err != nil {
			return err
		}
		input.ID = id
		product, err = store.UpdateEcommerceProduct(ctx, tx, input)
		return err
	})
	if err != nil {
		if store.IsUniqueViolation(err, "uq_ecommerce_products_user_sku") {
			fail(c, apperr.E("ecommerce_product_exists", "SKU 已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	response, err := s.ecommerceProductResponse(c, product)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, response)
}

func (s *Server) deleteEcommerceProduct(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	product, err := store.GetEcommerceProduct(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if product == nil {
		fail(c, apperr.E("not_found", "商品不存在", 404))
		return
	}
	if err := store.DeleteEcommerceProduct(c.Request.Context(), s.St.Pool, user.ID, id); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}
