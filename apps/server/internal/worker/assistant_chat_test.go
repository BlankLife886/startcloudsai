package worker

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

type scriptedAssistantChatClient struct {
	responses []string
	payloads  [][]sub2api.Message
}

func (c *scriptedAssistantChatClient) CompleteChatTextWithImages(
	_ context.Context,
	messages []sub2api.Message,
	_ []string,
	onText func(string, string) error,
) (sub2api.ChatCompletion, error) {
	cloned := append([]sub2api.Message(nil), messages...)
	c.payloads = append(c.payloads, cloned)
	response := c.responses[len(c.payloads)-1]
	for end := 1; end <= len(response); end++ {
		if onText != nil {
			if err := onText(response[:end], ""); err != nil {
				return sub2api.ChatCompletion{Text: response[:end]}, err
			}
		}
	}
	return sub2api.ChatCompletion{Text: response}, nil
}

func leakedSearchResponse(prompt, suffix string) string {
	return "search(" + strconv.QuoteToASCII(prompt) + ")" + suffix
}

func TestAssistantConversationPayloadAlwaysIncludesAuthoritativeCurrentPrompt(t *testing.T) {
	run := &store.AssistantRun{
		ID: uuid.New(), UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "当前权威问题",
	}
	references := []string{"image-a"}
	payload, _ := buildAssistantContext("", nil, run, references, false)
	if len(payload) != 1 || payload[0].Role != "user" || payload[0].Content != run.Prompt ||
		len(payload[0].ReferenceImages) != 1 || payload[0].ReferenceImages[0] != "image-a" {
		t.Fatalf("fallback payload = %#v", payload)
	}

	history := []*store.AssistantMessage{
		{ID: uuid.New(), Role: "user", Content: "上一轮问题", Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: "上一轮回答", Status: "complete"},
		{ID: run.UserMessageID, Role: "user", Content: "过期展示文本", Status: "complete"},
		{ID: run.AssistantMessageID, Role: "assistant", Content: "占位", Status: "running"},
	}
	payload, _ = buildAssistantContext("", history, run, references, false)
	if len(payload) != 3 || payload[2].Content != run.Prompt || len(payload[2].ReferenceImages) != 1 {
		t.Fatalf("history payload = %#v", payload)
	}
}

func TestAssistantRunFileIDsAreValidatedAndDeduplicated(t *testing.T) {
	first := uuid.New()
	run := &store.AssistantRun{Params: map[string]any{
		"_assistantFileIds": []any{first.String(), "invalid", first.String()},
	}}
	ids := assistantRunFileIDs(run)
	if len(ids) != 1 || ids[0] != first {
		t.Fatalf("ids = %#v", ids)
	}
	if assistantDocumentEvidenceRead([]string{"files_list"}) ||
		!assistantDocumentEvidenceRead([]string{"files_list", "files_search"}) {
		t.Fatal("document evidence classification is incorrect")
	}
}

func TestBuildAssistantContextAppliesTokenBudgetAndKeepsCurrentPrompt(t *testing.T) {
	run := &store.AssistantRun{
		ID: uuid.New(), UserMessageID: uuid.New(), AssistantMessageID: uuid.New(),
		Prompt: "必须保留的当前问题",
		Params: map[string]any{"_chatContextWindowTokens": 4_096, "_chatMaxOutputTokens": 512},
	}
	history := []*store.AssistantMessage{
		{ID: uuid.New(), Role: "user", Content: strings.Repeat("旧问题", 700), Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: strings.Repeat("旧回答", 700), Status: "complete"},
		{ID: uuid.New(), Role: "user", Content: "最近问题", Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: "最近回答", Status: "complete"},
	}
	payload, stats := buildAssistantContext("受控系统提示", history, run, nil, false)
	if len(payload) < 2 || payload[0].Role != "system" || payload[len(payload)-1].Content != run.Prompt {
		t.Fatalf("payload = %#v", payload)
	}
	if stats.DroppedMessages == 0 || stats.EstimatedTokens > stats.InputBudget {
		t.Fatalf("stats = %#v", stats)
	}
	if runes := assistantContextTextRunes(payload); runes >= assistantContextTextRunes([]sub2api.Message{
		{Content: history[0].Content}, {Content: history[1].Content}, {Content: history[2].Content}, {Content: history[3].Content},
	}) {
		t.Fatalf("context was not trimmed: runes=%d payload=%#v", runes, payload)
	}
}

