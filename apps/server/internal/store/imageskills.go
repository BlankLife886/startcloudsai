package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SkillTaskTypes 是官方 skill 可以标注"推荐用于哪些生图页面"的取值范围，
// 与 tasks.type 保持一致。只是给后台做筛选/分类用，不再决定 skill 在哪里生效：
// 技能在输入框里以 @ 的形式由用户按需调用。
var SkillTaskTypes = []string{
	"t2i", "coloring", "ui_design", "ecommerce_design", "model_sheet", "game_art",
}

const (
	SkillMaxNameLen        = 64
	SkillMaxSlugLen        = 64
	SkillMaxDescriptionLen = 500
	SkillMaxInstructionLen = 4000
	SkillMaxTagLen         = 24
	SkillMaxTags           = 10
	// 每个用户存到云端的 skill 上限。本地存储的不计入，由前端自行限制。
	SkillMaxOwnedPerUser = 5
)

// unsafeSkillRune 判定要从用户输入里剔除的字符：控制字符（保留换行、制表）、
// 零宽字符、Unicode 双向控制符。双向控制符能让 `@技能名` 在视觉上伪装成别的
// 名字，必须去掉。
func unsafeSkillRune(r rune) bool {
	switch {
	case r == '\n' || r == '\t':
		return false
	case r < 0x20 || r == 0x7f:
		return true
	case r >= 0x200b && r <= 0x200f:
		return true
	case r >= 0x2028 && r <= 0x202e:
		return true
	case r >= 0x2066 && r <= 0x2069:
		return true
	case r == 0xfeff:
		return true
	}
	return false
}

// sanitizeSkillText 剔除不安全字符并收敛首尾空白；单行文本再把换行折成空格。
func sanitizeSkillText(value string, singleLine bool) string {
	out := make([]rune, 0, len(value))
	for _, r := range strings.ReplaceAll(value, "\r\n", "\n") {
		if unsafeSkillRune(r) {
			continue
		}
		if singleLine && (r == '\n' || r == '\t') {
			r = ' '
		}
		out = append(out, r)
	}
	text := string(out)
	if singleLine {
		text = strings.Join(strings.Fields(text), " ")
	}
	return strings.TrimSpace(text)
}

var (
	ErrSkillNotFound  = errors.New("skill not found")
	ErrSkillSlugTaken = errors.New("skill slug already taken")
)

// skillSlugPattern 与迁移里的 CHECK、前端 SKILL_SLUG_PATTERN 一致：
// 以字母开头的 hyphen-case（Codex SKILL.md 的 name 口径）。
var skillSlugPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)

var skillSlugJunk = regexp.MustCompile(`[^a-z0-9]+`)

// SlugifySkillName 从名称推导调用名：只保留 ASCII 字母数字，其余折成连字符。
// 纯中文名称推不出任何字符时返回空串，由调用方另行兜底。
func SlugifySkillName(name string) string {
	slug := skillSlugJunk.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	slug = strings.Trim(slug, "-")
	// 去掉开头的数字段，保证以字母开头。
	for slug != "" && (slug[0] < 'a' || slug[0] > 'z') {
		if index := strings.IndexByte(slug, '-'); index >= 0 {
			slug = slug[index+1:]
		} else {
			slug = ""
		}
	}
	if len(slug) > SkillMaxSlugLen {
		slug = strings.Trim(slug[:SkillMaxSlugLen], "-")
	}
	return slug
}

// FallbackSkillSlug 在名称推不出调用名时用 id 生成一个短而稳定的调用名。
func FallbackSkillSlug(id uuid.UUID) string {
	return "skill-" + strings.ReplaceAll(id.String(), "-", "")[:8]
}

