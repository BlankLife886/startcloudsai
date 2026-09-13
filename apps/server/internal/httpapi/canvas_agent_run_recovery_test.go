package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestCanvasAgentRunSnapshotPreservesExactInputReferences(t *testing.T) {
	userID, conversationID := uuid.New(), uuid.New()
	run := &store.AssistantRun{
		ID: uuid.New(), UserID: userID, ConversationID: conversationID,
		UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Status: "running",
		Params: map[string]any{"workspace": modelconfig.WorkspaceCanvas},
	}
	references := []map[string]any{
		{"id": "original-attachment", "name": "商品.png", "dataUrl": "data:image/png;base64,aW1hZ2U="},
		{"id": "cloud-reference", "name": "细节.jpg", "fileKey": "uploads/" + userID.String() + "/original/detail.jpg", "dataUrl": "/api/v1/files/uploads/" + userID.String() + "/original/detail.jpg"},
	}
	input := &store.AssistantMessage{
		ID: run.UserMessageID, ConversationID: conversationID, Role: "user", Content: "按这两张图片搭建工作流",
		Metadata: map[string]any{"referenceImages": references, "_private": "hidden"},
	}
	answer := &store.AssistantMessage{ID: run.AssistantMessageID, ConversationID: conversationID, Role: "assistant", Status: "running"}
	payload, err := assistantRunSnapshot(userID, run, input, answer)
	if err != nil {
		t.Fatal(err)
	}
	returnedInput := payload["userMessage"].(gin.H)
	if returnedInput["id"] != run.UserMessageID.String() || returnedInput["role"] != "user" {
		t.Fatalf("run input identity changed: %#v", returnedInput)
	}
	returnedReferences := returnedInput["referenceImages"].([]map[string]any)
	if len(returnedReferences) != 2 || returnedReferences[0]["id"] != "original-attachment" || returnedReferences[0]["dataUrl"] != references[0]["dataUrl"] || returnedReferences[1]["fileKey"] != references[1]["fileKey"] {
		t.Fatalf("run references were not preserved: %#v", returnedReferences)
	}
	if _, exists := returnedInput["_private"]; exists {
		t.Fatal("private message metadata leaked")
	}
	returnedRun := payload["run"].(gin.H)
	if returnedRun["conversationId"] != conversationID.String() || returnedRun["workspace"] != modelconfig.WorkspaceCanvas || returnedRun["userMessageId"] != run.UserMessageID.String() || returnedRun["assistantMessageId"] != run.AssistantMessageID.String() {
		t.Fatalf("run recovery scope is incomplete: %#v", returnedRun)
	}
}

func TestCanvasAgentRunSnapshotRejectsUnrelatedInput(t *testing.T) {
	userID, conversationID := uuid.New(), uuid.New()
	run := &store.AssistantRun{ID: uuid.New(), UserID: userID, ConversationID: conversationID, UserMessageID: uuid.New()}
	valid := store.AssistantMessage{ID: run.UserMessageID, ConversationID: conversationID, Role: "user"}
	for _, test := range []struct {
		name  string
		owner uuid.UUID
		input *store.AssistantMessage
	}{
		{"another account", uuid.New(), &valid},
		{"missing input", userID, nil},
		{"another turn", userID, &store.AssistantMessage{ID: uuid.New(), ConversationID: conversationID, Role: "user"}},
		{"another conversation", userID, &store.AssistantMessage{ID: run.UserMessageID, ConversationID: uuid.New(), Role: "user"}},
		{"assistant role", userID, &store.AssistantMessage{ID: run.UserMessageID, ConversationID: conversationID, Role: "assistant"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload, err := assistantRunSnapshot(test.owner, run, test.input, nil)
			apiError, _ := apperr.As(err)
			if err == nil || payload != nil || apiError == nil || apiError.Status != http.StatusNotFound {
				t.Fatalf("unrelated input accepted: payload=%#v err=%v", payload, err)
			}
		})
	}
}

func TestCanvasAgentRunSnapshotKeepsTerminalStatus(t *testing.T) {
	userID, conversationID := uuid.New(), uuid.New()
	for _, status := range []string{"succeeded", "failed", "canceled"} {
		run := &store.AssistantRun{ID: uuid.New(), UserID: userID, ConversationID: conversationID, UserMessageID: uuid.New(), Status: status}
		input := &store.AssistantMessage{ID: run.UserMessageID, ConversationID: conversationID, Role: "user"}
		payload, err := assistantRunSnapshot(userID, run, input, nil)
		if err != nil || payload["run"].(gin.H)["status"] != status {
			t.Fatalf("terminal run %q changed during recovery: %#v, %v", status, payload, err)
		}
	}
}

