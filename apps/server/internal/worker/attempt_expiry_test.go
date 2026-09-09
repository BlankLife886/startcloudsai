package worker

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/jackc/pgx/v5"
)

func TestExpiredAttemptsRespectNewAttemptAndWorkerOwnership(t *testing.T) {
	for _, mode := range []string{"all-expired-current-route-first", "new-route-valid", "new-worker-different-route", "new-worker-same-route"} {
		t.Run(mode, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			now := time.Now().UTC()
			id, routeA, _ := insertPollableOpenAITaskWindow(t, st, ctx, now.Add(-time.Hour), now.Add(-55*time.Minute), now.Add(-30*time.Minute))
			if err := settings.Set(ctx, st.Pool, "growth_failure_bonus_enabled", json.RawMessage(`false`)); err != nil {
				t.Fatal(err)
			}
			original, err := store.GetTask(ctx, st.Pool, id)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.InsertWallet(ctx, st.Pool, original.UserID); err != nil {
				t.Fatal(err)
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := wallet.Grant(ctx, tx, original.UserID, 100, "grant", "test", id.String(), nil); err != nil {
					return err
				}
				if _, err := wallet.FreezeForTask(ctx, tx, original.UserID, id, 20, "text_to_image", nil); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `UPDATE tasks SET cost_cents=20 WHERE id=$1`, id)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			routeB := "provider-a/route-b"
			owner := "poller:" + routeB
			if mode == "new-worker-same-route" {
				routeB = routeA
			}
			if mode == "new-worker-different-route" || mode == "new-worker-same-route" {
				owner = "worker:new-submission"
			} else {
				expiresB := now.Add(-time.Minute)
				if mode == "new-route-valid" {
					expiresB = now.Add(30 * time.Minute)
				}
				if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{TaskID: id, TaskAttempt: 1, RouteKey: routeB, ProviderID: "provider-a", RouteID: "route-b", Adapter: "openai", UpstreamTaskIDs: []string{"new-attempt"}, SubmittedAt: now.Add(-40 * time.Minute), FailoverAt: now.Add(-35 * time.Minute), ExpiresAt: expiresB}); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET attempt=1,params=params || jsonb_build_object('_providerRouteKey',$2::text),lease_owner=$3,lease_until=now()+interval '15 minutes' WHERE id=$1`, id, routeB, owner); err != nil {
				t.Fatal(err)
			}
			w := &Worker{St: st, Cfg: &config.Config{AppEnv: "development"}}
			routes := []string{routeA}
			if mode == "all-expired-current-route-first" {
				routes = []string{routeB, routeA}
			}
			for _, route := range routes {
				claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, route, "expiry-order-test", now, time.Minute, 10)
				if err != nil || len(claimed) != 1 {
					t.Fatalf("claim=%d err=%v", len(claimed), err)
				}
				if !w.expireImagePollAttempt(ctx, claimed[0]) {
					t.Fatal("expired attempt not handled")
				}
			}
			current, err := store.GetTask(ctx, st.Pool, id)
			if err != nil {
				t.Fatal(err)
			}
			want := "running"
			if mode == "all-expired-current-route-first" {
				want = "failed"
			}
			if current.Status != want {
				t.Fatalf("status=%s want=%s", current.Status, want)
			}
			balance, err := store.GetWallet(ctx, st.Pool, original.UserID)
			if err != nil {
				t.Fatal(err)
			}
			wantBalance, wantFrozen := int64(80), int64(20)
			if want == "failed" {
				wantBalance, wantFrozen = 100, 0
			}
			if balance.BalanceCents != wantBalance || balance.FrozenCents != wantFrozen {
				t.Fatalf("wallet=%+v want balance=%d frozen=%d", balance, wantBalance, wantFrozen)
			}
		})
	}
}
