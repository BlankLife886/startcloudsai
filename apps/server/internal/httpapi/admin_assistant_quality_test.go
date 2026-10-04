package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmodel"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// qualityTurn inserts one v2 turn (user message, reply, run) and returns the
// reply's id.
func qualityTurn(t *testing.T, env *communityEnv, userID, conversationID uuid.UUID, mode, prompt, kind, reply string, metadata map[string]any, at time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversationID, Role: "user", Content: prompt, Kind: "chat", Status: "complete", CreatedAt: at.Add(-time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["_chatModel"] = "gpt-test"
	metadata["systemPromptVersion"] = "assistant-v2-3"
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversationID, Role: "assistant", Content: reply, Kind: kind, Status: "complete",
		Metadata: metadata, CreatedAt: at,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: userID, ConversationID: conversationID, UserMessageID: userMessage.ID,
		AssistantMessageID: assistantMessage.ID, Mode: mode, Prompt: prompt,
		Params: map[string]any{"_engine": "v2"},
	}); err != nil {
		t.Fatal(err)
	}
	return assistantMessage.ID
}

func TestValidateAssistantCorrectionFixesTheMode(t *testing.T) {
	id := uuid.NewString()
	for _, item := range []struct {
		action, mode string
		v2, ok       bool
	}{
		{"just_asking", "chat", true, true},
		{"just_asking", "agent", true, false}, // 只是问问 always runs in 问答 so it cannot draw
		{"draw_it", "agent", true, true},
		{"draw_it", "chat", true, false},
		{"search_web", "chat", true, true},
		{"search_web", "agent", true, true},
		{"search_web", "image", true, false},
		{"search_web", "chat", false, false},
		{"bogus", "chat", true, false},
	} {
		err := validateAssistantCorrection(&assistantCorrectionIn{MessageID: id, Action: item.action}, item.mode, item.v2)
		if (err == nil) != item.ok {
			t.Errorf("%s in %s (v2=%v): err = %v", item.action, item.mode, item.v2, err)
		}
	}
	if err := validateAssistantCorrection(&assistantCorrectionIn{MessageID: "x", Action: "search_web"}, "chat", true); err == nil {
		t.Error("a bad message id was accepted")
	}
}

