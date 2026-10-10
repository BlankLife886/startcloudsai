package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func TestAssistantCommerceSetCardEndpoints(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "p", Name: "P", Adapter: "openai", BaseURL: "https://api.example.com", APIKey: "k", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "img", Name: "Img", ProviderID: "p", UpstreamModel: "gpt-image-2", Kind: "image", PriceCents: 10, Public: true, Default: true, Enabled: true}}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	owner, ownerToken := env.newUserSession(t, "user")
	_, strangerToken := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, owner.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, owner.ID, 100, "grant", "signup_bonus", owner.ID.String(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	set, err := commerceset.Service{St: env.st}.Plan(ctx, commerceset.PlanInput{UserID: owner.ID, InputKeys: []string{"uploads/cup.png"},
		Brief: commerceset.Brief{Shots: []commerceset.ShotRequest{{Type: "white"}, {Type: "selling"}}}})
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/assistant/commerce-sets/" + set.ID.String()

	if response := env.do(t, http.MethodGet, path, nil, strangerToken); response.Code != http.StatusNotFound {
		t.Fatalf("stranger read the set: %d", response.Code)
	}
	if response := env.do(t, http.MethodPost, path+"/generate", map[string]any{"expectedTotalCents": 20}, strangerToken); response.Code == http.StatusOK {
		t.Fatal("stranger generated the set")
	}
	if response := env.do(t, http.MethodPost, path+"/generate", map[string]any{}, ownerToken); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("generate without a confirmed price: %d", response.Code)
	}
	if response := env.do(t, http.MethodPost, path+"/generate", map[string]any{"expectedTotalCents": 15}, ownerToken); response.Code != http.StatusConflict {
		t.Fatalf("generate with a stale price: %d %s", response.Code, response.Body.String())
	}
	response := env.do(t, http.MethodPost, path+"/generate", map[string]any{"expectedTotalCents": 20}, ownerToken)
	if response.Code != http.StatusOK {
		t.Fatalf("generate: %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Data commerceset.View `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.Status != store.CommerceSetGenerating || body.Data.ApprovedCents != 20 || body.Data.Shots[0].TaskID == "" {
		t.Fatalf("view = %+v", body.Data)
	}
	var tasks int
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE user_id = $1 AND type = 'ecommerce_design'`, owner.ID).Scan(&tasks); err != nil || tasks != 2 {
		t.Fatalf("tasks = %d %v", tasks, err)
	}
	if again := env.do(t, http.MethodPost, path+"/generate", map[string]any{"expectedTotalCents": 20}, ownerToken); again.Code != http.StatusUnprocessableEntity ||
		!strings.Contains(again.Body.String(), "已经全部生成") {
		t.Fatalf("second generate: %d %s", again.Code, again.Body.String())
	}
	if archive := env.do(t, http.MethodGet, path+"/archive", nil, ownerToken); archive.Code != http.StatusUnprocessableEntity {
		t.Fatalf("archive before any image: %d", archive.Code)
	}
}
