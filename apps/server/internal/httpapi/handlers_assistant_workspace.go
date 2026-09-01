package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

const (
	assistantConversationLimit      = 40
	assistantMessageLimit           = 160
	assistantActiveRunLimit         = 4
	assistantConversationQueueLimit = 10
	assistantUserQueueLimit         = 20
	assistantGlobalActiveLimit      = 5000
	assistantCanvasSnapshotMaxBytes = 128 * 1024
)

type createAssistantConversationIn struct {
	Title     string `json:"title"`
	Workspace string `json:"workspace"`
	ProjectID string `json:"projectId"`
}

type patchAssistantConversationIn struct {
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
	ConversationID           string                      `json:"conversationId"`
	IdempotencyKey           string                      `json:"idempotencyKey"`
	Prompt                   string                      `json:"prompt"`
	UserMessageContent       string                      `json:"userMessageContent"`
	Mode                     string                      `json:"mode"`
	ClientUserMessageID      string                      `json:"clientUserMessageId"`
	ClientAssistantMessageID string                      `json:"clientAssistantMessageId"`
	SourceUserMessageID      string                      `json:"sourceUserMessageId"`
	ReferenceImages          []map[string]any            `json:"referenceImages"`
	ReferenceMode            string                      `json:"referenceMode"`
	ImagePlanItems           []assistantRunImagePlanItem `json:"imagePlanItems"`
	Attachments              []map[string]any            `json:"attachments"`
	Quoted                   map[string]any              `json:"quoted"`
	Skill                    string                      `json:"skill"`
	Model                    string                      `json:"model"`
	Ratio                    string                      `json:"ratio"`
	Resolution               string                      `json:"resolution"`
	Count                    int                         `json:"count"`
	RequestSize              string                      `json:"requestSize"`
	Width                    int                         `json:"width"`
	Height                   int                         `json:"height"`
	Quality                  string                      `json:"quality"`
	ReasoningEffort          string                      `json:"reasoningEffort"`
	ServiceKey               string                      `json:"serviceKey"`
	Workspace                string                      `json:"workspace"`
	FastMode                 bool                        `json:"fastMode"`
	ProposalSourceMessageID  string                      `json:"proposalSourceMessageId"`
	ParentOutputURL          string                      `json:"parentOutputUrl"`
	MaskImage                map[string]any              `json:"maskImage"`
	MaskBaseImage            map[string]any              `json:"maskBaseImage"`
	MaskRect                 string                      `json:"maskRect"`
	CanvasSnapshot           json.RawMessage             `json:"canvasSnapshot"`
	Queue                    bool                        `json:"queue"`
}

type assistantRunImagePlanItem struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	Prompt            string   `json:"prompt"`
	ReferenceImageIDs []string `json:"referenceImageIds"`
}

func applyAssistantReasoningPriceSnapshot(
	params map[string]any,
	model modelconfig.Model,
	effort string,
	scope string,
	pricingVersion int,
) int64 {
	price := modelconfig.ResolveReasoningPrice(model, effort, scope)
	params["_reasoningPriceScope"] = price.Scope
	params["_reasoningStandardPriceCents"] = price.StandardCents
	params["_reasoningPricingVersion"] = pricingVersion
	params["_chatCostCents"] = price.EffectiveCents
	return price.EffectiveCents
}

func (s *Server) assistantConversations(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	workspace, err := assistantConversationWorkspace(c.Query("workspace"))
	if err != nil {
		fail(c, err)
		return
	}
	projectID, err := parseAssistantProjectID(c.Query("projectId"))
	if err != nil {
		fail(c, err)
		return
	}
	if projectID != nil && workspace != modelconfig.WorkspaceCanvas {
		fail(c, apperr.E("validation_error", "projectId: 仅支持无限画布会话", 422))
		return
	}
	var items []*store.AssistantConversation
	if projectID != nil {
		items, err = store.ListAssistantConversationsByProject(c.Request.Context(), s.St.Pool, user.ID, workspace, *projectID, assistantConversationLimit)
	} else {
		items, err = store.ListAssistantConversationsByWorkspace(c.Request.Context(), s.St.Pool, user.ID, workspace, assistantConversationLimit)
	}
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

func (s *Server) assistantConversation(c *gin.Context) {
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
	item, err := store.GetUserAssistantConversation(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "对话不存在", 404))
		return
	}
	messages, err := store.ListAssistantMessages(c.Request.Context(), s.St.Pool, item.ID, assistantMessageLimit)
	if err != nil {
		fail(c, err)
		return
	}
	if bindID, bindErr := parseAssistantProjectID(c.Query("projectId")); bindErr != nil {
		fail(c, bindErr)
		return
	} else if bindID != nil {
		if bindErr := s.bindAssistantConversationProject(c.Request.Context(), user.ID, item, *bindID); bindErr != nil {
			fail(c, bindErr)
			return
		}
	}
	ok(c, assistantConversationDict(item, messages))
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
	workspace, err := assistantConversationWorkspace(body.Workspace)
	if err != nil {
		fail(c, err)
		return
	}
	title := assistantTitle(body.Title)
	projectID, err := parseAssistantProjectID(body.ProjectID)
	if err != nil {
		fail(c, err)
		return
	}
	if projectID != nil && workspace != modelconfig.WorkspaceCanvas {
		fail(c, apperr.E("validation_error", "projectId: 仅支持无限画布会话", 422))
		return
	}
	item, err := store.InsertAssistantConversationBound(
		c.Request.Context(), s.St.Pool, uuid.New(), user.ID, title, workspace, projectID, time.Now().UTC(),
	)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, assistantConversationDict(item, nil))
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
			_, canceled, err := assistantbilling.CancelUserTx(c.Request.Context(), tx, user.ID, run.ID)
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
	respondNoContent(c)
}

func (s *Server) patchAssistantConversation(c *gin.Context) {
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
	var body patchAssistantConversationIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetUserAssistantConversation(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "对话不存在", 404))
		return
	}
	title := assistantTitle(body.Title)
	now := time.Now().UTC()
	if err := store.TouchAssistantConversation(c.Request.Context(), s.St.Pool, user.ID, id, &title, now); err != nil {
		fail(c, err)
		return
	}
	item.Title = title
	item.UpdatedAt = now
	ok(c, assistantConversationDict(item, nil))
}

func (s *Server) createAssistantContextBoundary(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	conversationID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
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
	now := time.Now().UTC()
	var message *store.AssistantMessage
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		if err := store.LockAssistantRunsForUser(c.Request.Context(), tx, user.ID); err != nil {
			return err
		}
		active, err := store.ListActiveUserAssistantRuns(c.Request.Context(), tx, user.ID)
		if err != nil {
			return err
		}
		for _, run := range active {
			if run.ConversationID == conversationID {
				return apperr.E("assistant_conversation_busy", "请先等待或停止当前任务", 409)
			}
		}
		message, err = store.InsertAssistantMessage(c.Request.Context(), tx, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversationID, Role: "assistant",
			Content: "已从这里开始新的上下文", Kind: "context-divider", Status: "complete",
			Metadata: map[string]any{"contextDivider": true, "pending": false, "statusStage": "complete"}, CreatedAt: now,
		})
		if err != nil {
			return err
		}
		return store.TouchAssistantConversation(c.Request.Context(), tx, user.ID, conversationID, nil, now)
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, assistantMessageDict(message))
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
	if strings.EqualFold(strings.TrimSpace(c.Query("scope")), "turn") {
		err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
			if err := store.LockAssistantRunsForUser(c.Request.Context(), tx, user.ID); err != nil {
				return err
			}
			message, err := store.GetAssistantMessage(c.Request.Context(), tx, id)
			if err != nil {
				return err
			}
			if message == nil || message.Role != "user" {
				return apperr.E("not_found", "用户消息不存在", 404)
			}
			conversation, err := store.GetUserAssistantConversation(c.Request.Context(), tx, user.ID, message.ConversationID)
			if err != nil {
				return err
			}
			if conversation == nil {
				return apperr.E("not_found", "对话不存在", 404)
			}
			active, err := store.ListActiveUserAssistantRuns(c.Request.Context(), tx, user.ID)
			if err != nil {
				return err
			}
			for _, run := range active {
				if run.ConversationID == message.ConversationID {
					return apperr.E("assistant_conversation_busy", "请先停止当前任务", 409)
				}
			}
			return store.DeleteAssistantMessagesFrom(c.Request.Context(), tx, message.ConversationID, id)
		})
		if err != nil {
			fail(c, err)
			return
		}
		respondNoContent(c)
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
	respondNoContent(c)
}

