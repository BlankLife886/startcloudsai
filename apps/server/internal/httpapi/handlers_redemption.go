// 兑换码（CDK）：用户兑换 + 后台生成/列表/禁用/批次汇总（契约 v5）。
package httpapi

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/redemption"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ---------- 用户兑换 ----------

type redeemIn struct {
	Code string `json:"code"`
}

func (s *Server) redeemCode(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body redeemIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	code := redemption.NormalizeCode(body.Code)
	if code == "" || len(code) > 32 {
		fail(c, apperr.E("validation_error", "code: 格式不正确", 422))
		return
	}
	// 防爆破：单用户 1h 内 10 次失败锁 1h
	limiterKey := user.ID.String()
	if remain, allowed := s.RedeemLimiter.Check(limiterKey, ""); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	redeemed, entry, err := redemption.Redeem(ctx, s.St, user.ID, code)
	if err != nil {
		if _, isApp := apperr.As(err); isApp {
			s.RedeemLimiter.Fail(limiterKey, "")
		}
		fail(c, err)
		return
	}
	s.RedeemLimiter.Success(limiterKey)
	// 通知在主事务提交后尽力而为
	msg := fmt.Sprintf("兑换成功，%d 分已入账到你的钱包。", redeemed.GrantCents)
	if nerr := store.InsertNotification(ctx, s.St.Pool, &user.ID, "system", "兑换码入账", &msg); nerr != nil {
		log.Printf("notify redeem code %s: %v", redeemed.ID, nerr)
	}
	ok(c, gin.H{"grantCents": redeemed.GrantCents, "balanceCents": entry.BalanceAfterCents})
}

// ---------- Admin ----------

type redemptionGenerateIn struct {
	Count      *int    `json:"count"`
	GrantCents *int64  `json:"grantCents"`
	ExpiresAt  *string `json:"expiresAt"`
	Note       *string `json:"note"`
}

func (s *Server) adminGenerateRedemptionCodes(c *gin.Context, admin *store.User) {
	var body redemptionGenerateIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Count == nil || *body.Count < 1 || *body.Count > 1000 {
		fail(c, apperr.E("validation_error", "count: 须在 1-1000 之间", 422))
		return
	}
	if body.GrantCents == nil || *body.GrantCents <= 0 {
		fail(c, apperr.E("validation_error", "grantCents: 须为正整数", 422))
		return
	}
	if body.Note != nil && len([]rune(*body.Note)) > 200 {
		fail(c, apperr.E("validation_error", "note: 长度不能超过 200", 422))
		return
	}
	expiresAt, err := parseOptDatetime(body.ExpiresAt, "expiresAt")
	if err != nil {
		fail(c, err)
		return
	}
	if expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
		fail(c, apperr.E("validation_error", "expiresAt: 须晚于当前时间", 422))
		return
	}

	ctx := c.Request.Context()
	batchID := redemption.NewBatchID()
	var codes []string
	// 极小概率的 code 唯一冲突整批重试（最多 3 次）
	for attempt := 0; attempt < 3; attempt++ {
		codes = codes[:0]
		for i := 0; i < *body.Count; i++ {
			code, gerr := redemption.NewCode()
			if gerr != nil {
				fail(c, gerr)
				return
			}
			codes = append(codes, code)
		}
		err = s.St.Tx(ctx, func(tx pgx.Tx) error {
			for _, code := range codes {
				if _, ierr := store.InsertRedemptionCode(ctx, tx, code, *body.GrantCents, batchID, body.Note, expiresAt, admin.ID); ierr != nil {
					return ierr
				}
			}
			return nil
		})
		if err == nil || !store.IsUniqueViolation(err, "") {
			break
		}
		log.Printf("redemption batch %s code collision, retrying: %v", batchID, err)
	}
	if err != nil {
		fail(c, err)
		return
	}
	// 明文码仅生成时返回一次；审计 detail 只含请求体（count/grantCents），不含码
	ok(c, gin.H{"batchId": batchID, "grantCents": *body.GrantCents, "codes": codes})
}

func redemptionCodeDict(r *store.RedemptionCode) gin.H {
	var redeemedBy *string
	if r.RedeemedBy != nil {
		v := r.RedeemedBy.String()
		redeemedBy = &v
	}
	return gin.H{
		"id":              r.ID.String(),
		"code":            r.Code,
		"grantCents":      r.GrantCents,
		"batchId":         r.BatchID,
		"note":            r.Note,
		"status":          r.Status,
		"expiresAt":       iso(r.ExpiresAt),
		"redeemedBy":      redeemedBy,
		"redeemedByEmail": r.RedeemedByEmail,
		"redeemedAt":      iso(r.RedeemedAt),
		"createdAt":       isoValue(r.CreatedAt),
	}
}

func (s *Server) adminListRedemptionCodes(c *gin.Context, _ *store.User) {
	status := c.Query("status")
	if status != "" && status != "active" && status != "redeemed" && status != "disabled" {
		fail(c, apperr.E("validation_error", "无效的兑换码状态", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	search := redemption.NormalizeCode(c.Query("search"))
	rows, err := store.ListRedemptionCodes(c.Request.Context(), s.St.Pool,
		status, strings.TrimSpace(c.Query("batchId")), search, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, redemptionCodeDict))
}

func (s *Server) adminDisableRedemptionCode(c *gin.Context, _ *store.User) {
	codeID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	existing, err := store.GetRedemptionCode(ctx, s.St.Pool, codeID)
	if err != nil {
		fail(c, err)
		return
	}
	if existing == nil {
		fail(c, apperr.E("not_found", "兑换码不存在", 404))
		return
	}
	won, err := store.DisableRedemptionCode(ctx, s.St.Pool, codeID)
	if err != nil {
		fail(c, err)
		return
	}
	if !won {
		fail(c, apperr.E("code_not_active", "仅未兑换的兑换码可以禁用", 409))
		return
	}
	existing.Status = "disabled"
	ok(c, redemptionCodeDict(existing))
}

func (s *Server) adminRedemptionBatches(c *gin.Context, _ *store.User) {
	rows, err := store.ListRedemptionBatches(c.Request.Context(), s.St.Pool, 100)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, b := range rows {
		items = append(items, gin.H{
			"batchId":    b.BatchID,
			"note":       b.Note,
			"grantCents": b.GrantCents,
			"total":      b.Total,
			"redeemed":   b.Redeemed,
			"disabled":   b.Disabled,
			"createdAt":  isoValue(b.CreatedAt),
		})
	}
	ok(c, gin.H{"items": items})
}
