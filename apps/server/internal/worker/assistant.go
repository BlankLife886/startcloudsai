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
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
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
			assistantstream.Publish(context.Background(), w.Stream, runID.String(),
				assistantstream.Event{Done: true, Status: "canceled"})
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
	assistantstream.Publish(context.Background(), w.Stream, runID.String(),
		assistantstream.Event{Done: true, Status: "failed"})
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
		history, histErr := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, 20)
		if histErr != nil {
			// 历史加载失败时退化为无上下文分类，不阻塞本次运行
			history = nil
		}
		transcript := buildAssistantIntentTranscript(history, run.UserMessageID, run.AssistantMessageID, run.Prompt)
		lastWasImage := lastAssistantMessageWasImage(history, run.UserMessageID, run.AssistantMessageID)
		mode = w.classifyAssistantRun(ctx, client, transcript, run.Prompt, len(references) > 0, lastWasImage)
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
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: mode, Stage: stage})

	if mode == "image" {
		return w.executeAssistantImage(ctx, client, run, references)
	}
	return w.executeAssistantChat(ctx, client, run, references)
}

const (
	assistantIntentHistoryTurns  = 8    // 送入路由器的历史消息条数上限
	assistantIntentLineRunes     = 160  // 每行摘要的最大字符数
	assistantIntentSummaryRunes  = 80   // 图片消息提示词摘要的最大字符数
	assistantIntentMaxRunes      = 2000 // 整个对话摘要的最大字符数
	assistantIntentShortPromptRn = 30   // 判定“延续上一张图”时的短指令阈值
)

// assistantIntentTokenPattern 匹配回复中首个 IMAGE 或 CHAT 单词（先出现者优先）。
var assistantIntentTokenPattern = regexp.MustCompile(`\b(IMAGE|CHAT)\b`)

// assistantContinuationPattern 匹配紧跟在生成图片之后的延续/修改类短指令。
var assistantContinuationPattern = regexp.MustCompile(`再来|再生成|再画|多来|换成|改成|变成|调整|加上|去掉|移除|放大|缩小|更[亮暗大小]|颜色|背景|风格|第[一二三四12345]张|another|again|more|make it|change`)

func (w *Worker) classifyAssistantRun(ctx context.Context, client *sub2api.Client, transcript, prompt string, hasReference, lastAssistantWasImage bool) string {
	referenceText := "没有附带参考图片"
	if hasReference {
		referenceText = "附带了参考图片"
	}
	system := `你是意图路由器，负责判断用户最后一条消息应该走图片生成（IMAGE）还是普通对话（CHAT）。本轮` + referenceText + `。

判定规则：
1. 用户明确要求创建新图、绘制、设计图片时回复 IMAGE。
2. 上一轮助手刚生成过图片，而用户发来延续或修改类指令（如“再来一张”“换个颜色”“背景改成夜晚”“第二张放大一点”）时，也回复 IMAGE。
3. 识别图片文字/OCR、读取、翻译、描述、分析、总结、解释或回答图片相关问题回复 CHAT，即使附带了参考图片。
4. 参考图片的存在本身绝不代表要生成或编辑图片。
5. 图片生成后的寒暄或评价（如“真好看”“谢谢”）回复 CHAT。

示例：
- 用户：画一只戴帽子的猫 → IMAGE
- 用户：今天天气怎么样 → CHAT
- 用户：这张图里写了什么字（附参考图） → CHAT
- 助手：[生成了 2 张图片：戴帽子的猫] 用户：再来一张 → IMAGE
- 助手：[生成了 1 张图片：城市夜景] 用户：背景改成星空 → IMAGE
- 助手：[生成了 2 张图片：戴帽子的猫] 用户：真好看 → CHAT
- 助手：[生成了 1 张图片：海报] 用户：帮我翻译图上的英文 → CHAT

只输出一个单词：IMAGE 或 CHAT，不要任何标点或解释。`
	result, err := client.ChatTextWithImages(ctx, []sub2api.Message{
		{Role: "system", Content: system}, {Role: "user", Content: transcript},
	}, nil, nil)
	if err == nil {
		if intent := parseAssistantIntentReply(result); intent != "" {
			return intent
		}
	}
	return fallbackAssistantIntent(prompt, hasReference, lastAssistantWasImage)
}