func TestCanvasAgentRunGETReturnsItsOwnMessageAndRejectsOtherAccount(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(ctx, env.st.Pool, uuid.New(), user.ID, "刷新恢复", modelconfig.WorkspaceCanvas, now)
	if err != nil {
		t.Fatal(err)
	}
	createRun := func(attachmentID string, createdAt time.Time) *store.AssistantRun {
		t.Helper()
		input, insertErr := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: attachmentID, Kind: "chat", Status: "complete", CreatedAt: createdAt,
			Metadata: map[string]any{"referenceImages": []map[string]any{{"id": attachmentID, "name": attachmentID + ".png", "dataUrl": "data:image/png;base64,aW1hZ2U="}}},
		})
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		answer, insertErr := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "agent", Status: "queued", CreatedAt: createdAt.Add(time.Millisecond),
		})
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		run, insertErr := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
			ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID, UserMessageID: input.ID, AssistantMessageID: answer.ID,
			Mode: "agent", Prompt: attachmentID, Params: map[string]any{"workspace": modelconfig.WorkspaceCanvas},
		})
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		return run
	}
	first := createRun("first-turn-image", now)
	_ = createRun("later-turn-image", now.Add(time.Second))
	path := "/api/v1/assistant/runs/" + first.ID.String() + "?includeInput=1"
	result := env.do(t, http.MethodGet, path, nil, token)
	if result.Code != http.StatusOK {
		t.Fatalf("read run: status=%d body=%s", result.Code, result.Body.String())
	}
	payload, _ := decode(t, result)
	input := payload["userMessage"].(map[string]any)
	references := input["referenceImages"].([]any)
	if input["id"] != first.UserMessageID.String() || len(references) != 1 || references[0].(map[string]any)["id"] != "first-turn-image" {
		t.Fatalf("another turn's input returned: %#v", input)
	}
	if result := env.do(t, http.MethodGet, path, nil, otherToken); result.Code != http.StatusNotFound {
		t.Fatalf("another account read run: status=%d body=%s", result.Code, result.Body.String())
	}
	if result := env.do(t, http.MethodGet, path, nil, ""); result.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous caller read run: status=%d body=%s", result.Code, result.Body.String())
	}
	poll := env.do(t, http.MethodGet, "/api/v1/assistant/runs/"+first.ID.String(), nil, token)
	pollData, _ := decode(t, poll)
	if _, exists := pollData["userMessage"]; exists {
		t.Fatal("ordinary polling must not repeatedly transmit input images")
	}
}

func TestCanvasAgentRecoveryReadsHistoricalWorkflowWithoutTakingLease(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	created := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{"title": "恢复测试", "document": map[string]any{"version": 3, "nodes": []any{}, "connections": []any{}}}, token)
	project, _ := decode(t, created)
	path := "/api/v1/canvas-projects/" + project["id"].(string) + "/workflow-runs"
	owner := uuid.NewString()
	request := map[string]any{"ownerId": owner, "nodeIds": []string{"a"}, "inputSignature": "v1:0123456789abcdef"}
	first := env.do(t, http.MethodPost, path, request, token)
	data, _ := decode(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("create workflow: %s", first.Body.String())
	}
	runID := data["run"].(map[string]any)["id"].(string)
	finished := env.do(t, http.MethodPatch, path+"/"+runID, map[string]any{"ownerId": owner, "status": "succeeded", "completedNodeIds": []string{"a"}}, token)
	if finished.Code != http.StatusOK {
		t.Fatalf("finish workflow: %s", finished.Body.String())
	}
	_ = env.do(t, http.MethodPost, path, request, token)
	response := env.do(t, http.MethodGet, path+"/"+runID, nil, token)
	if response.Code != http.StatusOK {
		t.Fatalf("read history: %s", response.Body.String())
	}
	history, _ := decode(t, response)
	run := history["run"].(map[string]any)
	if run["id"] != runID || run["status"] != "succeeded" || run["ownerId"] != owner {
		t.Fatalf("wrong run returned: %#v", run)
	}
	for _, target := range []struct{ path, token string }{{path + "/" + runID, otherToken}, {"/api/v1/canvas-projects/" + uuid.NewString() + "/workflow-runs/" + runID, token}} {
		if result := env.do(t, http.MethodGet, target.path, nil, target.token); result.Code != http.StatusNotFound {
			t.Fatalf("unrelated run exposed: %d %s", result.Code, result.Body.String())
		}
	}
}
