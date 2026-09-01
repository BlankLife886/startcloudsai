package platformlog_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/platformlog"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestRecorderStopsWritesWhenDisabledAndSanitizesMetadata(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	recorder := platformlog.New(st.Pool, "test")
	recorder.Record(ctx, platformlog.Event{Category: "security", Level: "warning", Event: "disabled"})
	stats, err := store.GetPlatformLogStats(ctx, st.Pool)
	if err != nil || stats.Count != 0 {
		t.Fatalf("disabled stats=%#v err=%v", stats, err)
	}
	for key, value := range map[string]json.RawMessage{
		"platform_logging_enabled":      json.RawMessage(`true`),
		"platform_log_security_enabled": json.RawMessage(`true`),
	} {
		if err := settings.Set(ctx, st.Pool, key, value); err != nil {
			t.Fatal(err)
		}
	}
	recorder.Invalidate()
	recorder.Record(ctx, platformlog.Event{Category: "user", Level: "info", Event: "category-disabled"})
	recorder.Record(ctx, platformlog.Event{
		Category: "security", Level: "warning", Event: "security.test", Message: "denied", ClientIP: "127.0.0.1",
		Metadata: map[string]any{"route": "/api/v1/auth/session", "token": "must-not-persist", "binary": []byte("secret")},
	})
	items, err := store.ListPlatformLogs(ctx, st.Pool, store.PlatformLogFilter{Category: "security", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ClientIP == nil || !strings.HasPrefix(*items[0].ClientIP, "127.0.0.1") {
		t.Fatalf("items=%#v", items)
	}
	if _, exists := items[0].Metadata["token"]; exists {
		t.Fatalf("sensitive metadata persisted: %#v", items[0].Metadata)
	}
	if _, exists := items[0].Metadata["binary"]; exists {
		t.Fatalf("binary metadata persisted: %#v", items[0].Metadata)
	}
	if items[0].Metadata["route"] != "/api/v1/auth/session" {
		t.Fatalf("safe metadata missing: %#v", items[0].Metadata)
	}
	if err := settings.Set(ctx, st.Pool, "platform_logging_enabled", json.RawMessage(`false`)); err != nil {
		t.Fatal(err)
	}
	recorder.Invalidate()
	recorder.Record(ctx, platformlog.Event{Category: "security", Level: "warning", Event: "disabled-again"})
	stats, err = store.GetPlatformLogStats(ctx, st.Pool)
	if err != nil || stats.Count != 1 {
		t.Fatalf("disabled again stats=%#v err=%v", stats, err)
	}
}
