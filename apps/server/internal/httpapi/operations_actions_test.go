package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestPlatformLogFullExportBeyond2000(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "admin")
	_, err := env.st.Pool.Exec(context.Background(), `INSERT INTO platform_logs(category,level,service,event,message,client_ip,metadata,size_bytes) SELECT 'security','error','api','login','person@example.test Bearer never-export-this','192.0.2.1','{"apiKey":"never-export-this"}'::jsonb,100 FROM generate_series(1,2105)`)
	if err != nil {
		t.Fatal(err)
	}
	response := env.do(t, http.MethodGet, "/api/v1/admin/platform-logs?category=security&ip=192.0.2.1&export=ndjson", nil, token)
	if response.Code != 200 {
		t.Fatalf("export: %d %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("missing download header")
	}
	raw := response.Body.String()
	for _, secret := range []string{"person@example.test", "never-export-this", "192.0.2.1"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("export leaked %s", secret)
		}
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	count := 0
	complete := false
	for {
		var item map[string]any
		err := decoder.Decode(&item)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if item["type"] == "log" {
			count++
		}
		if item["type"] == "summary" {
			complete = item["complete"] == true
			if int(item["count"].(float64)) != 2105 {
				t.Fatal("wrong footer count")
			}
		}
	}
	if count != 2105 || !complete {
		t.Fatalf("incomplete export: %d complete=%v", count, complete)
	}
	unauthorized := env.do(t, http.MethodGet, "/api/v1/admin/platform-logs?export=ndjson", nil, "")
	if unauthorized.Code == 200 {
		t.Fatal("unauthenticated export allowed")
	}
}

func TestAdminTaskListEndpointLatency(t *testing.T) {
	if os.Getenv("ADMIN_TASK_LATENCY_TEST") != "1" {
		t.Skip("set ADMIN_TASK_LATENCY_TEST=1 for isolated 10000-row measurement")
	}
	env := newCommunityEnv(t)
	user, _ := env.newUserSession(t, "user")
	_, token := env.newUserSession(t, "admin")
	_, err := env.st.Pool.Exec(context.Background(), `INSERT INTO tasks(user_id,type,model,status,prompt,params,count,cost_cents,created_at) SELECT $1,'t2i','bench','succeeded','benchmark','{}'::jsonb,1,0,now()-(n||' seconds')::interval FROM generate_series(1,10000)n`, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, include := range []bool{true, false} {
		times := []time.Duration{}
		for i := 0; i < 6; i++ {
			start := time.Now()
			response := env.do(t, http.MethodGet, fmt.Sprintf("/api/v1/admin/tasks?limit=20&summary=%t", include), nil, token)
			if response.Code != 200 {
				t.Fatalf("request failed: %s", response.Body.String())
			}
			if i > 0 {
				times = append(times, time.Since(start))
			}
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		t.Logf("LATENCY rows=10000 pageSize=20 summary=%t median=%s max=%s (local isolated HTTP handler, not production)", include, times[len(times)/2], times[len(times)-1])
	}
}

func TestReconcileExactlySelectedOrder(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "admin")
	_, order := makeOrder(t, env.st)
	if _, err := env.st.Pool.Exec(context.Background(), "UPDATE orders SET provider='lanjing' WHERE id=$1", order.ID); err != nil {
		t.Fatal(err)
	}
	response := env.do(t, http.MethodPost, "/api/v1/admin/payment-reconciliations/run", map[string]any{"orderId": order.ID.String(), "resolution": "check"}, token)
	data, code := decode(t, response)
	if response.Code != 200 || code != "" {
		t.Fatalf("check failed: %s", response.Body.String())
	}
	result := data["result"].(map[string]any)
	if result["orderId"] != order.ID.String() || result["outcome"] != "provider_id_missing" || result["id"].(float64) <= 0 {
		t.Fatalf("wrong persisted result: %#v", result)
	}
	var records int
	if err := env.st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM payment_reconciliations WHERE order_id=$1", order.ID).Scan(&records); err != nil || records != 1 {
		t.Fatalf("unexpected checks: %d %v", records, err)
	}
}
