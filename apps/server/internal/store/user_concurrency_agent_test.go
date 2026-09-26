package store

import "strings"
import "testing"

// Agent 闸门有两处判定：准入时用 Go 看这条 run，统计在跑的数量时用 SQL 看表。
// 两边口径只要错一点，闸门就会漏——要么放进来超额的 Agent，要么把普通对话也拦住。
func TestAssistantRunIsAgentMatchesTheSQLPredicate(t *testing.T) {
	for _, tc := range []struct {
		name     string
		mode     string
		resolved string
		want     bool
	}{
		{"显式 agent 模式", "agent", "", true},
		{"agent 模式且已判定", "agent", "agent", true},
		{"auto 模式执行中判定为 agent", "auto", "agent", true},
		{"auto 模式尚未判定", "auto", "", false},
		{"auto 模式判定为对话", "auto", "chat", false},
		{"普通对话不该被 agent 闸门拦住", "chat", "", false},
		// 联网搜索这类请求会被 worker 从 chat 提升成 Agent 执行，库里的 mode 仍是 chat。
		// 不认这种情况，它们就白占 Agent 名额却不被计数。
		{"对话轮被提升为 agent 执行", "chat", "agent", true},
		{"出图走的是另一套限额", "image", "", false},
		{"出图已判定也不算 agent", "image", "image", false},
	} {
		run := &AssistantRun{Mode: tc.mode, ResolvedMode: tc.resolved}
		if got := AssistantRunIsAgent(run); got != tc.want {
			t.Errorf("%s: mode=%q resolved=%q 得到 %v，期望 %v", tc.name, tc.mode, tc.resolved, got, tc.want)
		}
	}
	if AssistantRunIsAgent(nil) {
		t.Error("空 run 不该被当成 agent")
	}
}

func TestAssistantAgentSQLCoversBothModeShapes(t *testing.T) {
	sql := assistantAgentSQL("run")

	// 改了 Go 那边的判定就必须同步改这里，这两条断言是为了让遗漏立刻失败。
	if !strings.Contains(sql, "run.mode = 'agent'") {
		t.Errorf("SQL 漏了显式 agent 模式：%s", sql)
	}
	// resolved_mode 要独立成一条，不能只在 auto 模式下才看：被提升成 Agent 执行的
	// 对话轮，库里的 mode 一直是 chat，只有 resolved_mode 能认出它们。
	if !strings.Contains(sql, "COALESCE(run.resolved_mode,'') = 'agent'") {
		t.Errorf("SQL 漏了 resolved_mode 已判定为 agent 的情况：%s", sql)
	}
	if strings.Contains(sql, "run.mode = 'auto'") {
		t.Errorf("resolved_mode 的判定不该再限定在 auto 模式下：%s", sql)
	}
	// 别把出图也算进 agent 池，那会让出图任务白白被对话闸门拦一道。
	if strings.Contains(sql, "'image'") {
		t.Errorf("agent 判定不该牵扯出图模式：%s", sql)
	}
}
