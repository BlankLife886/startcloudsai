package modeltest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestChatPassesWithoutToolCalling(t *testing.T) {
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		bodies = append(bodies, body)
		if body["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"不查\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"我是测试模型"}}]}`)
	}))
	defer srv.Close()
	selection := &modelconfig.Selection{
		Provider: modelconfig.Provider{ID: "p", Adapter: modelconfig.AdapterOpenAI, BaseURL: srv.URL, APIKey: "k", Enabled: true},
		Model: modelconfig.Model{ID: "m", UpstreamModel: "m", Kind: modelconfig.ModelKindChat,
			Compat: &modelconfig.RequestCompat{DropParams: []string{"tool_choice"}}},
	}
	result := Chat(context.Background(), selection, ChatOptions{Prompt: "你好"})
	if !result.OK() || len(result.Steps) != 2 || result.Steps[0].Detail != "我是测试模型" {
		t.Fatalf("result = %+v", result)
	}
	if tool := result.Steps[1]; tool.OK || !tool.Optional || !strings.Contains(tool.Detail, "未发起工具调用") || !strings.Contains(tool.Detail, "不查") {
		t.Fatalf("tool step = %+v", tool)
	}
	// The tool probe streams like the assistant, with the model's own compat rules applied.
	if _, sent := bodies[1]["tool_choice"]; sent || bodies[1]["stream"] != true || bodies[0]["messages"].([]any)[0].(map[string]any)["content"] != "你好" {
		t.Fatalf("bodies = %v", bodies)
	}
}
