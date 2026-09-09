package httpapi

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/agentquality"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) assistantRunTrace(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	runID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	trace, err := store.GetUserAgentExecutionTrace(c.Request.Context(), s.St.Pool, user.ID, runID)
	if err != nil {
		fail(c, err)
		return
	}
	if trace == nil {
		fail(c, apperr.E("not_found", "该任务没有 Agent 执行追踪", 404))
		return
	}
	steps, err := store.ListAgentToolSteps(c.Request.Context(), s.St.Pool, trace.ID)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(steps))
	for _, step := range steps {
		items = append(items, gin.H{
			"sequence": step.Sequence, "requestId": step.RequestID, "toolName": step.ToolName,
			"arguments": step.Arguments, "result": step.Result, "status": step.Status,
			"requiresConfirmation": step.RequiresConfirmation, "durationMs": step.DurationMS,
			"errorMessage": step.ErrorMessage, "startedAt": isoValue(step.StartedAt), "finishedAt": isoPointer(step.FinishedAt),
		})
	}
	ok(c, gin.H{"trace": gin.H{
		"runId": trace.RunID.String(), "projectId": assistantProjectIDValue(trace.ProjectID),
		"workspace": trace.Workspace, "model": trace.Model, "reasoningEffort": trace.ReasoningEffort,
		"promptVersion": trace.PromptVersion, "toolVersion": trace.ToolVersion,
		"initialSnapshot": trace.InitialSnapshot, "visualSummary": trace.VisualSummary, "goalContract": trace.GoalContract,
		"checkpointId": trace.CheckpointID, "status": trace.Status, "score": trace.Score,
		"startedAt": isoValue(trace.StartedAt), "finishedAt": isoPointer(trace.FinishedAt),
		"steps": items,
	}})
}

func agentTraceDict(trace *store.AgentExecutionTrace) gin.H {
	if trace == nil {
		return gin.H{}
	}
	return gin.H{
		"id": trace.ID.String(), "runId": trace.RunID.String(), "userId": trace.UserID.String(),
		"projectId": assistantProjectIDValue(trace.ProjectID), "workspace": trace.Workspace, "model": trace.Model,
		"reasoningEffort": trace.ReasoningEffort, "promptVersion": trace.PromptVersion, "toolVersion": trace.ToolVersion,
		"initialSnapshot": trace.InitialSnapshot, "visualSummary": trace.VisualSummary, "goalContract": trace.GoalContract, "checkpointId": trace.CheckpointID,
		"status": trace.Status, "score": trace.Score, "startedAt": isoValue(trace.StartedAt),
		"finishedAt": isoPointer(trace.FinishedAt), "createdAt": isoValue(trace.CreatedAt),
	}
}

func agentToolStepDict(step *store.AgentToolStep) gin.H {
	return gin.H{
		"id": step.ID.String(), "sequence": step.Sequence, "requestId": step.RequestID, "toolName": step.ToolName,
		"arguments": step.Arguments, "result": step.Result, "status": step.Status, "executorId": step.ExecutorID,
		"requiresConfirmation": step.RequiresConfirmation, "durationMs": step.DurationMS,
		"errorMessage": step.ErrorMessage, "startedAt": isoValue(step.StartedAt), "finishedAt": isoPointer(step.FinishedAt),
	}
}

func agentEvalCaseDict(item store.AgentEvalCase) gin.H {
	return gin.H{"id": item.ID.String(), "key": item.Key, "workspace": item.Workspace, "category": item.Category, "title": item.Title,
		"input": item.Input, "expected": item.Expected, "active": item.Active,
		"createdAt": isoValue(item.CreatedAt), "updatedAt": isoValue(item.UpdatedAt)}
}

func agentEvalRunDict(item store.AgentEvalRun) gin.H {
	return gin.H{"id": item.ID.String(), "workspace": item.Workspace, "model": item.Model, "reasoningEffort": item.ReasoningEffort,
		"promptVersion": item.PromptVersion, "toolVersion": item.ToolVersion, "status": item.Status,
		"total": item.Total, "passed": item.Passed, "score": item.Score, "sampleSize": item.SampleSize,
		"metadata": item.Metadata, "startedAt": isoValue(item.StartedAt), "finishedAt": isoPointer(item.FinishedAt)}
}

func normalizeAgentQualityWorkspace(raw string) (string, error) {
	workspace := strings.ToLower(strings.TrimSpace(raw))
	if workspace == "" || workspace == "assistant" || workspace == "canvas" {
		return workspace, nil
	}
	return "", apperr.E("validation_error", "workspace: 仅支持 assistant 或 canvas", 422)
}