// parseAssistantIntentReply 解析路由器回复：取最先出现的 IMAGE 或 CHAT，无匹配返回空串。
func parseAssistantIntentReply(reply string) string {
	match := assistantIntentTokenPattern.FindString(strings.ToUpper(reply))
	switch match {
	case "IMAGE":
		return "image"
	case "CHAT":
		return "chat"
	}
	return ""
}

func fallbackAssistantIntent(prompt string, hasReference bool, lastAssistantWasImage bool) string {
	text := strings.ToLower(prompt)
	understanding := []string{"识别", "读取", "提取", "描述", "分析", "总结", "翻译", "解释", "是什么", "ocr", "read", "describe", "translate"}
	// 理解类动词优先：即使上一轮刚生成图片，也应走对话回答
	if (hasReference || lastAssistantWasImage) && containsAssistantTerm(text, understanding) {
		return "chat"
	}
	// 上一轮刚生成图片时，短促的延续/修改指令视为继续生图
	if lastAssistantWasImage && len([]rune(strings.TrimSpace(prompt))) <= assistantIntentShortPromptRn &&
		assistantContinuationPattern.MatchString(text) {
		return "image"
	}
	mutations := []string{"修改", "编辑", "重绘", "换背景", "去背景", "抠图", "擦除", "移除", "替换", "添加", "扩图", "上色", "edit", "redraw", "remove", "replace"}
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

// buildAssistantIntentTranscript 构建送入路由器的对话摘要：截取当前消息之前的若干条历史，
// 图片消息压缩为一行提示，最后附上本轮用户输入。
func buildAssistantIntentTranscript(history []*store.AssistantMessage, userMessageID, assistantMessageID uuid.UUID, prompt string) string {
	lines := make([]string, 0, assistantIntentHistoryTurns+1)
	for _, message := range history {
		if message == nil || message.ID == userMessageID || message.ID == assistantMessageID || message.Status == "failed" {
			continue
		}
		line := renderAssistantIntentLine(message)
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	if len(lines) > assistantIntentHistoryTurns {
		lines = lines[len(lines)-assistantIntentHistoryTurns:]
	}
	lines = append(lines, truncateAssistantRunes("用户："+strings.TrimSpace(prompt), assistantIntentLineRunes))
	// 双重保险：总长度超限时丢弃最早的历史行
	for len(lines) > 1 && len([]rune(strings.Join(lines, "\n"))) > assistantIntentMaxRunes {
		lines = lines[1:]
	}
	return strings.Join(lines, "\n")
}

// renderAssistantIntentLine 把一条历史消息渲染成单行摘要；空消息返回空串。
func renderAssistantIntentLine(message *store.AssistantMessage) string {
	roleTag := "助手"
	if message.Role == "user" {
		roleTag = "用户"
	}
	if message.Role != "user" {
		if count, summary := assistantMessageImageSummary(message); count > 0 {
			body := fmt.Sprintf("[生成了 %d 张图片：%s]", count, truncateAssistantRunes(summary, assistantIntentSummaryRunes))
			return truncateAssistantRunes(roleTag+"："+body, assistantIntentLineRunes)
		}
	}
	content := strings.TrimSpace(message.Content)
	if content == "" {
		return ""
	}
	return truncateAssistantRunes(roleTag+"："+content, assistantIntentLineRunes)
}

// assistantMessageImageSummary 返回图片消息包含的图片数量与提示词摘要；非图片消息返回 0。
func assistantMessageImageSummary(message *store.AssistantMessage) (int, string) {
	images, _ := message.Metadata["images"].([]any)
	count := len(images)
	if count == 0 {
		if typed, ok := message.Metadata["images"].([]map[string]any); ok {
			count = len(typed)
		}
	}
	// 仅在消息成功完成时才凭 kind 推断为图片：排队/运行/停止的图片占位消息并未产出图片
	if count == 0 && (message.Kind != "image" || message.Status != "complete") {
		return 0, ""
	}
	if count == 0 {
		count = 1
	}
	if summary, ok := message.Metadata["prompt"].(string); ok && strings.TrimSpace(summary) != "" {
		return count, strings.TrimSpace(summary)
	}
	if len(images) > 0 {
		if item, ok := images[0].(map[string]any); ok {
			if revised := assistantMapString(item, "revisedPrompt"); revised != "" {
				return count, revised
			}
		}
	}
	return count, strings.TrimSpace(message.Content)
}

// lastAssistantMessageWasImage 判断当前消息之前最近一条有效助手消息是否为图片生成结果。
func lastAssistantMessageWasImage(history []*store.AssistantMessage, userMessageID, assistantMessageID uuid.UUID) bool {
	for index := len(history) - 1; index >= 0; index-- {
		message := history[index]
		if message == nil || message.ID == userMessageID || message.ID == assistantMessageID || message.Status == "failed" {
			continue
		}
		if message.Role != "assistant" {
			continue
		}
		count, _ := assistantMessageImageSummary(message)
		return count > 0
	}
	return false
}

// truncateAssistantRunes 按字符数截断字符串，超出部分以省略号结尾。
func truncateAssistantRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
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
	lastPublish := time.Time{}
	answering := false
	text, err := client.ChatTextWithImages(ctx, payload, nil, func(fullText string) error {
		// 真流式：增量文本经 Redis 推给 SSE（120ms 节流），DB 落盘仍按 500ms 兜底
		if time.Since(lastPublish) >= 120*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: fullText, Kind: "chat", Stage: "answering"})
		}
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
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Content: text, Kind: "chat", Done: true, Status: "succeeded"})
	return err
}

