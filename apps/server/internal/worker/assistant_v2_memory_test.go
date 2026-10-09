package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func v2SystemPrompt(body map[string]any) string {
	messages, _ := body["messages"].([]any)
	system, _ := messages[0].(map[string]any)["content"].(string)
	return system
}

func v2ToolNames(body map[string]any) string {
	tools, _ := body["tools"].([]any)
	names := []string{}
	for _, raw := range tools {
		function, _ := raw.(map[string]any)["function"].(map[string]any)
		names = append(names, function["name"].(string))
	}
	return strings.Join(names, ",")
}

// v2OfferedToolNames is every tool the model can use this request: the full
// definitions plus the ones listed in load_tools for loading on demand.
func v2OfferedToolNames(body map[string]any) string {
	tools, _ := body["tools"].([]any)
	names := []string{}
	for _, raw := range tools {
		function, _ := raw.(map[string]any)["function"].(map[string]any)
		names = append(names, function["name"].(string))
		if function["name"] != assistantLoadToolsName {
			continue
		}
		parameters, _ := function["parameters"].(map[string]any)
		properties, _ := parameters["properties"].(map[string]any)
		list, _ := properties["names"].(map[string]any)
		items, _ := list["items"].(map[string]any)
		for _, name := range items["enum"].([]any) {
			names = append(names, name.(string))
		}
	}
	return strings.Join(names, ",")
}

func TestAssistantV2RemembersAndRecallsMemory(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "记住我的品牌色是雾霾蓝，以后做图都用这个色")
	if _, err := assistantmemory.Remember(ctx, fixture.st, fixture.user.ID,
		assistantmemory.Input{Kind: assistantmemory.KindHabit, Title: "常用平台", Content: "天猫"}, assistantmemory.Origin{}); err != nil {
		t.Fatal(err)
	}
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		if index == 0 {
			system := v2SystemPrompt(body)
			if !strings.Contains(system, "常用平台：天猫") || !strings.Contains(system, "memory_save") {
				t.Errorf("system prompt misses the recalled memory: %s", system)
			}
			if !strings.Contains(v2ToolNames(body), "memory_save") {
				t.Errorf("memory tools not offered: %s", v2ToolNames(body))
			}
			return sseToolCall("call_memory", "memory_save", `{"kind":"brand","title":"品牌色","content":"雾霾蓝，做图默认用这个主色"}`)
		}
		return sseText("好的，记住了：品牌色是雾霾蓝。")
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
	memories, err := assistantmemory.List(ctx, fixture.st.Pool, fixture.user.ID)
	if err != nil || len(memories) != 2 || memories[0].Kind != assistantmemory.KindBrand || memories[0].Source != assistantmemory.SourceAssistant ||
		memories[0].ConversationID == nil || *memories[0].ConversationID != fixture.run.ConversationID {
		t.Fatalf("memories = %+v %v", memories, err)
	}
	message, err := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if err != nil {
		t.Fatal(err)
	}
	views, _ := message.Metadata["dataViews"].([]any)
	if len(views) != 1 || views[0].(map[string]any)["view"] != "memory_change" {
		t.Fatalf("dataViews = %#v", message.Metadata["dataViews"])
	}
}

func TestAssistantV2WithMemoryOffNeitherRecallsNorWrites(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "你都记得我哪些事")
	if _, err := assistantmemory.Remember(ctx, fixture.st, fixture.user.ID,
		assistantmemory.Input{Kind: assistantmemory.KindBrand, Title: "品牌名", Content: "暖光小屋"}, assistantmemory.Origin{}); err != nil {
		t.Fatal(err)
	}
	if err := assistantmemory.SetEnabled(ctx, fixture.st.Pool, fixture.user.ID, false); err != nil {
		t.Fatal(err)
	}
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		system := v2SystemPrompt(body)
		if strings.Contains(system, "暖光小屋") || !strings.Contains(system, "关闭了助手记忆") || strings.Contains(v2ToolNames(body), "memory_") {
			t.Errorf("memory leaked while off: tools=%s", v2ToolNames(body))
		}
		return sseText("你关闭了记忆，可以在左侧“记忆”里开启。")
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
	if len(upstream.requests) != 1 {
		t.Fatalf("requests = %d", len(upstream.requests))
	}
}

func TestAssistantV2CommerceUsesARememberedProductsPhotos(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "用我的保温杯做一套天猫主图")
	key := "uploads/" + fixture.user.ID.String() + "/cup.png"
	if _, err := assistantmemory.Remember(ctx, fixture.st, fixture.user.ID,
		assistantmemory.Input{Kind: assistantmemory.KindProduct, Title: "保温杯", Content: "316 不锈钢", ImageKeys: []string{key}}, assistantmemory.Origin{}); err != nil {
		t.Fatal(err)
	}
	memories, _ := assistantmemory.List(ctx, fixture.st.Pool, fixture.user.ID)
	worker := &Worker{St: fixture.st}
	turn := worker.assistantV2CommerceTurn(ctx, fixture.run, memories)
	if !turn.enabled || turn.product == nil || len(turn.inputKeys) != 1 || turn.inputKeys[0] != key {
		t.Fatalf("turn = %+v", turn)
	}
	// Without a matching product it stays a normal turn.
	other := *fixture.run
	other.Prompt = "用我的茶杯做一套天猫主图"
	if turn := worker.assistantV2CommerceTurn(ctx, &other, memories); turn.enabled {
		t.Fatalf("unrelated product enabled commerce: %+v", turn)
	}
}
