package httpapi

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const canvasWorkflowLease = 30 * time.Second

type canvasWorkflowAcquireIn struct {
	OwnerID string   `json:"ownerId"`
	NodeIDs []string `json:"nodeIds"`
}

type canvasWorkflowPatchIn struct {
	OwnerID          string          `json:"ownerId"`
	Status           string          `json:"status"`
	CompletedNodeIDs []string        `json:"completedNodeIds"`
	CanceledNodeIDs  []string        `json:"canceledNodeIds"`
	CurrentNodeID    string          `json:"currentNodeId"`
	ErrorMessage     string          `json:"errorMessage"`
	ErrorNodeID      string          `json:"errorNodeId"`
	NodeMetrics      json.RawMessage `json:"nodeMetrics"`
	TotalCostCents   *int64          `json:"totalCostCents"`
}

type canvasWorkflowNodeMetric struct {
	NodeID       string  `json:"nodeId"`
	Title        string  `json:"title"`
	Status       string  `json:"status"`
	StartedAt    *string `json:"startedAt,omitempty"`
	FinishedAt   *string `json:"finishedAt,omitempty"`
	DurationMs   int64   `json:"durationMs"`
	CostCents    int64   `json:"costCents"`
	ErrorMessage string  `json:"errorMessage,omitempty"`
}

func validCanvasWorkflowNodeIDs(values []string, required bool) ([]string, error) {
	if required && len(values) == 0 {
		return nil, apperr.E("validation_error", "nodeIds: 至少需要一个节点", 422)
	}
	if len(values) > 5000 {
		return nil, apperr.E("validation_error", "nodeIds: 最多允许 5000 个节点", 422)
	}
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" || len(id) > 200 {
			return nil, apperr.E("validation_error", "nodeIds: 节点 ID 无效", 422)
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result, nil
}

func canvasWorkflowRunJSON(item *store.CanvasWorkflowRun) gin.H {
	if item == nil {
		return nil
	}
	return gin.H{
		"id": item.ID.String(), "projectId": item.ProjectID.String(), "ownerId": item.OwnerID.String(), "status": item.Status,
		"nodeIds": item.NodeIDs, "completedNodeIds": item.CompletedNodeIDs, "canceledNodeIds": item.CanceledNodeIDs, "currentNodeId": item.CurrentNodeID,
		"errorMessage": item.ErrorMessage, "errorNodeId": item.ErrorNodeID,
		"nodeMetrics": item.NodeMetrics, "totalCostCents": item.TotalCostCents,
		"leaseExpiresAt": isoPointer(item.LeaseExpiresAt),
		"startedAt":      isoValue(item.StartedAt), "updatedAt": isoValue(item.UpdatedAt), "finishedAt": isoPointer(item.FinishedAt),
	}
}

func validateCanvasWorkflowNodeMetrics(raw json.RawMessage) (json.RawMessage, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, nil
	}
	if len(raw) > 1<<20 {
		return nil, apperr.E("validation_error", "nodeMetrics: 内容不能超过 1MB", 422)
	}
	var metrics []canvasWorkflowNodeMetric
	if err := json.Unmarshal(raw, &metrics); err != nil {
		return nil, apperr.E("validation_error", "nodeMetrics: 必须是有效数组", 422)
	}
	if len(metrics) > 5000 {
		return nil, apperr.E("validation_error", "nodeMetrics: 最多允许 5000 个节点", 422)
	}
	seen := make(map[string]bool, len(metrics))
	for index := range metrics {
		metric := &metrics[index]
		metric.NodeID = strings.TrimSpace(metric.NodeID)
		metric.Title = strings.TrimSpace(metric.Title)
		metric.ErrorMessage = strings.TrimSpace(metric.ErrorMessage)
		if metric.NodeID == "" || len(metric.NodeID) > 200 || seen[metric.NodeID] {
			return nil, apperr.E("validation_error", "nodeMetrics: 节点 ID 无效或重复", 422)
		}
		seen[metric.NodeID] = true
		if metric.Status != "queued" && metric.Status != "running" && metric.Status != "succeeded" && metric.Status != "failed" && metric.Status != "canceled" {
			return nil, apperr.E("validation_error", "nodeMetrics: 节点状态无效", 422)
		}
		if len(metric.Title) > 240 || len(metric.ErrorMessage) > 2000 || metric.DurationMs < 0 || metric.CostCents < 0 {
			return nil, apperr.E("validation_error", "nodeMetrics: 节点诊断数据无效", 422)
		}
		for _, value := range []*string{metric.StartedAt, metric.FinishedAt} {
			if value == nil || *value == "" {
				continue
			}
			if _, err := time.Parse(time.RFC3339Nano, *value); err != nil {
				return nil, apperr.E("validation_error", "nodeMetrics: 时间格式无效", 422)
			}
		}
	}
	return json.Marshal(metrics)
}