func (s *Server) deleteAssistantMessageImage(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	messageID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		fail(c, apperr.E("validation_error", "消息 ID 无效", 422))
		return
	}
	imageID := strings.TrimSpace(c.Param("imageId"))
	if imageID == "" {
		fail(c, apperr.E("validation_error", "图片 ID 无效", 422))
		return
	}
	messageDeleted := false
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		message, getErr := store.GetAssistantMessage(c.Request.Context(), tx, messageID)
		if getErr != nil {
			return getErr
		}
		if message == nil {
			return apperr.E("not_found", "图片消息不存在", 404)
		}
		conversation, getErr := store.GetUserAssistantConversation(c.Request.Context(), tx, user.ID, message.ConversationID)
		if getErr != nil {
			return getErr
		}
		if conversation == nil {
			return apperr.E("not_found", "图片消息不存在", 404)
		}
		if message.Status == "running" || message.Status == "queued" {
			return apperr.E("assistant_conversation_busy", "图片仍在生成，请先停止任务", 409)
		}
		images := assistantReferenceItems(message.Metadata["images"])
		next := make([]map[string]any, 0, len(images))
		var removed map[string]any
		for _, image := range images {
			if removed == nil && (assistantMapText(image, "id") == imageID || assistantMapText(image, "fileKey") == imageID) {
				removed = image
				continue
			}
			next = append(next, image)
		}
		if removed == nil {
			return apperr.E("not_found", "图片不存在", 404)
		}
		if len(next) == 0 {
			deleted, deleteErr := store.DeleteUserAssistantMessage(c.Request.Context(), tx, user.ID, messageID)
			if deleteErr != nil {
				return deleteErr
			}
			if !deleted {
				return apperr.E("not_found", "图片消息不存在", 404)
			}
			messageDeleted = true
			return nil
		}
		metadata := make(map[string]any, len(message.Metadata))
		for key, value := range message.Metadata {
			metadata[key] = value
		}
		metadata["images"] = next
		if err := store.UpdateAssistantMessage(c.Request.Context(), tx, message.ID, message.Content, message.Kind, message.Status, metadata); err != nil {
			return err
		}
		key := assistantMapText(removed, "fileKey")
		if key != "" {
			keys := append([]string{key}, store.AssistantVariantKeys(key)...)
			if err := store.LockObjectReferenceKeys(c.Request.Context(), tx, keys); err != nil {
				return err
			}
			if err := store.EnqueueObjectCleanup(c.Request.Context(), tx, keys); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"messageDeleted": messageDeleted})
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
	for _, incoming := range body.Conversations {
		if len(incoming.Messages) > assistantMessageLimit {
			fail(c, apperr.E("validation_error", fmt.Sprintf("单个对话最多导入 %d 条消息", assistantMessageLimit), 422))
			return
		}
	}
	existing, err := store.ListAssistantConversations(c.Request.Context(), s.St.Pool, user.ID, 1)
	if err != nil {
		fail(c, err)
		return
	}
	if len(existing) > 0 || len(body.Conversations) == 0 {
		respondCreated(c, gin.H{"imported": 0})
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
				importedMessage, insertErr := store.InsertAssistantMessage(c.Request.Context(), tx, store.AssistantMessage{
					ID: parseAssistantUUID(assistantMapText(raw, "id")), ConversationID: conversation.ID,
					Role: role, Content: content, Kind: assistantMessageKind(raw), Status: status,
					Metadata: metadata, CreatedAt: parseAssistantTime(assistantMapText(raw, "createdAt")),
				})
				if insertErr != nil {
					return insertErr
				}
				if err := store.AddUserUploadReferences(c.Request.Context(), tx, user.ID,
					store.UploadReferenceAssistantMsg, importedMessage.ID,
					assistantUploadReferenceKeysFromMetadata(metadata, user.ID)); err != nil {
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
	respondCreated(c, gin.H{"imported": imported})
}

func (s *Server) createAssistantRun(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	if !s.enforceUsageLimit(c, "assistant-run-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
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
	body.UserMessageContent = strings.TrimSpace(body.UserMessageContent)
	if body.UserMessageContent == "" {
		body.UserMessageContent = body.Prompt
	}
	if len([]rune(body.UserMessageContent)) > maxAssistantMessageRunes {
		fail(c, apperr.E("validation_error", "展示消息不能超过 12000 个字符", 422))
		return
	}
	if body.Mode != "agent" && body.Mode != "chat" && body.Mode != "image" {
		fail(c, apperr.E("validation_error", "无效的创作模式", 422))
		return
	}
	body.Attachments, err = normalizeAssistantFileAttachments(body.Attachments)
	if err != nil {
		fail(c, err)
		return
	}
	if len(body.Attachments) > 0 && body.Mode != "chat" {
		fail(c, apperr.E("validation_error", "文档附件仅支持对话分析模式", 422))
		return
	}
	body.Skill = strings.TrimSpace(body.Skill)
	if len(body.Attachments) > 0 {
		if body.Skill == "" {
			body.Skill = "document_analysis"
		}
		if body.Skill != "document_analysis" {
			fail(c, apperr.E("validation_error", "文档附件需要使用文档分析技能", 422))
			return
		}
	}
	body.IdempotencyKey, err = normalizeAssistantIdempotencyKey(body.IdempotencyKey, body.ClientAssistantMessageID)
	if err != nil {
		fail(c, err)
		return
	}
	body.ReferenceMode, err = normalizeAssistantReferenceMode(body.ReferenceMode)
	if err != nil {
		fail(c, err)
		return
	}
	requestFingerprint, err := assistantRunRequestFingerprint(body)
	if err != nil {
		fail(c, err)
		return
	}
	body.ServiceKey = strings.TrimSpace(body.ServiceKey)
	if body.ServiceKey != "" && body.ServiceKey != "assistant_image" &&
		body.ServiceKey != "ui_design_analysis" && body.ServiceKey != "ui_design_asset" {
		fail(c, apperr.E("validation_error", "serviceKey: 不支持的服务路由", 422))
		return
	}
	if body.ServiceKey == "" {
		body.ServiceKey = "assistant_image"
	}
	workspace := modelconfig.WorkspaceAssistant
	if body.ServiceKey == "ui_design_analysis" || body.ServiceKey == "ui_design_asset" {
		workspace = modelconfig.WorkspaceUIDesign
	}
	if strings.TrimSpace(body.Workspace) != "" {
		requestedWorkspace, workspaceErr := assistantConversationWorkspace(body.Workspace)
		if workspaceErr != nil {
			fail(c, workspaceErr)
			return
		}
		if workspace == modelconfig.WorkspaceUIDesign && requestedWorkspace != workspace {
			fail(c, apperr.E("validation_error", "workspace: 与服务路由不一致", 422))
			return
		}
		workspace = requestedWorkspace
	}
	canvasAgent := workspace == modelconfig.WorkspaceCanvas && body.Mode == "agent"
	body.ReasoningEffort, err = normalizeAssistantReasoningEffort(body.ReasoningEffort, false)
	if err != nil {
		fail(c, err)
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
	if conversation.Workspace != workspace {
		fail(c, apperr.E("validation_error", "workspace: 与对话工作区不一致", 422))
		return
	}
	if body.IdempotencyKey != "" {
		existing, getErr := store.GetUserAssistantRunByIdempotencyKey(
			c.Request.Context(), s.St.Pool, user.ID, body.IdempotencyKey,
		)
		if getErr != nil {
			fail(c, getErr)
			return
		}
		if existing != nil {
			if existing.RequestFingerprint == nil || *existing.RequestFingerprint != requestFingerprint {
				fail(c, apperr.E("assistant_idempotency_conflict", "相同幂等键已用于不同的助手请求", 409))
				return
			}
			userMessage, messageErr := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, existing.UserMessageID)
			if messageErr != nil {
				fail(c, messageErr)
				return
			}
			assistantMessage, messageErr := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, existing.AssistantMessageID)
			if messageErr != nil {
				fail(c, messageErr)
				return
			}
			if userMessage == nil || assistantMessage == nil {
				fail(c, apperr.E("assistant_run_corrupt", "助手任务关联消息不存在", 500))
				return
			}
			s.enqueueAssistantRunFromOutbox(c.Request.Context(), existing)
			ok(c, gin.H{"run": assistantRunDict(existing), "userMessage": assistantMessageDict(userMessage),
				"assistantMessage": assistantMessageDict(assistantMessage)})
			return
		}
	}
	body.Attachments, err = hydrateAssistantFileAttachments(c.Request.Context(), s.St.Pool, user.ID, body.Attachments)
	if err != nil {
		fail(c, err)
		return
	}
	modelCfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	editableKind := ""
	if workspace == modelconfig.WorkspaceAssistant && body.Mode != "image" {
		editableKind = assistanttools.EditableFileKindRequested(body.Prompt)
	}
	if editableKind != "" {
		if !modelCfg.EditableFiles.Enabled {
			fail(c, apperr.E("assistant_editable_files_disabled", "PPT/PSD 可编辑文件功能暂未开放", 422))
			return
		}
		if _, configured := modelconfig.EditableFileProvider(modelCfg); !configured {
			fail(c, apperr.E("assistant_editable_files_unavailable", "PPT/PSD 服务商配置不可用，请联系管理员", 503))
			return
		}
		if editableKind == "psd" && len(body.ReferenceImages) == 0 {
			fail(c, apperr.E("assistant_psd_reference_required", "制作分层 PSD 前，请先上传一张 JPG、PNG 或 WebP 参考图", 422))
			return
		}
	}
	body.Model = strings.TrimSpace(body.Model)
	requestedKind := modelconfig.ModelKindChat
	if body.Mode == "image" {
		requestedKind = modelconfig.ModelKindImage
	}
	allowModelFallback := body.Mode == "agent" || strings.TrimSpace(body.SourceUserMessageID) != "" ||
		strings.TrimSpace(body.ProposalSourceMessageID) != ""
	selectedModel, modelConfigured := selectAssistantServiceModel(
		modelCfg, workspace, requestedKind, body.Model, allowModelFallback,
	)
	if modelConfigured {
		body.Model = selectedModel.Model.ID
	} else if len(modelCfg.Models) > 0 {
		fail(c, apperr.E("validation_error", "所选模型不可用，请刷新模型列表后重试", 422))
		return
	} else {
		assistantClient, clientErr := s.assistantClient(c)
		if clientErr != nil {
			fail(c, clientErr)
			return
		}
		if body.Model == "" || (body.Mode != "image" && body.Model == assistantClient.ImageModel()) {
			body.Model = assistantClient.ChatModel()
		}
	}
	if len([]rune(body.Model)) > 120 {
		fail(c, apperr.E("validation_error", "模型名称不能超过 120 个字符", 422))
		return
	}
	if body.Count == 0 {
		if body.Mode == "image" {
			body.Count = 2
		} else {
			body.Count = 1
		}
	}
	if len(body.ImagePlanItems) > 0 {
		if body.Mode != "image" || len(body.ImagePlanItems) < 2 {
			fail(c, apperr.E("validation_error", "独立多图方案至少需要 2 张图片且仅支持生图模式", 422))
			return
		}
		body.Count = len(body.ImagePlanItems)
	}
	maxImages := modelconfig.DefaultMaxImages
	if body.Mode == "image" && modelConfigured {
		maxImages = selectedModel.Model.GenerationMaxImages()
	}
	if body.Mode == "image" && (body.Count < 1 || body.Count > maxImages) {
		fail(c, apperr.E("validation_error", fmt.Sprintf("图片数量须在 1-%d 之间", maxImages), 422))
		return
	}
	serviceProvider := ""
	requestedAutoRatio := false
	var imageSelection *modelconfig.Selection
	var chatSelection *modelconfig.Selection
	if modelConfigured {
		if selectedModel.Model.Kind == modelconfig.ModelKindImage {
			imageSelection = selectedModel
		} else {
			chatSelection = selectedModel
		}
	}
	if body.Mode != "image" {
		upstreamModel := body.Model
		if chatSelection != nil {
			upstreamModel = chatSelection.Model.UpstreamModel
		}
		body.ReasoningEffort, err = normalizeAssistantReasoningEffortForSupported(body.ReasoningEffort, reasoningEffortsForRun(chatSelection, upstreamModel), false)
		if err != nil {
			fail(c, err)
			return
		}
		if body.ReasoningEffort == "" && chatSelection != nil && chatSelection.Model.ReasoningPricing != nil {
			body.ReasoningEffort = chatSelection.Model.ReasoningPricing.DefaultEffort
		}
	}
	if body.Mode == "agent" && !canvasAgent {
		imageSelection, _ = modelconfig.SelectPublicForWorkspace(
			modelCfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindImage, "",
		)
		if len(modelCfg.Models) > 0 && imageSelection == nil {
			fail(c, apperr.E("validation_error", "AI 助手还没有可用的图片模型", 422))
			return
		}
	}
	if body.Mode == "agent" {
		maxAgentImages := maxImages
		if canvasAgent {
			maxAgentImages = modelconfig.MaxImagesLimit
		}
		if imageSelection != nil {
			maxAgentImages = imageSelection.Model.GenerationMaxImages()
		}
		if body.Count < 1 || body.Count > maxAgentImages {
			fail(c, apperr.E("validation_error", fmt.Sprintf("图片数量须在 1-%d 之间", maxAgentImages), 422))
			return
		}
	}
	if imageSelection != nil {
		requestedAutoRatio, err = normalizeAssistantConfiguredImageParameters(&body, imageSelection.Model)
		if err != nil {
			fail(c, err)
			return
		}
	} else {
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
	}
	if imageSelection != nil {
		if len(body.ReferenceImages) > imageSelection.Model.MaxReferenceImages {
			fail(c, apperr.E("validation_error", fmt.Sprintf("所选模型最多允许 %d 张参考图", imageSelection.Model.MaxReferenceImages), 422))
			return
		}
	} else if len(body.ReferenceImages) > maxAssistantReferences {
		fail(c, apperr.E("validation_error", "最多允许 4 张参考图", 422))
		return
	}
	if imageSelection != nil {
		serviceProvider = imageSelection.Provider.Adapter
	} else if len(modelCfg.Models) == 0 {
		serviceProvider, err = settings.ImageServiceProvider(c.Request.Context(), s.St.Pool, body.ServiceKey)
		if err != nil {
			fail(c, err)
			return
		}
	}
	runID := uuid.New()
	userMessageID := parseAssistantUUID(body.ClientUserMessageID)
	assistantMessageID := parseAssistantUUID(body.ClientAssistantMessageID)
	now := time.Now().UTC()
	references, err := sanitizeAssistantReferences(body.ReferenceImages, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	imagePlanItems, err := sanitizeAssistantImagePlanItems(body.ImagePlanItems, references, body.Count)
	if err != nil {
		fail(c, err)
		return
	}
	if body.Mode == "image" {
		if body.ReferenceMode == "" {
			body.ReferenceMode = "shared"
		}
		if body.ReferenceMode == "individual" && (len(references) == 0 || len(references) != body.Count) {
			fail(c, apperr.E("validation_error", fmt.Sprintf("逐张编辑要求参考图数量与输出数量一致：参考图 %d 张，输出 %d 张", len(references), body.Count), 422))
			return
		}
	} else {
		body.ReferenceMode = ""
	}
	maskReferences := []map[string]any{}
	if len(body.MaskImage) > 0 || len(body.MaskBaseImage) > 0 || strings.TrimSpace(body.MaskRect) != "" {
		if body.Mode != "image" || len(body.MaskImage) == 0 || len(body.MaskBaseImage) == 0 {
			fail(c, apperr.E("validation_error", "局部编辑参数不完整", 422))
			return
		}
		if _, parseErr := media.ParseMaskRect(body.MaskRect); parseErr != nil {
			fail(c, apperr.E("validation_error", "maskRect: 格式无效", 422))
			return
		}
		maskReferences, err = sanitizeAssistantReferences([]map[string]any{body.MaskImage, body.MaskBaseImage}, user.ID)
		if err != nil || len(maskReferences) != 2 || assistantMapText(maskReferences[0], "fileKey") == "" || assistantMapText(maskReferences[1], "fileKey") == "" {
			fail(c, apperr.E("validation_error", "局部编辑蒙版或底图无效", 422))
			return
		}
	}
	assistantUploadKeys := assistantUploadReferenceKeys(references, user.ID)
	taskOutputReferenceKeys := assistantTaskOutputReferenceKeys(references, user.ID)
	assistantOutputKeys := assistantOutputReferenceKeys(references, user.ID)
	if len(maskReferences) == 2 {
		assistantUploadKeys = append(assistantUploadKeys, assistantUploadReferenceKeys(maskReferences, user.ID)...)
		taskOutputReferenceKeys = append(taskOutputReferenceKeys, assistantTaskOutputReferenceKeys(maskReferences, user.ID)...)
		assistantOutputKeys = append(assistantOutputKeys, assistantOutputReferenceKeys(maskReferences, user.ID)...)
	}
	userMetadata := map[string]any{"referenceImages": references, "attachments": body.Attachments, "quoted": body.Quoted, "skill": body.Skill}
	if body.ReferenceMode != "" {
		userMetadata["referenceMode"] = body.ReferenceMode
	}
	if sourceID := strings.TrimSpace(body.ProposalSourceMessageID); sourceID != "" {
		if _, parseErr := uuid.Parse(sourceID); parseErr != nil {
			fail(c, apperr.E("validation_error", "proposalSourceMessageId 无效", 422))
			return
		}
		userMetadata["proposalSourceMessageId"] = sourceID
	}
	params := map[string]any{
		"referenceImages": references, "prompt": body.Prompt, "model": body.Model, "count": body.Count,
		"serviceKey": body.ServiceKey, "fastMode": body.FastMode, "_serviceProvider": serviceProvider,
		"requestedMode": body.Mode,
		"workspace":     workspace,
	}
	if len(imagePlanItems) > 0 {
		params["imagePlanItems"] = imagePlanItems
	}
	if body.ReferenceMode != "" {
		params["referenceMode"] = body.ReferenceMode
	}
	if body.Ratio != "" {
		params["ratio"] = body.Ratio
	}
	if body.Resolution != "" {
		params["resolution"] = body.Resolution
	}
	if body.RequestSize != "" {
		params["requestSize"] = body.RequestSize
	}
	if body.Width > 0 {
		params["width"] = body.Width
	}
	if body.Height > 0 {
		params["height"] = body.Height
	}
	if body.Quality != "" {
		params["quality"] = body.Quality
	}
	if len(maskReferences) == 2 {
		params["_maskKey"] = assistantMapText(maskReferences[0], "fileKey")
		params["_maskBaseKey"] = assistantMapText(maskReferences[1], "fileKey")
		params["_maskRect"] = strings.TrimSpace(body.MaskRect)
		params["maskEdit"] = true
	}
	if len(body.Attachments) > 0 {
		fileIDs := make([]string, 0, len(body.Attachments))
		for _, attachment := range body.Attachments {
			fileIDs = append(fileIDs, assistantMapText(attachment, "id"))
		}
		params["_assistantFileIds"] = fileIDs
		params["attachments"] = body.Attachments
		params["skill"] = body.Skill
	}
	if body.ReasoningEffort != "" {
		params["reasoningEffort"] = body.ReasoningEffort
	}
	if parent := strings.TrimSpace(body.ParentOutputURL); parent != "" {
		params["parentOutputUrl"] = parent
	}
	params["_source"] = workspace
	if workspace == modelconfig.WorkspaceCanvas {
		params["_source"] = store.CanvasTaskSource
		params["_kind"] = "canvas-chat"
		if canvasAgent {
			params["_kind"] = "canvas-agent"
		}
	}
	if snapshot, snapshotErr := sanitizeAssistantCanvasSnapshot(body.CanvasSnapshot); snapshotErr != nil {
		fail(c, snapshotErr)
		return
	} else if snapshot != nil {
		if !canvasAgent {
			fail(c, apperr.E("validation_error", "canvasSnapshot 仅支持无限画布 Agent", 422))
			return
		}
		params["canvasSnapshot"] = snapshot
		if projectID := assistantCanvasSnapshotProjectID(snapshot); projectID != nil {
			if bindErr := s.bindAssistantConversationProject(c.Request.Context(), user.ID, conversation, *projectID); bindErr != nil {
				fail(c, bindErr)
				return
			}
		}
	}
	if body.Mode == "agent" && !canvasAgent {
		selections := modelconfig.PublicModelsForWorkspace(modelCfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindImage)
		catalog := make([]map[string]any, 0, len(selections))
		for _, selection := range selections {
			catalog = append(catalog, map[string]any{
				"id": selection.Model.ID, "name": selection.Model.Name,
				"description":        selection.Model.Description,
				"resolutions":        selection.Model.Resolutions,
				"aspectRatios":       selection.Model.AspectRatios,
				"qualities":          selection.Model.Qualities,
				"maxReferenceImages": selection.Model.MaxReferenceImages,
				"maxImages":          selection.Model.GenerationMaxImages(),
				"fastMode":           selection.Model.FastMode,
			})
		}
		params["_imageModelCatalog"] = catalog
	}
	if requestedAutoRatio {
		params["requestedAspectRatio"] = "auto"
		params["autoAspectRatioCandidates"] = modelconfig.AutoAspectRatioCandidates(
			imageSelection.Model, body.Resolution,
		)
	}
	if imageSelection != nil {
		imageWorkspacePrice := modelconfig.ResolveWorkspacePrice(modelCfg, workspace, imageSelection.Model)
		params["_imageModelConfigId"] = imageSelection.Model.ID
		params["_imageProviderConfigId"] = imageSelection.Provider.ID
		params["_imageProviderDisplayName"] = imageSelection.Provider.Name
		params["_imageModel"] = imageSelection.Model.UpstreamModel
		params["_imageModelDisplayName"] = imageSelection.Model.Name
		params["_modelDisplayName"] = imageSelection.Model.Name
		params["_modelFastMode"] = imageSelection.Model.FastMode
		params["_modelResolutions"] = imageSelection.Model.Resolutions
		params["_modelAspectRatios"] = imageSelection.Model.AspectRatios
		params["_modelAspectRatiosByResolution"] = imageSelection.Model.AspectRatiosByResolution
		params["_modelQualities"] = imageSelection.Model.Qualities
		params["_modelTransparentBackground"] = imageSelection.Model.TransparentBackground
		params["_modelOutputFormats"] = imageSelection.Model.OutputFormats
		params["_modelModerationLevels"] = imageSelection.Model.ModerationLevels
		params["_modelMaxReferenceImages"] = imageSelection.Model.MaxReferenceImages
		params["_unitPriceCents"] = imageWorkspacePrice.EffectiveCents
		params["_billingUnitPriceCents"] = imageWorkspacePrice.EffectiveCents
		params["_modelEffectivePriceCents"] = modelconfig.EffectivePrice(imageSelection.Model)
		params["_imageUpstreamUnitCostCents"] = imageSelection.Model.UpstreamCostCents
		params["_pricingWorkspace"] = workspace
	}
	if chatSelection != nil {
		params["_chatModelConfigId"] = chatSelection.Model.ID
		params["_chatProviderConfigId"] = chatSelection.Provider.ID
		params["_chatProviderDisplayName"] = chatSelection.Provider.Name
		params["_chatModel"] = chatSelection.Model.UpstreamModel
		params["_chatModelDisplayName"] = chatSelection.Model.Name
		params["_chatContextWindowTokens"] = chatSelection.Model.ContextWindowTokens
		params["_chatMaxOutputTokens"] = chatSelection.Model.MaxOutputTokens
		params["_modelDisplayName"] = chatSelection.Model.Name
		params["_chatModelEffectivePriceCents"] = modelconfig.EffectivePrice(chatSelection.Model)
		params["_chatUpstreamUnitCostCents"] = chatSelection.Model.UpstreamCostCents
	}
	chatCostCents := int64(0)
	if chatSelection != nil {
		priceScope := modelconfig.ReasoningPriceScopeAssistant
		if canvasAgent {
			priceScope = modelconfig.ReasoningPriceScopeCanvasAgent
		}
		workspacePrice := modelconfig.ResolveWorkspacePrice(modelCfg, workspace, chatSelection.Model)
		if workspacePrice.Overridden {
			params["_reasoningPriceScope"] = priceScope
			params["_reasoningStandardPriceCents"] = workspacePrice.PriceCents
			params["_reasoningPricingVersion"] = modelCfg.Version
			params["_workspacePriceOverridden"] = true
			chatCostCents = workspacePrice.EffectiveCents
		} else {
			chatCostCents = applyAssistantReasoningPriceSnapshot(params, chatSelection.Model, body.ReasoningEffort, priceScope, modelCfg.Version)
		}
	}
	imageCostCents := int64(0)
	if imageSelection != nil {
		imageCostCents = modelconfig.EffectiveWorkspacePrice(modelCfg, workspace, imageSelection.Model) * int64(body.Count)
		unitPrice := imageCostCents / int64(max(body.Count, 1))
		if unitPrice == 0 && !imageSelection.Model.AllowZeroPrice {
			fail(c, apperr.E("model_zero_price_blocked", "图片模型价格尚未配置，已阻止零积分调用", 503))
			return
		}
		if unitPrice < imageSelection.Model.UpstreamCostCents && !imageSelection.Model.AllowLossLeader {
			fail(c, apperr.E("model_price_inverted", "图片模型价格低于上游成本，已暂停调用，请联系管理员", 503))
			return
		}
	}
	if chatSelection != nil {
		if chatCostCents == 0 && !chatSelection.Model.AllowZeroPrice {
			fail(c, apperr.E("model_zero_price_blocked", "对话模型价格尚未配置，已阻止零积分调用", 503))
			return
		}
		if chatCostCents < chatSelection.Model.UpstreamCostCents && !chatSelection.Model.AllowLossLeader {
			fail(c, apperr.E("model_price_inverted", "对话模型价格低于上游成本，已暂停调用，请联系管理员", 503))
			return
		}
	}
	reservedCents := assistantRunReservedCost(body.Mode, chatCostCents, imageCostCents)
	params["_chatCostCents"] = chatCostCents
	params["_imageCostCents"] = imageCostCents
	params["_reservedCostCents"] = reservedCents
	var userMessage, assistantMessage *store.AssistantMessage
	var run *store.AssistantRun
	replayed := false
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		if err := store.LockAssistantRunsForUser(c.Request.Context(), tx, user.ID); err != nil {
			return err
		}
		if body.IdempotencyKey != "" {
			existing, err := store.GetUserAssistantRunByIdempotencyKey(
				c.Request.Context(), tx, user.ID, body.IdempotencyKey,
			)
			if err != nil {
				return err
			}
			if existing != nil {
				if existing.RequestFingerprint == nil || *existing.RequestFingerprint != requestFingerprint {
					return apperr.E("assistant_idempotency_conflict", "相同幂等键已用于不同的助手请求", 409)
				}
				userMessage, err = store.GetAssistantMessage(c.Request.Context(), tx, existing.UserMessageID)
				if err != nil {
					return err
				}
				if userMessage == nil {
					return apperr.E("assistant_run_corrupt", "助手任务的用户消息不存在", 500)
				}
				assistantMessage, err = store.GetAssistantMessage(c.Request.Context(), tx, existing.AssistantMessageID)
				if err != nil {
					return err
				}
				if assistantMessage == nil {
					return apperr.E("assistant_run_corrupt", "助手任务的回复消息不存在", 500)
				}
				run = existing
				replayed = true
				return nil
			}
		}
		objectReferenceKeys := append(append([]string(nil), taskOutputReferenceKeys...), assistantOutputKeys...)
		if len(objectReferenceKeys) > 0 {
			if err := store.LockObjectReferenceKeys(c.Request.Context(), tx, objectReferenceKeys); err != nil {
				return err
			}
		}
		if len(taskOutputReferenceKeys) > 0 {
			referenced, err := store.LockTasksReferencingOutputKeys(c.Request.Context(), tx, user.ID, taskOutputReferenceKeys)
			if err != nil {
				return err
			}
			for _, key := range taskOutputReferenceKeys {
				if _, ok := referenced[key]; !ok {
					return apperr.E("validation_error", "referenceImages: 任务产物不存在或已删除", 422)
				}
			}
		}
		if len(assistantOutputKeys) > 0 {
			referenced, err := store.LockAssistantOutputKeys(c.Request.Context(), tx, user.ID, assistantOutputKeys)
			if err != nil {
				return err
			}
			for _, key := range assistantOutputKeys {
				if _, ok := referenced[key]; !ok {
					return apperr.E("validation_error", "referenceImages: 助手图片不存在或已删除", 422)
				}
			}
		}
		active, err := store.ListActiveUserAssistantRuns(c.Request.Context(), tx, user.ID)
		if err != nil {
			return err
		}
		if err := validateAssistantRunCapacity(active, conversationID, body.Queue); err != nil {
			return err
		}
		globalActive, err := store.CountActiveAssistantRunsGlobal(c.Request.Context(), tx)
		if err != nil {
			return err
		}
		if globalActive >= assistantGlobalActiveLimit {
			return apperr.E("assistant_system_capacity", "当前助手任务较多，请稍后再试；你的输入不会丢失", 429)
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
				ID: userMessageID, ConversationID: conversationID, Role: "user", Content: body.UserMessageContent,
				Kind: "chat", Status: map[bool]string{true: "queued", false: "complete"}[body.Queue], Metadata: userMetadata, CreatedAt: now,
			})
			if insertErr != nil {
				return insertErr
			}
		}
		if body.SourceUserMessageID != "" {
			if err := store.ReplaceUserUploadReferences(c.Request.Context(), tx, user.ID,
				store.UploadReferenceAssistantMsg, userMessageID, assistantUploadKeys); err != nil {
				return err
			}
		} else if err := store.AddUserUploadReferences(c.Request.Context(), tx, user.ID,
			store.UploadReferenceAssistantMsg, userMessageID, assistantUploadKeys); err != nil {
			return err
		}
		assistantMetadata := make(map[string]any, len(params)+5)
		for key, value := range params {
			if key == "referenceImages" || key == "canvasSnapshot" {
				continue
			}
			assistantMetadata[key] = value
		}
		executionMode := assistantToolExecutionMode(workspace, body.Mode, body.Prompt)
		assistantAgentTrace := executionMode == "agent"
		assistantMetadata["runId"] = runID.String()
		assistantMetadata["pending"] = true
		assistantMetadata["routing"] = assistantAgentTrace
		assistantMetadata["statusStage"] = map[bool]string{true: "routing", false: "thinking"}[assistantAgentTrace]
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
		newRun := store.AssistantRun{
			ID: runID, UserID: user.ID, ConversationID: conversationID, UserMessageID: userMessageID,
			AssistantMessageID: assistantMessageID, Mode: executionMode, Prompt: body.Prompt, Params: params,
			ReservedCents: reservedCents,
		}
		if body.IdempotencyKey != "" {
			newRun.IdempotencyKey = &body.IdempotencyKey
			newRun.RequestFingerprint = &requestFingerprint
		}
		run, insertErr = store.InsertAssistantRun(c.Request.Context(), tx, newRun)
		if insertErr != nil {
			return insertErr
		}
		if assistantAgentTrace {
			var projectID *uuid.UUID
			var snapshotJSON json.RawMessage
			if canvasAgent {
				if snapshot := params["canvasSnapshot"]; snapshot != nil {
					snapshotJSON, _ = json.Marshal(snapshot)
					projectID = assistantCanvasSnapshotProjectID(snapshot)
				}
			} else {
				snapshotJSON, _ = json.Marshal(map[string]any{
					"goal":            truncateRunes(body.Prompt, 2000),
					"requestedMode":   body.Mode,
					"requestedCount":  body.Count,
					"referenceCount":  len(references),
					"attachmentCount": len(body.Attachments),
				})
			}
			visualReferences := make([]map[string]any, 0, len(references))
			for _, reference := range references {
				visualReferences = append(visualReferences, map[string]any{
					"id": assistantMapText(reference, "id"), "name": assistantMapText(reference, "name"),
					"fileKey": assistantMapText(reference, "fileKey"),
				})
			}
			visualSummary, _ := json.Marshal(map[string]any{"referenceImages": visualReferences})
			if canvasAgent {
				if err := store.InsertAgentExecutionTrace(c.Request.Context(), tx, run.ID, user.ID, projectID, body.Model, body.ReasoningEffort, snapshotJSON, visualSummary); err != nil {
					return err
				}
			} else if err := store.InsertAssistantAgentExecutionTrace(c.Request.Context(), tx, run.ID, user.ID, body.Model, body.ReasoningEffort, snapshotJSON, visualSummary); err != nil {
				return err
			}
		}
		if err := store.InsertAssistantRunOutbox(c.Request.Context(), tx, run.ID); err != nil {
			return err
		}
		if _, _, err := store.SyncUIDesignAssetHistoryFromRun(c.Request.Context(), tx, run, nil); err != nil {
			return err
		}
		if err := store.AddUserUploadReferences(c.Request.Context(), tx, user.ID,
			store.UploadReferenceAssistantRun, run.ID, assistantUploadKeys); err != nil {
			return err
		}
		if err := assistantbilling.Reserve(c.Request.Context(), tx, run); err != nil {
			return err
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
	enqueued := s.enqueueAssistantRunFromOutbox(c.Request.Context(), run)
	if enqueued {
		if history, histErr := store.GetTaskByIdemKey(c.Request.Context(), s.St.Pool, user.ID, store.UIDesignAssetHistoryIdempotencyKey(run.ID)); histErr == nil && history != nil {
			event := taskstream.Event{Stage: history.Status, Status: history.Status}
			taskstream.Publish(c.Request.Context(), s.assistantStreamRedis(), history.ID.String(), event)
			taskstream.PublishUser(c.Request.Context(), s.assistantStreamRedis(), user.ID.String(), event)
		}
	}
	payload := gin.H{"run": assistantRunDict(run), "userMessage": assistantMessageDict(userMessage),
		"assistantMessage": assistantMessageDict(assistantMessage)}
	if replayed {
		ok(c, payload)
		return
	}
	respondCreated(c, payload)
}

func assistantToolExecutionMode(workspace, mode, prompt string) string {
	if workspace == modelconfig.WorkspaceAssistant && mode == "chat" &&
		(assistanttools.WebSearchRequested(prompt) || assistanttools.TaskStatusRequested(prompt)) {
		return "agent"
	}
	return mode
}

func assistantRunReservedCost(mode string, chatCostCents, imageCostCents int64) int64 {
	if mode == "image" {
		return imageCostCents
	}
	return chatCostCents
}

func (s *Server) enqueueAssistantRunFromOutbox(ctx context.Context, run *store.AssistantRun) bool {
	if run == nil || run.Status != "queued" {
		return false
	}
	ready, err := store.AssistantRunDispatchable(ctx, s.St.Pool, run.ID, assistantActiveRunLimit)
	if err != nil || !ready {
		return false
	}
	if err := s.Queue.EnqueueAssistantRun(ctx, run.ID.String()); err != nil {
		log.Printf("assistant run %s enqueue deferred to outbox: %v", run.ID, err)
		if recordErr := store.RecordAssistantRunOutboxFailure(ctx, s.St.Pool, run.ID,
			err.Error(), time.Now().UTC().Add(5*time.Second)); recordErr != nil {
			log.Printf("assistant run %s outbox failure record failed: %v", run.ID, recordErr)
		}
		return false
	}
	if err := store.DeleteAssistantRunOutbox(ctx, s.St.Pool, run.ID); err != nil {
		log.Printf("assistant run %s outbox cleanup failed: %v", run.ID, err)
	}
	return true
}

func (s *Server) dispatchReadyAssistantRuns(ctx context.Context) {
	ids, err := store.ListReadyAssistantRunOutboxIDs(ctx, s.St.Pool, time.Now().UTC(), 32)
	if err != nil {
		log.Printf("assistant queue dispatch lookup failed: %v", err)
		return
	}
	for _, id := range ids {
		run, getErr := store.GetAssistantRun(ctx, s.St.Pool, id)
		if getErr != nil || run == nil {
			continue
		}
		s.enqueueAssistantRunFromOutbox(ctx, run)
	}
}

func validateAssistantRunCapacity(active []*store.AssistantRun, conversationID uuid.UUID, allowQueue bool) error {
	running := 0
	queued := 0
	conversationActive := 0
	for _, run := range active {
		if run.Status == "running" {
			running++
		} else if run.Status == "queued" {
			queued++
		}
		if run.ConversationID == conversationID {
			conversationActive++
		}
	}
	if !allowQueue && conversationActive > 0 {
		return apperr.E("assistant_conversation_busy", "该对话已有任务正在运行", 409)
	}
	if !allowQueue && running >= assistantActiveRunLimit {
		return apperr.E("assistant_run_limit", "最多可同时运行 4 个对话任务", 409)
	}
	if allowQueue && conversationActive >= assistantConversationQueueLimit {
		return apperr.E("assistant_conversation_queue_full", "当前对话最多排队 10 个任务", 409)
	}
	if allowQueue && queued >= assistantUserQueueLimit {
		return apperr.E("assistant_queue_full", "当前最多排队 20 个助手任务", 409)
	}
	return nil
}

func selectAssistantRunModel(cfg modelconfig.Config, workspace, kind, requestedModelID string, allowFallback bool) (*modelconfig.Selection, bool) {
	selection, configured := modelconfig.SelectPublicForWorkspace(cfg, workspace, kind, requestedModelID)
	if configured || !allowFallback || strings.TrimSpace(requestedModelID) == "" {
		return selection, configured
	}
	return modelconfig.SelectPublicForWorkspace(cfg, workspace, kind, "")
}

func selectAssistantServiceModel(cfg modelconfig.Config, workspace, kind, requestedModelID string, allowFallback bool) (*modelconfig.Selection, bool) {
	selection, configured := selectAssistantRunModel(cfg, workspace, kind, requestedModelID, allowFallback)
	if configured || workspace != modelconfig.WorkspaceUIDesign || kind != modelconfig.ModelKindChat {
		return selection, configured
	}
	// Runtime config exposes the assistant chat assignment when UI design has
	// no saved analysis model, so accept the same fallback here.
	return selectAssistantRunModel(cfg, modelconfig.WorkspaceAssistant, kind, requestedModelID, allowFallback)
}

func (s *Server) assistantRuns(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	workspace, err := assistantConversationWorkspace(c.Query("workspace"))
	if err != nil {
		fail(c, err)
		return
	}
	runs, err := store.ListActiveUserAssistantRunsByWorkspace(
		c.Request.Context(), s.St.Pool, user.ID, workspace,
	)
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(runs))
	queueIndexes := make(map[uuid.UUID]int)
	for _, run := range runs {
		item := assistantRunDict(run)
		if run.Status == "queued" {
			queueIndexes[run.ConversationID]++
			item["queueIndex"] = queueIndexes[run.ConversationID]
		}
		out = append(out, item)
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

func (s *Server) cancelAssistantRun(c *gin.Context, user *store.User, id uuid.UUID, body assistantRunPatchIn) {
	run, err := store.GetUserAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil || run == nil {
		if err != nil {
			fail(c, err)
		} else {
			fail(c, apperr.E("not_found", "任务不存在", 404))
		}
		return
	}
	if body.Status != "canceled" {
		fail(c, apperr.E("validation_error", "status: 仅支持更新为 canceled", 422))
		return
	}
	var canceled bool
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		var txErr error
		run, canceled, txErr = assistantbilling.CancelUserTxConfirmed(c.Request.Context(), tx, user.ID, id, body.AcknowledgeUpstream)
		if txErr != nil || !canceled {
			return txErr
		}
		message, messageErr := store.GetAssistantMessage(c.Request.Context(), tx, run.AssistantMessageID)
		if messageErr != nil {
			return messageErr
		}
		if message == nil {
			return nil
		}
		if _, updateErr := tx.Exec(c.Request.Context(), `UPDATE assistant_messages
			SET status = 'stopped', updated_at = now()
			WHERE id = $1 AND status = 'queued'`, run.UserMessageID); updateErr != nil {
			return updateErr
		}
		metadata := assistantMessageMetadataWithoutOutputs(message)
		delete(metadata, "pendingTool")
		metadata["pending"] = false
		metadata["routing"] = false
		metadata["statusStage"] = "stopped"
		return store.ClearAssistantMessageOutputMetadata(c.Request.Context(), tx, run.UserID, message.ID,
			"用户已主动停止生成", assistantResolvedMode(run), "stopped", metadata)
	})
	if err != nil {
		fail(c, err)
		return
	}
	if canceled {
		assistantstream.Publish(c.Request.Context(), s.assistantStreamRedis(), id.String(), assistantstream.Event{
			Kind: assistantResolvedMode(run), Stage: "stopped", Done: true, Status: "canceled",
		})
		if s.Queue != nil {
			s.Queue.CancelAssistantRun(id.String())
		}
	}
	updated, _ := store.GetUserAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	s.dispatchReadyAssistantRuns(c.Request.Context())
	ok(c, gin.H{"run": assistantRunDict(updated), "canceled": canceled})
}

