package commerceset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

type fixture struct {
	t        *testing.T
	st       *store.Store
	ctx      context.Context
	user     *store.User
	service  Service
	enqueued []string
	mu       sync.Mutex
}

// setup gives a user 1000 points and an e-commerce image model at 10 points.
func setup(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("c-%s@test.dev", uuid.NewString()[:8]), "seller", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, user.ID, 1000, "grant", "signup_bonus", user.ID.String(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(ctx, st.Pool, "growth_failure_bonus_enabled", json.RawMessage(`false`)); err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "p", Name: "P", Adapter: "openai", BaseURL: "https://api.example.com", APIKey: "k", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "img", Name: "Img", ProviderID: "p", UpstreamModel: "gpt-image-2", Kind: "image",
		PriceCents: 10, Public: true, Default: true, Enabled: true, AspectRatios: []string{"1:1", "3:4"}}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, st: st, ctx: ctx, user: user}
	f.service = Service{St: st, Enqueue: func(_ context.Context, id string) error {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.enqueued = append(f.enqueued, id)
		return nil
	}}
	return f
}

func (f *fixture) autoApprove(on bool, budget int64) {
	f.t.Helper()
	if _, err := f.st.Pool.Exec(f.ctx, `UPDATE users SET assistant_auto_approve = $2, assistant_auto_approve_budget_cents = $3 WHERE id = $1`,
		f.user.ID, on, budget); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) plan(shots ...ShotRequest) *store.CommerceSet {
	f.t.Helper()
	copyWriter := func(_ context.Context, prompt string) (string, error) {
		if !strings.Contains(prompt, "id=white") {
			f.t.Errorf("copy prompt misses shots: %s", prompt)
		}
		return `{"summary":"清爽白蓝主线","items":[{"id":"white","headline":"","subline":"","direction":"正面居中"},{"id":"selling","headline":"一杯暖一天","subline":"12 小时保温","direction":"左图右文"}]}`, nil
	}
	set, err := f.service.Plan(f.ctx, PlanInput{UserID: f.user.ID, InputKeys: []string{"uploads/cup.png"},
		Brief: Brief{ProductName: "保温杯", Shots: shots}, Copy: copyWriter})
	if err != nil {
		f.t.Fatal(err)
	}
	return set
}

func TestPlanStoresCopyAndQuote(t *testing.T) {
	f := setup(t)
	set := f.plan(ShotRequest{Type: "white"}, ShotRequest{Type: "selling", Count: 2})
	if len(set.Shots) != 3 || set.QuotedCents != 30 || set.ModelID != "img" || set.Status != store.CommerceSetPlanned {
		t.Fatalf("set = %+v", set)
	}
	if set.Summary != "清爽白蓝主线" || set.Shots[1].Headline != "一杯暖一天" || set.Shots[2].ID != "selling~2" || set.Shots[0].AspectRatio != "1:1" || set.Shots[1].AspectRatio != "3:4" {
		t.Fatalf("shots = %+v", set.Shots)
	}
	view, err := f.service.BuildView(f.ctx, set)
	if err != nil {
		t.Fatal(err)
	}
	if view.AutoApprovable || view.ConfirmationNote == "" || view.Ready || view.Total != 3 {
		t.Fatalf("view = %+v", view)
	}
}