func TestBuildAssistantContextDoesNotOverallocateSummaryBudget(t *testing.T) {
	run := &store.AssistantRun{
		ID: uuid.New(), UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "必须保留的当前问题",
		Params: map[string]any{"_chatContextWindowTokens": 4_096, "_chatMaxOutputTokens": 512},
	}
	history := []*store.AssistantMessage{
		{ID: uuid.New(), Role: "user", Content: strings.Repeat("旧问题", 400), Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: strings.Repeat("旧回答", 400), Status: "complete"},
	}
	payload, stats := buildAssistantContext(strings.Repeat("系统规则", 260), history, run, nil, false)
	if payload[len(payload)-1].Content != run.Prompt || stats.EstimatedTokens > stats.InputBudget {
		t.Fatalf("payload=%#v stats=%#v", payload, stats)
	}
}

func TestBuildAssistantContextDropsOrphanedAssistantTurns(t *testing.T) {
	run := &store.AssistantRun{
		ID: uuid.New(), UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "当前问题",
		Params: map[string]any{"_chatContextWindowTokens": 4_096, "_chatMaxOutputTokens": 512},
	}
	history := []*store.AssistantMessage{
		{ID: uuid.New(), Role: "assistant", Content: "没有用户来源的回答", Status: "complete"},
		{ID: uuid.New(), Role: "user", Content: strings.Repeat("超长旧问题", 500), Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: "不能脱离旧问题保留", Status: "complete"},
		{ID: uuid.New(), Role: "user", Content: "最近问题", Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: "最近回答", Status: "complete"},
	}
	payload, stats := buildAssistantContext("system", history, run, nil, false)
	joined := ""
	for _, message := range payload {
		joined += message.Content
	}
	if strings.Contains(joined, "没有用户来源") {
		t.Fatalf("orphaned assistant message survived: %#v", payload)
	}
	if !strings.Contains(joined, "不能脱离旧问题保留") || !strings.Contains(joined, "最近问题") ||
		!strings.Contains(joined, "最近回答") || payload[len(payload)-1].Content != run.Prompt ||
		stats.DroppedMessages < 3 || stats.CompactedMessages == 0 {
		t.Fatalf("payload=%#v stats=%#v", payload, stats)
	}
}

func TestBuildAssistantContextProactivelyCompactsLongConversation(t *testing.T) {
	run := &store.AssistantRun{
		ID: uuid.New(), UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "继续当前任务",
		Params: map[string]any{"_chatContextWindowTokens": 128_000, "_chatMaxOutputTokens": 8_192},
	}
	history := make([]*store.AssistantMessage, 0, assistantContextCompactAtMessages)
	for index := 0; index < assistantContextCompactAtMessages/2; index++ {
		history = append(history,
			&store.AssistantMessage{ID: uuid.New(), Role: "user", Content: "旧问题 " + strconv.Itoa(index), Status: "complete"},
			&store.AssistantMessage{ID: uuid.New(), Role: "assistant", Content: "旧回答 " + strconv.Itoa(index), Status: "complete"},
		)
	}
	payload, stats := buildAssistantContext("system", history, run, nil, false)
	joined := ""
	for _, message := range payload {
		joined += message.Content + "\n"
	}
	if stats.DroppedMessages == 0 || stats.CompactedMessages == 0 || !stats.CompactionPerformed ||
		stats.IncludedMessages > assistantContextRecentMessageTarget {
		t.Fatalf("stats = %#v", stats)
	}
	if !strings.Contains(joined, "较早对话的压缩摘要") || !strings.Contains(joined, "旧问题 47") ||
		payload[len(payload)-1].Content != run.Prompt || stats.EstimatedTokens > stats.InputBudget {
		t.Fatalf("payload=%#v stats=%#v", payload, stats)
	}
}

func TestBuildAssistantContextCarriesForwardPersistedSummary(t *testing.T) {
	run := &store.AssistantRun{ID: uuid.New(), UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "下一步", Params: map[string]any{}}
	summarizedUserID := uuid.New()
	summaryThroughID := uuid.New()
	history := []*store.AssistantMessage{
		{ID: summarizedUserID, Role: "user", Content: "已经压缩的旧问题，不应再次进入上下文", Status: "complete"},
		{ID: summaryThroughID, Role: "assistant", Content: "已经压缩的旧回答，不应再次进入上下文", Status: "complete"},
		{ID: uuid.New(), Role: "user", Content: "最近补充", Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: "上轮回答", Status: "complete", Metadata: map[string]any{
			"_contextSummary": "已确认项目目标和三个约束。", "_contextSummaryMessages": 18,
			"_contextSummaryThroughMessageId": summaryThroughID.String(),
		}},
		{ID: uuid.New(), Role: "user", Content: "最新问题", Status: "complete"},
		{ID: uuid.New(), Role: "assistant", Content: "最新回答", Status: "complete"},
	}
	payload, stats := buildAssistantContext("system", history, run, nil, false)
	if len(payload) != 7 || payload[1].Role != "assistant" || !strings.Contains(payload[1].Content, "三个约束") {
		t.Fatalf("payload = %#v", payload)
	}
	joined := ""
	for _, message := range payload {
		joined += message.Content + "\n"
	}
	if strings.Contains(joined, "已经压缩的旧问题") || strings.Contains(joined, "已经压缩的旧回答") {
		t.Fatalf("messages before summary cursor were included again: %#v", payload)
	}
	if stats.CompactionPerformed || stats.CompactedMessages != 18 || stats.SummaryMessages != 18 || stats.TotalMessages != 22 ||
		stats.IncludedMessages != 4 || stats.SummaryThroughID != summaryThroughID.String() {
		t.Fatalf("stats = %#v", stats)
	}
	public := applyAssistantContextStats(run, stats)
	if public["policyVersion"] != assistantContextPolicyVersion || run.Params["_contextSummaryMessages"] != 18 ||
		run.Params["_contextSummaryThroughMessageId"] != summaryThroughID.String() {
		t.Fatalf("public=%#v params=%#v", public, run.Params)
	}
}