type assistantRunPatchIn struct {
	Status              string `json:"status"`
	AcknowledgeUpstream bool   `json:"acknowledgeUpstream"`
	Action              string `json:"action"`
	Prompt              string `json:"prompt"`
	UserMessageContent  string `json:"userMessageContent"`
}

func (s *Server) patchAssistantRun(c *gin.Context) {
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
	var body assistantRunPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Status == "canceled" {
		s.cancelAssistantRun(c, user, id, body)
		return
	}
	action := strings.ToLower(strings.TrimSpace(body.Action))
	switch action {
	case "edit":
		prompt := strings.TrimSpace(body.Prompt)
		content := strings.TrimSpace(body.UserMessageContent)
		if content == "" {
			content = prompt
		}
		if prompt == "" || len([]rune(prompt)) > maxAssistantMessageRunes || len([]rune(content)) > maxAssistantMessageRunes {
			fail(c, apperr.E("validation_error", "排队消息长度须在 1-12000 之间", 422))
			return
		}
		updated, updateErr := store.UpdateQueuedAssistantRunPrompt(c.Request.Context(), s.St.Pool, user.ID, id, prompt, content)
		if updateErr != nil {
			fail(c, updateErr)
			return
		}
		if !updated {
			fail(c, apperr.E("assistant_queue_item_unavailable", "任务已经开始，无法继续编辑", 409))
			return
		}
	case "move_up", "move_down":
		direction := 1
		if action == "move_up" {
			direction = -1
		}
		var moved bool
		moveErr := s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
			if lockErr := store.LockAssistantRunsForUser(c.Request.Context(), tx, user.ID); lockErr != nil {
				return lockErr
			}
			var err error
			moved, err = store.MoveQueuedAssistantRun(c.Request.Context(), tx, user.ID, id, direction)
			return err
		})
		if moveErr != nil {
			fail(c, moveErr)
			return
		}
		if !moved {
			fail(c, apperr.E("assistant_queue_boundary", "任务已经位于队列边界或已经开始", 409))
			return
		}
	default:
		fail(c, apperr.E("validation_error", "action: 不支持的排队操作", 422))
		return
	}
	s.dispatchReadyAssistantRuns(c.Request.Context())
	run, getErr := store.GetUserAssistantRun(c.Request.Context(), s.St.Pool, user.ID, id)
	if getErr != nil {
		fail(c, getErr)
		return
	}
	message, getErr := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, run.UserMessageID)
	if getErr != nil {
		fail(c, getErr)
		return
	}
	ok(c, gin.H{"run": assistantRunDict(run), "userMessage": assistantMessageDict(message)})
}

