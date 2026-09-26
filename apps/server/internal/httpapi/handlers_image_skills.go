package httpapi

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type imageSkillIn struct {
	// Slug 是调用名；留空则由名称推导（推不出时用 id 兜底）。
	Slug        string   `json:"slug"`
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
		"id": skill.ID, "slug": skill.Slug, "name": skill.Name, "description": skill.Description,
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
	if strings.TrimSpace(body.Slug) != "" {
		base.Slug = body.Slug
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
	if errors.Is(err, store.ErrSkillSlugTaken) {
		fail(c, apperr.E("validation_error", "slug: 这个调用名已经被占用，换一个试试", 422))
		return
	}
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

// ---------- 用户端：官方 skill + 存在云端的自建 skill ----------

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
	owned := 0
	for _, skill := range skills {
		if !skill.Official() {
			owned++
		}
	}
	ok(c, gin.H{
		"items": imageSkillDicts(skills),
		// 云端配额：前端据此决定还能不能"保存到云端"。
		"owned": owned, "maxOwned": store.SkillMaxOwnedPerUser,
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
		fail(c, apperr.E("validation_error",
			fmt.Sprintf("云端最多保存 %d 个技能，删掉一个或改存本地", store.SkillMaxOwnedPerUser), 422))
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
	// 也改不回来了。不想用了直接删。
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
