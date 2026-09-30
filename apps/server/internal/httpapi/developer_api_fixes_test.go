package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/devapibilling"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func (env *openAIImagesIntegrationEnv) upstreamCallCount() int {
	env.mu.Lock()
	defer env.mu.Unlock()
	return env.upstreamCalls
}

func (env *openAIImagesIntegrationEnv) wallet(t *testing.T) (int64, int64) {
	t.Helper()
	state, err := store.GetWallet(context.Background(), env.st.Pool, env.user.ID)
	if err != nil || state == nil {
		t.Fatalf("wallet=%#v error=%v", state, err)
	}
	return state.BalanceCents, state.FrozenCents
}

func (env *openAIImagesIntegrationEnv) requireWallet(t *testing.T, balance, frozen int64) {
	t.Helper()
	gotBalance, gotFrozen := env.wallet(t)
	if gotBalance != balance || gotFrozen != frozen {
		t.Fatalf("wallet balance=%d frozen=%d; want balance=%d frozen=%d", gotBalance, gotFrozen, balance, frozen)
	}
}

func (env *openAIImagesIntegrationEnv) usageEvents(t *testing.T) int {
	t.Helper()
	var count int
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM api_key_usage_events WHERE api_key_id=$1`, env.key.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func (env *openAIImagesIntegrationEnv) requestStatuses(t *testing.T) []string {
	t.Helper()
	rows, err := env.st.Pool.Query(context.Background(), `SELECT status FROM developer_api_billing_requests WHERE api_key_id=$1 ORDER BY created_at`, env.key.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var statuses []string
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			t.Fatal(err)
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func (env *openAIImagesIntegrationEnv) generate(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return env.serve(t, env.request(http.MethodPost, "/v1/images/generations", "application/json", "", strings.NewReader(body)))
}

// Every request is independent and charged once; the gateway keeps no replay state.
func TestDeveloperAPIImageRequestsAreIndependent(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body := `{"model":"compat-image","prompt":"same prompt twice"}`
	requireOpenAIIntegrationStatus(t, env.generate(t, body), http.StatusOK, "")
	requireOpenAIIntegrationStatus(t, env.generate(t, body), http.StatusOK, "")
	if calls := env.upstreamCallCount(); calls != 2 {
		t.Fatalf("upstream calls = %d, want 2", calls)
	}
	env.assertDirectBilling(t, 2, 40)
	if statuses := env.requestStatuses(t); len(statuses) != 2 || statuses[0] != "succeeded" || statuses[1] != "succeeded" {
		t.Fatalf("request states = %v", statuses)
	}
}

// Failures are final: rejected, erroring and timed-out upstream calls are all
// released, so the caller never pays for a result it did not receive.
func TestDeveloperAPIFailuresReleaseCreditsAndQuota(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	for _, test := range []struct {
		upstream, status int
		code             string
	}{
		{http.StatusBadRequest, http.StatusBadRequest, "upstream_rejected"},
		{http.StatusInternalServerError, http.StatusBadGateway, "upstream_error"},
		{http.StatusGatewayTimeout, http.StatusBadGateway, "upstream_error"},
	} {
		env.setUpstreamStatus(test.upstream)
		requireOpenAIIntegrationStatus(t, env.generate(t, `{"model":"compat-image","prompt":"fails"}`), test.status, test.code)
	}
	env.requireWallet(t, 1000, 0)
	if events := env.usageEvents(t); events != 0 {
		t.Fatalf("failed requests left %d quota events", events)
	}
	for _, status := range env.requestStatuses(t) {
		if status != store.DeveloperAPIRequestFailed {
			t.Fatalf("request states = %v, want all failed", env.requestStatuses(t))
		}
	}
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE user_api_keys SET daily_task_limit=1 WHERE id=$1`, env.key.ID); err != nil {
		t.Fatal(err)
	}
	env.setUpstreamStatus(0)
	requireOpenAIIntegrationStatus(t, env.generate(t, `{"model":"compat-image","prompt":"fits quota"}`), http.StatusOK, "")
}

