package worker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestAssistantAgentToolCallKeyCanonicalizesJSON(t *testing.T) {
	first := &sub2api.ToolCall{Name: "media_action", Arguments: `{"b":2,"a":1}`}
	second := &sub2api.ToolCall{Name: "media_action", Arguments: " { \n \t\"a\" : 1, \"b\" : 2 } "}
	if got, want := assistantAgentToolCallKey(first), assistantAgentToolCallKey(second); got == "" || got != want {
		t.Fatalf("equivalent tool calls produced different keys: %q != %q", got, want)
	}

	differentArguments := &sub2api.ToolCall{Name: "media_action", Arguments: `{"a":2,"b":2}`}
	differentTool := &sub2api.ToolCall{Name: "delivery_export", Arguments: `{"a":1,"b":2}`}
	baseKey := assistantAgentToolCallKey(first)
	if got := assistantAgentToolCallKey(differentArguments); got == baseKey {
		t.Fatal("different arguments must not share a tool call key")
	}
	if got := assistantAgentToolCallKey(differentTool); got == baseKey {
		t.Fatal("different tool names must not share a tool call key")
	}
	if got := assistantAgentToolCallKey(nil); got != "" {
		t.Fatalf("nil tool call key = %q, want empty", got)
	}
}

func TestAssistantAgentToolObservationTurnsFailureIntoActionableResult(t *testing.T) {
	call := &sub2api.ToolCall{Name: "media_action"}
	observation, err := assistantAgentToolObservation(
		call,
		"",
		errors.New("malformed JSON: missing image_id"),
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"工具 media_action 执行失败", "malformed JSON", "修正工具参数", "不得声称该工具已经成功"} {
		if !strings.Contains(observation, want) {
			t.Fatalf("failure observation %q does not contain %q", observation, want)
		}
	}
}

func TestAssistantAgentSafeToolErrorRedactsAndTruncates(t *testing.T) {
	raw := "request https://internal.example/private failed; api_key=sk-private; " +
		"Authorization: Bearer abcdefghijklmnop; token=top-secret; " + strings.Repeat("x", assistantAgentToolErrorRunes+200)
	got := assistantAgentSafeToolError(errors.New(raw))
	for _, secret := range []string{"internal.example", "sk-private", "abcdefghijklmnop", "top-secret"} {
		if strings.Contains(got, secret) {
			t.Fatalf("sanitized error leaked %q: %q", secret, got)
		}
	}
	if !strings.Contains(got, "[redacted]") {
		t.Fatalf("sanitized error should mark redacted credentials: %q", got)
	}
	if runes := len([]rune(got)); runes != assistantAgentToolErrorRunes {
		t.Fatalf("sanitized error rune length = %d, want %d", runes, assistantAgentToolErrorRunes)
	}
}

func TestAssistantAgentToolObservationPreservesParentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	observation, err := assistantAgentToolObservation(
		&sub2api.ToolCall{Name: "media_action"},
		"",
		errors.New("tool failed"),
		ctx.Err(),
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if observation != "" {
		t.Fatalf("canceled call returned observation %q", observation)
	}
}

func TestAssistantAgentRepeatedToolObservationReusesPriorResult(t *testing.T) {
	got := assistantAgentRepeatedToolObservation(`{"ok":true}`)
	for _, want := range []string{"没有再次执行", "复用此前结果", `{"ok":true}`} {
		if !strings.Contains(got, want) {
			t.Fatalf("repeated-call observation %q does not contain %q", got, want)
		}
	}
}

