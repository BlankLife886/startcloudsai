package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const (
	changelogDraftTimeout   = 90 * time.Second
	changelogDraftMaxNotes  = 8000
	changelogDraftMaxItems  = 12
	changelogDraftStyleRefs = 4
)

// changelogListMarker 去掉条目开头的列表符号或序号（“- ”“1. ”“2、”），不动正文里的数字。
var changelogListMarker = regexp.MustCompile(`^\s*(?:[-•·*]+|\d{1,2}[.、)）])\s*`)

type changelogDraftIn struct {
	// Notes 管理员随手写的改动要点、提交记录或需求清单。
	Notes string `json:"notes"`
	// Tag 留空让 AI 判断；feature / experience 时按指定类型写。
	Tag string `json:"tag"`
	// Current 表单里已有的内容；Notes 为空时按它润色。
	Current *changelogDraftOut `json:"current"`
}

type changelogDraftOut struct {
	Tag     string   `json:"tag"`
	Title   string   `json:"title"`
	Summary string   `json:"summary"`
	Items   []string `json:"items"`
}

// adminDraftChangelog 用后台分析模型把改动要点整理成面向用户的更新说明草稿，不直接发布。
func (s *Server) adminDraftChangelog(c *gin.Context, _ *store.User) {
	var body changelogDraftIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	notes := strings.TrimSpace(body.Notes)
	current := normalizeChangelogDraft(body.Current)
	if notes == "" && current.Title == "" && current.Summary == "" && len(current.Items) == 0 {
		fail(c, apperr.E("validation_error", "先写下这次改了什么，或在表单里填一些内容再润色", 422))
		return
	}
	if len([]rune(notes)) > changelogDraftMaxNotes {
		fail(c, apperr.E("validation_error", fmt.Sprintf("改动要点最多 %d 字", changelogDraftMaxNotes), 422))
		return
	}
	tag := strings.TrimSpace(body.Tag)
	if tag != "" && tag != "feature" && tag != "experience" {
		fail(c, apperr.E("validation_error", "tag: 仅支持 feature / experience", 422))
		return
	}

	ctx := c.Request.Context()
	recent, err := store.ListChangelog(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	client, err := s.adminImageAnalysisClient(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	if !ecommerceBriefSemaphore.TryAcquire(1) {
		fail(c, apperr.E("busy", "当前 AI 请求过多，请稍后再试", 429))
		return
	}
	defer ecommerceBriefSemaphore.Release(1)
	llmCtx, cancel := context.WithTimeout(ctx, changelogDraftTimeout)
	defer cancel()
	prompt := buildChangelogDraftPrompt(notes, tag, current, recent)
	reply, err := client.ChatTextWithImages(llmCtx, []sub2api.Message{{Role: "user", Content: prompt}}, nil, nil)
	if err != nil {
		fail(c, assistantUpstreamError(err))
		return
	}
	draft, err := decodeChangelogDraft(reply)
	if err != nil {
		fail(c, apperr.E("assistant_bad_response", "AI 没有返回有效的更新说明，请重试", 502))
		return
	}
	if tag != "" {
		draft.Tag = tag
	}
	ok(c, draft)
}

func buildChangelogDraftPrompt(notes, tag string, current changelogDraftOut, recent []*store.ChangelogEntry) string {
	var b strings.Builder
	b.WriteString(`你是 AI 图像创作平台「星空云绘」的产品更新说明撰写人。请把下面的材料整理成一条面向普通用户的更新说明。

写作要求：
1. 用简体中文，站在用户角度写“能感知到的变化”，不要出现代码、接口、字段、文件名、分支、提交号、内部模块名或技术术语。
2. 只写材料里真实提到的改动，不要编造功能、数字或时间。纯内部重构、测试、日志等用户感知不到的内容直接略去。
3. title：一句话概括本次更新，8-20 个字，不加句号。
4. summary：1-2 句话说明这次更新的重点和带来的好处，不超过 80 字。
5. items：每条一个具体改动，动宾短句，12-40 字，最多 ` + fmt.Sprint(changelogDraftMaxItems) + ` 条，按重要程度排序，不加序号。
6. tag：新增能力用 "feature"，已有功能的优化、修复、提速用 "experience"。
7. 只返回 JSON，不要 Markdown 或解释，格式：{"tag":"feature","title":"...","summary":"...","items":["...","..."]}
`)
	if tag != "" {
		label := map[string]string{"feature": "新功能", "experience": "体验优化"}[tag]
		fmt.Fprintf(&b, "\n本次类型已指定为 %q（%s）。\n", tag, label)
	}
	if refs := changelogStyleRefs(recent); refs != "" {
		b.WriteString("\n以下是最近已发布的更新说明，请保持一致的语气和颗粒度（只参考写法，不要照抄内容）：\n")
		b.WriteString(refs)
	}
	if current.Title != "" || current.Summary != "" || len(current.Items) > 0 {
		b.WriteString("\n表单里已有的草稿（可在此基础上改写、补全、润色）：\n")
		raw, _ := json.Marshal(current)
		b.Write(raw)
		b.WriteString("\n")
	}
	if notes != "" {
		b.WriteString("\n本次改动材料：\n<<<\n")
		b.WriteString(notes)
		b.WriteString("\n>>>\n")
	} else {
		b.WriteString("\n没有额外材料，请只润色上面的草稿：措辞更清楚、条目更具体，不要增加草稿里没有的改动。\n")
	}
	return b.String()
}

func changelogStyleRefs(recent []*store.ChangelogEntry) string {
	var b strings.Builder
	count := 0
	for _, entry := range recent {
		if entry == nil || strings.TrimSpace(entry.Title) == "" || len(entry.Items) == 0 {
			continue
		}
		summary := ""
		if entry.Summary != nil {
			summary = strings.TrimSpace(*entry.Summary)
		}
		items := entry.Items
		if len(items) > 4 {
			items = items[:4]
		}
		fmt.Fprintf(&b, "- 标题：%s\n  摘要：%s\n  条目：%s\n", entry.Title, summary, strings.Join(items, "；"))
		count++
		if count >= changelogDraftStyleRefs {
			break
		}
	}
	return b.String()
}

func decodeChangelogDraft(raw string) (*changelogDraftOut, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var draft changelogDraftOut
	if err := json.Unmarshal([]byte(text[start:end+1]), &draft); err != nil {
		return nil, err
	}
	result := normalizeChangelogDraft(&draft)
	if result.Title == "" || len(result.Items) == 0 {
		return nil, fmt.Errorf("empty changelog draft")
	}
	if result.Tag != "feature" && result.Tag != "experience" {
		result.Tag = "experience"
	}
	return &result, nil
}

func normalizeChangelogDraft(in *changelogDraftOut) changelogDraftOut {
	if in == nil {
		return changelogDraftOut{Items: []string{}}
	}
	out := changelogDraftOut{
		Tag:     strings.TrimSpace(in.Tag),
		Title:   truncateEcommerceBrief(strings.TrimSpace(in.Title), 200),
		Summary: truncateEcommerceBrief(strings.TrimSpace(in.Summary), 1000),
		Items:   make([]string, 0, len(in.Items)),
	}
	for _, item := range in.Items {
		item = strings.TrimSpace(changelogListMarker.ReplaceAllString(item, ""))
		if item == "" {
			continue
		}
		out.Items = append(out.Items, truncateEcommerceBrief(item, 200))
		if len(out.Items) >= changelogDraftMaxItems*2 {
			break
		}
	}
	return out
}
