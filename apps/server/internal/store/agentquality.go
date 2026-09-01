package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	CanvasAgentPromptVersion    = "canvas-agent-2026-08-29"
	CanvasAgentToolVersion      = "canvas-tools-2026-08-29"
	AssistantAgentPromptVersion = "assistant-agent-2026-08-31"
	AssistantAgentToolVersion   = "assistant-tools-2026-08-31"
)

type AgentExecutionTrace struct {
	ID              uuid.UUID
	RunID           uuid.UUID
	UserID          uuid.UUID
	ProjectID       *uuid.UUID
	Workspace       string
	Model           string
	ReasoningEffort string
	PromptVersion   string
	ToolVersion     string
	InitialSnapshot json.RawMessage
	VisualSummary   json.RawMessage
	GoalContract    json.RawMessage
	CheckpointID    *string
	Status          string
	Score           *float64
	StartedAt       time.Time
	FinishedAt      *time.Time
	CreatedAt       time.Time
}

type AgentToolStep struct {
	ID                   uuid.UUID
	TraceID              uuid.UUID
	RequestID            string
	Sequence             int
	ToolName             string
	Arguments            json.RawMessage
	Result               json.RawMessage
	Status               string
	ExecutorID           *string
	RequiresConfirmation bool
	StartedAt            time.Time
	FinishedAt           *time.Time
	DurationMS           int64
	ErrorMessage         *string
}

const agentTraceCols = `id, run_id, user_id, project_id, workspace, model, reasoning_effort, prompt_version, tool_version,
	initial_snapshot, visual_summary, goal_contract, checkpoint_id, status, score, started_at, finished_at, created_at`
const qualifiedAgentTraceCols = `trace.id, trace.run_id, trace.user_id, trace.project_id, trace.workspace, trace.model, trace.reasoning_effort,
	trace.prompt_version, trace.tool_version, trace.initial_snapshot, trace.visual_summary, trace.goal_contract, trace.checkpoint_id,
	trace.status, trace.score, trace.started_at, trace.finished_at, trace.created_at`

func scanAgentExecutionTrace(row pgx.Row) (*AgentExecutionTrace, error) {
	var item AgentExecutionTrace
	err := row.Scan(&item.ID, &item.RunID, &item.UserID, &item.ProjectID, &item.Workspace, &item.Model, &item.ReasoningEffort,
		&item.PromptVersion, &item.ToolVersion, &item.InitialSnapshot, &item.VisualSummary, &item.GoalContract, &item.CheckpointID,
		&item.Status, &item.Score, &item.StartedAt, &item.FinishedAt, &item.CreatedAt)
	return nilOnNoRows(&item, err)
}

func InsertAgentExecutionTrace(ctx context.Context, q Q, runID, userID uuid.UUID, projectID *uuid.UUID, model, reasoningEffort string, snapshot, visualSummary json.RawMessage) error {
	return InsertAgentExecutionTraceVersioned(ctx, q, runID, userID, projectID, model, reasoningEffort,
		CanvasAgentPromptVersion, CanvasAgentToolVersion, snapshot, visualSummary)
}

func InsertAgentExecutionTraceVersioned(ctx context.Context, q Q, runID, userID uuid.UUID, projectID *uuid.UUID, model, reasoningEffort, promptVersion, toolVersion string, snapshot, visualSummary json.RawMessage) error {
	return InsertAgentExecutionTraceScoped(ctx, q, runID, userID, projectID, "canvas", model, reasoningEffort,
		promptVersion, toolVersion, snapshot, visualSummary)
}

func InsertAssistantAgentExecutionTrace(ctx context.Context, q Q, runID, userID uuid.UUID, model, reasoningEffort string, snapshot, visualSummary json.RawMessage) error {
	return InsertAgentExecutionTraceScoped(ctx, q, runID, userID, nil, "assistant", model, reasoningEffort,
		AssistantAgentPromptVersion, AssistantAgentToolVersion, snapshot, visualSummary)
}

