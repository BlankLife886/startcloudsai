package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const openAIIntegrationModel = "compat-image"

type openAIIntegrationObject struct {
	data        []byte
	contentType string
}

type openAIImagesIntegrationEnv struct {
	st                     *store.Store
	srv                    *Server
	router                 *gin.Engine
	user                   *store.User
	key                    *store.UserAPIKey
	secret                 string
	storage                *httptest.Server
	upstream               *httptest.Server
	upstreamCalls          int
	upstreamPaths          []string
	upstreamInternalFields bool
	upstreamStatus         int
	mu                     sync.Mutex
	objects                map[string]openAIIntegrationObject
}

func newOpenAIImagesIntegrationEnv(t *testing.T) *openAIImagesIntegrationEnv {
	t.Helper()
	ctx := context.Background()
	st := testdb.Setup(t)
	env := &openAIImagesIntegrationEnv{st: st, objects: make(map[string]openAIIntegrationObject)}
	env.storage = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		key := strings.TrimPrefix(request.URL.Path, "/test-objects/")
		if key == request.URL.Path {
			http.NotFound(w, request)
			return
		}
		switch request.Method {
		case http.MethodPut:
			data, err := io.ReadAll(request.Body)
			if err != nil {
				http.Error(w, "failed to read test object", http.StatusBadRequest)
				return
			}
			env.mu.Lock()
			env.objects[key] = openAIIntegrationObject{data: data, contentType: request.Header.Get("Content-Type")}
			env.mu.Unlock()
			w.Header().Set("ETag", `"local-test-object"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodGet, http.MethodHead:
			env.mu.Lock()
			object, exists := env.objects[key]
			env.mu.Unlock()
			if !exists {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, "<Error><Code>NoSuchKey</Code></Error>")
				return
			}
			w.Header().Set("Content-Type", object.contentType)
			w.Header().Set("Content-Length", strconv.Itoa(len(object.data)))
			if request.Method == http.MethodGet {
				_, _ = w.Write(object.data)
			}
		case http.MethodDelete:
			env.mu.Lock()
			delete(env.objects, key)
			env.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(env.storage.Close)
	upstreamImage := base64.StdEncoding.EncodeToString(uploadTestPNG(t))
	env.upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		env.mu.Lock()
		env.upstreamCalls++
		env.upstreamPaths = append(env.upstreamPaths, request.URL.Path)
		upstreamStatus := env.upstreamStatus
		env.mu.Unlock()
		if upstreamStatus != 0 {
			http.Error(w, "simulated upstream error", upstreamStatus)
			return
		}
		writeResult := func(responseFormat string) {
			w.Header().Set("Content-Type", "application/json")
			if responseFormat == "url" {
				_, _ = fmt.Fprintf(w, `{"created":123,"data":[{"url":"http://%s/generated.png"}]}`, request.Host)
				return
			}
			_, _ = fmt.Fprintf(w, `{"created":123,"data":[{"b64_json":%q}]}`, upstreamImage)
		}
		switch request.URL.Path {
		case "/v1/images/generations":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			if _, exists := payload["client_task_id"]; exists {
				env.mu.Lock()
				env.upstreamInternalFields = true
				env.mu.Unlock()
			}
			if _, exists := payload["history_disabled"]; exists {
				env.mu.Lock()
				env.upstreamInternalFields = true
				env.mu.Unlock()
			}
			format, _ := payload["response_format"].(string)
			writeResult(format)
		case "/v1/images/edits":
			if err := request.ParseMultipartForm(32 << 20); err != nil {
				http.Error(w, "invalid multipart", http.StatusBadRequest)
				return
			}
			if request.FormValue("client_task_id") != "" || request.FormValue("history_disabled") != "" {
				env.mu.Lock()
				env.upstreamInternalFields = true
				env.mu.Unlock()
			}
			if len(request.MultipartForm.File["image"]) == 0 && len(request.MultipartForm.File["image[]"]) == 0 {
				http.Error(w, "missing image", http.StatusBadRequest)
				return
			}
			writeResult(request.FormValue("response_format"))
		default:
			http.NotFound(w, request)
		}
	}))
	t.Cleanup(env.upstream.Close)
	// All credentials and endpoints are synthetic and local. Do not load .env or
	// attach this fixture to a real queue/worker/provider.
	cfg := &config.Config{
		AppEnv: "development", AppSecret: "local-test-app-secret-32-characters", SessionCookieName: "compat-test-session",
		UploadMaxBytes: 15 << 20, ObjectStorageEndpoint: env.storage.URL,
		ObjectStorageAccessKeyID: "test-access", ObjectStorageSecretAccessKey: "test-secret",
		ObjectStorageBucket: "test-objects", ObjectStorageRegion: "auto",
		ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 3600,
	}
	objects, err := storage.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	env.srv = &Server{Cfg: cfg, St: st, Storage: objects}
	controls, _ := json.Marshal(map[string]settings.PageControl{"developer_api": {Status: settings.PageStatusNormal}})
	if err := settings.Set(ctx, st.Pool, "page_controls", controls); err != nil {
		t.Fatal(err)
	}
	provider := modelconfig.Provider{ID: "compat-provider", Name: "Local test provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: env.upstream.URL, APIKey: "test-upstream-key", Enabled: true, TimeoutSecs: 10}
	imageModel := modelconfig.Model{ID: openAIIntegrationModel, Name: openAIIntegrationModel, ProviderID: provider.ID,
		UpstreamModel: "test-upstream-image", Kind: modelconfig.ModelKindImage, PriceCents: 20,
		Enabled: true, Public: true, Default: true, MaxImages: 4, MaxReferenceImages: 6,
		Resolutions: []string{"1K"}, AspectRatios: []string{"1:1"}, Qualities: []string{"low", "medium", "high"},
		OutputFormats: []string{"png", "jpeg", "webp"}, ModerationLevels: []string{"auto", "low"}}
	other := imageModel
	other.ID, other.Name, other.Default = "compat-other", "compat-other", false
	private := other
	private.ID, private.Name, private.Public = "compat-private", "compat-private", false
	maintenance := other
	maintenance.ID, maintenance.Name, maintenance.Status = "compat-maintenance", "compat-maintenance", modelconfig.ModelStatusMaintenance
	unbound := other
	unbound.ID, unbound.Name = "compat-unbound", "compat-unbound"
	if err := modelconfig.Save(ctx, st.Pool, modelconfig.Config{Version: modelconfig.Version,
		Providers: []modelconfig.Provider{provider}, Models: []modelconfig.Model{imageModel, other, private, maintenance, unbound},
		Workspaces: map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {
			ModelIDs:        []string{imageModel.ID, other.ID, private.ID, maintenance.ID},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindImage: imageModel.ID},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	env.user, err = store.InsertUser(ctx, st.Pool, uuid.NewString()+"@compat-test.invalid", "compat-test", "no-login", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, env.user.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, env.user.ID, 1000, "grant", "signup_bonus", env.user.ID.String(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	env.secret, err = newAPISecret()
	if err != nil {
		t.Fatal(err)
	}
	env.key, err = store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{
		UserID: env.user.ID, KeyPrefix: env.secret[:12], KeyHash: hashAPISecret(env.secret), Label: "Integration test only",
		Scopes: []string{"models:read", "tasks:write", "tasks:read", "files:write"}, AllowedModelIDs: []string{openAIIntegrationModel},
		DailyTaskLimit: 20, MonthlyTaskLimit: 100, DailySpendLimitCents: 10000, MonthlySpendLimitCents: 10000,
	})
	if err != nil {
		t.Fatal(err)
	}
	env.router = env.srv.Router()
	return env
}

func (env *openAIImagesIntegrationEnv) request(method, path, contentType, idempotency string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Authorization", "Bearer "+env.secret)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if idempotency != "" {
		request.Header.Set("Idempotency-Key", idempotency)
	}
	return request
}

func (env *openAIImagesIntegrationEnv) serve(t *testing.T, request *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	response := httptest.NewRecorder()
	env.router.ServeHTTP(response, request.WithContext(ctx))
	return response
}

func (env *openAIImagesIntegrationEnv) assertBilling(t *testing.T, taskCount int64, points int64) {
	t.Helper()
	ctx := context.Background()
	var tasks, events, freezes int64
	for _, query := range []struct {
		sql   string
		value *int64
	}{
		{"SELECT count(*) FROM tasks WHERE user_id=$1", &tasks},
		{"SELECT count(*) FROM api_key_usage_events WHERE user_id=$1", &events},
		{"SELECT count(*) FROM wallet_ledger WHERE user_id=$1 AND kind='freeze'", &freezes},
	} {
		if err := env.st.Pool.QueryRow(ctx, query.sql, env.user.ID).Scan(query.value); err != nil {
			t.Fatal(err)
		}
	}
	state, err := store.GetWallet(ctx, env.st.Pool, env.user.ID)
	if err != nil || state == nil {
		t.Fatalf("wallet = %#v error=%v", state, err)
	}
	if tasks != taskCount || events != taskCount || freezes != taskCount || state.BalanceCents != 1000-points || state.FrozenCents != points {
		t.Fatalf("creation billing: tasks=%d events=%d freezes=%d balance=%d frozen=%d; want count=%d points=%d", tasks, events, freezes, state.BalanceCents, state.FrozenCents, taskCount, points)
	}
	usage, err := store.GetAPIKeyUsageSummary(ctx, env.st.Pool, env.key.ID, time.Now().UTC())
	if err != nil || usage.TodayTasks != taskCount || usage.TodaySpendCents != points {
		t.Fatalf("API usage = %#v error=%v; want tasks=%d points=%d", usage, err, taskCount, points)
	}
}

func (env *openAIImagesIntegrationEnv) assertDirectBilling(t *testing.T, requestCount, points int64) {
	t.Helper()
	ctx := context.Background()
	var tasks, events, freezes, spends, releases, profitRows, profitRevenue, profitCost int64
	for _, query := range []struct {
		sql   string
		value *int64
	}{
		{"SELECT count(*) FROM tasks WHERE user_id=$1", &tasks},
		{"SELECT count(*) FROM api_key_usage_events WHERE user_id=$1", &events},
		{"SELECT count(*) FROM wallet_ledger WHERE user_id=$1 AND kind='freeze' AND source_type=$2", &freezes},
		{"SELECT count(*) FROM wallet_ledger WHERE user_id=$1 AND kind='spend' AND source_type=$2", &spends},
		{"SELECT count(*) FROM wallet_ledger WHERE user_id=$1 AND kind='release' AND source_type=$2", &releases},
	} {
		args := []any{env.user.ID}
		if strings.Contains(query.sql, "source_type=$2") {
			args = append(args, openAIImageBillingSource)
		}
		if err := env.st.Pool.QueryRow(ctx, query.sql, args...).Scan(query.value); err != nil {
			t.Fatal(err)
		}
	}
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*), COALESCE(SUM(revenue_cents), 0), COALESCE(SUM(upstream_cost_cents), 0)
		FROM usage_profit_ledger WHERE user_id=$1 AND source_type=$2 AND event_status='succeeded'`, env.user.ID, store.DeveloperAPIProfitSourceType).Scan(&profitRows, &profitRevenue, &profitCost); err != nil {
		t.Fatal(err)
	}
	state, err := store.GetWallet(ctx, env.st.Pool, env.user.ID)
	if err != nil || state == nil {
		t.Fatalf("wallet = %#v error=%v", state, err)
	}
	if tasks != 0 || events != requestCount || freezes != requestCount || spends != requestCount || releases != 0 || profitRows != requestCount || profitRevenue != points || profitCost != 0 || state.BalanceCents != 1000-points || state.FrozenCents != 0 {
		t.Fatalf("direct billing: tasks=%d events=%d freezes=%d spends=%d releases=%d profit_rows=%d profit_revenue=%d profit_cost=%d balance=%d frozen=%d; want requests=%d points=%d", tasks, events, freezes, spends, releases, profitRows, profitRevenue, profitCost, state.BalanceCents, state.FrozenCents, requestCount, points)
	}
	usage, err := store.GetAPIKeyUsageSummary(ctx, env.st.Pool, env.key.ID, time.Now().UTC())
	if err != nil || usage.TodayTasks != requestCount || usage.TodaySpendCents != points {
		t.Fatalf("API usage = %#v error=%v; want requests=%d points=%d", usage, err, requestCount, points)
	}
}

func (env *openAIImagesIntegrationEnv) assertNoLocalImagePersistence(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	var tasks, uploads int
	if err := env.st.Pool.QueryRow(ctx, "SELECT count(*) FROM tasks WHERE user_id=$1", env.user.ID).Scan(&tasks); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Pool.QueryRow(ctx, "SELECT count(*) FROM user_upload_objects WHERE user_id=$1", env.user.ID).Scan(&uploads); err != nil {
		t.Fatal(err)
	}
	env.mu.Lock()
	objects, upstreamCalls, internalFields := len(env.objects), env.upstreamCalls, env.upstreamInternalFields
	env.mu.Unlock()
	if tasks != 0 || uploads != 0 || objects != 0 || internalFields {
		t.Fatalf("direct image persistence/tasks: tasks=%d uploads=%d objects=%d upstream_calls=%d internal_fields=%t", tasks, uploads, objects, upstreamCalls, internalFields)
	}
}

func (env *openAIImagesIntegrationEnv) setUpstreamStatus(status int) {
	env.mu.Lock()
	defer env.mu.Unlock()
	env.upstreamStatus = status
}

func TestOpenAIResponsesImageGeneration(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body := `{"model":"compat-image","input":"a blue sky","tools":[{"type":"image_generation"}]}`
	response := env.serve(t, env.request(http.MethodPost, "/v1/responses", "application/json", "responses-test-1", strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("responses status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["object"] != "response" || payload["status"] != "completed" {
		t.Fatalf("responses payload=%#v", payload)
	}
	output, _ := payload["output"].([]any)
	if len(output) != 1 || output[0].(map[string]any)["type"] != "image_generation_call" || output[0].(map[string]any)["result"] == "" {
		t.Fatalf("responses output=%#v", output)
	}
	env.assertDirectBilling(t, 1, 20)
	env.assertNoLocalImagePersistence(t)
}

func TestOpenAIResponsesImageModelWithoutTool(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body := `{"model":"compat-image","input":"a blue kitten"}`
	response := env.serve(t, env.request(http.MethodPost, "/v1/responses", "application/json", "responses-image-model-1", strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("responses status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	output, _ := payload["output"].([]any)
	if len(output) != 1 || output[0].(map[string]any)["type"] != "image_generation_call" {
		t.Fatalf("responses output=%#v", output)
	}
	env.assertDirectBilling(t, 1, 20)
	env.assertNoLocalImagePersistence(t)
}

func TestOpenAIResponsesImageGenerationStream(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body := `{"model":"compat-image","input":[{"role":"user","content":[{"type":"input_text","text":"stream a blue sky"}]}],"tools":[{"type":"image_generation","partial_images":1}],"stream":true}`
	response := env.serve(t, env.request(http.MethodPost, "/v1/responses", "application/json", "responses-stream-1", strings.NewReader(body)))
	if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream status=%d content-type=%s body=%s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
	for _, event := range []string{
		`"type":"response.created"`,
		`"type":"response.image_generation_call.in_progress"`,
		`"type":"response.image_generation_call.generating"`,
		`"type":"response.image_generation_call.partial_image"`,
		`"type":"response.image_generation_call.completed"`,
		`"type":"response.completed"`,
		"data: [DONE]",
	} {
		if !strings.Contains(response.Body.String(), event) {
			t.Fatalf("stream omitted %s: %s", event, response.Body.String())
		}
	}
	env.assertDirectBilling(t, 1, 20)
	env.assertNoLocalImagePersistence(t)
}

func TestParseOpenAIResponsesInputImage(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString(uploadTestPNG(t))
	raw := json.RawMessage(`[{"role":"user","content":[{"type":"input_text","text":"edit this"},{"type":"input_image","image_url":"data:image/png;base64,` + encoded + `"}]}]`)
	prompt, images, err := parseOpenAIResponsesInput(raw)
	if err != nil || prompt != "edit this" || len(images) != 1 || images[0].ContentType != "image/png" {
		t.Fatalf("prompt=%q images=%#v error=%v", prompt, images, err)
	}
}

func requireOpenAIIntegrationStatus(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status=%d body=%s; want %d", response.Code, response.Body.String(), status)
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Fatal("missing request identifier")
	}
	if code != "" {
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != code {
			t.Fatalf("error=%s; want code %s (decode=%v)", response.Body.String(), code, err)
		}
	}
}

func openAIIntegrationMultipart(t *testing.T, fields map[string]string, files map[string][]byte) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for field, value := range fields {
		if err := writer.WriteField(field, value); err != nil {
			t.Fatal(err)
		}
	}
	for field, data := range files {
		part, err := writer.CreateFormFile(field, "client-image.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), writer.FormDataContentType()
}

func TestOpenAIImagesIntegrationModelsAndPreflightRejections(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	response := env.serve(t, env.request("GET", "/v1/models", "", "", nil))
	requireOpenAIIntegrationStatus(t, response, http.StatusOK, "")
	var catalog struct {
		Object string              `json:"object"`
		Data   []openAIModelObject `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil || catalog.Object != "list" || len(catalog.Data) != 1 || catalog.Data[0].ID != openAIIntegrationModel {
		t.Fatalf("Key-filtered model catalog = %s, error=%v", response.Body.String(), err)
	}
	for _, modelID := range []string{"compat-other", "compat-private", "compat-maintenance", "compat-unbound"} {
		response := env.serve(t, env.request("GET", "/v1/models/"+modelID, "", "", nil))
		requireOpenAIIntegrationStatus(t, response, http.StatusNotFound, "model_not_found")
	}
	deniedGeneration := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "denied-model",
		strings.NewReader(`{"model":"compat-other","prompt":"should not create"}`)))
	requireOpenAIIntegrationStatus(t, deniedGeneration, http.StatusNotFound, "model_not_found")
	if _, err := env.st.Pool.Exec(context.Background(), "UPDATE user_api_keys SET scopes=$2 WHERE id=$1", env.key.ID, []string{"models:read", "tasks:write"}); err != nil {
		t.Fatal(err)
	}
	data, contentType := openAIIntegrationMultipart(t, map[string]string{"model": openAIIntegrationModel, "prompt": "edit without upload scope"}, map[string][]byte{"image": uploadTestPNG(t)})
	deniedEdit := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "denied-upload", bytes.NewReader(data)))
	requireOpenAIIntegrationStatus(t, deniedEdit, http.StatusForbidden, "api_key_scope_denied")
	if _, err := env.st.Pool.Exec(context.Background(), "UPDATE user_api_keys SET scopes=$2 WHERE id=$1", env.key.ID, env.key.Scopes); err != nil {
		t.Fatal(err)
	}
	for _, caseName := range []string{"mask", "stream", "invalid-image"} {
		fields := map[string]string{"model": openAIIntegrationModel, "prompt": "rejected edit"}
		files := map[string][]byte{"image": uploadTestPNG(t)}
		wantCode := "unsupported_parameter"
		switch caseName {
		case "mask":
			files["mask"] = uploadTestPNG(t)
		case "stream":
			fields["stream"] = "true"
		case "invalid-image":
			files["image"] = []byte("not an image")
			wantCode = "unsupported_file"
		}
		data, contentType := openAIIntegrationMultipart(t, fields, files)
		response := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "reject-"+caseName, bytes.NewReader(data)))
		requireOpenAIIntegrationStatus(t, response, http.StatusBadRequest, wantCode)
	}
	env.assertDirectBilling(t, 0, 0)
	var uploads int
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM user_upload_objects WHERE user_id=$1", env.user.ID).Scan(&uploads); err != nil || uploads != 0 {
		t.Fatalf("preflight rejection stored uploads=%d error=%v", uploads, err)
	}
	env.mu.Lock()
	objectCount := len(env.objects)
	env.mu.Unlock()
	if objectCount != 0 {
		t.Fatalf("preflight rejection wrote %d objects", objectCount)
	}
}

func TestOpenAIImagesIntegrationGenerationAndIdempotentRedelivery(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body := `{"model":"compat-image","prompt":"one billable image","n":1}`
	first := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge", strings.NewReader(body)))
	requireOpenAIIntegrationStatus(t, first, http.StatusOK, "")
	var result openAIImageResponse
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].B64JSON == "" {
		t.Fatalf("first image response=%s error=%v", first.Body.String(), err)
	}
	if first.Header().Get("X-Task-ID") != "" || first.Header().Get("Idempotency-Key") != "single-charge" {
		t.Fatal("direct response returned an internal task identifier or omitted idempotency")
	}
	env.assertDirectBilling(t, 1, 20)
	replay := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge", strings.NewReader(body)))
	requireOpenAIIntegrationStatus(t, replay, http.StatusOK, "")
	if replay.Header().Get("X-Task-ID") != "" || replay.Body.String() != first.Body.String() {
		t.Fatal("same idempotency key did not return the same standard upstream result")
	}
	urlBody := `{"model":"compat-image","prompt":"one billable image","n":1,"response_format":"url"}`
	urlReplay := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge", strings.NewReader(urlBody)))
	requireOpenAIIntegrationStatus(t, urlReplay, http.StatusOK, "")
	result = openAIImageResponse{}
	if err := json.Unmarshal(urlReplay.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].B64JSON != "" || !strings.Contains(result.Data[0].URL, "/generated.png") || urlReplay.Header().Get("X-Task-ID") != "" {
		t.Fatalf("URL redelivery=%s error=%v", urlReplay.Body.String(), err)
	}
	changed := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "new-upstream-call",
		strings.NewReader(`{"model":"compat-image","prompt":"changed billable prompt"}`)))
	requireOpenAIIntegrationStatus(t, changed, http.StatusOK, "")
	env.assertDirectBilling(t, 2, 40)
	env.assertNoLocalImagePersistence(t)
	if _, err := env.st.Pool.Exec(context.Background(), "UPDATE user_api_keys SET daily_task_limit=1 WHERE id=$1", env.key.ID); err != nil {
		t.Fatal(err)
	}
	quotaDenied := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "new-over-quota",
		strings.NewReader(`{"model":"compat-image","prompt":"a new request over daily quota"}`)))
	requireOpenAIIntegrationStatus(t, quotaDenied, http.StatusTooManyRequests, "api_key_daily_limit")
	env.assertDirectBilling(t, 2, 40)
}

func TestOpenAIImagesIntegrationSeparatesDefiniteAndAmbiguousFailures(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body := `{"model":"compat-image","prompt":"failure accounting"}`
	env.setUpstreamStatus(http.StatusBadRequest)
	definite := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "definite-failure", strings.NewReader(body)))
	requireOpenAIIntegrationStatus(t, definite, http.StatusBadRequest, "upstream_error")

	var eventStatus string
	var units, revenue, cost int64
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT event_status, units, revenue_cents, upstream_cost_cents
		FROM usage_profit_ledger WHERE user_id=$1 AND source_type=$2`, env.user.ID, store.DeveloperAPIProfitSourceType).Scan(&eventStatus, &units, &revenue, &cost); err != nil {
		t.Fatal(err)
	}
	if eventStatus != "failed" || units != 1 || revenue != 0 || cost != 0 {
		t.Fatalf("definite failure profit event=%s units=%d revenue=%d cost=%d", eventStatus, units, revenue, cost)
	}
	state, err := store.GetWallet(context.Background(), env.st.Pool, env.user.ID)
	if err != nil || state.BalanceCents != 1000 || state.FrozenCents != 0 {
		t.Fatalf("definite failure wallet=%#v error=%v", state, err)
	}

	env.setUpstreamStatus(http.StatusGatewayTimeout)
	ambiguous := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "ambiguous-failure", strings.NewReader(body)))
	requireOpenAIIntegrationStatus(t, ambiguous, http.StatusBadGateway, "upstream_error")
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT event_status, units, revenue_cents, upstream_cost_cents
		FROM usage_profit_ledger WHERE user_id=$1 AND source_type=$2 AND source_id=$3`, env.user.ID, store.DeveloperAPIProfitSourceType, openAIImageBillingID(env.key.ID, "ambiguous-failure")).Scan(&eventStatus, &units, &revenue, &cost); err != nil {
		t.Fatal(err)
	}
	if eventStatus != "canceled" || units != 1 || revenue != 0 || cost != 0 {
		t.Fatalf("ambiguous failure profit event=%s units=%d revenue=%d cost=%d", eventStatus, units, revenue, cost)
	}
	state, err = store.GetWallet(context.Background(), env.st.Pool, env.user.ID)
	if err != nil || state.BalanceCents != 980 || state.FrozenCents != 20 {
		t.Fatalf("ambiguous failure wallet=%#v error=%v", state, err)
	}

	env.setUpstreamStatus(0)
	retry := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "ambiguous-failure", strings.NewReader(body)))
	requireOpenAIIntegrationStatus(t, retry, http.StatusOK, "")
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT event_status, units, revenue_cents, upstream_cost_cents
		FROM usage_profit_ledger WHERE user_id=$1 AND source_type=$2 AND source_id=$3`, env.user.ID, store.DeveloperAPIProfitSourceType, openAIImageBillingID(env.key.ID, "ambiguous-failure")).Scan(&eventStatus, &units, &revenue, &cost); err != nil {
		t.Fatal(err)
	}
	if eventStatus != "succeeded" || units != 1 || revenue != 20 || cost != 0 {
		t.Fatalf("retried failure profit event=%s units=%d revenue=%d cost=%d", eventStatus, units, revenue, cost)
	}
	state, err = store.GetWallet(context.Background(), env.st.Pool, env.user.ID)
	if err != nil || state.BalanceCents != 980 || state.FrozenCents != 0 {
		t.Fatalf("retried failure wallet=%#v error=%v", state, err)
	}
}

func TestOpenAIImagesIntegrationMultipartDirectProxyDoesNotPersistInput(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	data := uploadTestPNG(t)
	fields := map[string]string{"model": openAIIntegrationModel, "prompt": "edit with a real input"}
	body, contentType := openAIIntegrationMultipart(t, fields, map[string][]byte{"image[]": data})
	first := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "edit-single-charge", bytes.NewReader(body)))
	requireOpenAIIntegrationStatus(t, first, http.StatusOK, "")
	var result openAIImageResponse
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].B64JSON == "" {
		t.Fatalf("first edit response=%s error=%v", first.Body.String(), err)
	}
	if first.Header().Get("X-Task-ID") != "" {
		t.Fatal("direct edit returned an internal task identifier")
	}
	env.assertDirectBilling(t, 1, 20)
	// A replay with the same key still goes to the standard upstream. The local
	// gateway keeps no input bytes or task result to replay itself.
	body, contentType = openAIIntegrationMultipart(t, fields, map[string][]byte{"image": data})
	replay := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "edit-single-charge", bytes.NewReader(body)))
	requireOpenAIIntegrationStatus(t, replay, http.StatusOK, "")
	if replay.Header().Get("X-Task-ID") != "" || replay.Body.String() != first.Body.String() {
		t.Fatal("multipart replay did not preserve the standard upstream response")
	}
	env.assertDirectBilling(t, 1, 20)
	env.assertNoLocalImagePersistence(t)
}

