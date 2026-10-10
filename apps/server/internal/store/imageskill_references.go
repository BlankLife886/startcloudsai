package store

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// 官方技能参考资料的上限：单份 64 KB，每个技能最多 20 份、合计 512 KB。
const (
	SkillReferenceMaxBytes      = 64 << 10
	SkillReferenceMaxFiles      = 20
	SkillReferenceMaxTotalBytes = 512 << 10
	SkillReferenceMaxPurposeLen = 200
	SkillReferenceMaxTitleLen   = 120
)

// skillReferencePathPattern 与迁移里的 CHECK 一致：只允许 references/、assets/ 下的 .md / .txt，
// 不允许子目录和 ..，路径本身就是 SKILL.md 包里的相对路径。
var skillReferencePathPattern = regexp.MustCompile(`^(references|assets)/[A-Za-z0-9][A-Za-z0-9._-]*\.(md|txt)$`)

// SkillReference 是官方技能的一份参考资料。
type SkillReference struct {
	SkillID   uuid.UUID
	Path      string
	Title     string
	Purpose   string
	Content   string
	Sort      int
	UpdatedAt time.Time
}

func ValidSkillReferencePath(path string) bool {
	return len(path) <= 120 && !strings.Contains(path, "..") && skillReferencePathPattern.MatchString(path)
}

// NormalizeSkillReferences 清洗并校验一组参考资料（整体替换前调用）。
func NormalizeSkillReferences(refs []SkillReference) ([]SkillReference, error) {
	if len(refs) > SkillReferenceMaxFiles {
		return nil, fmt.Errorf("references: 最多 %d 份参考资料", SkillReferenceMaxFiles)
	}
	out := make([]SkillReference, 0, len(refs))
	seen := map[string]bool{}
	total := 0
	for index, ref := range refs {
		ref.Path = strings.TrimSpace(ref.Path)
		if !ValidSkillReferencePath(ref.Path) {
			return nil, fmt.Errorf("references: 路径 %q 不合法，只能是 references/ 或 assets/ 下的 .md / .txt 文件", ref.Path)
		}
		if seen[ref.Path] {
			return nil, fmt.Errorf("references: %s 重复", ref.Path)
		}
		seen[ref.Path] = true
		ref.Content = sanitizeSkillText(ref.Content, false)
		if ref.Content == "" {
			return nil, fmt.Errorf("references: %s 内容为空", ref.Path)
		}
		if len(ref.Content) > SkillReferenceMaxBytes {
			return nil, fmt.Errorf("references: %s 超过 %d KB", ref.Path, SkillReferenceMaxBytes>>10)
		}
		total += len(ref.Content)
		ref.Title = sanitizeSkillText(ref.Title, true)
		ref.Purpose = sanitizeSkillText(ref.Purpose, true)
		if len([]rune(ref.Title)) > SkillReferenceMaxTitleLen {
			ref.Title = string([]rune(ref.Title)[:SkillReferenceMaxTitleLen])
		}
		if len([]rune(ref.Purpose)) > SkillReferenceMaxPurposeLen {
			return nil, fmt.Errorf("references: %s 的用途说明不能超过 %d 字", ref.Path, SkillReferenceMaxPurposeLen)
		}
		ref.Sort = index
		out = append(out, ref)
	}
	if total > SkillReferenceMaxTotalBytes {
		return nil, fmt.Errorf("references: 合计不能超过 %d KB", SkillReferenceMaxTotalBytes>>10)
	}
	return out, nil
}

const skillReferenceCols = `skill_id, path, title, purpose, content, sort, updated_at`

// ListSkillReferences 按展示顺序列出一个技能的参考资料；withContent 为 false 时不读正文。
func ListSkillReferences(ctx context.Context, q Q, skillID uuid.UUID, withContent bool) ([]SkillReference, error) {
	cols := skillReferenceCols
	if !withContent {
		cols = `skill_id, path, title, purpose, '' AS content, sort, updated_at`
	}
	rows, err := q.Query(ctx, `SELECT `+cols+` FROM image_skill_references WHERE skill_id=$1 ORDER BY sort, path`, skillID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SkillReference{}
	for rows.Next() {
		var ref SkillReference
		if err := rows.Scan(&ref.SkillID, &ref.Path, &ref.Title, &ref.Purpose, &ref.Content, &ref.Sort, &ref.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// GetSkillReference 读取一份参考资料；不存在时返回 nil。
func GetSkillReference(ctx context.Context, q Q, skillID uuid.UUID, path string) (*SkillReference, error) {
	var ref SkillReference
	err := q.QueryRow(ctx, `SELECT `+skillReferenceCols+` FROM image_skill_references WHERE skill_id=$1 AND path=$2`, skillID, path).
		Scan(&ref.SkillID, &ref.Path, &ref.Title, &ref.Purpose, &ref.Content, &ref.Sort, &ref.UpdatedAt)
	return nilOnNoRows(&ref, err)
}

// ReplaceSkillReferences 用 refs 整体替换技能的参考资料（调用方负责事务）。
func ReplaceSkillReferences(ctx context.Context, q Q, skillID uuid.UUID, refs []SkillReference) ([]SkillReference, error) {
	normalized, err := NormalizeSkillReferences(refs)
	if err != nil {
		return nil, err
	}
	if _, err := q.Exec(ctx, `DELETE FROM image_skill_references WHERE skill_id=$1`, skillID); err != nil {
		return nil, err
	}
	for _, ref := range normalized {
		if _, err := q.Exec(ctx,
			`INSERT INTO image_skill_references (skill_id, path, title, purpose, content, sort) VALUES ($1,$2,$3,$4,$5,$6)`,
			skillID, ref.Path, ref.Title, ref.Purpose, ref.Content, ref.Sort); err != nil {
			return nil, err
		}
	}
	return ListSkillReferences(ctx, q, skillID, false)
}

// CountSkillReferences 返回每个技能的参考资料份数，后台列表用。
func CountSkillReferences(ctx context.Context, q Q) (map[uuid.UUID]int, error) {
	rows, err := q.Query(ctx, `SELECT skill_id, count(*) FROM image_skill_references GROUP BY skill_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]int{}
	for rows.Next() {
		var id uuid.UUID
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}
