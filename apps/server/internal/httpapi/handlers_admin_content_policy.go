package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/contentpolicy"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const contentPolicyRefundSource = "content_policy_refund"

// adminContentPolicyConfig 读取（GET）或保存（PUT）内容违规的识别与扣费规则。
func (s *Server) adminContentPolicyConfig(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	if c.Request.Method == http.MethodPut {
		var in contentpolicy.Config
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		if _, err := contentpolicy.Save(ctx, s.St.Pool, in); err != nil {
			fail(c, err)
			return
		}
	}
	cfg, err := contentpolicy.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"config": cfg, "defaults": contentpolicy.DefaultConfig()})
}

// adminTestContentPolicy 用后台正在编辑的规则（未保存也可以）识别一段上游返回文字。
func (s *Server) adminTestContentPolicy(c *gin.Context, _ *store.User) {
	var in struct {
		Message string                `json:"message"`
		Config  *contentpolicy.Config `json:"config"`
	}
	if err := bindJSON(c, &in); err != nil {
		fail(c, err)
		return
	}
	if utf8.RuneCountInString(in.Message) > 4000 {
		fail(c, apperr.E("validation_error", "测试文字不能超过 4000 个字", http.StatusUnprocessableEntity))
		return
	}
	if in.Config != nil {
		ok(c, contentpolicy.Test(*in.Config, in.Message))
		return
	}
	cfg, err := contentpolicy.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, contentpolicy.Test(cfg, in.Message))
}

func adminContentPolicyFilter(c *gin.Context) (store.AdminContentPolicyFilter, error) {
	base, err := adminListFilter(c)
	if err != nil {
		return store.AdminContentPolicyFilter{}, err
	}
	f := store.AdminContentPolicyFilter{
		From: base.From, To: base.To, UserSearch: base.UserSearch, Search: base.Search,
		Status: strings.TrimSpace(c.Query("status")), SourceType: strings.TrimSpace(c.Query("source")),
	}
	if f.Status != "" && !store.Contains([]string{store.ContentPolicyCharged, store.ContentPolicyWaived, store.ContentPolicyRefunded}, f.Status) {
		return f, apperr.E("validation_error", "status 只支持 charged、waived、refunded", http.StatusUnprocessableEntity)
	}
	if f.SourceType != "" && !store.Contains([]string{contentpolicy.SourceTask, contentpolicy.SourceAssistantRun, contentpolicy.SourceDeveloperAPI}, f.SourceType) {
		return f, apperr.E("validation_error", "source 只支持 task、assistant_run、developer_api", http.StatusUnprocessableEntity)
	}
	return f, nil
}

// adminContentPolicyViolations 按时间倒序列出违规记录。
func (s *Server) adminContentPolicyViolations(c *gin.Context, _ *store.User) {
	filter, err := adminContentPolicyFilter(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, page, err := pageWindow(c, 20, 100)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	total, err := store.CountAdminContentPolicyViolationsCapped(ctx, s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListAdminContentPolicyViolations(ctx, s.St.Pool, filter, limit, (page-1)*limit)
	if err != nil {
		fail(c, err)
		return
	}
	models := map[string]string{}
	if cfg, err := modelconfig.Load(ctx, s.St.Pool); err == nil {
		for _, model := range cfg.Models {
			models[model.ID] = model.Name
		}
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, contentPolicyViolationDict(row, models))
	}
	var next any
	if int64(page*limit) < total.Value {
		next = strconv.Itoa(page + 1)
	}
	ok(c, gin.H{"items": items, "nextCursor": next, "page": page, "total": total.Value, "totalCapped": total.Capped})
}

func contentPolicyViolationDict(v *store.ContentPolicyViolation, models map[string]string) gin.H {
	model := models[v.ModelID]
	if model == "" {
		model = v.ModelID
	}
	item := gin.H{
		"id": v.ID, "createdAt": v.CreatedAt.UTC().Format(time.RFC3339), "source": v.SourceType, "sourceId": v.SourceID,
		"feature": v.Feature, "model": model, "prompt": v.Prompt, "upstreamMessage": v.UpstreamMessage,
		"matchedRule": v.MatchedRule, "amountCents": v.AmountCents, "chargedCents": v.ChargedCents,
		"status": v.Status, "waiveReason": v.WaiveReason, "refundNote": v.RefundNote, "refundedAt": nil,
		"user": gin.H{"id": v.UserID, "email": v.UserEmail, "username": v.Username},
	}
	if v.RefundedAt != nil {
		item["refundedAt"] = v.RefundedAt.UTC().Format(time.RFC3339)
	}
	return item
}

// adminContentPolicySummary 汇总筛选范围内的违规次数、扣费和违规最多的用户。
func (s *Server) adminContentPolicySummary(c *gin.Context, _ *store.User) {
	filter, err := adminContentPolicyFilter(c)
	if err != nil {
		fail(c, err)
		return
	}
	summary, err := store.SummarizeAdminContentPolicyViolations(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	users := make([]gin.H, 0, len(summary.TopUsers))
	for _, user := range summary.TopUsers {
		users = append(users, gin.H{
			"user":       gin.H{"id": user.UserID, "email": user.UserEmail, "username": user.Username},
			"violations": user.Violations, "chargedCents": user.ChargedCents, "lastAt": user.LastAt.UTC().Format(time.RFC3339),
		})
	}
	ok(c, gin.H{
		"violations": summary.Violations, "charged": summary.Charged, "waived": summary.Waived, "refunded": summary.Refunded,
		"chargedCents": summary.ChargedCents, "refundedCents": summary.RefundedCents, "users": summary.Users, "topUsers": users,
	})
}

// adminRefundContentPolicyViolation 把一次误判的违规扣费退回给用户，并发站内通知。
func (s *Server) adminRefundContentPolicyViolation(c *gin.Context, admin *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	if err := bindJSON(c, &in); err != nil {
		fail(c, err)
		return
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > 200 {
		fail(c, apperr.E("validation_error", "退回说明不能超过 200 个字", http.StatusUnprocessableEntity))
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		v, err := store.GetContentPolicyViolationForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if v == nil {
			return apperr.E("not_found", "违规记录不存在", http.StatusNotFound)
		}
		if v.Status != store.ContentPolicyCharged {
			return apperr.E("content_policy_not_refundable", "只有已扣费的记录可以退回", http.StatusConflict)
		}
		reason := "内容违规判定有误，管理员已退回积分"
		if note != "" {
			reason += "：" + note
		}
		if v.ChargedCents > 0 {
			if _, err := wallet.Grant(ctx, tx, v.UserID, v.ChargedCents, "refund", contentPolicyRefundSource, v.ID.String(), &reason); err != nil {
				return err
			}
		}
		if err := store.MarkContentPolicyViolationRefunded(ctx, tx, v.ID, admin.ID, note, time.Now().UTC()); err != nil {
			return err
		}
		body := "你有一次生成被判定为内容违规并扣除了积分，经核实判定有误，" + strconv.FormatInt(v.ChargedCents, 10) + " 积分已退回。"
		return store.InsertNotification(ctx, tx, &v.UserID, "system", "违规扣费已退回", &body)
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"refunded": true})
}
