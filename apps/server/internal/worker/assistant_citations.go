package worker

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// Citations: the answer marks facts from web search with [n], and the page
// turns [n] into a superscript that links to source n of the "来源" row under
// the answer. Both sides must number sources the same way: unique http(s) URLs
// across every search of the turn, in order, the first 12 only (see
// assistantWebSources in AssistantMessageComponents.jsx).

const assistantMaxCitedSources = 12

type assistantCitation struct {
	Number int
	Title  string
	URL    string
}

func assistantCitationIndex(searches []sub2api.WebSearchResult) []assistantCitation {
	seen := map[string]bool{}
	var out []assistantCitation
	for _, search := range searches {
		for _, source := range search.Sources {
			raw := strings.TrimSpace(source.URL)
			if raw == "" || seen[raw] {
				continue
			}
			parsed, err := url.Parse(raw)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				continue
			}
			seen[raw] = true
			title := strings.TrimSpace(source.Title)
			if title == "" {
				title = parsed.Hostname()
			}
			out = append(out, assistantCitation{Number: len(out) + 1, Title: title, URL: raw})
			if len(out) >= assistantMaxCitedSources {
				return out
			}
		}
	}
	return out
}

// assistantCitationNote tells the model which numbers the latest search's
// sources have. searches already includes latest.
func assistantCitationNote(searches []sub2api.WebSearchResult, latest sub2api.WebSearchResult) string {
	index := assistantCitationIndex(searches)
	numbers := map[string]assistantCitation{}
	for _, item := range index {
		numbers[item.URL] = item
	}
	var builder strings.Builder
	listed := map[int]bool{}
	for _, source := range latest.Sources {
		item, ok := numbers[strings.TrimSpace(source.URL)]
		if !ok || listed[item.Number] {
			continue
		}
		listed[item.Number] = true
		fmt.Fprintf(&builder, "\n[%d] %s — %s", item.Number, truncateAssistantRunes(item.Title, 80), item.URL)
	}
	if builder.Len() == 0 {
		return ""
	}
	return "\n\n来源编号（正文引用用）：" + builder.String() +
		"\n引用规则：正文里用到某个来源的信息时，在那句话末尾标上它的编号，例如“……销量约 120 万台[2]。”；同时出自多个来源写成 [1][3]。只用上面列出的编号，不要编造编号，也不要在正文里再贴一遍链接列表。"
}
