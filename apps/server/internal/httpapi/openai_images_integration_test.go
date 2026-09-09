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
	st      *store.Store
	srv     *Server
	router  *gin.Engine
	user    *store.User
	key     *store.UserAPIKey
	secret  string
	storage *httptest.Server
	mu      sync.Mutex
	objects map[string]openAIIntegrationObject
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
		BaseURL: "https://never-called.invalid", APIKey: "never-called-test-key", Enabled: true, TimeoutSecs: 10}
	imageModel := modelconfig.Model{ID: openAIIntegrationModel, Name: "Test image", ProviderID: provider.ID,
		UpstreamModel: "test-upstream-image", Kind: modelconfig.ModelKindImage, PriceCents: 20,
		Enabled: true, Public: true, Default: true, MaxImages: 4, MaxReferenceImages: 6,
		Resolutions: []string{"1K"}, AspectRatios: []string{"1:1"}, Qualities: []string{"low", "medium", "high"},
		OutputFormats: []string{"png", "jpeg", "webp"}, ModerationLevels: []string{"auto", "low"}}
	other := imageModel
	other.ID, other.Default = "compat-other", false
	private := other
	private.ID, private.Public = "compat-private", false
	maintenance := other
	maintenance.ID, maintenance.Status = "compat-maintenance", modelconfig.ModelStatusMaintenance
	unbound := other
	unbound.ID = "compat-unbound"
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

func (env *openAIImagesIntegrationEnv) start(t *testing.T, request *http.Request) <-chan *httptest.ResponseRecorder {
	t.Helper()
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	t.Cleanup(cancel)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		defer cancel()
		response := httptest.NewRecorder()
		env.router.ServeHTTP(response, request.WithContext(ctx))
		done <- response
	}()
	return done
}

func (env *openAIImagesIntegrationEnv) waitTask(t *testing.T, prompt string, response <-chan *httptest.ResponseRecorder) *store.Task {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var id uuid.UUID
		err := env.st.Pool.QueryRow(ctx, "SELECT id FROM tasks WHERE user_id=$1 AND prompt=$2 ORDER BY created_at LIMIT 1", env.user.ID, prompt).Scan(&id)
		if err == nil {
			task, err := store.GetUserTask(ctx, env.st.Pool, env.user.ID, id)
			if err != nil || task == nil {
				t.Fatalf("read created task = %#v, error %v", task, err)
			}
			return task
		}
		if err != pgx.ErrNoRows {
			t.Fatal(err)
		}
		select {
		case result := <-response:
			t.Fatalf("request returned before creating task: %d %s", result.Code, result.Body.String())
		case <-ctx.Done():
			t.Fatal("image request did not persist a task before deadline")
		case <-ticker.C:
		}
	}
}

func (env *openAIImagesIntegrationEnv) completeTask(t *testing.T, task *store.Task, data []byte) {
	t.Helper()
	key := fmt.Sprintf("tasks/%s/%s/original/0.png", env.user.ID, task.ID)
	env.mu.Lock()
	env.objects[key] = openAIIntegrationObject{data: data, contentType: "image/png"}
	env.mu.Unlock()
	// Simulate only worker output persistence. These API tests assert real task
	// creation/freezing; worker settlement is independently covered by taskflow.
	outputs, _ := json.Marshal([]string{key})
	if _, err := env.st.Pool.Exec(context.Background(), "UPDATE tasks SET status='succeeded',output_keys=$2,finished_at=now() WHERE id=$1", task.ID, outputs); err != nil {
		t.Fatal(err)
	}
}

func awaitOpenAIIntegrationResponse(t *testing.T, done <-chan *httptest.ResponseRecorder) *httptest.ResponseRecorder {
	t.Helper()
	select {
	case result := <-done:
		return result
	case <-time.After(9 * time.Second):
		t.Fatal("image request did not finish")
		return nil
	}
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
	env.assertBilling(t, 0, 0)
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
	done := env.start(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge", strings.NewReader(body)))
	task := env.waitTask(t, "one billable image", done)
	env.assertBilling(t, 1, 20)
	if task.Params["_apiKeyId"] != env.key.ID.String() || task.Params["_source"] != "open_api" || task.Params[openAIImageFingerprintParam] == "" {
		t.Fatalf("task lost API attribution/fingerprint: %#v", task.Params)
	}
	data := uploadTestPNG(t)
	env.completeTask(t, task, data)
	first := awaitOpenAIIntegrationResponse(t, done)
	requireOpenAIIntegrationStatus(t, first, http.StatusOK, "")
	var result openAIImageResponse
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].B64JSON != base64.StdEncoding.EncodeToString(data) {
		t.Fatalf("first image response=%s error=%v", first.Body.String(), err)
	}
	if first.Header().Get("X-Task-ID") != task.ID.String() || first.Header().Get("Idempotency-Key") != "single-charge" {
		t.Fatal("creation response omitted task/idempotency identifiers")
	}
	replay := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge", strings.NewReader(body)))
	requireOpenAIIntegrationStatus(t, replay, http.StatusOK, "")
	if replay.Header().Get("X-Task-ID") != task.ID.String() || replay.Body.String() != first.Body.String() {
		t.Fatal("same idempotency key did not replay the original task/result")
	}
	urlBody := `{"model":"compat-image","prompt":"one billable image","n":1,"response_format":"url"}`
	urlReplay := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge", strings.NewReader(urlBody)))
	requireOpenAIIntegrationStatus(t, urlReplay, http.StatusOK, "")
	result = openAIImageResponse{}
	if err := json.Unmarshal(urlReplay.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].B64JSON != "" || !strings.HasPrefix(result.Data[0].URL, env.storage.URL+"/") || urlReplay.Header().Get("X-Task-ID") != task.ID.String() {
		t.Fatalf("URL redelivery=%s error=%v", urlReplay.Body.String(), err)
	}
	changed := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "single-charge",
		strings.NewReader(`{"model":"compat-image","prompt":"changed billable prompt"}`)))
	requireOpenAIIntegrationStatus(t, changed, http.StatusConflict, "idempotency_key_conflict")
	env.assertBilling(t, 1, 20)
	if _, err := env.st.Pool.Exec(context.Background(), "UPDATE user_api_keys SET daily_task_limit=1 WHERE id=$1", env.key.ID); err != nil {
		t.Fatal(err)
	}
	quotaDenied := env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "new-over-quota",
		strings.NewReader(`{"model":"compat-image","prompt":"a new task over daily quota"}`)))
	requireOpenAIIntegrationStatus(t, quotaDenied, http.StatusTooManyRequests, "api_key_daily_limit")
	env.assertBilling(t, 1, 20)
}

