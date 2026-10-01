package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCanvasWorkflowInputSignatureProtectsRecovery(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	projectResponse := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
		"title": "版本验证", "document": map[string]any{"version": 3, "nodes": []any{}, "connections": []any{}},
	}, token)
	project, _ := decode(t, projectResponse)
	path := "/api/v1/canvas-projects/" + project["id"].(string) + "/workflow-runs"
	ownerA, ownerB := uuid.NewString(), uuid.NewString()
	signatureA, signatureB := "v1:0123456789abcdef", "v1:fedcba9876543210"
	body := func(owner, signature string, nodes []string) map[string]any {
		return map[string]any{"ownerId": owner, "nodeIds": nodes, "inputSignature": signature}
	}
	nodes := []string{"a", "b"}
	first := env.do(t, http.MethodPost, path, body(ownerA, signatureA, nodes), token)
	firstBody, _ := decode(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("create: %d %s", first.Code, first.Body.String())
	}
	run := firstBody["run"].(map[string]any)
	runID := run["id"].(string)
	if run["inputSignature"] != signatureA {
		t.Fatalf("signature not persisted: %v", run)
	}
	progress := env.do(t, http.MethodPatch, path+"/"+runID, map[string]any{"ownerId": ownerA, "status": "running", "completedNodeIds": []string{"a"}}, token)
	if progress.Code != http.StatusOK {
		t.Fatalf("progress: %s", progress.Body.String())
	}
	replay := env.do(t, http.MethodPost, path, body(ownerA, signatureA, nodes), token)
	replayed, _ := decode(t, replay)
	if replay.Code != http.StatusOK || replayed["run"].(map[string]any)["id"] != runID || len(replayed["run"].(map[string]any)["completedNodeIds"].([]any)) != 1 {
		t.Fatalf("matching inputs did not resume: %s", replay.Body.String())
	}
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE canvas_workflow_runs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1`, runID); err != nil {
		t.Fatal(err)
	}
	for _, changed := range []map[string]any{body(ownerB, signatureB, nodes), body(ownerB, signatureA, []string{"b", "a"}), body(ownerB, "", nodes)} {
		response := env.do(t, http.MethodPost, path, changed, token)
		_, code := decode(t, response)
		if response.Code != http.StatusConflict || code != "workflow_run_inputs_changed" {
			t.Fatalf("unsafe recovery accepted: %d %s", response.Code, response.Body.String())
		}
	}
	var owner, status string
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT owner_id::text,status FROM canvas_workflow_runs WHERE id=$1`, runID).Scan(&owner, &status); err != nil {
		t.Fatal(err)
	}
	if owner != ownerA || status != "running" {
		t.Fatalf("input mismatch changed the existing run: %s %s", owner, status)
	}
	takeover := env.do(t, http.MethodPost, path, body(ownerB, signatureA, nodes), token)
	taken, _ := decode(t, takeover)
	if takeover.Code != http.StatusOK || taken["acquired"] != true || taken["run"].(map[string]any)["id"] != runID {
		t.Fatalf("matching takeover failed: %s", takeover.Body.String())
	}
	stop := env.do(t, http.MethodPatch, path+"/"+runID, map[string]any{"ownerId": ownerB, "status": "canceled", "completedNodeIds": []string{"a"}}, token)
	if stop.Code != http.StatusOK {
		t.Fatalf("explicit stop failed: %s", stop.Body.String())
	}
	fresh := env.do(t, http.MethodPost, path, body(ownerB, signatureB, nodes), token)
	freshBody, _ := decode(t, fresh)
	if fresh.Code != http.StatusOK || freshBody["run"].(map[string]any)["id"] == runID || len(freshBody["run"].(map[string]any)["completedNodeIds"].([]any)) != 0 {
		t.Fatalf("explicit fresh run inherited progress: %s", fresh.Body.String())
	}
}