// An upstream 401/403/404 is our provider configuration, never the caller's Key.
func TestDeveloperAPIUpstreamAuthErrorIsNotPassedThrough(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound} {
		env.setUpstreamStatus(status)
		requireOpenAIIntegrationStatus(t, env.generate(t, `{"model":"compat-image","prompt":"provider credentials"}`), http.StatusBadGateway, "upstream_misconfigured")
	}
	env.requireWallet(t, 1000, 0)
}

// A process that stops mid-request leaves a pending reservation; the reclaim
// job releases it once the request can no longer be running.
func TestDeveloperAPIReclaimReleasesReservationOfStoppedProcess(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	entry := env.apiModel(t, openAIIntegrationModel)
	billing, err := env.srv.reserveDeveloperAPIRequest(ctx, developerAPIReservation{
		SourceType: openAIImageBillingSource, BillingID: newOpenAIImageBillingID(),
		UserID: env.user.ID, KeyID: env.key.ID, ModelID: openAIIntegrationModel, Feature: developerFeature("image"), PriceCents: 20,
		APIModelID: entry.ID, APIModelName: entry.APIName,
	})
	if err != nil {
		t.Fatal(err)
	}
	env.requireWallet(t, 980, 20)
	if reclaimed, err := devapibilling.Reclaim(ctx, env.st, time.Now().UTC(), 100); err != nil || reclaimed != 0 {
		t.Fatalf("reclaimed=%d err=%v while the request may still run", reclaimed, err)
	}
	if reclaimed, err := devapibilling.Reclaim(ctx, env.st, time.Now().UTC().Add(developerAPIPendingTimeout+time.Minute), 100); err != nil || reclaimed != 1 {
		t.Fatalf("reclaimed=%d err=%v after the pending timeout", reclaimed, err)
	}
	env.requireWallet(t, 1000, 0)
	if state, err := store.GetDeveloperAPIRequest(ctx, env.st.Pool, billing.BillingID); err != nil || state == nil || state.Status != store.DeveloperAPIRequestExpired {
		t.Fatalf("state=%#v err=%v", state, err)
	}
}

func TestDeveloperAPIFrozenAndExpiredKeysExplainThemselves(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET status='frozen', freeze_reason='测试冻结' WHERE id=$1`, env.key.ID); err != nil {
		t.Fatal(err)
	}
	frozen := env.serve(t, env.request(http.MethodGet, "/v1/models", "", "", nil))
	requireOpenAIIntegrationStatus(t, frozen, http.StatusForbidden, "api_key_frozen")
	if !strings.Contains(frozen.Body.String(), "测试冻结") {
		t.Fatalf("frozen response omits the reason: %s", frozen.Body.String())
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET status='active', expires_at=now()-interval '1 minute' WHERE id=$1`, env.key.ID); err != nil {
		t.Fatal(err)
	}
	requireOpenAIIntegrationStatus(t, env.serve(t, env.request(http.MethodGet, "/v1/models", "", "", nil)), http.StatusUnauthorized, "api_key_expired")
}

func TestAPIKeyServerErrorAbuseIgnoresUpstreamFailures(t *testing.T) {
	for _, item := range []struct {
		status int
		code   string
		want   bool
	}{
		{http.StatusInternalServerError, "internal_error", true},
		{http.StatusBadGateway, "upstream_error", false},
		{http.StatusGatewayTimeout, "request_timeout", false},
		{http.StatusServiceUnavailable, "upload_scanner_unavailable", false},
		{http.StatusInternalServerError, "upstream_error", false},
		{http.StatusBadRequest, "", false},
	} {
		if got := apiKeyServerErrorCountsAsAbuse(item.status, item.code); got != item.want {
			t.Fatalf("status=%d code=%s counts=%t; want %t", item.status, item.code, got, item.want)
		}
	}
}

type chatUpstream struct {
	mu       sync.Mutex
	bodies   []string
	handler  func(w http.ResponseWriter, r *http.Request)
	chatURL  string
	provider string
}

