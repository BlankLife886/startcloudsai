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
	OwnerID          string   `json:"ownerId"`
	Status           string   `json:"status"`
	CompletedNodeIDs []string `json:"completedNodeIds"`
	CurrentNodeID    string   `json:"currentNodeId"`
	ErrorMessage     string   `json:"errorMessage"`
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
		"nodeIds": item.NodeIDs, "completedNodeIds": item.CompletedNodeIDs, "currentNodeId": item.CurrentNodeID,
		"errorMessage": item.ErrorMessage, "leaseExpiresAt": isoPointer(item.LeaseExpiresAt),
		"startedAt": isoValue(item.StartedAt), "updatedAt": isoValue(item.UpdatedAt), "finishedAt": isoPointer(item.FinishedAt),
	}
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
	now := time.Now()
	var item *store.CanvasWorkflowRun
	if in.Status == "running" || in.Status == "" {
		ownerID, parseErr := uuid.Parse(strings.TrimSpace(in.OwnerID))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "ownerId: 必须是有效的 UUID", 422))
			return
		}
		item, err = store.UpdateCanvasWorkflowRunProgress(c.Request.Context(), s.St.Pool, user.ID, projectID, runID, ownerID, completedJSON, strings.TrimSpace(in.CurrentNodeID), now, canvasWorkflowLease)
	} else if in.Status == "succeeded" || in.Status == "failed" {
		ownerID, parseErr := uuid.Parse(strings.TrimSpace(in.OwnerID))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "ownerId: 必须是有效的 UUID", 422))
			return
		}
		item, err = store.FinishCanvasWorkflowRun(c.Request.Context(), s.St.Pool, user.ID, projectID, runID, ownerID, in.Status, completedJSON, strings.TrimSpace(in.CurrentNodeID), strings.TrimSpace(in.ErrorMessage), now)
	} else if in.Status == "canceled" {
		item, err = store.CancelCanvasWorkflowRun(c.Request.Context(), s.St.Pool, user.ID, projectID, runID, completedJSON, strings.TrimSpace(in.CurrentNodeID), now)
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