func assistantConversationDict(item *store.AssistantConversation, messages []*store.AssistantMessage) gin.H {
	serialized := make([]gin.H, 0, len(messages))
	for _, message := range messages {
		serialized = append(serialized, assistantMessageDict(message))
	}
	return gin.H{"id": item.ID.String(), "title": item.Title, "workspace": item.Workspace, "projectId": assistantProjectIDValue(item.ProjectID),
		"createdAt": isoValue(item.CreatedAt), "updatedAt": isoValue(item.UpdatedAt), "messages": serialized}
}

func assistantConversationWorkspace(value string) (string, error) {
	workspace := strings.ToLower(strings.TrimSpace(value))
	if workspace == "" {
		return "assistant", nil
	}
	if workspace != modelconfig.WorkspaceAssistant && workspace != modelconfig.WorkspaceUIDesign && workspace != modelconfig.WorkspaceCanvas {
		return "", apperr.E("validation_error", "workspace: 不支持的会话工作区", 422)
	}
	return workspace, nil
}

func normalizeAssistantReasoningEffort(value string, defaultStandard bool) (string, error) {
	effort := strings.ToLower(strings.TrimSpace(value))
	if effort == "" && defaultStandard {
		effort = "medium"
	}
	if effort == "" {
		return "", nil
	}
	if !containsString([]string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}, effort) {
		return "", apperr.E("validation_error", "reasoningEffort: 不支持的推理强度", 422)
	}
	return effort, nil
}

