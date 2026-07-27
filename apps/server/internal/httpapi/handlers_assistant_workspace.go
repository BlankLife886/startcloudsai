package httpapi

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	assistantConversationLimit = 40
	assistantMessageLimit      = 160
	assistantActiveRunLimit    = 4
)

type createAssistantConversationIn struct {
	Title string `json:"title"`
}

type importAssistantConversationsIn struct {
	Conversations []struct {
		ID        string           `json:"id"`
		Title     string           `json:"title"`
		CreatedAt string           `json:"createdAt"`
		UpdatedAt string           `json:"updatedAt"`
		Messages  []map[string]any `json:"messages"`
	} `json:"conversations"`
}

type assistantRunIn struct {
	ConversationID           string           `json:"conversationId"`
	Prompt                   string           `json:"prompt"`
	Mode                     string           `json:"mode"`
	ClientUserMessageID      string           `json:"clientUserMessageId"`
	ClientAssistantMessageID string           `json:"clientAssistantMessageId"`
	SourceUserMessageID      string           `json:"sourceUserMessageId"`
	ReferenceImages          []map[string]any `json:"referenceImages"`
	Quoted                   map[string]any   `json:"quoted"`
	Skill                    string           `json:"skill"`
	Model                    string           `json:"model"`
	Ratio                    string           `json:"ratio"`
	Resolution               string           `json:"resolution"`
	Count                    int              `json:"count"`
	RequestSize              string           `json:"requestSize"`
	Width                    int              `json:"width"`
	Height                   int              `json:"height"`
	Quality                  string           `json:"quality"`
}

func (s *Server) assistantConversations(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListAssistantConversations(c.Request.Context(), s.St.Pool, user.ID, assistantConversationLimit)
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(items))
	for _, item := range items {
		messages, err := store.ListAssistantMessages(c.Request.Context(), s.St.Pool, item.ID, assistantMessageLimit)
		if err != nil {
			fail(c, err)
			return
		}
		out = append(out, assistantConversationDict(item, messages))
	}
	ok(c, gin.H{"conversations": out})
}

func (s *Server) createAssistantConversation(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body createAssistantConversationIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	title := assistantTitle(body.Title)
	item, err := store.InsertAssistantConversation(c.Request.Context(), s.St.Pool, uuid.New(), user.ID, title, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, assistantConversationDict(item, nil))
}

func (s *Server) deleteAssistantConversation(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	cancelActive := strings.EqualFold(strings.TrimSpace(c.Query("cancelActive")), "true")
	deleted := false
	canceledRunIDs := make([]uuid.UUID, 0, 1)
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		if err := store.LockAssistantRunsForUser(c.Request.Context(), tx, user.ID); err != nil {
			return err
		}
		active, err := store.ListActiveUserAssistantRuns(c.Request.Context(), tx, user.ID)
		if err != nil {
			return err
		}
		for _, run := range active {
			if run.ConversationID != id {
				continue
			}
			if !cancelActive {
				return apperr.E("assistant_conversation_busy", "该对话仍有任务正在运行，请先停止任务", 409)
			}
			canceled, err := store.CancelAssistantRun(c.Request.Context(), tx, user.ID, run.ID)
			if err != nil {
				return err
			}
			if canceled {
				canceledRunIDs = append(canceledRunIDs, run.ID)
			}
		}
		deletedNow, deleteErr := store.DeleteUserAssistantConversation(c.Request.Context(), tx, user.ID, id)
		deleted = deletedNow
		return deleteErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("not_found", "对话不存在", 404))
		return
	}
	if s.Queue != nil {
		for _, runID := range canceledRunIDs {
			s.Queue.CancelAssistantRun(runID.String())
		}
	}
	ok(c, gin.H{"deleted": true, "canceledRuns": len(canceledRunIDs)})
}

