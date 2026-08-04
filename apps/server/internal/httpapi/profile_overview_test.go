package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestOverviewReturnsAssetAndSubmissionTotals(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}

	if _, err := store.InsertUserAsset(ctx, env.st.Pool, user.ID, "素材", "assets/source.png", "assets/thumb.jpg", "image/png", 128); err != nil {
		t.Fatalf("insert user asset: %v", err)
	}
	pendingTaskID := env.newSucceededTask(t, user.ID)
	approvedTaskID := env.newSucceededTask(t, user.ID)
	if _, err := store.InsertSubmission(ctx, env.st.Pool, user.ID, pendingTaskID, nil, nil, nil, nil, "pending"); err != nil {
		t.Fatalf("insert pending submission: %v", err)
	}
	if _, err := store.InsertSubmission(ctx, env.st.Pool, user.ID, approvedTaskID, nil, nil, nil, nil, "approved"); err != nil {
		t.Fatalf("insert approved submission: %v", err)
	}

	w := env.do(t, http.MethodGet, "/api/v1/me/overview", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("overview: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	if data["assetCount"] != float64(1) {
		t.Fatalf("assetCount = %v, want 1", data["assetCount"])
	}
	stats, ok := data["submissionStats"].(map[string]any)
	if !ok {
		t.Fatalf("submissionStats = %#v", data["submissionStats"])
	}
	if stats["total"] != float64(2) || stats["pending"] != float64(1) || stats["approved"] != float64(1) {
		t.Fatalf("submissionStats = %#v, want total=2 pending=1 approved=1", stats)
	}
}