func InsertAgentExecutionTraceScoped(ctx context.Context, q Q, runID, userID uuid.UUID, projectID *uuid.UUID, workspace, model, reasoningEffort, promptVersion, toolVersion string, snapshot, visualSummary json.RawMessage) error {
	if len(snapshot) == 0 {
		snapshot = json.RawMessage(`{}`)
	}
	if len(visualSummary) == 0 {
		visualSummary = json.RawMessage(`{}`)
	}
	workspace = strings.TrimSpace(workspace)
	if workspace != "assistant" {
		workspace = "canvas"
	}
	_, err := q.Exec(ctx, `INSERT INTO agent_execution_traces
		(run_id, user_id, project_id, workspace, model, reasoning_effort, prompt_version, tool_version, initial_snapshot, visual_summary)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (run_id) DO NOTHING`,
		runID, userID, projectID, workspace, model, reasoningEffort, promptVersion, toolVersion, snapshot, visualSummary)
	return err
}

func UpdateAgentTraceGoalContract(ctx context.Context, q Q, runID uuid.UUID, contract json.RawMessage) error {
	if len(contract) == 0 || !json.Valid(contract) {
		contract = json.RawMessage(`{}`)
	}
	_, err := q.Exec(ctx, `UPDATE agent_execution_traces SET goal_contract=$2 WHERE run_id=$1`, runID, contract)
	return err
}

type AgentQualitySummary struct {
	TotalTraces     int64   `json:"totalTraces"`
	SucceededTraces int64   `json:"succeededTraces"`
	FailedTraces    int64   `json:"failedTraces"`
	CanceledTraces  int64   `json:"canceledTraces"`
	RunningTraces   int64   `json:"runningTraces"`
	AverageScore    float64 `json:"averageScore"`
	AverageDuration int64   `json:"averageDurationMs"`
	ToolSteps       int64   `json:"toolSteps"`
	FailedSteps     int64   `json:"failedSteps"`
	UnfinishedSteps int64   `json:"unfinishedSteps"`
	ConfirmedSteps  int64   `json:"confirmedSteps"`
}

type AgentQualityVersion struct {
	Workspace       string  `json:"workspace"`
	Model           string  `json:"model"`
	ReasoningEffort string  `json:"reasoningEffort"`
	PromptVersion   string  `json:"promptVersion"`
	ToolVersion     string  `json:"toolVersion"`
	TraceCount      int64   `json:"traceCount"`
	Succeeded       int64   `json:"succeeded"`
	Failed          int64   `json:"failed"`
	AverageScore    float64 `json:"averageScore"`
	AverageDuration int64   `json:"averageDurationMs"`
}

type AgentTraceSummary struct {
	Trace           AgentExecutionTrace `json:"trace"`
	UserEmail       string              `json:"userEmail"`
	StepCount       int64               `json:"stepCount"`
	FailedSteps     int64               `json:"failedSteps"`
	UnfinishedSteps int64               `json:"unfinishedSteps"`
	DurationMS      int64               `json:"durationMs"`
}

type AgentTraceListOptions struct {
	Since           time.Time
	Workspace       string
	Status          string
	Model           string
	ReasoningEffort string
	PromptVersion   string
	ToolVersion     string
	Limit           int
}

func GetAgentQualitySummary(ctx context.Context, q Q, since time.Time) (AgentQualitySummary, error) {
	return GetAgentQualitySummaryScoped(ctx, q, since, "canvas")
}

func GetAgentQualitySummaryScoped(ctx context.Context, q Q, since time.Time, workspace string) (AgentQualitySummary, error) {
	var out AgentQualitySummary
	err := q.QueryRow(ctx, `WITH trace_stats AS (
		SELECT count(*) total,
			count(*) FILTER (WHERE status='succeeded') succeeded,
			count(*) FILTER (WHERE status='failed') failed,
			count(*) FILTER (WHERE status='canceled') canceled,
			count(*) FILTER (WHERE status='running') running,
			COALESCE(avg(score),0)::float8 avg_score,
			COALESCE(avg(extract(epoch FROM (COALESCE(finished_at, now())-started_at))*1000),0)::bigint avg_duration
		FROM agent_execution_traces WHERE started_at >= $1 AND ($2='' OR workspace=$2)
	), step_stats AS (
		SELECT count(step.id) total,
			count(step.id) FILTER (WHERE step.status='failed') failed,
			count(step.id) FILTER (WHERE step.status IN ('pending','claimed')) unfinished,
			count(step.id) FILTER (WHERE step.requires_confirmation AND step.status='succeeded') confirmed
		FROM agent_tool_steps step JOIN agent_execution_traces trace ON trace.id=step.trace_id
		WHERE trace.started_at >= $1 AND ($2='' OR trace.workspace=$2)
	)
	SELECT trace_stats.total, trace_stats.succeeded, trace_stats.failed, trace_stats.canceled, trace_stats.running,
		trace_stats.avg_score, trace_stats.avg_duration, step_stats.total, step_stats.failed, step_stats.unfinished, step_stats.confirmed
	FROM trace_stats CROSS JOIN step_stats`, since, strings.TrimSpace(workspace)).Scan(&out.TotalTraces, &out.SucceededTraces, &out.FailedTraces,
		&out.CanceledTraces, &out.RunningTraces, &out.AverageScore, &out.AverageDuration,
		&out.ToolSteps, &out.FailedSteps, &out.UnfinishedSteps, &out.ConfirmedSteps)
	return out, err
}