func (s *Server) deleteAssistantMessage(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	deleted, err := store.DeleteUserAssistantMessage(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("not_found", "消息不存在", 404))
		return
	}
	ok(c, gin.H{"deleted": true})
}

func (s *Server) importAssistantConversations(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body importAssistantConversationsIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.Conversations) > assistantConversationLimit {
		fail(c, apperr.E("validation_error", "历史对话数量过多", 422))
		return
	}
	existing, err := store.ListAssistantConversations(c.Request.Context(), s.St.Pool, user.ID, 1)
	if err != nil {
		fail(c, err)
		return
	}
	if len(existing) > 0 || len(body.Conversations) == 0 {
		ok(c, gin.H{"imported": 0})
		return
	}
	imported := 0
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		for _, incoming := range body.Conversations {
			conversationID := parseAssistantUUID(incoming.ID)
			createdAt := parseAssistantTime(incoming.CreatedAt)
			conversation, err := store.InsertAssistantConversation(c.Request.Context(), tx, conversationID, user.ID,
				assistantTitle(incoming.Title), createdAt)
			if err != nil {
				return err
			}
			for _, raw := range incoming.Messages {
				role := assistantMapText(raw, "role")
				if role != "user" && role != "assistant" {
					continue
				}
				content := truncateAssistantText(assistantMapText(raw, "content"), maxAssistantMessageRunes)
				metadata := assistantImportMetadata(raw)
				status := "complete"
				if pending, _ := raw["pending"].(bool); pending {
					status = "stopped"
					metadata["pending"] = false
					metadata["statusStage"] = "stopped"
				}
				_, err = store.InsertAssistantMessage(c.Request.Context(), tx, store.AssistantMessage{
					ID: parseAssistantUUID(assistantMapText(raw, "id")), ConversationID: conversation.ID,
					Role: role, Content: content, Kind: assistantMessageKind(raw), Status: status,
					Metadata: metadata, CreatedAt: parseAssistantTime(assistantMapText(raw, "createdAt")),
				})
				if err != nil {
					return err
				}
			}
			updatedAt := parseAssistantTime(incoming.UpdatedAt)
			if updatedAt.Before(createdAt) {
				updatedAt = createdAt
			}
			if err := store.TouchAssistantConversation(c.Request.Context(), tx, user.ID, conversation.ID, nil, updatedAt); err != nil {
				return err
			}
			imported++
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"imported": imported})
}

