package httpapi

import (
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func securityAdminLimit(c *gin.Context) int {
	value, err := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if err != nil {
		return 100
	}
	return min(max(value, 1), 200)
}

// adminSecurityRisks 传 page 时按严重度分页并返回带上限总数；否则保持旧的"最新 N 条"响应。
// activeBlocks 为仍生效的临时限制（最多 200 条），activeBlocksTotal 为其带上限总数。
func (s *Server) adminSecurityRisks(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	unresolved := c.Query("unresolved") != "false"
	blocks, err := store.ListSecurityBlocks(ctx, s.St.Pool, true, 200)
	if err != nil {
		fail(c, err)
		return
	}
	blockTotal, err := store.CountActiveSecurityBlocksCapped(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if c.Query("page") == "" {
		items, err := store.ListSecurityRiskEvents(ctx, s.St.Pool, unresolved, securityAdminLimit(c))
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"items": items, "activeBlocks": blocks, "activeBlocksTotal": blockTotal.Value, "activeBlocksCapped": blockTotal.Capped})
		return
	}
	limit, page, err := pageWindow(c, 20, 100)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListSecurityRiskEventsPage(ctx, s.St.Pool, unresolved, limit, (page-1)*limit, true)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountSecurityRiskEventsCapped(ctx, s.St.Pool, unresolved)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total.Value, "totalCapped": total.Capped, "page": page, "limit": limit,
		"activeBlocks": blocks, "activeBlocksTotal": blockTotal.Value, "activeBlocksCapped": blockTotal.Capped})
}

func (s *Server) adminResolveSecurityRisk(c *gin.Context, admin *store.User) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	changed, err := store.ResolveSecurityRiskEvent(c.Request.Context(), s.St.Pool, id, admin.ID, body.Note)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("risk_not_found", "风险事件不存在或已处理", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) adminRevokeSecurityBlock(c *gin.Context, _ *store.User) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.RevokeSecurityBlock(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("block_not_found", "限制不存在或已解除", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) adminUnfreezeAPIKey(c *gin.Context, _ *store.User) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.UnfreezeUserAPIKey(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("api_key_not_frozen", "API Key 不存在或未被冻结", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) adminUploadHashBlocks(c *gin.Context, _ *store.User) {
	if c.Query("page") == "" {
		items, err := store.ListUploadHashBlocks(c.Request.Context(), s.St.Pool, securityAdminLimit(c))
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"items": items})
		return
	}
	limit, page, err := pageWindow(c, 20, 100)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListUploadHashBlocksPage(c.Request.Context(), s.St.Pool, limit, (page-1)*limit)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountUploadHashBlocksCapped(c.Request.Context(), s.St.Pool, false)
	if err != nil {
		fail(c, err)
		return
	}
	active, err := store.CountUploadHashBlocksCapped(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total.Value, "totalCapped": total.Capped, "page": page, "limit": limit,
		"activeTotal": active.Value, "activeCapped": active.Capped})
}

func (s *Server) adminAddUploadHashBlock(c *gin.Context, admin *store.User) {
	var body struct {
		SHA256 string `json:"sha256"`
		Reason string `json:"reason"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.SHA256 = strings.ToLower(strings.TrimSpace(body.SHA256))
	body.Reason = strings.TrimSpace(body.Reason)
	decoded, err := hex.DecodeString(body.SHA256)
	if err != nil || len(decoded) != 32 || body.Reason == "" || len([]rune(body.Reason)) > 300 {
		fail(c, apperr.E("validation_error", "sha256 必须为 64 位十六进制，原因须为 1-300 字", 422))
		return
	}
	if err := store.UpsertUploadHashBlock(c.Request.Context(), s.St.Pool, body.SHA256, body.Reason, admin.ID); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{"sha256": body.SHA256, "reason": body.Reason})
}

func (s *Server) adminRemoveUploadHashBlock(c *gin.Context, _ *store.User) {
	hash := strings.ToLower(strings.TrimSpace(c.Param("sha256")))
	changed, err := store.DisableUploadHashBlock(c.Request.Context(), s.St.Pool, hash)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("hash_not_found", "哈希规则不存在或已停用", 404))
		return
	}
	respondNoContent(c)
}

func pointer[T any](value T) *T { return &value }

func (s *Server) adminRunPaymentReconciliation(c *gin.Context, _ *store.User) {
	s.adminReconcileOrRecover(c)
}

func (s *Server) adminPaymentReconciliations(c *gin.Context, _ *store.User) {
	if c.Query("page") != "" {
		page, err := pageNumber(c)
		if err != nil {
			fail(c, err)
			return
		}
		if page < 1 {
			page = 1
		}
		if (page-1)*securityAdminLimit(c) >= store.ListCountCap {
			fail(c, errPageBeyondCap)
			return
		}
		filter, err := adminListFilter(c)
		if err != nil {
			fail(c, err)
			return
		}
		items, total, err := store.SearchPaymentReconciliations(c.Request.Context(), s.St.Pool, c.Query("issues") != "false", securityAdminLimit(c), page, filter)
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"items": items, "total": total, "page": page, "recoverySupported": true})
		return
	}
	items, err := store.ListPaymentReconciliations(c.Request.Context(), s.St.Pool, c.Query("issues") != "false", securityAdminLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "recoverySupported": true})
}
