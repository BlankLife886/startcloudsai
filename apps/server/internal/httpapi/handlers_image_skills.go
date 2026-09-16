package httpapi

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type imageSkillIn struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Instruction string   `json:"instruction"`
	TaskTypes   []string `json:"taskTypes"`
	Category    *string  `json:"category"`
	Tags        []string `json:"tags"`
	CoverKey    *string  `json:"coverKey"`
	Sort        *int     `json:"sort"`
	Active      *bool    `json:"active"`
}

func imageSkillDict(skill store.ImageSkill) gin.H {
	return gin.H{
		"id": skill.ID, "name": skill.Name, "description": skill.Description,
		"instruction": skill.Instruction, "taskTypes": skill.TaskTypes,
		"category": skill.Category, "tags": skill.Tags, "coverKey": skill.CoverKey,
		"sort": skill.Sort, "active": skill.Active, "official": skill.Official(),
		"createdAt": skill.CreatedAt, "updatedAt": skill.UpdatedAt,
	}
}

func imageSkillDicts(skills []store.ImageSkill) []gin.H {
	out := make([]gin.H, 0, len(skills))
	for _, skill := range skills {
		out = append(out, imageSkillDict(skill))
	}
	return out
}

// applyImageSkillInput 把请求体套到 skill 上。创建时 base 为零值，
// 更新时为库里的当前值，这样未提供的字段保持原样。
func applyImageSkillInput(base *store.ImageSkill, body imageSkillIn, creating bool) {
	if creating || strings.TrimSpace(body.Name) != "" {
		base.Name = body.Name
	}
	if creating || body.Instruction != "" {
		base.Instruction = body.Instruction
	}
	if creating || body.Description != "" {
		base.Description = body.Description
	}
	if body.TaskTypes != nil {
		base.TaskTypes = body.TaskTypes
	}
	if body.Tags != nil {
		base.Tags = body.Tags
	}
	if body.Category != nil {
		base.Category = body.Category
	}
	if body.CoverKey != nil {
		base.CoverKey = body.CoverKey
	}
	if body.Sort != nil {
		base.Sort = *body.Sort
	}
	if body.Active != nil {
		base.Active = *body.Active
	} else if creating {
		base.Active = true
	}
}

func failSkillValidation(c *gin.Context, err error) {
	fail(c, apperr.E("validation_error", err.Error(), 422))
}

// ---------- 后台：官方 skill 词库 ----------

