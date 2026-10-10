package worker

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Follow-up suggestions: the model ends its answer with one line
// <followups>…｜…｜…</followups> holding up to three things the user is most
// likely to say next. The line never reaches the visible answer. The first one
// is offered in the composer as a ghost suggestion the user can accept with
// Tab; all of them show as chips under the answer. Older answers used a single
// <next>…</next>, which is still understood.

const assistantFollowUpsInstruction = `

追问建议：回答写完后，另起一行输出 <followups>建议1｜建议2｜建议3</followups>，用全角竖线“｜”分隔。
- 写用户最可能接着发给你的话，用用户的口吻，能直接发送，每条不超过 20 个字；2～3 条，最自然、最有用的放第一条。
- 回答已经完整、没有明显的下一步时不要输出这一行。
- 这一行不会显示给用户，正文里不要提到它，也不要写“你可以问……”之类的引导。`

// 问答模式只回答问题，不做事：建议只能是追问，不能是“帮我出图”这类操作。
const assistantFollowUpsChatOnly = `
- 本轮是问答模式：每条都必须是用户可能想追问的问题（以问号结尾），不要写“帮我出图”“存进资产库”之类让你去做事的请求。`

const assistantFollowUpsAgent = `
- 可以是追问，也可以是下一步操作，例如“帮我按第 1 个方向出图”“再做一版 9:16 的”。`

func assistantFollowUpsInstructionFor(chatOnly bool) string {
	if chatOnly {
		return assistantFollowUpsInstruction + assistantFollowUpsChatOnly
	}
	return assistantFollowUpsInstruction + assistantFollowUpsAgent
}

const (
	assistantFollowUpMaxRunes = 40
	assistantFollowUpMaxItems = 3
)

var assistantFollowUpsPattern = regexp.MustCompile(`(?s)\s*<(followups|next)>(.*?)</(?:followups|next)>\s*$`)

var assistantFollowUpTags = []string{"<followups>", "<next>"}

// splitAssistantFollowUps removes a trailing <followups>…</followups> (or the
// older <next>…</next>) line from the answer and returns the visible text and
// the suggestions, best first.
func splitAssistantFollowUps(text string) (string, []string) {
	match := assistantFollowUpsPattern.FindStringSubmatchIndex(text)
	if match == nil {
		return assistantHideFollowUpsTail(text), nil
	}
	var items []string
	seen := map[string]bool{}
	for _, part := range strings.FieldsFunc(text[match[4]:match[5]], func(r rune) bool {
		return r == '｜' || r == '|' || r == '\n'
	}) {
		item := strings.Join(strings.Fields(part), " ")
		item = strings.Trim(item, "“”\"'「」 ")
		item = strings.TrimLeft(item, "0123456789.、）) ")
		if item == "" || seen[item] || utf8.RuneCountInString(item) > assistantFollowUpMaxRunes {
			continue
		}
		seen[item] = true
		items = append(items, item)
		if len(items) == assistantFollowUpMaxItems {
			break
		}
	}
	return strings.TrimRight(text[:match[0]], " \t\r\n"), items
}

// assistantHideFollowUpsTail hides the suggestions while they are still being
// streamed: an unclosed "<followups>…" at the end, or a bare "<", "<f"… that
// may grow into one. A closed tag in the middle of the answer is left alone.
func assistantHideFollowUpsTail(text string) string {
	for _, tag := range assistantFollowUpTags {
		closing := "</" + tag[1:]
		if index := strings.LastIndex(text, tag); index >= 0 && !strings.Contains(text[index:], closing) {
			return strings.TrimRight(text[:index], " \t\r\n")
		}
	}
	for _, tag := range assistantFollowUpTags {
		for size := len(tag) - 1; size > 0; size-- {
			if strings.HasSuffix(text, tag[:size]) {
				return strings.TrimRight(text[:len(text)-size], " \t\r\n")
			}
		}
	}
	return text
}
