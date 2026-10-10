package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func newExecutionAdmissionEnv(t *testing.T) (*communityEnv, *store.User, string, modelconfig.Config) {
	t.Helper()
	env := newCommunityEnv(t)
	env.cfg.AppSecret = "local-execution-admission-test"
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, user.ID, 100, "grant", "test", uuid.NewString(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	key, err := settings.EncryptSecret("private-execution-test-key", env.cfg.AppSecret)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Execution test", Adapter: modelconfig.AdapterOpenAI, Enabled: true, Routes: []modelconfig.ProviderRoute{{ID: "route", Name: "Original", BaseURL: "http://127.0.0.1:1", APIKey: key, MaxConcurrency: 4, Enabled: true}}}}
	cfg.Models = []modelconfig.Model{{ID: "image", Name: "Image", ProviderID: "provider", Kind: modelconfig.ModelKindImage, UpstreamModel: "image-a", PriceCents: 5, MaxImages: 4, Enabled: true, Public: true}, {ID: "chat", Name: "Chat", ProviderID: "provider", Kind: modelconfig.ModelKindChat, UpstreamModel: "chat-a", PriceCents: 2, Enabled: true, Public: true}}
	workspace, _ := modelconfig.WorkspaceForTaskType("t2i")
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceAssistant: {ModelIDs: []string{"image", "chat"}}, workspace: {ModelIDs: []string{"image"}}}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	return env, user, token, cfg
}

