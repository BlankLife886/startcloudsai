package assistantproactive

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

type setFixture struct {
	t            *testing.T
	ctx          context.Context
	st           *store.Store
	user         *store.User
	conversation uuid.UUID
	service      commerceset.Service
}

func newSetFixture(t *testing.T) *setFixture {
	t.Helper()
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("p-%s@test.dev", uuid.NewString()[:8]), "seller", "x", "user", nil)
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
	var conversation uuid.UUID
	if err := st.Pool.QueryRow(ctx, `INSERT INTO assistant_conversations (user_id) VALUES ($1) RETURNING id`, user.ID).Scan(&conversation); err != nil {
		t.Fatal(err)
	}
	return &setFixture{t: t, ctx: ctx, st: st, user: user, conversation: conversation,
		service: commerceset.Service{St: st, Enqueue: func(context.Context, string) error { return nil }}}
}

// generate plans a two-image set in the conversation and starts it.
func (f *setFixture) generate() (*store.CommerceSet, []uuid.UUID) {
	f.t.Helper()
	copyWriter := func(context.Context, string) (string, error) {
		return `{"summary":"清爽白蓝","items":[{"id":"white","headline":"","subline":"","direction":"正面"},{"id":"selling","headline":"一杯暖一天","subline":"","direction":"左图右文"}]}`, nil
	}
	conversation := f.conversation
	set, err := f.service.Plan(f.ctx, commerceset.PlanInput{UserID: f.user.ID, ConversationID: &conversation, InputKeys: []string{"uploads/cup.png"},
		Brief: commerceset.Brief{ProductName: "保温杯", Platform: "天猫", Shots: []commerceset.ShotRequest{{Type: "white"}, {Type: "selling"}}}, Copy: copyWriter})
	if err != nil {
		f.t.Fatal(err)
	}
	confirmed := set.QuotedCents
	result, err := f.service.Generate(f.ctx, f.user.ID, set.ID, commerceset.GenerateInput{Via: store.CommerceApprovedByUser, ExpectedTotalCents: &confirmed})
	if err != nil {
		f.t.Fatal(err)
	}
	return set, result.TaskIDs
}

func (f *setFixture) finish(status string, ids ...uuid.UUID) {
	f.t.Helper()
	outputs := `[]`
	if status == "succeeded" {
		outputs = `["out/a.png"]`
	}
	if _, err := f.st.Pool.Exec(f.ctx, `UPDATE tasks SET status = $2, output_keys = $3::jsonb, finished_at = now() WHERE id = ANY($1)`, ids, status, outputs); err != nil {
		f.t.Fatal(err)
	}
}

func (f *setFixture) sweep() int {
	f.t.Helper()
	count, err := AnnounceFinishedSets(f.ctx, f.st, f.service, time.Now().UTC())
	if err != nil {
		f.t.Fatal(err)
	}
	return count
}

func (f *setFixture) proactiveMessages() []*store.AssistantMessage {
	f.t.Helper()
	messages, err := store.ListAssistantMessages(f.ctx, f.st.Pool, f.conversation, 50)
	if err != nil {
		f.t.Fatal(err)
	}
	out := []*store.AssistantMessage{}
	for _, message := range messages {
		if message.Metadata["proactive"] == "task_done" {
			out = append(out, message)
		}
	}
	return out
}

func (f *setFixture) bell() []string {
	f.t.Helper()
	rows, err := f.st.Pool.Query(f.ctx, `SELECT title || ' | ' || coalesce(body, '') || ' | ' || coalesce(target_path, '')
		FROM notifications WHERE user_id = $1 AND kind = 'assistant' ORDER BY created_at`, f.user.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			f.t.Fatal(err)
		}
		out = append(out, line)
	}
	return out
}

