package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
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
	srv := &Server{Cfg: &config.Config{AppSecret: masterKey}, St: st}
	out, err := srv.settingsToCamel(c)
	if err != nil {
		t.Fatal(err)
	}
	masked, ok := out["sub2apiApiKey"].(json.RawMessage)
	if !ok || string(masked) != `"****1234"` {
		t.Fatalf("sub2apiApiKey = %#v", out["sub2apiApiKey"])
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
