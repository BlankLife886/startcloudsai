package store

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

var PlatformLogCategories = []string{"security", "operations", "user"}
var PlatformLogLevels = []string{"info", "warning", "error"}

type PlatformLog struct {
	ID         int64          `json:"id"`
	Category   string         `json:"category"`
	Level      string         `json:"level"`
	Service    string         `json:"service"`
	Event      string         `json:"event"`
	Message    string         `json:"message"`
	RequestID  *string        `json:"requestId"`
	UserID     *uuid.UUID     `json:"userId"`
	AdminID    *uuid.UUID     `json:"adminId"`
	TaskID     *uuid.UUID     `json:"taskId"`
	ClientIP   *string        `json:"clientIp"`
	StatusCode *int           `json:"statusCode"`
	DurationMs *int64         `json:"durationMs"`
	Metadata   map[string]any `json:"metadata"`
	SizeBytes  int64          `json:"sizeBytes"`
	CreatedAt  time.Time      `json:"createdAt"`
}

type NewPlatformLog struct {
	Category   string
	Level      string
	Service    string
	Event      string
	Message    string
	RequestID  *string
	UserID     *uuid.UUID
	AdminID    *uuid.UUID
	TaskID     *uuid.UUID
	ClientIP   *string
	StatusCode *int
	DurationMs *int64
	Metadata   map[string]any
}

type PlatformLogFilter struct {
	Category  string
	Level     string
	Service   string
	Route     string
	Search    string
	TaskID    *uuid.UUID
	UserID    *uuid.UUID
	RequestID string
	Since     *time.Time
	BeforeID  int64
	Limit     int
}

type PlatformLogStats struct {
	Count         int64            `json:"count"`
	LogicalBytes  int64            `json:"logicalBytes"`
	PhysicalBytes int64            `json:"physicalBytes"`
	OldestAt      *time.Time       `json:"oldestAt"`
	NewestAt      *time.Time       `json:"newestAt"`
	ByCategory    map[string]int64 `json:"byCategory"`
	ByLevel       map[string]int64 `json:"byLevel"`
}

type PlatformLogOverviewSummary struct {
	Count            int64   `json:"count"`
	ErrorCount       int64   `json:"errorCount"`
	WarningCount     int64   `json:"warningCount"`
	SlowCount        int64   `json:"slowCount"`
	AverageDuration  float64 `json:"averageDurationMs"`
	P95Duration      float64 `json:"p95DurationMs"`
	DistinctTasks    int64   `json:"distinctTasks"`
	DistinctRequests int64   `json:"distinctRequests"`
}

type PlatformLogTrendPoint struct {
	Bucket          time.Time `json:"bucket"`
	Count           int64     `json:"count"`
	ErrorCount      int64     `json:"errorCount"`
	WarningCount    int64     `json:"warningCount"`
	SlowCount       int64     `json:"slowCount"`
	AverageDuration float64   `json:"averageDurationMs"`
}

type PlatformLogEventRank struct {
	Event        string    `json:"event"`
	Category     string    `json:"category"`
	Count        int64     `json:"count"`
	ErrorCount   int64     `json:"errorCount"`
	WarningCount int64     `json:"warningCount"`
	LastAt       time.Time `json:"lastAt"`
}

type PlatformLogRouteRank struct {
	Route           string  `json:"route"`
	Service         string  `json:"service"`
	Count           int64   `json:"count"`
	ErrorCount      int64   `json:"errorCount"`
	AverageDuration float64 `json:"averageDurationMs"`
	P95Duration     float64 `json:"p95DurationMs"`
	MaximumDuration int64   `json:"maximumDurationMs"`
}

