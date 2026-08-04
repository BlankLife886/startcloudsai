package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestSettingsToCamelMasksSub2APIKey(t *testing.T) {
	st := testdb.Setup(t)
	const masterKey = "test-master-key"
	encrypted, err := settings.EncryptSecret("sub2api-secret-1234", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(encrypted)
	if err := settings.Set(context.Background(), st.Pool, "sub2api_api_key", raw); err != nil {
		t.Fatal(err)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/api/v1/admin/settings", nil)
	srv := &Server{Cfg: &config.Config{AppSecret: masterKey, WorkerConcurrency: 32}, St: st}
	out, err := srv.settingsToCamel(c)
	if err != nil {
		t.Fatal(err)
	}
	masked, ok := out["sub2apiApiKey"].(json.RawMessage)
	if !ok || string(masked) != `"****1234"` {
		t.Fatalf("sub2apiApiKey = %#v", out["sub2apiApiKey"])
	}
	if out["workerConcurrencyCeiling"] != int64(32) || out["effectiveGlobalConcurrency"] != int64(2000) {
		t.Fatalf("concurrency settings = ceiling %#v effective %#v", out["workerConcurrencyCeiling"], out["effectiveGlobalConcurrency"])
	}
	retries, ok := out["taskFailureRetryCount"].(json.RawMessage)
	if !ok || string(retries) != "0" {
		t.Fatalf("taskFailureRetryCount = %#v, want 0", out["taskFailureRetryCount"])
	}
	balancing, ok := out["crossProviderSameModelBalancingEnabled"].(json.RawMessage)
	if !ok || string(balancing) != "false" {
		t.Fatalf("crossProviderSameModelBalancingEnabled = %#v, want false", out["crossProviderSameModelBalancingEnabled"])
	}
}

func TestAdminPutSettingsValidatesTaskFailureRetryCount(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{Cfg: &config.Config{}, St: st}
	for _, body := range []string{`{"taskFailureRetryCount":-1}`, `{"taskFailureRetryCount":101}`} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s status = %d, want 422", body, recorder.Code)
		}
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(`{"taskFailureRetryCount":7,"crossProviderSameModelBalancingEnabled":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	srv.adminPutSettings(c, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid retry count status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	got, err := settings.GetInt(context.Background(), st.Pool, "task_failure_retry_count")
	if err != nil || got != 7 {
		t.Fatalf("stored retry count = %d err=%v, want 7", got, err)
	}
	balancingEnabled, err := settings.GetBool(context.Background(), st.Pool, "cross_provider_same_model_balancing_enabled")
	if err != nil || !balancingEnabled {
		t.Fatalf("stored cross-provider balancing = %v err=%v, want true", balancingEnabled, err)
	}
}

func TestAdminModelListCleansSortsAndCaps(t *testing.T) {
	models, total := adminModelList([]string{" z-model ", "a-model", "", "a-model", "m-model"}, 2)
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	if len(models) != 2 || models[0] != "a-model" || models[1] != "m-model" {
		t.Fatalf("models = %#v", models)
	}
}