// withChatModel adds a chat model on its own provider so image requests keep
// going to the image test upstream.
func (env *openAIImagesIntegrationEnv) withChatModel(t *testing.T, priceCents int64, handler func(w http.ResponseWriter, r *http.Request)) *chatUpstream {
	t.Helper()
	upstream := &chatUpstream{handler: handler}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		upstream.mu.Lock()
		upstream.bodies = append(upstream.bodies, string(raw))
		upstream.mu.Unlock()
		r.Body = io.NopCloser(bytes.NewReader(raw))
		upstream.handler(w, r)
	}))
	t.Cleanup(server.Close)
	ctx := context.Background()
	cfg, err := modelconfig.Load(ctx, env.st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers = append(cfg.Providers, modelconfig.Provider{ID: "chat-provider", Name: "Local chat provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: server.URL, APIKey: "test-chat-key", Enabled: true, TimeoutSecs: 10})
	cfg.Models = append(cfg.Models, modelconfig.Model{DeveloperAPI: true,
		ID: "compat-chat", Name: "compat-chat", ProviderID: "chat-provider",
		UpstreamModel: "upstream-chat", Kind: modelconfig.ModelKindChat, PriceCents: priceCents,
		Enabled: true, Public: true, Default: true,
	})
	cfg.Workspaces[modelconfig.WorkspaceAssistant] = modelconfig.WorkspaceBinding{
		ModelIDs:        []string{"compat-chat"},
		DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "compat-chat"},
	}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_model_ids=$2 WHERE id=$1`,
		env.key.ID, []string{openAIIntegrationModel, "compat-chat"}); err != nil {
		t.Fatal(err)
	}
	env.rebuildCatalog(t)
	return upstream
}

func writeChatText(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, "data: {\"model\":\"upstream-chat\",\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", text)
	fmt.Fprint(w, "data: {\"model\":\"upstream-chat\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1}}\n\n")
	fmt.Fprint(w, "data: [DONE]\n\n")
}

func (env *openAIImagesIntegrationEnv) chat(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return env.serve(t, env.request(http.MethodPost, "/v1/chat/completions", "application/json", "", strings.NewReader(body)))
}

// The body reaches the upstream unchanged except for the model name, and the
// upstream model name never reaches the caller.
func TestDeveloperAPIChatIsAPassthrough(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	upstream := env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"chatcmpl-1","object":"chat.completion","model":"upstream-chat","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}`)
	})
	body := `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"lookup","parameters":{"type":"object"}}}],"temperature":0.2}`
	response := env.chat(t, body)
	requireOpenAIIntegrationStatus(t, response, http.StatusOK, "")
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result["model"] != "compat-chat" || strings.Contains(response.Body.String(), "upstream-chat") {
		t.Fatalf("response=%s err=%v", response.Body.String(), err)
	}
	upstream.mu.Lock()
	var sent map[string]any
	_ = json.Unmarshal([]byte(upstream.bodies[0]), &sent)
	upstream.mu.Unlock()
	if sent["model"] != "upstream-chat" || sent["temperature"] != 0.2 || sent["tools"] == nil {
		t.Fatalf("upstream body=%#v", sent)
	}
	env.requireWallet(t, 993, 0)
	var usage string
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT metadata->'usage'->>'total_tokens' FROM usage_profit_ledger WHERE source_type=$1 AND event_status='succeeded' AND revenue_cents=7`,
		store.DeveloperAPIProfitSourceType).Scan(&usage); err != nil || usage != "6" {
		t.Fatalf("recorded usage=%q err=%v", usage, err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE user_api_keys SET daily_task_limit=1 WHERE id=$1`, env.key.ID); err != nil {
		t.Fatal(err)
	}
	requireOpenAIIntegrationStatus(t, env.chat(t, body), http.StatusTooManyRequests, "api_key_daily_limit")
	env.requireWallet(t, 993, 0)
}

