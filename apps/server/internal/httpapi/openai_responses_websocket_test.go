package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/gorilla/websocket"
)

func TestOpenAIResponsesWebSocketHandshakeAndJSONValidation(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	server := httptest.NewServer(env.router)
	t.Cleanup(server.Close)
	wsURL := "ws" + server.URL[len("http"):] + "/v1/responses"
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": []string{"Bearer " + env.secret}})
	if err != nil {
		t.Fatalf("websocket handshake failed: %v (response=%v)", err, response)
	}
	defer connection.Close()
	if err := connection.WriteJSON(map[string]any{"invalid": true}); err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := connection.ReadJSON(&payload); err != nil {
		t.Fatal(err)
	}
	if payload["error"] == nil {
		t.Fatalf("payload=%#v", payload)
	}
}

func TestNormalizeOpenAIResponsesWebSocketRequest(t *testing.T) {
	request, streamID, err := normalizeOpenAIResponsesWebSocketRequest([]byte(`{"type":"response.create","stream_id":"turn-1","model":"img","input":"sky","tools":[{"type":"image_generation"}]}`))
	if err != nil || streamID != "turn-1" {
		t.Fatalf("request=%s stream_id=%q error=%v", request, streamID, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(request, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["type"] != nil || payload["stream_id"] != nil || payload["stream"] != true {
		t.Fatalf("normalized payload=%#v", payload)
	}
	if _, _, err := normalizeOpenAIResponsesWebSocketRequest([]byte(`{"type":"response.inject","input":"bad"}`)); err == nil {
		t.Fatal("unsupported client event should fail")
	}
}

func TestSelectOpenAIResponsesImageToolIgnoresOtherCodexTools(t *testing.T) {
	tool, found, err := selectOpenAIResponsesImageTool([]json.RawMessage{
		json.RawMessage(`{"type":"function","name":"shell"}`),
		json.RawMessage(`{"type":"image_generation","quality":"high"}`),
		json.RawMessage(`{"type":"computer_use_preview"}`),
	})
	if err != nil || !found || tool.Type != "image_generation" || tool.Quality != "high" {
		t.Fatalf("tool=%#v found=%v error=%v", tool, found, err)
	}
}

func TestSelectOpenAIResponsesImageToolMissingRoutesToChat(t *testing.T) {
	tool, found, err := selectOpenAIResponsesImageTool(nil)
	if err != nil || found || tool.Type != "" {
		t.Fatalf("empty tools: tool=%#v found=%v error=%v", tool, found, err)
	}
	tool, found, err = selectOpenAIResponsesImageTool([]json.RawMessage{
		json.RawMessage(`{"type":"function","name":"shell"}`),
	})
	if err != nil || found {
		t.Fatalf("non-image tools: tool=%#v found=%v error=%v", tool, found, err)
	}
}

func TestDecodeOpenAIResponsesRequestAllowsEmptyTools(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"chat","input":"nihao"}`))
	decoded, err := decodeOpenAIResponsesRequest(request)
	if err != nil || decoded.Model != "chat" {
		t.Fatalf("decoded=%#v error=%v", decoded, err)
	}
	request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"input":"x","previous_response_id":"resp_1"}`))
	if _, err := decodeOpenAIResponsesRequest(request); err == nil {
		t.Fatal("expected previous_response_id rejection")
	}
}

func TestParseOpenAIResponsesImageToolCall(t *testing.T) {
	prompt, tool, err := parseOpenAIResponsesImageToolCall(`{"prompt":"a cat","quality":"high"}`, nil, openAIResponsesImageTool{})
	if err != nil || prompt != "a cat" || tool.Quality != "high" {
		t.Fatalf("prompt=%q tool=%#v err=%v", prompt, tool, err)
	}
	prompt, _, err = parseOpenAIResponsesImageToolCall(`{}`, []sub2api.Message{{Role: "user", Content: "画一只猫"}}, openAIResponsesImageTool{})
	if err != nil || prompt != "画一只猫" {
		t.Fatalf("fallback prompt=%q err=%v", prompt, err)
	}
}
