package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMyUsageStatsGroupsByLocalDayAndHour(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	other, _ := env.newUserSession(t, "user")
	ctx := context.Background()

	// 2026-01-01 17:30 UTC = 2026-01-02 01:30 北京时间（周五）。
	late := time.Date(2026, 1, 1, 17, 30, 0, 0, time.UTC)
	taskID := env.newSucceededTask(t, user.ID)
	if _, err := env.st.Pool.Exec(ctx,
		`UPDATE tasks SET created_at = $2::timestamptz, started_at = $2::timestamptz, finished_at = $2::timestamptz + interval '90 seconds',
			output_keys = '["a.png","b.png"]'::jsonb, deleted_output_count = 1 WHERE id = $1`, taskID, late); err != nil {
		t.Fatalf("update task: %v", err)
	}
	// 另一个用户的任务不能计入。
	otherTask := env.newSucceededTask(t, other.ID)
	if _, err := env.st.Pool.Exec(ctx, `UPDATE tasks SET created_at = $2 WHERE id = $1`, otherTask, late); err != nil {
		t.Fatalf("update other task: %v", err)
	}
	if _, err := env.st.Pool.Exec(ctx,
		`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
		 VALUES ($1, 'spend', -30, 0, 'task', $2, $3)`, user.ID, uuid.NewString(), late); err != nil {
		t.Fatalf("insert spend: %v", err)
	}

	w := env.do(t, http.MethodGet, "/api/v1/me/usage-stats?tz=Asia/Shanghai", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
	}
	var body struct {
		Data struct {
			Timezone string `json:"timezone"`
			Days     []struct {
				Date            string `json:"date"`
				Creations       int64  `json:"creations"`
				Images          int64  `json:"images"`
				Points          int64  `json:"points"`
				DurationSeconds int64  `json:"durationSeconds"`
			} `json:"days"`
			WeekdayHour [7][24]int64 `json:"weekdayHour"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data := body.Data
	if data.Timezone != "Asia/Shanghai" || len(data.Days) != 1 {
		t.Fatalf("unexpected stats: %+v", data)
	}
	day := data.Days[0]
	if day.Date != "2026-01-02" || day.Creations != 1 || day.Images != 3 || day.Points != 30 || day.DurationSeconds != 90 {
		t.Fatalf("day = %+v", day)
	}
	if data.WeekdayHour[5][1] != 1 {
		t.Fatalf("expected Friday 01:00 bucket, got %v", data.WeekdayHour[5])
	}

	w = env.do(t, http.MethodGet, "/api/v1/me/usage-stats?tz=Not/AZone", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("invalid tz status = %d", w.Code)
	}
}
