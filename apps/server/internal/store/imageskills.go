package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SkillGlobalScope 是"所有生图都自动带上"的装载位。
const SkillGlobalScope = "global"

// SkillTaskTypes 是可以绑定 skill 的生图页面，与 tasks.type 及
// user_skill_bindings.scope 的 CHECK 保持一致。
//
// 只收「用户自己写提示词」的页面。故意不含 puzzle（本地工具，CreateTask 直接报
// puzzle_local_only）、background_remove 与 media_tool（提示词是系统生成的固定
// 文案，拼 skill 指令没有意义），否则用户会在装载页看到一堆不生效的选项。
var SkillTaskTypes = []string{
	"t2i", "coloring", "ui_design", "ecommerce_design", "model_sheet", "game_art",
}

const (
	SkillMaxNameLen        = 64
	SkillMaxDescriptionLen = 500
	SkillMaxInstructionLen = 4000
	// 单个装载位最多挂多少个 skill，避免拼出超长提示词。
	SkillMaxBindingsPerScope = 5
	// 用户自建 skill 的总量上限。
	SkillMaxOwnedPerUser = 100
)

var ErrSkillNotFound = errors.New("skill not found")

// ImageSkill 既是后台录入的官方 skill（OwnerUserID 为 nil），也是用户自建 skill。
type ImageSkill struct {
	ID          uuid.UUID
	OwnerUserID *uuid.UUID
	Name        string
	Description string
	Instruction string
	// TaskTypes 为空表示全部生图页面都可用。
	TaskTypes []string
	Category  *string
	Tags      []string
	CoverKey  *string
	Sort      int
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (s ImageSkill) Official() bool { return s.OwnerUserID == nil }

// AppliesTo 判断 skill 是否可用于某个生图页面。
func (s ImageSkill) AppliesTo(taskType string) bool {
	if len(s.TaskTypes) == 0 {
		return true
	}
	return Contains(s.TaskTypes, taskType)
}

const imageSkillCols = `id, owner_user_id, name, description, instruction, task_types,
	category, tags, cover_key, sort, active, created_at, updated_at`

func scanImageSkill(row pgx.Row) (*ImageSkill, error) {
	var s ImageSkill
	var taskTypes, tags []byte
	err := row.Scan(&s.ID, &s.OwnerUserID, &s.Name, &s.Description, &s.Instruction, &taskTypes,
		&s.Category, &tags, &s.CoverKey, &s.Sort, &s.Active, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(taskTypes, &s.TaskTypes); err != nil {
		return nil, fmt.Errorf("decode skill task types: %w", err)
	}
	if err := json.Unmarshal(tags, &s.Tags); err != nil {
		return nil, fmt.Errorf("decode skill tags: %w", err)
	}
	if s.TaskTypes == nil {
		s.TaskTypes = []string{}
	}
	if s.Tags == nil {
		s.Tags = []string{}
	}
	return &s, nil
}

// NormalizeSkill 在写库前收敛字段，并拒绝越界或未知的取值。
func NormalizeSkill(s *ImageSkill) error {
	s.Name = strings.TrimSpace(s.Name)
	s.Description = strings.TrimSpace(s.Description)
	s.Instruction = strings.TrimSpace(s.Instruction)
	if s.Name == "" || len([]rune(s.Name)) > SkillMaxNameLen {
		return fmt.Errorf("name: 需在 1 ~ %d 字之间", SkillMaxNameLen)
	}
	if len([]rune(s.Description)) > SkillMaxDescriptionLen {
		return fmt.Errorf("description: 不能超过 %d 字", SkillMaxDescriptionLen)
	}
	if s.Instruction == "" || len([]rune(s.Instruction)) > SkillMaxInstructionLen {
		return fmt.Errorf("instruction: 需在 1 ~ %d 字之间", SkillMaxInstructionLen)
	}
	seen := make(map[string]bool, len(s.TaskTypes))
	kinds := make([]string, 0, len(s.TaskTypes))
	for _, raw := range s.TaskTypes {
		kind := strings.TrimSpace(raw)
		if kind == "" || seen[kind] {
			continue
		}
		if !Contains(SkillTaskTypes, kind) {
			return fmt.Errorf("taskTypes: 未知的生图页面 %s", kind)
		}
		seen[kind] = true
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	s.TaskTypes = kinds
	if s.Tags == nil {
		s.Tags = []string{}
	}
	return nil
}

func InsertSkill(ctx context.Context, q Q, s *ImageSkill) (*ImageSkill, error) {
	if err := NormalizeSkill(s); err != nil {
		return nil, err
	}
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return scanImageSkill(q.QueryRow(ctx,
		`INSERT INTO image_skills (id, owner_user_id, name, description, instruction, task_types,
			category, tags, cover_key, sort, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING `+imageSkillCols,
		s.ID, s.OwnerUserID, s.Name, s.Description, s.Instruction, s.TaskTypes,
		s.Category, s.Tags, s.CoverKey, s.Sort, s.Active))
}

func GetSkill(ctx context.Context, q Q, id uuid.UUID) (*ImageSkill, error) {
	s, err := scanImageSkill(q.QueryRow(ctx, `SELECT `+imageSkillCols+` FROM image_skills WHERE id=$1`, id))
	return nilOnNoRows(s, err)
}

// SkillFilter 列表筛选。OwnerUserID 为 nil 且 OfficialOnly 时只返回官方 skill。
type SkillFilter struct {
	OwnerUserID  *uuid.UUID
	OfficialOnly bool
	// IncludeOfficial 让用户端一次拿到"官方 + 自己的"。
	IncludeOfficial bool
	TaskType        string
	Category        string
	Search          string
	ActiveOnly      bool
}

func ListSkills(ctx context.Context, q Q, f SkillFilter) ([]ImageSkill, error) {
	sql := `SELECT ` + imageSkillCols + ` FROM image_skills WHERE true`
	args := []any{}
	switch {
	case f.OwnerUserID != nil && f.IncludeOfficial:
		args = append(args, *f.OwnerUserID)
		sql += fmt.Sprintf(` AND (owner_user_id IS NULL OR owner_user_id=$%d)`, len(args))
	case f.OwnerUserID != nil:
		args = append(args, *f.OwnerUserID)
		sql += fmt.Sprintf(` AND owner_user_id=$%d`, len(args))
	case f.OfficialOnly:
		sql += ` AND owner_user_id IS NULL`
	}
	if f.ActiveOnly {
		sql += ` AND active`
	}
	if f.TaskType != "" {
		args = append(args, f.TaskType)
		// 空 task_types 表示全部页面通用，也要命中。
		sql += fmt.Sprintf(` AND (task_types = '[]'::jsonb OR task_types ? $%d)`, len(args))
	}
	if f.Category != "" {
		args = append(args, f.Category)
		sql += fmt.Sprintf(` AND category=$%d`, len(args))
	}
	if search := strings.TrimSpace(f.Search); search != "" {
		args = append(args, "%"+search+"%")
		sql += fmt.Sprintf(` AND (name ILIKE $%d OR description ILIKE $%d)`, len(args), len(args))
	}
	// 官方 skill 先按后台排序位，再按新建时间。
	sql += ` ORDER BY owner_user_id NULLS FIRST, sort, created_at DESC`
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	skills := []ImageSkill{}
	for rows.Next() {
		s, err := scanImageSkill(rows)
		if err != nil {
			return nil, err
		}
		skills = append(skills, *s)
	}
	return skills, rows.Err()
}

func UpdateSkill(ctx context.Context, q Q, s *ImageSkill) (*ImageSkill, error) {
	if err := NormalizeSkill(s); err != nil {
		return nil, err
	}
	updated, err := scanImageSkill(q.QueryRow(ctx,
		`UPDATE image_skills SET name=$2, description=$3, instruction=$4, task_types=$5,
			category=$6, tags=$7, cover_key=$8, sort=$9, active=$10, updated_at=now()
		 WHERE id=$1 RETURNING `+imageSkillCols,
		s.ID, s.Name, s.Description, s.Instruction, s.TaskTypes,
		s.Category, s.Tags, s.CoverKey, s.Sort, s.Active))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSkillNotFound
	}
	return updated, err
}

// DeleteSkill 按 owner 作用域删除；ownerUserID 为 nil 时只删官方 skill。
// 装载记录随外键级联清理。
func DeleteSkill(ctx context.Context, q Q, id uuid.UUID, ownerUserID *uuid.UUID) error {
	sql := `DELETE FROM image_skills WHERE id=$1 AND owner_user_id IS NULL`
	args := []any{id}
	if ownerUserID != nil {
		sql = `DELETE FROM image_skills WHERE id=$1 AND owner_user_id=$2`
		args = append(args, *ownerUserID)
	}
	tag, err := q.Exec(ctx, sql, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrSkillNotFound
	}
	return nil
}

func CountSkillsOwnedBy(ctx context.Context, q Q, userID uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM image_skills WHERE owner_user_id=$1`, userID).Scan(&n)
	return n, err
}

// SkillBindings 是某个用户的全部装载状态，key 为 SkillGlobalScope 或生图页面。
type SkillBindings map[string][]uuid.UUID

func GetSkillBindings(ctx context.Context, q Q, userID uuid.UUID) (SkillBindings, error) {
	rows, err := q.Query(ctx,
		`SELECT scope, skill_id FROM user_skill_bindings WHERE user_id=$1 ORDER BY scope, sort, created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bindings := SkillBindings{}
	for rows.Next() {
		var scope string
		var skillID uuid.UUID
		if err := rows.Scan(&scope, &skillID); err != nil {
			return nil, err
		}
		bindings[scope] = append(bindings[scope], skillID)
	}
	return bindings, rows.Err()
}

// SetSkillBindings 整体替换某个装载位。传空表示清空该位。
func SetSkillBindings(ctx context.Context, st *Store, userID uuid.UUID, scope string, skillIDs []uuid.UUID) error {
	if scope != SkillGlobalScope && !Contains(SkillTaskTypes, scope) {
		return fmt.Errorf("scope: 未知的装载位 %s", scope)
	}
	seen := make(map[uuid.UUID]bool, len(skillIDs))
	ordered := make([]uuid.UUID, 0, len(skillIDs))
	for _, id := range skillIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		ordered = append(ordered, id)
	}
	if len(ordered) > SkillMaxBindingsPerScope {
		return fmt.Errorf("skillIds: 单个装载位最多 %d 个 skill", SkillMaxBindingsPerScope)
	}
	return st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM user_skill_bindings WHERE user_id=$1 AND scope=$2`, userID, scope); err != nil {
			return err
		}
		for index, skillID := range ordered {
			// 只允许装载官方 skill 或自己的 skill，且必须适用于该装载位。
			skill, err := GetSkill(ctx, tx, skillID)
			if err != nil {
				return err
			}
			if skill == nil || !skill.Active {
				return ErrSkillNotFound
			}
			if skill.OwnerUserID != nil && *skill.OwnerUserID != userID {
				return ErrSkillNotFound
			}
			if scope != SkillGlobalScope && !skill.AppliesTo(scope) {
				return fmt.Errorf("skillIds: %s 不适用于该生图页面", skill.Name)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO user_skill_bindings (user_id, scope, skill_id, sort) VALUES ($1,$2,$3,$4)`,
				userID, scope, skillID, index); err != nil {
				return err
			}
		}
		return nil
	})
}