func agentQualityDays(c *gin.Context) (int, time.Time, error) {
	days := 7
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || (value != 7 && value != 30) {
			return 0, time.Time{}, apperr.E("validation_error", "days: 仅支持 7 或 30", 422)
		}
		days = value
	}
	return days, time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour), nil
}

func (s *Server) adminAgentQualityOverview(c *gin.Context, _ *store.User) {
	days, since, err := agentQualityDays(c)
	if err != nil {
		fail(c, err)
		return
	}
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && status != "running" && status != "succeeded" && status != "failed" && status != "canceled" {
		fail(c, apperr.E("validation_error", "status 无效", 422))
		return
	}
	workspace, err := normalizeAgentQualityWorkspace(c.Query("workspace"))
	if err != nil {
		fail(c, err)
		return
	}
	summary, err := store.GetAgentQualitySummaryScoped(c.Request.Context(), s.St.Pool, since, workspace)
	if err != nil {
		fail(c, err)
		return
	}
	versions, err := store.ListAgentQualityVersionsScoped(c.Request.Context(), s.St.Pool, since, workspace, 30)
	if err != nil {
		fail(c, err)
		return
	}
	traces, err := store.ListAdminAgentExecutionTraces(c.Request.Context(), s.St.Pool, store.AgentTraceListOptions{
		Since: since, Workspace: workspace, Status: status, Model: c.Query("model"), ReasoningEffort: c.Query("reasoningEffort"),
		PromptVersion: c.Query("promptVersion"), ToolVersion: c.Query("toolVersion"), Limit: 80,
	})
	if err != nil {
		fail(c, err)
		return
	}
	cases, err := store.ListAgentEvalCasesScoped(c.Request.Context(), s.St.Pool, workspace, false)
	if err != nil {
		fail(c, err)
		return
	}
	runs, err := store.ListAgentEvalRunsScoped(c.Request.Context(), s.St.Pool, workspace, 30)
	if err != nil {
		fail(c, err)
		return
	}
	traceItems := make([]gin.H, 0, len(traces))
	for _, item := range traces {
		trace := agentTraceDict(&item.Trace)
		trace["userEmail"] = item.UserEmail
		trace["stepCount"] = item.StepCount
		trace["failedSteps"] = item.FailedSteps
		trace["unfinishedSteps"] = item.UnfinishedSteps
		trace["durationMs"] = item.DurationMS
		delete(trace, "initialSnapshot")
		delete(trace, "visualSummary")
		traceItems = append(traceItems, trace)
	}
	caseItems := make([]gin.H, 0, len(cases))
	for _, item := range cases {
		caseItems = append(caseItems, agentEvalCaseDict(item))
	}
	runItems := make([]gin.H, 0, len(runs))
	for _, item := range runs {
		runItems = append(runItems, agentEvalRunDict(item))
	}
	ok(c, gin.H{"days": days, "since": isoValue(since), "workspace": workspace, "summary": summary, "versions": versions,
		"traces": traceItems, "evalCases": caseItems, "evalRuns": runItems})
}

func (s *Server) adminAgentTrace(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	trace, err := store.GetAgentExecutionTrace(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if trace == nil {
		fail(c, apperr.E("not_found", "Agent 追踪不存在", 404))
		return
	}
	steps, err := store.ListAgentToolSteps(c.Request.Context(), s.St.Pool, trace.ID)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(steps))
	for _, step := range steps {
		items = append(items, agentToolStepDict(step))
	}
	result := agentTraceDict(trace)
	result["steps"] = items
	ok(c, result)
}

