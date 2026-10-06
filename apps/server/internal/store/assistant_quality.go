package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// AssistantCorrectionPattern matches a user's next message telling the
// assistant it misunderstood ("不是这个意思", "我只是问问", "别画了"). It only
// counts the previous turn in a rate; it never changes what the assistant does.
const AssistantCorrectionPattern = `(不是这个|不是我要|不是要你|不对|错了|我没让|我没有让|没让你|不要(画|生成|出图)|别(画|生成|出图)|我只是(问|想问|想知道)|答非所问|没听懂|理解错|搞错|重新理解|我说的是|我问的是)`

// AssistantTurnEvent is one thing that happened to an assistant turn.
type AssistantTurnEvent struct {
	AssistantMessageID uuid.UUID
	Event              string
	Got                string
	Expected           string
}

// RecordAssistantTurnEvent stores an event for a v2 turn, once per turn and
// event. The turn's mode, model and prompt version are copied from the run
// and the reply, so rates can be split by them later. Turns from other
// engines are ignored.
func RecordAssistantTurnEvent(ctx context.Context, q Q, event AssistantTurnEvent) error {
	_, err := q.Exec(ctx, `
		INSERT INTO assistant_turn_events (assistant_message_id, run_id, user_id, mode, model, prompt_version, event, got, expected)
		SELECT m.id, r.id, r.user_id, r.mode,
			COALESCE(NULLIF(m.metadata->>'_chatModel', ''), m.metadata->>'_modelDisplayName', ''),
			COALESCE(m.metadata->>'systemPromptVersion', ''), $2, $3, $4
		FROM assistant_messages m
		JOIN assistant_runs r ON r.assistant_message_id = m.id
		WHERE m.id = $1 AND r.params->>'_engine' = 'v2'
		ORDER BY r.created_at DESC LIMIT 1
		ON CONFLICT (assistant_message_id, event) DO NOTHING`,
		event.AssistantMessageID, event.Event, event.Got, event.Expected)
	return err
}

// SetAssistantTurnEventDetail fills in what the user said about an event,
// e.g. the reasons for a thumbs-down, after the event was recorded.
func SetAssistantTurnEventDetail(ctx context.Context, q Q, messageID uuid.UUID, event, got string) error {
	_, err := q.Exec(ctx, `UPDATE assistant_turn_events SET got = $3 WHERE assistant_message_id = $1 AND event = $2`, messageID, event, got)
	return err
}

// DeleteAssistantTurnEvent removes an event, e.g. a thumbs-down taken back.
func DeleteAssistantTurnEvent(ctx context.Context, q Q, messageID uuid.UUID, event string) error {
	_, err := q.Exec(ctx, `DELETE FROM assistant_turn_events WHERE assistant_message_id = $1 AND event = $2`, messageID, event)
	return err
}

// LatestAssistantReplyBefore returns the newest assistant message in a
// conversation other than exclude, or nil.
func LatestAssistantReplyBefore(ctx context.Context, q Q, conversationID, exclude uuid.UUID) (*AssistantMessage, error) {
	return nilOnNoRows(scanAssistantMessage(q.QueryRow(ctx, `SELECT `+assistantMessageCols+` FROM assistant_messages
		WHERE conversation_id = $1 AND role = 'assistant' AND id <> $2
		ORDER BY created_at DESC LIMIT 1`, conversationID, exclude)))
}

// AssistantQualityGroup is the rates for one mode, model and prompt version.
type AssistantQualityGroup struct {
	Mode             string `json:"mode"`
	Model            string `json:"model"`
	PromptVersion    string `json:"promptVersion"`
	Turns            int64  `json:"turns"`
	Proposals        int64  `json:"proposals"`
	ProposalsRun     int64  `json:"proposalsRun"`
	ProposalsUnused  int64  `json:"proposalsUnused"`
	JustAsking       int64  `json:"justAsking"`
	DrawIt           int64  `json:"drawIt"`
	SearchWeb        int64  `json:"searchWeb"`
	Stopped          int64  `json:"stopped"`
	ImageDeleted     int64  `json:"imageDeleted"`
	NegativeFeedback int64  `json:"negativeFeedback"`
	CorrectedInText  int64  `json:"correctedInText"`
}

// AssistantQualityDay is one day of the headline counts.
type AssistantQualityDay struct {
	Day         string `json:"day"`
	Turns       int64  `json:"turns"`
	Proposals   int64  `json:"proposals"`
	Unused      int64  `json:"unused"`
	Corrections int64  `json:"corrections"`
	Negative    int64  `json:"negative"`
}

