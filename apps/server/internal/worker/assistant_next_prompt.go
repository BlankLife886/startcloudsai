package worker

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// The next-step suggestion: the model ends its answer with one line
// <next>…</next> holding what the user is most likely to say next. The line
// never reaches the visible answer; the composer offers it as a ghost
// suggestion the user can accept with Tab.

const assistantNextPromptInstruction = `

下一步建议：回答写完后，另起一行输出 <next>用户最可能接着发给你的一句话</next>。
- 用用户的口吻写，能直接发送，例如“帮我按第 1 个方向出图”“再做一版 9:16 的”“把这张存进资产库”，不超过 30 个字。
- 只写最自然、最有用的一个；回答已经完整、没有明显下一步时不要输出这一行。
- 这一行不会显示给用户，正文里不要提到它，也不要写“你可以说……”之类的引导。`

const assistantNextPromptMaxRunes = 60

var assistantNextPromptPattern = regexp.MustCompile(`(?s)\s*<next>(.*?)</next>\s*$`)

// splitAssistantNextPrompt removes a trailing <next>…</next> line from the
// answer and returns the visible text and the suggestion.
func splitAssistantNextPrompt(text string) (string, string) {
	match := assistantNextPromptPattern.FindStringSubmatchIndex(text)
	if match == nil {
		return assistantHideNextPromptTail(text), ""
	}
	next := strings.Join(strings.Fields(text[match[2]:match[3]]), " ")
	next = strings.Trim(next, "“”\"'「」")
	if utf8.RuneCountInString(next) > assistantNextPromptMaxRunes {
		next = ""
	}
	return strings.TrimRight(text[:match[0]], " \t\r\n"), next
}

// assistantHideNextPromptTail hides the suggestion while it is still being
// streamed: an unclosed "<next>…" at the end, or a bare "<", "<n"… that may
// grow into one. A closed tag in the middle of the answer is left alone.
func assistantHideNextPromptTail(text string) string {
	if index := strings.LastIndex(text, "<next>"); index >= 0 && !strings.Contains(text[index:], "</next>") {
		return strings.TrimRight(text[:index], " \t\r\n")
	}
	const tag = "<next>"
	for size := len(tag) - 1; size > 0; size-- {
		if strings.HasSuffix(text, tag[:size]) {
			return strings.TrimRight(text[:len(text)-size], " \t\r\n")
		}
	}
	return text
}