func (s *Server) adminListImageSkills(c *gin.Context, _ *store.User) {
	skills, err := store.ListSkills(c.Request.Context(), s.St.Pool, store.SkillFilter{
		OfficialOnly: true,
		TaskType:     strings.TrimSpace(c.Query("taskType")),
		Category:     strings.TrimSpace(c.Query("category")),
		Search:       strings.TrimSpace(c.Query("search")),
		ActiveOnly:   c.Query("status") == "enabled",
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": imageSkillDicts(skills), "taskTypes": store.SkillTaskTypes})
}

func (s *Server) adminCreateImageSkill(c *gin.Context, _ *store.User) {
	var body imageSkillIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	skill := store.ImageSkill{}
	applyImageSkillInput(&skill, body, true)
	created, err := store.InsertSkill(c.Request.Context(), s.St.Pool, &skill)
	if err != nil {
		failSkillValidation(c, err)
		return
	}
	ok(c, imageSkillDict(*created))
}

func (s *Server) adminPatchImageSkill(c *gin.Context, _ *store.User) {
	skillID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body imageSkillIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	current, err := store.GetSkill(ctx, s.St.Pool, skillID)
	if err != nil {
		fail(c, err)
		return
	}
	if current == nil || !current.Official() {
		fail(c, apperr.E("not_found", "Skill 不存在", 404))
		return
	}
	applyImageSkillInput(current, body, false)
	updated, err := store.UpdateSkill(ctx, s.St.Pool, current)
	if err != nil {
		failSkillValidation(c, err)
		return
	}
	ok(c, imageSkillDict(*updated))
}

func (s *Server) adminDeleteImageSkill(c *gin.Context, _ *store.User) {
	skillID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	if err := store.DeleteSkill(c.Request.Context(), s.St.Pool, skillID, nil); err != nil {
		if errors.Is(err, store.ErrSkillNotFound) {
			fail(c, apperr.E("not_found", "Skill 不存在", 404))
			return
		}
		fail(c, err)
		return
	}
	ok(c, gin.H{"deleted": true})
}

// ---------- 用户端：可用 skill 与自建 skill ----------

func (s *Server) myImageSkills(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	skills, err := store.ListSkills(ctx, s.St.Pool, store.SkillFilter{
		OwnerUserID:     &user.ID,
		IncludeOfficial: true,
		ActiveOnly:      true,
		TaskType:        strings.TrimSpace(c.Query("taskType")),
		Search:          strings.TrimSpace(c.Query("search")),
	})
	if err != nil {
		fail(c, err)
		return
	}
	bindings, err := store.GetSkillBindings(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{
		"items": imageSkillDicts(skills), "bindings": bindings,
		"taskTypes": store.SkillTaskTypes, "maxPerScope": store.SkillMaxBindingsPerScope,
	})
}

func (s *Server) createMyImageSkill(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body imageSkillIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	owned, err := store.CountSkillsOwnedBy(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if owned >= store.SkillMaxOwnedPerUser {
		fail(c, apperr.E("validation_error", "自建 Skill 数量已达上限", 422))
		return
	}
	skill := store.ImageSkill{OwnerUserID: &user.ID}
	applyImageSkillInput(&skill, body, true)
	// 排序位和封面只由后台词库使用，用户自建不开放。
	skill.Sort, skill.CoverKey = 0, nil
	created, err := store.InsertSkill(ctx, s.St.Pool, &skill)
	if err != nil {
		failSkillValidation(c, err)
		return
	}
	ok(c, imageSkillDict(*created))
}

func (s *Server) patchMyImageSkill(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	skillID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body imageSkillIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	current, err := store.GetSkill(ctx, s.St.Pool, skillID)
	if err != nil {
		fail(c, err)
		return
	}
	// 官方 skill 对用户只读；要改就先复制成自己的。
	if current == nil || current.OwnerUserID == nil || *current.OwnerUserID != user.ID {
		fail(c, apperr.E("not_found", "Skill 不存在", 404))
		return
	}
	applyImageSkillInput(current, body, false)
	// 自建 skill 恒为启用：用户列表按 active 过滤，一旦停用就再也看不到、
	// 也改不回来了。要停止生效应当取消装载，而不是停用词条。
	current.Active = true
	updated, err := store.UpdateSkill(ctx, s.St.Pool, current)
	if err != nil {
		failSkillValidation(c, err)
		return
	}
	ok(c, imageSkillDict(*updated))
}

func (s *Server) deleteMyImageSkill(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	skillID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	if err := store.DeleteSkill(c.Request.Context(), s.St.Pool, skillID, &user.ID); err != nil {
		if errors.Is(err, store.ErrSkillNotFound) {
			fail(c, apperr.E("not_found", "Skill 不存在", 404))
			return
		}
		fail(c, err)
		return
	}
	ok(c, gin.H{"deleted": true})
}

// ---------- 用户端：装载状态 ----------

type skillBindingIn struct {
	SkillIDs []uuid.UUID `json:"skillIds"`
}

// putMySkillBindings 整体替换一个装载位。scope 为 global 或某个生图页面。
func (s *Server) putMySkillBindings(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body skillBindingIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	scope := strings.TrimSpace(c.Param("scope"))
	if err := store.SetSkillBindings(ctx, s.St, user.ID, scope, body.SkillIDs); err != nil {
		if errors.Is(err, store.ErrSkillNotFound) {
			fail(c, apperr.E("not_found", "Skill 不存在或已停用", 404))
			return
		}
		failSkillValidation(c, err)
		return
	}
	bindings, err := store.GetSkillBindings(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"bindings": bindings})
}

// myResolvedSkills 给出某个生图页面实际生效的 skill，前端据此拼提示词。
func (s *Server) myResolvedSkills(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	taskType := strings.TrimSpace(c.Query("taskType"))
	if !store.Contains(store.SkillTaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "taskType: 未知的生图页面", 422))
		return
	}
	skills, err := store.ResolveSkillsForTaskType(c.Request.Context(), s.St.Pool, user.ID, taskType)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"taskType": taskType, "items": imageSkillDicts(skills)})
}