func TestDeveloperAPIChatStreamRelaysAndBillsOnCompletion(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) { writeChatText(w, "hello") })
	response := env.chat(t, `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}],"stream":true}`)
	text := response.Body.String()
	if response.Code != http.StatusOK || !strings.Contains(text, `"content":"hello"`) || !strings.Contains(text, `"model":"compat-chat"`) ||
		strings.Contains(text, "upstream-chat") || !strings.Contains(text, "data: [DONE]") {
		t.Fatalf("stream=%s", text)
	}
	env.requireWallet(t, 993, 0)
}

func TestDeveloperAPIChatStreamThatBreaksIsRefunded(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"model\":\"upstream-chat\",\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
	})
	text := env.chat(t, `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}],"stream":true}`).Body.String()
	if !strings.Contains(text, `"content":"partial"`) || !strings.Contains(text, `"code":"upstream_unreachable"`) {
		t.Fatalf("stream=%s", text)
	}
	env.requireWallet(t, 1000, 0)
	if events := env.usageEvents(t); events != 0 {
		t.Fatalf("broken stream left %d quota events", events)
	}
}

func TestDeveloperAPIChatExplainsUpstreamErrorsWithoutProviderURLs(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "secret-provider-detail https://internal.example/v1", http.StatusInternalServerError)
	})
	response := env.chat(t, `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}]}`)
	requireOpenAIIntegrationStatus(t, response, http.StatusBadGateway, "upstream_error")
	if text := response.Body.String(); !strings.Contains(text, "HTTP 500") || !strings.Contains(text, "secret-provider-detail") || strings.Contains(text, "internal.example") {
		t.Fatalf("body=%s", text)
	}
	env.requireWallet(t, 1000, 0)

	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"error\":{\"message\":\"context length exceeded\"}}\n\n")
	})
	text := env.chat(t, `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}],"stream":true}`).Body.String()
	if !strings.Contains(text, "context length exceeded") || !strings.Contains(text, `"code":"upstream_error"`) {
		t.Fatalf("stream=%s", text)
	}
	env.requireWallet(t, 1000, 0)
}

func TestDeveloperAPIChatRejectsUnknownModelsAndBadBodies(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	upstream := env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) { writeChatText(w, "hello") })
	requireOpenAIIntegrationStatus(t, env.chat(t, `{"model":"gpt-4o","messages":[]}`), http.StatusNotFound, "model_not_found")
	requireOpenAIIntegrationStatus(t, env.chat(t, `{"model":"compat-chat"}`), http.StatusBadRequest, "invalid_parameter")
	requireOpenAIIntegrationStatus(t, env.chat(t, `[1,2]`), http.StatusBadRequest, "invalid_parameter")
	upstream.mu.Lock()
	defer upstream.mu.Unlock()
	if len(upstream.bodies) != 0 {
		t.Fatal("a rejected request reached the upstream")
	}
}

// serveAndDisconnect sends the request, then drops the caller once ready
// fires (or after a moment when ready is nil), and waits for the handler.
func (env *openAIImagesIntegrationEnv) serveAndDisconnect(t *testing.T, request *http.Request, ready <-chan struct{}) {
	t.Helper()
	env.serveAndDisconnectTo(t, httptest.NewRecorder(), request, ready)
}

func (env *openAIImagesIntegrationEnv) serveAndDisconnectTo(t *testing.T, recorder http.ResponseWriter, request *http.Request, ready <-chan struct{}) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		env.router.ServeHTTP(recorder, request.WithContext(ctx))
	}()
	if ready != nil {
		select {
		case <-ready:
		case <-time.After(5 * time.Second):
			t.Fatal("the upstream was never called")
		}
	} else {
		time.Sleep(100 * time.Millisecond)
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not return after the caller disconnected")
	}
}

