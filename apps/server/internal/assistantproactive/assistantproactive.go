// Package assistantproactive is the assistant speaking first: it tells the
// user when long work finishes, warns about unusual spending or failures,
// and sends scheduled usage reports. Every message goes both into the
// assistant conversation it belongs to and to the site notification bell.
// Each kind can be switched off; notices and alerts are on by default.
package assistantproactive

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ErrInvalid marks a settings request the caller should fix.
var ErrInvalid = errors.New("invalid proactive settings")

// Report schedules.
const (
	ReportOff    = ""
	ReportDaily  = "daily"
	ReportWeekly = "weekly"
)

// Settings are one user's switches.
type Settings struct {
	TaskNotices      bool       `json:"taskNotices"`
	Alerts           bool       `json:"alerts"`
	ReportSchedule   string     `json:"reportSchedule"`
	ReportLastSentAt *time.Time `json:"reportLastSentAt,omitempty"`
}

// Defaults apply until the user changes anything.
var Defaults = Settings{TaskNotices: true, Alerts: true, ReportSchedule: ReportOff}

// Get reads the user's settings, or the defaults.
func Get(ctx context.Context, q store.Q, userID uuid.UUID) (Settings, error) {
	settings := Defaults
	err := q.QueryRow(ctx, `SELECT task_notices, alerts, report_schedule, report_last_sent_at
		FROM assistant_proactive_settings WHERE user_id = $1`, userID).
		Scan(&settings.TaskNotices, &settings.Alerts, &settings.ReportSchedule, &settings.ReportLastSentAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Defaults, nil
	}
	return settings, err
}

// Patch changes some switches; nil fields stay as they are.
type Patch struct {
	TaskNotices    *bool   `json:"taskNotices"`
	Alerts         *bool   `json:"alerts"`
	ReportSchedule *string `json:"reportSchedule"`
}

// Update applies a patch and returns the result.
func Update(ctx context.Context, q store.Q, userID uuid.UUID, patch Patch) (Settings, error) {
	settings, err := Get(ctx, q, userID)
	if err != nil {
		return settings, err
	}
	if patch.TaskNotices != nil {
		settings.TaskNotices = *patch.TaskNotices
	}
	if patch.Alerts != nil {
		settings.Alerts = *patch.Alerts
	}
	if patch.ReportSchedule != nil {
		switch schedule := strings.TrimSpace(*patch.ReportSchedule); schedule {
		case ReportOff, ReportDaily, ReportWeekly:
			settings.ReportSchedule = schedule
		default:
			return settings, fmt.Errorf("%w: 定时报告只支持关闭、每天或每周", ErrInvalid)
		}
	}
	_, err = q.Exec(ctx, `INSERT INTO assistant_proactive_settings (user_id, task_notices, alerts, report_schedule)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET task_notices = EXCLUDED.task_notices, alerts = EXCLUDED.alerts,
			report_schedule = EXCLUDED.report_schedule, updated_at = now()`,
		userID, settings.TaskNotices, settings.Alerts, settings.ReportSchedule)
	return settings, err
}

// sourceNamespace makes notification source ids deterministic, so the same
// event (one set finishing, one alert on one day) is only ever posted once.
var sourceNamespace = uuid.MustParse("6d2f2f8e-5b8a-4d2c-9a57-3f7d8c0b9e41")

func sourceID(parts ...string) uuid.UUID {
	return uuid.NewSHA1(sourceNamespace, []byte(strings.Join(parts, "|")))
}

// Message is one proactive message.
type Message struct {
	UserID uuid.UUID
	// ConversationID is where the chat message goes; nil sends to the bell only.
	ConversationID *uuid.UUID
	// Kind tags the message ("task_done", "alert", "report") for the client.
	Kind  string
	Title string
	// Text is the chat message; Body the shorter bell text.
	Text string
	Body string
	// Link opens from the bell; defaults to the conversation.
	Link string
	// DataViews are cards shown under the chat message.
	DataViews []map[string]any
	// Source dedupes: posting the same source twice does nothing.
	SourceType string
	SourceID   uuid.UUID
}

// Post writes the chat message and the bell notification in one transaction.
// It reports false when this source was already posted.
func Post(ctx context.Context, tx pgx.Tx, message Message, now time.Time) (bool, error) {
	link := message.Link
	if link == "" && message.ConversationID != nil {
		link = "/assistant?c=" + message.ConversationID.String()
	}
	if link == "" {
		link = "/assistant"
	}
	body := message.Body
	tag, err := tx.Exec(ctx, `INSERT INTO notifications (user_id, kind, title, body, source_type, source_id, target_path)
		VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
		ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL DO NOTHING`,
		message.UserID, message.Title, &body, message.SourceType, message.SourceID, link)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if message.ConversationID == nil {
		return true, nil
	}
	metadata := map[string]any{"engine": "v2", "proactive": message.Kind}
	if len(message.DataViews) > 0 {
		metadata["dataViews"] = message.DataViews
	}
	if _, err := store.InsertAssistantMessage(ctx, tx, store.AssistantMessage{
		ID: uuid.New(), ConversationID: *message.ConversationID, Role: "assistant", Content: message.Text,
		Kind: "agent", Status: "complete", Metadata: metadata, CreatedAt: now,
	}); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_conversations SET updated_at = $3 WHERE id = $1 AND user_id = $2`,
		*message.ConversationID, message.UserID, now); err != nil {
		return false, err
	}
	return true, nil
}
