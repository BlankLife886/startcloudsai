// Package skillmention 在服务端展开提示词里的 `@官方技能`。
//
// 官方技能的正文不下发给用户端：前端只把 `@材质插画` 这样的提及留在提示词里，
// 由服务端在请求模型前把正文拼进去。数据库里的任务提示词、对话消息因此只保存
// 用户自己写的文字，返回给用户的数据里也看不到官方技能正文。
//
// 识别规则与 apps/web-react/src/features/skills/skillComposition.js 的
// findSkillMentions / composeSkillPrompt 保持一致。
package skillmention

import (
	"context"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	// MaxMentions 与前端 SKILL_MAX_MENTIONS_PER_PROMPT 一致。
	MaxMentions = 8
	// MaxPromptRunes 与前端 SKILL_PROMPT_MAX_LENGTH 一致：拼接后提示词的上限。
	MaxPromptRunes = 6000
)

// Mention 是文本里命中的一个技能。
type Mention struct {
	Skill store.ImageSkill
	Token string
	index int
}

// Tokens 返回技能可被提及的写法：名称不含空白、@、/ 时可直接 `@名称`，
// 调用名始终可用 `@slug`。
func Tokens(skill store.ImageSkill) []string {
	out := make([]string, 0, 2)
	name := strings.TrimSpace(skill.Name)
	if name != "" && !strings.ContainsAny(name, " \t\n@/") {
		out = append(out, "@"+name)
	}
	if slug := strings.TrimSpace(skill.Slug); slug != "" && (len(out) == 0 || out[0] != "@"+slug) {
		out = append(out, "@"+slug)
	}
	return out
}

func asciiWord(r rune) bool {
	return r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// boundaryOK 判断 source[start:end] 处的 token 是否是一个独立提及：
// 前面不能紧贴 ASCII 字母数字、下划线或 @（避免把邮箱 a@b 切出来），
// 后面不能紧跟 ASCII 字母数字、下划线或连字符。
func boundaryOK(source string, start, end int) bool {
	if start > 0 {
		prev, _ := utf8.DecodeLastRuneInString(source[:start])
		if asciiWord(prev) || prev == '@' {
			return false
		}
	}
	if end < len(source) {
		next, _ := utf8.DecodeRuneInString(source[end:])
		if asciiWord(next) || next == '-' {
			return false
		}
	}
	return true
}

// Find 找出文本里提及的技能。按 token 长度从长到短匹配，已命中的区间会被遮住，
// 短 token 不会在长 token 内部再次命中；结果按首次出现位置排序、去重、限量。
func Find(text string, skills []store.ImageSkill) []Mention {
	if !strings.Contains(text, "@") || len(skills) == 0 {
		return nil
	}
	type candidate struct {
		skill store.ImageSkill
		token string
	}
	candidates := make([]candidate, 0, len(skills)*2)
	for _, skill := range skills {
		for _, token := range Tokens(skill) {
			if len(token) > 1 {
				candidates = append(candidates, candidate{skill: skill, token: token})
			}
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return utf8.RuneCountInString(candidates[i].token) > utf8.RuneCountInString(candidates[j].token)
	})
	masked := text
	hits := make([]Mention, 0)
	for _, item := range candidates {
		offset := 0
		for {
			index := strings.Index(masked[offset:], item.token)
			if index < 0 {
				break
			}
			start := offset + index
			end := start + len(item.token)
			if boundaryOK(masked, start, end) {
				hits = append(hits, Mention{Skill: item.skill, Token: item.token, index: start})
				masked = masked[:start] + strings.Repeat("\x00", len(item.token)) + masked[end:]
			}
			offset = end
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].index < hits[j].index })
	seen := map[string]bool{}
	out := make([]Mention, 0, len(hits))
	for _, hit := range hits {
		key := hit.Skill.ID.String()
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, hit)
		if len(out) >= MaxMentions {
			break
		}
	}
	return out
}

// Strip 从文本里摘掉提及，并收敛多余空白（与前端 stripSkillMentions 一致）。
func Strip(text string, mentions []Mention) string {
	tokens := make([]string, 0, len(mentions))
	for _, mention := range mentions {
		tokens = append(tokens, mention.Token)
	}
	sort.SliceStable(tokens, func(i, j int) bool { return len(tokens[i]) > len(tokens[j]) })
	result := text
	for _, token := range tokens {
		var b strings.Builder
		offset := 0
		for {
			index := strings.Index(result[offset:], token)
			if index < 0 {
				b.WriteString(result[offset:])
				break
			}
			start := offset + index
			end := start + len(token)
			b.WriteString(result[offset:start])
			if !boundaryOK(result, start, end) {
				b.WriteString(token)
			}
			offset = end
		}
		result = b.String()
	}
	lines := strings.Split(result, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(strings.Join(strings.FieldsFunc(line, func(r rune) bool { return r == ' ' || r == '\t' }), " "))
	}
	joined := strings.Join(lines, "\n")
	for strings.Contains(joined, "\n\n\n") {
		joined = strings.ReplaceAll(joined, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(joined)
}

// Compose 把技能正文拼在用户提示词前面；相同正文只拼一次；超长时优先保住用户
// 输入，从后往前丢技能（与前端 composeSkillPrompt 一致）。
func Compose(prompt string, skills []store.ImageSkill) string {
	base := strings.TrimSpace(prompt)
	seen := map[string]bool{}
	parts := make([]string, 0, len(skills))
	for _, skill := range skills {
		instruction := strings.TrimSpace(skill.Instruction)
		if instruction == "" || seen[instruction] {
			continue
		}
		seen[instruction] = true
		parts = append(parts, instruction)
	}
	join := func(kept []string) string {
		if base == "" {
			return strings.Join(kept, "\n\n")
		}
		return strings.Join(append(append([]string(nil), kept...), base), "\n\n")
	}
	for kept := len(parts); kept > 0; kept-- {
		if candidate := join(parts[:kept]); utf8.RuneCountInString(candidate) <= MaxPromptRunes {
			return candidate
		}
	}
	if utf8.RuneCountInString(base) > MaxPromptRunes {
		return string([]rune(base)[:MaxPromptRunes])
	}
	return base
}

// OfficialSkills 读取启用中的官方技能。
func OfficialSkills(ctx context.Context, q store.Q) ([]store.ImageSkill, error) {
	return store.ListSkills(ctx, q, store.SkillFilter{OfficialOnly: true, ActiveOnly: true})
}

// FindOfficial 找出文本里提及的官方技能；文本不含 @ 时不查库。
func FindOfficial(ctx context.Context, q store.Q, text string) ([]Mention, error) {
	if !strings.Contains(text, "@") {
		return nil, nil
	}
	skills, err := OfficialSkills(ctx, q)
	if err != nil {
		return nil, err
	}
	return Find(text, skills), nil
}

// ExpandOfficial 返回展开官方技能后的提示词；没有提及时原样返回。
func ExpandOfficial(ctx context.Context, q store.Q, text string) (string, []store.ImageSkill, error) {
	mentions, err := FindOfficial(ctx, q, text)
	if err != nil || len(mentions) == 0 {
		return text, nil, err
	}
	skills := make([]store.ImageSkill, 0, len(mentions))
	for _, mention := range mentions {
		skills = append(skills, mention.Skill)
	}
	return Compose(Strip(text, mentions), skills), skills, nil
}
