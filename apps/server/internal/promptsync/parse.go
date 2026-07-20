// 解析器：从远程 JSON / Markdown / HTML 文本解析提示词列表。
// 逐函数移植旧版 walleven prompt-library-sources.ts 的 parseJsonPrompts /
// parseMarkdownPrompts / parseHtmlPrompts，行为（含 UTF-16 截断、JS 字符串
// 语义、itemKey 哈希）与旧版严格一致，保证 source_item_key 可与旧库对账。
package promptsync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// ParsedPrompt 单条解析结果（对齐旧版 ParsedPrompt）。
type ParsedPrompt struct {
	Key      string
	Label    string
	Prompt   string
	ImageURL string
	Tags     []string
}

// jsWS 等价 JS 正则 \s 的字符集合（含 NBSP、全角空格、BOM 等）。
const jsWS = `\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var (
	h3HeadingRe    = regexp.MustCompile(`(?m)^###[` + jsWS + `]+(.+)$`)
	h2HeadingRe    = regexp.MustCompile(`(?m)^##[` + jsWS + `]+(.+)$`)
	promptPrefixRe = regexp.MustCompile(`(?i)(?:\*\*(?:提示词|Prompt)[` + jsWS + `]*:?\*\*|####[` + jsWS + `]*(?:📝[` + jsWS + `]*)?(?:提示词|Prompt))[` + jsWS + `]*\n`)
	promptTermRe   = regexp.MustCompile(`(?i)\n(?:####|##[` + jsWS + `]|\*\*(?:来源|Source|生成图片))`)
	imgTagSrcRe    = regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+)`)
	mdImageRe      = regexp.MustCompile(`!\[[^\]]*\]\(([^)` + jsWS + `]+)`)

	fenceRe      = regexp.MustCompile("(?m)^```[^\n]*\n?|```$")
	multiNlRe    = regexp.MustCompile(`\n{3,}`)
	headingNoRe  = regexp.MustCompile(`(?i)^No\.[` + jsWS + `]*\d+[` + jsWS + `]*:[` + jsWS + `]*`)
	headingSymRe = regexp.MustCompile("[*_`#]")

	articleRe = regexp.MustCompile(`(?is)<article\b.*?</article>`)
	h23Re     = regexp.MustCompile(`(?is)<h[23][^>]*>(.*?)</h[23]>`)
	pPromptRe = regexp.MustCompile(`(?is)<p[^>]*(?:whitespace-pre-wrap|word-break)[^>]*>(.*?)</p>`)

	brRe   = regexp.MustCompile(`(?i)<br[` + jsWS + `]*/?[` + jsWS + `]*>`)
	tagRe  = regexp.MustCompile(`<[^>]+>`)
	wsNlRe = regexp.MustCompile(`[` + jsWS + `]+\n`)

	nbspRe = regexp.MustCompile(`(?i)&nbsp;`)
	ampRe  = regexp.MustCompile(`(?i)&amp;`)
	ltRe   = regexp.MustCompile(`(?i)&lt;`)
	gtRe   = regexp.MustCompile(`(?i)&gt;`)
	quotRe = regexp.MustCompile(`(?i)&quot;`)
	aposRe = regexp.MustCompile(`(?i)&#39;`)

	idCharsRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)
)

// Parse 按 format 分发解析（json 解析失败返回错误，与旧版 JSON.parse 抛错一致）。
func Parse(text, format, sourceURL string) ([]ParsedPrompt, error) {
	switch format {
	case "json":
		return parseJSONPrompts(text, sourceURL)
	case "html":
		return parseHTMLPrompts(text, sourceURL), nil
	default:
		return parseMarkdownPrompts(text, sourceURL), nil
	}
}

