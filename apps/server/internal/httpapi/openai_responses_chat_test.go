package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/gorilla/websocket"
)

func TestOpenAIResponsesChatAndStream(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"created":123,"data":[{"b64_json":"image-result"}]}`)
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ni\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hao\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)

	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	chatModelID := "compat-chat"
	cfg, err := modelconfig.Load(ctx, env.st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers[0].BaseURL = upstream.URL
	if len(cfg.Providers[0].Routes) > 0 {
		cfg.Providers[0].Routes[0].BaseURL = upstream.URL
	}
	cfg.Models = append(cfg.Models, modelconfig.Model{
		ID: chatModelID, Name: "compat-chat-name", ProviderID: cfg.Providers[0].ID,
		UpstreamModel: "upstream-chat", Kind: modelconfig.ModelKindChat, PriceCents: 7,
		Enabled: true, Public: true, Default: true,
	})
	cfg.Workspaces[modelconfig.WorkspaceAssistant] = modelconfig.WorkspaceBinding{
		ModelIDs:        []string{chatModelID},
		DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: chatModelID},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_model_ids=$2 WHERE id=$1`,
		env.key.ID, []string{openAIIntegrationModel, chatModelID}); err != nil {
		t.Fatal(err)
	}
	env.key.AllowedModelIDs = []string{openAIIntegrationModel, chatModelID}

	modelsResponse := env.serve(t, env.request(http.MethodGet, "/v1/models", "", "", nil))
	requireOpenAIIntegrationStatus(t, modelsResponse, http.StatusOK, "")
	var catalog struct {
		Data []openAIModelObject `json:"data"`
	}
	if err := json.Unmarshal(modelsResponse.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	foundChat := false
	for _, model := range catalog.Data {
		if model.ID == "compat-chat-name" {
			foundChat = true
		}
	}
	if !foundChat {
		t.Fatalf("chat model missing from catalog: %s", modelsResponse.Body.String())
	}

	syncBody := `{"model":"compat-chat-name","input":"nihao"}`
	syncResponse := env.serve(t, env.request(http.MethodPost, "/v1/responses", "application/json", "chat-sync-1", strings.NewReader(syncBody)))
	requireOpenAIIntegrationStatus(t, syncResponse, http.StatusOK, "")
	var syncPayload map[string]any
	if err := json.Unmarshal(syncResponse.Body.Bytes(), &syncPayload); err != nil {
		t.Fatal(err)
	}
	if syncPayload["object"] != "response" || syncPayload["status"] != "completed" || syncPayload["output_text"] != "nihao" {
		t.Fatalf("chat payload=%#v", syncPayload)
	}
	output, _ := syncPayload["output"].([]any)
	if len(output) != 1 || output[0].(map[string]any)["type"] != "message" {
		t.Fatalf("chat output=%#v", output)
	}

	var balance, frozen int64
	if err := env.st.Pool.QueryRow(ctx, `SELECT balance_cents, frozen_cents FROM wallets WHERE user_id=$1`, env.user.ID).Scan(&balance, &frozen); err != nil {
		t.Fatal(err)
	}
	if balance != 1000-7 || frozen != 0 {
		t.Fatalf("wallet after chat settle balance=%d frozen=%d", balance, frozen)
	}
	var spends int64
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger WHERE user_id=$1 AND kind='spend' AND source_type=$2`,
		env.user.ID, openAPIResponsesChatSourceType).Scan(&spends); err != nil || spends != 1 {
		t.Fatalf("spend rows=%d err=%v", spends, err)
	}

	streamBody := `{"model":"compat-chat-name","input":"nihao","stream":true}`
	streamResponse := env.serve(t, env.request(http.MethodPost, "/v1/responses", "application/json", "chat-stream-1", strings.NewReader(streamBody)))
	if streamResponse.Code != http.StatusOK || !strings.HasPrefix(streamResponse.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream status=%d content-type=%s body=%s", streamResponse.Code, streamResponse.Header().Get("Content-Type"), streamResponse.Body.String())
	}
	body := streamResponse.Body.String()
	for _, event := range []string{
		`"type":"response.created"`,
		`"type":"response.output_text.delta"`,
		`"type":"response.completed"`,
		"data: [DONE]",
	} {
		if !strings.Contains(body, event) {
			t.Fatalf("stream omitted %s: %s", event, body)
		}
	}
	if !strings.Contains(body, `"delta":"ni"`) || !strings.Contains(body, `"output_text":"nihao"`) {
		t.Fatalf("stream deltas/body unexpected: %s", body)
	}
	if err := env.st.Pool.QueryRow(ctx, `SELECT balance_cents, frozen_cents FROM wallets WHERE user_id=$1`, env.user.ID).Scan(&balance, &frozen); err != nil {
		t.Fatal(err)
	}
	if balance != 1000-14 || frozen != 0 {
		t.Fatalf("wallet after stream settle balance=%d frozen=%d", balance, frozen)
	}
}

func TestOpenAIResponsesChatInvokesImageGenerationTool(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"created":123,"data":[{"b64_json":"image-result"}]}`)
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_img\",\"type\":\"function\",\"function\":{\"name\":\"image_generation\",\"arguments\":\"{\\\"prompt\\\":\\\"a blue kitten\\\"}\"}}]}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)

	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	chatModelID := "compat-chat-img"
	cfg, err := modelconfig.Load(ctx, env.st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers[0].BaseURL = upstream.URL
	if len(cfg.Providers[0].Routes) > 0 {
		cfg.Providers[0].Routes[0].BaseURL = upstream.URL
	}
	cfg.Models = append(cfg.Models, modelconfig.Model{
		ID: chatModelID, Name: "compat-chat-img", ProviderID: cfg.Providers[0].ID,
		UpstreamModel: "upstream-chat", Kind: modelconfig.ModelKindChat, PriceCents: 5,
		Enabled: true, Public: true, Default: true,
	})
	cfg.Workspaces[modelconfig.WorkspaceAssistant] = modelconfig.WorkspaceBinding{
		ModelIDs:        []string{chatModelID},
		DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: chatModelID},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_model_ids=$2 WHERE id=$1`,
		env.key.ID, []string{openAIIntegrationModel, chatModelID}); err != nil {
		t.Fatal(err)
	}

	body := `{"model":"compat-chat-img","input":"生成一只蓝猫"}`
	response := env.serve(t, env.request(http.MethodPost, "/v1/responses", "application/json", "chat-img-1", strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	output, _ := payload["output"].([]any)
	foundImage := false
	for _, item := range output {
		row, _ := item.(map[string]any)
		if row["type"] == "image_generation_call" && row["result"] != "" {
			foundImage = true
		}
	}
	if !foundImage {
		t.Fatalf("expected image_generation_call in output=%#v", output)
	}
	env.assertNoLocalImagePersistence(t)
}

func TestOpenAIResponsesChatWebSocketSmoke(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)

	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	cfg, err := modelconfig.Load(ctx, env.st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers[0].BaseURL = upstream.URL
	if len(cfg.Providers[0].Routes) > 0 {
		cfg.Providers[0].Routes[0].BaseURL = upstream.URL
	}
	chatModelID := "compat-chat-ws"
	cfg.Models = append(cfg.Models, modelconfig.Model{
		ID: chatModelID, Name: "compat-chat-ws", ProviderID: cfg.Providers[0].ID,
		UpstreamModel: "upstream-chat", Kind: modelconfig.ModelKindChat, PriceCents: 5,
		Enabled: true, Public: true, Default: true,
	})
	cfg.Workspaces[modelconfig.WorkspaceAssistant] = modelconfig.WorkspaceBinding{
		ModelIDs:        []string{chatModelID},
		DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: chatModelID},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_model_ids=$2 WHERE id=$1`,
		env.key.ID, []string{chatModelID}); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(env.router)
	t.Cleanup(server.Close)
	wsURL := "ws" + server.URL[len("http"):] + "/v1/responses"
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": []string{"Bearer " + env.secret}})
	if err != nil {
		t.Fatalf("websocket handshake failed: %v (response=%v)", err, response)
	}
	defer connection.Close()
	if err := connection.WriteJSON(map[string]any{
		"type": "response.create", "stream_id": "chat-1",
		"model": "compat-chat-ws", "input": "hello",
	}); err != nil {
		t.Fatal(err)
	}
	sawCompleted := false
	for i := 0; i < 12; i++ {
		var payload map[string]any
		if err := connection.ReadJSON(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["stream_id"] != "chat-1" {
			t.Fatalf("payload=%#v", payload)
		}
		if payload["type"] == "response.completed" {
			sawCompleted = true
			break
		}
		if payload["type"] == "error" || payload["error"] != nil {
			t.Fatalf("unexpected error payload=%#v", payload)
		}
	}
	if !sawCompleted {
		t.Fatal("did not receive response.completed over websocket")
	}
}
