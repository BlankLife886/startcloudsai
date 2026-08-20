package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestAssistantConfigIncludesStandardAndDiscountPointPrices(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	discount := int64(3)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI, Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "image-model", Name: "Image Model", ProviderID: "provider", UpstreamModel: "image-2",
		Kind: modelconfig.ModelKindImage, PriceCents: 20, DiscountPriceCents: &discount,
		Public: true, Enabled: true,
	}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {ModelIDs: []string{"image-model"}},
	}
	if err := modelconfig.Save(context.Background(), env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	response := env.do(t, http.MethodGet, "/api/v1/assistant/config", nil, token)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, field := range []string{`"pricePoints":3`, `"standardPricePoints":20`, `"discountPricePoints":3`} {
		if !strings.Contains(body, field) {
			t.Fatalf("assistant model price missing %s: %s", field, body)
		}
	}
}

func TestAssistantConfigExposesAssignedPublicModelsWithoutLogin(t *testing.T) {
	env := newCommunityEnv(t)
	discount := int64(3)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: "https://private.example.com", APIKey: "private-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "chat-model", Name: "Chat Model", ProviderID: "provider", UpstreamModel: "private-chat", Kind: modelconfig.ModelKindChat, PriceCents: 5, Public: true, Enabled: true},
		{ID: "image-model", Name: "Image Model", ProviderID: "provider", UpstreamModel: "private-image", Kind: modelconfig.ModelKindImage, PriceCents: 20, DiscountPriceCents: &discount, Public: true, Enabled: true},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {ModelIDs: []string{"chat-model", "image-model"}},
	}
	if err := modelconfig.Save(context.Background(), env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	response := env.do(t, http.MethodGet, "/api/v1/assistant/config", nil, "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, field := range []string{`"model":"chat-model"`, `"model":"image-model"`, `"pricePoints":3`} {
		if !strings.Contains(body, field) {
			t.Fatalf("assistant public model field missing %s: %s", field, body)
		}
	}
	for _, secret := range []string{"private-key", "private-chat", "private-image", "private.example.com"} {
		if strings.Contains(body, secret) {
			t.Fatalf("assistant config leaked private value %q: %s", secret, body)
		}
	}
}