func parseJSONPrompts(text, sourceURL string) ([]ParsedPrompt, error) {
	var payload any
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}
	var list []any
	switch t := payload.(type) {
	case []any:
		list = t
	case map[string]any:
		if arr, ok := t["prompts"].([]any); ok {
			list = arr
		} else if arr, ok := t["items"].([]any); ok {
			list = arr
		}
	}
	items := make([]ParsedPrompt, 0, len(list))
	for index, rawAny := range list {
		raw, _ := rawAny.(map[string]any)
		label := firstText(raw["title_cn"], raw["title"], raw["label"], raw["name"], fmt.Sprintf("提示词 %d", index+1))
		prompt := firstText(raw["prompt"], raw["prompt_text"], raw["content"], raw["description"])
		image := firstText(raw["preview"], raw["image"], raw["image_url"], raw["thumbnail"], raw["cover"])
		tagValues := []any{raw["category_cn"], raw["category"], raw["sub_category"]}
		if arr, ok := raw["tags"].([]any); ok {
			tagValues = append(tagValues, arr...)
		}
		if utf16Len(prompt) < 8 {
			continue
		}
		items = append(items, ParsedPrompt{
			Key:      firstText(raw["id"], raw["slug"], raw["key"]),
			Label:    label,
			Prompt:   prompt,
			ImageURL: resolveLinkedURL(image, sourceURL),
			Tags:     normalizeList(tagValues, 12, 32),
		})
	}
	return items, nil
}

func parseMarkdownPrompts(text, sourceURL string) []ParsedPrompt {
	headings := h3HeadingRe.FindAllStringSubmatchIndex(text, -1)
	items := []ParsedPrompt{}
	for i, m := range headings {
		start := m[1]
		end := len(text)
		if i+1 < len(headings) {
			end = headings[i+1][0]
		}
		block := text[start:end]
		prompt := cleanMarkdown(extractMarkdownPrompt(block))
		if utf16Len(prompt) < 8 {
			continue
		}
		image := firstText(firstSubmatch(imgTagSrcRe, block), firstSubmatch(mdImageRe, block))
		before := text[:m[0]]
		category := ""
		if h2s := h2HeadingRe.FindAllStringSubmatch(before, -1); len(h2s) > 0 {
			category = h2s[len(h2s)-1][1]
		}
		tags := []string{}
		if category != "" {
			tags = []string{cleanHeading(category)}
		}
		items = append(items, ParsedPrompt{
			Label:    cleanHeading(text[m[2]:m[3]]),
			Prompt:   prompt,
			ImageURL: resolveLinkedURL(image, sourceURL),
			Tags:     tags,
		})
	}
	return items
}

// extractMarkdownPrompt 等价旧版 promptMatch 正则：
// 前缀（**提示词** / #### 📝 Prompt 等）之后、终止符（#### / ## / **来源|Source|生成图片**
// 或文本末尾换行）之前的懒惰匹配段。RE2 不支持 lookahead，手工模拟。
func extractMarkdownPrompt(block string) string {
	// 逐个前缀位置尝试（等价 JS 回溯：某前缀之后无终止符则整体在该位置失配，
	// 引擎继续尝试后续位置）。
	for _, loc := range promptPrefixRe.FindAllStringIndex(block, -1) {
		rest := block[loc[1]:]
		if t := promptTermRe.FindStringIndex(rest); t != nil {
			return rest[:t[0]]
		}
		// 旧版 lookahead 的 `\n$` 分支（$ 无 m 标志 = 字符串末尾）
		if strings.HasSuffix(rest, "\n") {
			return rest[:len(rest)-1]
		}
	}
	return ""
}

func parseHTMLPrompts(text, sourceURL string) []ParsedPrompt {
	items := []ParsedPrompt{}
	for _, block := range articleRe.FindAllString(text, -1) {
		label := decodeHTML(stripHTML(firstSubmatch(h23Re, block)))
		prompt := ""
		if cands := pPromptRe.FindAllStringSubmatch(block, -1); len(cands) > 0 {
			prompt = decodeHTML(stripHTML(cands[len(cands)-1][1]))
		}
		if utf16Len(prompt) < 8 {
			continue
		}
		if label == "" {
			label = "未命名提示词"
		}
		items = append(items, ParsedPrompt{
			Label:    label,
			Prompt:   prompt,
			ImageURL: resolveLinkedURL(firstSubmatch(imgTagSrcRe, block), sourceURL),
			Tags:     []string{},
		})
	}
	return items
}

