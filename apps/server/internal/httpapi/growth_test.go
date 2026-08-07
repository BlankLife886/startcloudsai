package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func ensureWallet(t *testing.T, env *communityEnv, user *store.User) {
	t.Helper()
	if err := store.InsertWallet(context.Background(), env.st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
}

func TestConcurrentGrowthGroupCreationAllowsOneActiveGroup(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ensureWallet(t, env, user)

	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(http.MethodPost, "/api/v1/me/growth/groups", bytes.NewReader(nil))
			req.Header.Set("Content-Type", "application/json")
			req.AddCookie(&http.Cookie{Name: env.cfg.SessionCookieName, Value: token})
			w := httptest.NewRecorder()
			env.engine.ServeHTTP(w, req)
			statuses <- w.Code
		}()
	}
	close(start)
	wg.Wait()
	close(statuses)

	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[http.StatusCreated] != 1 || counts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent create statuses = %#v", counts)
	}
	var groups, memberships int
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM growth_groups WHERE owner_id=$1`, user.ID).Scan(&groups); err != nil {
		t.Fatal(err)
	}
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM growth_group_members WHERE user_id=$1`, user.ID).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if groups != 1 || memberships != 1 {
		t.Fatalf("groups=%d memberships=%d, want 1/1", groups, memberships)
	}
}

func TestGrowthGroupCompletionRewardsEveryMemberOnce(t *testing.T) {
	env := newCommunityEnv(t)
	owner, ownerToken := env.newUserSession(t, "user")
	memberA, memberAToken := env.newUserSession(t, "user")
	memberB, memberBToken := env.newUserSession(t, "user")
	for _, user := range []*store.User{owner, memberA, memberB} {
		ensureWallet(t, env, user)
	}

	created := env.do(t, http.MethodPost, "/api/v1/me/growth/groups", nil, ownerToken)
	if created.Code != http.StatusCreated {
		t.Fatalf("create group status=%d body=%s", created.Code, created.Body.String())
	}
	createdData, _ := decode(t, created)
	code := createdData["code"].(string)
	for i, token := range []string{memberAToken, memberBToken} {
		joined := env.do(t, http.MethodPost, "/api/v1/me/growth/groups/join", gin.H{"code": code}, token)
		if joined.Code != http.StatusOK {
			t.Fatalf("join %d status=%d body=%s", i, joined.Code, joined.Body.String())
		}
		if i == 1 {
			data, _ := decode(t, joined)
			if data["status"] != "completed" || data["memberCount"] != float64(3) {
				t.Fatalf("completed group = %#v", data)
			}
		}
	}

	for _, user := range []*store.User{owner, memberA, memberB} {
		wallet, err := store.GetWallet(context.Background(), env.st.Pool, user.ID)
		if err != nil || wallet == nil || wallet.BalanceCents != 30 {
			t.Fatalf("user %s wallet=%#v err=%v", user.ID, wallet, err)
		}
		var rewards int
		if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM wallet_ledger
			WHERE user_id=$1 AND kind='grant' AND source_type='growth_group'`, user.ID).Scan(&rewards); err != nil {
			t.Fatal(err)
		}
		if rewards != 1 {
			t.Fatalf("user %s rewards=%d, want 1", user.ID, rewards)
		}
	}

	replayed := env.do(t, http.MethodPost, "/api/v1/me/growth/groups/join", gin.H{"code": code}, memberBToken)
	if replayed.Code != http.StatusConflict {
		t.Fatalf("replayed join status=%d body=%s", replayed.Code, replayed.Body.String())
	}
}

func TestRemovedCommercialModesAreUnavailable(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ensureWallet(t, env, user)

	if err := settings.Set(context.Background(), env.st.Pool, "free_daily_cents", json.RawMessage(`25`)); err != nil {
		t.Fatal(err)
	}
	walletResponse := env.do(t, http.MethodGet, "/api/v1/me/wallet", nil, token)
	if walletResponse.Code != http.StatusOK {
		t.Fatalf("wallet status=%d body=%s", walletResponse.Code, walletResponse.Body.String())
	}
	walletState, err := store.GetWallet(context.Background(), env.st.Pool, user.ID)
	if err != nil || walletState == nil || walletState.BalanceCents != 0 {
		t.Fatalf("legacy free daily setting changed wallet: wallet=%#v err=%v", walletState, err)
	}

	growthResponse := env.do(t, http.MethodGet, "/api/v1/me/growth", nil, token)
	if growthResponse.Code != http.StatusOK {
		t.Fatalf("growth status=%d body=%s", growthResponse.Code, growthResponse.Body.String())
	}
	growthData, _ := decode(t, growthResponse)
	removedPrograms := map[string]bool{
		"broker": true, "agent": true, "advertising": true, "ecosystem": true, "free_vip": true,
	}
	for _, raw := range growthData["programs"].([]any) {
		program := raw.(map[string]any)
		if removedPrograms[program["id"].(string)] {
			t.Fatalf("removed program is still published: %#v", program)
		}
	}

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/ads/slot"},
		{http.MethodPost, "/api/v1/ads/example/click"},
		{http.MethodPost, "/api/v1/me/commercial-applications"},
		{http.MethodGet, "/api/v1/me/commercial-operations"},
		{http.MethodPost, "/api/v1/me/commercial-operations/broker-deals"},
		{http.MethodPost, "/api/v1/me/commercial-operations/agent-referrals"},
		{http.MethodPost, "/api/v1/me/commercial-operations/ad-campaigns"},
		{http.MethodGet, "/api/v1/ecosystem/listings"},
		{http.MethodPost, "/api/v1/ecosystem/listings/example/acquisitions"},
		{http.MethodGet, "/api/v1/admin/commercial-applications"},
		{http.MethodPatch, "/api/v1/admin/commercial-applications/example"},
		{http.MethodGet, "/api/v1/admin/commercial-operations"},
		{http.MethodPatch, "/api/v1/admin/commercial-operations/partner/example"},
	}
	for _, route := range routes {
		response := env.do(t, route.method, route.path, nil, token)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s %s status=%d body=%s, want 404", route.method, route.path, response.Code, response.Body.String())
		}
	}
}
