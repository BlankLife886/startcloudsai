package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// With a product photo attached, the set tools are offered next to the image
// proposal tool and the model picks the set: the plan is stored and the card
// data goes into the message. Nothing is generated without approval.
func TestAssistantV2PlansACommerceSetWhenAskedForOne(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "帮我做一套保温杯的天猫主图")
	if _, err := fixture.st.Pool.Exec(ctx, `UPDATE assistant_runs SET params = params || '{"referenceImages":[{"fileKey":"uploads/cup.png"}]}'::jsonb WHERE id = $1`, fixture.run.ID); err != nil {
		t.Fatal(err)
	}
	run, err := store.GetAssistantRun(ctx, fixture.st.Pool, fixture.run.ID)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "p", Name: "P", Adapter: "openai", BaseURL: "https://api.example.com", APIKey: "k", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "img", Name: "Img", ProviderID: "p", UpstreamModel: "gpt-image-2", Kind: "image", PriceCents: 10, Public: true, Default: true, Enabled: true}}
	if err := modelconfig.Save(ctx, fixture.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	var picture bytes.Buffer
	canvas := image.NewRGBA(image.Rect(0, 0, 8, 8))
	canvas.Set(1, 1, color.RGBA{R: 200, A: 255})
	if err := png.Encode(&picture, canvas); err != nil {
		t.Fatal(err)
	}
	objects := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/uploads/cup.png") {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(picture.Bytes())
			return
		}
		http.NotFound(w, r)
	}))
	defer objects.Close()
	objectStorage, err := storage.New(&config.Config{
		ObjectStorageEndpoint: objects.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test",
		ObjectStorageBucket: "test-bucket", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300,
	})
	if err != nil {
		t.Fatal(err)
	}

	var exposed []string
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		tools, _ := body["tools"].([]any)
		messages, _ := body["messages"].([]any)
		last, _ := messages[len(messages)-1].(map[string]any)
		switch {
		case len(tools) == 0:
			// The copy planner inside commerce_set_plan.
			return sseText(`{"summary":"清爽白蓝","items":[{"id":"white","headline":"","subline":"","direction":"正面居中"}]}`)
		case last["role"] == "user":
			for _, raw := range tools {
				function, _ := raw.(map[string]any)["function"].(map[string]any)
				exposed = append(exposed, function["name"].(string))
			}
			system, _ := messages[0].(map[string]any)["content"].(string)
			if !strings.Contains(system, "commerce_set_plan 出方案") {
				t.Errorf("system prompt lacks commerce rules")
			}
			return sseToolCall("c1", "commerce_set_plan", `{"productName":"保温杯","platform":"天猫","shots":[{"type":"white"}]}`)
		default:
			return sseText("方案已准备好：1 张白底主图，预计 10 积分，确认后开始出图。")
		}
	}}
	server := upstream.server(t)
	defer server.Close()
	client, err := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	if err != nil {
		t.Fatal(err)
	}

	worker := &Worker{St: fixture.st, Storage: objectStorage}
	if err := worker.runAssistantV2(ctx, run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	if !strings.Contains(strings.Join(exposed, ","), "commerce_set_plan") || !strings.Contains(strings.Join(exposed, ","), "commerce_set_generate") {
		t.Fatalf("exposed = %v", exposed)
	}
	var sets, tasks int
	if err := fixture.st.Pool.QueryRow(ctx, `SELECT count(*) FROM assistant_commerce_sets WHERE user_id = $1 AND conversation_id = $2 AND status = 'planned'`,
		fixture.user.ID, run.ConversationID).Scan(&sets); err != nil {
		t.Fatal(err)
	}
	if err := fixture.st.Pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE user_id = $1`, fixture.user.ID).Scan(&tasks); err != nil {
		t.Fatal(err)
	}
	if sets != 1 || tasks != 0 {
		t.Fatalf("sets = %d tasks = %d", sets, tasks)
	}
	message, err := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if err != nil {
		t.Fatal(err)
	}
	views, _ := message.Metadata["dataViews"].([]any)
	raw, _ := json.Marshal(views)
	if len(views) != 1 || !strings.Contains(string(raw), `"view":"commerce_set"`) || !strings.Contains(string(raw), `"quotedCents":10`) {
		t.Fatalf("dataViews = %s", raw)
	}
}