func ListAgentQualityVersions(ctx context.Context, q Q, since time.Time, limit int) ([]AgentQualityVersion, error) {
	return ListAgentQualityVersionsScoped(ctx, q, since, "canvas", limit)
}

func ListAgentQualityVersionsScoped(ctx context.Context, q Q, since time.Time, workspace string, limit int) ([]AgentQualityVersion, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := q.Query(ctx, `SELECT workspace, model, reasoning_effort, prompt_version, tool_version, count(*),
		count(*) FILTER (WHERE status='succeeded'), count(*) FILTER (WHERE status='failed'),
		COALESCE(avg(score),0)::float8,
		COALESCE(avg(extract(epoch FROM (COALESCE(finished_at, now())-started_at))*1000),0)::bigint
		FROM agent_execution_traces WHERE started_at >= $1 AND ($2='' OR workspace=$2)
		GROUP BY workspace, model, reasoning_effort, prompt_version, tool_version
		ORDER BY count(*) DESC, workspace, model, reasoning_effort LIMIT $3`, since, strings.TrimSpace(workspace), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AgentQualityVersion, 0)
	for rows.Next() {
		var item AgentQualityVersion
		if err := rows.Scan(&item.Workspace, &item.Model, &item.ReasoningEffort, &item.PromptVersion, &item.ToolVersion,
			&item.TraceCount, &item.Succeeded, &item.Failed, &item.AverageScore, &item.AverageDuration); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ListAdminAgentExecutionTraces(ctx context.Context, q Q, options AgentTraceListOptions) ([]AgentTraceSummary, error) {
	if options.Limit <= 0 || options.Limit > 200 {
		options.Limit = 50
	}
	rows, err := q.Query(ctx, `SELECT `+qualifiedAgentTraceCols+`, COALESCE(users.email,''),
		COALESCE(steps.total,0), COALESCE(steps.failed,0), COALESCE(steps.unfinished,0),
		GREATEST(0, floor(extract(epoch FROM (COALESCE(trace.finished_at, now())-trace.started_at))*1000)::bigint)
		FROM agent_execution_traces trace
		JOIN users ON users.id=trace.user_id
		LEFT JOIN LATERAL (
			SELECT count(*) total, count(*) FILTER (WHERE status='failed') failed,
				count(*) FILTER (WHERE status IN ('pending','claimed')) unfinished
			FROM agent_tool_steps WHERE trace_id=trace.id
		) steps ON true
		WHERE trace.started_at >= $1 AND ($2='' OR trace.workspace=$2)
		  AND ($3='' OR trace.status=$3) AND ($4='' OR trace.model=$4)
		  AND ($5='' OR trace.reasoning_effort=$5) AND ($6='' OR trace.prompt_version=$6)
		  AND ($7='' OR trace.tool_version=$7)
		ORDER BY trace.started_at DESC, trace.id DESC LIMIT $8`, options.Since, strings.TrimSpace(options.Workspace), strings.TrimSpace(options.Status),
		strings.TrimSpace(options.Model), strings.TrimSpace(options.ReasoningEffort), strings.TrimSpace(options.PromptVersion),
		strings.TrimSpace(options.ToolVersion), options.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AgentTraceSummary, 0)
	for rows.Next() {
		var item AgentTraceSummary
		if err := rows.Scan(&item.Trace.ID, &item.Trace.RunID, &item.Trace.UserID, &item.Trace.ProjectID, &item.Trace.Workspace,
			&item.Trace.Model, &item.Trace.ReasoningEffort, &item.Trace.PromptVersion, &item.Trace.ToolVersion,
			&item.Trace.InitialSnapshot, &item.Trace.VisualSummary, &item.Trace.GoalContract, &item.Trace.CheckpointID, &item.Trace.Status,
			&item.Trace.Score, &item.Trace.StartedAt, &item.Trace.FinishedAt, &item.Trace.CreatedAt,
			&item.UserEmail, &item.StepCount, &item.FailedSteps, &item.UnfinishedSteps, &item.DurationMS); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetAgentExecutionTrace(ctx context.Context, q Q, id uuid.UUID) (*AgentExecutionTrace, error) {
	return scanAgentExecutionTrace(q.QueryRow(ctx, `SELECT `+agentTraceCols+` FROM agent_execution_traces WHERE id=$1`, id))
}

type AgentEvalCase struct {
	ID        uuid.UUID
	Key       string
	Workspace string
	Category  string
	Title     string
	Input     json.RawMessage
	Expected  json.RawMessage
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type AgentEvalRun struct {
	ID              uuid.UUID
	Workspace       string
	Model           string
	ReasoningEffort string
	PromptVersion   string
	ToolVersion     string
	Status          string
	Total           int
	Passed          int
	Score           float64
	SampleSize      int
	Metadata        json.RawMessage
	StartedAt       time.Time
	FinishedAt      *time.Time
}

type AgentEvalResult struct {
	EvalRunID    uuid.UUID
	CaseID       uuid.UUID
	TraceID      *uuid.UUID
	Passed       bool
	Score        float64
	Metrics      json.RawMessage
	ErrorMessage *string
	CreatedAt    time.Time
}

const agentEvalRunCols = `id, workspace, model, reasoning_effort, prompt_version, tool_version, status, total, passed, score, sample_size, metadata, started_at, finished_at`

func ListAgentEvalCases(ctx context.Context, q Q, activeOnly bool) ([]AgentEvalCase, error) {
	return ListAgentEvalCasesScoped(ctx, q, "canvas", activeOnly)
}

func ListAgentEvalCasesScoped(ctx context.Context, q Q, workspace string, activeOnly bool) ([]AgentEvalCase, error) {
	rows, err := q.Query(ctx, `SELECT id,key,workspace,category,title,input,expected,active,created_at,updated_at
		FROM agent_eval_cases WHERE ($1='' OR workspace=$1) AND (NOT $2 OR active) ORDER BY workspace,category,key`, strings.TrimSpace(workspace), activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AgentEvalCase, 0)
	for rows.Next() {
		var item AgentEvalCase
		if err := rows.Scan(&item.ID, &item.Key, &item.Workspace, &item.Category, &item.Title, &item.Input, &item.Expected,
			&item.Active, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func SetAgentEvalCaseActive(ctx context.Context, q Q, id uuid.UUID, active bool) (*AgentEvalCase, error) {
	var item AgentEvalCase
	err := q.QueryRow(ctx, `UPDATE agent_eval_cases SET active=$2,updated_at=now() WHERE id=$1
		RETURNING id,key,workspace,category,title,input,expected,active,created_at,updated_at`, id, active).Scan(
		&item.ID, &item.Key, &item.Workspace, &item.Category, &item.Title, &item.Input, &item.Expected, &item.Active, &item.CreatedAt, &item.UpdatedAt)
	return nilOnNoRows(&item, err)
}

func InsertAgentEvalRun(ctx context.Context, q Q, model, reasoningEffort, promptVersion, toolVersion string, sampleSize int, metadata json.RawMessage) (*AgentEvalRun, error) {
	return InsertAgentEvalRunScoped(ctx, q, "canvas", model, reasoningEffort, promptVersion, toolVersion, sampleSize, metadata)
}

func InsertAgentEvalRunScoped(ctx context.Context, q Q, workspace, model, reasoningEffort, promptVersion, toolVersion string, sampleSize int, metadata json.RawMessage) (*AgentEvalRun, error) {
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	if strings.TrimSpace(workspace) != "assistant" {
		workspace = "canvas"
	}
	var item AgentEvalRun
	err := q.QueryRow(ctx, `INSERT INTO agent_eval_runs (workspace,model,reasoning_effort,prompt_version,tool_version,sample_size,metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING `+agentEvalRunCols,
		workspace, model, reasoningEffort, promptVersion, toolVersion, sampleSize, metadata).Scan(&item.ID, &item.Workspace, &item.Model,
		&item.ReasoningEffort, &item.PromptVersion, &item.ToolVersion, &item.Status, &item.Total,
		&item.Passed, &item.Score, &item.SampleSize, &item.Metadata, &item.StartedAt, &item.FinishedAt)
	return nilOnNoRows(&item, err)
}

func InsertAgentEvalResult(ctx context.Context, q Q, item AgentEvalResult) error {
	if len(item.Metrics) == 0 {
		item.Metrics = json.RawMessage(`{}`)
	}
	_, err := q.Exec(ctx, `INSERT INTO agent_eval_results (eval_run_id,case_id,trace_id,passed,score,metrics,error_message)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, item.EvalRunID, item.CaseID, item.TraceID, item.Passed, item.Score, item.Metrics, item.ErrorMessage)
	return err
}

func FinishAgentEvalRun(ctx context.Context, q Q, id uuid.UUID, status string, total, passed int, score float64, finishedAt time.Time) (*AgentEvalRun, error) {
	var item AgentEvalRun
	err := q.QueryRow(ctx, `UPDATE agent_eval_runs SET status=$2,total=$3,passed=$4,score=$5,finished_at=$6
		WHERE id=$1 RETURNING `+agentEvalRunCols, id, status, total, passed, score, finishedAt).Scan(&item.ID, &item.Workspace,
		&item.Model, &item.ReasoningEffort, &item.PromptVersion, &item.ToolVersion, &item.Status, &item.Total,
		&item.Passed, &item.Score, &item.SampleSize, &item.Metadata, &item.StartedAt, &item.FinishedAt)
	return nilOnNoRows(&item, err)
}

func ListAgentEvalRuns(ctx context.Context, q Q, limit int) ([]AgentEvalRun, error) {
	return ListAgentEvalRunsScoped(ctx, q, "canvas", limit)
}

func ListAgentEvalRunsScoped(ctx context.Context, q Q, workspace string, limit int) ([]AgentEvalRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := q.Query(ctx, `SELECT `+agentEvalRunCols+` FROM agent_eval_runs
		WHERE ($1='' OR workspace=$1) ORDER BY started_at DESC,id DESC LIMIT $2`, strings.TrimSpace(workspace), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AgentEvalRun, 0)
	for rows.Next() {
		var item AgentEvalRun
		if err := rows.Scan(&item.ID, &item.Workspace, &item.Model, &item.ReasoningEffort, &item.PromptVersion, &item.ToolVersion,
			&item.Status, &item.Total, &item.Passed, &item.Score, &item.SampleSize, &item.Metadata,
			&item.StartedAt, &item.FinishedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetAgentEvalRun(ctx context.Context, q Q, id uuid.UUID) (*AgentEvalRun, error) {
	var item AgentEvalRun
	err := q.QueryRow(ctx, `SELECT `+agentEvalRunCols+` FROM agent_eval_runs WHERE id=$1`, id).Scan(&item.ID, &item.Workspace,
		&item.Model, &item.ReasoningEffort, &item.PromptVersion, &item.ToolVersion, &item.Status, &item.Total,
		&item.Passed, &item.Score, &item.SampleSize, &item.Metadata, &item.StartedAt, &item.FinishedAt)
	return nilOnNoRows(&item, err)
}

func ListAgentEvalResults(ctx context.Context, q Q, runID uuid.UUID) ([]AgentEvalResult, error) {
	rows, err := q.Query(ctx, `SELECT eval_run_id,case_id,trace_id,passed,score,metrics,error_message,created_at
		FROM agent_eval_results WHERE eval_run_id=$1 ORDER BY created_at,case_id`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AgentEvalResult, 0)
	for rows.Next() {
		var item AgentEvalResult
		if err := rows.Scan(&item.EvalRunID, &item.CaseID, &item.TraceID, &item.Passed, &item.Score,
			&item.Metrics, &item.ErrorMessage, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetUserAgentExecutionTrace(ctx context.Context, q Q, userID, runID uuid.UUID) (*AgentExecutionTrace, error) {
	return scanAgentExecutionTrace(q.QueryRow(ctx, `SELECT `+agentTraceCols+` FROM agent_execution_traces WHERE user_id=$1 AND run_id=$2`, userID, runID))
}

func UpsertAgentToolStepClaim(ctx context.Context, q Q, runID uuid.UUID, requestID, toolName string, arguments json.RawMessage, executorID string, requiresConfirmation bool) error {
	if len(arguments) == 0 || !json.Valid(arguments) {
		arguments = json.RawMessage(`{}`)
	}
	_, err := q.Exec(ctx, `INSERT INTO agent_tool_steps
		(trace_id, request_id, sequence, tool_name, arguments, status, executor_id, requires_confirmation)
		SELECT trace.id, $2, COALESCE((SELECT max(sequence)+1 FROM agent_tool_steps WHERE trace_id=trace.id),1),
			$3, $4, 'claimed', NULLIF($5,''), $6
		FROM agent_execution_traces trace WHERE trace.run_id=$1
		ON CONFLICT (trace_id, request_id) DO UPDATE SET
			status=CASE WHEN agent_tool_steps.status='pending' THEN 'claimed' ELSE agent_tool_steps.status END,
			executor_id=COALESCE(agent_tool_steps.executor_id, EXCLUDED.executor_id)`,
		runID, requestID, toolName, arguments, executorID, requiresConfirmation)
	return err
}

func CompleteAgentToolStep(ctx context.Context, q Q, runID uuid.UUID, requestID string, result json.RawMessage, errorMessage string, now time.Time) error {
	status := "succeeded"
	if errorMessage != "" {
		status = "failed"
	}
	if len(result) == 0 || !json.Valid(result) {
		result = nil
	}
	_, err := q.Exec(ctx, `UPDATE agent_tool_steps step SET status=$3, result=$4, error_message=NULLIF($5,''),
		finished_at=$6, duration_ms=GREATEST(0, floor(extract(epoch FROM ($6-step.started_at))*1000)::bigint)
		FROM agent_execution_traces trace
		WHERE step.trace_id=trace.id AND trace.run_id=$1 AND step.request_id=$2`,
		runID, requestID, status, result, errorMessage, now)
	return err
}

func UpdateAgentTraceCheckpoint(ctx context.Context, q Q, runID uuid.UUID, checkpointID string) error {
	_, err := q.Exec(ctx, `UPDATE agent_execution_traces SET checkpoint_id=NULLIF($2,'') WHERE run_id=$1`, runID, checkpointID)
	return err
}

func FinishAgentExecutionTrace(ctx context.Context, q Q, runID uuid.UUID, status string, now time.Time) error {
	_, err := q.Exec(ctx, `WITH stats AS (
		SELECT trace.id,
			count(step.id) AS total,
			count(*) FILTER (WHERE step.status='succeeded') AS succeeded,
			count(*) FILTER (WHERE step.status IN ('pending','claimed')) AS unfinished,
			count(*) FILTER (WHERE step.requires_confirmation) AS high_risk
		FROM agent_execution_traces trace
		LEFT JOIN agent_tool_steps step ON step.trace_id=trace.id
		WHERE trace.run_id=$1 GROUP BY trace.id
	)
	UPDATE agent_execution_traces trace SET status=$2, finished_at=$3,
		score=CASE WHEN stats.total=0 THEN CASE WHEN $2='succeeded' THEN 100 ELSE 0 END ELSE
			LEAST(100, GREATEST(0,
				(50.0*stats.succeeded/stats.total) +
				(CASE WHEN stats.unfinished=0 THEN 20 ELSE 0 END) +
				(CASE WHEN trace.checkpoint_id IS NOT NULL OR stats.high_risk=0 THEN 15 ELSE 0 END) +
				(CASE WHEN $2='succeeded' THEN 15 ELSE 0 END)
			)) END
	FROM stats WHERE trace.id=stats.id AND trace.status='running'`, runID, status, now)
	return err
}

func ListAgentToolSteps(ctx context.Context, q Q, traceID uuid.UUID) ([]*AgentToolStep, error) {
	rows, err := q.Query(ctx, `SELECT id, trace_id, request_id, sequence, tool_name, arguments, result, status,
		executor_id, requires_confirmation, started_at, finished_at, duration_ms, error_message
		FROM agent_tool_steps WHERE trace_id=$1 ORDER BY sequence`, traceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AgentToolStep, 0)
	for rows.Next() {
		var item AgentToolStep
		if err := rows.Scan(&item.ID, &item.TraceID, &item.RequestID, &item.Sequence, &item.ToolName, &item.Arguments,
			&item.Result, &item.Status, &item.ExecutorID, &item.RequiresConfirmation, &item.StartedAt,
			&item.FinishedAt, &item.DurationMS, &item.ErrorMessage); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}