func normalizeAssistantReasoningEffortForModel(value, upstreamModel string, defaultStandard bool) (string, error) {
	return normalizeAssistantReasoningEffortForSupported(value, modelconfig.ReasoningEffortsForModel(upstreamModel), defaultStandard)
}

func reasoningEffortsForRun(selection *modelconfig.Selection, upstreamModel string) []string {
	if selection != nil {
		return append([]string(nil), selection.Model.SupportedReasoningEfforts...)
	}
	return modelconfig.ReasoningEffortsForModel(upstreamModel)
}

func normalizeAssistantReasoningEffortForSupported(value string, supported []string, defaultStandard bool) (string, error) {
	effort := strings.ToLower(strings.TrimSpace(value))
	if len(supported) == 0 {
		if effort == "" {
			return "", nil
		}
		return "", apperr.E("validation_error", "reasoningEffort: 所选模型未开启可配置推理强度", 422)
	}
	if effort == "" && defaultStandard {
		if containsString(supported, "medium") {
			return "medium", nil
		}
		return supported[0], nil
	}
	if effort == "" {
		return "", nil
	}
	if !containsString(supported, effort) {
		return "", apperr.E("validation_error", "reasoningEffort: 所选模型仅支持 "+strings.Join(supported, "、"), 422)
	}
	return effort, nil
}