type PlatformLogTaskIssue struct {
	TaskID       uuid.UUID `json:"taskId"`
	ObjectType   string    `json:"objectType"`
	UserEmail    string    `json:"userEmail"`
	TaskType     string    `json:"taskType"`
	Status       string    `json:"status"`
	Model        string    `json:"model"`
	Provider     string    `json:"provider"`
	Attempt      int       `json:"attempt"`
	ErrorCode    string    `json:"errorCode"`
	ErrorMessage string    `json:"errorMessage"`
	LastEvent    string    `json:"lastEvent"`
	LastMessage  string    `json:"lastMessage"`
	IssueCount   int64     `json:"issueCount"`
	LastAt       time.Time `json:"lastAt"`
}

type PlatformLogOverview struct {
	Summary    PlatformLogOverviewSummary `json:"summary"`
	Trend      []PlatformLogTrendPoint    `json:"trend"`
	TopEvents  []PlatformLogEventRank     `json:"topEvents"`
	SlowRoutes []PlatformLogRouteRank     `json:"slowRoutes"`
	TaskIssues []PlatformLogTaskIssue     `json:"taskIssues"`
}

func platformLogSize(item NewPlatformLog, metadata []byte) int64 {
	size := len(item.Category) + len(item.Level) + len(item.Service) + len(item.Event) + len(item.Message) + len(metadata) + 256
	if item.RequestID != nil {
		size += len(*item.RequestID)
	}
	if item.ClientIP != nil {
		size += len(*item.ClientIP)
	}
	return int64(max(size, 1))
}