func TestRequestAssistantChatTextRemovesMatchingLeakedSearchPrefix(t *testing.T) {
	prompt := "user: 参考图片编号：图片1、图片2。请按这些编号理解提示词中的图片引用。"
	client := &scriptedAssistantChatClient{responses: []string{
		leakedSearchResponse(prompt, "## 电商产品制作简报\n\n- 产品：无线耳机"),
	}}
	var snapshots []string
	text, _, err := requestAssistantChatText(context.Background(), client,
		[]sub2api.Message{{Role: "user", Content: prompt}}, prompt,
		func(value, _ string) error {
			snapshots = append(snapshots, value)
			return nil
		}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "## 电商产品制作简报\n\n- 产品：无线耳机" {
		t.Fatalf("text = %q", text)
	}
	if len(snapshots) == 0 || snapshots[len(snapshots)-1] != text {
		t.Fatalf("snapshots = %#v", snapshots)
	}
	for _, snapshot := range snapshots {
		if strings.Contains(snapshot, "search(") || strings.Contains(snapshot, `\\u53c2`) {
			t.Fatalf("leaked snapshot = %q", snapshot)
		}
	}
}

func TestRequestAssistantChatTextRetriesEmptyLeakedSearchOutput(t *testing.T) {
	prompt := "user: 分析这张商品图"
	client := &scriptedAssistantChatClient{responses: []string{
		leakedSearchResponse(prompt, ""),
		"这是可用的商品分析。",
	}}
	text, _, err := requestAssistantChatText(context.Background(), client,
		[]sub2api.Message{{Role: "user", Content: prompt}}, prompt, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "这是可用的商品分析。" || len(client.payloads) != 2 {
		t.Fatalf("text=%q requests=%d", text, len(client.payloads))
	}
	if got := client.payloads[1][0]; got.Role != "system" || got.Content != assistantChatRetryInstruction {
		t.Fatalf("retry instruction = %#v", got)
	}
}

func TestRequestAssistantChatTextFailsAfterRepeatedEmptyLeak(t *testing.T) {
	prompt := "user: 分析这张商品图"
	leaked := leakedSearchResponse(prompt, "")
	client := &scriptedAssistantChatClient{responses: []string{leaked, leaked}}
	_, _, err := requestAssistantChatText(context.Background(), client,
		[]sub2api.Message{{Role: "user", Content: prompt}}, prompt, nil, nil)
	if !errors.Is(err, errAssistantLeakedToolOutput) {
		t.Fatalf("error = %v", err)
	}
}

func TestCleanAssistantChatOutputPreservesLegitimateSearchText(t *testing.T) {
	prompt := "user: 解释 search 函数"
	for _, value := range []string{
		`代码示例：search("user: query")`,
		`search("user: another prompt") is a code example`,
		"```js\nsearch(\"user: query\")\n```",
	} {
		cleaned, leaked := cleanAssistantChatOutput(value, prompt)
		if leaked || cleaned != value {
			t.Fatalf("value=%q cleaned=%q leaked=%v", value, cleaned, leaked)
		}
	}
}

func TestAssistantArtifactRequested(t *testing.T) {
	for _, prompt := range []string{
		"请生成一个 CSV 文件供我下载",
		"把结果整理成 Markdown 文档",
		"create a JSON file with these rows",
		"帮我做成PPT，输出PPT文件",
		"导出一份 PowerPoint 演示文稿",
	} {
		if !assistantArtifactRequested(prompt) {
			t.Fatalf("expected artifact intent for %q", prompt)
		}
	}
	for _, prompt := range []string{
		"解释一下 JSON 是什么",
		"分析我上传的文件",
		"生成一张图片",
		"下载这张图片",
	} {
		if assistantArtifactRequested(prompt) {
			t.Fatalf("unexpected artifact intent for %q", prompt)
		}
	}
}