func TestGenerateNeedsApprovalAndKeepsTheBudget(t *testing.T) {
	f := setup(t)
	set := f.plan(ShotRequest{Type: "white"}, ShotRequest{Type: "selling"})

	// Auto-approval off: the budget path refuses and nothing is created.
	if _, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByBudget}); !errors.Is(err, ErrNeedsConfirmation) {
		t.Fatalf("err = %v", err)
	}
	// On, but the set costs more than the budget.
	f.autoApprove(true, 15)
	if _, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByBudget}); !errors.Is(err, ErrNeedsConfirmation) {
		t.Fatalf("over budget err = %v", err)
	}
	var tasks int
	if err := f.st.Pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE user_id = $1`, f.user.ID).Scan(&tasks); err != nil || tasks != 0 {
		t.Fatalf("tasks created while refused: %d %v", tasks, err)
	}

	f.autoApprove(true, 25)
	result, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByBudget})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.TaskIDs) != 2 || result.TotalCents != 20 || result.Set.ApprovedCents != 20 || len(f.enqueued) != 2 {
		t.Fatalf("result = %+v enqueued = %v", result, f.enqueued)
	}
	task, err := store.GetTask(f.ctx, f.st.Pool, result.TaskIDs[1])
	if err != nil {
		t.Fatal(err)
	}
	if task.Type != TaskType || task.CostCents != 10 || task.Params[SetParam] != set.ID.String() || task.Params["kindVariant"] != "listing" ||
		task.Params["aspectRatio"] != "3:4" || !strings.Contains(task.Prompt, "画面标题文案：「一杯暖一天」") || !strings.Contains(task.Prompt, "这是整套输出的第 2/2 张") {
		t.Fatalf("task = %+v\nprompt = %s", task.Params, task.Prompt)
	}

	// A redo of 10 more would bring the set to 30 > 25: refused.
	if _, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByBudget, ShotIDs: []string{"white"}}); !errors.Is(err, ErrNeedsConfirmation) {
		t.Fatalf("cumulative budget not enforced: %v", err)
	}
	// The user confirming on the card is not limited by the budget, but a
	// price they did not see is refused.
	wrong := int64(5)
	if _, err := f.service.Redo(f.ctx, f.user.ID, set.ID, []string{"white"}, "背景更白", &wrong); !errors.Is(err, ErrPriceChanged) {
		t.Fatalf("price change err = %v", err)
	}
	right := int64(10)
	redo, err := f.service.Redo(f.ctx, f.user.ID, set.ID, []string{"white"}, "背景更白", &right)
	if err != nil {
		t.Fatal(err)
	}
	redone, _ := store.GetTask(f.ctx, f.st.Pool, redo.TaskIDs[0])
	if !strings.Contains(redone.Prompt, "用户对本次重做的要求：背景更白") || redo.Set.ApprovedCents != 30 || len(redo.Set.Shots[0].Attempts) != 2 {
		t.Fatalf("redo = %+v prompt = %s", redo.Set, redone.Prompt)
	}
	// Another user cannot touch the set.
	if _, err := f.service.Generate(f.ctx, uuid.New(), set.ID, GenerateInput{Via: store.CommerceApprovedByUser}); err == nil {
		t.Fatal("stranger generated the set")
	}
}

func TestReviewMarksIssuesAndRedoesWithinBudget(t *testing.T) {
	f := setup(t)
	set := f.plan(ShotRequest{Type: "white"}, ShotRequest{Type: "selling"})
	f.autoApprove(true, 30)
	result, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByBudget})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range result.TaskIDs {
		if _, err := f.st.Pool.Exec(f.ctx, `UPDATE tasks SET status = 'succeeded', output_keys = jsonb_build_array('out/'||id::text||'.png') WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
	}
	var checks atomic.Int32
	checker := func(_ context.Context, prompt, output string, refs []string) (string, error) {
		checks.Add(1)
		if len(refs) != 1 || !strings.HasPrefix(output, "out/") {
			t.Errorf("checker got %s %v", output, refs)
		}
		if strings.Contains(prompt, "一杯暖一天") {
			return `{"pass":false,"issues":["标题有错别字"]}`, nil
		}
		return `{"pass":true,"issues":[]}`, nil
	}
	review, err := f.service.Review(f.ctx, f.user.ID, set.ID, checker)
	if err != nil {
		t.Fatal(err)
	}
	if checks.Load() != 2 || review.Reviewed != 2 || len(review.Failed) != 1 || len(review.AutoRedo) != 1 || review.Failed[0] != "selling" {
		t.Fatalf("review = %+v", review)
	}
	shot := review.Set.Shots[1]
	if len(shot.Attempts) != 2 || shot.Attempts[1].Via != store.CommerceApprovedByBudget || review.Set.ApprovedCents != 30 {
		t.Fatalf("auto redo = %+v", review.Set)
	}
	redone, _ := store.GetTask(f.ctx, f.st.Pool, shot.Attempts[1].TaskID)
	if !strings.Contains(redone.Prompt, "上一版检查发现的问题：标题有错别字") {
		t.Fatalf("redo prompt = %s", redone.Prompt)
	}
	// Reviewing again checks nothing new; the set is not done until the
	// redo finishes and is checked.
	again, err := f.service.Review(f.ctx, f.user.ID, set.ID, checker)
	if err != nil || again.Reviewed != 0 || again.Set.Status != store.CommerceSetGenerating {
		t.Fatalf("second review = %+v %v", again, err)
	}
	if _, err := f.st.Pool.Exec(f.ctx, `UPDATE tasks SET status = 'succeeded', output_keys = '["out/redo.png"]' WHERE id = $1`, shot.Attempts[1].TaskID); err != nil {
		t.Fatal(err)
	}
	final, err := f.service.Review(f.ctx, f.user.ID, set.ID, func(context.Context, string, string, []string) (string, error) {
		return `{"pass":false,"issues":["还是不对"]}`, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// The second failure is not redone automatically (one auto redo per
	// shot) and the budget is already used: the set is done, flagged.
	if len(final.AutoRedo) != 0 || final.Set.Status != store.CommerceSetDone {
		t.Fatalf("final = %+v", final)
	}
	view, err := f.service.BuildView(f.ctx, final.Set)
	if err != nil {
		t.Fatal(err)
	}
	if !view.Ready || view.Shots[1].Pass || !view.Shots[1].CanRedo || view.Shots[0].ImageURL == "" || view.Done != 2 {
		t.Fatalf("view = %+v", view.Shots)
	}
}

func TestToolRunCutsOutEachImage(t *testing.T) {
	f := setup(t)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "p", Name: "P", Adapter: "openai", BaseURL: "https://api.example.com", APIKey: "k", Enabled: true}}
	cfg.Models = []modelconfig.Model{
		{ID: "img", Name: "Img", ProviderID: "p", UpstreamModel: "gpt-image-2", Kind: "image", PriceCents: 10, Public: true, Default: true, Enabled: true},
		{ID: "cutout", Name: "背景移除", ProviderID: "p", UpstreamModel: "image-background-remove", Kind: modelconfig.ModelKindImageTool,
			Tool: modelconfig.ImageToolBackgroundRemove, PriceCents: 7, Public: true, Enabled: true},
	}
	if err := modelconfig.Save(f.ctx, f.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.PlanTool(f.ctx, ToolPlanInput{UserID: f.user.ID, Tool: "upscale", InputKeys: []string{"a.png"}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsupported tool err = %v", err)
	}
	set, err := f.service.PlanTool(f.ctx, ToolPlanInput{UserID: f.user.ID, Tool: ToolBackgroundRemove, InputKeys: []string{"uploads/a.png", "uploads/b.png"}})
	if err != nil {
		t.Fatal(err)
	}
	if set.Kind != store.CommerceKindTool || len(set.Shots) != 2 || set.QuotedCents != 14 || set.ModelID != "cutout" || set.Shots[1].InputKey != "uploads/b.png" {
		t.Fatalf("set = %+v", set)
	}
	confirmed := int64(14)
	result, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByUser, ExpectedTotalCents: &confirmed})
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.GetTask(f.ctx, f.st.Pool, result.TaskIDs[1])
	if err != nil {
		t.Fatal(err)
	}
	if task.Type != ToolBackgroundRemove || task.CostCents != 7 || len(task.InputKeys) != 1 || task.InputKeys[0] != "uploads/b.png" || task.Params[SetParam] != set.ID.String() {
		t.Fatalf("task = %s %d %v %v", task.Type, task.CostCents, task.InputKeys, task.Params)
	}
	// A cut-out is not checked by the vision model.
	if _, err := f.st.Pool.Exec(f.ctx, `UPDATE tasks SET status = 'succeeded', output_keys = '["out/cut.png"]' WHERE id = ANY($1)`, result.TaskIDs); err != nil {
		t.Fatal(err)
	}
	review, err := f.service.Review(f.ctx, f.user.ID, set.ID, func(context.Context, string, string, []string) (string, error) {
		t.Error("tool results must not be sent to the checker")
		return "", nil
	})
	if err != nil || review.Set.Status != store.CommerceSetDone {
		t.Fatalf("review = %+v %v", review, err)
	}
	view, _ := f.service.BuildView(f.ctx, review.Set)
	if !view.Ready || view.Kind != store.CommerceKindTool || view.WorkbenchLink != "/tools/background-remove" {
		t.Fatalf("view = %+v", view)
	}
}

