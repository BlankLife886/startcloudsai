package store

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type APIWebhookEndpoint struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	Label           string
	URL             string
	SecretEncrypted string
	Events          []string
	Enabled         bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

const apiWebhookEndpointCols = `id,user_id,label,url,secret_encrypted,events,enabled,created_at,updated_at`

func scanAPIWebhookEndpoint(row pgx.Row) (*APIWebhookEndpoint, error) {
	var endpoint APIWebhookEndpoint
	err := row.Scan(&endpoint.ID, &endpoint.UserID, &endpoint.Label, &endpoint.URL,
		&endpoint.SecretEncrypted, &endpoint.Events, &endpoint.Enabled, &endpoint.CreatedAt, &endpoint.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &endpoint, nil
}

func InsertAPIWebhookEndpoint(ctx context.Context, q Q, endpoint *APIWebhookEndpoint) (*APIWebhookEndpoint, error) {
	if endpoint.ID == uuid.Nil {
		endpoint.ID = uuid.New()
	}
	return scanAPIWebhookEndpoint(q.QueryRow(ctx, `INSERT INTO api_webhook_endpoints
		(id,user_id,label,url,secret_encrypted,events,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+apiWebhookEndpointCols, endpoint.ID, endpoint.UserID, endpoint.Label, endpoint.URL,
		endpoint.SecretEncrypted, endpoint.Events, endpoint.Enabled))
}

func ListAPIWebhookEndpoints(ctx context.Context, q Q, userID uuid.UUID) ([]*APIWebhookEndpoint, error) {
	rows, err := q.Query(ctx, `SELECT `+apiWebhookEndpointCols+` FROM api_webhook_endpoints WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*APIWebhookEndpoint, 0)
	for rows.Next() {
		item, err := scanAPIWebhookEndpoint(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CountAPIWebhookEndpoints(ctx context.Context, q Q, userID uuid.UUID) (int, error) {
	var count int
	err := q.QueryRow(ctx, `SELECT count(*) FROM api_webhook_endpoints WHERE user_id=$1`, userID).Scan(&count)
	return count, err
}

func UpdateAPIWebhookEndpoint(ctx context.Context, q Q, userID, id uuid.UUID, label, url, secretEncrypted string, events []string, enabled bool) (*APIWebhookEndpoint, error) {
	item, err := scanAPIWebhookEndpoint(q.QueryRow(ctx, `UPDATE api_webhook_endpoints SET
		label=$3,url=$4,secret_encrypted=CASE WHEN $5='' THEN secret_encrypted ELSE $5 END,
		events=$6,enabled=$7,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING `+apiWebhookEndpointCols,
		id, userID, label, url, secretEncrypted, events, enabled))
	return nilOnNoRows(item, err)
}

func DeleteAPIWebhookEndpoint(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM api_webhook_endpoints WHERE id=$1 AND user_id=$2`, id, userID)
	return tag.RowsAffected() > 0, err
}

func EnqueueTaskWebhookDeliveries(ctx context.Context, q Q, task *Task, status string, at time.Time) error {
	if task == nil {
		return nil
	}
	rawAPIKeyID, _ := task.Params["_apiKeyId"].(string)
	if rawAPIKeyID == "" {
		return nil
	}
	eventType := "task." + status
	sourceID := task.ID.String()
	if task.Attempt > 0 {
		sourceID += ":" + strconv.Itoa(task.Attempt)
	}
	payload, err := json.Marshal(map[string]any{
		"id": uuid.NewString(), "type": eventType, "createdAt": at.UTC().Format(time.RFC3339Nano),
		"data": map[string]any{
			"taskId": task.ID.String(), "attempt": task.Attempt, "status": status, "type": task.Type,
			"modelId": paramText(task.Params, "_modelConfigId"), "count": task.Count,
			"errorCode": task.ErrorCode, "errorMessage": task.ErrorMessage,
		},
	})
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO api_webhook_deliveries (endpoint_id,user_id,event_type,source_id,payload)
		SELECT endpoint.id,endpoint.user_id,$2,$3,$4::jsonb FROM api_webhook_endpoints endpoint
		WHERE endpoint.user_id=$1 AND endpoint.enabled=true AND $2=ANY(endpoint.events)
		ON CONFLICT (endpoint_id,event_type,source_id) DO NOTHING`, task.UserID, eventType, sourceID, payload)
	return err
}

type ClaimedAPIWebhookDelivery struct {
	ID              uuid.UUID
	EndpointID      uuid.UUID
	URL             string
	SecretEncrypted string
	EventType       string
	Payload         json.RawMessage
	Attempts        int
}

type APIWebhookDeliveryView struct {
	ID             uuid.UUID  `json:"id"`
	EndpointID     uuid.UUID  `json:"endpointId"`
	EventType      string     `json:"eventType"`
	SourceID       string     `json:"sourceId"`
	Status         string     `json:"status"`
	Attempts       int        `json:"attempts"`
	ResponseStatus *int       `json:"responseStatus"`
	LastError      *string    `json:"lastError"`
	DeliveredAt    *time.Time `json:"deliveredAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

func ListAPIWebhookDeliveries(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]APIWebhookDeliveryView, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := q.Query(ctx, `SELECT id,endpoint_id,event_type,source_id,status,attempts,response_status,last_error,delivered_at,created_at
		FROM api_webhook_deliveries WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]APIWebhookDeliveryView, 0, limit)
	for rows.Next() {
		var item APIWebhookDeliveryView
		if err := rows.Scan(&item.ID, &item.EndpointID, &item.EventType, &item.SourceID, &item.Status,
			&item.Attempts, &item.ResponseStatus, &item.LastError, &item.DeliveredAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func RetryAPIWebhookDelivery(ctx context.Context, q Q, userID, id uuid.UUID, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE api_webhook_deliveries SET status='pending',next_attempt_at=$3,
		locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=$3
		WHERE id=$1 AND user_id=$2 AND status='dead'`, id, userID, now)
	return tag.RowsAffected() > 0, err
}

func ClaimAPIWebhookDeliveries(ctx context.Context, q Q, owner string, now time.Time, lease time.Duration, limit int) ([]ClaimedAPIWebhookDelivery, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	rows, err := q.Query(ctx, `WITH candidates AS (
		SELECT delivery.id FROM api_webhook_deliveries delivery
		WHERE delivery.status='pending' AND delivery.next_attempt_at <= $2
		  AND (delivery.locked_until IS NULL OR delivery.locked_until < $2)
		ORDER BY delivery.next_attempt_at,delivery.created_at FOR UPDATE SKIP LOCKED LIMIT $4
	), claimed AS (
		UPDATE api_webhook_deliveries delivery SET locked_by=$1,locked_until=$3,updated_at=$2
		FROM candidates WHERE delivery.id=candidates.id
		RETURNING delivery.id,delivery.endpoint_id,delivery.event_type,delivery.payload,delivery.attempts
	)
	SELECT claimed.id,claimed.endpoint_id,endpoint.url,endpoint.secret_encrypted,
		claimed.event_type,claimed.payload,claimed.attempts
	FROM claimed JOIN api_webhook_endpoints endpoint ON endpoint.id=claimed.endpoint_id
	WHERE endpoint.enabled=true`, owner, now, now.Add(lease), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ClaimedAPIWebhookDelivery, 0, limit)
	for rows.Next() {
		var item ClaimedAPIWebhookDelivery
		if err := rows.Scan(&item.ID, &item.EndpointID, &item.URL, &item.SecretEncrypted, &item.EventType, &item.Payload, &item.Attempts); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CompleteAPIWebhookDelivery(ctx context.Context, q Q, id uuid.UUID, owner string, status int, body string, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE api_webhook_deliveries SET status='delivered',attempts=attempts+1,
		response_status=$3,response_body=$4,last_error=NULL,delivered_at=$5,locked_by=NULL,locked_until=NULL,updated_at=$5
		WHERE id=$1 AND locked_by=$2`, id, owner, status, body, now)
	return err
}

func FailAPIWebhookDelivery(ctx context.Context, q Q, id uuid.UUID, owner, message string, status int, now, next time.Time, maxAttempts int) error {
	_, err := q.Exec(ctx, `UPDATE api_webhook_deliveries SET attempts=attempts+1,
		status=CASE WHEN attempts+1 >= $7 THEN 'dead' ELSE 'pending' END,
		response_status=NULLIF($4,0),last_error=$3,next_attempt_at=$6,locked_by=NULL,locked_until=NULL,updated_at=$5
		WHERE id=$1 AND locked_by=$2`, id, owner, message, status, now, next, maxAttempts)
	return err
}