func isoPointer(value *time.Time) any {
	if value == nil {
		return nil
	}
	return isoValue(*value)
}

func (s *Server) activeCanvasWorkflowRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	projectID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetActiveCanvasWorkflowRun(c.Request.Context(), s.St.Pool, user.ID, projectID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"run": canvasWorkflowRunJSON(item)})
}

func (s *Server) acquireCanvasWorkflowRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	projectID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	project, err := store.GetUserCanvasProject(c.Request.Context(), s.St.Pool, user.ID, projectID)
	if err != nil {
		fail(c, err)
		return
	}
	if project == nil {
		fail(c, apperr.E("not_found", "画布项目不存在", 404))
		return
	}
	var in canvasWorkflowAcquireIn
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, apperr.E("validation_error", "请求格式无效", 422))
		return
	}
	ownerID, err := uuid.Parse(strings.TrimSpace(in.OwnerID))
	if err != nil {
		fail(c, apperr.E("validation_error", "ownerId: 必须是有效的 UUID", 422))
		return
	}
	nodeIDs, err := validCanvasWorkflowNodeIDs(in.NodeIDs, true)
	if err != nil {
		fail(c, err)
		return
	}
	nodeJSON, _ := json.Marshal(nodeIDs)
	item, acquired, err := store.AcquireCanvasWorkflowRun(c.Request.Context(), s.St.Pool, user.ID, projectID, ownerID, nodeJSON, time.Now(), canvasWorkflowLease)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"run": canvasWorkflowRunJSON(item), "acquired": acquired})
}

func (s *Server) patchCanvasWorkflowRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	projectID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	runID, err := parseUUIDParam(c, "runId")
	if err != nil {
		fail(c, err)
		return
	}
	var in canvasWorkflowPatchIn
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, apperr.E("validation_error", "请求格式无效", 422))
		return
	}
	completed, err := validCanvasWorkflowNodeIDs(in.CompletedNodeIDs, false)
	if err != nil {
		fail(c, err)
		return
	}
	completedJSON, _ := json.Marshal(completed)
	canceled, err := validCanvasWorkflowNodeIDs(in.CanceledNodeIDs, false)
	if err != nil {
		fail(c, err)
		return
	}
	canceledJSON, _ := json.Marshal(canceled)
	metricsJSON, err := validateCanvasWorkflowNodeMetrics(in.NodeMetrics)
	if err != nil {
		fail(c, err)
		return
	}
	if in.TotalCostCents != nil && *in.TotalCostCents < 0 {
		fail(c, apperr.E("validation_error", "totalCostCents: 不能小于 0", 422))
		return
	}
	if len(strings.TrimSpace(in.ErrorNodeID)) > 200 || len(strings.TrimSpace(in.ErrorMessage)) > 2000 {
		fail(c, apperr.E("validation_error", "工作流错误信息过长", 422))
		return
	}
	progressData := store.CanvasWorkflowRunProgress{
		CompletedNodeIDs: completedJSON, CanceledNodeIDs: canceledJSON, CurrentNodeID: strings.TrimSpace(in.CurrentNodeID),
		NodeMetrics: metricsJSON, TotalCostCents: in.TotalCostCents, ErrorNodeID: strings.TrimSpace(in.ErrorNodeID), ErrorMessage: strings.TrimSpace(in.ErrorMessage),
	}
	now := time.Now()
	var item *store.CanvasWorkflowRun
	if in.Status == "running" || in.Status == "" {
		ownerID, parseErr := uuid.Parse(strings.TrimSpace(in.OwnerID))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "ownerId: 必须是有效的 UUID", 422))
			return
		}
		item, err = store.UpdateCanvasWorkflowRunProgressWithMetrics(c.Request.Context(), s.St.Pool, user.ID, projectID, runID, ownerID, progressData, now, canvasWorkflowLease)
	} else if in.Status == "succeeded" || in.Status == "failed" {
		ownerID, parseErr := uuid.Parse(strings.TrimSpace(in.OwnerID))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "ownerId: 必须是有效的 UUID", 422))
			return
		}
		item, err = store.FinishCanvasWorkflowRunWithMetrics(c.Request.Context(), s.St.Pool, user.ID, projectID, runID, ownerID, in.Status, progressData, now)
	} else if in.Status == "canceled" {
		item, err = store.CancelCanvasWorkflowRunWithMetrics(c.Request.Context(), s.St.Pool, user.ID, projectID, runID, progressData, now)
	} else {
		fail(c, apperr.E("validation_error", "status: 状态无效", 422))
		return
	}
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("workflow_run_lock_lost", "工作流已由其他页面接管或已经结束", 409))
		return
	}
	ok(c, canvasWorkflowRunJSON(item))
}
