package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestPlanHistoryAttributionPaginationAndOrders(t *testing.T) {
	env := newCommunityEnv(t)
	admin, token := env.newUserSession(t, "admin")
	user, _ := env.newUserSession(t, "user")
	ctx := context.Background()
	create := func(code string) string {
		r := env.do(t, http.MethodPost, "/api/v1/admin/plans", gin.H{"code": code, "name": code, "kind": "topup", "priceCents": 100, "grantCents": 100, "recommended": true, "sort": 10}, token)
		if r.Code != 200 {
			t.Fatalf("create: %s", r.Body.String())
		}
		d, _ := decode(t, r)
		return d["id"].(string)
	}
	id := create("history-a")
	other := create("history-b")
	history := func(path string) map[string]any {
		r := env.do(t, http.MethodGet, "/api/v1/admin/plans/"+id+"/versions"+path, nil, token)
		if r.Code != 200 {
			t.Fatalf("history: %s", r.Body.String())
		}
		d, _ := decode(t, r)
		return d
	}
	first := history("")["items"].([]any)
	for _, raw := range first {
		row := raw.(map[string]any)
		if row["actorId"] != admin.ID.String() || row["actorName"] == nil {
			t.Fatalf("missing operator: %#v", row)
		}
	}
	if first[0].(map[string]any)["snapshot"].(map[string]any)["recommended"] != false {
		t.Fatal("recommendation side effect missing")
	}
	if first[1].(map[string]any)["action"] != "create" {
		t.Fatal("creation not recorded")
	}
	r := env.do(t, http.MethodPatch, "/api/v1/admin/plan-order", gin.H{"kind": "topup", "ids": []string{other, id}}, token)
	if r.Code != 200 {
		t.Fatalf("reorder: %s", r.Body.String())
	}
	reordered := history("")["items"].([]any)[0].(map[string]any)
	if reordered["actorId"] != admin.ID.String() {
		t.Fatal("reorder attribution missing")
	}
	for i := 0; i < 22; i++ {
		r = env.do(t, http.MethodPatch, "/api/v1/admin/plans/"+id, gin.H{"priceCents": 200 + i}, token)
		if r.Code != 200 {
			t.Fatalf("patch: %s", r.Body.String())
		}
	}
	page := history("")
	items := page["items"].([]any)
	if len(items) != 20 || page["nextBefore"] == float64(0) {
		t.Fatal("missing pagination")
	}
	latest := items[0].(map[string]any)
	rev := int(latest["revision"].(float64))
	if latest["actorId"] != admin.ID.String() || latest["current"] != true {
		t.Fatalf("latest metadata: %#v", latest)
	}
	last := items[19].(map[string]any)
	older := history(fmt.Sprintf("?before=%v", page["nextBefore"]))["items"].([]any)
	if last["previousRevision"] != older[0].(map[string]any)["revision"] || last["previous"] == nil {
		t.Fatal("page boundary lost predecessor")
	}
	r = env.do(t, http.MethodPatch, "/api/v1/admin/plans/"+id, gin.H{"priceCents": 221}, token)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if history("")["items"].([]any)[0].(map[string]any)["revision"] != float64(rev) {
		t.Fatal("no-op created a version")
	}
	order, err := store.InsertOrder(ctx, env.st.Pool, user.ID, uuid.MustParse(id), 221, 100, 0, "history-order")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = env.st.Pool.Exec(ctx, `UPDATE orders SET plan_revision_snapshot=$1 WHERE id=$2`, rev, order.ID); err != nil {
		t.Fatal(err)
	}
	if history("")["items"].([]any)[0].(map[string]any)["orderCount"] != float64(1) {
		t.Fatal("exact version usage missing")
	}
	for _, suffix := range []string{"", "/export"} {
		r = env.do(t, http.MethodGet, fmt.Sprintf("/api/v1/admin/orders%s?planId=%s&planRevision=%d", suffix, id, rev), nil, token)
		if r.Code != 200 {
			t.Fatalf("orders%s: %s", suffix, r.Body.String())
		}
		if suffix == "/export" && !strings.Contains(r.Body.String(), order.ID.String()) {
			t.Fatal("filtered export omitted linked order")
		}
	}
	r = env.do(t, http.MethodGet, fmt.Sprintf("/api/v1/admin/orders?planId=%s&planRevision=%d", id, rev-1), nil, token)
	data, _ := decode(t, r)
	if data["total"] != float64(0) {
		t.Fatal("version filter leaked another revision")
	}
	r = env.do(t, http.MethodGet, fmt.Sprintf("/api/v1/admin/orders/export?planId=%s&planRevision=%d", id, rev-1), nil, token)
	if r.Code != 200 || strings.Contains(r.Body.String(), order.ID.String()) {
		t.Fatal("export leaked another revision")
	}
	for _, path := range []string{
		"/api/v1/admin/plans/" + id + "/versions?before=2147483648",
		"/api/v1/admin/orders?planRevision=1",
		"/api/v1/admin/orders?planId=" + id + "&planRevision=2147483648",
	} {
		if invalid := env.do(t, http.MethodGet, path, nil, token); invalid.Code != 422 {
			t.Fatalf("invalid history filter: %d %s", invalid.Code, invalid.Body.String())
		}
	}
	if _, err = env.st.Pool.Exec(ctx, `UPDATE plan_versions SET actor_id=NULL,actor_name=NULL,action='legacy' WHERE plan_id=$1 AND revision=1`, id); err != nil {
		t.Fatal(err)
	}
	baseline := history("?before=2")["items"].([]any)[0].(map[string]any)
	if baseline["actorName"] != nil || baseline["previous"] != nil || baseline["action"] != "legacy" {
		t.Fatalf("fabricated legacy data: %#v", baseline)
	}
	// Direct system updates must not inherit a previous request's transaction-local actor.
	if _, err = env.st.Pool.Exec(ctx, `UPDATE plans SET description='system update' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if history("")["items"].([]any)[0].(map[string]any)["actorId"] != nil {
		t.Fatal("actor leaked across transactions")
	}
}