// A failed image without auto-approval waits for the user: no automatic
// redo, no points counted as spent, nothing offered for download.
func TestFailedImageWithoutAutoApprovalWaitsForTheUser(t *testing.T) {
	f := setup(t)
	set := f.plan(ShotRequest{Type: "white"})
	confirmed := int64(10)
	result, err := f.service.Generate(f.ctx, f.user.ID, set.ID, GenerateInput{Via: store.CommerceApprovedByUser, ExpectedTotalCents: &confirmed})
	if err != nil {
		t.Fatal(err)
	}
	inFlight, _ := f.service.ViewByID(f.ctx, f.user.ID, set.ID)
	if inFlight.ReservedCents != 10 || inFlight.SpentCents != 0 {
		t.Fatalf("in flight = %+v", inFlight)
	}
	if _, err := f.st.Pool.Exec(f.ctx, `UPDATE tasks SET status = 'failed' WHERE id = $1`, result.TaskIDs[0]); err != nil {
		t.Fatal(err)
	}
	review, err := f.service.Review(f.ctx, f.user.ID, set.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(review.AutoRedo) != 0 || review.RedoError != "" || len(review.Failed) != 1 {
		t.Fatalf("review = %+v", review)
	}
	view, _ := f.service.BuildView(f.ctx, review.Set)
	if view.SpentCents != 0 || view.ReservedCents != 0 || view.Downloadable != 0 || !view.Shots[0].CanRedo || view.Shots[0].Pass {
		t.Fatalf("view = %+v", view)
	}
}