func (s *Server) adminPatchAgentEvalCase(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		Active *bool `json:"active"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Active == nil {
		fail(c, apperr.E("validation_error", "active 必填", 422))
		return
	}
	item, err := store.SetAgentEvalCaseActive(c.Request.Context(), s.St.Pool, id, *body.Active)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "评测项不存在", 404))
		return
	}
	ok(c, agentEvalCaseDict(*item))
}

func (s *Server) adminCreateAgentEvalRun(c *gin.Context, _ *store.User) {
	var body struct {
		Days            int    `json:"days"`
		Workspace       string `json:"workspace"`
		Model           string `json:"model"`
		ReasoningEffort string `json:"reasoningEffort"`
		PromptVersion   string `json:"promptVersion"`
		ToolVersion     string `json:"toolVersion"`
		SampleLimit     int    `json:"sampleLimit"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Days == 0 {
		body.Days = 7
	}
	if body.Days != 7 && body.Days != 30 {
		fail(c, apperr.E("validation_error", "days: 仅支持 7 或 30", 422))
		return
	}
	if body.SampleLimit == 0 {
		body.SampleLimit = 50
	}
	if body.SampleLimit < 1 || body.SampleLimit > 200 {
		fail(c, apperr.E("validation_error", "sampleLimit: 须在 1-200 之间", 422))
		return
	}
	workspace, err := normalizeAgentQualityWorkspace(body.Workspace)
	if err != nil {
		fail(c, err)
		return
	}
	if workspace == "" {
		workspace = "assistant"
	}
	since := time.Now().UTC().Add(-time.Duration(body.Days) * 24 * time.Hour)
	traces, err := store.ListAdminAgentExecutionTraces(c.Request.Context(), s.St.Pool, store.AgentTraceListOptions{
		Since: since, Workspace: workspace, Model: body.Model, ReasoningEffort: body.ReasoningEffort, PromptVersion: body.PromptVersion,
		ToolVersion: body.ToolVersion, Limit: body.SampleLimit,
	})
	if err != nil {
		fail(c, err)
		return
	}
	if len(traces) == 0 {
		fail(c, apperr.E("agent_eval_no_samples", "当前筛选范围没有 Agent 执行样本", 409))
		return
	}
	cases, err := store.ListAgentEvalCasesScoped(c.Request.Context(), s.St.Pool, workspace, true)
	if err != nil {
		fail(c, err)
		return
	}
	if len(cases) == 0 {
		fail(c, apperr.E("agent_eval_no_cases", "没有启用的 Agent 评测项", 409))
		return
	}
	samples := make([]agentquality.Sample, 0, len(traces))
	for index := range traces {
		steps, stepErr := store.ListAgentToolSteps(c.Request.Context(), s.St.Pool, traces[index].Trace.ID)
		if stepErr != nil {
			fail(c, stepErr)
			return
		}
		samples = append(samples, agentquality.Sample{Trace: &traces[index].Trace, Steps: steps})
	}
	results := agentquality.Evaluate(cases, samples)
	passed := 0
	totalScore := 0.0
	for _, result := range results {
		if result.Passed {
			passed++
		}
		totalScore += result.Score
	}
	score := 0.0
	if len(results) > 0 {
		score = math.Round(totalScore/float64(len(results))*1000) / 1000
	}
	metadata, _ := json.Marshal(map[string]any{"days": body.Days, "workspace": workspace, "since": isoValue(since), "sampleLimit": body.SampleLimit})
	model, effort := strings.TrimSpace(body.Model), strings.TrimSpace(body.ReasoningEffort)
	promptVersion, toolVersion := strings.TrimSpace(body.PromptVersion), strings.TrimSpace(body.ToolVersion)
	if model == "" {
		model = "*"
	}
	if promptVersion == "" {
		promptVersion = "*"
	}
	if toolVersion == "" {
		toolVersion = "*"
	}
	var completed *store.AgentEvalRun
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		run, insertErr := store.InsertAgentEvalRunScoped(c.Request.Context(), tx, workspace, model, effort, promptVersion, toolVersion, len(samples), metadata)
		if insertErr != nil {
			return insertErr
		}
		for _, result := range results {
			var errorMessage *string
			if result.ErrorMessage != "" {
				value := result.ErrorMessage
				errorMessage = &value
			}
			if insertErr := store.InsertAgentEvalResult(c.Request.Context(), tx, store.AgentEvalResult{
				EvalRunID: run.ID, CaseID: result.CaseID, TraceID: result.TraceID, Passed: result.Passed,
				Score: result.Score, Metrics: result.Metrics, ErrorMessage: errorMessage,
			}); insertErr != nil {
				return insertErr
			}
		}
		completed, insertErr = store.FinishAgentEvalRun(c.Request.Context(), tx, run.ID, "succeeded", len(results), passed, score, time.Now().UTC())
		return insertErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, agentEvalRunDict(*completed))
}

func (s *Server) adminAgentEvalRun(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	run, err := store.GetAgentEvalRun(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if run == nil {
		fail(c, apperr.E("not_found", "Agent 评测运行不存在", 404))
		return
	}
	results, err := store.ListAgentEvalResults(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	cases, err := store.ListAgentEvalCasesScoped(c.Request.Context(), s.St.Pool, run.Workspace, false)
	if err != nil {
		fail(c, err)
		return
	}
	caseByID := make(map[uuid.UUID]store.AgentEvalCase, len(cases))
	for _, item := range cases {
		caseByID[item.ID] = item
	}
	items := make([]gin.H, 0, len(results))
	for _, item := range results {
		evalCase := caseByID[item.CaseID]
		items = append(items, gin.H{"case": agentEvalCaseDict(evalCase), "traceId": item.TraceID,
			"passed": item.Passed, "score": item.Score, "metrics": item.Metrics,
			"errorMessage": item.ErrorMessage, "createdAt": isoValue(item.CreatedAt)})
	}
	ok(c, gin.H{"run": agentEvalRunDict(*run), "results": items})
}