func TestValidateAssistantMessages(t *testing.T) {
	tests := []struct {
		name     string
		messages []sub2api.Message
		wantErr  bool
	}{
		{name: "valid", messages: []sub2api.Message{{Role: "user", Content: "hello"}}},
		{name: "empty", wantErr: true},
		{name: "invalid role", messages: []sub2api.Message{{Role: "tool", Content: "hello"}}, wantErr: true},
		{name: "empty content", messages: []sub2api.Message{{Role: "user", Content: "  "}}, wantErr: true},
		{name: "message too long", messages: []sub2api.Message{{Role: "user", Content: strings.Repeat("x", maxAssistantMessageRunes+1)}}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateAssistantMessages(tt.messages); (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestAssistantRunIsTerminal(t *testing.T) {
	for _, status := range []string{"", "queued", "running", "unknown"} {
		if assistantRunIsTerminal(status) {
			t.Fatalf("status %q must remain streamable", status)
		}
	}
	for _, status := range []string{"succeeded", "failed", "canceled"} {
		if !assistantRunIsTerminal(status) {
			t.Fatalf("status %q must close the stream", status)
		}
	}
}

func TestValidateAssistantReferenceImages(t *testing.T) {
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	tests := []struct {
		name    string
		images  []string
		wantErr bool
	}{
		{name: "empty"},
		{name: "data url", images: []string{valid}},
		{name: "remote url", images: []string{"https://example.com/image.png"}},
		{name: "too many", images: []string{valid, valid, valid, valid, valid}, wantErr: true},
		{name: "relative url", images: []string{"/image.png"}, wantErr: true},
		{name: "broken data", images: []string{"data:image/png;base64,not-base64"}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateAssistantReferenceImages(tt.images)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSanitizeAssistantReferencesPreservesValidatedInlineImage(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	inline := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	references, err := sanitizeAssistantReferences([]map[string]any{{
		"id": "crop", "name": "框选截图", "dataUrl": inline,
	}}, userID)
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 || references[0]["dataUrl"] != inline {
		t.Fatalf("references = %#v, want inline image", references)
	}
	if _, err := sanitizeAssistantReferences([]map[string]any{{
		"id": "broken", "dataUrl": "data:image/png;base64,not-base64",
	}}, userID); err == nil {
		t.Fatal("broken inline image must be rejected")
	}
}

func TestAssistantTaskOutputReferenceKeys(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	items := []map[string]any{
		{"fileKey": "tasks/11111111-1111-1111-1111-111111111111/task-ignored/original/0.png"},
		{"fileKey": "tasks/" + userID.String() + "/11111111-1111-1111-1111-111111111111/original/0.png"},
		{"fileKey": "tasks/" + userID.String() + "/assistant/run/1.png"},
		{"fileKey": "tasks/" + userID.String() + "/11111111-1111-1111-1111-111111111111/original/0.png"},
	}
	got := assistantTaskOutputReferenceKeys(items, userID)
	want := "tasks/" + userID.String() + "/11111111-1111-1111-1111-111111111111/original/0.png"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("task output references = %#v, want [%q]", got, want)
	}
}

func TestAssistantUploadReferenceKeysFromMetadataIncludesAllImageCollections(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	prefix := "uploads/" + userID.String() + "/original/"
	metadata := map[string]any{
		"referenceImages": []map[string]any{{"fileKey": prefix + "reference.png"}},
		"images":          []any{map[string]any{"fileKey": prefix + "image.png"}},
		"proposal": map[string]any{
			"referenceImages": []any{map[string]any{"fileKey": prefix + "proposal-reference.png"}},
			"images":          []map[string]any{{"fileKey": prefix + "proposal-image.png"}},
		},
	}

	got := assistantUploadReferenceKeysFromMetadata(metadata, userID)
	if len(got) != 4 {
		t.Fatalf("upload references = %#v, want 4 keys", got)
	}
	for _, key := range []string{
		prefix + "reference.png",
		prefix + "image.png",
		prefix + "proposal-reference.png",
		prefix + "proposal-image.png",
	} {
		if !containsString(got, key) {
			t.Fatalf("upload references = %#v, missing %q", got, key)
		}
	}
}

func TestAssistantConversationImportRegistersAllImageReferences(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	prefix := "uploads/" + user.ID.String() + "/original/"
	keys := []string{
		prefix + "reference.png",
		prefix + "image.png",
		prefix + "proposal-reference.png",
		prefix + "proposal-image.png",
	}
	if err := store.RegisterUserUploadObjects(ctx, env.st.Pool, user.ID, keys); err != nil {
		t.Fatalf("register upload objects: %v", err)
	}

	conversationID := uuid.New()
	messageID := uuid.New()
	response := env.do(t, http.MethodPost, "/api/v1/assistant/conversation-imports", map[string]any{
		"conversations": []map[string]any{{
			"id": conversationID.String(), "title": "图片引用迁移",
			"messages": []map[string]any{{
				"id": messageID.String(), "role": "assistant", "kind": "chat", "content": "历史图片",
				"referenceImages": []map[string]any{{"fileKey": keys[0]}},
				"images":          []map[string]any{{"fileKey": keys[1]}},
				"proposal": map[string]any{
					"referenceImages": []map[string]any{{"fileKey": keys[2]}},
					"images":          []map[string]any{{"fileKey": keys[3]}},
				},
			}},
		}},
	}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("import conversations: status %d body %s", response.Code, response.Body.String())
	}

	var count int
	if err := env.st.Pool.QueryRow(ctx, `
		SELECT count(*) FROM user_upload_references
		WHERE reference_type = $1 AND reference_id = $2 AND object_key = ANY($3::text[])`,
		store.UploadReferenceAssistantMsg, messageID, keys).Scan(&count); err != nil {
		t.Fatalf("count imported references: %v", err)
	}
	if count != len(keys) {
		t.Fatalf("imported reference count = %d, want %d", count, len(keys))
	}
}

func TestAssistantConversationImportRejectsOversizedMessageHistory(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	messages := make([]map[string]any, assistantMessageLimit+1)
	for index := range messages {
		messages[index] = map[string]any{
			"id": uuid.NewString(), "role": "user", "content": "历史消息",
		}
	}

	response := env.do(t, http.MethodPost, "/api/v1/assistant/conversation-imports", map[string]any{
		"conversations": []map[string]any{{"id": uuid.NewString(), "messages": messages}},
	}, token)
	if _, code := decode(t, response); response.Code != http.StatusUnprocessableEntity || code != "validation_error" {
		t.Fatalf("oversized import: status %d code %s body %s", response.Code, code, response.Body.String())
	}
}

func TestNormalizeAssistantChatReferenceImages(t *testing.T) {
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	messages := []sub2api.Message{
		{Role: "user", Content: "先看图", ReferenceImages: []string{"  " + valid + "  "}},
		{Role: "assistant", Content: "好的"},
		{Role: "user", Content: "继续分析"},
	}
	legacy, err := normalizeAssistantChatReferenceImages(messages, []string{"https://example.com/latest.png"})
	if err != nil {
		t.Fatal(err)
	}
	if len(messages[0].ReferenceImages) != 1 || messages[0].ReferenceImages[0] != valid {
		t.Fatalf("message references = %#v", messages[0].ReferenceImages)
	}
	if len(legacy) != 1 || legacy[0] != "https://example.com/latest.png" {
		t.Fatalf("legacy references = %#v", legacy)
	}
}

func TestNormalizeAssistantChatReferenceImagesRejectsInvalidPlacementAndTotal(t *testing.T) {
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	tests := []struct {
		name     string
		messages []sub2api.Message
		legacy   []string
	}{
		{
			name: "assistant image",
			messages: []sub2api.Message{
				{Role: "assistant", Content: "answer", ReferenceImages: []string{valid}},
			},
		},
		{
			name: "more than four across messages",
			messages: []sub2api.Message{
				{Role: "user", Content: "first", ReferenceImages: []string{valid, valid}},
				{Role: "user", Content: "second", ReferenceImages: []string{valid, valid}},
			},
			legacy: []string{valid},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeAssistantChatReferenceImages(tt.messages, tt.legacy); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestValidateAssistantImageSize(t *testing.T) {
	tests := []struct {
		name    string
		size    string
		wantErr bool
	}{
		{name: "automatic", size: "auto"},
		{name: "square", size: "1024x1024"},
		{name: "widescreen", size: "1024x576"},
		{name: "portrait", size: "576x1024"},
		{name: "maximum", size: "4096x4096"},
		{name: "invalid format", size: "1024", wantErr: true},
		{name: "too small", size: "255x1024", wantErr: true},
		{name: "too large", size: "4097x1024", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateAssistantImageSize(tt.size); (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSanitizeAssistantCanvasSnapshot(t *testing.T) {
	snapshot, err := sanitizeAssistantCanvasSnapshot(nil)
	if err != nil || snapshot != nil {
		t.Fatalf("empty snapshot = %#v err=%v", snapshot, err)
	}
	snapshot, err = sanitizeAssistantCanvasSnapshot([]byte(`{"title":"测试","nodes":[{"id":"n1"}]}`))
	if err != nil {
		t.Fatalf("valid snapshot: %v", err)
	}
	payload, _ := snapshot.(map[string]any)
	if payload["title"] != "测试" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if _, err := sanitizeAssistantCanvasSnapshot([]byte(`{`)); err == nil {
		t.Fatal("expected invalid snapshot error")
	}
	if _, err := sanitizeAssistantCanvasSnapshot([]byte(strings.Repeat("a", 20_001))); err == nil {
		t.Fatal("expected oversized snapshot error")
	}
}

func TestAssistantConversationLifecycle(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")

	created := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "持久化测试"}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create conversation: status %d body %s", created.Code, created.Body.String())
	}
	data, _ := decode(t, created)
	id, _ := data["id"].(string)
	if id == "" || data["title"] != "持久化测试" || data["workspace"] != "assistant" {
		t.Fatalf("created conversation = %#v", data)
	}

	designCreated := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{
		"title": "框选图片编辑", "workspace": "ui_design",
	}, token)
	if designCreated.Code != http.StatusCreated {
		t.Fatalf("create ui design conversation: status %d body %s", designCreated.Code, designCreated.Body.String())
	}
	designData, _ := decode(t, designCreated)
	designID, _ := designData["id"].(string)
	if designID == "" || designData["workspace"] != "ui_design" {
		t.Fatalf("created ui design conversation = %#v", designData)
	}

	canvasCreated := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{
		"title": "画布文字节点", "workspace": "infinite_canvas",
	}, token)
	if canvasCreated.Code != http.StatusCreated {
		t.Fatalf("create canvas conversation: status %d body %s", canvasCreated.Code, canvasCreated.Body.String())
	}
	canvasData, _ := decode(t, canvasCreated)
	canvasID, _ := canvasData["id"].(string)
	if canvasID == "" || canvasData["workspace"] != "infinite_canvas" {
		t.Fatalf("created canvas conversation = %#v", canvasData)
	}
	mismatchedRun := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
		"conversationId": canvasID, "prompt": "画布分析", "mode": "chat",
	}, token)
	if mismatchedRun.Code != http.StatusUnprocessableEntity || !strings.Contains(mismatchedRun.Body.String(), "与对话工作区不一致") {
		t.Fatalf("mismatched canvas run: status %d body %s", mismatchedRun.Code, mismatchedRun.Body.String())
	}
	invalidRunWorkspace := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
		"conversationId": canvasID, "prompt": "画布分析", "mode": "chat", "workspace": "unknown",
	}, token)
	if invalidRunWorkspace.Code != http.StatusUnprocessableEntity || !strings.Contains(invalidRunWorkspace.Body.String(), "不支持的会话工作区") {
		t.Fatalf("invalid run workspace: status %d body %s", invalidRunWorkspace.Code, invalidRunWorkspace.Body.String())
	}

	invalid := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{
		"title": "非法工作区", "workspace": "unknown",
	}, token)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid workspace: status %d body %s", invalid.Code, invalid.Body.String())
	}

	listed := env.do(t, http.MethodGet, "/api/v1/assistant/conversations", nil, token)
	if listed.Code != http.StatusOK {
		t.Fatalf("list conversations: status %d body %s", listed.Code, listed.Body.String())
	}
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Conversations []map[string]any `json:"conversations"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Data.Conversations) != 1 || response.Data.Conversations[0]["id"] != id {
		t.Fatalf("listed conversations = %#v", response.Data.Conversations)
	}
	designUUID, err := uuid.Parse(designID)
	if err != nil {
		t.Fatal(err)
	}
	designConversation, err := store.GetUserAssistantConversation(
		context.Background(), env.st.Pool, user.ID, designUUID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if designConversation == nil || designConversation.Workspace != "ui_design" {
		t.Fatalf("ui design conversation is not recoverable by id: %#v", designConversation)
	}
	canvasUUID, err := uuid.Parse(canvasID)
	if err != nil {
		t.Fatal(err)
	}
	canvasConversation, err := store.GetUserAssistantConversation(
		context.Background(), env.st.Pool, user.ID, canvasUUID,
	)
	if err != nil || canvasConversation == nil || canvasConversation.Workspace != "infinite_canvas" {
		t.Fatalf("canvas conversation is not isolated: %#v, err=%v", canvasConversation, err)
	}
	now := time.Now().UTC()
	userMessage, err := store.InsertAssistantMessage(context.Background(), env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: designUUID, Role: "user", Content: "框选任务", Kind: "text",
		Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(context.Background(), env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: designUUID, Role: "assistant", Kind: "text",
		Status: "queued", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	designRun, err := store.InsertAssistantRun(context.Background(), env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: designUUID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "chat", Prompt: "框选任务",
		Params: map[string]any{
			"serviceKey":      "ui_design_asset",
			"workspace":       "ui_design",
			"parentOutputUrl": "/api/v1/files/tasks/parent.png",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	designRunResponse := env.do(t, http.MethodGet, "/api/v1/assistant/runs/"+designRun.ID.String(), nil, token)
	if designRunResponse.Code != http.StatusOK {
		t.Fatalf("recover ui design run by id: status %d body %s", designRunResponse.Code, designRunResponse.Body.String())
	}
	activeRunsResponse := env.do(t, http.MethodGet, "/api/v1/assistant/runs", nil, token)
	if activeRunsResponse.Code != http.StatusOK {
		t.Fatalf("list assistant runs: status %d body %s", activeRunsResponse.Code, activeRunsResponse.Body.String())
	}
	activeRunsData, _ := decode(t, activeRunsResponse)
	activeRuns, _ := activeRunsData["runs"].([]any)
	if len(activeRuns) != 0 {
		t.Fatalf("assistant active runs leaked ui design tasks: %#v", activeRuns)
	}
	designActiveResponse := env.do(t, http.MethodGet, "/api/v1/assistant/runs?workspace=ui_design", nil, token)
	if designActiveResponse.Code != http.StatusOK {
		t.Fatalf("list ui design runs: status %d body %s", designActiveResponse.Code, designActiveResponse.Body.String())
	}
	designActiveData, _ := decode(t, designActiveResponse)
	designActiveRuns, _ := designActiveData["runs"].([]any)
	if len(designActiveRuns) != 1 {
		t.Fatalf("ui design active runs: %#v", designActiveRuns)
	}
	designActiveRun, _ := designActiveRuns[0].(map[string]any)
	if designActiveRun["id"] != designRun.ID.String() ||
		designActiveRun["parentOutputUrl"] != "/api/v1/files/tasks/parent.png" ||
		designActiveRun["serviceKey"] != "ui_design_asset" {
		t.Fatalf("ui design active run payload: %#v", designActiveRun)
	}

	deleted := env.do(t, http.MethodDelete, "/api/v1/assistant/conversations/"+id, nil, token)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete conversation: status %d body %s", deleted.Code, deleted.Body.String())
	}
	designDeleted := env.do(t, http.MethodDelete, "/api/v1/assistant/conversations/"+designID+"?cancelActive=true", nil, token)
	if designDeleted.Code != http.StatusNoContent {
		t.Fatalf("delete ui design conversation: status %d body %s", designDeleted.Code, designDeleted.Body.String())
	}
	canvasDeleted := env.do(t, http.MethodDelete, "/api/v1/assistant/conversations/"+canvasID, nil, token)
	if canvasDeleted.Code != http.StatusNoContent {
		t.Fatalf("delete canvas conversation: status %d body %s", canvasDeleted.Code, canvasDeleted.Body.String())
	}
}

func TestDeleteAssistantConversationQueuesGeneratedImages(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "清理测试", now)
	if err != nil {
		t.Fatal(err)
	}
	key := "tasks/" + user.ID.String() + "/assistant/" + uuid.NewString() + "/1.png"
	if _, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image", Status: "complete",
		Metadata: map[string]any{"images": []map[string]any{{"fileKey": key}}}, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	response := env.do(t, http.MethodDelete, "/api/v1/assistant/conversations/"+conversation.ID.String(), nil, token)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete conversation: status %d body %s", response.Code, response.Body.String())
	}
	var count int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = $1`, key).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("cleanup job count = %d, want 1", count)
	}
}

func TestDeleteAssistantMessageQueuesLaterGeneratedImages(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "消息裁剪", now)
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成一张图",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	key := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	if _, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image",
		Status: "complete", Metadata: map[string]any{"images": []map[string]any{{"fileKey": key}}},
		CreatedAt: now.Add(time.Millisecond),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Content: "后续消息",
		Kind: "chat", Status: "complete", CreatedAt: now.Add(2 * time.Millisecond),
	}); err != nil {
		t.Fatal(err)
	}

	response := env.do(t, http.MethodDelete, "/api/v1/assistant/messages/"+source.ID.String()+"?scope=turn", nil, token)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete assistant message: status %d body %s", response.Code, response.Body.String())
	}
	var messageCount int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM assistant_messages WHERE conversation_id = $1`, conversation.ID).Scan(&messageCount); err != nil {
		t.Fatal(err)
	}
	if messageCount != 0 {
		t.Fatalf("remaining assistant messages = %d, want 0", messageCount)
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, env.st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	// 原图 + 约定推导的小图/展示图变体一并入队清理。
	if len(locked) != 3 || !containsString(locked, key) {
		t.Fatalf("message cleanup candidates = %#v, want %q plus 2 variants", locked, key)
	}
}

func TestValidateAssistantRunCapacity(t *testing.T) {
	conversationID := uuid.New()
	active := []*store.AssistantRun{{ConversationID: conversationID}}
	err := validateAssistantRunCapacity(active, conversationID)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Code != "assistant_conversation_busy" {
		t.Fatalf("same conversation error = %#v", err)
	}

	active = make([]*store.AssistantRun, 0, assistantActiveRunLimit)
	for range assistantActiveRunLimit {
		active = append(active, &store.AssistantRun{ConversationID: uuid.New()})
	}
	err = validateAssistantRunCapacity(active, conversationID)
	appErr, ok = apperr.As(err)
	if !ok || appErr.Code != "assistant_run_limit" {
		t.Fatalf("run limit error = %#v", err)
	}

	if err := validateAssistantRunCapacity(active[:assistantActiveRunLimit-1], conversationID); err != nil {
		t.Fatalf("three other conversations should be allowed: %v", err)
	}
}

func TestSelectAssistantRunModelFallsBackForHistoricalRetry(t *testing.T) {
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: "https://example.com", APIKey: "test-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "current-image", Name: "Current Image", ProviderID: "provider", UpstreamModel: "image-current",
		Kind: modelconfig.ModelKindImage, Public: true, Default: true, Enabled: true,
	}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {
			ModelIDs:        []string{"current-image"},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindImage: "current-image"},
		},
	}

	if selection, ok := selectAssistantRunModel(
		cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindImage, "removed-image", false,
	); ok || selection != nil {
		t.Fatalf("new request must reject removed model: %#v, %v", selection, ok)
	}
	selection, ok := selectAssistantRunModel(
		cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindImage, "removed-image", true,
	)
	if !ok || selection == nil || selection.Model.ID != "current-image" {
		t.Fatalf("historical retry fallback = %#v, %v", selection, ok)
	}
}

func TestUIDesignAnalysisCanUseAssistantChatFallback(t *testing.T) {
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: "https://example.com", APIKey: "test-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "assistant-chat", Name: "Assistant Chat", ProviderID: "provider", UpstreamModel: "chat-current",
		Kind: modelconfig.ModelKindChat, Public: true, Default: true, Enabled: true,
	}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {
			ModelIDs:        []string{"assistant-chat"},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "assistant-chat"},
		},
		modelconfig.WorkspaceUIDesign: {ModelIDs: []string{}},
	}

	selection, ok := selectAssistantServiceModel(
		cfg, modelconfig.WorkspaceUIDesign, modelconfig.ModelKindChat, "assistant-chat", false,
	)
	if !ok || selection == nil || selection.Model.ID != "assistant-chat" {
		t.Fatalf("assistant chat fallback = %#v, %v", selection, ok)
	}
}

func TestInfiniteCanvasSelectsItsAssignedChatModel(t *testing.T) {
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: "https://example.com", APIKey: "test-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "assistant-chat", Name: "Assistant", ProviderID: "provider", UpstreamModel: "assistant-upstream", Kind: modelconfig.ModelKindChat, Public: true, Enabled: true},
		{ID: "canvas-chat", Name: "Canvas", ProviderID: "provider", UpstreamModel: "canvas-upstream", Kind: modelconfig.ModelKindChat, Public: true, Enabled: true},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {ModelIDs: []string{"assistant-chat"}},
		modelconfig.WorkspaceCanvas: {
			ModelIDs:        []string{"canvas-chat"},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "canvas-chat"},
		},
	}

	selection, ok := selectAssistantServiceModel(cfg, modelconfig.WorkspaceCanvas, modelconfig.ModelKindChat, "canvas-chat", false)
	if !ok || selection == nil || selection.Model.ID != "canvas-chat" {
		t.Fatalf("canvas chat selection = %#v, %v", selection, ok)
	}
	if selection, ok := selectAssistantServiceModel(cfg, modelconfig.WorkspaceCanvas, modelconfig.ModelKindChat, "assistant-chat", false); ok || selection != nil {
		t.Fatalf("assistant model must not leak into canvas assignment: %#v, %v", selection, ok)
	}
}

func TestDeleteActiveAssistantConversationRequiresConfirmation(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "运行中的对话", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成图片",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image",
		Status: "queued", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "生成图片",
	})
	if err != nil {
		t.Fatal(err)
	}

	path := "/api/v1/assistant/conversations/" + conversation.ID.String()
	refused := env.do(t, http.MethodDelete, path, nil, token)
	if refused.Code != http.StatusConflict {
		t.Fatalf("delete active conversation: status %d body %s", refused.Code, refused.Body.String())
	}
	if _, code := decode(t, refused); code != "assistant_conversation_busy" {
		t.Fatalf("delete active conversation code = %q", code)
	}

	confirmed := env.do(t, http.MethodDelete, path+"?cancelActive=true", nil, token)
	if confirmed.Code != http.StatusNoContent {
		t.Fatalf("confirmed delete: status %d body %s", confirmed.Code, confirmed.Body.String())
	}
	stored, err := store.GetUserAssistantConversation(ctx, env.st.Pool, user.ID, conversation.ID)
	if err != nil || stored != nil {
		t.Fatalf("conversation after confirmed delete = %#v, err = %v", stored, err)
	}
}

func TestAssistantRunStatePersistence(t *testing.T) {
	env := newCommunityEnv(t)
	user, _ := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "任务测试", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "你好",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "agent",
		Status: "queued", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "agent", Prompt: "你好", Params: map[string]any{"count": 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimAssistantRun(ctx, env.st.Pool, run.ID)
	if err != nil || !claimed {
		t.Fatalf("claim = %v, err = %v", claimed, err)
	}
	if err := store.SetAssistantRunStage(ctx, env.st.Pool, run.ID, "chat", "answering"); err != nil {
		t.Fatal(err)
	}
	completed, err := store.CompleteAssistantRun(ctx, env.st.Pool, run.ID, "chat", 0)
	if err != nil || !completed {
		t.Fatalf("complete = %v, err = %v", completed, err)
	}
	stored, err := store.GetUserAssistantRun(ctx, env.st.Pool, user.ID, run.ID)
	if err != nil || stored == nil || stored.Status != "succeeded" || stored.Stage != "complete" {
		t.Fatalf("stored run = %#v, err = %v", stored, err)
	}
	adminTasks, err := store.ListAdminTasks(ctx, env.st.Pool, "assistant", "succeeded", "", nil, 20, nil, "")
	if err != nil {
		t.Fatalf("list admin assistant tasks: %v", err)
	}
	var listed *store.Task
	for _, task := range adminTasks {
		if task.ID == run.ID {
			listed = task
			break
		}
	}
	if listed == nil || listed.Type != "assistant" || listed.Status != "succeeded" {
		t.Fatalf("admin assistant task = %#v", listed)
	}
	if listed.Params["stage"] != "complete" || listed.Params["resolvedMode"] != "chat" {
		t.Fatalf("admin assistant params = %#v", listed.Params)
	}
	overview, err := store.GetAdminTaskOverview(ctx, env.st.Pool, "assistant", "", []uuid.UUID{user.ID}, "")
	if err != nil {
		t.Fatalf("admin assistant overview: %v", err)
	}
	if overview.Total != 1 || overview.Succeeded != 1 || overview.Failed != 0 || overview.Today != 1 {
		t.Fatalf("admin assistant overview = %+v", overview)
	}

	canvasConversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, env.st.Pool, uuid.New(), user.ID, "画布任务", store.PromptTaskTypeCanvas, now.Add(time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	canvasUserMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: canvasConversation.ID, Role: "user", Content: "分析商品图",
		Kind: "chat", Status: "complete", CreatedAt: now.Add(time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	canvasAssistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: canvasConversation.ID, Role: "assistant", Kind: "chat",
		Status: "queued", CreatedAt: now.Add(time.Second + time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	canvasRun, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: canvasConversation.ID,
		UserMessageID: canvasUserMessage.ID, AssistantMessageID: canvasAssistantMessage.ID,
		Mode: "chat", Prompt: "分析商品图", Params: map[string]any{"count": 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed, claimErr := store.ClaimAssistantRun(ctx, env.st.Pool, canvasRun.ID); claimErr != nil || !claimed {
		t.Fatalf("claim canvas run = %v, err = %v", claimed, claimErr)
	}
	if completed, completeErr := store.CompleteAssistantRun(ctx, env.st.Pool, canvasRun.ID, "chat", 0); completeErr != nil || !completed {
		t.Fatalf("complete canvas run = %v, err = %v", completed, completeErr)
	}

	assistantOnly, err := store.ListAdminTasks(ctx, env.st.Pool, "assistant", "succeeded", "", nil, 20, nil, "")
	if err != nil || len(assistantOnly) != 1 || assistantOnly[0].ID != run.ID {
		t.Fatalf("assistant tasks polluted by canvas run: %#v, err=%v", assistantOnly, err)
	}
	canvasOnly, err := store.ListAdminTasks(ctx, env.st.Pool, "", "succeeded", "", nil, 20, nil, store.CanvasTaskSource)
	if err != nil || len(canvasOnly) != 1 || canvasOnly[0].ID != canvasRun.ID {
		t.Fatalf("canvas task classification = %#v, err=%v", canvasOnly, err)
	}
	canvasAdminDict := adminTaskDict(canvasOnly[0], nil)
	if canvasAdminDict["source"] != store.PromptTaskTypeCanvas {
		t.Fatalf("canvas admin source = %#v", canvasAdminDict)
	}
}

func TestCancelAssistantRunQueuesGeneratedImagesAtomically(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "取消清理", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成图片",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessageID := uuid.New()
	imageKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	proposalImageKey := fmt.Sprintf("tasks/%s/assistant/%s/2.png", user.ID, uuid.New())
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: assistantMessageID, ConversationID: conversation.ID, Role: "assistant", Kind: "image",
		Status: "running", Metadata: map[string]any{
			"images": []map[string]any{{"fileKey": imageKey}},
			"proposal": map[string]any{
				"images": []map[string]any{{"fileKey": proposalImageKey}},
			},
		}, CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "生成图片",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE assistant_runs SET status = 'running', stage = 'generating-image' WHERE id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}

	response := env.do(t, http.MethodPatch, "/api/v1/assistant/runs/"+run.ID.String(),
		map[string]any{"status": "canceled"}, token)
	if response.Code != http.StatusOK {
		t.Fatalf("cancel assistant run: status %d body %s", response.Code, response.Body.String())
	}
	storedRun, err := store.GetAssistantRun(ctx, env.st.Pool, run.ID)
	if err != nil || storedRun == nil || storedRun.Status != "canceled" {
		t.Fatalf("stored canceled run = %#v, err = %v", storedRun, err)
	}
	storedMessage, err := store.GetAssistantMessage(ctx, env.st.Pool, assistantMessageID)
	if err != nil || storedMessage == nil || storedMessage.Status != "stopped" {
		t.Fatalf("stored stopped message = %#v, err = %v", storedMessage, err)
	}
	var hasImages, hasProposalImages bool
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT metadata ? 'images', COALESCE((metadata->'proposal') ? 'images', false)
		 FROM assistant_messages WHERE id = $1`, assistantMessageID).Scan(&hasImages, &hasProposalImages); err != nil {
		t.Fatal(err)
	}
	if hasImages || hasProposalImages {
		t.Fatalf("stopped message still references outputs: images=%v proposalImages=%v", hasImages, hasProposalImages)
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, env.st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	// 每个原图都会带 2 个变体 key 入队清理。
	if len(locked) != 6 || !containsString(locked, imageKey) || !containsString(locked, proposalImageKey) {
		t.Fatalf("assistant cleanup candidates = %#v, want %q and %q plus variants", locked, imageKey, proposalImageKey)
	}
}