func TestOpenAIImagesIntegrationMultipartReplayCleansOnlyExtraUploads(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	data := uploadTestPNG(t)
	fields := map[string]string{"model": openAIIntegrationModel, "prompt": "edit with a real input"}
	body, contentType := openAIIntegrationMultipart(t, fields, map[string][]byte{"image[]": data})
	done := env.start(t, env.request("POST", "/v1/images/edits", contentType, "edit-single-charge", bytes.NewReader(body)))
	task := env.waitTask(t, fields["prompt"], done)
	if len(task.InputKeys) != 1 {
		t.Fatalf("image edit input references=%v", task.InputKeys)
	}
	var references int
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM user_upload_references WHERE reference_type=$1 AND reference_id=$2 AND object_key=$3",
		store.UploadReferenceTaskInput, task.ID, task.InputKeys[0]).Scan(&references); err != nil || references != 1 {
		t.Fatalf("committed task input reference=%d error=%v", references, err)
	}
	env.mu.Lock()
	storedOriginal := append([]byte(nil), env.objects[task.InputKeys[0]].data...)
	env.mu.Unlock()
	if !bytes.Equal(storedOriginal, data) {
		t.Fatal("multipart edit did not preserve original file bytes")
	}
	env.assertBilling(t, 1, 20)
	env.completeTask(t, task, data)
	first := awaitOpenAIIntegrationResponse(t, done)
	requireOpenAIIntegrationStatus(t, first, http.StatusOK, "")
	// Switch image[] to image and produce a new multipart boundary/object key.
	// Fingerprinting is based on bytes, so this must still replay the same task.
	body, contentType = openAIIntegrationMultipart(t, fields, map[string][]byte{"image": data})
	replay := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "edit-single-charge", bytes.NewReader(body)))
	requireOpenAIIntegrationStatus(t, replay, http.StatusOK, "")
	if replay.Header().Get("X-Task-ID") != task.ID.String() {
		t.Fatal("multipart replay created a different task")
	}
	env.assertBilling(t, 1, 20)
	var live, removed, cleanup, protectedOriginal int
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FILTER(WHERE deleted_at IS NULL), count(*) FILTER(WHERE deleted_at IS NOT NULL)
		FROM user_upload_objects WHERE user_id=$1`, env.user.ID).Scan(&live, &removed); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM object_cleanup_jobs WHERE object_key LIKE $1", "uploads/"+env.user.ID.String()+"/%").Scan(&cleanup); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM user_upload_objects WHERE object_key=$1 AND deleted_at IS NULL", task.InputKeys[0]).Scan(&protectedOriginal); err != nil {
		t.Fatal(err)
	}
	if live != 3 || removed != 3 || cleanup != 3 || protectedOriginal != 1 {
		t.Fatalf("replayed upload cleanup live=%d removed=%d queued=%d protected-original=%d", live, removed, cleanup, protectedOriginal)
	}
	// A changed prompt gets a 409 and its new uploads are also cleaned safely.
	fields["prompt"] = "different edit under same key"
	body, contentType = openAIIntegrationMultipart(t, fields, map[string][]byte{"image": data})
	conflict := env.serve(t, env.request("POST", "/v1/images/edits", contentType, "edit-single-charge", bytes.NewReader(body)))
	requireOpenAIIntegrationStatus(t, conflict, http.StatusConflict, "idempotency_key_conflict")
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM user_upload_objects WHERE user_id=$1 AND deleted_at IS NOT NULL", env.user.ID).Scan(&removed); err != nil || removed != 6 {
		t.Fatalf("conflicting edit cleanup removed=%d error=%v", removed, err)
	}
	env.assertBilling(t, 1, 20)
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
	env.assertBilling(t, 0, 0)
	var live, removed, cleanup int
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FILTER(WHERE deleted_at IS NULL), count(*) FILTER(WHERE deleted_at IS NOT NULL)
		FROM user_upload_objects WHERE user_id=$1`, env.user.ID).Scan(&live, &removed); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM object_cleanup_jobs WHERE object_key LIKE $1", "uploads/"+env.user.ID.String()+"/%").Scan(&cleanup); err != nil {
		t.Fatal(err)
	}
	if live != 0 || removed != 3 || cleanup != 3 {
		t.Fatalf("earlier upload leaked after later image failed: live=%d removed=%d cleanup=%d", live, removed, cleanup)
	}
}