func TestAssistantQualityFromUserBehaviour(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: "https://private.example.com", APIKey: "private-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "chat-main", Name: "Chat Main", ProviderID: "provider", UpstreamModel: "up-main", Kind: modelconfig.ModelKindChat, PriceCents: 5, Public: true, Enabled: true},
		{ID: "chat-off", Name: "Chat Off", ProviderID: "provider", UpstreamModel: "up-off", Kind: modelconfig.ModelKindChat, PriceCents: 2, Public: true, Enabled: false},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {ModelIDs: []string{"chat-main"}, DefaultModelIDs: map[string]string{"chat": "chat-main"}},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	_, adminToken := env.newUserSession(t, "admin")
	customer, userToken := env.newUserSession(t, "user")
	var conversationID uuid.UUID
	if err := env.st.Pool.QueryRow(ctx, `INSERT INTO assistant_conversations (user_id) VALUES ($1) RETURNING id`, customer.ID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	server := &Server{St: env.st, Cfg: env.cfg}
	now := time.Now().UTC()
	proposal := qualityTurn(t, env, customer.ID, conversationID, "agent", "你可以做图吗", "proposal", "方案已准备",
		map[string]any{"proposal": map[string]any{"prompt": "你可以做图吗"}, "toolSteps": []any{map[string]any{"name": "propose_image_action"}}}, now.Add(-2*time.Hour))
	executed := qualityTurn(t, env, customer.ID, conversationID, "agent", "画一只猫", "proposal", "方案已准备",
		map[string]any{"proposal": map[string]any{"prompt": "一只猫"}}, now.Add(-90*time.Minute))
	agentText := qualityTurn(t, env, customer.ID, conversationID, "agent", "给我一张海报", "chat", "海报可以这样设计……", nil, now.Add(-time.Hour))
	chatText := qualityTurn(t, env, customer.ID, conversationID, "chat", "画只狗", "chat", "问答模式不能出图，切到 Agent 模式就可以。", nil, now.Add(-50*time.Minute))
	latest := qualityTurn(t, env, customer.ID, conversationID, "agent", "今天金价", "chat", "大约 500 元", nil, now.Add(-40*time.Minute))

	correct := func(messageID uuid.UUID, action string) {
		server.recordAssistantTurnSignals(ctx, assistantRunIn{Prompt: "（纠正）", Correction: &assistantCorrectionIn{MessageID: messageID.String(), Action: action}},
			conversationID, uuid.New())
	}
	correct(proposal, "just_asking") // a real mistake: becomes a case
	correct(chatText, "draw_it")     // 问答 cannot draw: a mode switch, not a mistake
	correct(agentText, "draw_it")    // a real mistake
	server.recordAssistantTurnSignals(ctx, assistantRunIn{Prompt: "执行这个创作方案", ProposalSourceMessageID: executed.String()}, conversationID, uuid.New())
	server.recordAssistantTurnSignals(ctx, assistantRunIn{Prompt: "不对，我问的是黄金的价格"}, conversationID, uuid.New())
	server.recordAssistantTurnEventLater(ctx, latest, "negative_feedback")

	cases, err := store.ListAssistantAgentCases(ctx, env.st.Pool, false)
	if err != nil {
		t.Fatal(err)
	}
	byPrompt := map[string]store.AssistantAgentCase{}
	for _, item := range cases {
		byPrompt[item.Prompt] = item
	}
	if len(cases) != 2 || strings.Join(byPrompt["你可以做图吗"].Expected, ",") != "answer" || strings.Join(byPrompt["给我一张海报"].Expected, ",") != "image" {
		t.Fatalf("cases = %+v", cases)
	}
	var contextMessages []map[string]string
	_ = json.Unmarshal(byPrompt["给我一张海报"].Context, &contextMessages)
	if len(contextMessages) == 0 || contextMessages[0]["content"] != "你可以做图吗" {
		t.Fatalf("case context = %s", byPrompt["给我一张海报"].Context)
	}
	// Correcting the same sentence again keeps one case.
	correct(proposal, "just_asking")
	if again, _ := store.ListAssistantAgentCases(ctx, env.st.Pool, false); len(again) != 2 {
		t.Fatalf("duplicate case: %d", len(again))
	}

	if denied := env.do(t, http.MethodGet, "/api/v1/admin/assistant/quality?days=7", nil, userToken); denied.Code == http.StatusOK {
		t.Fatal("non-admin read assistant quality")
	}
	response := env.do(t, http.MethodGet, "/api/v1/admin/assistant/quality?days=7", nil, adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("quality: %d %s", response.Code, response.Body.String())
	}
	var quality struct {
		Data struct {
			Groups      []store.AssistantQualityGroup      `json:"groups"`
			Days        []store.AssistantQualityDay        `json:"days"`
			Corrections []store.AssistantCorrectionSummary `json:"corrections"`
		} `json:"data"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &quality)
	var agent, chat store.AssistantQualityGroup
	for _, group := range quality.Data.Groups {
		if group.Mode == "agent" {
			agent = group
		} else {
			chat = group
		}
	}
	if agent.Turns != 4 || agent.Proposals != 2 || agent.ProposalsRun != 1 || agent.ProposalsUnused != 1 || agent.JustAsking != 1 ||
		agent.DrawIt != 1 || agent.CorrectedInText != 1 || agent.NegativeFeedback != 1 || agent.Model != "gpt-test" || agent.PromptVersion != "assistant-v2-3" {
		t.Fatalf("agent group = %+v", agent)
	}
	if chat.Turns != 1 || chat.DrawIt != 1 {
		t.Fatalf("chat group = %+v", chat)
	}
	if len(quality.Data.Days) == 0 {
		t.Fatal("no daily trend")
	}
	counts := map[string]int64{}
	for _, summary := range quality.Data.Corrections {
		counts[summary.Event] = summary.Count
		if len(summary.Examples) == 0 || summary.Examples[0].Prompt == "" {
			t.Fatalf("summary without examples: %+v", summary)
		}
	}
	if counts["correction_just_asking"] != 1 || counts["correction_draw_it"] != 2 || counts["corrected_in_text"] != 1 {
		t.Fatalf("correction summaries = %+v", quality.Data.Corrections)
	}

	response = env.do(t, http.MethodGet, "/api/v1/admin/assistant/quality/cases", nil, adminToken)
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "private-key") {
		t.Fatalf("cases: %d", response.Code)
	}
	var listed struct {
		Data struct {
			Builtin []struct{ ID string }               `json:"builtin"`
			Stored  []struct{ ID, Mode, Source string } `json:"stored"`
			Models  []assistantmodel.Candidate          `json:"models"`
		} `json:"data"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &listed)
	if len(listed.Data.Builtin) < 50 || len(listed.Data.Stored) != 2 || listed.Data.Stored[0].Source != "user" {
		t.Fatalf("listed = %d builtin, stored %+v", len(listed.Data.Builtin), listed.Data.Stored)
	}
	if models := listed.Data.Models; len(models) != 2 || models[0].ID != "chat-main" || !models[0].PageDefault || models[1].Available {
		t.Fatalf("models = %+v", models)
	}
	caseID := listed.Data.Stored[0].ID
	if patched := env.do(t, http.MethodPatch, "/api/v1/admin/assistant/quality/cases/"+caseID, map[string]any{"active": false}, adminToken); patched.Code != http.StatusOK {
		t.Fatalf("pause: %d %s", patched.Code, patched.Body.String())
	}
	if active, _ := store.ListAssistantAgentCases(ctx, env.st.Pool, true); len(active) != 1 {
		t.Fatalf("active after pause = %d", len(active))
	}
	if deleted := env.do(t, http.MethodDelete, "/api/v1/admin/assistant/quality/cases/"+caseID, nil, adminToken); deleted.Code != http.StatusOK {
		t.Fatalf("delete: %d", deleted.Code)
	}

	// Evaluating or comparing with a disabled model is refused rather than
	// silently running another one.
	for _, path := range []string{"/api/v1/admin/assistant/quality/evals", "/api/v1/admin/assistant/quality/compare"} {
		if refused := env.do(t, http.MethodPost, path, map[string]any{"modelId": "chat-off"}, adminToken); refused.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s with a disabled model: %d %s", path, refused.Code, refused.Body.String())
		}
	}
}