func (w *Worker) executeAssistantImage(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	size := assistantParamString(run.Params, "requestSize", "auto")
	quality := assistantParamString(run.Params, "quality", "high")
	count := assistantParamInt(run.Params, "count", 2)
	storedByIndex := make([]map[string]any, count)
	images, err := client.GenerateImageProgressive(ctx, run.Prompt, size, quality, count, references, func(index int, image sub2api.Image) error {
		if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		data, contentType, ext, err := downloadAssistantImage(ctx, image.DataURL)
		if err != nil {
			return err
		}
		key := fmt.Sprintf("tasks/%s/assistant/%s/%d.%s", run.UserID, run.ID, index+1, ext)
		if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
			return err
		}
		stored := map[string]any{
			"id": uuid.NewString(), "index": index, "dataUrl": "/api/files/" + key, "fileKey": key,
			"revisedPrompt": image.RevisedPrompt,
		}
		storedByIndex[index] = stored
		partial := compactAssistantImages(storedByIndex)
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, partial, "generating-image", "")); err != nil {
			return err
		}
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Kind: "image", Stage: "generating-image", ImageTotal: count,
			Image: &assistantstream.ImageEvent{
				ID: stored["id"].(string), Index: index, DataURL: stored["dataUrl"].(string),
				FileKey: key, RevisedPrompt: image.RevisedPrompt,
			},
		})
		return nil
	})
	if err != nil {
		return err
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	stored := compactAssistantImages(storedByIndex)
	content := "图片已生成"
	if len(images) < count {
		content = fmt.Sprintf("已生成 %d/%d 张图片，其余图片因上游超时未完成", len(images), count)
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "image", "complete",
		assistantMessageMetadata(run, stored, "complete", "")); err != nil {
		return err
	}
	_, err = store.CompleteAssistantRun(ctx, w.St.Pool, run.ID, "image")
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Kind: "image", Done: true, Status: "succeeded", ImageTotal: count})
	return err
}

func compactAssistantImages(images []map[string]any) []map[string]any {
	completed := make([]map[string]any, 0, len(images))
	for _, image := range images {
		if image != nil {
			completed = append(completed, image)
		}
	}
	return completed
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