func (s *Server) createAssistantRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	assistantClient, err := s.assistantClient(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body assistantRunIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Prompt = strings.TrimSpace(body.Prompt)
	if body.Prompt == "" || len([]rune(body.Prompt)) > maxAssistantMessageRunes {
		fail(c, apperr.E("validation_error", "消息长度须在 1-12000 之间", 422))
		return
	}
	if body.Mode != "agent" && body.Mode != "chat" && body.Mode != "image" {
		fail(c, apperr.E("validation_error", "无效的创作模式", 422))
		return
	}
	body.Model = strings.TrimSpace(body.Model)
	if body.Model == "" || (body.Mode != "image" && body.Model == assistantClient.ImageModel()) {
		body.Model = assistantClient.ChatModel()
	}
	if len([]rune(body.Model)) > 120 {
		fail(c, apperr.E("validation_error", "模型名称不能超过 120 个字符", 422))
		return
	}
	if len(body.ReferenceImages) > maxAssistantReferences {
		fail(c, apperr.E("validation_error", "最多允许 4 张参考图", 422))
		return
	}
	if body.Count == 0 {
		body.Count = 2
	}
	if body.Count < 1 || body.Count > 4 {
		fail(c, apperr.E("validation_error", "图片数量须在 1-4 之间", 422))
		return
	}
	if body.RequestSize == "" {
		body.RequestSize = "auto"
	}
	if err := validateAssistantImageSize(body.RequestSize); err != nil {
		fail(c, err)
		return
	}
	if body.Quality == "" {
		body.Quality = "high"
	}
	if !containsString([]string{"low", "medium", "high"}, body.Quality) {
		fail(c, apperr.E("validation_error", "不支持的图片质量", 422))
		return
	}
	conversationID, err := uuid.Parse(body.ConversationID)
	if err != nil {
		fail(c, apperr.E("validation_error", "conversationId 无效", 422))
		return
	}
	conversation, err := store.GetUserAssistantConversation(c.Request.Context(), s.St.Pool, user.ID, conversationID)
	if err != nil {
		fail(c, err)
		return
	}
	if conversation == nil {
		fail(c, apperr.E("not_found", "对话不存在", 404))
		return
	}
	runID := uuid.New()
	userMessageID := parseAssistantUUID(body.ClientUserMessageID)
	assistantMessageID := parseAssistantUUID(body.ClientAssistantMessageID)
	now := time.Now().UTC()
	references := sanitizeAssistantReferences(body.ReferenceImages, user.ID)
	userMetadata := map[string]any{"referenceImages": references, "quoted": body.Quoted, "skill": body.Skill}
	params := map[string]any{
		"referenceImages": references, "prompt": body.Prompt, "model": body.Model, "ratio": body.Ratio,
		"resolution": body.Resolution, "count": body.Count, "requestSize": body.RequestSize,
		"width": body.Width, "height": body.Height, "quality": body.Quality,
	}
	var userMessage, assistantMessage *store.AssistantMessage
	var run *store.AssistantRun
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		if err := store.LockAssistantRunsForUser(c.Request.Context(), tx, user.ID); err != nil {
			return err
		}
		active, err := store.ListActiveUserAssistantRuns(c.Request.Context(), tx, user.ID)
		if err != nil {
			return err
		}
		if err := validateAssistantRunCapacity(active, conversationID); err != nil {
			return err
		}
		if body.SourceUserMessageID != "" {
			sourceID, parseErr := uuid.Parse(body.SourceUserMessageID)
			if parseErr != nil {
				return apperr.E("validation_error", "sourceUserMessageId 无效", 422)
			}
			source, getErr := store.GetAssistantMessage(c.Request.Context(), tx, sourceID)
			if getErr != nil || source == nil || source.ConversationID != conversationID || source.Role != "user" {
				return apperr.E("not_found", "原问题不存在", 404)
			}
			if err := store.DeleteAssistantMessagesAfter(c.Request.Context(), tx, conversationID, sourceID); err != nil {
				return err
			}
			if err := store.UpdateAssistantUserMessage(c.Request.Context(), tx, sourceID, body.Prompt, userMetadata); err != nil {
				return err
			}
			userMessage, getErr = store.GetAssistantMessage(c.Request.Context(), tx, sourceID)
			if getErr != nil {
				return getErr
			}
			userMessageID = sourceID
		} else {
			var insertErr error
			userMessage, insertErr = store.InsertAssistantMessage(c.Request.Context(), tx, store.AssistantMessage{
				ID: userMessageID, ConversationID: conversationID, Role: "user", Content: body.Prompt,
				Kind: "chat", Status: "complete", Metadata: userMetadata, CreatedAt: now,
			})
			if insertErr != nil {
				return insertErr
			}
		}
		assistantMetadata := make(map[string]any, len(params)+5)
		for key, value := range params {
			if key == "referenceImages" {
				continue
			}
			assistantMetadata[key] = value
		}
		assistantMetadata["runId"] = runID.String()
		assistantMetadata["pending"] = true
		assistantMetadata["routing"] = body.Mode == "agent"
		assistantMetadata["statusStage"] = map[bool]string{true: "routing", false: "thinking"}[body.Mode == "agent"]
		if body.Mode == "image" {
			assistantMetadata["statusStage"] = "preparing-image"
		}
		var insertErr error
		assistantMessage, insertErr = store.InsertAssistantMessage(c.Request.Context(), tx, store.AssistantMessage{
			ID: assistantMessageID, ConversationID: conversationID, Role: "assistant", Content: "",
			Kind: body.Mode, Status: "queued", Metadata: assistantMetadata, CreatedAt: now.Add(time.Millisecond),
		})
		if insertErr != nil {
			return insertErr
		}
		run, insertErr = store.InsertAssistantRun(c.Request.Context(), tx, store.AssistantRun{
			ID: runID, UserID: user.ID, ConversationID: conversationID, UserMessageID: userMessageID,
			AssistantMessageID: assistantMessageID, Mode: body.Mode, Prompt: body.Prompt, Params: params,
		})
		if insertErr != nil {
			return insertErr
		}
		var title *string
		if conversation.Title == "新对话" {
			value := assistantTitle(body.Prompt)
			title = &value
		}
		return store.TouchAssistantConversation(c.Request.Context(), tx, user.ID, conversationID, title, now)
	})
	if err != nil {
		fail(c, err)
		return
	}
	if err := s.Queue.EnqueueAssistantRun(c.Request.Context(), run.ID.String()); err != nil {
		message := "任务入队失败，请稍后重试"
		_, _ = store.FailAssistantRun(c.Request.Context(), s.St.Pool, run.ID, "queue_error", message)
		_ = store.UpdateAssistantMessage(c.Request.Context(), s.St.Pool, assistantMessage.ID, message, body.Mode, "failed",
			map[string]any{"runId": run.ID.String(), "pending": false, "statusStage": "failed", "error": message})
		fail(c, apperr.E("queue_error", message, 503))
		return
	}
	ok(c, gin.H{"run": assistantRunDict(run), "userMessage": assistantMessageDict(userMessage),
		"assistantMessage": assistantMessageDict(assistantMessage)})
}