func (env *openAIImagesIntegrationEnv) chatStatus(t *testing.T) (status, note string) {
	t.Helper()
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT r.status, COALESCE(p.metadata->>'note','')
		FROM developer_api_billing_requests r LEFT JOIN usage_profit_ledger p ON p.source_id=r.billing_id
		WHERE r.source_type=$1`, openAIChatSourceType).Scan(&status, &note); err != nil {
		t.Fatal(err)
	}
	return status, note
}

func chatStreamRequest(env *openAIImagesIntegrationEnv) *http.Request {
	return env.request(http.MethodPost, "/v1/chat/completions", "application/json", "",
		strings.NewReader(`{"model":"compat-chat","messages":[{"role":"user","content":"hi"}],"stream":true}`))
}

// receivedRecorder signals once the body written to the caller contains marker.
type receivedRecorder struct {
	*httptest.ResponseRecorder
	marker   string
	received chan struct{}
	once     sync.Once
}

func newReceivedRecorder(marker string) *receivedRecorder {
	return &receivedRecorder{ResponseRecorder: httptest.NewRecorder(), marker: marker, received: make(chan struct{})}
}

func (r *receivedRecorder) Write(data []byte) (int, error) {
	n, err := r.ResponseRecorder.Write(data)
	if strings.Contains(r.Body.String(), r.marker) {
		r.once.Do(func() { close(r.received) })
	}
	return n, err
}

func (r *receivedRecorder) WriteString(data string) (int, error) { return r.Write([]byte(data)) }

// Content already delivered is paid for, even if the caller leaves before the end.
func TestDeveloperAPIChatDisconnectAfterContentIsCharged(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	env.withChatModel(t, 7, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	recorder := newReceivedRecorder("partial")
	env.serveAndDisconnectTo(t, recorder, chatStreamRequest(env), recorder.received)
	env.requireWallet(t, 993, 0)
	if status, note := env.chatStatus(t); status != store.DeveloperAPIRequestSucceeded || note != "client_disconnected" {
		t.Fatalf("status=%q note=%q", status, note)
	}
}

// A stream that has not delivered any answer yet is refunded when the caller leaves.
func TestDeveloperAPIChatDisconnectBeforeContentIsRefunded(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	started := make(chan struct{}, 1)
	env.withChatModel(t, 7, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n")
		w.(http.Flusher).Flush()
		started <- struct{}{}
		<-r.Context().Done()
	})
	env.serveAndDisconnect(t, chatStreamRequest(env), started)
	env.requireWallet(t, 1000, 0)
	if events := env.usageEvents(t); events != 0 {
		t.Fatalf("refunded stream left %d quota events", events)
	}
	if status, _ := env.chatStatus(t); status != store.DeveloperAPIRequestFailed {
		t.Fatalf("status=%q", status)
	}
}

// A non-streamed answer is finished and charged even if the caller leaves while waiting.
func TestDeveloperAPIChatNonStreamDisconnectIsChargedOnceAnswered(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"model":"upstream-chat","choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}`)
	})
	env.serveAndDisconnect(t, env.request(http.MethodPost, "/v1/chat/completions", "application/json", "",
		strings.NewReader(`{"model":"compat-chat","messages":[{"role":"user","content":"hi"}]}`)), nil)
	env.requireWallet(t, 993, 0)
	if status, note := env.chatStatus(t); status != store.DeveloperAPIRequestSucceeded || note != "client_disconnected" {
		t.Fatalf("status=%q note=%q", status, note)
	}
}

