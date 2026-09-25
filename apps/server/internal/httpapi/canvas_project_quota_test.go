package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/contractpricing"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func emptyCanvasDoc() map[string]any {
	return map[string]any{"version": 1, "nodes": []any{}, "edges": []any{}}
}

func createCanvas(t *testing.T, env *communityEnv, token string, doc map[string]any) (int, string) {
	t.Helper()
	w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "画布", "document": doc}, token)
	_, code := decode(t, w)
	return w.Code, code
}

func TestCanvasProjectCountLimitFollowsAdminSetting(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	if err := settings.Set(ctx, env.st.Pool, "canvas_project_max_count", json.RawMessage(`2`)); err != nil {
		t.Fatal(err)
	}
	_, token := env.newUserSession(t, "user")
	var firstID string
	for i := 0; i < 2; i++ {
		w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "画布", "document": emptyCanvasDoc()}, token)
		if w.Code != http.StatusCreated {
			t.Fatalf("create %d: status %d body %s", i, w.Code, w.Body.String())
		}
		if i == 0 {
			created, _ := decode(t, w)
			firstID = created["id"].(string)
		}
	}
	if status, code := createCanvas(t, env, token, emptyCanvasDoc()); status != http.StatusConflict || code != "canvas_project_limit" {
		t.Fatalf("over limit: status %d code %s", status, code)
	}
	w := env.do(t, http.MethodGet, "/api/v1/me/canvas-project-quota", nil, token)
	quota, _ := decode(t, w)
	if w.Code != http.StatusOK || quota["used"] != float64(2) || quota["limit"] != float64(2) || quota["base"] != float64(2) || quota["maxBytes"] != float64(30<<20) {
		t.Fatalf("quota: status %d body %s", w.Code, w.Body.String())
	}
	if w := env.do(t, http.MethodDelete, "/api/v1/canvas-projects/"+firstID, nil, token); w.Code != http.StatusNoContent {
		t.Fatalf("delete: status %d", w.Code)
	}
	if status, _ := createCanvas(t, env, token, emptyCanvasDoc()); status != http.StatusCreated {
		t.Fatalf("create after delete: status %d", status)
	}
}

