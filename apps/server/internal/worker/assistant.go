package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

const assistantOutputLimit = 32 << 20

func (w *Worker) recoverAssistantRuns(ctx context.Context) error {
	running, err := store.RequeueRunningAssistantRuns(ctx, w.St.Pool)
	if err != nil {
		return err
	}
	queued, err := store.ListQueuedAssistantRunIDs(ctx, w.St.Pool, 500)
	if err != nil {
		return err
	}
	seen := make(map[uuid.UUID]bool, len(running))
	for _, id := range running {
		seen[id] = true
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			log.Printf("recover assistant run %s failed: %v", id, err)
		}
	}
	for _, id := range queued {
		if seen[id] {
			continue
		}
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			log.Printf("recover queued assistant run %s failed: %v", id, err)
		}
	}
	return nil
}

func (w *Worker) assistantClient(ctx context.Context) (*sub2api.Client, error) {
	resolved, err := settings.ResolveSub2API(ctx, w.St.Pool, settings.Sub2APIConfig{
		BaseURL: w.Cfg.Sub2APIBaseURL, APIKey: w.Cfg.Sub2APIAPIKey,
		ChatModel: w.Cfg.Sub2APIChatModel, ImageModel: w.Cfg.Sub2APIImageModel,
		TimeoutSecs: w.Cfg.Sub2APITimeoutSecs,
	}, w.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	client, err := sub2api.New(resolved.BaseURL, resolved.APIKey, resolved.ChatModel, resolved.ImageModel, resolved.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if !client.Configured() {
		return nil, errors.New("AI service is not configured")
	}
	return client, nil
}

func (w *Worker) handleRunAssistant(ctx context.Context, task *asynq.Task) error {
	var payload taskflow.RunAssistantPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("bad assistant payload: %w", err)
	}
	runID, err := uuid.Parse(payload.RunID)
	if err != nil {
		return fmt.Errorf("bad assistant run id: %w", err)
	}
	claimed, err := store.ClaimAssistantRun(ctx, w.St.Pool, runID)
	if err != nil || !claimed {
		return err
	}
	run, err := store.GetAssistantRun(ctx, w.St.Pool, runID)
	if err != nil || run == nil {
		return err
	}
	client, err := w.assistantClient(ctx)
	if err == nil {
		err = w.executeAssistantRun(ctx, client, run)
	}
	if err == nil {
		return nil
	}

	current, getErr := store.GetAssistantRun(context.Background(), w.St.Pool, runID)
	if getErr == nil && current != nil {
		if current.Status == "canceled" {
			_ = store.UpdateAssistantMessage(context.Background(), w.St.Pool, run.AssistantMessageID,
				"已停止生成", resolvedAssistantMode(run), "stopped", assistantMessageMetadata(run, nil, "stopped", ""))
			return nil
		}
		if current.Status == "failed" {
			return nil
		}
	}
	message := sanitizeUpstreamMessage(err.Error())
	_, _ = store.FailAssistantRun(context.Background(), w.St.Pool, runID, "assistant_run_failed", message)
	_ = store.UpdateAssistantMessage(context.Background(), w.St.Pool, run.AssistantMessageID,
		message, resolvedAssistantMode(run), "failed", assistantMessageMetadata(run, nil, "failed", message))
	return nil
}

func (w *Worker) executeAssistantRun(ctx context.Context, client *sub2api.Client, run *store.AssistantRun) error {
	if requestedModel := assistantParamString(run.Params, "model", ""); requestedModel != "" && requestedModel != client.ImageModel() {
		client = client.WithChatModel(requestedModel)
	}
	mode := run.Mode
	references, err := w.loadAssistantReferences(ctx, run.Params)
	if err != nil {
		return err
	}
	if mode == "agent" {
		mode = w.classifyAssistantRun(ctx, client, run.Prompt, len(references) > 0)
	}
	run.ResolvedMode = mode
	stage := "thinking"
	if mode == "image" {
		stage = "generating-image"
	} else if len(references) > 0 {
		stage = "analyzing-image"
	}
	if err := store.SetAssistantRunStage(ctx, w.St.Pool, run.ID, mode, stage); err != nil {
		return err
	}
	metadata := assistantMessageMetadata(run, nil, stage, "")
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", mode, "running", metadata); err != nil {
		return err
	}

	if mode == "image" {
		return w.executeAssistantImage(ctx, client, run, references)
	}
	return w.executeAssistantChat(ctx, client, run, references)
}