func TestAdminAssistantTerminalActionsQueueGeneratedImagesAtomically(t *testing.T) {
	env := newCommunityEnv(t)
	user, _ := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	ctx := context.Background()
	now := time.Now().UTC()

	createRun := func(status string) (uuid.UUID, uuid.UUID, string) {
		t.Helper()
		conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "后台终态清理", now)
		if err != nil {
			t.Fatal(err)
		}
		userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成图片",
			Kind: "chat", Status: "complete", CreatedAt: now,
		})
		if err != nil {
			t.Fatal(err)
		}
		messageID := uuid.New()
		key := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
		message, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
			ID: messageID, ConversationID: conversation.ID, Role: "assistant", Kind: "image",
			Status: status, Metadata: map[string]any{"images": []map[string]any{{"fileKey": key}}},
			CreatedAt: now.Add(time.Millisecond),
		})
		if err != nil {
			t.Fatal(err)
		}
		run, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
			ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
			UserMessageID: userMessage.ID, AssistantMessageID: message.ID,
			Mode: "image", Prompt: "生成图片",
		})
		if err != nil {
			t.Fatal(err)
		}
		if status == "running" {
			if _, err := env.st.Pool.Exec(ctx,
				`UPDATE assistant_runs SET status = 'running', stage = 'generating-image' WHERE id = $1`, run.ID); err != nil {
				t.Fatal(err)
			}
		}
		return run.ID, messageID, key
	}

	queuedRunID, queuedMessageID, queuedKey := createRun("queued")
	runningRunID, runningMessageID, runningKey := createRun("running")
	canceled := env.do(t, http.MethodPatch, "/api/v1/admin/tasks/"+queuedRunID.String(),
		map[string]any{"status": "canceled"}, adminToken)
	if canceled.Code != http.StatusOK {
		t.Fatalf("admin cancel assistant run: status %d body %s", canceled.Code, canceled.Body.String())
	}
	failed := env.do(t, http.MethodPatch, "/api/v1/admin/tasks/"+runningRunID.String(),
		map[string]any{"status": "failed"}, adminToken)
	if failed.Code != http.StatusOK {
		t.Fatalf("admin force-fail assistant run: status %d body %s", failed.Code, failed.Body.String())
	}

	for _, item := range []struct {
		runID     uuid.UUID
		messageID uuid.UUID
		status    string
	}{
		{queuedRunID, queuedMessageID, "canceled"},
		{runningRunID, runningMessageID, "failed"},
	} {
		run, err := store.GetAssistantRun(ctx, env.st.Pool, item.runID)
		if err != nil || run == nil || run.Status != item.status {
			t.Fatalf("admin terminal run = %#v err=%v, want %s", run, err, item.status)
		}
		message, err := store.GetAssistantMessage(ctx, env.st.Pool, item.messageID)
		if err != nil || message == nil {
			t.Fatalf("admin terminal message = %#v err=%v", message, err)
		}
		var hasImages bool
		if err := env.st.Pool.QueryRow(ctx,
			`SELECT metadata ? 'images' FROM assistant_messages WHERE id = $1`, item.messageID).Scan(&hasImages); err != nil {
			t.Fatal(err)
		}
		if hasImages {
			t.Fatalf("admin terminal message %s still references images", item.messageID)
		}
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, env.st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	// 每个原图都会带 2 个变体 key 入队清理。
	if len(locked) != 6 || !containsString(locked, queuedKey) || !containsString(locked, runningKey) {
		t.Fatalf("admin cleanup candidates = %#v, want %q and %q plus variants", locked, queuedKey, runningKey)
	}
}
