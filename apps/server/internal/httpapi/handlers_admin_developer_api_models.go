package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Admin management of the developer API model catalog
// (docs/DEVELOPER_API_MODEL_CATALOG.md): list with usage, create drafts,
// edit, publish, maintenance, deprecation with notice, retirement, and
// emergency withdrawal back to draft. Price increases on a model in service
// are announced and take effect after apicatalog.PriceIncreaseNotice;
// decreases apply at once.

type adminAPIModelInput struct {
	APIName        *string   `json:"apiName"`
	Aliases        *[]string `json:"aliases"`
	TargetModelID  *string   `json:"targetModelId"`
	PriceMode      *string   `json:"priceMode"`
	PriceCents     *int64    `json:"priceCents"`
	MaxConcurrency *int      `json:"maxConcurrency"`
	Description    *string   `json:"description"`
	Reason         string    `json:"reason"`
}

func siteModelByID(cfg modelconfig.Config, id string) (modelconfig.Model, bool) {
	for _, model := range cfg.Models {
		if model.ID == id {
			return model, true
		}
	}
	return modelconfig.Model{}, false
}

func adminAPIModelDict(entry *store.DeveloperAPIModel, cfg modelconfig.Config, usage store.DeveloperAPIModelUsage, names map[string]string, now time.Time) gin.H {
	target := gin.H{"id": entry.TargetModelID, "name": "", "exists": false}
	var price any
	if model, ok := siteModelByID(cfg, entry.TargetModelID); ok {
		_, runnable := apicatalog.Runnable(cfg, model.ID)
		target = gin.H{"id": model.ID, "name": model.Name, "exists": true, "enabled": model.Enabled,
			"available": model.Available(), "runnable": runnable, "providerId": model.ProviderID,
			"sitePriceCents": apicatalog.SitePrice(cfg, entry, model)}
		price = apicatalog.UnitPrice(cfg, apicatalog.Resolved{Entry: entry, Selection: modelconfig.Selection{Model: model}}, now)
	}
	return gin.H{
		"id": entry.ID, "apiName": entry.APIName, "aliases": entry.Aliases, "kind": entry.Kind, "status": entry.StatusAt(now),
		"priceMode": entry.PriceMode, "priceCents": entry.PriceCents, "unitPriceCents": price, "pendingPrice": pendingPriceDict(entry, now),
		"maxConcurrency": entry.MaxConcurrency, "description": entry.Description, "locked": entry.PublishedAt != nil,
		"publishedAt": iso(entry.PublishedAt), "createdAt": isoValue(entry.CreatedAt), "updatedAt": isoValue(entry.UpdatedAt),
		"sunsetAt": iso(entry.SunsetAt), "deprecatedAt": iso(entry.DeprecatedAt), "retiredAt": iso(apicatalog.RetiredAt(entryIfRetired(entry, now))),
		"replacement": replacementDict(entry, names), "target": target, "usage": usage,
	}
}

func entryIfRetired(entry *store.DeveloperAPIModel, now time.Time) *store.DeveloperAPIModel {
	if entry.StatusAt(now) != store.DeveloperAPIModelRetired {
		return &store.DeveloperAPIModel{}
	}
	return entry
}

func pendingPriceDict(entry *store.DeveloperAPIModel, now time.Time) any {
	price, at, ok := apicatalog.UpcomingPrice(entry, now)
	if !ok {
		return nil
	}
	return gin.H{"priceCents": price, "effectiveAt": isoValue(at)}
}

func replacementDict(entry *store.DeveloperAPIModel, names map[string]string) any {
	if entry.ReplacementID == nil {
		return nil
	}
	return gin.H{"id": *entry.ReplacementID, "apiName": names[*entry.ReplacementID]}
}

func catalogNames(entries []*store.DeveloperAPIModel) map[string]string {
	names := make(map[string]string, len(entries))
	for _, entry := range entries {
		names[entry.ID] = entry.APIName
	}
	return names
}