func (w *Worker) classifyAssistantRun(ctx context.Context, client *sub2api.Client, prompt string, hasReference bool) string {
	referenceText := "没有附带参考图片"
	if hasReference {
		referenceText = "附带了参考图片"
	}
	system := `你是意图路由器。本轮` + referenceText + `。只有用户明确要求创建新图，或修改、重绘、换背景、增删图片元素时回复 IMAGE。识别图片文字/OCR、读取、翻译、描述、分析、总结、解释或回答图片相关问题都回复 CHAT。参考图片的存在本身绝不代表要编辑图片。只回复 IMAGE 或 CHAT。`
	result, err := client.ChatTextWithImages(ctx, []sub2api.Message{
		{Role: "system", Content: system}, {Role: "user", Content: prompt},
	}, nil, nil)
	if err == nil && strings.Contains(strings.ToUpper(result), "IMAGE") {
		return "image"
	}
	if err == nil && strings.Contains(strings.ToUpper(result), "CHAT") {
		return "chat"
	}
	return fallbackAssistantIntent(prompt, hasReference)
}

func fallbackAssistantIntent(prompt string, hasReference bool) string {
	text := strings.ToLower(prompt)
	mutations := []string{"修改", "编辑", "重绘", "换背景", "去背景", "抠图", "擦除", "移除", "替换", "添加", "扩图", "上色", "edit", "redraw", "remove", "replace"}
	understanding := []string{"识别", "读取", "提取", "描述", "分析", "总结", "翻译", "解释", "ocr", "read", "describe", "translate"}
	if hasReference && containsAssistantTerm(text, understanding) {
		return "chat"
	}
	if hasReference && containsAssistantTerm(text, mutations) {
		return "image"
	}
	actions := []string{"生成", "画", "绘制", "制作", "创建", "设计", "generate", "draw", "create"}
	images := []string{"图", "海报", "插画", "头像", "壁纸", "封面", "logo", "image", "picture", "poster"}
	if containsAssistantTerm(text, actions) && containsAssistantTerm(text, images) {
		return "image"
	}
	return "chat"
}

func containsAssistantTerm(value string, terms []string) bool {
	for _, term := range terms {
		if strings.Contains(value, term) {
			return true
		}
	}
	return false
}

func (w *Worker) executeAssistantChat(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	messages, err := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, 60)
	if err != nil {
		return err
	}
	payload := make([]sub2api.Message, 0, len(messages))
	for _, message := range messages {
		if message.ID == run.AssistantMessageID || strings.TrimSpace(message.Content) == "" || message.Status == "failed" {
			continue
		}
		item := sub2api.Message{Role: message.Role, Content: message.Content}
		if message.ID == run.UserMessageID {
			item.ReferenceImages = references
		}
		payload = append(payload, item)
	}
	lastCheckpoint := time.Time{}
	answering := false
	text, err := client.ChatTextWithImages(ctx, payload, nil, func(fullText string) error {
		if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		if time.Since(lastCheckpoint) < 500*time.Millisecond && len(fullText)%120 != 0 {
			return nil
		}
		lastCheckpoint = time.Now()
		if !answering {
			if err := store.SetAssistantRunStage(ctx, w.St.Pool, run.ID, "chat", "answering"); err != nil {
				return err
			}
			answering = true
		}
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, fullText, "chat", "running",
			assistantMessageMetadata(run, nil, "answering", ""))
	})
	if err != nil {
		return err
	}
	if strings.TrimSpace(text) == "" {
		text = "没有收到模型回复，请重试。"
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, "chat", "complete",
		assistantMessageMetadata(run, nil, "complete", "")); err != nil {
		return err
	}
	_, err = store.CompleteAssistantRun(ctx, w.St.Pool, run.ID, "chat")
	return err
}