func assistantMessageDict(item *store.AssistantMessage) gin.H {
	if item == nil {
		return gin.H{}
	}
	out := gin.H{}
	for key, value := range item.Metadata {
		if strings.HasPrefix(key, "_") {
			continue
		}
		out[key] = value
	}
	out["id"] = item.ID.String()
	out["role"] = item.Role
	out["content"] = item.Content
	out["kind"] = item.Kind
	out["status"] = item.Status
	out["pending"] = item.Role == "assistant" && (item.Status == "queued" || item.Status == "running")
	out["createdAt"] = isoValue(item.CreatedAt)
	out["updatedAt"] = isoValue(item.UpdatedAt)
	return out
}

func assistantMessageMetadataWithoutOutputs(message *store.AssistantMessage) map[string]any {
	metadata := make(map[string]any)
	if message == nil {
		return metadata
	}
	for key, value := range message.Metadata {
		metadata[key] = value
	}
	delete(metadata, "images")
	if proposal, ok := metadata["proposal"].(map[string]any); ok {
		proposalCopy := make(map[string]any, len(proposal))
		for key, value := range proposal {
			proposalCopy[key] = value
		}
		delete(proposalCopy, "images")
		metadata["proposal"] = proposalCopy
	}
	return metadata
}

func assistantRunDict(item *store.AssistantRun) gin.H {
	if item == nil {
		return gin.H{}
	}
	payload := gin.H{"id": item.ID.String(), "conversationId": item.ConversationID.String(),
		"userMessageId": item.UserMessageID.String(), "assistantMessageId": item.AssistantMessageID.String(),
		"mode": item.Mode, "resolvedMode": item.ResolvedMode, "status": item.Status, "stage": item.Stage,
		"prompt": item.Prompt, "queuePosition": item.QueuePosition,
		"reservedCents": item.ReservedCents, "costCents": item.CostCents,
		"billingGeneration": item.BillingGeneration,
		"errorCode":         item.ErrorCode, "errorMessage": item.ErrorMessage, "createdAt": isoValue(item.CreatedAt),
		"startedAt": iso(item.StartedAt), "finishedAt": iso(item.FinishedAt),
		"cancelPolicy": assistantbilling.CancelPolicyForRun(item)}
	if item.Params != nil {
		if parent, _ := item.Params["parentOutputUrl"].(string); strings.TrimSpace(parent) != "" {
			payload["parentOutputUrl"] = strings.TrimSpace(parent)
		}
		if serviceKey, _ := item.Params["serviceKey"].(string); strings.TrimSpace(serviceKey) != "" {
			payload["serviceKey"] = strings.TrimSpace(serviceKey)
		}
		if workspace, _ := item.Params["workspace"].(string); strings.TrimSpace(workspace) != "" {
			payload["workspace"] = strings.TrimSpace(workspace)
		}
	}
	return payload
}

