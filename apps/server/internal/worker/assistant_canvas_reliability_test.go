package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestCanvasWorkflowOnlyExplicitStartAcknowledgementIsBillable(t *testing.T) {
	for _, raw := range []string{
		`{"requestId":"old-browser","configNodeIds":["a"]}`,
		`{"status":"rejected","error":"missing input"}`,
		`{"status":"queued","requestId":"waiting-confirmation","configNodeIds":["a"]}`,
		`{"status":"started"}`,
		`执行失败：工作流存在循环`,
	} {
		loop := &canvasAgentLoopState{}
		if canvasAgentWorkflowStartFeedback(loop, raw, "started") || loop.billableAction || loop.touched || loop.lastToolSucceeded {
			t.Fatalf("unacknowledged workflow was treated as started: raw=%q state=%+v", raw, loop)
		}
	}
	loop := &canvasAgentLoopState{}
	if !canvasAgentWorkflowStartFeedback(loop, `{"status":"started","requestId":"run-1","configNodeIds":["a"]}`, "工作流已启动") || !loop.billableAction || !loop.finishAfterTool || loop.summary != "工作流已启动" {
		t.Fatalf("valid start was not accepted: %+v", loop)
	}
}

func TestCanvasWorkflowCancellationFinishesWithoutBillingOrRetry(t *testing.T) {
	loop := &canvasAgentLoopState{}
	if canvasAgentWorkflowStartFeedback(loop, `{"status":"canceled","requestId":"run-1","configNodeIds":["a"]}`, "started") {
		t.Fatal("cancellation must not acknowledge a start")
	}
	if !loop.userCanceled || !loop.finishAfterTool || !loop.lastToolSucceeded || loop.billableAction || loop.touched || !strings.Contains(loop.summary, "取消") {
		t.Fatalf("incorrect cancellation: %+v", loop)
	}
}

func TestCanvasWorkflowMissingAcknowledgementHasUnknownOutcome(t *testing.T) {
	for _, name := range []string{"canvas_run_workflow", "canvas_resume_workflow", "canvas_retry_failed_nodes", "canvas_run_downstream"} {
		loop := &canvasAgentLoopState{}
		observation := (&Worker{}).runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{Name: name, Arguments: "{}"})
		if loop.unconfirmedActionError == "" || !strings.Contains(observation, "不要重复提交") || loop.billableAction || loop.lastToolSucceeded {
			t.Fatalf("name=%s unknown start must stop retries without claiming failure or success: %q %+v", name, observation, loop)
		}
	}
}

func TestCanvasVisualReadFailureKeepsMutationGuardActive(t *testing.T) {
	loop := &canvasAgentLoopState{
		requiresVisualInspection: true,
		visualInspected:          true,
		lastToolSucceeded:        true,
		visualPageOffset:         4,
		visualNextOffset:         8,
		visualReferences: []canvasAgentVisualReference{
			{ResourceID: "image-5", FileKey: "other-users/private-image.png"},
		},
	}
	worker := &Worker{}
	message := worker.consumeCanvasAgentVisualContext(context.Background(), &store.AssistantRun{}, loop)
	if message == nil || loop.visualInspected || loop.lastToolSucceeded || loop.visualNextOffset != 4 {
		t.Fatalf("failed page must be retried before writes: message=%+v loop=%+v", message, loop)
	}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{Name: "canvas_run_generation", Arguments: `{"nodeIds":["a"]}`})
	if !strings.Contains(observation, "必须先调用 canvas_inspect_visuals") || loop.billableAction {
		t.Fatalf("failed visual page must not authorize generation: %q", observation)
	}
}