func InsertPlatformLog(ctx context.Context, q Q, item NewPlatformLog) error {
	metadata := item.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		metadataJSON = []byte(`{}`)
	}
	_, err = q.Exec(ctx, `INSERT INTO platform_logs (
		category,level,service,event,message,request_id,user_id,admin_id,task_id,
		client_ip,status_code,duration_ms,metadata,size_bytes
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		item.Category, item.Level, item.Service, item.Event, item.Message,
		item.RequestID, item.UserID, item.AdminID, item.TaskID, item.ClientIP,
		item.StatusCode, item.DurationMs, metadataJSON, platformLogSize(item, metadataJSON))
	return err
}

func ListPlatformLogs(ctx context.Context, q Q, filter PlatformLogFilter) ([]*PlatformLog, error) {
	limit := min(max(filter.Limit, 1), 200)
	args := []any{}
	where := []string{"true"}
	// The log endpoint has at most eight parameters. Build placeholders without
	// interpolating user input into SQL.
	addArg := func(clause string, value any) {
		args = append(args, value)
		where = append(where, strings.Replace(clause, "?", "$"+strconv.Itoa(len(args)), 1))
	}
	if filter.Category != "" {
		addArg("log.category = ?", filter.Category)
	}
	if filter.Level != "" {
		addArg("log.level = ?", filter.Level)
	}
	if filter.Service != "" {
		addArg("log.service = ?", filter.Service)
	}
	if filter.Route != "" {
		addArg("log.metadata->>'route' = ?", filter.Route)
	}
	if filter.TaskID != nil {
		addArg("log.task_id = ?", *filter.TaskID)
	}
	if filter.UserID != nil {
		addArg("COALESCE(log.user_id,task.user_id,run.user_id) = ?", *filter.UserID)
	}
	if filter.RequestID != "" {
		addArg("log.request_id = ?", filter.RequestID)
	}
	if filter.Since != nil {
		addArg("log.created_at >= ?", *filter.Since)
	}
	if filter.BeforeID > 0 {
		addArg("log.id < ?", filter.BeforeID)
	}
	if search := strings.TrimSpace(filter.Search); search != "" {
		addArg("(log.event ILIKE '%' || ? || '%' OR log.message ILIKE '%' || ? || '%')", search)
		args = append(args, search)
		where[len(where)-1] = strings.Replace(where[len(where)-1], "?", "$"+strconv.Itoa(len(args)), 1)
	}
	args = append(args, limit+1)
	rows, err := q.Query(ctx, `SELECT log.id,log.category,log.level,log.service,log.event,log.message,
		log.request_id,COALESCE(log.user_id,task.user_id,run.user_id),log.admin_id,log.task_id,
		host(log.client_ip),log.status_code,log.duration_ms,
		log.metadata || jsonb_strip_nulls(jsonb_build_object(
			'objectType', CASE WHEN task.id IS NOT NULL THEN 'task' WHEN run.id IS NOT NULL THEN 'assistant' END,
			'userEmail', app_user.email,
			'taskType', task.type,
			'taskStatus', COALESCE(task.status,run.status),
			'model', COALESCE(task.model,run.params->>'_resolvedModel'),
			'modelConfigId', COALESCE(task.params->>'_modelConfigId',run.params->>'_modelConfigId',run.params->>'_imageModelConfigId'),
			'attempt', COALESCE(task.attempt,run.attempt),
			'provider', COALESCE(task.params->>'_serviceProvider',run.params->>'_serviceProvider'),
			'providerDisplayName', COALESCE(task.params->>'_providerDisplayName',run.params->>'_providerDisplayName',run.params->>'_imageProviderDisplayName'),
			'providerConfigId', COALESCE(task.params->>'_providerConfigId',run.params->>'_providerConfigId'),
			'providerRouteId', COALESCE(task.params->>'_providerRouteId',run.params->>'_providerRouteId'),
			'providerRouteKey', COALESCE(task.params->>'_providerRouteKey',run.params->>'_providerRouteKey',run.params->>'_imageProviderRouteKey'),
			'providerRouteName', COALESCE(task.params->>'_providerRouteName',run.params->>'_providerRouteName',run.params->>'_imageProviderRouteName'),
			'errorCode', COALESCE(task.error_code,run.error_code),
			'errorMessage', COALESCE(task.error_message,run.error_message),
			'mode', run.mode,
			'resolvedMode', run.resolved_mode,
			'currentStage', COALESCE(task.params->>'_generationStage',run.stage),
			'requestedImages', task.count
		)),log.size_bytes,log.created_at
		FROM platform_logs log
		LEFT JOIN tasks task ON task.id = log.task_id
		LEFT JOIN assistant_runs run ON run.id = log.task_id
		LEFT JOIN users app_user ON app_user.id = COALESCE(log.user_id,task.user_id,run.user_id)
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY log.id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*PlatformLog, 0, limit+1)
	for rows.Next() {
		item := &PlatformLog{}
		var metadataJSON []byte
		if err := rows.Scan(&item.ID, &item.Category, &item.Level, &item.Service, &item.Event,
			&item.Message, &item.RequestID, &item.UserID, &item.AdminID, &item.TaskID,
			&item.ClientIP, &item.StatusCode, &item.DurationMs, &metadataJSON, &item.SizeBytes,
			&item.CreatedAt); err != nil {
			return nil, err
		}
		item.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataJSON, &item.Metadata)
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetPlatformLogOverview(ctx context.Context, q Q, since *time.Time, bucketUnit string) (*PlatformLogOverview, error) {
	overview := &PlatformLogOverview{
		Trend: []PlatformLogTrendPoint{}, TopEvents: []PlatformLogEventRank{},
		SlowRoutes: []PlatformLogRouteRank{}, TaskIssues: []PlatformLogTaskIssue{},
	}
	if err := q.QueryRow(ctx, `SELECT COUNT(*),
		COUNT(*) FILTER (WHERE level = 'error'),
		COUNT(*) FILTER (WHERE level = 'warning'),
		COUNT(*) FILTER (WHERE duration_ms >= 2000),
		COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL),0),
		COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL),0),
		COUNT(DISTINCT task_id) FILTER (WHERE task_id IS NOT NULL),
		COUNT(DISTINCT request_id) FILTER (WHERE request_id IS NOT NULL)
		FROM platform_logs WHERE ($1::timestamptz IS NULL OR created_at >= $1)`, since).Scan(
		&overview.Summary.Count, &overview.Summary.ErrorCount, &overview.Summary.WarningCount,
		&overview.Summary.SlowCount, &overview.Summary.AverageDuration, &overview.Summary.P95Duration,
		&overview.Summary.DistinctTasks, &overview.Summary.DistinctRequests,
	); err != nil {
		return nil, err
	}

	unit := "hour"
	if bucketUnit == "day" {
		unit = "day"
	}
	trendRows, err := q.Query(ctx, `SELECT date_trunc('`+unit+`',created_at) AS bucket,
		COUNT(*),COUNT(*) FILTER (WHERE level = 'error'),COUNT(*) FILTER (WHERE level = 'warning'),
		COUNT(*) FILTER (WHERE duration_ms >= 2000),
		COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL),0)
		FROM platform_logs WHERE ($1::timestamptz IS NULL OR created_at >= $1)
		GROUP BY bucket ORDER BY bucket ASC`, since)
	if err != nil {
		return nil, err
	}
	for trendRows.Next() {
		var item PlatformLogTrendPoint
		if err := trendRows.Scan(&item.Bucket, &item.Count, &item.ErrorCount, &item.WarningCount, &item.SlowCount, &item.AverageDuration); err != nil {
			trendRows.Close()
			return nil, err
		}
		overview.Trend = append(overview.Trend, item)
	}
	trendRows.Close()
	if err := trendRows.Err(); err != nil {
		return nil, err
	}

	eventRows, err := q.Query(ctx, `SELECT event,category,COUNT(*),
		COUNT(*) FILTER (WHERE level = 'error'),COUNT(*) FILTER (WHERE level = 'warning'),MAX(created_at)
		FROM platform_logs WHERE ($1::timestamptz IS NULL OR created_at >= $1)
			AND level IN ('warning','error')
		GROUP BY event,category
		ORDER BY COUNT(*) FILTER (WHERE level = 'error') DESC,
			COUNT(*) FILTER (WHERE level = 'warning') DESC,COUNT(*) DESC
		LIMIT 8`, since)
	if err != nil {
		return nil, err
	}
	for eventRows.Next() {
		var item PlatformLogEventRank
		if err := eventRows.Scan(&item.Event, &item.Category, &item.Count, &item.ErrorCount, &item.WarningCount, &item.LastAt); err != nil {
			eventRows.Close()
			return nil, err
		}
		overview.TopEvents = append(overview.TopEvents, item)
	}
	eventRows.Close()
	if err := eventRows.Err(); err != nil {
		return nil, err
	}

	routeRows, err := q.Query(ctx, `SELECT metadata->>'route',service,COUNT(*),
		COUNT(*) FILTER (WHERE level = 'error'),AVG(duration_ms),
		percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms),MAX(duration_ms)
		FROM platform_logs
		WHERE ($1::timestamptz IS NULL OR created_at >= $1)
			AND COALESCE(metadata->>'route','') <> '' AND duration_ms IS NOT NULL
		GROUP BY metadata->>'route',service
		ORDER BY percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) DESC
		LIMIT 8`, since)
	if err != nil {
		return nil, err
	}
	for routeRows.Next() {
		var item PlatformLogRouteRank
		if err := routeRows.Scan(&item.Route, &item.Service, &item.Count, &item.ErrorCount,
			&item.AverageDuration, &item.P95Duration, &item.MaximumDuration); err != nil {
			routeRows.Close()
			return nil, err
		}
		overview.SlowRoutes = append(overview.SlowRoutes, item)
	}
	routeRows.Close()
	if err := routeRows.Err(); err != nil {
		return nil, err
	}

	issueRows, err := q.Query(ctx, `WITH ranked AS (
		SELECT log.*,
			COUNT(*) OVER (PARTITION BY task_id) AS issue_count,
			ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC,id DESC) AS row_number
		FROM platform_logs log
		WHERE ($1::timestamptz IS NULL OR created_at >= $1)
			AND task_id IS NOT NULL AND level IN ('warning','error')
	)
	SELECT issue.task_id,
		CASE WHEN task.id IS NOT NULL THEN 'task' WHEN run.id IS NOT NULL THEN 'assistant' ELSE 'unknown' END,
		COALESCE(app_user.email,''),COALESCE(task.type,run.mode,''),COALESCE(task.status,run.status,''),
		COALESCE(task.model,run.params->>'_resolvedModel',''),
		COALESCE(task.params->>'_providerDisplayName',run.params->>'_providerDisplayName',run.params->>'_imageProviderDisplayName',task.params->>'_serviceProvider',run.params->>'_serviceProvider',issue.metadata->>'provider',''),
		COALESCE(task.attempt,run.attempt,0),COALESCE(task.error_code,run.error_code,issue.metadata->>'errorCode',''),
		COALESCE(task.error_message,run.error_message,''),issue.event,issue.message,issue.issue_count,issue.created_at
	FROM ranked issue
	LEFT JOIN tasks task ON task.id = issue.task_id
	LEFT JOIN assistant_runs run ON run.id = issue.task_id
	LEFT JOIN users app_user ON app_user.id = COALESCE(issue.user_id,task.user_id,run.user_id)
	WHERE issue.row_number = 1
	ORDER BY issue.created_at DESC LIMIT 10`, since)
	if err != nil {
		return nil, err
	}
	for issueRows.Next() {
		var item PlatformLogTaskIssue
		if err := issueRows.Scan(&item.TaskID, &item.ObjectType, &item.UserEmail, &item.TaskType,
			&item.Status, &item.Model, &item.Provider, &item.Attempt, &item.ErrorCode,
			&item.ErrorMessage, &item.LastEvent, &item.LastMessage, &item.IssueCount, &item.LastAt); err != nil {
			issueRows.Close()
			return nil, err
		}
		overview.TaskIssues = append(overview.TaskIssues, item)
	}
	issueRows.Close()
	if err := issueRows.Err(); err != nil {
		return nil, err
	}
	return overview, nil
}