func TestExecutionAdmissionRejectsOversizedBatchesBeforeFreezing(t *testing.T) {
	env, user, token, cfg := newExecutionAdmissionEnv(t)
	ctx := context.Background()
	response := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "Admission"}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("conversation: %s", response.Body.String())
	}
	conversation, _ := decode(t, response)
	for _, scope := range []string{"user", "global", "route"} {
		t.Run(scope, func(t *testing.T) {
			for _, key := range []string{"user_max_concurrent_tasks", "global_max_concurrent_tasks"} {
				if err := settings.Set(ctx, env.st.Pool, key, json.RawMessage(`4`)); err != nil {
					t.Fatal(err)
				}
			}
			cfg.Providers[0].Routes[0].MaxConcurrency = 4
			if scope == "route" {
				cfg.Providers[0].Routes[0].MaxConcurrency = 1
			} else {
				key := "user_max_concurrent_tasks"
				if scope == "global" {
					key = "global_max_concurrent_tasks"
				}
				if err := settings.Set(ctx, env.st.Pool, key, json.RawMessage(`1`)); err != nil {
					t.Fatal(err)
				}
			}
			if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
				t.Fatal(err)
			}
			for _, kind := range []string{"task", "assistant"} {
				path := "/api/v1/tasks"
				body := map[string]any{"type": "t2i", "prompt": "draw a cup", "count": 2, "params": map[string]any{"publicModelKey": "image"}}
				if kind == "assistant" {
					path = "/api/v1/assistant/runs"
					body = map[string]any{"conversationId": conversation["id"], "prompt": "draw a cup", "mode": "image", "model": "image", "count": 2, "queue": true}
				}
				got := env.do(t, http.MethodPost, path, body, token)
				_, code := decode(t, got)
				if got.Code != http.StatusUnprocessableEntity || code != "execution_batch_too_large" {
					t.Fatalf("%s/%s status=%d code=%s body=%s", scope, kind, got.Code, code, got.Body.String())
				}
			}
			funds, err := store.GetWallet(ctx, env.st.Pool, user.ID)
			if err != nil || funds.BalanceCents != 100 || funds.FrozenCents != 0 {
				t.Fatalf("rejected batch charged: %+v %v", funds, err)
			}
			var tasks, runs, snapshots int
			if err := env.st.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM tasks),(SELECT count(*) FROM assistant_runs),(SELECT count(*) FROM execution_snapshots)`).Scan(&tasks, &runs, &snapshots); err != nil || tasks+runs+snapshots != 0 {
				t.Fatalf("rollback: tasks=%d runs=%d snapshots=%d err=%v", tasks, runs, snapshots, err)
			}
		})
	}
}

func TestExecutionAdmissionAssistantReplayEditAndCancelKeepOriginalContract(t *testing.T) {
	env, user, token, cfg := newExecutionAdmissionEnv(t)
	ctx := context.Background()
	conversationResponse := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "Frozen request"}, token)
	conversation, _ := decode(t, conversationResponse)
	body := map[string]any{"conversationId": conversation["id"], "prompt": "draw a cup", "mode": "image", "model": "image", "count": 2, "queue": true, "idempotencyKey": "original-request"}
	created := env.do(t, http.MethodPost, "/api/v1/assistant/runs", body, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	data, _ := decode(t, created)
	runID := uuid.MustParse(data["run"].(map[string]any)["id"].(string))
	original, err := store.GetExecutionSnapshot(ctx, env.st.Pool, "assistant_run", runID, "models")
	if err != nil || len(original) == 0 {
		t.Fatalf("missing creation snapshot: %v", err)
	}
	for _, secret := range []string{"private-execution-test-key", cfg.Providers[0].Routes[0].APIKey, "configVersion"} {
		if strings.Contains(created.Body.String(), secret) {
			t.Fatal("private execution snapshot leaked in response")
		}
	}
	cfg.Models[0].PriceCents = 40
	cfg.Models[0].UpstreamModel = "image-b"
	cfg.Providers[0].Routes[0].BaseURL = "http://127.0.0.1:2"
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	replay := env.do(t, http.MethodPost, "/api/v1/assistant/runs", body, token)
	replayed, _ := decode(t, replay)
	if replay.Code != http.StatusOK || replayed["run"].(map[string]any)["id"] != runID.String() {
		t.Fatalf("replay: %d %s", replay.Code, replay.Body.String())
	}
	edit := env.do(t, http.MethodPatch, "/api/v1/assistant/runs/"+runID.String(), map[string]any{"action": "edit", "prompt": "draw a blue cup"}, token)
	if edit.Code != http.StatusOK {
		t.Fatalf("edit: %s", edit.Body.String())
	}
	run, err := store.GetAssistantRun(ctx, env.st.Pool, runID)
	if err != nil || run.Prompt != "draw a blue cup" || run.ReservedCents != 10 || store.AssistantRunWorkUnits(run) != 2 {
		t.Fatalf("edited contract=%+v %v", run, err)
	}
	current, err := store.GetExecutionSnapshot(ctx, env.st.Pool, "assistant_run", runID, "models")
	if err != nil || !bytes.Equal(current, original) {
		t.Fatal("queued prompt edit or live model edit replaced execution snapshot")
	}
	funds, err := store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || funds.FrozenCents != 10 || funds.BalanceCents != 90 {
		t.Fatalf("replay double froze: %+v %v", funds, err)
	}
	canceled := env.do(t, http.MethodPatch, "/api/v1/assistant/runs/"+runID.String(), map[string]any{"status": "canceled"}, token)
	if canceled.Code != http.StatusOK {
		t.Fatalf("cancel: %s", canceled.Body.String())
	}
	funds, err = store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || funds.FrozenCents != 0 || funds.BalanceCents != 100 {
		t.Fatalf("cancel refund: %+v %v", funds, err)
	}
}

func TestExecutionAdmissionNewTaskCannotImportRecoveryIdentifiers(t *testing.T) {
	env, user, _, _ := newExecutionAdmissionEnv(t)
	ctx := context.Background()
	for _, nested := range []bool{false, true} {
		t.Run(map[bool]string{false: "direct", true: "domain_transaction"}[nested], func(t *testing.T) {
			key := uuid.NewString()
			input := taskflow.CreateInput{Type: "t2i", Prompt: "a cup", Count: 1, IdempotencyKey: &key, Params: map[string]any{"publicModelKey": "image", "_crunTaskIds": []string{"fake-job"}, "_c2aTaskIdsBySlot": map[string]string{"batch": "fake-job"}, "_crunSubmissionUncertain": true}}
			var task *store.Task
			var err error
			if nested {
				err = env.st.Tx(ctx, func(tx pgx.Tx) error {
					var createErr error
					task, _, createErr = taskflow.CreateTaskInTx(ctx, tx, user.ID, input, nil)
					return createErr
				})
			} else {
				task, _, err = taskflow.CreateTask(ctx, env.st, user.ID, input)
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"_crunTaskIds", "_c2aTaskIdsBySlot", "_crunSubmissionUncertain"} {
				if _, exists := task.Params[key]; exists {
					t.Fatalf("new task imported runtime key %s", key)
				}
			}
			if store.TaskRetainsImageReservation(task) {
				t.Fatal("new task impersonated admitted recovery")
			}
			replayed, created, err := taskflow.CreateTask(ctx, env.st, user.ID, input)
			if err != nil || created || replayed.ID != task.ID {
				t.Fatalf("replay: created=%v err=%v", created, err)
			}
		})
	}
	funds, err := store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || funds.FrozenCents != 10 || funds.BalanceCents != 90 {
		t.Fatalf("creation/replay billing: %+v %v", funds, err)
	}
	account, err := store.GetUserConcurrency(ctx, env.st.Pool, user.ID)
	if err != nil || account.ImageRunning != 0 {
		t.Fatalf("new queued tasks reserved execution slots: %+v %v", account, err)
	}
}