// assistantQualityTurns joins v2 turns since $1 with their events. A
// proposal counts as unused only once it is half an hour old, so one the
// user is still looking at is not counted.
const assistantQualityTurns = `
WITH turns AS (
	SELECT r.id, r.mode, r.created_at, m.kind,
		COALESCE(NULLIF(m.metadata->>'_chatModel', ''), m.metadata->>'_modelDisplayName', '') AS model,
		COALESCE(m.metadata->>'systemPromptVersion', '') AS prompt_version,
		(m.kind = 'proposal' AND m.created_at < now() - interval '30 minutes') AS settled_proposal,
		COALESCE(e.events, '{}') AS events
	FROM assistant_runs r
	JOIN assistant_messages m ON m.id = r.assistant_message_id
	LEFT JOIN LATERAL (
		SELECT array_agg(event) AS events FROM assistant_turn_events WHERE assistant_message_id = m.id
	) e ON true
	WHERE r.params->>'_engine' = 'v2' AND r.created_at >= $1
)`

// AssistantQualityGroups returns the rates per mode, model and prompt version.
func AssistantQualityGroups(ctx context.Context, q Q, since time.Time) ([]AssistantQualityGroup, error) {
	rows, err := q.Query(ctx, assistantQualityTurns+`
		SELECT mode, model, prompt_version, count(*),
			count(*) FILTER (WHERE kind = 'proposal'),
			count(*) FILTER (WHERE 'proposal_executed' = ANY(events)),
			count(*) FILTER (WHERE settled_proposal AND NOT 'proposal_executed' = ANY(events)),
			count(*) FILTER (WHERE 'correction_just_asking' = ANY(events)),
			count(*) FILTER (WHERE 'correction_draw_it' = ANY(events)),
			count(*) FILTER (WHERE 'correction_search_web' = ANY(events)),
			count(*) FILTER (WHERE 'stopped' = ANY(events)),
			count(*) FILTER (WHERE 'image_deleted' = ANY(events)),
			count(*) FILTER (WHERE 'negative_feedback' = ANY(events)),
			count(*) FILTER (WHERE 'corrected_in_text' = ANY(events))
		FROM turns GROUP BY mode, model, prompt_version ORDER BY count(*) DESC LIMIT 50`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []AssistantQualityGroup{}
	for rows.Next() {
		var group AssistantQualityGroup
		if err := rows.Scan(&group.Mode, &group.Model, &group.PromptVersion, &group.Turns, &group.Proposals, &group.ProposalsRun, &group.ProposalsUnused,
			&group.JustAsking, &group.DrawIt, &group.SearchWeb, &group.Stopped, &group.ImageDeleted, &group.NegativeFeedback,
			&group.CorrectedInText); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

// AssistantQualityDays returns the headline counts per day in timezone.
func AssistantQualityDays(ctx context.Context, q Q, since time.Time, timezone string) ([]AssistantQualityDay, error) {
	rows, err := q.Query(ctx, assistantQualityTurns+`
		SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day, count(*),
			count(*) FILTER (WHERE kind = 'proposal'),
			count(*) FILTER (WHERE settled_proposal AND NOT 'proposal_executed' = ANY(events)),
			count(*) FILTER (WHERE events && ARRAY['correction_just_asking', 'correction_draw_it', 'correction_search_web', 'corrected_in_text']),
			count(*) FILTER (WHERE 'negative_feedback' = ANY(events))
		FROM turns GROUP BY day ORDER BY day`, since, timezone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []AssistantQualityDay{}
	for rows.Next() {
		var day AssistantQualityDay
		if err := rows.Scan(&day.Day, &day.Turns, &day.Proposals, &day.Unused, &day.Corrections, &day.Negative); err != nil {
			return nil, err
		}
		days = append(days, day)
	}
	return days, rows.Err()
}

// AssistantCorrectionExample is one turn a user corrected.
type AssistantCorrectionExample struct {
	Event     string    `json:"event"`
	Mode      string    `json:"mode"`
	Model     string    `json:"model"`
	Prompt    string    `json:"prompt"`
	Got       string    `json:"got"`
	Expected  string    `json:"expected"`
	CreatedAt time.Time `json:"createdAt"`
}

// AssistantCorrectionSummary is the count and latest examples of one kind of
// correction.
type AssistantCorrectionSummary struct {
	Event    string                       `json:"event"`
	Count    int64                        `json:"count"`
	Examples []AssistantCorrectionExample `json:"examples"`
}

// AssistantCorrectionSummaries groups the window's corrections by kind, with
// up to perKind latest examples each.
func AssistantCorrectionSummaries(ctx context.Context, q Q, since time.Time, perKind int) ([]AssistantCorrectionSummary, error) {
	rows, err := q.Query(ctx, `
		WITH ranked AS (
			SELECT e.event, e.mode, e.model, r.prompt, e.got, e.expected, e.created_at,
				count(*) OVER (PARTITION BY e.event) AS total,
				row_number() OVER (PARTITION BY e.event ORDER BY e.created_at DESC) AS position
			FROM assistant_turn_events e
			LEFT JOIN assistant_runs r ON r.id = e.run_id
			WHERE e.created_at >= $1 AND (e.event LIKE 'correction\_%' OR e.event = 'corrected_in_text')
		)
		SELECT event, total, mode, model, COALESCE(left(prompt, 300), ''), got, expected, created_at
		FROM ranked WHERE position <= $2 ORDER BY total DESC, event, created_at DESC`, since, perKind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	summaries := []AssistantCorrectionSummary{}
	index := map[string]int{}
	for rows.Next() {
		var example AssistantCorrectionExample
		var total int64
		if err := rows.Scan(&example.Event, &total, &example.Mode, &example.Model, &example.Prompt, &example.Got, &example.Expected, &example.CreatedAt); err != nil {
			return nil, err
		}
		position, ok := index[example.Event]
		if !ok {
			position = len(summaries)
			index[example.Event] = position
			summaries = append(summaries, AssistantCorrectionSummary{Event: example.Event, Count: total})
		}
		summaries[position].Examples = append(summaries[position].Examples, example)
	}
	return summaries, rows.Err()
}

// AssistantNegativeFeedback is one thumbs-down: what the user asked, what
// the assistant replied, and the reasons the user picked.
type AssistantNegativeFeedback struct {
	MessageID      uuid.UUID `json:"messageId"`
	ConversationID uuid.UUID `json:"conversationId"`
	UserEmail      string    `json:"userEmail"`
	Mode           string    `json:"mode"`
	Model          string    `json:"model"`
	Prompt         string    `json:"prompt"`
	Reply          string    `json:"reply"`
	Kind           string    `json:"kind"`
	Reasons        []string  `json:"reasons"`
	Note           string    `json:"note"`
	CreatedAt      time.Time `json:"createdAt"`
}

// AssistantNegativeFeedbackList returns the latest thumbs-downs since a time,
// newest first. Withdrawn ones are gone: un-voting deletes the event.
func AssistantNegativeFeedbackList(ctx context.Context, q Q, since time.Time, limit int) ([]AssistantNegativeFeedback, error) {
	rows, err := q.Query(ctx, `
		SELECT m.id, m.conversation_id, COALESCE(u.email::text, ''), e.mode, e.model,
			COALESCE(left(r.prompt, 500), ''), left(m.content, 1200), m.kind,
			COALESCE(ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(m.metadata->'feedbackReasons') = 'array' THEN m.metadata->'feedbackReasons' ELSE '[]'::jsonb END)), '{}'),
			COALESCE(m.metadata->>'feedbackNote', ''), e.created_at
		FROM assistant_turn_events e
		JOIN assistant_messages m ON m.id = e.assistant_message_id
		LEFT JOIN assistant_runs r ON r.id = e.run_id
		LEFT JOIN users u ON u.id = e.user_id
		WHERE e.event = 'negative_feedback' AND e.created_at >= $1
		ORDER BY e.created_at DESC LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AssistantNegativeFeedback{}
	for rows.Next() {
		var item AssistantNegativeFeedback
		if err := rows.Scan(&item.MessageID, &item.ConversationID, &item.UserEmail, &item.Mode, &item.Model,
			&item.Prompt, &item.Reply, &item.Kind, &item.Reasons, &item.Note, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// AssistantSampledTurn is a real turn replayed by the version comparison.
type AssistantSampledTurn struct {
	RunID              uuid.UUID
	AssistantMessageID uuid.UUID
	UserMessageID      uuid.UUID
	ConversationID     uuid.UUID
	Mode               string
	Prompt             string
	Kind               string
	Status             string
	Tools              []string
	ReferenceCount     int
	Events             []string
	Expected           string
	CreatedAt          time.Time
}

// SampleAssistantTurns picks up to limit finished v2 turns since since at
// random, each with its recorded tools, events and the correction label.
func SampleAssistantTurns(ctx context.Context, q Q, since time.Time, limit int) ([]AssistantSampledTurn, error) {
	rows, err := q.Query(ctx, `
		SELECT r.id, m.id, r.user_message_id, r.conversation_id, r.mode, r.prompt, m.kind, m.status,
			COALESCE(ARRAY(
				SELECT step->>'name' FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(m.metadata->'toolSteps') = 'array' THEN m.metadata->'toolSteps' ELSE '[]'::jsonb END
				) step
			), '{}'),
			CASE WHEN jsonb_typeof(r.params->'referenceImages') = 'array' THEN jsonb_array_length(r.params->'referenceImages') ELSE 0 END,
			COALESCE((SELECT array_agg(event) FROM assistant_turn_events WHERE assistant_message_id = m.id), '{}'),
			COALESCE((SELECT expected FROM assistant_turn_events WHERE assistant_message_id = m.id AND expected <> '' ORDER BY created_at DESC LIMIT 1), ''),
			r.created_at
		FROM assistant_runs r
		JOIN assistant_messages m ON m.id = r.assistant_message_id
		WHERE r.params->>'_engine' = 'v2' AND r.created_at >= $1 AND r.status = 'succeeded' AND btrim(r.prompt) <> ''
		ORDER BY random() LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	turns := []AssistantSampledTurn{}
	for rows.Next() {
		var turn AssistantSampledTurn
		if err := rows.Scan(&turn.RunID, &turn.AssistantMessageID, &turn.UserMessageID, &turn.ConversationID, &turn.Mode, &turn.Prompt,
			&turn.Kind, &turn.Status, &turn.Tools, &turn.ReferenceCount, &turn.Events, &turn.Expected, &turn.CreatedAt); err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	return turns, rows.Err()
}

// AssistantAgentCase is a regression case from a user's correction.
type AssistantAgentCase struct {
	ID              uuid.UUID       `json:"id"`
	SourceMessageID *uuid.UUID      `json:"sourceMessageId,omitempty"`
	Mode            string          `json:"mode"`
	Context         json.RawMessage `json:"context"`
	Prompt          string          `json:"prompt"`
	ReferenceCount  int             `json:"referenceCount"`
	Expected        []string        `json:"expected"`
	Note            string          `json:"note"`
	Active          bool            `json:"active"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

// AssistantAgentCaseLimit caps the stored cases; the oldest go first.
const AssistantAgentCaseLimit = 500

const assistantAgentCaseCols = `id, source_message_id, mode, context, prompt, reference_count, expected, note, active, created_at, updated_at`

func scanAssistantAgentCase(row interface{ Scan(...any) error }) (*AssistantAgentCase, error) {
	var item AssistantAgentCase
	if err := row.Scan(&item.ID, &item.SourceMessageID, &item.Mode, &item.Context, &item.Prompt, &item.ReferenceCount,
		&item.Expected, &item.Note, &item.Active, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

// UpsertAssistantAgentCase stores the case a correction produces. The same
// sentence in the same mode keeps one case, refreshed by the latest
// correction, and the set never grows past AssistantAgentCaseLimit.
func UpsertAssistantAgentCase(ctx context.Context, q Q, item AssistantAgentCase) (*AssistantAgentCase, error) {
	if len(item.Context) == 0 {
		item.Context = json.RawMessage("[]")
	}
	saved, err := scanAssistantAgentCase(q.QueryRow(ctx, `
		INSERT INTO assistant_agent_cases (source_message_id, mode, context, prompt, prompt_key, reference_count, expected, note)
		VALUES ($1, $2, $3, $4, md5(lower(btrim($4))), $5, $6, $7)
		ON CONFLICT (mode, prompt_key) DO UPDATE SET source_message_id = EXCLUDED.source_message_id, context = EXCLUDED.context,
			reference_count = EXCLUDED.reference_count, expected = EXCLUDED.expected, note = EXCLUDED.note,
			active = true, updated_at = now()
		RETURNING `+assistantAgentCaseCols,
		item.SourceMessageID, item.Mode, item.Context, item.Prompt, item.ReferenceCount, item.Expected, item.Note))
	if err != nil {
		return nil, err
	}
	if _, err := q.Exec(ctx, `DELETE FROM assistant_agent_cases WHERE id IN (
		SELECT id FROM assistant_agent_cases ORDER BY updated_at DESC OFFSET $1)`, AssistantAgentCaseLimit); err != nil {
		return nil, err
	}
	return saved, nil
}

// ListAssistantAgentCases returns stored cases, newest first.
func ListAssistantAgentCases(ctx context.Context, q Q, activeOnly bool) ([]AssistantAgentCase, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantAgentCaseCols+` FROM assistant_agent_cases
		WHERE (NOT $1 OR active) ORDER BY updated_at DESC`, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AssistantAgentCase{}
	for rows.Next() {
		item, err := scanAssistantAgentCase(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, rows.Err()
}

// SetAssistantAgentCaseActive turns a stored case on or off.
func SetAssistantAgentCaseActive(ctx context.Context, q Q, id uuid.UUID, active bool) (*AssistantAgentCase, error) {
	return nilOnNoRows(scanAssistantAgentCase(q.QueryRow(ctx, `UPDATE assistant_agent_cases SET active = $2, updated_at = now()
		WHERE id = $1 RETURNING `+assistantAgentCaseCols, id, active)))
}

// DeleteAssistantAgentCase removes a stored case.
func DeleteAssistantAgentCase(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM assistant_agent_cases WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}