func GetPlatformLogStats(ctx context.Context, q Q) (*PlatformLogStats, error) {
	stats := &PlatformLogStats{ByCategory: map[string]int64{}, ByLevel: map[string]int64{}}
	err := q.QueryRow(ctx, `SELECT COUNT(*),COALESCE(SUM(size_bytes),0),MIN(created_at),MAX(created_at),
		COALESCE(pg_total_relation_size('platform_logs'::regclass),0) FROM platform_logs`).Scan(
		&stats.Count, &stats.LogicalBytes, &stats.OldestAt, &stats.NewestAt, &stats.PhysicalBytes)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT category,level,COUNT(*) FROM platform_logs GROUP BY category,level`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var category, level string
		var count int64
		if err := rows.Scan(&category, &level, &count); err != nil {
			return nil, err
		}
		stats.ByCategory[category] += count
		stats.ByLevel[level] += count
	}
	return stats, rows.Err()
}

func DeletePlatformLogs(ctx context.Context, q Q, category string, before *time.Time) (int64, error) {
	result, err := q.Exec(ctx, `DELETE FROM platform_logs
		WHERE ($1 = '' OR category = $1) AND ($2::timestamptz IS NULL OR created_at < $2)`, category, before)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func CleanupPlatformLogs(ctx context.Context, q Q, cutoff time.Time, maxBytes int64) (int64, error) {
	expired, err := q.Exec(ctx, `DELETE FROM platform_logs WHERE created_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	deleted := expired.RowsAffected()
	if maxBytes <= 0 {
		return deleted, nil
	}
	result, err := q.Exec(ctx, `WITH ranked AS (
		SELECT id, SUM(size_bytes) OVER (ORDER BY created_at DESC,id DESC) AS retained_bytes
		FROM platform_logs
	), excess AS (SELECT id FROM ranked WHERE retained_bytes > $1)
	DELETE FROM platform_logs log USING excess WHERE log.id = excess.id`, maxBytes)
	if err != nil {
		return deleted, err
	}
	return deleted + result.RowsAffected(), nil
}
