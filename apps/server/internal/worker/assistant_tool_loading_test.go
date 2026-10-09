package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// A greeting carries only the everyday tools in full; a rare tool is loaded
// on demand within the same turn, runs, and is carried into the next turn.
func TestAssistantAgentLoadsRareToolsOnDemand(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "你好")
	var requests []string
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		full := "," + v2ToolNames(body) + ","
		requests = append(requests, full)
		switch index {
		case 0:
			if strings.Contains(full, ",my_stats_query,") || strings.Contains(full, ",memory_save,") || !strings.Contains(full, ",load_tools,") {
				t.Errorf("first request tools = %s", full)
			}
			if !strings.Contains(","+v2OfferedToolNames(body)+",", ",my_stats_query,") {
				t.Errorf("my_stats_query is not loadable: %s", v2OfferedToolNames(body))
			}
			return sseToolCall("call_load", assistantLoadToolsName, `{"names":["my_stats_query"]}`)
		case 1:
			if !strings.Contains(full, ",my_stats_query,") || !strings.HasSuffix(full, ",load_tools,my_stats_query,") {
				t.Errorf("loaded tool should be appended after load_tools: %s", full)
			}
			return sseToolCall("call_stats", "my_stats_query", `{"metrics":["images"],"timeRange":{"preset":"this_month"}}`)
		default:
			return sseText("本月还没有生成记录。")
		}
	}}
	server := upstream.server(t)
	defer server.Close()
	client, err := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	if err != nil {
		t.Fatal(err)
	}
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	if len(requests) != 3 {
		t.Fatalf("requests = %d", len(requests))
	}
	message, err := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if err != nil {
		t.Fatal(err)
	}
	loaded, _ := message.Metadata["loadedTools"].([]any)
	if len(loaded) != 1 || loaded[0] != "my_stats_query" {
		t.Fatalf("loadedTools = %#v", message.Metadata["loadedTools"])
	}
	steps, _ := message.Metadata["toolSteps"].([]any)
	if len(steps) != 1 {
		t.Fatalf("load_tools must not be a visible step: %#v", steps)
	}
	if used := assistantToolsUsedInHistory([]*store.AssistantMessage{message}); !containsString(used, "my_stats_query") {
		t.Fatalf("history tools = %v", used)
	}
}

func TestAssistantToolLoaderKeepsThePrefixStable(t *testing.T) {
	all := []sub2api.FunctionTool{{Name: "propose_image_action"}, {Name: "my_stats_query"}, {Name: "web_search"}, {Name: "memory_save"}}
	loader := newAssistantToolLoader(all, []string{"web_search", ""})
	names := func(tools []sub2api.FunctionTool) string {
		out := []string{}
		for _, tool := range tools {
			out = append(out, tool.Name)
		}
		return strings.Join(out, ",")
	}
	if got := names(loader.active(all)); got != "propose_image_action,web_search,load_tools" {
		t.Fatalf("active = %s", got)
	}
	description := loader.loadTool.Description
	loader.load([]string{"memory_save", "not_a_tool"})
	if got := names(loader.active(all)); got != "propose_image_action,web_search,load_tools,memory_save" {
		t.Fatalf("active after load = %s", got)
	}
	loader.load([]string{"my_stats_query"})
	// Everything loaded: load_tools has nothing left to offer.
	if got := names(loader.active(all)); got != "propose_image_action,web_search,memory_save,my_stats_query" {
		t.Fatalf("active after loading all = %s", got)
	}
	if loader.loadTool.Description != description {
		t.Fatal("load_tools description must not change while loading")
	}
	if none := newAssistantToolLoader([]sub2api.FunctionTool{{Name: "web_search"}}); names(none.active(none.all)) != "web_search" {
		t.Fatal("no deferrable tools: nothing changes")
	}
}

func TestAssistantToolPreloadsFollowThePrompt(t *testing.T) {
	cases := map[string]string{
		"这个月钱都花哪了？":   "my_stats_query",
		"记住我的品牌色是雾霾蓝": "memory_save",
		"把这张图存到素材库":   "assets_save",
		"帮我把这张图高清放大":  "media_action",
	}
	for prompt, want := range cases {
		if got := assistantToolPreloadsFor(prompt); !containsString(got, want) {
			t.Errorf("%s: preloads = %v, want %s", prompt, got, want)
		}
	}
	if got := assistantToolPreloadsFor("你好你好"); len(got) != 0 {
		t.Errorf("greeting preloads = %v", got)
	}
}
