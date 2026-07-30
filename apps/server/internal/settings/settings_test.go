package settings

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestResolveSub2APIUsesStoredOverrides(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	const masterKey = "test-master-key"

	encryptedKey, err := EncryptSecret("stored-api-key", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]any{
		"sub2api_base_url":     "http://stored.example",
		"sub2api_api_key":      encryptedKey,
		"sub2api_chat_model":   "stored-chat",
		"sub2api_chat_models":  map[string]string{"快速模型": "stored-fast"},
		"sub2api_image_model":  "stored-image",
		"sub2api_timeout_secs": 420,
	}
	for key, value := range values {
		raw, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if err := Set(ctx, st.Pool, key, raw); err != nil {
			t.Fatalf("set %s: %v", key, err)
		}
	}

	got, err := ResolveSub2API(ctx, st.Pool, Sub2APIConfig{
		BaseURL: "http://env.example", APIKey: "env-key", ChatModel: "env-chat",
		ImageModel: "env-image", TimeoutSecs: 300,
	}, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if got.BaseURL != "http://stored.example" || got.APIKey != "stored-api-key" ||
		got.ChatModel != "stored-chat" || got.ChatModels["快速模型"] != "stored-fast" ||
		got.ImageModel != "stored-image" || got.TimeoutSecs != 420 {
		t.Fatalf("resolved config = %#v", got)
	}
}

func TestResolveSub2APIFallsBackToEnvironment(t *testing.T) {
	st := testdb.Setup(t)
	want := Sub2APIConfig{
		BaseURL: "http://env.example", APIKey: "env-key", ChatModel: "env-chat",
		ImageModel: "env-image", TimeoutSecs: 300,
	}
	got, err := ResolveSub2API(context.Background(), st.Pool, want, "test-master-key")
	if err != nil {
		t.Fatal(err)
	}
	if got.BaseURL != want.BaseURL || got.APIKey != want.APIKey || got.ChatModel != want.ChatModel ||
		got.ImageModel != want.ImageModel || got.TimeoutSecs != want.TimeoutSecs || len(got.ChatModels) != 0 {
		t.Fatalf("resolved config = %#v, want %#v", got, want)
	}
}

func TestTaskPricesFiltersRetiredTaskTypes(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	if err := Set(ctx, st.Pool, "task_prices", json.RawMessage(`{"t2i":20,"retired_type":999}`)); err != nil {
		t.Fatal(err)
	}

	prices, raw, err := TaskPrices(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	if prices["t2i"] != 20 {
		t.Fatalf("t2i price = %d, want 20", prices["t2i"])
	}
	if _, exists := prices["retired_type"]; exists {
		t.Fatal("retired task type leaked through TaskPrices")
	}
	if string(raw) != `{"t2i":20}` {
		t.Fatalf("filtered raw prices = %s", raw)
	}
}

func TestImageServiceProviderDefaultsAndOverrides(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()

	provider, err := ImageServiceProvider(ctx, st.Pool, "t2i")
	if err != nil || provider != "c2a" {
		t.Fatalf("default t2i provider = %q, err=%v", provider, err)
	}
	provider, err = ImageServiceProvider(ctx, st.Pool, "ui_design_asset")
	if err != nil || provider != "sub2api" {
		t.Fatalf("default UI asset provider = %q, err=%v", provider, err)
	}
	if err := Set(ctx, st.Pool, "image_service_routes", json.RawMessage(`{"t2i":"sub2api"}`)); err != nil {
		t.Fatal(err)
	}
	provider, err = ImageServiceProvider(ctx, st.Pool, "t2i")
	if err != nil || provider != "sub2api" {
		t.Fatalf("overridden t2i provider = %q, err=%v", provider, err)
	}
	if err := Set(ctx, st.Pool, "image_service_routes", json.RawMessage(`{"t2i":"crun"}`)); err != nil {
		t.Fatal(err)
	}
	provider, err = ImageServiceProvider(ctx, st.Pool, "t2i")
	if err != nil || provider != "crun" {
		t.Fatalf("CRUN t2i provider = %q, err=%v", provider, err)
	}
}

func TestResolveCRUNFallsBackToEnvironment(t *testing.T) {
	st := testdb.Setup(t)
	want := CRUNConfig{BaseURL: "https://api.crun.ai", APIKey: "env-key", TimeoutSecs: 1200}
	got, err := ResolveCRUN(context.Background(), st.Pool, want, "test-master-key")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("resolved CRUN config = %#v, want %#v", got, want)
	}
}
