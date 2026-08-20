package httpapi

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCanvasWorkflowRunLeaseAndProgress(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	project := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
		"title":    "工作流画布",
		"document": map[string]any{"version": 3, "nodes": []any{}, "connections": []any{}},
	}, token)
	createdProject, _ := decode(t, project)
	projectID := createdProject["id"].(string)
	ownerA := uuid.NewString()
	ownerB := uuid.NewString()
	acquirePath := "/api/v1/canvas-projects/" + projectID + "/workflow-runs"

	first := env.do(t, http.MethodPost, acquirePath, map[string]any{
		"ownerId": ownerA, "nodeIds": []string{"node-a", "node-b"},
	}, token)
	firstBody, _ := decode(t, first)
	if first.Code != http.StatusOK || firstBody["acquired"] != true {
		t.Fatalf("first acquire: status %d body %s", first.Code, first.Body.String())
	}
	firstRun := firstBody["run"].(map[string]any)
	runID := firstRun["id"].(string)

	sameOwner := env.do(t, http.MethodPost, acquirePath, map[string]any{
		"ownerId": ownerA, "nodeIds": []string{"node-a", "node-b"},
	}, token)
	sameOwnerBody, _ := decode(t, sameOwner)
	if sameOwner.Code != http.StatusOK || sameOwnerBody["acquired"] != true || sameOwnerBody["run"].(map[string]any)["id"] != runID {
		t.Fatalf("same owner reacquire: status %d body %s", sameOwner.Code, sameOwner.Body.String())
	}

	locked := env.do(t, http.MethodPost, acquirePath, map[string]any{
		"ownerId": ownerB, "nodeIds": []string{"node-a", "node-b"},
	}, token)
	lockedBody, _ := decode(t, locked)
	if locked.Code != http.StatusOK || lockedBody["acquired"] != false || lockedBody["run"].(map[string]any)["id"] != runID {
		t.Fatalf("other owner acquire: status %d body %s", locked.Code, locked.Body.String())
	}

	patchPath := acquirePath + "/" + runID
	progress := env.do(t, http.MethodPatch, patchPath, map[string]any{
		"ownerId": ownerA, "status": "running", "completedNodeIds": []string{"node-a"}, "canceledNodeIds": []string{"node-b"}, "currentNodeId": "node-a",
	}, token)
	progressBody, _ := decode(t, progress)
	if progress.Code != http.StatusOK || progressBody["currentNodeId"] != "node-a" || len(progressBody["completedNodeIds"].([]any)) != 1 || len(progressBody["canceledNodeIds"].([]any)) != 1 {
		t.Fatalf("progress: status %d body %s", progress.Code, progress.Body.String())
	}
	heartbeat := env.do(t, http.MethodPatch, patchPath, map[string]any{
		"ownerId": ownerA, "status": "running", "completedNodeIds": []string{"node-a"}, "currentNodeId": "node-a",
	}, token)
	heartbeatBody, _ := decode(t, heartbeat)
	if heartbeat.Code != http.StatusOK || len(heartbeatBody["canceledNodeIds"].([]any)) != 1 {
		t.Fatalf("heartbeat must preserve canceled nodes: status %d body %s", heartbeat.Code, heartbeat.Body.String())
	}

	lost := env.do(t, http.MethodPatch, patchPath, map[string]any{
		"ownerId": ownerB, "status": "running", "completedNodeIds": []string{"node-a"}, "currentNodeId": "node-b",
	}, token)
	if _, code := decode(t, lost); lost.Code != http.StatusConflict || code != "workflow_run_lock_lost" {
		t.Fatalf("foreign heartbeat: status %d code %s body %s", lost.Code, code, lost.Body.String())
	}
	foreignFinish := env.do(t, http.MethodPatch, patchPath, map[string]any{
		"ownerId": ownerB, "status": "succeeded", "completedNodeIds": []string{"node-a", "node-b"},
	}, token)
	if _, code := decode(t, foreignFinish); foreignFinish.Code != http.StatusConflict || code != "workflow_run_lock_lost" {
		t.Fatalf("foreign finish: status %d code %s body %s", foreignFinish.Code, code, foreignFinish.Body.String())
	}

	stopped := env.do(t, http.MethodPatch, patchPath, map[string]any{
		"ownerId": ownerB, "status": "canceled", "completedNodeIds": []string{"node-a"}, "currentNodeId": "node-b",
	}, token)
	stoppedBody, _ := decode(t, stopped)
	if stopped.Code != http.StatusOK || stoppedBody["status"] != "canceled" {
		t.Fatalf("cancel: status %d body %s", stopped.Code, stopped.Body.String())
	}

	active := env.do(t, http.MethodGet, "/api/v1/canvas-projects/"+projectID+"/workflow-run", nil, token)
	activeBody, _ := decode(t, active)
	if active.Code != http.StatusOK || activeBody["run"] != nil {
		t.Fatalf("active after cancel: status %d body %s", active.Code, active.Body.String())
	}

	restarted := env.do(t, http.MethodPost, acquirePath, map[string]any{
		"ownerId": ownerB, "nodeIds": []string{"node-b"},
	}, token)
	restartedBody, _ := decode(t, restarted)
	if restarted.Code != http.StatusOK || restartedBody["acquired"] != true || restartedBody["run"].(map[string]any)["id"] == runID {
		t.Fatalf("restart: status %d body %s", restarted.Code, restarted.Body.String())
	}
}
