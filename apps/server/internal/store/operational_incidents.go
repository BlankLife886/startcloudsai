package store

import (
	"context"
	"encoding/json"
	"time"
)

type OperationalIncident struct {
	Key         string         `json:"key"`
	Severity    string         `json:"severity"`
	Title       string         `json:"title"`
	Summary     string         `json:"summary"`
	Status      string         `json:"status"`
	Occurrences int64          `json:"occurrences"`
	Details     map[string]any `json:"details"`
	FirstSeenAt time.Time      `json:"firstSeenAt"`
	LastSeenAt  time.Time      `json:"lastSeenAt"`
	ResolvedAt  *time.Time     `json:"resolvedAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

type ObjectCleanupHealth struct {
	Pending       int64
	Failed        int64
	OldestCreated *time.Time
}

func UpsertOperationalIncident(ctx context.Context, q Q, incident OperationalIncident, at time.Time) error {
	details, err := json.Marshal(incident.Details)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
		INSERT INTO operational_incidents
			(incident_key, severity, title, summary, status, occurrences, details,
			 first_seen_at, last_seen_at, updated_at)
		VALUES ($1, $2, $3, $4, 'open', 1, $5, $6, $6, $6)
		ON CONFLICT (incident_key) DO UPDATE SET
			severity = EXCLUDED.severity,
			title = EXCLUDED.title,
			summary = EXCLUDED.summary,
			status = 'open',
			occurrences = CASE
				WHEN operational_incidents.status = 'resolved' THEN 1
				ELSE operational_incidents.occurrences + 1
			END,
			details = EXCLUDED.details,
			first_seen_at = CASE
				WHEN operational_incidents.status = 'resolved' THEN EXCLUDED.first_seen_at
				ELSE operational_incidents.first_seen_at
			END,
			last_seen_at = EXCLUDED.last_seen_at,
			resolved_at = NULL,
			updated_at = EXCLUDED.updated_at`,
		incident.Key, incident.Severity, incident.Title, incident.Summary, details, at)
	return err
}

func ResolveOperationalIncident(ctx context.Context, q Q, key string, at time.Time) error {
	_, err := q.Exec(ctx, `
		UPDATE operational_incidents
		SET status = 'resolved', resolved_at = $2, updated_at = $2
		WHERE incident_key = $1 AND status = 'open'`, key, at)
	return err
}

func ListOpenOperationalIncidents(ctx context.Context, q Q, limit int) ([]OperationalIncident, error) {
	if limit <= 0 {
		return []OperationalIncident{}, nil
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := q.Query(ctx, `
		SELECT incident_key, severity, title, summary, status, occurrences, details,
			first_seen_at, last_seen_at, resolved_at, updated_at
		FROM operational_incidents
		WHERE status = 'open'
		ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
			last_seen_at DESC, incident_key
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]OperationalIncident, 0, limit)
	for rows.Next() {
		var item OperationalIncident
		var details []byte
		if err := rows.Scan(
			&item.Key, &item.Severity, &item.Title, &item.Summary, &item.Status,
			&item.Occurrences, &details, &item.FirstSeenAt, &item.LastSeenAt,
			&item.ResolvedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(details, &item.Details); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func GetObjectCleanupHealth(ctx context.Context, q Q) (ObjectCleanupHealth, error) {
	var out ObjectCleanupHealth
	err := q.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE attempts > 0), min(created_at)
		FROM object_cleanup_jobs`).Scan(&out.Pending, &out.Failed, &out.OldestCreated)
	return out, err
}