func TestCanvasWorkflowLegacyProgressCannotBeReacquired(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	created := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "旧版运行", "document": map[string]any{"version": 3, "nodes": []any{}, "connections": []any{}}}, token)
	project, _ := decode(t, created)
	path := "/api/v1/canvas-projects/" + project["id"].(string) + "/workflow-runs"
	owner := uuid.NewString()
	request := map[string]any{"ownerId": owner, "nodeIds": []string{"a"}}
	first := env.do(t, http.MethodPost, path, request, token)
	data, _ := decode(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("legacy fresh run failed: %s", first.Body.String())
	}
	runID := data["run"].(map[string]any)["id"].(string)
	progress := env.do(t, http.MethodPatch, path+"/"+runID, map[string]any{"ownerId": owner, "status": "running", "completedNodeIds": []string{"a"}}, token)
	if progress.Code != http.StatusOK {
		t.Fatalf("progress failed: %s", progress.Body.String())
	}
	replay := env.do(t, http.MethodPost, path, request, token)
	_, code := decode(t, replay)
	if replay.Code != http.StatusConflict || code != "workflow_run_inputs_changed" {
		t.Fatalf("legacy progress was silently trusted: %s", replay.Body.String())
	}
}

func TestCanvasWorkflowOutputFingerprintSurvivesProgress(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	created := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "产物版本", "document": map[string]any{"version": 3, "nodes": []any{}, "connections": []any{}}}, token)
	project, _ := decode(t, created)
	path := "/api/v1/canvas-projects/" + project["id"].(string) + "/workflow-runs"
	owner := uuid.NewString()
	request := map[string]any{"ownerId": owner, "nodeIds": []string{"a", "b"}, "inputSignature": "v1:0123456789abcdef"}
	first := env.do(t, http.MethodPost, path, request, token)
	data, _ := decode(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("create: %s", first.Body.String())
	}
	runID := data["run"].(map[string]any)["id"].(string)
	fingerprint := "v1:fedcba9876543210"
	metric := map[string]any{"nodeId": "a", "title": "结果", "status": "succeeded", "durationMs": 120, "costCents": 10, "outputFingerprint": fingerprint}
	progress := env.do(t, http.MethodPatch, path+"/"+runID, map[string]any{"ownerId": owner, "status": "running", "completedNodeIds": []string{"a"}, "nodeMetrics": []any{metric}}, token)
	if progress.Code != http.StatusOK {
		t.Fatalf("persist fingerprint: %s", progress.Body.String())
	}
	replay := env.do(t, http.MethodPost, path, request, token)
	restored, _ := decode(t, replay)
	if replay.Code != http.StatusOK {
		t.Fatalf("resume: %s", replay.Body.String())
	}
	metrics := restored["run"].(map[string]any)["nodeMetrics"].([]any)
	if len(metrics) != 1 || metrics[0].(map[string]any)["outputFingerprint"] != fingerprint {
		t.Fatalf("output fingerprint lost: %v", metrics)
	}
	metric["outputFingerprint"] = "invalid fingerprint"
	invalid := env.do(t, http.MethodPatch, path+"/"+runID, map[string]any{"ownerId": owner, "status": "running", "completedNodeIds": []string{"a"}, "nodeMetrics": []any{metric}}, token)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("malformed fingerprint accepted: %s", invalid.Body.String())
	}
}

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
	restartedRunID := restartedBody["run"].(map[string]any)["id"].(string)
	if restarted.Code != http.StatusOK || restartedBody["acquired"] != true || restartedRunID == runID {
		t.Fatalf("restart: status %d body %s", restarted.Code, restarted.Body.String())
	}

	finished := env.do(t, http.MethodPatch, acquirePath+"/"+restartedRunID, map[string]any{
		"ownerId": ownerB, "status": "succeeded", "completedNodeIds": []string{"node-b"},
	}, token)
	finishedBody, _ := decode(t, finished)
	if finished.Code != http.StatusOK || finishedBody["status"] != "succeeded" {
		t.Fatalf("finish restarted run: status %d body %s", finished.Code, finished.Body.String())
	}

	afterSuccess := env.do(t, http.MethodPost, acquirePath, map[string]any{
		"ownerId": ownerB, "nodeIds": []string{"node-a", "node-b"},
	}, token)
	afterSuccessBody, _ := decode(t, afterSuccess)
	afterSuccessRun := afterSuccessBody["run"].(map[string]any)
	if afterSuccess.Code != http.StatusOK || afterSuccessBody["acquired"] != true || afterSuccessRun["id"] == restartedRunID {
		t.Fatalf("restart after success: status %d body %s", afterSuccess.Code, afterSuccess.Body.String())
	}
	if len(afterSuccessRun["completedNodeIds"].([]any)) != 0 || len(afterSuccessRun["canceledNodeIds"].([]any)) != 0 || afterSuccessRun["currentNodeId"] != nil {
		t.Fatalf("restart after success must have fresh progress: body %s", afterSuccess.Body.String())
	}
}
