package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/decision"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAdminAssistantDecisionSettingsAndStats(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: "https://private.example.com", APIKey: "private-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "chat-main", Name: "Chat Main", ProviderID: "provider", UpstreamModel: "up-main", Kind: modelconfig.ModelKindChat, PriceCents: 5, Public: true, Enabled: true},
		{ID: "chat-fast", Name: "Chat Fast", ProviderID: "provider", UpstreamModel: "up-fast", Kind: modelconfig.ModelKindChat, PriceCents: 2, Public: true, Enabled: true},
		{ID: "chat-hidden", Name: "Chat Hidden", ProviderID: "provider", UpstreamModel: "up-hidden", Kind: modelconfig.ModelKindChat, PriceCents: 2, Public: true, Enabled: true},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {ModelIDs: []string{"chat-main", "chat-fast"}, DefaultModelIDs: map[string]string{"chat": "chat-main"}},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	_, adminToken := env.newUserSession(t, "admin")
	_, userToken := env.newUserSession(t, "user")

	if denied := env.do(t, http.MethodGet, "/api/v1/admin/assistant/decision", nil, userToken); denied.Code == http.StatusOK {
		t.Fatalf("non-admin read the decision settings")
	}

	response := env.do(t, http.MethodGet, "/api/v1/admin/assistant/decision", nil, adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("get: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "private-key") {
		t.Fatal("decision settings leaked a provider key")
	}
	var body struct {
		Data struct {
			Source     string `json:"source"`
			Effective  struct{ ModelID string } `json:"effective"`
			Candidates []struct {
				ID          string `json:"id"`
				PageDefault bool   `json:"pageDefault"`
			} `json:"candidates"`
			OverrideIgnored bool `json:"overrideIgnored"`
		} `json:"data"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &body)
	if body.Data.Source != decision.SourcePageDefault || body.Data.Effective.ModelID != "chat-main" || len(body.Data.Candidates) != 2 || !body.Data.Candidates[0].PageDefault {
		t.Fatalf("defaults = %+v", body.Data)
	}

	// Only assistant-page chat models can be chosen; thresholds stay in range.
	for _, invalid := range []map[string]any{
		{"modelId": "chat-hidden"},
		{"modelId": "chat-fast", "thresholds": map[string]any{"chat-fast": map[string]any{"intent": 1.5, "clarify": 0.5}}},
	} {
		if rejected := env.do(t, http.MethodPut, "/api/v1/admin/assistant/decision", invalid, adminToken); rejected.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid %v accepted: %d %s", invalid, rejected.Code, rejected.Body.String())
		}
	}
	response = env.do(t, http.MethodPut, "/api/v1/admin/assistant/decision", map[string]any{
		"modelId":    "chat-fast",
		"thresholds": map[string]any{"chat-fast": map[string]any{"intent": 0.7, "clarify": 0.8}},
	}, adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("put: %d %s", response.Code, response.Body.String())
	}
	_ = json.Unmarshal(response.Body.Bytes(), &body)
	if body.Data.Source != decision.SourceOverride || body.Data.Effective.ModelID != "chat-fast" {
		t.Fatalf("after save = %+v", body.Data)
	}
	stored, _ := decision.LoadOverride(ctx, env.st.Pool)
	if got := stored.ThresholdsFor("chat-fast"); got.Intent != 0.7 || got.Clarify != 0.8 {
		t.Fatalf("thresholds = %+v", got)
	}

	// Removing the model from the assistant page makes the override fall back
	// to the page default, and the page says so.
	cfg.Workspaces[modelconfig.WorkspaceAssistant] = modelconfig.WorkspaceBinding{ModelIDs: []string{"chat-main"}, DefaultModelIDs: map[string]string{"chat": "chat-main"}}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	response = env.do(t, http.MethodGet, "/api/v1/admin/assistant/decision", nil, adminToken)
	_ = json.Unmarshal(response.Body.Bytes(), &body)
	if !body.Data.OverrideIgnored || body.Data.Effective.ModelID != "chat-main" {
		t.Fatalf("ignored override not surfaced: %+v", body.Data)
	}

	// Stats summarise the decision log.
	user, _ := env.newUserSession(t, "user")
	if _, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "t", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	var runID uuid.UUID
	if err := env.st.Pool.QueryRow(ctx, `WITH c AS (SELECT id FROM assistant_conversations WHERE user_id = $1 LIMIT 1),
		um AS (INSERT INTO assistant_messages (conversation_id, role) SELECT id, 'user' FROM c RETURNING id, conversation_id),
		am AS (INSERT INTO assistant_messages (conversation_id, role) SELECT conversation_id, 'assistant' FROM um RETURNING id)
		INSERT INTO assistant_runs (user_id, conversation_id, user_message_id, assistant_message_id, mode, prompt)
		SELECT $1, um.conversation_id, um.id, am.id, 'chat', 'p' FROM um, am RETURNING id`, user.ID).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []store.AssistantDecisionLog{
		{RunID: runID, UserID: user.ID, Provider: "llm", Model: "chat-fast", Intent: "my_data", RulesIntent: "my_data", Confidence: 0.9, LatencyMs: 300},
		{RunID: runID, UserID: user.ID, Provider: "llm", Model: "chat-fast", Intent: "create", RulesIntent: "answer", Confidence: 0.8, LatencyMs: 500, Delegated: true},
		{RunID: runID, UserID: user.ID, Provider: "rules", Intent: "answer", RulesIntent: "answer", UsedFallback: true},
	} {
		if err := store.InsertAssistantDecisionLog(ctx, env.st.Pool, entry); err != nil {
			t.Fatal(err)
		}
	}
	response = env.do(t, http.MethodGet, "/api/v1/admin/assistant/decision/stats?days=7", nil, adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", response.Code, response.Body.String())
	}
	var statsBody struct {
		Data struct {
			Stats store.AssistantDecisionStats `json:"stats"`
		} `json:"data"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &statsBody)
	stats := statsBody.Data.Stats
	if stats.Total != 3 || stats.ModelAnswered != 2 || stats.RulesOnly != 1 || stats.AgreeWithRules != 1 || stats.Delegated != 1 || stats.UsedFallback != 1 {
		t.Fatalf("stats = %+v", stats)
	}
	if bad := env.do(t, http.MethodGet, "/api/v1/admin/assistant/decision/stats?days=400", nil, adminToken); bad.Code != http.StatusUnprocessableEntity {
		t.Fatalf("days bound not enforced: %d", bad.Code)
	}

	// The free rules evaluation runs the whole built-in set.
	response = env.do(t, http.MethodPost, "/api/v1/admin/assistant/decision/evals", map[string]any{"mode": "rules"}, adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("rules eval: %d %s", response.Code, response.Body.String())
	}
	var evalBody struct {
		Data struct {
			Report struct {
				Total    int     `json:"total"`
				Accuracy float64 `json:"accuracy"`
				Mode     string  `json:"mode"`
			} `json:"report"`
		} `json:"data"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &evalBody)
	if evalBody.Data.Report.Mode != "rules" || evalBody.Data.Report.Total < 40 || evalBody.Data.Report.Accuracy <= 0 {
		t.Fatalf("eval report = %+v", evalBody.Data.Report)
	}
	// A model evaluation needs a decision model with a usable provider; the
	// test provider has a placeholder key so it must be refused, not faked.
	if refused := env.do(t, http.MethodPost, "/api/v1/admin/assistant/decision/evals", map[string]any{"mode": "model", "modelId": "chat-hidden"}, adminToken); refused.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unusable model eval: %d %s", refused.Code, refused.Body.String())
	}
}