// An image the upstream produced is charged even if the caller stopped waiting;
// only an upstream or platform failure is released.
func TestDeveloperAPIImageDisconnectIsChargedOnceProduced(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	env.mu.Lock()
	env.upstreamDelay = 300 * time.Millisecond
	env.mu.Unlock()
	env.serveAndDisconnect(t, env.request(http.MethodPost, "/v1/images/generations", "application/json", "",
		strings.NewReader(`{"model":"compat-image","prompt":"left early"}`)), nil)
	if calls := env.upstreamCallCount(); calls != 1 {
		t.Fatalf("upstream calls = %d", calls)
	}
	env.requireWallet(t, 980, 0)
	var status, note string
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT r.status, COALESCE(p.metadata->>'note','')
		FROM developer_api_billing_requests r LEFT JOIN usage_profit_ledger p ON p.source_id=r.billing_id
		WHERE r.source_type<>$1`, openAIChatSourceType).Scan(&status, &note); err != nil {
		t.Fatal(err)
	}
	if status != store.DeveloperAPIRequestSucceeded || note != "client_disconnected" {
		t.Fatalf("image request status=%q note=%q, want succeeded/client_disconnected", status, note)
	}

	env.setUpstreamStatus(http.StatusInternalServerError)
	env.serveAndDisconnect(t, env.request(http.MethodPost, "/v1/images/generations", "application/json", "",
		strings.NewReader(`{"model":"compat-image","prompt":"left early, upstream failed"}`)), nil)
	env.requireWallet(t, 980, 0)
}

func TestDeveloperAPIReclaimReleasesStuckChatReservation(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	userID, keyID := env.user.ID, env.key.ID
	billingID := "chatcmpl-bill-stuck"
	if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, userID, 7, "ai_assistant", openAIChatSourceType, billingID, nil); err != nil {
			return err
		}
		return store.InsertDeveloperAPIRequest(ctx, tx, store.DeveloperAPIRequest{
			BillingID: billingID, SourceType: openAIChatSourceType, UserID: &userID, APIKeyID: &keyID,
			PriceCents: 7, Status: store.DeveloperAPIRequestPending, ExpiresAt: time.Now().Add(-time.Minute),
		})
	}); err != nil {
		t.Fatal(err)
	}
	env.requireWallet(t, 993, 7)
	if reclaimed, err := devapibilling.Reclaim(ctx, env.st, time.Now().UTC(), 100); err != nil || reclaimed != 1 {
		t.Fatalf("reclaimed=%d err=%v", reclaimed, err)
	}
	env.requireWallet(t, 1000, 0)
}

// /v1 charges are listed in the developer console, not in the wallet history.
func TestDeveloperAPICallsShowInConsoleNotWallet(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	calls := 0
	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls > 1 {
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprint(w, `{"error":{"message":"boom"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}`)
	})
	body := `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}]}`
	requireOpenAIIntegrationStatus(t, env.chat(t, body), http.StatusOK, "")
	env.chat(t, body)
	env.requireWallet(t, 993, 0)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/me/api-calls?page=1&key="+env.key.ID.String(), nil)
	c.Set(ctxOpenAPIUser, env.user)
	env.srv.myDeveloperAPICalls(c)
	var page struct {
		Data struct {
			Items []map[string]any `json:"items"`
			Total int              `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil || recorder.Code != http.StatusOK || page.Data.Total != 2 || len(page.Data.Items) != 2 {
		t.Fatalf("calls=%d %s", recorder.Code, recorder.Body.String())
	}
	refunded, charged := page.Data.Items[0], page.Data.Items[1]
	if refunded["status"] != "refunded" || refunded["chargedCents"] != float64(0) || refunded["reason"] == "" {
		t.Fatalf("refunded=%v", refunded)
	}
	tokens, _ := charged["tokens"].(map[string]any)
	key, _ := charged["key"].(map[string]any)
	if charged["status"] != "charged" || charged["chargedCents"] != float64(7) || charged["model"] != "compat-chat" ||
		charged["kind"] != "chat" || tokens["total"] != float64(6) || key["label"] != env.key.Label {
		t.Fatalf("charged=%v", charged)
	}
	if strings.Contains(recorder.Body.String(), env.key.ID.String()) {
		t.Fatalf("call records expose internal ids: %s", recorder.Body.String())
	}

	entries, err := store.ListUserWalletLedger(context.Background(), env.st.Pool, env.user.ID, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.SourceType == openAIChatSourceType {
			t.Fatalf("wallet history lists a developer API entry: %+v", entry)
		}
	}
	all, err := store.ListLedger(context.Background(), env.st.Pool, env.user.ID, 50, nil)
	if err != nil || len(all) <= len(entries) {
		t.Fatalf("admin ledger should still include API entries: all=%d wallet=%d err=%v", len(all), len(entries), err)
	}
}