func sanitizeAssistantCanvasSnapshot(raw json.RawMessage) (any, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	if len(raw) > assistantCanvasSnapshotMaxBytes {
		return nil, apperr.E("validation_error", "画布快照过大", 422)
	}
	var snapshot any
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, apperr.E("validation_error", "画布快照无效", 422)
	}
	return snapshot, nil
}

func parseAssistantProjectID(value string) (*uuid.UUID, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, apperr.E("validation_error", "projectId: 无效 UUID", 422)
	}
	return &id, nil
}

func assistantProjectIDValue(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}

func assistantCanvasSnapshotProjectID(snapshot any) *uuid.UUID {
	record, ok := snapshot.(map[string]any)
	if !ok {
		return nil
	}
	raw, _ := record["projectId"].(string)
	id, err := parseAssistantProjectID(raw)
	if err != nil {
		return nil
	}
	return id
}

func (s *Server) bindAssistantConversationProject(ctx context.Context, userID uuid.UUID, conversation *store.AssistantConversation, projectID uuid.UUID) error {
	if conversation == nil {
		return nil
	}
	if conversation.Workspace != modelconfig.WorkspaceCanvas {
		return apperr.E("validation_error", "projectId: 仅支持无限画布会话", 422)
	}
	if conversation.ProjectID != nil {
		if *conversation.ProjectID != projectID {
			return apperr.E("not_found", "对话不属于当前画布", 404)
		}
		return nil
	}
	if err := store.SetAssistantConversationProjectIfEmpty(ctx, s.St.Pool, userID, conversation.ID, projectID); err != nil {
		return err
	}
	conversation.ProjectID = &projectID
	return nil
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

func normalizeAssistantIdempotencyKey(value, fallback string) (string, error) {
	key := strings.TrimSpace(value)
	if key == "" {
		key = strings.TrimSpace(fallback)
	}
	if key == "" {
		return "", nil
	}
	if len([]rune(key)) > 160 || strings.IndexFunc(key, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return "", apperr.E("validation_error", "idempotencyKey 格式无效", 422)
	}
	return key, nil
}

func assistantAllowedConfiguredValue(values []string, requested string) (string, bool) {
	requested = strings.TrimSpace(requested)
	for _, value := range values {
		if strings.EqualFold(value, requested) {
			return value, true
		}
	}
	return "", false
}

func normalizeAssistantReferenceMode(value string) (string, error) {
	switch normalized := strings.ToLower(strings.TrimSpace(value)); normalized {
	case "", "shared", "individual":
		return normalized, nil
	default:
		return "", apperr.E("validation_error", "referenceMode: 仅支持 shared 或 individual", 422)
	}
}

func normalizeAssistantConfiguredImageParameters(body *assistantRunIn, model modelconfig.Model) (bool, error) {
	if len(model.Resolutions) == 0 {
		body.Resolution = ""
		body.RequestSize = ""
		body.Width = 0
		body.Height = 0
	} else {
		resolution, supported := assistantAllowedConfiguredValue(model.Resolutions, body.Resolution)
		if supported {
			body.Resolution = resolution
		} else if body.Resolution == "" || body.Mode == "agent" {
			body.Resolution = model.Resolutions[0]
		} else {
			return false, apperr.E("validation_error", "所选模型不支持该分辨率，请刷新模型配置后重试", 422)
		}
		if body.RequestSize == "" {
			body.RequestSize = "auto"
		}
		if err := validateAssistantImageSize(body.RequestSize); err != nil {
			return false, err
		}
	}

	if len(model.Qualities) == 0 {
		body.Quality = ""
	} else if quality, supported := assistantAllowedConfiguredValue(model.Qualities, body.Quality); supported {
		body.Quality = quality
	} else if body.Quality == "" || body.Mode == "agent" {
		body.Quality = model.Qualities[0]
	} else {
		return false, apperr.E("validation_error", "所选模型不支持该图片质量", 422)
	}

	ratio := strings.ToLower(strings.TrimSpace(body.Ratio))
	if ratio == "" || ratio == "自动" {
		ratio = "auto"
	}
	allowedRatios := modelconfig.AspectRatiosForResolution(model, body.Resolution)
	if len(allowedRatios) == 0 {
		ratio = ""
	} else if !containsString(allowedRatios, ratio) {
		if body.Mode == "agent" {
			ratio = allowedRatios[0]
		} else {
			return false, apperr.E("validation_error", "所选模型不支持该宽高比", 422)
		}
	}
	body.Ratio = ratio
	return ratio == "auto", nil
}

func assistantRunRequestFingerprint(body assistantRunIn) (string, error) {
	rawSnapshot := append([]byte(nil), body.CanvasSnapshot...)
	body.CanvasSnapshot = nil
	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	payload = append(payload, 0)
	payload = append(payload, rawSnapshot...)
	sum := sha256.Sum256(payload)
	return fmt.Sprintf("%x", sum[:]), nil
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

func assistantUploadReferenceKeys(items []map[string]any, userID uuid.UUID) []string {
	prefix := "uploads/" + userID.String() + "/"
	keys := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := strings.TrimSpace(assistantMapText(item, "fileKey"))
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func normalizeAssistantFileAttachments(items []map[string]any) ([]map[string]any, error) {
	if len(items) == 0 {
		return []map[string]any{}, nil
	}
	if len(items) > 8 {
		return nil, apperr.E("validation_error", "每次最多附加 8 个文档", 422)
	}
	out := make([]map[string]any, 0, len(items))
	seen := make(map[uuid.UUID]bool, len(items))
	for _, item := range items {
		id, err := uuid.Parse(strings.TrimSpace(assistantMapText(item, "id")))
		if err != nil {
			return nil, apperr.E("validation_error", "attachments: 文件 ID 无效", 422)
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, map[string]any{"id": id.String()})
		}
	}
	return out, nil
}

func hydrateAssistantFileAttachments(
	ctx context.Context,
	q store.Q,
	userID uuid.UUID,
	items []map[string]any,
) ([]map[string]any, error) {
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		id, err := uuid.Parse(assistantMapText(item, "id"))
		if err != nil {
			return nil, apperr.E("validation_error", "attachments: 文件 ID 无效", 422)
		}
		ids = append(ids, id)
	}
	files, err := store.ListUserAssistantFilesByIDs(ctx, q, userID, ids)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		file := files[id]
		if file == nil {
			return nil, apperr.E("validation_error", "attachments: 文件不存在或不属于当前用户", 422)
		}
		if file.Status != "ready" {
			return nil, apperr.E("assistant_file_not_ready", "文档仍在解析，请等待完成后发送", 409)
		}
		out = append(out, map[string]any{
			"id": file.ID.String(), "name": file.Name, "contentType": file.ContentType,
			"sizeBytes": file.SizeBytes, "pageCount": file.PageCount, "charCount": file.CharCount,
		})
	}
	return out, nil
}

