package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestAdminAssistantStatsEvalGradesAnswersOnTheAdminsOwnData(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body struct {
			Messages []struct {
				Role string `json:"role"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "text/event-stream")
		// First step: always look at the account; second step: answer.
		if body.Messages[len(body.Messages)-1].Role == "user" {
			fmt.Fprint(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"my_account_overview","arguments":"{}"}}]}}]}`+"\n\n")
		} else {
			fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"已查到你的账户情况，详见上方卡片。"}}]}`+"\n\n")
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: upstream.URL, APIKey: "private-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "chat-main", Name: "Chat Main", ProviderID: "provider", UpstreamModel: "up-main", Kind: modelconfig.ModelKindChat, PriceCents: 5, Public: true, Enabled: true},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {ModelIDs: []string{"chat-main"}, DefaultModelIDs: map[string]string{"chat": "chat-main"}},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	_, adminToken := env.newUserSession(t, "admin")
	_, userToken := env.newUserSession(t, "user")

	if denied := env.do(t, http.MethodPost, "/api/v1/admin/assistant/stats-evals", map[string]any{}, userToken); denied.Code == http.StatusOK {
		t.Fatal("non-admin ran the statistics evaluation")
	}
	if rejected := env.do(t, http.MethodPost, "/api/v1/admin/assistant/stats-evals", map[string]any{"categories": []string{"不存在"}}, adminToken); rejected.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown category: %d %s", rejected.Code, rejected.Body.String())
	}
	if requests.Load() != 0 {
		t.Fatal("rejected requests reached the model")
	}

	response := env.do(t, http.MethodPost, "/api/v1/admin/assistant/stats-evals", map[string]any{"categories": []string{"账户"}}, adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("eval: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "private-key") {
		t.Fatal("report leaked a provider key")
	}
	var body struct {
		Data struct {
			Report struct {
				ModelID      string  `json:"modelId"`
				Total        int     `json:"total"`
				Passed       int     `json:"passed"`
				ToolRate     float64 `json:"toolRate"`
				GroundedRate float64 `json:"groundedRate"`
				Errors       int     `json:"errors"`
				Failures     []struct {
					ID    string `json:"id"`
					Grade struct {
						Problems []string `json:"problems"`
					} `json:"grade"`
				} `json:"failures"`
			} `json:"report"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	report := body.Data.Report
	// Five account questions are answered by the overview; the three order
	// questions needed my_orders_list.
	if report.ModelID != "chat-main" || report.Total != 8 || report.Passed != 5 || report.ToolRate != 0.625 || report.GroundedRate != 1 || report.Errors != 0 {
		t.Fatalf("report = %+v", report)
	}
	for _, failure := range report.Failures {
		if !strings.HasPrefix(failure.ID, "account-0") || !strings.Contains(strings.Join(failure.Grade.Problems, ""), "my_orders_list") {
			t.Fatalf("unexpected failure %+v", failure)
		}
	}
	if requests.Load() != 16 {
		t.Fatalf("upstream requests = %d, want 2 per case", requests.Load())
	}
}
