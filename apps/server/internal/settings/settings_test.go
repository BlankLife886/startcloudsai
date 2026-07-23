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
		got.ChatModel != "stored-chat" || got.ImageModel != "stored-image" || got.TimeoutSecs != 420 {
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
	if got != want {
		t.Fatalf("resolved config = %#v, want %#v", got, want)
	}
}