func validateAssistantRunCapacity(active []*store.AssistantRun, conversationID uuid.UUID) error {
	for _, run := range active {
		if run.ConversationID == conversationID {
			return apperr.E("assistant_conversation_busy", "该对话已有任务正在运行", 409)
		}
	}
	if len(active) >= assistantActiveRunLimit {
		return apperr.E("assistant_run_limit", "最多可同时运行 4 个对话任务", 409)
	}
	return nil
}

func (s *Server) assistantRuns(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	runs, err := store.ListActiveUserAssistantRuns(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(runs))
	for _, run := range runs {
		out = append(out, assistantRunDict(run))
	}
	ok(c, gin.H{"runs": out})
}

func (s *Server) assistantRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	run, err := store.GetUserAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if run == nil {
		fail(c, apperr.E("not_found", "任务不存在", 404))
		return
	}
	message, err := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, run.AssistantMessageID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"run": assistantRunDict(run), "assistantMessage": assistantMessageDict(message)})
}

func (s *Server) cancelAssistantRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	run, err := store.GetUserAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil || run == nil {
		if err != nil {
			fail(c, err)
		} else {
			fail(c, apperr.E("not_found", "任务不存在", 404))
		}
		return
	}
	canceled, err := store.CancelAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if canceled {
		metadata := map[string]any{}
		if message, _ := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, run.AssistantMessageID); message != nil {
			for key, value := range message.Metadata {
				metadata[key] = value
			}
		}
		metadata["pending"] = false
		metadata["routing"] = false
		metadata["statusStage"] = "stopped"
		_ = store.UpdateAssistantMessage(c.Request.Context(), s.St.Pool, run.AssistantMessageID, "已停止生成",
			assistantResolvedMode(run), "stopped", metadata)
		assistantstream.Publish(c.Request.Context(), s.assistantStreamRedis(), id.String(), assistantstream.Event{
			Kind: assistantResolvedMode(run), Stage: "stopped", Done: true, Status: "canceled",
		})
		s.Queue.CancelAssistantRun(id.String())
	}
	updated, _ := store.GetUserAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	ok(c, gin.H{"run": assistantRunDict(updated), "canceled": canceled})
}