func TestOpenAIImagesIntegrationConcurrentCreationReusesOneReservation(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	request, err := normalizeOpenAIImageRequest(openAIImageRequest{Model: openAIIntegrationModel, Prompt: "concurrent image"})
	if err != nil {
		t.Fatal(err)
	}
	modelCfg, err := modelconfig.Load(context.Background(), env.st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	params, err := openAIImageParams(request, openAIImageModels(modelCfg, env.key)[0], 0)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint := openAIImageFingerprint(request, false, nil)
	input := openAIImageTaskInput(request, params, nil, env.key.ID, "concurrent-replay", fingerprint)
	type result struct {
		task    *store.Task
		created bool
		err     error
	}
	results := make(chan result, 6)
	start := make(chan struct{})
	for range 6 {
		go func() {
			<-start
			task, created, err := env.srv.createOpenAIImageTask(context.Background(), env.user.ID, input, env.key.ID, fingerprint)
			results <- result{task, created, err}
		}()
	}
	close(start)
	created := 0
	var taskID uuid.UUID
	for range 6 {
		item := <-results
		if item.err != nil || item.task == nil {
			t.Fatalf("concurrent task creation=%#v error=%v", item.task, item.err)
		}
		if taskID == uuid.Nil {
			taskID = item.task.ID
		}
		if item.task.ID != taskID {
			t.Fatal("concurrent retry created more than one task")
		}
		if item.created {
			created++
		}
	}
	if created != 1 {
		t.Fatalf("concurrent creators=%d, want exactly one", created)
	}
	env.assertBilling(t, 1, 20)
}

func TestOpenAIImagesIntegrationInvalidLaterImageCleansEarlierUpload(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	body, contentType := openAIIntegrationMultipart(t,
		map[string]string{"model": openAIIntegrationModel, "prompt": "must reject invalid second image"},
		map[string][]byte{"image": uploadTestPNG(t), "image[]": []byte("invalid second image")})
	response := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "bad-second-image", bytes.NewReader(body)))
	requireOpenAIIntegrationStatus(t, response, http.StatusBadRequest, "unsupported_file")
	env.assertDirectBilling(t, 0, 0)
	env.assertNoLocalImagePersistence(t)
}