func TestFinishedSetIsAnnouncedOncePerBatch(t *testing.T) {
	f := newSetFixture(t)
	set, tasks := f.generate()

	// Nothing while an image is still being made.
	f.finish("succeeded", tasks[0])
	if f.sweep() != 0 || len(f.bell()) != 0 {
		t.Fatal("announced before every image finished")
	}

	f.finish("failed", tasks[1])
	if f.sweep() != 1 {
		t.Fatal("finished set not announced")
	}
	messages, bell := f.proactiveMessages(), f.bell()
	if len(messages) != 1 || len(bell) != 1 {
		t.Fatalf("messages = %d bell = %v", len(messages), bell)
	}
	if text := messages[0].Content; !strings.Contains(text, "「保温杯 · 天猫」") || !strings.Contains(text, "1 张完成，1 张失败") {
		t.Fatalf("text = %s", text)
	}
	views, _ := messages[0].Metadata["dataViews"].([]any)
	if len(views) != 1 || views[0].(map[string]any)["view"] != "commerce_set" {
		t.Fatalf("dataViews = %#v", messages[0].Metadata["dataViews"])
	}
	if !strings.Contains(bell[0], "有图片失败") || !strings.HasSuffix(bell[0], "/assistant?c="+f.conversation.String()) {
		t.Fatalf("bell = %s", bell[0])
	}

	// The same batch is never announced twice.
	if f.sweep() != 0 || len(f.proactiveMessages()) != 1 {
		t.Fatal("announced the same batch twice")
	}

	// A redo is a new batch: announced again once it finishes.
	redo, err := f.service.Redo(f.ctx, f.user.ID, set.ID, []string{"selling"}, "", ptr(int64(10)))
	if err != nil {
		t.Fatal(err)
	}
	if f.sweep() != 0 {
		t.Fatal("announced while the redo was running")
	}
	f.finish("succeeded", redo.TaskIDs...)
	if f.sweep() != 1 || !strings.Contains(f.proactiveMessages()[1].Content, "2 张全部出图") {
		t.Fatalf("redo batch = %+v", f.proactiveMessages())
	}
}

func TestNoticesOffAndReviewedSetsStayQuiet(t *testing.T) {
	f := newSetFixture(t)
	off := false
	if _, err := Update(f.ctx, f.st.Pool, f.user.ID, Patch{TaskNotices: &off}); err != nil {
		t.Fatal(err)
	}
	_, tasks := f.generate()
	f.finish("succeeded", tasks...)
	if f.sweep() != 0 || len(f.bell()) != 0 || len(f.proactiveMessages()) != 0 {
		t.Fatal("posted while notices are off")
	}
	// Switching back on does not replay what finished meanwhile.
	on := true
	if _, err := Update(f.ctx, f.st.Pool, f.user.ID, Patch{TaskNotices: &on}); err != nil {
		t.Fatal(err)
	}
	if f.sweep() != 0 {
		t.Fatal("replayed an old batch")
	}

	// A set the user already reviewed on the card (they were watching) is done.
	g := newSetFixture(t)
	set, tasks := g.generate()
	g.finish("succeeded", tasks...)
	if _, err := g.service.Review(g.ctx, g.user.ID, set.ID, nil); err != nil {
		t.Fatal(err)
	}
	if g.sweep() != 0 {
		t.Fatal("announced a set the user already saw finish")
	}
}

func TestSettingsDefaultsAndValidation(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("s-%s@test.dev", uuid.NewString()[:8]), "u", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Get(ctx, st.Pool, user.ID)
	if err != nil || got != Defaults || !got.TaskNotices || !got.Alerts || got.ReportSchedule != ReportOff {
		t.Fatalf("defaults = %+v %v", got, err)
	}
	bad := "hourly"
	if _, err := Update(ctx, st.Pool, user.ID, Patch{ReportSchedule: &bad}); err == nil {
		t.Fatal("accepted an unknown schedule")
	}
	weekly := ReportWeekly
	got, err = Update(ctx, st.Pool, user.ID, Patch{ReportSchedule: &weekly})
	if err != nil || got.ReportSchedule != ReportWeekly || !got.TaskNotices {
		t.Fatalf("update = %+v %v", got, err)
	}
}

func ptr[T any](value T) *T { return &value }