// StableItemKey 与旧版 stableItemKey 一致：有 key 用 normalizeId(key)（空则退回
// 序号），否则对 "label\nprompt" 做 SHA-256 hex。
func StableItemKey(item ParsedPrompt, index int) string {
	if item.Key != "" {
		if id := normalizeID(item.Key); id != "" {
			return id
		}
		return strconv.Itoa(index)
	}
	return sha256Hex(item.Label + "\n" + item.Prompt)
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// ---------- 旧版工具函数的 Go 等价实现 ----------

func cleanMarkdown(value string) string {
	value = fenceRe.ReplaceAllString(value, "")
	value = multiNlRe.ReplaceAllString(value, "\n\n")
	return sliceUTF16(decodeHTML(jsTrim(value)), 8000)
}

func cleanHeading(value string) string {
	value = headingNoRe.ReplaceAllString(value, "")
	value = headingSymRe.ReplaceAllString(value, "")
	return sliceUTF16(decodeHTML(jsTrim(value)), 120)
}

func stripHTML(value string) string {
	value = brRe.ReplaceAllString(value, "\n")
	value = tagRe.ReplaceAllString(value, "")
	value = wsNlRe.ReplaceAllString(value, "\n")
	return jsTrim(value)
}

func decodeHTML(value string) string {
	value = nbspRe.ReplaceAllString(value, " ")
	value = ampRe.ReplaceAllString(value, "&")
	value = ltRe.ReplaceAllString(value, "<")
	value = gtRe.ReplaceAllString(value, ">")
	value = quotRe.ReplaceAllString(value, `"`)
	value = aposRe.ReplaceAllString(value, "'")
	return jsTrim(value)
}

// resolveLinkedURL 等价 new URL(url, sourceUrl).toString()，失败返回空串。
func resolveLinkedURL(value any, sourceURL string) string {
	raw := jsTrim(jsString(value))
	if raw == "" {
		return ""
	}
	base, err := url.Parse(sourceURL)
	if err != nil {
		return ""
	}
	ref, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(ref)
	if resolved.Scheme == "" {
		return ""
	}
	return resolved.String()
}

// firstText 等价旧版 firstText：String(value ?? '') 后 trim，取首个非空且
// 非 "[object Object]" 的值。
func firstText(values ...any) string {
	for _, v := range values {
		text := jsTrim(jsString(v))
		if text != "" && text != "[object Object]" {
			return text
		}
	}
	return ""
}

// normalizeList 等价旧版 normalizeList：normalizeText → 去空 → 去重（保序）→ 截断。
func normalizeList(values []any, limit, itemLimit int) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		t := normalizeText(v, itemLimit)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// NormalizeText 等价旧版 normalizeText：String(value||'').trim().slice(0, limit)。
func NormalizeText(value string, limit int) string {
	return normalizeText(value, limit)
}

func normalizeText(value any, limit int) string {
	return sliceUTF16(jsTrim(jsStringFalsy(value)), limit)
}

func normalizeID(value any) string {
	s := jsTrim(jsStringFalsy(value))
	return sliceUTF16(idCharsRe.ReplaceAllString(s, ""), 80)
}

// jsString 等价 JS String(v)。
func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		return jsNumberString(t)
	case json.Number:
		return t.String()
	case []any:
		parts := make([]string, len(t))
		for i, e := range t {
			if e == nil {
				parts[i] = ""
			} else {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	case map[string]any:
		return "[object Object]"
	default:
		return fmt.Sprintf("%v", v)
	}
}

// jsStringFalsy 等价 String(v || '')：JS falsy（nil/false/0/NaN/""）→ 空串。
func jsStringFalsy(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case bool:
		if !t {
			return ""
		}
	case float64:
		if t == 0 || math.IsNaN(t) {
			return ""
		}
	case string:
		if t == "" {
			return ""
		}
	}
	return jsString(v)
}

func jsNumberString(f float64) string {
	if math.IsNaN(f) {
		return "NaN"
	}
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	if math.IsInf(f, -1) {
		return "-Infinity"
	}
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

// jsTrim 等价 JS String#trim（\s 集合 + BOM）。
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || r == '\ufeff'
	})
}

// utf16Len JS String#length 语义（UTF-16 编码单元数）。
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// sliceUTF16 JS String#slice(0, limit) 语义；截断落在代理对中间时，
// JS 会留下孤立高代理，编码为 UTF-8 时变成 U+FFFD，此处保持一致。
func sliceUTF16(s string, limit int) string {
	units := 0
	for i, r := range s {
		w := 1
		if r > 0xFFFF {
			w = 2
		}
		if units+w > limit {
			if w == 2 && units < limit {
				return s[:i] + "\uFFFD"
			}
			return s[:i]
		}
		units += w
	}
	return s
}

func firstSubmatch(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}