// The admin page lists every /v1 request with its revenue, cost and reason.
func TestAdminDeveloperAPIPageListsCallsAndTotals(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	calls := 0
	env.withChatModel(t, 7, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls > 1 {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"content policy"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}`)
	})
	body := `{"model":"compat-chat","messages":[{"role":"user","content":"hi"}]}`
	requireOpenAIIntegrationStatus(t, env.chat(t, body), http.StatusOK, "")
	env.chat(t, body)

	get := func(handler func(*gin.Context, *store.User), target string) map[string]any {
		t.Helper()
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, target, nil)
		handler(c, nil)
		var payload struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || recorder.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", target, recorder.Code, recorder.Body.String())
		}
		return payload.Data
	}
	summary := get(env.srv.adminDeveloperAPISummary, "/api/v1/admin/developer-api/summary?kind=chat")
	if summary["calls"] != float64(2) || summary["charged"] != float64(1) || summary["refunded"] != float64(1) || summary["revenueCents"] != float64(7) {
		t.Fatalf("summary=%v", summary)
	}
	models, _ := summary["models"].([]any)
	if len(models) != 1 || models[0].(map[string]any)["model"] != "compat-chat" {
		t.Fatalf("models=%v", summary["models"])
	}

	page := get(env.srv.adminDeveloperAPICalls, "/api/v1/admin/developer-api/calls?status=refunded&user="+env.user.Email)
	items, _ := page["items"].([]any)
	if page["total"] != float64(1) || len(items) != 1 {
		t.Fatalf("refunded page=%v", page)
	}
	refunded := items[0].(map[string]any)
	if refunded["errorCode"] != "upstream_rejected" || refunded["reason"] == "" || refunded["billingId"] == "" ||
		refunded["user"].(map[string]any)["email"] != env.user.Email {
		t.Fatalf("refunded=%v", refunded)
	}
	charged := get(env.srv.adminDeveloperAPICalls, "/api/v1/admin/developer-api/calls?status=charged&limit=1")
	row := charged["items"].([]any)[0].(map[string]any)
	if row["chargedCents"] != float64(7) || row["tokens"].(map[string]any)["total"] != float64(6) || charged["nextCursor"] != nil {
		t.Fatalf("charged=%v", charged)
	}
	if get(env.srv.adminDeveloperAPICalls, "/api/v1/admin/developer-api/calls?kind=image")["total"] != float64(0) {
		t.Fatal("kind filter ignored")
	}
}

func TestDeveloperAPIKeyCanBePausedAndResumedByItsOwner(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, env.st.Pool, env.user.ID, auth.HashToken(token), time.Now().Add(30*24*time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	manage := func(action string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/me/api-keys/"+env.key.ID.String()+"/"+action, nil)
		request.AddCookie(&http.Cookie{Name: env.srv.Cfg.SessionCookieName, Value: token})
		recorder := httptest.NewRecorder()
		env.router.ServeHTTP(recorder, request)
		return recorder
	}
	if response := manage("pause"); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"paused"`) {
		t.Fatalf("pause = %d %s", response.Code, response.Body.String())
	}
	requireOpenAIIntegrationStatus(t, env.serve(t, env.request(http.MethodGet, "/v1/models", "", "", nil)), http.StatusForbidden, "api_key_paused")
	if response := manage("pause"); response.Code != http.StatusConflict {
		t.Fatalf("pausing a paused Key = %d %s", response.Code, response.Body.String())
	}
	if response := manage("resume"); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"active"`) {
		t.Fatalf("resume = %d %s", response.Code, response.Body.String())
	}
	if response := env.serve(t, env.request(http.MethodGet, "/v1/models", "", "", nil)); response.Code != http.StatusOK {
		t.Fatalf("resumed Key /v1/models = %d %s", response.Code, response.Body.String())
	}
	// A frozen Key stays with the admin: the owner can neither pause nor resume it.
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET status='frozen' WHERE id=$1`, env.key.ID); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"pause", "resume"} {
		if response := manage(action); response.Code != http.StatusConflict {
			t.Fatalf("%s on a frozen Key = %d %s", action, response.Code, response.Body.String())
		}
	}
}
