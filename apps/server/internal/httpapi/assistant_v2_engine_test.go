package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAssistantRunAcceptsV2EngineAndTimezone(t *testing.T) {
	env := newCommunityEnv(t)
	env.cfg.Sub2APIAPIKey = "test-key"
	env.cfg.Sub2APIBaseURL = "https://sub2api.test"
	_, token := env.newUserSession(t, "user")
	created := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "v2"}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create conversation: %d %s", created.Code, created.Body.String())
	}
	conversation, _ := decode(t, created)

	response := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
		"conversationId": conversation["id"],
		"prompt":         "这个月钱都花哪了",
		"mode":           "agent",
		"engine":         "v2",
		"timezone":       "Asia/Shanghai",
	}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("create v2 run: %d %s", response.Code, response.Body.String())
	}
	payload, _ := decode(t, response)
	runPayload, _ := payload["run"].(map[string]any)
	runID := uuid.MustParse(fmt.Sprint(runPayload["id"]))
	run, err := store.GetAssistantRun(context.Background(), env.st.Pool, runID)
	if err != nil || run == nil {
		t.Fatalf("run = %#v err = %v", run, err)
	}
	if run.Params["_engine"] != "v2" || run.Params["timezone"] != "Asia/Shanghai" || run.Mode != "agent" {
		t.Fatalf("params = %#v mode = %s", run.Params, run.Mode)
	}

	for name, body := range map[string]map[string]any{
		"unknown engine": {"engine": "v9", "mode": "agent"},
		"image mode":     {"engine": "v2", "mode": "image"},
		"attachments":    {"engine": "v2", "mode": "agent", "referenceImages": []any{map[string]any{"dataUrl": "data:image/png;base64,AA=="}}},
	} {
		body["conversationId"] = conversation["id"]
		body["prompt"] = "hello"
		rejected := env.do(t, http.MethodPost, "/api/v1/assistant/runs", body, token)
		if rejected.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: status %d body %s", name, rejected.Code, rejected.Body.String())
		}
	}

	// Q&A mode is served by v2 as well.
	response = env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
		"conversationId": conversation["id"], "prompt": "我这周创作了几次", "mode": "chat", "engine": "v2", "queue": true,
	}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("chat v2 run: %d %s", response.Code, response.Body.String())
	}
	payload, _ = decode(t, response)
	runPayload, _ = payload["run"].(map[string]any)
	chatRun, _ := store.GetAssistantRun(context.Background(), env.st.Pool, uuid.MustParse(fmt.Sprint(runPayload["id"])))
	if chatRun.Params["_engine"] != "v2" || chatRun.Mode != "chat" {
		t.Fatalf("chat v2 run = mode %s params %#v", chatRun.Mode, chatRun.Params)
	}

	// An invalid timezone is dropped rather than failing the request.
	response = env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
		"conversationId": conversation["id"], "prompt": "上周用了多少", "mode": "agent", "engine": "v2",
		"timezone": "Mars/Olympus", "queue": true,
	}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("invalid timezone run: %d %s", response.Code, response.Body.String())
	}
	payload, _ = decode(t, response)
	runPayload, _ = payload["run"].(map[string]any)
	run, _ = store.GetAssistantRun(context.Background(), env.st.Pool, uuid.MustParse(fmt.Sprint(runPayload["id"])))
	if _, ok := run.Params["timezone"]; ok {
		t.Fatalf("invalid timezone should be dropped: %#v", run.Params["timezone"])
	}
}
