package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestExecuteAssistantC2AMultiImageTracksSlotsWithoutRaces(t *testing.T) {
	for _, mode := range []string{"plan", "individual"} {
		t.Run(mode, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			const count = 4
			user := assistantRoutingTestUser(t, st, 100)
			queued := insertAssistantRoutingTestRun(t, st, user.ID, "image", modelconfig.WorkspaceAssistant, count*5)
			params := map[string]any{"count": count, "_imageCostCents": count * 5, "_billingUnitPriceCents": 5}
			if mode == "plan" {
				items := make([]map[string]any, count)
				for index := range items {
					items[index] = map[string]any{"prompt": fmt.Sprintf("image %d", index+1)}
				}
				params["imagePlanItems"] = items
			} else {
				params["referenceMode"] = "individual"
			}
			if changed, err := store.SetQueuedAssistantRunExecutionRoute(ctx, st.Pool, queued.ID, params); err != nil || !changed {
				t.Fatalf("prepare run: changed=%v err=%v", changed, err)
			}
			run, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, queued.ID, "image-test", time.Now().UTC(), taskLease, 4)
			if err != nil || run == nil {
				t.Fatalf("claim run=%#v err=%v", run, err)
			}
			t.Cleanup(func() { clearAssistantStageClock(run.ID) })
			var imageBytes bytes.Buffer
			if err := png.Encode(&imageBytes, image.NewNRGBA(image.Rect(0, 0, 16, 16))); err != nil {
				t.Fatal(err)
			}
			encoded := base64.StdEncoding.EncodeToString(imageBytes.Bytes())
			firstUpload := make(chan struct{})
			var uploadOnce sync.Once
			objects := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPut {
					http.Error(w, "unexpected object request", http.StatusBadRequest)
					return
				}
				_, _ = io.Copy(io.Discard, r.Body)
				uploadOnce.Do(func() { close(firstUpload) })
				w.Header().Set("ETag", `"test"`)
				w.WriteHeader(http.StatusOK)
			}))
			defer objects.Close()
			objectStorage, err := storage.New(&config.Config{
				ObjectStorageEndpoint: objects.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test",
				ObjectStorageBucket: "test-bucket", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300,
			})
			if err != nil {
				t.Fatal(err)
			}
			var mu sync.Mutex
			submitted, polled := map[string]int{}, map[string]int{}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/image-tasks/") {
					var body struct {
						ID string `json:"client_task_id"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						http.Error(w, "invalid request", http.StatusBadRequest)
						return
					}
					mu.Lock()
					submitted[body.ID]++
					mu.Unlock()
					// Let the first image reach storage while the other submissions
					// are still pending, exercising metadata reads during ID writes.
					if body.ID != run.ID.String()+"-1" {
						select {
						case <-firstUpload:
						case <-r.Context().Done():
							return
						}
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": body.ID, "status": "queued"})
					return
				}
				if r.Method == http.MethodGet && r.URL.Path == "/api/image-tasks" {
					id := r.URL.Query().Get("ids")
					mu.Lock()
					polled[id]++
					mu.Unlock()
					_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{
						"id": id, "status": "success", "data": []any{map[string]any{"b64_json": encoded}},
					}}})
					return
				}
				http.NotFound(w, r)
			}))
			defer provider.Close()
			w := &Worker{St: st, Cfg: &config.Config{}, Storage: objectStorage}
			var references []string
			if mode == "individual" {
				for range count {
					references = append(references, "data:image/png;base64,"+encoded)
				}
			}
			client := c2a.NewWithPolicy(provider.URL, "test-key", 30, true).WithAsyncImageEdits()
			if err := w.executeAssistantImageC2AClient(ctx, run, references, client, "gpt-image-test"); err != nil {
				t.Fatal(err)
			}
			stored, err := store.GetAssistantRun(ctx, st.Pool, run.ID)
			if err != nil || stored == nil || stored.Status != "succeeded" || stored.CostCents != count*5 {
				t.Fatalf("settled run=%#v err=%v", stored, err)
			}
			ids := assistantParamStringMap(stored.Params, "_c2aTaskIdsBySlot")
			if len(ids) != count {
				t.Fatalf("persisted slots=%#v", ids)
			}
			mu.Lock()
			defer mu.Unlock()
			for index := range count {
				id := fmt.Sprintf("%s-%d", run.ID, index+1)
				if ids[fmt.Sprintf("item:%d", index)] != id || submitted[id] != 1 || polled[id] != 1 {
					t.Fatalf("slot=%d ids=%#v submits=%#v polls=%#v", index, ids, submitted, polled)
				}
			}
		})
	}
}

func TestAssistantAgentDoesNotFailoverAfterToolExecution(t *testing.T) {
	for _, toolFirst := range []bool{false, true} {
		t.Run(fmt.Sprintf("tool_first_%t", toolFirst), func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			w := assistantRoutingTestWorker(t, st, 4, 4)
			user := assistantRoutingTestUser(t, st, 100)
			queued := insertAssistantRoutingTestRun(t, st, user.ID, "agent", modelconfig.WorkspaceAssistant, 20)
			run, err := w.claimAssistantRun(ctx, queued.ID, "agent-test")
			if err != nil || run == nil {
				t.Fatalf("claim run=%#v err=%v", run, err)
			}
			requests := 0
			sawToolResult := false
			provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				requests++
				var body struct {
					Messages []struct {
						Role       string `json:"role"`
						ToolCallID string `json:"tool_call_id"`
					} `json:"messages"`
				}
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if toolFirst && requests == 1 {
					response.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(response, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read-status","function":{"name":"task_status","arguments":"{\"scope\":\"active\",\"limit\":1,\"task_id\":\"\"}"}}]}}]}`+"\n\n")
					fmt.Fprint(response, "data: [DONE]\n\n")
					return
				}
				for _, message := range body.Messages {
					if message.Role == "tool" && message.ToolCallID == "read-status" {
						sawToolResult = true
					}
				}
				http.Error(response, "gateway unavailable", http.StatusBadGateway)
			}))
			defer provider.Close()
			client, err := sub2api.New(provider.URL, "test-key", "gpt-test", "image-test", 30)
			if err != nil {
				t.Fatal(err)
			}
			executionErr := w.executeAssistantAgent(ctx, client, run, nil, nil)
			var providerErr *assistantProviderError
			if !errors.As(executionErr, &providerErr) || providerErr.outputStarted != toolFirst || sawToolResult != toolFirst {
				t.Fatalf("toolFirst=%t observed=%t providerErr=%#v err=%v", toolFirst, sawToolResult, providerErr, executionErr)
			}
			requeued, err := w.retryAssistantProviderRoute(ctx, run, executionErr)
			if err != nil || requeued == toolFirst {
				t.Fatalf("toolFirst=%t requeued=%t err=%v", toolFirst, requeued, err)
			}
		})
	}
}