func assistantConversationDict(item *store.AssistantConversation, messages []*store.AssistantMessage) gin.H {
	serialized := make([]gin.H, 0, len(messages))
	for _, message := range messages {
		serialized = append(serialized, assistantMessageDict(message))
	}
	return gin.H{"id": item.ID.String(), "title": item.Title, "createdAt": isoValue(item.CreatedAt),
		"updatedAt": isoValue(item.UpdatedAt), "messages": serialized}
}

func assistantMessageDict(item *store.AssistantMessage) gin.H {
	if item == nil {
		return gin.H{}
	}
	out := gin.H{}
	for key, value := range item.Metadata {
		out[key] = value
	}
	out["id"] = item.ID.String()
	out["role"] = item.Role
	out["content"] = item.Content
	out["kind"] = item.Kind
	out["status"] = item.Status
	out["pending"] = item.Status == "queued" || item.Status == "running"
	out["createdAt"] = isoValue(item.CreatedAt)
	out["updatedAt"] = isoValue(item.UpdatedAt)
	return out
}

func assistantRunDict(item *store.AssistantRun) gin.H {
	if item == nil {
		return gin.H{}
	}
	return gin.H{"id": item.ID.String(), "conversationId": item.ConversationID.String(),
		"userMessageId": item.UserMessageID.String(), "assistantMessageId": item.AssistantMessageID.String(),
		"mode": item.Mode, "resolvedMode": item.ResolvedMode, "status": item.Status, "stage": item.Stage,
		"errorCode": item.ErrorCode, "errorMessage": item.ErrorMessage, "createdAt": isoValue(item.CreatedAt),
		"startedAt": iso(item.StartedAt), "finishedAt": iso(item.FinishedAt)}
}

func assistantTitle(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if value == "" {
		return "新对话"
	}
	runes := []rune(value)
	if len(runes) > 42 {
		return string(runes[:42]) + "…"
	}
	return value
}

func truncateAssistantText(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func parseAssistantUUID(value string) uuid.UUID {
	if id, err := uuid.Parse(strings.TrimSpace(value)); err == nil {
		return id
	}
	return uuid.New()
}

func parseAssistantTime(value string) time.Time {
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC()
	}
	return time.Now().UTC()
}

func assistantMapText(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

func assistantMessageKind(values map[string]any) string {
	kind := assistantMapText(values, "kind")
	if kind == "image" || kind == "agent" || kind == "chat" {
		return kind
	}
	return "chat"
}

func assistantImportMetadata(values map[string]any) map[string]any {
	metadata := make(map[string]any, len(values))
	for key, value := range values {
		switch key {
		case "id", "role", "content", "kind", "status", "createdAt", "updatedAt":
			continue
		}
		metadata[key] = value
	}
	return metadata
}

func sanitizeAssistantReferences(items []map[string]any, userID uuid.UUID) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		key := strings.TrimSpace(assistantMapText(item, "fileKey"))
		dataURL := strings.TrimSpace(assistantMapText(item, "dataUrl"))
		allowedKey := strings.HasPrefix(key, "uploads/"+userID.String()+"/") || strings.HasPrefix(key, "tasks/"+userID.String()+"/")
		allowedURL := strings.HasPrefix(dataURL, "https://") || strings.HasPrefix(dataURL, "http://")
		if !allowedKey && !allowedURL {
			continue
		}
		copyItem := map[string]any{"id": assistantMapText(item, "id"), "name": assistantMapText(item, "name")}
		if allowedKey {
			copyItem["fileKey"] = key
			copyItem["dataUrl"] = "/api/files/" + key
		} else {
			copyItem["dataUrl"] = dataURL
		}
		out = append(out, copyItem)
	}
	return out
}

func assistantResolvedMode(run *store.AssistantRun) string {
	if run.ResolvedMode != "" {
		return run.ResolvedMode
	}
	if run.Mode == "agent" {
		return "chat"
	}
	return run.Mode
}