func TestCanvasProjectLimitAddsSubscriptionBonus(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	if err := settings.Set(ctx, env.st.Pool, "canvas_project_max_count", json.RawMessage(`1`)); err != nil {
		t.Fatal(err)
	}
	user, token := env.newUserSession(t, "user")
	plan, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "canvas", Kind: "subscription", DurationDays: 3, DailyGrantCents: 100,
		SubscriptionPolicy: store.SubscriptionPolicy{CanvasProjectBonus: 2}})
	if err != nil {
		t.Fatal(err)
	}
	sub, err := store.InsertSubscription(ctx, env.st.Pool, &store.Subscription{UserID: user.ID, PlanID: plan.ID, StartsAt: time.Now().Add(-time.Minute), EndsAt: time.Now().Add(24 * time.Hour), DailyGrantCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	contract, err := contractpricing.Capture(ctx, env.st.Pool, plan.SubscriptionPolicy, plan.Revision, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE subscriptions SET billing_contract=$2 WHERE id=$1`, sub.ID, contract); err != nil {
		t.Fatal(err)
	}
	// 购买后再调整套餐不影响已购合同。
	plan.SubscriptionPolicy.CanvasProjectBonus = 50
	if err := store.UpdatePlan(ctx, env.st.Pool, plan); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if status, code := createCanvas(t, env, token, emptyCanvasDoc()); status != http.StatusCreated {
			t.Fatalf("create %d within base+bonus: status %d code %s", i, status, code)
		}
	}
	if status, code := createCanvas(t, env, token, emptyCanvasDoc()); status != http.StatusConflict || code != "canvas_project_limit" {
		t.Fatalf("over base+bonus: status %d code %s", status, code)
	}
	w := env.do(t, http.MethodGet, "/api/v1/me/canvas-project-quota", nil, token)
	quota, _ := decode(t, w)
	if quota["planBonus"] != float64(2) || quota["limit"] != float64(3) {
		t.Fatalf("quota with bonus: %s", w.Body.String())
	}
}

func TestCanvasProjectRejectsDocumentsOverSizeLimit(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	if err := settings.Set(ctx, env.st.Pool, "canvas_project_max_kb", json.RawMessage(`512`)); err != nil {
		t.Fatal(err)
	}
	_, token := env.newUserSession(t, "user")
	big := map[string]any{"version": 1, "nodes": []any{map[string]any{"id": "n1", "prompt": strings.Repeat("x", 1<<20)}}, "edges": []any{}}
	w0 := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "画布", "document": big}, token)
	if _, code := decode(t, w0); w0.Code != http.StatusRequestEntityTooLarge || code != "canvas_document_too_large" {
		t.Fatalf("oversized create: status %d code %s", w0.Code, code)
	}
	if body := w0.Body.String(); !strings.Contains(body, "超过单个项目 512KB 的上限") || !strings.Contains(body, "1.0MB") {
		t.Fatalf("size error should state actual size and the KB limit: %s", body)
	}
	w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "画布", "document": emptyCanvasDoc()}, token)
	created, _ := decode(t, w)
	w = env.do(t, http.MethodPatch, "/api/v1/canvas-projects/"+created["id"].(string), map[string]any{"document": big, "revision": 1}, token)
	if _, code := decode(t, w); w.Code != http.StatusRequestEntityTooLarge || code != "canvas_document_too_large" {
		t.Fatalf("oversized patch: status %d code %s", w.Code, code)
	}
}

func TestCanvasProjectConcurrentCreatesRespectLimit(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	if err := settings.Set(ctx, env.st.Pool, "canvas_project_max_count", json.RawMessage(`3`)); err != nil {
		t.Fatal(err)
	}
	user, token := env.newUserSession(t, "user")
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = createCanvas(t, env, token, emptyCanvasDoc())
		}()
	}
	wg.Wait()
	var count int
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM canvas_projects WHERE user_id=$1`, user.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("concurrent creates produced %d projects, want 3", count)
	}
}

func TestCanvasProjectSizesAreReportedAndTrackUpdates(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "画布", "document": emptyCanvasDoc()}, token)
	created, _ := decode(t, w)
	if created["sizeBytes"] == nil || created["sizeBytes"].(float64) <= 0 {
		t.Fatalf("created project should report its size: %s", w.Body.String())
	}
	id := created["id"].(string)
	bigger := map[string]any{"version": 1, "nodes": []any{map[string]any{"id": "n1", "prompt": strings.Repeat("云", 2000)}}, "edges": []any{}}
	if w := env.do(t, http.MethodPatch, "/api/v1/canvas-projects/"+id, map[string]any{"document": bigger, "revision": 1}, token); w.Code != http.StatusOK {
		t.Fatalf("patch: status %d body %s", w.Code, w.Body.String())
	}
	env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "小画布", "document": emptyCanvasDoc()}, token)

	w = env.do(t, http.MethodGet, "/api/v1/canvas-projects", nil, token)
	listed, _ := decode(t, w)
	sizes := map[string]float64{}
	var total float64
	for _, raw := range listed["items"].([]any) {
		item := raw.(map[string]any)
		sizes[item["title"].(string)] = item["sizeBytes"].(float64)
		total += item["sizeBytes"].(float64)
	}
	if sizes["画布"] < 6000 || sizes["小画布"] <= 0 || sizes["画布"] <= sizes["小画布"] {
		t.Fatalf("list sizes should follow document updates (2000 CJK chars ≈ 6000 bytes): %#v", sizes)
	}
	w = env.do(t, http.MethodGet, "/api/v1/me/canvas-project-quota", nil, token)
	quota, _ := decode(t, w)
	if quota["totalBytes"] != total || quota["largestBytes"] != sizes["画布"] {
		t.Fatalf("quota totals: %s (list total %.0f, largest %.0f)", w.Body.String(), total, sizes["画布"])
	}
}
