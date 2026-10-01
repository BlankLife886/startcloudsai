package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// AssistantDecisionLog is one v2 judgment, kept for shadow comparison and
// threshold tuning.
type AssistantDecisionLog struct {
	RunID         uuid.UUID
	UserID        uuid.UUID
	Provider      string
	Model         string
	Intent        string
	Confidence    float64
	RulesIntent   string
	Clarify       bool
	LowConfidence bool
	UsedFallback  bool
	Delegated     bool
	LatencyMs     int64
}

func InsertAssistantDecisionLog(ctx context.Context, q Q, entry AssistantDecisionLog) error {
	_, err := q.Exec(ctx, `INSERT INTO assistant_decision_logs
		(run_id, user_id, provider, model, intent, confidence, rules_intent, clarify, low_confidence, used_fallback, delegated, latency_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		entry.RunID, entry.UserID, entry.Provider, entry.Model, entry.Intent, entry.Confidence, entry.RulesIntent,
		entry.Clarify, entry.LowConfidence, entry.UsedFallback, entry.Delegated, entry.LatencyMs)
	return err
}

// AssistantDecisionStats summarises recent judgments for the admin page.
type AssistantDecisionStats struct {
	Since          time.Time                    `json:"since"`
	Total          int64                        `json:"total"`
	ModelAnswered  int64                        `json:"modelAnswered"`
	RulesOnly      int64                        `json:"rulesOnly"`
	UsedFallback   int64                        `json:"usedFallback"`
	LowConfidence  int64                        `json:"lowConfidence"`
	AgreeWithRules int64                        `json:"agreeWithRules"`
	Delegated      int64                        `json:"delegated"`
	Clarified      int64                        `json:"clarified"`
	AvgLatencyMs   float64                      `json:"avgLatencyMs"`
	P90LatencyMs   float64                      `json:"p90LatencyMs"`
	ByIntent       []AssistantDecisionIntentRow `json:"byIntent"`
	ByModel        []AssistantDecisionModelRow  `json:"byModel"`
}

type AssistantDecisionIntentRow struct {
	Intent string `json:"intent"`
	Count  int64  `json:"count"`
	// Agree counts turns where the rules reached the same intent.
	Agree int64 `json:"agree"`
}

type AssistantDecisionModelRow struct {
	Model         string  `json:"model"`
	Count         int64   `json:"count"`
	AvgConfidence float64 `json:"avgConfidence"`
	AvgLatencyMs  float64 `json:"avgLatencyMs"`
}

func GetAssistantDecisionStats(ctx context.Context, q Q, since time.Time) (*AssistantDecisionStats, error) {
	stats := &AssistantDecisionStats{Since: since, ByIntent: []AssistantDecisionIntentRow{}, ByModel: []AssistantDecisionModelRow{}}
	if err := q.QueryRow(ctx, `SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE provider <> 'rules'),
			COUNT(*) FILTER (WHERE provider = 'rules'),
			COUNT(*) FILTER (WHERE used_fallback),
			COUNT(*) FILTER (WHERE low_confidence),
			COUNT(*) FILTER (WHERE provider <> 'rules' AND rules_intent = intent),
			COUNT(*) FILTER (WHERE delegated),
			COUNT(*) FILTER (WHERE clarify),
			COALESCE(AVG(latency_ms), 0),
			COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms), 0)
		FROM assistant_decision_logs WHERE created_at >= $1`, since).Scan(
		&stats.Total, &stats.ModelAnswered, &stats.RulesOnly, &stats.UsedFallback, &stats.LowConfidence,
		&stats.AgreeWithRules, &stats.Delegated, &stats.Clarified, &stats.AvgLatencyMs, &stats.P90LatencyMs,
	); err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT intent, COUNT(*), COUNT(*) FILTER (WHERE rules_intent = intent)
		FROM assistant_decision_logs WHERE created_at >= $1 GROUP BY intent ORDER BY COUNT(*) DESC`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var row AssistantDecisionIntentRow
		if err := rows.Scan(&row.Intent, &row.Count, &row.Agree); err != nil {
			rows.Close()
			return nil, err
		}
		stats.ByIntent = append(stats.ByIntent, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = q.Query(ctx, `SELECT model, COUNT(*), COALESCE(AVG(confidence), 0), COALESCE(AVG(latency_ms), 0)
		FROM assistant_decision_logs WHERE created_at >= $1 AND provider <> 'rules'
		GROUP BY model ORDER BY COUNT(*) DESC LIMIT 20`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row AssistantDecisionModelRow
		if err := rows.Scan(&row.Model, &row.Count, &row.AvgConfidence, &row.AvgLatencyMs); err != nil {
			return nil, err
		}
		stats.ByModel = append(stats.ByModel, row)
	}
	return stats, rows.Err()
}