func assistantTaskOutputReferenceKeys(items []map[string]any, userID uuid.UUID) []string {
	keys := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := strings.TrimSpace(assistantMapText(item, "fileKey"))
		if !isOwnedTaskOutputImageKey(userID, key) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func assistantOutputReferenceKeys(items []map[string]any, userID uuid.UUID) []string {
	keys := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := strings.TrimSpace(assistantMapText(item, "fileKey"))
		if !isOwnedAssistantOutputImageKey(userID, key) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func assistantUploadReferenceKeysFromMetadata(metadata map[string]any, userID uuid.UUID) []string {
	refs := make([]map[string]any, 0, 4)
	for _, value := range []any{metadata["referenceImages"], metadata["images"]} {
		refs = append(refs, assistantReferenceItems(value)...)
	}
	if proposal, ok := metadata["proposal"].(map[string]any); ok {
		for _, value := range []any{proposal["referenceImages"], proposal["images"]} {
			refs = append(refs, assistantReferenceItems(value)...)
		}
	}
	return assistantUploadReferenceKeys(refs, userID)
}

func assistantReferenceItems(value any) []map[string]any {
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		refs := make([]map[string]any, 0, len(items))
		for _, raw := range items {
			if item, ok := raw.(map[string]any); ok {
				refs = append(refs, item)
			}
		}
		return refs
	default:
		return nil
	}
}

func sanitizeAssistantReferences(items []map[string]any, userID uuid.UUID) ([]map[string]any, error) {
	type candidate struct {
		item        map[string]any
		key         string
		sourceIndex int
	}
	candidates := make([]candidate, 0, len(items))
	sources := make([]string, 0, len(items))
	for _, item := range items {
		key := strings.TrimSpace(assistantMapText(item, "fileKey"))
		dataURL := strings.TrimSpace(assistantMapText(item, "dataUrl"))
		allowedKey := strings.HasPrefix(key, "uploads/"+userID.String()+"/") || strings.HasPrefix(key, "tasks/"+userID.String()+"/")
		if allowedKey {
			candidates = append(candidates, candidate{item: item, key: key, sourceIndex: -1})
			continue
		}
		if dataURL == "" {
			continue
		}
		candidates = append(candidates, candidate{item: item, sourceIndex: len(sources)})
		sources = append(sources, dataURL)
	}
	normalizedSources, err := validateAssistantReferenceImages(sources)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(candidates))
	for _, candidate := range candidates {
		item := candidate.item
		copyItem := map[string]any{"id": assistantMapText(item, "id"), "name": assistantMapText(item, "name")}
		if candidate.key != "" {
			copyItem["fileKey"] = candidate.key
			copyItem["dataUrl"] = "/api/v1/files/" + candidate.key
		} else {
			copyItem["dataUrl"] = normalizedSources[candidate.sourceIndex]
		}
		out = append(out, copyItem)
	}
	return out, nil
}

func sanitizeAssistantImagePlanItems(items []assistantRunImagePlanItem, references []map[string]any, expected int) ([]map[string]any, error) {
	if len(items) == 0 {
		return nil, nil
	}
	if len(items) != expected {
		return nil, apperr.E("validation_error", fmt.Sprintf("独立多图方案数量不一致：方案 %d 张，输出 %d 张", len(items), expected), 422)
	}
	allowed := map[string]bool{}
	for _, reference := range references {
		for _, key := range []string{"id", "fileKey"} {
			if value := strings.TrimSpace(assistantMapText(reference, key)); value != "" {
				allowed[value] = true
			}
		}
	}
	out := make([]map[string]any, 0, len(items))
	for index, item := range items {
		promptText := strings.TrimSpace(item.Prompt)
		if promptText == "" || len([]rune(promptText)) > maxAssistantMessageRunes {
			return nil, apperr.E("validation_error", fmt.Sprintf("第 %d 张图片的提示词长度须在 1-12000 之间", index+1), 422)
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = fmt.Sprintf("图片 %d", index+1)
		}
		if len([]rune(title)) > 40 {
			return nil, apperr.E("validation_error", fmt.Sprintf("第 %d 张图片的用途名称不能超过 40 个字符", index+1), 422)
		}
		referenceIDs := make([]string, 0, min(len(item.ReferenceImageIDs), 4))
		seen := map[string]bool{}
		for _, id := range item.ReferenceImageIDs {
			id = strings.TrimSpace(id)
			if id == "" || seen[id] {
				continue
			}
			if !allowed[id] {
				return nil, apperr.E("validation_error", fmt.Sprintf("第 %d 张图片引用了不存在的参考图", index+1), 422)
			}
			if len(referenceIDs) >= 4 {
				return nil, apperr.E("validation_error", fmt.Sprintf("第 %d 张图片最多引用 4 张参考图", index+1), 422)
			}
			seen[id] = true
			referenceIDs = append(referenceIDs, id)
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = fmt.Sprintf("item-%d", index+1)
		}
		out = append(out, map[string]any{
			"id": id, "title": title, "prompt": promptText, "referenceImageIds": referenceIDs,
		})
	}
	return out, nil
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