func (w *Worker) executeAssistantImage(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	size := assistantParamString(run.Params, "requestSize", "auto")
	quality := assistantParamString(run.Params, "quality", "high")
	count := assistantParamInt(run.Params, "count", 2)
	images, err := client.GenerateImage(ctx, run.Prompt, size, quality, count, references)
	if err != nil {
		return err
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	stored := make([]map[string]any, 0, len(images))
	for index, image := range images {
		data, contentType, ext, err := downloadAssistantImage(ctx, image.DataURL)
		if err != nil {
			return err
		}
		key := fmt.Sprintf("tasks/%s/assistant/%s/%d.%s", run.UserID, run.ID, index+1, ext)
		if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
			return err
		}
		stored = append(stored, map[string]any{
			"id": uuid.NewString(), "dataUrl": "/api/files/" + key, "fileKey": key,
			"revisedPrompt": image.RevisedPrompt,
		})
	}
	content := "图片已生成"
	if len(images) < count {
		content = fmt.Sprintf("已生成 %d/%d 张图片，其余图片因上游超时未完成", len(images), count)
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "image", "complete",
		assistantMessageMetadata(run, stored, "complete", "")); err != nil {
		return err
	}
	_, err = store.CompleteAssistantRun(ctx, w.St.Pool, run.ID, "image")
	return err
}

func (w *Worker) assistantRunTerminated(ctx context.Context, id uuid.UUID) (bool, error) {
	run, err := store.GetAssistantRun(ctx, w.St.Pool, id)
	return run == nil || (run.Status != "queued" && run.Status != "running"), err
}

func (w *Worker) loadAssistantReferences(ctx context.Context, params map[string]any) ([]string, error) {
	items, _ := params["referenceImages"].([]any)
	out := make([]string, 0, len(items))
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		key := assistantMapString(item, "fileKey")
		value := assistantMapString(item, "dataUrl")
		if key == "" && strings.HasPrefix(value, "/api/files/") {
			key = strings.TrimPrefix(value, "/api/files/")
		}
		if key != "" {
			data, err := w.Storage.GetBytesLimit(ctx, key, 16<<20)
			if err != nil {
				return nil, err
			}
			contentType := http.DetectContentType(data)
			out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
			continue
		}
		if strings.HasPrefix(value, "data:image/") || strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") {
			out = append(out, value)
		}
	}
	return out, nil
}

func assistantMessageMetadata(run *store.AssistantRun, images []map[string]any, stage, errorMessage string) map[string]any {
	metadata := make(map[string]any, len(run.Params)+6)
	for key, value := range run.Params {
		if key == "referenceImages" {
			continue
		}
		metadata[key] = value
	}
	metadata["runId"] = run.ID.String()
	metadata["statusStage"] = stage
	metadata["pending"] = stage != "complete" && stage != "failed" && stage != "stopped"
	metadata["routing"] = stage == "routing"
	if images != nil {
		metadata["images"] = images
	}
	if errorMessage != "" {
		metadata["error"] = errorMessage
	} else {
		metadata["error"] = ""
	}
	return metadata
}

func resolvedAssistantMode(run *store.AssistantRun) string {
	if run.ResolvedMode != "" {
		return run.ResolvedMode
	}
	if run.Mode == "agent" {
		return "chat"
	}
	return run.Mode
}

func assistantParamString(params map[string]any, key, fallback string) string {
	if value, ok := params[key].(string); ok && strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func assistantParamInt(params map[string]any, key string, fallback int) int {
	switch value := params[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	}
	return fallback
}

func assistantMapString(item map[string]any, key string) string {
	if item == nil {
		return ""
	}
	value, _ := item[key].(string)
	return strings.TrimSpace(value)
}

func downloadAssistantImage(ctx context.Context, source string) ([]byte, string, string, error) {
	if strings.HasPrefix(source, "data:image/") {
		parts := strings.SplitN(source, ",", 2)
		if len(parts) != 2 {
			return nil, "", "", errors.New("invalid image data URL")
		}
		data, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, "", "", err
		}
		contentType, ext := assistantImageType(data)
		return data, contentType, ext, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, "", "", err
	}
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("download generated image: status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, assistantOutputLimit+1))
	if err != nil || len(data) > assistantOutputLimit {
		return nil, "", "", errors.New("generated image is unavailable or too large")
	}
	contentType, ext := assistantImageType(data)
	return data, contentType, ext, nil
}

func assistantImageType(data []byte) (string, string) {
	contentType := http.DetectContentType(data)
	switch contentType {
	case "image/jpeg":
		return contentType, "jpg"
	case "image/webp":
		return contentType, "webp"
	default:
		return "image/png", "png"
	}
}
