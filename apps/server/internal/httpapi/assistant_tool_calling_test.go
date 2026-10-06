package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// A chat model whose upstream ignores tools cannot drive Agent mode: the run
// is refused with a clear message, while 问答 still works with it.
func TestAgentRunRefusesModelWithoutToolCalling(t *testing.T) {
	env, _, token, cfg := newExecutionAdmissionEnv(t)
	ctx := context.Background()
	for index := range cfg.Models {
		if cfg.Models[index].ID == "chat" {
			cfg.Models[index].ToolCallingDisabled = true
		}
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	conversation, _ := decode(t, env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "tools"}, token))
	run := func(mode string) (int, string) {
		created := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
			"conversationId": conversation["id"], "prompt": "做一套主图", "mode": mode, "model": "chat", "engine": "v2", "queue": true,
		}, token)
		return created.Code, created.Body.String()
	}
	if code, body := run("agent"); code != http.StatusUnprocessableEntity || !strings.Contains(body, "assistant_model_no_tools") {
		t.Fatalf("agent run with a no-tools model: %d %s", code, body)
	}
	if code, body := run("chat"); code != http.StatusCreated {
		t.Fatalf("问答 should still accept the model: %d %s", code, body)
	}

	config := env.do(t, http.MethodGet, "/api/v1/assistant/config", nil, token)
	if !strings.Contains(config.Body.String(), `"toolCalling":false`) {
		t.Fatalf("config should mark the model: %s", config.Body.String())
	}
}
