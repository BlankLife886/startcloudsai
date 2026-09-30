package apicatalog_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// A database from before the catalog (legacy Key allowlist column, former
// developerApi fields in the model JSON) upgrades the way serve does it:
// migrate to BackfillSchemaVersion, build the catalog, migrate the rest.
// Dropping the column before the catalog exists is refused.
func TestUpgradeBackfillsCatalogBeforeDroppingLegacyColumn(t *testing.T) {
	st, dbURL := testdb.SetupAt(t, apicatalog.BackfillSchemaVersion)
	ctx := context.Background()

	provider := modelconfig.Provider{ID: "p", Name: "p", Adapter: modelconfig.AdapterOpenAI, BaseURL: "http://upstream.invalid", APIKey: "k", Enabled: true}
	image := modelconfig.Model{ID: "img", Name: "gpt-image-2", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindImage, PriceCents: 12, Public: true, Enabled: true, Default: true, MaxImages: 1, Resolutions: []string{"1K"}, AspectRatios: []string{"1:1"}}
	hidden := image
	hidden.ID, hidden.Name, hidden.Default = "img-off", "gpt-image-off", false
	cfg := modelconfig.Config{Version: modelconfig.Version, Providers: []modelconfig.Provider{provider}, Models: []modelconfig.Model{image, hidden},
		Workspaces: map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {
			ModelIDs: []string{"img", "img-off"}, DefaultModelIDs: map[string]string{modelconfig.ModelKindImage: "img"},
		}}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	// Put the former per-model /v1 settings back into the stored JSON.
	raw, err := store.GetAppSetting(ctx, st.Pool, modelconfig.SettingKey)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	for _, item := range stored["models"].([]any) {
		model := item.(map[string]any)
		switch model["id"] {
		case "img":
			model["developerApiMaxConcurrency"] = 4
		case "img-off":
			model["developerApi"] = false
		}
	}
	raw, _ = json.Marshal(stored)
	if err := store.SetAppSetting(ctx, st.Pool, modelconfig.SettingKey, raw, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	user, err := store.InsertUser(ctx, st.Pool, uuid.NewString()+"@upgrade.invalid", "upgrade", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	restricted, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{UserID: user.ID, KeyPrefix: "sk-sc-upgrade", KeyHash: uuid.NewString(), Label: "restricted",
		DailyTaskLimit: 10, MonthlyTaskLimit: 100, DailySpendLimitCents: 100, MonthlySpendLimitCents: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_model_ids=$2 WHERE id=$1`, restricted.ID, []string{"img"}); err != nil {
		t.Fatal(err)
	}

	if err := store.Migrate(dbURL); err == nil || !strings.Contains(err.Error(), "尚未初始化") {
		t.Fatalf("dropping the legacy column before the catalog exists must be refused: %v", err)
	}
	if err := apicatalog.EnsureInitialized(ctx, st.Pool); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(dbURL); err != nil {
		t.Fatalf("migrate after backfill: %v", err)
	}

	var hasColumn bool
	if err := st.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_api_keys' AND column_name='allowed_model_ids')`).Scan(&hasColumn); err != nil || hasColumn {
		t.Fatalf("legacy column still present=%v err=%v", hasColumn, err)
	}
	entries, err := store.ListDeveloperAPIModels(ctx, st.Pool)
	if err != nil || len(entries) != 1 || entries[0].TargetModelID != "img" || entries[0].Status != store.DeveloperAPIModelLive || entries[0].MaxConcurrency != 4 {
		t.Fatalf("catalog = %+v err=%v", entries, err)
	}
	key, err := store.GetUserAPIKey(ctx, st.Pool, user.ID, restricted.ID)
	if err != nil || key == nil || len(key.AllowedAPIModelIDs) != 1 || key.AllowedAPIModelIDs[0] != entries[0].ID {
		t.Fatalf("key allowlist = %+v err=%v", key, err)
	}
	// Re-running the whole sequence on an upgraded database is a no-op.
	if err := store.MigrateTo(dbURL, apicatalog.BackfillSchemaVersion); err != nil {
		t.Fatalf("migrating to an older version on an upgraded database: %v", err)
	}
	if err := apicatalog.EnsureInitialized(ctx, st.Pool); err != nil {
		t.Fatal(err)
	}
}
