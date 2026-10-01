package apicatalog

import (
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ValidateNames checks an entry's public name and aliases: non-empty, at most
// 128 characters, and unique across every other entry's name and aliases
// under /v1 name comparison.
func ValidateNames(entries []*store.DeveloperAPIModel, self *store.DeveloperAPIModel, now time.Time) error {
	names := append([]string{self.APIName}, self.Aliases...)
	seen := map[string]bool{}
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" || len(trimmed) > 128 || strings.ContainsAny(trimmed, " \t\n/") {
			return fmt.Errorf("模型名称须为 1-128 个字符，且不能包含空格或斜杠：%q", name)
		}
		normalized := NormalizeName(trimmed)
		if seen[normalized] {
			return fmt.Errorf("名称与别名重复：%s", trimmed)
		}
		seen[normalized] = true
	}
	for _, other := range entries {
		if other.ID == self.ID {
			continue
		}
		reserved := append([]string{other.APIName}, other.Aliases...)
		if other.StatusAt(now) == store.DeveloperAPIModelRetired {
			// A retired entry keeps its name (the unique index and 410 replies
			// need it) but releases its aliases, and its name may become an
			// alias of the replacement.
			if NormalizeName(self.APIName) == NormalizeName(other.APIName) {
				return fmt.Errorf("名称「%s」属于已下线的 API 模型，只能作为别名使用", other.APIName)
			}
			continue
		}
		for _, name := range reserved {
			if seen[NormalizeName(name)] {
				return fmt.Errorf("名称「%s」已被 API 模型「%s」使用", name, other.APIName)
			}
		}
	}
	return nil
}

// Narrowing lists the capabilities a new target model lacks compared with
// the current one, so a retarget cannot silently break existing calls.
func Narrowing(current, next modelconfig.Model) []string {
	lost := []string{}
	missing := func(label string, before, after []string) {
		absent := []string{}
		for _, value := range before {
			if !store.Contains(after, value) {
				absent = append(absent, value)
			}
		}
		if len(absent) > 0 && len(after) > 0 {
			lost = append(lost, fmt.Sprintf("%s不再支持 %s", label, strings.Join(absent, "、")))
		}
	}
	lower := func(label string, before, after int) {
		if after < before {
			lost = append(lost, fmt.Sprintf("%s从 %d 降为 %d", label, before, after))
		}
	}
	if current.Kind == modelconfig.ModelKindImage {
		missing("分辨率", current.Resolutions, next.Resolutions)
		missing("质量", current.Qualities, next.Qualities)
		missing("输出格式", current.OutputFormats, next.OutputFormats)
		lower("参考图上限", current.MaxReferenceImages, next.MaxReferenceImages)
		lower("单次张数", current.GenerationMaxImages(), next.GenerationMaxImages())
		if current.TransparentBackground && !next.TransparentBackground {
			lost = append(lost, "不再支持透明背景")
		}
		if current.SupportsExactSize && !next.SupportsExactSize {
			lost = append(lost, "不再支持精确尺寸")
		}
	} else {
		if current.ContextWindowTokens > 0 {
			lower("上下文长度", current.ContextWindowTokens, next.ContextWindowTokens)
		}
		if current.MaxOutputTokens > 0 {
			lower("最大输出长度", current.MaxOutputTokens, next.MaxOutputTokens)
		}
		missing("推理档位", current.SupportedReasoningEfforts, next.SupportedReasoningEfforts)
	}
	return lost
}
