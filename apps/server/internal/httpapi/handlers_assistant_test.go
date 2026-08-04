package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
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

func TestAssistantConversationLifecycle(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")

	created := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "持久化测试"}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create conversation: status %d body %s", created.Code, created.Body.String())
	}
	data, _ := decode(t, created)
	id, _ := data["id"].(string)
	if id == "" || data["title"] != "持久化测试" {
		t.Fatalf("created conversation = %#v", data)
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

	deleted := env.do(t, http.MethodDelete, "/api/v1/assistant/conversations/"+id, nil, token)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete conversation: status %d body %s", deleted.Code, deleted.Body.String())
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
	completed, err := store.CompleteAssistantRun(ctx, env.st.Pool, run.ID, "chat")
	if err != nil || !completed {
		t.Fatalf("complete = %v, err = %v", completed, err)
	}
	stored, err := store.GetUserAssistantRun(ctx, env.st.Pool, user.ID, run.ID)
	if err != nil || stored == nil || stored.Status != "succeeded" || stored.Stage != "complete" {
		t.Fatalf("stored run = %#v, err = %v", stored, err)
	}
	adminTasks, err := store.ListAdminTasks(ctx, env.st.Pool, "assistant", "succeeded", "", nil, 20, nil)
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
	overview, err := store.GetAdminTaskOverview(ctx, env.st.Pool, "assistant", "", []uuid.UUID{user.ID})
	if err != nil {
		t.Fatalf("admin assistant overview: %v", err)
	}
	if overview.Total != 1 || overview.Succeeded != 1 || overview.Failed != 0 || overview.Today != 1 {
		t.Fatalf("admin assistant overview = %+v", overview)
	}
}