// adminAPIModelResponse renders one entry after a change.
func (s *Server) adminAPIModelResponse(ctx context.Context, cfg modelconfig.Config, entry *store.DeveloperAPIModel) (gin.H, error) {
	entries, err := s.developerCatalog(ctx)
	if err != nil {
		return nil, err
	}
	usages, err := store.DeveloperAPIModelUsages(ctx, s.St.Pool, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return adminAPIModelDict(entry, cfg, usages[entry.ID], catalogNames(entries), time.Now()), nil
}

// adminDeveloperAPIModels lists the catalog with usage, plus the site models
// an entry can point at.
func (s *Server) adminDeveloperAPIModels(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	entries, err := s.developerCatalog(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	usages, err := store.DeveloperAPIModelUsages(ctx, s.St.Pool, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(entries))
	names, now := catalogNames(entries), time.Now()
	for _, entry := range entries {
		items = append(items, adminAPIModelDict(entry, cfg, usages[entry.ID], names, now))
	}
	targets := make([]gin.H, 0)
	for _, model := range cfg.Models {
		kind, ok := apicatalog.KindOf(model)
		if !ok {
			continue
		}
		_, runnable := apicatalog.Runnable(cfg, model.ID)
		targets = append(targets, gin.H{"id": model.ID, "name": model.Name, "kind": kind, "enabled": model.Enabled, "runnable": runnable,
			"sitePriceCents": modelconfig.ResolveWorkspacePrice(cfg, apicatalog.WorkspaceFor(kind), model).EffectiveCents})
	}
	noticeDays, err := apicatalog.DeprecationNoticeDays(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "targets": targets, "settings": gin.H{
		"deprecationNoticeDays": noticeDays, "priceIncreaseNoticeDays": int(apicatalog.PriceIncreaseNotice / (24 * time.Hour)),
	}})
}

func (s *Server) adminCreateDeveloperAPIModel(c *gin.Context, admin *store.User) {
	var body adminAPIModelInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.APIName == nil || body.TargetModelID == nil {
		fail(c, apperr.E("validation_error", "请填写模型名称并选择站内模型", 422))
		return
	}
	entry := &store.DeveloperAPIModel{ID: apicatalog.NewID(), APIName: strings.TrimSpace(*body.APIName), Aliases: []string{},
		TargetModelID: strings.TrimSpace(*body.TargetModelID), Status: store.DeveloperAPIModelDraft, PriceMode: store.DeveloperAPIPriceFollow}
	s.saveDeveloperAPIModel(c, admin, nil, entry, body, "create")
}

func (s *Server) adminUpdateDeveloperAPIModel(c *gin.Context, admin *store.User) {
	var body adminAPIModelInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	existing, err := store.GetDeveloperAPIModel(c.Request.Context(), s.St.Pool, c.Param("id"))
	if err != nil || existing == nil {
		fail(c, orNotFound(err, "API 模型不存在"))
		return
	}
	next := *existing
	s.saveDeveloperAPIModel(c, admin, existing, &next, body, "update")
}

// saveDeveloperAPIModel applies an edit with the catalog rules and records
// the change. before is nil for a new entry.
func (s *Server) saveDeveloperAPIModel(c *gin.Context, admin *store.User, before, entry *store.DeveloperAPIModel, body adminAPIModelInput, action string) {
	ctx := c.Request.Context()
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	invalid := func(format string, args ...any) {
		fail(c, apperr.E("validation_error", fmt.Sprintf(format, args...), 422))
	}
	if body.APIName != nil && strings.TrimSpace(*body.APIName) != entry.APIName {
		if entry.PublishedAt != nil {
			invalid("已发布的模型名称不能修改：调用方代码里写的就是它。需要新名称时请新建 API 模型，旧模型在下个阶段走弃用流程")
			return
		}
		entry.APIName = strings.TrimSpace(*body.APIName)
	}
	if body.Aliases != nil {
		aliases := []string{}
		for _, alias := range *body.Aliases {
			if alias = strings.TrimSpace(alias); alias != "" {
				aliases = append(aliases, alias)
			}
		}
		if len(aliases) > 10 {
			invalid("别名最多 10 个")
			return
		}
		entry.Aliases = aliases
	}
	if body.TargetModelID != nil {
		entry.TargetModelID = strings.TrimSpace(*body.TargetModelID)
	}
	target, found := siteModelByID(cfg, entry.TargetModelID)
	kind, supported := apicatalog.KindOf(target)
	if !found || !supported {
		invalid("请选择一个图片或对话类型的站内模型")
		return
	}
	if before == nil {
		entry.Kind = kind
	} else if kind != entry.Kind {
		invalid("不能把%s模型改为指向%s模型", kindLabel(entry.Kind), kindLabel(kind))
		return
	}
	reason := strings.TrimSpace(body.Reason)
	now := time.Now()
	inService := before != nil && before.InServiceAt(now)
	if before != nil && before.StatusAt(now) == store.DeveloperAPIModelRetired {
		invalid("已下线的 API 模型不能再修改")
		return
	}
	if before != nil && before.TargetModelID != entry.TargetModelID {
		if current, ok := siteModelByID(cfg, before.TargetModelID); ok && inService {
			if lost := apicatalog.Narrowing(current, target); len(lost) > 0 && reason == "" {
				fail(c, apperr.E("capability_narrowed", "新指向的站内模型能力少于当前模型："+strings.Join(lost, "；")+"。确认要更换请填写原因", 422))
				return
			}
		}
	}
	if body.PriceMode != nil {
		entry.PriceMode = *body.PriceMode
	}
	// requested is the price the admin asks for: a fixed price, or the site
	// price a following entry tracks.
	var requested int64
	switch entry.PriceMode {
	case store.DeveloperAPIPriceFollow:
		entry.PriceCents = nil
		requested = apicatalog.SitePrice(cfg, entry, target)
	case store.DeveloperAPIPriceFixed:
		switch {
		case body.PriceCents != nil:
			requested = *body.PriceCents
		case before != nil && before.PriceMode == store.DeveloperAPIPriceFixed:
			requested = apicatalog.EffectivePrice(before, 0, now)
			if pending, _, upcoming := apicatalog.UpcomingPrice(before, now); upcoming {
				requested = pending
			}
		default:
			invalid("固定价格须为 0 到 10 亿积分之间的整数")
			return
		}
		if requested < 0 || requested > 1000000000 {
			invalid("固定价格须为 0 到 10 亿积分之间的整数")
			return
		}
	default:
		invalid("价格方式只能是跟随站内价或固定价格")
		return
	}
	current := requested
	if inService {
		current = apicatalog.EffectivePrice(before, apicatalog.SitePrice(cfg, before, mustSiteModel(cfg, before.TargetModelID)), now)
	}
	announced := apicatalog.SettlePrice(entry, current, requested, inService, now)
	if body.MaxConcurrency != nil {
		if *body.MaxConcurrency < 0 || *body.MaxConcurrency > modelconfig.MaxDeveloperAPIConcurrency {
			invalid("并发上限须为 0-%d（0 为不限制）", modelconfig.MaxDeveloperAPIConcurrency)
			return
		}
		entry.MaxConcurrency = *body.MaxConcurrency
	}
	if body.Description != nil {
		entry.Description = strings.TrimSpace(*body.Description)
	}
	var saved *store.DeveloperAPIModel
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('developer_api_models_names'))`); err != nil {
			return err
		}
		entries, err := store.ListDeveloperAPIModels(ctx, tx)
		if err != nil {
			return err
		}
		if err := apicatalog.ValidateNames(entries, entry, now); err != nil {
			return apperr.E("validation_error", err.Error(), 422)
		}
		if before == nil {
			saved, err = store.InsertDeveloperAPIModel(ctx, tx, entry)
		} else {
			saved, err = store.UpdateDeveloperAPIModel(ctx, tx, entry)
		}
		if err != nil || saved == nil {
			return orNotFound(err, "API 模型不存在")
		}
		if announced {
			if err := apicatalog.NotifyPriceIncrease(ctx, tx, saved, current, now); err != nil {
				return err
			}
		}
		return store.InsertDeveloperAPIModelEvent(ctx, tx, saved.ID, admin.ID, action, reason, before, saved)
	})
	if err != nil {
		fail(c, err)
		return
	}
	status := http.StatusOK
	if before == nil {
		status = http.StatusCreated
	}
	data, err := s.adminAPIModelResponse(ctx, cfg, saved)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(status, gin.H{"success": true, "data": data})
}

func mustSiteModel(cfg modelconfig.Config, id string) modelconfig.Model {
	model, _ := siteModelByID(cfg, id)
	return model
}

// Lifecycle actions. Each locks the entry, checks the transition, records an
// event and, where integrators are affected, sends in-app notices.
const (
	apiModelPublish     = "publish"
	apiModelWithdraw    = "withdraw"
	apiModelMaintenance = "maintenance"
	apiModelResume      = "resume"
	apiModelDeprecate   = "deprecate"
	apiModelUndeprecate = "undeprecate"
	apiModelRetire      = "retire"
)

type apiModelActionInput struct {
	Reason        string  `json:"reason"`
	SunsetAt      *string `json:"sunsetAt"`
	ReplacementID *string `json:"replacementId"`
}

// adminPublishDeveloperAPIModel makes a draft callable. Its site model must be
// able to run, and its name is locked from now on.
func (s *Server) adminPublishDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelPublish)
}

// adminWithdrawDeveloperAPIModel is the emergency path back to draft: calls
// answer 404 at once, so a reason is required.
func (s *Server) adminWithdrawDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelWithdraw)
}

// adminMaintainDeveloperAPIModel pauses calls with 503 (retryable, free).
func (s *Server) adminMaintainDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelMaintenance)
}

func (s *Server) adminResumeDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelResume)
}

// adminDeprecateDeveloperAPIModel announces retirement at sunsetAt, at least
// the configured notice period away.
func (s *Server) adminDeprecateDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelDeprecate)
}

func (s *Server) adminUndeprecateDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelUndeprecate)
}

// adminRetireDeveloperAPIModel retires at once (410). Before the announced
// sunset this is the emergency path and needs a reason.
func (s *Server) adminRetireDeveloperAPIModel(c *gin.Context, admin *store.User) {
	s.developerAPIModelAction(c, admin, apiModelRetire)
}

func (s *Server) developerAPIModelAction(c *gin.Context, admin *store.User, action string) {
	var body apiModelActionInput
	_ = c.ShouldBindJSON(&body)
	ctx := c.Request.Context()
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	noticeDays, err := apicatalog.DeprecationNoticeDays(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	reason := strings.TrimSpace(body.Reason)
	now := time.Now().UTC()
	var saved *store.DeveloperAPIModel
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		existing, err := lockDeveloperAPIModel(ctx, tx, c.Param("id"))
		if err != nil {
			return err
		}
		entries, err := store.ListDeveloperAPIModels(ctx, tx)
		if err != nil {
			return err
		}
		names := catalogNames(entries)
		next := *existing
		status := existing.StatusAt(now)
		conflict := func(message string) error {
			return apperr.E("api_model_state_conflict", message, http.StatusConflict)
		}
		needReason := func(message string) error {
			if reason == "" {
				return apperr.E("validation_error", message, 422)
			}
			return nil
		}
		var notice func() error
		switch action {
		case apiModelPublish:
			if status != store.DeveloperAPIModelDraft {
				return conflict("只有草稿可以发布")
			}
			if _, runnable := apicatalog.Runnable(cfg, existing.TargetModelID); !runnable {
				return apperr.E("validation_error", "它指向的站内模型已停用、维护中或线路是异步任务协议（CRUN），发布后会无法调用；请先处理站内模型或更换指向", 422)
			}
			if next.PublishedAt == nil {
				next.PublishedAt = &now
			}
			next.Status = store.DeveloperAPIModelLive
			// A new model starts at today's price; there is nobody to notify.
			requested := apicatalog.SitePrice(cfg, &next, mustSiteModel(cfg, next.TargetModelID))
			if next.PriceMode == store.DeveloperAPIPriceFixed {
				requested = apicatalog.EffectivePrice(&next, 0, now)
				if pending, _, upcoming := apicatalog.UpcomingPrice(&next, now); upcoming {
					requested = pending
				}
			}
			apicatalog.SettlePrice(&next, requested, requested, false, now)
		case apiModelWithdraw:
			if !existing.InServiceAt(now) {
				return conflict("只有上线、维护中或弃用中的模型可以撤回")
			}
			if err := needReason("撤回会让调用立即返回 404，请填写原因"); err != nil {
				return err
			}
			next.Status = store.DeveloperAPIModelDraft
			next.SunsetAt, next.DeprecatedAt = nil, nil
		case apiModelMaintenance:
			if !existing.CallableAt(now) {
				return conflict("只有上线或弃用中的模型可以设为维护")
			}
			next.Status = store.DeveloperAPIModelMaintenance
		case apiModelResume:
			if status != store.DeveloperAPIModelMaintenance {
				return conflict("模型不在维护中")
			}
			if _, runnable := apicatalog.Runnable(cfg, existing.TargetModelID); !runnable {
				return apperr.E("validation_error", "它指向的站内模型仍不可用（已停用、维护中，或线路为 CRUN 异步任务协议），恢复后调用仍会返回 503", 422)
			}
			next.Status = store.DeveloperAPIModelLive
			if next.SunsetAt != nil {
				next.Status = store.DeveloperAPIModelDeprecated
			}
		case apiModelDeprecate:
			if status != store.DeveloperAPIModelLive {
				return conflict("只有已上线的模型可以弃用")
			}
			if body.SunsetAt == nil {
				return apperr.E("validation_error", "请选择下线时间", 422)
			}
			sunset, err := time.Parse(time.RFC3339, *body.SunsetAt)
			if err != nil {
				return apperr.E("validation_error", "下线时间格式无效", 422)
			}
			// A minute of slack so "exactly N days from now" picked in the
			// form still passes.
			earliest := now.Add(time.Duration(noticeDays)*24*time.Hour - time.Minute)
			if sunset.Before(earliest) {
				return apperr.E("validation_error", fmt.Sprintf("下线时间至少要在 %d 天之后（弃用预告期）；需要立即停止请用「紧急下线」", noticeDays), 422)
			}
			replacement, err := validReplacement(entries, existing, body.ReplacementID, now)
			if err != nil {
				return err
			}
			sunset = sunset.UTC()
			next.Status, next.SunsetAt, next.DeprecatedAt, next.ReplacementID = store.DeveloperAPIModelDeprecated, &sunset, &now, replacement
			notice = func() error { return apicatalog.NotifyDeprecated(ctx, tx, &next, names, now) }
		case apiModelUndeprecate:
			if existing.Status != store.DeveloperAPIModelDeprecated || status != store.DeveloperAPIModelDeprecated {
				return conflict("模型不在弃用中")
			}
			next.Status, next.SunsetAt, next.DeprecatedAt = store.DeveloperAPIModelLive, nil, nil
			notice = func() error {
				body := fmt.Sprintf("API 调用模型「%s」的下线计划已取消，可以继续正常调用。", next.APIName)
				users, err := store.DeveloperAPIModelAudience(ctx, tx, next.ID, now)
				if err != nil {
					return err
				}
				for _, id := range users {
					userID := id
					if err := store.InsertNotification(ctx, tx, &userID, "system", "API 调用模型下线计划已取消", &body); err != nil {
						return err
					}
				}
				return nil
			}
		case apiModelRetire:
			if !existing.InServiceAt(now) {
				return conflict("只有上线、维护中或弃用中的模型可以下线")
			}
			if err := needReason("紧急下线会让调用立即返回 410，请填写原因"); err != nil {
				return err
			}
			replacement := existing.ReplacementID
			if body.ReplacementID != nil {
				if replacement, err = validReplacement(entries, existing, body.ReplacementID, now); err != nil {
					return err
				}
			}
			next.Status, next.RetiredAt, next.ReplacementID = store.DeveloperAPIModelRetired, &now, replacement
			next.PendingPriceCents, next.PendingPriceAt = nil, nil
			notice = func() error { return apicatalog.NotifyRetired(ctx, tx, &next, names, now) }
		}
		saved, err = store.UpdateDeveloperAPIModel(ctx, tx, &next)
		if err != nil {
			return err
		}
		if notice != nil {
			if err := notice(); err != nil {
				return err
			}
		}
		return store.InsertDeveloperAPIModelEvent(ctx, tx, saved.ID, admin.ID, action, reason, existing, saved)
	})
	if err != nil {
		fail(c, err)
		return
	}
	data, err := s.adminAPIModelResponse(ctx, cfg, saved)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, data)
}

// validReplacement checks a suggested successor: another live model of the
// same kind. An empty id clears the suggestion.
func validReplacement(entries []*store.DeveloperAPIModel, self *store.DeveloperAPIModel, id *string, now time.Time) (*string, error) {
	if id == nil || strings.TrimSpace(*id) == "" {
		return nil, nil
	}
	want := strings.TrimSpace(*id)
	for _, entry := range entries {
		if entry.ID != want {
			continue
		}
		if entry.ID == self.ID || entry.Kind != self.Kind || entry.StatusAt(now) != store.DeveloperAPIModelLive {
			return nil, apperr.E("validation_error", "替代模型须为另一个已上线的同类型 API 模型", 422)
		}
		return &want, nil
	}
	return nil, apperr.E("validation_error", "替代模型不存在", 422)
}

// adminDeveloperAPIModelSettings reads and writes the catalog settings: the
// deprecation notice period. The price increase notice is fixed.
func (s *Server) adminDeveloperAPIModelSettings(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	if c.Request.Method == http.MethodPut {
		var body struct {
			DeprecationNoticeDays int `json:"deprecationNoticeDays"`
		}
		if err := bindJSON(c, &body); err != nil {
			fail(c, err)
			return
		}
		if err := apicatalog.SetDeprecationNoticeDays(ctx, s.St.Pool, body.DeprecationNoticeDays); err != nil {
			fail(c, apperr.E("validation_error", err.Error(), 422))
			return
		}
	}
	days, err := apicatalog.DeprecationNoticeDays(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"deprecationNoticeDays": days, "priceIncreaseNoticeDays": int(apicatalog.PriceIncreaseNotice / (24 * time.Hour))})
}

func lockDeveloperAPIModel(ctx context.Context, tx pgx.Tx, id string) (*store.DeveloperAPIModel, error) {
	var locked string
	if err := tx.QueryRow(ctx, `SELECT id FROM developer_api_models WHERE id=$1 FOR UPDATE`, id).Scan(&locked); err != nil {
		if err == pgx.ErrNoRows {
			return nil, apperr.E("not_found", "API 模型不存在", http.StatusNotFound)
		}
		return nil, err
	}
	return store.GetDeveloperAPIModel(ctx, tx, id)
}

func orNotFound(err error, message string) error {
	if err != nil {
		return err
	}
	return apperr.E("not_found", message, http.StatusNotFound)
}

func kindLabel(kind string) string {
	if kind == "chat" {
		return "对话"
	}
	return "图片"
}