// ImageSkill 既是后台录入的官方 skill（OwnerUserID 为 nil），也是用户自建 skill。
type ImageSkill struct {
	ID          uuid.UUID
	OwnerUserID *uuid.UUID
	// Slug 是调用名：hyphen-case，官方全局唯一、自建在用户名下唯一。
	Slug        string
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

const imageSkillCols = `id, owner_user_id, slug, name, description, instruction, task_types,
	category, tags, cover_key, sort, active, created_at, updated_at`

func scanImageSkill(row pgx.Row) (*ImageSkill, error) {
	var s ImageSkill
	var taskTypes, tags []byte
	err := row.Scan(&s.ID, &s.OwnerUserID, &s.Slug, &s.Name, &s.Description, &s.Instruction, &taskTypes,
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
// 调用名为空时从名称推导，推不出再用 id 兜底，因此 s.ID 需要先赋值。
func NormalizeSkill(s *ImageSkill) error {
	s.Name = sanitizeSkillText(s.Name, true)
	s.Description = sanitizeSkillText(s.Description, true)
	s.Instruction = sanitizeSkillText(s.Instruction, false)
	if s.Name == "" || len([]rune(s.Name)) > SkillMaxNameLen {
		return fmt.Errorf("name: 需在 1 ~ %d 字之间", SkillMaxNameLen)
	}
	s.Slug = strings.ToLower(strings.TrimSpace(s.Slug))
	if s.Slug == "" {
		s.Slug = SlugifySkillName(s.Name)
	}
	if s.Slug == "" {
		if s.ID == uuid.Nil {
			s.ID = uuid.New()
		}
		s.Slug = FallbackSkillSlug(s.ID)
	}
	if len(s.Slug) > SkillMaxSlugLen || !skillSlugPattern.MatchString(s.Slug) {
		return fmt.Errorf("slug: 调用名只能用小写字母、数字和连字符，以字母开头，不超过 %d 个字符", SkillMaxSlugLen)
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
	tags := make([]string, 0, len(s.Tags))
	seenTag := make(map[string]bool, len(s.Tags))
	for _, raw := range s.Tags {
		tag := sanitizeSkillText(raw, true)
		if tag == "" || seenTag[tag] {
			continue
		}
		if len([]rune(tag)) > SkillMaxTagLen {
			return fmt.Errorf("tags: 单个标签不能超过 %d 字", SkillMaxTagLen)
		}
		seenTag[tag] = true
		tags = append(tags, tag)
		if len(tags) >= SkillMaxTags {
			break
		}
	}
	s.Tags = tags
	if s.Category != nil {
		category := sanitizeSkillText(*s.Category, true)
		if category == "" {
			s.Category = nil
		} else {
			s.Category = &category
		}
	}
	return nil
}

// slugConflict 把调用名唯一索引冲突翻译成可读错误，其余错误原样返回。
func slugConflict(err error) error {
	if IsUniqueViolation(err, "ux_image_skills_official_slug") || IsUniqueViolation(err, "ux_image_skills_owner_slug") {
		return ErrSkillSlugTaken
	}
	return err
}

func InsertSkill(ctx context.Context, q Q, s *ImageSkill) (*ImageSkill, error) {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if err := NormalizeSkill(s); err != nil {
		return nil, err
	}
	created, err := scanImageSkill(q.QueryRow(ctx,
		`INSERT INTO image_skills (id, owner_user_id, slug, name, description, instruction, task_types,
			category, tags, cover_key, sort, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+imageSkillCols,
		s.ID, s.OwnerUserID, s.Slug, s.Name, s.Description, s.Instruction, s.TaskTypes,
		s.Category, s.Tags, s.CoverKey, s.Sort, s.Active))
	if err != nil {
		return nil, slugConflict(err)
	}
	return created, nil
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
		args = append(args, "%"+strings.TrimPrefix(search, "$")+"%")
		sql += fmt.Sprintf(` AND (name ILIKE $%d OR description ILIKE $%d OR slug ILIKE $%d)`, len(args), len(args), len(args))
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
		`UPDATE image_skills SET slug=$2, name=$3, description=$4, instruction=$5, task_types=$6,
			category=$7, tags=$8, cover_key=$9, sort=$10, active=$11, updated_at=now()
		 WHERE id=$1 RETURNING `+imageSkillCols,
		s.ID, s.Slug, s.Name, s.Description, s.Instruction, s.TaskTypes,
		s.Category, s.Tags, s.CoverKey, s.Sort, s.Active))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSkillNotFound
	}
	if err != nil {
		return nil, slugConflict(err)
	}
	return updated, nil
}

// DeleteSkill 按 owner 作用域删除；ownerUserID 为 nil 时只删官方 skill。
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

// CountSkillsOwnedBy 统计用户存在云端的 skill 数，用于 SkillMaxOwnedPerUser 配额。
func CountSkillsOwnedBy(ctx context.Context, q Q, userID uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM image_skills WHERE owner_user_id=$1`, userID).Scan(&n)
	return n, err
}