func TestAssistantAgentNeedsFinalSynthesis(t *testing.T) {
	const proposalTool = "propose_image_action"
	tests := []struct {
		name      string
		result    sub2api.AgentChatResult
		exhausted bool
		want      bool
	}{
		{name: "normal text", result: sub2api.AgentChatResult{Text: "done"}, want: false},
		{name: "empty response", result: sub2api.AgentChatResult{}, want: true},
		{name: "loop exhausted", result: sub2api.AgentChatResult{Text: "partial"}, exhausted: true, want: true},
		{name: "unresolved tool", result: sub2api.AgentChatResult{ToolCall: &sub2api.ToolCall{Name: "media_action"}}, want: true},
		{name: "proposal tool", result: sub2api.AgentChatResult{ToolCall: &sub2api.ToolCall{Name: proposalTool}}, exhausted: true, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := assistantAgentNeedsFinalSynthesis(test.result, proposalTool, test.exhausted); got != test.want {
				t.Fatalf("assistantAgentNeedsFinalSynthesis() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestAssistantArtifactUsesDedicatedChatOnlyForSimpleRequests(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   bool
	}{
		{name: "simple artifact", prompt: "请把这些内容导出为 CSV 文件", want: true},
		{name: "web and artifact", prompt: "请联网搜索最新资料并导出为 CSV 文件", want: false},
		{name: "task status and artifact", prompt: "查询我的任务状态并导出 JSON 文件", want: false},
		{name: "workspace tool and artifact", prompt: "截取网页并导出 JSON 文件", want: false},
		{name: "not an artifact", prompt: "请联网搜索最新资料", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := assistantArtifactUsesDedicatedChat(test.prompt); got != test.want {
				t.Fatalf("assistantArtifactUsesDedicatedChat(%q) = %v, want %v", test.prompt, got, test.want)
			}
		})
	}
}

func TestAssistantAgentFileToolCatalogAndPermissions(t *testing.T) {
	worker := &Worker{St: &store.Store{}}
	registry, definitions, err := worker.assistantAgentFileToolRegistry(true, true)
	if err != nil {
		t.Fatal(err)
	}
	wantNames := map[string]bool{
		assistanttools.ToolFilesList:   true,
		assistanttools.ToolFilesSearch: true,
		assistanttools.ToolFilesRead:   true,
		assistanttools.ToolFilesCreate: true,
	}
	if len(definitions) != len(wantNames) {
		t.Fatalf("file tool definitions = %#v", definitions)
	}
	for _, definition := range definitions {
		if !wantNames[definition.Name] || !registry.Has(definition.Name) || !definition.Strict {
			t.Fatalf("unexpected or non-strict file tool definition: %#v", definition)
		}
	}

	permissions, err := assistantAgentFileToolPermissions(assistanttools.ToolFilesCreate)
	if err != nil {
		t.Fatal(err)
	}
	if len(permissions) != 1 || !permissions[assistanttools.PermissionFilesWrite] {
		t.Fatalf("files_create permissions = %#v", permissions)
	}
	for _, permission := range []assistanttools.Permission{
		assistanttools.PermissionFilesMetadata,
		assistanttools.PermissionFilesRead,
		assistanttools.PermissionTasksRead,
		assistanttools.PermissionWebRead,
		assistanttools.PermissionActionsCreate,
	} {
		if permissions[permission] {
			t.Fatalf("files_create unexpectedly received permission %s", permission)
		}
	}
}

func TestAssistantAgentFileRequirementsOrderEvidenceBeforeArtifact(t *testing.T) {
	fileIDs := []uuid.UUID{uuid.New()}
	definitions := []sub2api.FunctionTool{
		{Name: "propose_image_action"},
		{Name: assistanttools.ToolFilesSearch},
		{Name: assistanttools.ToolFilesCreate},
	}
	hasTool := func(tools []sub2api.FunctionTool, name string) bool {
		for _, tool := range tools {
			if tool.Name == name {
				return true
			}
		}
		return false
	}
	if !assistantAgentFileRequirementsPending(fileIDs, true, nil, nil) {
		t.Fatal("file requirements should suppress premature visible output and proposals")
	}
	if got := assistantAgentVisibleText("CSV 已生成", false, true); got != "" {
		t.Fatalf("premature visible text = %q", got)
	}
	if got := assistantAgentFileRequirementReminder(fileIDs, true, nil, nil); !strings.Contains(got, "files_search") {
		t.Fatalf("first reminder = %q", got)
	}
	beforeEvidence := assistantAgentToolsForFileRequirements(definitions, "propose_image_action", fileIDs, true, nil, nil)
	if hasTool(beforeEvidence, "propose_image_action") || hasTool(beforeEvidence, assistanttools.ToolFilesCreate) ||
		!hasTool(beforeEvidence, assistanttools.ToolFilesSearch) {
		t.Fatalf("tools before evidence = %#v", beforeEvidence)
	}
	if got := assistantAgentFileRequirementReminder(fileIDs, true, []string{assistanttools.ToolFilesSearch}, nil); !strings.Contains(got, "files_create") {
		t.Fatalf("artifact reminder = %q", got)
	}
	afterEvidence := assistantAgentToolsForFileRequirements(definitions, "propose_image_action", fileIDs, true,
		[]string{assistanttools.ToolFilesSearch}, nil)
	if hasTool(afterEvidence, "propose_image_action") || !hasTool(afterEvidence, assistanttools.ToolFilesCreate) {
		t.Fatalf("tools after evidence = %#v", afterEvidence)
	}
	if got := assistantAgentFileRequirementReminder(fileIDs, true,
		[]string{assistanttools.ToolFilesSearch, assistanttools.ToolFilesCreate}, []map[string]any{{"id": "artifact-1"}}); got != "" {
		t.Fatalf("completed requirements returned reminder %q", got)
	}
	if assistantAgentFileRequirementsPending(fileIDs, true,
		[]string{assistanttools.ToolFilesSearch, assistanttools.ToolFilesCreate}, []map[string]any{{"id": "artifact-1"}}) {
		t.Fatal("completed file requirements should allow visible output and image proposal")
	}
	if got := assistantAgentVisibleText("CSV 已生成", false, false); got != "CSV 已生成" {
		t.Fatalf("completed visible text = %q", got)
	}
	completedTools := assistantAgentToolsForFileRequirements(definitions, "propose_image_action", fileIDs, true,
		[]string{assistanttools.ToolFilesSearch, assistanttools.ToolFilesCreate}, []map[string]any{{"id": "artifact-1"}})
	if !hasTool(completedTools, "propose_image_action") || !hasTool(completedTools, assistanttools.ToolFilesCreate) {
		t.Fatalf("tools after requirements = %#v", completedTools)
	}
}

func TestAttachAssistantArtifactsAddsFinalMessageMetadata(t *testing.T) {
	metadata := map[string]any{"statusStage": "complete"}
	artifacts := []map[string]any{{"id": "artifact-1", "format": "csv"}}
	attachAssistantArtifacts(metadata, artifacts)
	got, ok := metadata["artifacts"].([]map[string]any)
	if !ok || len(got) != 1 || got[0]["id"] != "artifact-1" || metadata["statusStage"] != "complete" {
		t.Fatalf("final metadata = %#v", metadata)
	}
}

// 放开迭代上限后，几十步的工具结果会撑爆模型窗口。裁剪必须保住最近几步的完整结果，
// 同时一条消息都不能少——少一条 tool 结果，整轮请求就会因为 tool_call 配不上而失败。
func TestTrimAssistantAgentObservationsKeepsRecentResultsAndAllMessages(t *testing.T) {
	const chunk = 40 << 10
	payload := []sub2api.Message{{Role: "system", Content: strings.Repeat("s", chunk)}}
	for i := 0; i < 8; i++ {
		payload = append(payload,
			sub2api.Message{Role: "assistant", ToolCalls: []sub2api.ToolCall{{ID: fmt.Sprintf("call_%d", i), Name: "web_search"}}},
			sub2api.Message{Role: "tool", Name: "web_search", ToolCallID: fmt.Sprintf("call_%d", i), Content: strings.Repeat("r", chunk)},
		)
	}
	before := len(payload)

	trimAssistantAgentObservations(payload)

	if len(payload) != before {
		t.Fatalf("消息数量从 %d 变成 %d，tool_call 会配不上结果", before, len(payload))
	}
	if payload[0].Content != strings.Repeat("s", chunk) {
		t.Fatal("非 tool 消息不该被裁剪")
	}
	kept, trimmed, total := 0, 0, 0
	for _, message := range payload {
		if message.Role != "tool" {
			continue
		}
		total += len(message.Content)
		if message.Content == assistantAgentTrimmedObservation {
			trimmed++
		} else {
			kept++
		}
	}
	if total > assistantAgentObservationBudgetBytes {
		t.Fatalf("裁剪后工具结果仍占 %d 字节，超出预算 %d", total, assistantAgentObservationBudgetBytes)
	}
	if kept == 0 || trimmed == 0 {
		t.Fatalf("应当保留最近若干步、省略较早的，实际保留 %d 省略 %d", kept, trimmed)
	}
	// 被省略的必须是较早的那些，最后一步一定要完整。
	last := payload[len(payload)-1]
	if last.Role != "tool" || last.Content == assistantAgentTrimmedObservation {
		t.Fatal("最近一步的工具结果不能被省略")
	}
}

func TestTrimAssistantAgentObservationsLeavesSmallPayloadsAlone(t *testing.T) {
	payload := []sub2api.Message{
		{Role: "user", Content: "查一下天气"},
		{Role: "assistant", ToolCalls: []sub2api.ToolCall{{ID: "call_0", Name: "web_search"}}},
		{Role: "tool", Name: "web_search", ToolCallID: "call_0", Content: "今天晴"},
	}

	trimAssistantAgentObservations(payload)

	if payload[2].Content != "今天晴" {
		t.Fatalf("预算之内不该改动任何内容，实际为 %q", payload[2].Content)
	}
}

// 模型知道方案的字段格式（格式就写在指令里），所以它偶尔会不调用工具、直接把方案 JSON
// 当正文输出。那种情况下没有任何人接手这份方案，用户说了“开始做图”却一张图都没有，
// 只看到一段 JSON。这里确认我们能认出来，同时不会把正常回答误判成方案。
func TestAssistantTextLooksLikeProposalCatchesLeakedJSONOnly(t *testing.T) {
	leaked := `{"action":"generate","prompt":"雪山日出的宽幅风景","ratio":"3:2","count":1}`
	fenced := "```json\n" + leaked + "\n```"

	for _, tc := range []struct {
		name string
		text string
		want bool
	}{
		{"裸 JSON 方案", leaked, true},
		{"包在代码围栏里的方案", fenced, true},
		{"编辑动作也算方案", `{"action":"edit","prompt":"把天空换成夜空"}`, true},
		{"普通回答", "我把比例改成了 3:2，接下来开始生成。", false},
		{"空正文", "", false},
		{"缺少 action 的 JSON 不算方案", `{"prompt":"雪山日出"}`, false},
		{"没有提示词的 JSON 不算方案", `{"action":"generate","count":2}`, false},
		{"action 不认识的不算方案", `{"action":"inspect","prompt":"看看这张图"}`, false},
		// 线上真实形状：模型连 action 都没写，提示词全在 items 里。归一化会补默认动作，
		// 所以这种也必须接住，否则用户只会看到一段 JSON。
		{"没有 action 的多图方案", `{"model":"model-aa4b","count":3,"items":[{"title":"封面一","prompt":"翡翠绿配色封面"}]}`, true},
		{"带一句开场白的方案", "好的，方案如下：\n" + leaked, true},
		// 正文里顺带出现 JSON 是合法回答，不能被当成方案劫持掉。
		{"讲解里引用了方案 JSON", "方案的格式是这样的：" + leaked + "，你可以照着改。", false},
		{"开场白太长说明是解释性回答", "我先说明一下我们内部用的方案结构，它大致长这样，你照着改就行：" + leaked, false},
		// 恰好带 prompt 的普通 JSON 不该被当成出图方案。
		{"没有任何出图字段的 JSON", `{"prompt":"随便一段文字","note":"不是方案"}`, false},
	} {
		if got := assistantTextLooksLikeProposal(tc.text); got != tc.want {
			t.Errorf("%s: 得到 %v，期望 %v（正文 %q）", tc.name, got, tc.want, tc.text)
		}
	}
}

// 自动授权的依据必须是用户那个开关。之前额外要求分类器也确信，等于让一个更弱的信号
// 否决“Agent 自己决定要出图”这个更强的信号，于是开了开关仍然出卡片。
func TestAssistantProposalAutoApprovableFollowsTheUserSwitch(t *testing.T) {
	generate := assistantImageProposal{Action: "generate"}
	edit := assistantImageProposal{Action: "edit"}

	if !assistantProposalAutoApprovable(generate, true) {
		t.Error("开了自动授权、又是新建图片，应该免确认")
	}
	if assistantProposalAutoApprovable(generate, false) {
		t.Error("没开自动授权就不该免确认")
	}
	// 改动已有图片是用户明确要求保留确认的操作。
	if assistantProposalAutoApprovable(edit, true) {
		t.Error("编辑已有图片即使开了自动授权也要确认")
	}
}

// 这是线上真实踩到的形状：模型输出了一份三张图的方案，每张图的提示词都在 items 里、
// 顶层没有 prompt。原先的校验只看顶层，于是这份完全合法的方案被判成“空方案”——
// 模型直接调工具时拿到解析错误，写成正文时兜底也认不出来，用户只看到一段 JSON，
// 一张图都没有生成。
func TestParseAssistantProposalAcceptsPromptsThatOnlyLiveInItems(t *testing.T) {
	multiImage := `{
	  "action": "generate",
	  "model": "model-aa4b0b5f-e0f4-4a00-b859-4371670c6264",
	  "count": 3,
	  "referenceMode": "shared",
	  "items": [
	    {"title": "数字自然风配色封面", "prompt": "蓝绿色渐变、翡翠绿、冷蓝、灰白配色的杂志封面"},
	    {"title": "静奢暖调配色封面", "prompt": "米白、砂岩色、香槟色、焦糖棕配色的精品杂志视觉"},
	    {"title": "大胆情绪色配色封面", "prompt": "珊瑚橙、深梅紫、电光绿撞色的创意海报"}
	  ]
	}`

	proposal, err := parseAssistantProposal(multiImage)
	if err != nil {
		t.Fatalf("多图方案应该能解析，却报错：%v", err)
	}
	if proposal.Count != 3 || len(proposal.Items) != 3 {
		t.Fatalf("方案内容丢失：count=%d items=%d", proposal.Count, len(proposal.Items))
	}

	// 兜底靠的就是上面这个解析，所以它必须同时认出这段正文是方案。
	if !assistantTextLooksLikeProposal(multiImage) {
		t.Error("模型把多图方案写成正文时，兜底必须认出来，否则用户只会看到一段 JSON")
	}

	// 真的没有任何提示词才算空方案。
	if _, err := parseAssistantProposal(`{"action":"generate","count":2,"items":[{"title":"只有标题"}]}`); err == nil {
		t.Error("所有 item 都没有提示词时应该判为空方案")
	}
}

// 准入闸门只看库里的 mode 时，被提升成 Agent 执行的对话轮会绕过 Agent 名额限制：
// 既不排队，跑起来也不被计数，真实并发就会超过管理员配置的上限。
func TestAssistantRunUsesAgentPoolCoversPromotedChatTurns(t *testing.T) {
	for _, tc := range []struct {
		name string
		run  *store.AssistantRun
		want bool
	}{
		{"显式 agent 模式", &store.AssistantRun{Mode: "agent", Prompt: "帮我排期"}, true},
		{"对话轮请求联网搜索会被提升", &store.AssistantRun{Mode: "chat", Prompt: "请联网搜索今天的官方消息"}, true},
		{"对话轮查询任务状态会被提升", &store.AssistantRun{Mode: "chat", Prompt: "我的生图任务为什么还在运行中"}, true},
		{"执行中已判定为 agent", &store.AssistantRun{Mode: "chat", ResolvedMode: "agent", Prompt: "你好"}, true},
		{"普通问答不该占 Agent 名额", &store.AssistantRun{Mode: "chat", Prompt: "解释一下什么是对象存储"}, false},
		{"出图走的是另一套限额", &store.AssistantRun{Mode: "image", Prompt: "请联网搜索参考图"}, false},
		{"空 run", nil, false},
	} {
		if got := assistantRunUsesAgentPool(tc.run); got != tc.want {
			t.Errorf("%s：得到 %v，期望 %v", tc.name, got, tc.want)
		}
	}
}

// 只数轮次挡不住卡死：每轮都可能贴着上游超时跑，加起来能占着名额很久，
// 而用户只看到一直在转。超时后要走最终合成交付已有进展，不是直接报错。
func TestAssistantAgentLoopIsBoundedByWallClock(t *testing.T) {
	if assistantAgentMaxDuration <= 0 {
		t.Fatal("Agent 主循环必须有挂钟上限，否则一轮可以无限期占着会话槽和 Agent 名额")
	}
	if assistantAgentMaxDuration > canvasAgentMaxDuration {
		t.Errorf("助手 Agent 的上限 %v 不该比画布 Agent 的 %v 还宽松",
			assistantAgentMaxDuration, canvasAgentMaxDuration)
	}
	// 超时走 break，交给后面的最终合成；返回错误的话用户转了几分钟却一场空。
	if !assistantAgentNeedsFinalSynthesis(sub2api.AgentChatResult{}, "propose_image_action", true) {
		t.Error("循环因超时提前结束后，必须再做一次最终合成把已有进展交付给用户")
	}
}

// 本轮已按正则锁定第一步要调的工具时，再让模型判一次意图是纯浪费：expectProposal 会被
// 强制工具短路，withholdProposal 又只认正则来源，判定结果落不到任何地方。而这次调用是
// 真花钱的——它会计进用户这一轮的上游成本。
func TestForcedToolTurnsSkipTheIntentModelCall(t *testing.T) {
	prompt := "请联网搜索最新 AI 发布资料并生成可编辑 PPT"

	// 前提：这句话正则判不准，否则这个测试什么也没验证。
	if _, certain := fastAssistantIntent(prompt, false, false); certain {
		t.Fatal("这句话应当是正则判不准的，测试前提已失效")
	}
	if !assistantPromptRequestsWebSearch(prompt) {
		t.Fatal("这句话应当会强制联网搜索工具，测试前提已失效")
	}

	worker := &Worker{}
	run := &store.AssistantRun{ID: uuid.New(), Prompt: prompt}
	// client 为 nil：一旦真去调模型，这里就会 panic 而不是悄悄多花一次调用。
	decision := worker.classifyAssistantIntentAsync(context.Background(), nil, run, nil, false, false, true)()
	if decision.usedModel {
		t.Error("锁定了工具还去问模型，等于让用户为一个用不上的判定买单")
	}
	if decision.intent != "chat" {
		t.Errorf("兜底意图 = %q，期望 chat", decision.intent)
	}

	// 没有强制工具时判定仍然有用，不能顺手把这条路也关掉。
	free := "帮我把这张海报的背景换成夜景"
	if _, certain := fastAssistantIntent(free, false, false); !certain {
		if worker.classifyAssistantIntentAsync(context.Background(), nil, &store.AssistantRun{Prompt: free}, nil, false, false, false) == nil {
			t.Error("没有强制工具时必须保留模型判定这条路")
		}
	}
}

// 并行只对只读工具开放。混进任何一个会改变外部状态的工具，整批都必须退回串行——
// 顺序错了用户可能看到对不上的结果，甚至被重复扣费。
func TestAssistantAgentParallelBatchOnlyAcceptsReadOnlyTools(t *testing.T) {
	readOnly := sub2api.AgentChatResult{ToolCalls: []sub2api.ToolCall{
		{ID: "a", Name: "web_search", Arguments: `{"query":"甲"}`},
		{ID: "b", Name: "web_search", Arguments: `{"query":"乙"}`},
		{ID: "c", Name: assistanttools.ToolFilesRead, Arguments: `{"fileId":"f1"}`},
	}}
	if batch := assistantAgentParallelBatch(readOnly); len(batch) != 3 {
		t.Fatalf("整批只读工具应当并发执行，got %d", len(batch))
	}
	for _, unsafe := range []string{
		assistanttools.ToolFilesCreate, "propose_image_action", "media_action", "send_to_workspace",
	} {
		mixed := sub2api.AgentChatResult{ToolCalls: []sub2api.ToolCall{
			{ID: "a", Name: "web_search", Arguments: `{"query":"甲"}`},
			{ID: "b", Name: unsafe, Arguments: `{}`},
		}}
		if batch := assistantAgentParallelBatch(mixed); batch != nil {
			t.Fatalf("带副作用的 %s 必须让整批退回串行，got %d", unsafe, len(batch))
		}
	}
	single := sub2api.AgentChatResult{ToolCalls: []sub2api.ToolCall{{ID: "a", Name: "web_search"}}}
	if batch := assistantAgentParallelBatch(single); batch != nil {
		t.Fatal("只有一个工具调用时不该走并行路径")
	}
}

// 上游要求每个 tool_call 都有配对的结果，少一条整轮请求就会被拒。
func TestAssistantAgentBatchToolMessagesPairEveryCallInOrder(t *testing.T) {
	calls := []sub2api.ToolCall{
		{ID: "call_a", Name: "web_search"},
		{Name: "web_search"}, // 缺 ID，必须自动补齐
		{ID: "call_c", Name: assistanttools.ToolFilesRead},
	}
	messages := assistantAgentBatchToolMessages("先查三件事", calls, []string{"甲的结果", "乙的结果", "丙的结果"})
	if len(messages) != len(calls)+1 {
		t.Fatalf("消息数不对：%d", len(messages))
	}
	if messages[0].Role != "assistant" || len(messages[0].ToolCalls) != 3 || messages[0].Content != "先查三件事" {
		t.Fatalf("assistant 消息必须一次声明全部调用：%#v", messages[0])
	}
	for index, want := range []string{"甲的结果", "乙的结果", "丙的结果"} {
		result := messages[index+1]
		declared := messages[0].ToolCalls[index]
		if result.Role != "tool" || result.Content != want || result.ToolCallID != declared.ID {
			t.Fatalf("第 %d 条结果没有和调用配对：%#v vs %#v", index, result, declared)
		}
		if strings.TrimSpace(declared.ID) == "" {
			t.Fatalf("缺失的 tool_call ID 没有补齐：%#v", declared)
		}
	}
}