// ResolveSkillsForTaskType 给出某个生图页面实际生效的 skill。
// 页面绑定优先于全局：页面一旦有绑定就只用页面的，否则回落到全局装载。
func ResolveSkillsForTaskType(ctx context.Context, q Q, userID uuid.UUID, taskType string) ([]ImageSkill, error) {
	bindings, err := GetSkillBindings(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	ids := bindings[taskType]
	if len(ids) == 0 {
		ids = bindings[SkillGlobalScope]
	}
	if len(ids) == 0 {
		return []ImageSkill{}, nil
	}
	rows, err := q.Query(ctx,
		`SELECT `+imageSkillCols+` FROM image_skills WHERE id = ANY($1) AND active`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := make(map[uuid.UUID]ImageSkill, len(ids))
	for rows.Next() {
		s, err := scanImageSkill(rows)
		if err != nil {
			return nil, err
		}
		byID[s.ID] = *s
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// 保留装载顺序，并丢掉对该页面不适用的（官方 skill 可能后来收窄了适用范围）。
	resolved := make([]ImageSkill, 0, len(ids))
	for _, id := range ids {
		if skill, exists := byID[id]; exists && skill.AppliesTo(taskType) {
			resolved = append(resolved, skill)
		}
	}
	return resolved, nil
}
