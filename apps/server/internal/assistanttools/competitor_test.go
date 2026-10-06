package assistanttools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func pngDataURL(t *testing.T, width, height int) string {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

const fakeCompetitorReply = `{"summary":"深蓝大字","palette":[{"name":"蓝","hex":"#112233","role":"背景"}],
"slots":[{"type":"white","purpose":"主图","layout":"居中"},{"type":"selling","purpose":"卖点","layout":"左图右文"}],"avoidTerms":["RivalCo"]}`

func TestCompetitorAnalyzeReadsOnlyTheScreenshotsAndKeepsThemOutOfThePlan(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("rival-%s@test.dev", uuid.NewString()[:8]), "seller", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversationWithWorkspace(ctx, st.Pool, uuid.New(), user.ID, "竞品", "assistant", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var sent []string
	calls := 0
	turn := CommerceSetContext{
		ConversationID: &conversation.ID,
		InputKeys:      []string{"uploads/mine.png", "uploads/rival.png"},
		Attachments: []Attachment{
			{Key: "uploads/mine.png", DataURL: pngDataURL(t, 800, 800)},
			{Key: "uploads/rival.png", DataURL: pngDataURL(t, 750, 6000)},
		},
		Vision: func(_ context.Context, prompt string, images []string) (string, error) {
			calls++
			sent = images
			if calls == 1 {
				return "抱歉我先说两句", nil // not JSON: the tool retries once
			}
			return fakeCompetitorReply, nil
		},
	}
	service := commerceset.Service{St: st}
	if _, err := analyzeCompetitor(ctx, service, user.ID, turn, []int{3}, ""); err == nil {
		t.Fatal("an index past the attachments must fail")
	}
	result, err := analyzeCompetitor(ctx, service, user.ID, turn, []int{2}, "主要看配色")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("vision calls = %d, want a retry after a non-JSON reply", calls)
	}
	// 750×6000 is cut into screens; the user's own photo is never sent.
	if len(sent) < 5 {
		t.Fatalf("a long screenshot should arrive as several screens, got %d", len(sent))
	}
	var payload struct {
		RefID string `json:"competitorRefId"`
	}
	if err := json.Unmarshal([]byte(result.Content), &payload); err != nil || payload.RefID == "" {
		t.Fatalf("content = %s err=%v", result.Content, err)
	}
	if result.Meta["view"] != "competitor_style" {
		t.Fatalf("meta = %+v", result.Meta)
	}

	// Planning without naming the analysis still keeps the screenshot out.
	var copyImages []string
	turn.Vision = func(_ context.Context, _ string, images []string) (string, error) {
		copyImages = images
		return `{"summary":"","items":[]}`, nil
	}
	in := commerceset.PlanInput{UserID: user.ID, InputKeys: turn.InputKeys}
	if err := planCompetitor(ctx, service, user.ID, turn, &in); err != nil {
		t.Fatal(err)
	}
	if len(in.InputKeys) != 1 || in.InputKeys[0] != "uploads/mine.png" || in.Competitor != nil {
		t.Fatalf("plan input = %+v", in)
	}
	if _, err := in.Copy(ctx, "p"); err != nil || len(copyImages) != 1 || !strings.HasPrefix(copyImages[0], "data:image/png") {
		t.Fatalf("copy planner should see only the user's photo: %d images err=%v", len(copyImages), err)
	}
	in = commerceset.PlanInput{UserID: user.ID, InputKeys: turn.InputKeys, Brief: commerceset.Brief{CompetitorRefID: payload.RefID}}
	if err := planCompetitor(ctx, service, user.ID, turn, &in); err != nil || in.Competitor == nil || in.Competitor.ID.String() != payload.RefID {
		t.Fatalf("named analysis should load: %+v err=%v", in.Competitor, err)
	}
	only := commerceset.PlanInput{UserID: user.ID, InputKeys: []string{"uploads/rival.png"}}
	if err := planCompetitor(ctx, service, user.ID, turn, &only); err == nil || !strings.Contains(err.Error(), "自己的商品图") {
		t.Fatalf("screenshots alone must ask for the user's own photos: %v", err)
	}
}
