package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/platformlog"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// 系统设置保存后必须真实改变后台任务行为：以下用例先写设置，再执行 Worker 的真实处理逻辑。

func setWorkerSetting(t *testing.T, st *store.Store, key, raw string) {
	t.Helper()
	if err := settings.Set(context.Background(), st.Pool, key, json.RawMessage(raw)); err != nil {
		t.Fatalf("set %s: %v", key, err)
	}
}

func TestSettingsEffectRetryCountAndDelaysDriveRetryScheduling(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := &Worker{St: st}
	user, err := store.InsertUser(ctx, st.Pool, "retry-effect-"+uuid.NewString()+"@test.dev", "retry", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: "image-model", Prompt: "retry", Params: map[string]any{}, Count: 1, CostCents: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	setWorkerSetting(t, st, "task_failure_retry_count", "2")
	setWorkerSetting(t, st, "task_retry_first_delay_secs", "7")
	setWorkerSetting(t, st, "task_retry_backoff_secs", "11")

	const owner = "worker:settings-effect"
	claim := func() {
		t.Helper()
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='running', lease_owner=$2, heartbeat_at=now(), lease_until=now()+interval '2 minutes' WHERE id=$1`, task.ID, owner); err != nil {
			t.Fatal(err)
		}
	}
	lastDelay := func() int64 {
		t.Helper()
		var delay int64
		if err := st.Pool.QueryRow(ctx, `SELECT (meta->>'delaySecs')::bigint FROM task_timeline_events WHERE task_id=$1 AND stage='retry' ORDER BY created_at DESC, id DESC LIMIT 1`, task.ID).Scan(&delay); err != nil {
			t.Fatal(err)
		}
		return delay
	}

	// 第 1 次失败：按「首次重试等待」
	claim()
	retried, err := w.enqueueTaskRetry(ctx, task, owner, nil)
	if err != nil || !retried || lastDelay() != 7 {
		t.Fatalf("first retry retried=%v err=%v delay=%d, want 7s", retried, err, lastDelay())
	}
	// 第 2 次失败：按「后续重试间隔」×(N-1)
	claim()
	retried, err = w.enqueueTaskRetry(ctx, task, owner, nil)
	if err != nil || !retried || lastDelay() != 11 {
		t.Fatalf("second retry retried=%v err=%v delay=%d, want 11s", retried, err, lastDelay())
	}
	// 第 3 次失败：已用完 2 次重试额度，不再重试
	claim()
	retried, err = w.enqueueTaskRetry(ctx, task, owner, nil)
	if err != nil || retried {
		t.Fatalf("third failure retried=%v err=%v, want no retry after 2 attempts", retried, err)
	}

	// 重试次数设为 0：失败直接结束
	setWorkerSetting(t, st, "task_failure_retry_count", "0")
	fresh, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: "image-model", Prompt: "no retry", Params: map[string]any{}, Count: 1, CostCents: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='running', lease_owner=$2 WHERE id=$1`, fresh.ID, owner); err != nil {
		t.Fatal(err)
	}
	if retried, err := w.enqueueTaskRetry(ctx, fresh, owner, nil); err != nil || retried {
		t.Fatalf("retry count 0 retried=%v err=%v", retried, err)
	}
}

func TestSettingsEffectAuditRetentionDeletesOnlyExpiredLogs(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := &Worker{St: st, Logs: platformlog.New(st.Pool, "worker")}
	setWorkerSetting(t, st, "audit_log_retention_days", "10")
	for _, path := range []string{"/old", "/recent"} {
		if err := store.InsertAuditLog(ctx, st.Pool, &store.AdminAuditLog{AdminEmail: "admin@test.dev", Method: "PUT", Path: path, Action: "test", Status: 200}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE admin_audit_logs SET created_at = now() - interval '20 days' WHERE path='/old'`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE admin_audit_logs SET created_at = now() - interval '5 days' WHERE path='/recent'`); err != nil {
		t.Fatal(err)
	}
	if err := w.handleCleanupSessions(ctx, nil); err != nil {
		t.Fatal(err)
	}
	var paths []string
	rows, err := st.Pool.Query(ctx, `SELECT path FROM admin_audit_logs WHERE path IN ('/old','/recent') ORDER BY path`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var p string
		_ = rows.Scan(&p)
		paths = append(paths, p)
	}
	rows.Close()
	if len(paths) != 1 || paths[0] != "/recent" {
		t.Fatalf("audit logs after cleanup = %v, want only /recent kept with 10-day retention", paths)
	}
}

func TestSettingsEffectImageVariantSettingsShapeOutputs(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := &Worker{St: st}

	// 2000×1000 的渐变图，避免被压缩得过于理想
	src := image.NewNRGBA(image.Rect(0, 0, 2000, 1000))
	for y := 0; y < 1000; y++ {
		for x := 0; x < 2000; x++ {
			src.Set(x, y, color.NRGBA{R: uint8(x * 7), G: uint8(y * 13), B: uint8((x + y) * 3), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	original := buf.Bytes()

	// 与 uploadImageOutputVariants 相同的编码参数
	encode := func() (display, thumb media.Variant) {
		t.Helper()
		cfg := w.imageVariantConfig(ctx)
		var err error
		display, err = media.EncodeVariant(original, media.VariantOptions{Format: cfg.Format, Lossless: cfg.Lossless, Quality: cfg.Quality, MaxEdge: cfg.DisplayMaxEdge})
		if err != nil {
			t.Fatal(err)
		}
		thumb, err = media.EncodeVariant(original, media.VariantOptions{Format: cfg.Format, Quality: 75, MaxEdge: cfg.ThumbMaxEdge})
		if err != nil {
			t.Fatal(err)
		}
		return display, thumb
	}
	size := func(v media.Variant) image.Point {
		t.Helper()
		cfg, _, err := image.DecodeConfig(bytes.NewReader(v.Data))
		if err != nil {
			t.Fatalf("decode %s: %v", v.ContentType, err)
		}
		return image.Pt(cfg.Width, cfg.Height)
	}

	setWorkerSetting(t, st, "image_variant_format", `"png"`)
	setWorkerSetting(t, st, "image_display_max_edge", "600")
	setWorkerSetting(t, st, "image_thumb_max_edge", "128")
	display, thumb := encode()
	if display.ContentType != "image/png" || thumb.ContentType != "image/png" {
		t.Fatalf("png setting produced %s / %s", display.ContentType, thumb.ContentType)
	}
	if got := size(display); got != image.Pt(600, 300) {
		t.Fatalf("display size = %v, want 600x300", got)
	}
	if got := size(thumb); got != image.Pt(128, 64) {
		t.Fatalf("thumbnail size = %v, want 128x64", got)
	}

	setWorkerSetting(t, st, "image_variant_format", `"webp"`)
	setWorkerSetting(t, st, "image_display_lossless", "false")
	setWorkerSetting(t, st, "image_display_quality", "30")
	low, _ := encode()
	setWorkerSetting(t, st, "image_display_quality", "95")
	high, _ := encode()
	if low.ContentType != "image/webp" || len(low.Data) >= len(high.Data) {
		t.Fatalf("webp quality 30 = %d bytes (%s), quality 95 = %d bytes; lower quality must be smaller", len(low.Data), low.ContentType, len(high.Data))
	}

	// 有损 WebP 必须是 VP8 数据块，无损必须是 VP8L（libwebp 在无损模式把 quality 当作压缩力度，不影响画质）
	if string(low.Data[12:16]) != "VP8 " {
		t.Fatalf("lossy webp chunk = %q, want VP8", low.Data[12:16])
	}
	setWorkerSetting(t, st, "image_display_lossless", "true")
	lossless, _ := encode()
	if lossless.ContentType != "image/webp" || string(lossless.Data[12:16]) != "VP8L" {
		t.Fatalf("lossless setting produced %s chunk %q, want webp VP8L", lossless.ContentType, lossless.Data[12:16])
	}
}
