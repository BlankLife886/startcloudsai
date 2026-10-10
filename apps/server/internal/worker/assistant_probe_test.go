package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantreview"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestProbeAssistantAgentReportsTheFirstMoveWithTheRealToolset(t *testing.T) {
	st := testdb.Setup(t)
	worker := &Worker{St: st}
	probe := func(item assistantreview.Case, script func(index int, body map[string]any) string) assistantreview.Action {
		t.Helper()
		upstream := &fakeUpstream{script: script}
		server := upstream.server(t)
		defer server.Close()
		client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
		action, err := worker.ProbeAssistantAgent(context.Background(), client, item, nil)
		if err != nil {
			t.Fatalf("probe %s: %v", item.ID, err)
		}
		return action
	}

	// Agent mode: the image tool is there, and calling it is an image move.
	got := probe(assistantreview.Case{ID: "a", Mode: assistantreview.ModeAgent, Prompt: "画一只猫",
		Context: []assistantreview.Message{{Role: "assistant", Content: "[生成了 1 张图片：小狗]"}}},
		func(index int, body map[string]any) string {
			if !strings.Contains(v2ToolNames(body), "propose_image_action") {
				t.Errorf("agent probe misses the image tool")
			}
			messages, _ := body["messages"].([]any)
			if len(messages) != 3 {
				t.Errorf("messages = %d, want system + context + prompt", len(messages))
			}
			return sseToolCall("c1", "propose_image_action", `{"action":"generate","prompt":"猫"}`)
		})
	if got.Category != assistantreview.ExpectImage || got.Tool != "propose_image_action" {
		t.Fatalf("agent move = %+v", got)
	}

	// 问答 mode: no image tool; a stats call is a data move.
	got = probe(assistantreview.Case{ID: "b", Mode: assistantreview.ModeChat, Prompt: "我花了多少积分"},
		func(index int, body map[string]any) string {
			if strings.Contains(v2ToolNames(body), "propose_image_action") {
				t.Errorf("问答 probe offered the image tool")
			}
			return sseToolCall("c1", "my_stats_query", `{"metrics":["spend_points"]}`)
		})
	if got.Category != assistantreview.ExpectData {
		t.Fatalf("chat move = %+v", got)
	}

	// A to-do list first is not the move; the next answer is.
	got = probe(assistantreview.Case{ID: "c", Mode: assistantreview.ModeAgent, Prompt: "你可以做图吗"},
		func(index int, body map[string]any) string {
			if index == 0 {
				return sseToolCall("p1", "update_plan", `{"steps":[{"title":"回答","status":"in_progress"}]}`)
			}
			return sseText("可以，告诉我想画什么。")
		})
	if got.Category != assistantreview.ExpectAnswer || !strings.Contains(got.Text, "告诉我") {
		t.Fatalf("plan-then-answer move = %+v", got)
	}

	// Attached images are described in words and open the set tools.
	probe(assistantreview.Case{ID: "d", Mode: assistantreview.ModeAgent, Prompt: "做一套天猫主图", ReferenceCount: 1},
		func(index int, body map[string]any) string {
			if !strings.Contains(v2ToolNames(body), "commerce_set_plan") {
				t.Errorf("set tools missing with an attached image")
			}
			messages, _ := body["messages"].([]any)
			last, _ := messages[len(messages)-1].(map[string]any)
			if !strings.Contains(last["content"].(string), "附带 1 张参考图") {
				t.Errorf("attachment note missing: %v", last)
			}
			return sseText("好的")
		})
}
