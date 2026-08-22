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
	"unicode"


	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/prompt"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

const (
	assistantOutputLimit           = 32 << 20
	assistantC2AItemAttempts       = 2
	assistantChatAttempts          = 2
	assistantSynchronousImageLimit = 5 * time.Minute
)

const assistantChatRetryInstruction = `直接回答用户的问题。不要调用、模拟或输出 search 等内部工具调用语法，也不要复述用户提示词。`

var errAssistantLeakedToolOutput = errors.New("上游模型连续返回了无效的内部工具调用，未生成可用回答，请重试或切换模型")

type assistantC2AImageResult struct {
	index   int
	encoded string
	err     error
}

func (w *Worker) recoverAssistantRuns(ctx context.Context) error {
	running, err := store.RequeueExpiredAssistantRuns(ctx, w.St.Pool, time.Now().UTC())
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
			continue
		}
		_ = store.DeleteAssistantRunOutbox(ctx, w.St.Pool, id)
	}
	for _, id := range queued {
		if seen[id] {
			continue
		}
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			log.Printf("recover queued assistant run %s failed: %v", id, err)
			continue
		}
		_ = store.DeleteAssistantRunOutbox(ctx, w.St.Pool, id)
	}
	return w.dispatchAssistantRunOutbox(ctx)
}

func (w *Worker) dispatchAssistantRunOutbox(ctx context.Context) error {
	ids, err := store.ListReadyAssistantRunOutboxIDs(ctx, w.St.Pool, time.Now().UTC(), 200)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			_ = store.RecordAssistantRunOutboxFailure(ctx, w.St.Pool, id, err.Error(), time.Now().UTC().Add(5*time.Second))
			continue
		}
		if err := store.DeleteAssistantRunOutbox(ctx, w.St.Pool, id); err != nil {
			log.Printf("assistant run %s outbox cleanup failed: %v", id, err)
		}
	}
	return nil
}

func (w *Worker) handleDispatchAssistantOutbox(ctx context.Context, _ *asynq.Task) error {
	return w.dispatchAssistantRunOutbox(ctx)
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
	leaseOwner := w.workerID + ":assistant:" + uuid.NewString()
	run, err := w.claimAssistantRun(ctx, runID, leaseOwner)
	if errors.Is(err, errAssistantRoutesExhausted) {
		return w.failQueuedAssistantRun(ctx, runID, "对话模型的可用线路均已失败，请稍后重试或切换模型")
	}
	if err != nil || run == nil {
		return err
	}
	if err := store.BeginAssistantRunAttempt(ctx, w.St.Pool, run); err != nil {
		log.Printf("assistant run %s attempt %d trace start failed: %v", run.ID, run.Attempt, err)
	}
	workCtx, cancelWork := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		w.heartbeatAssistantRunLease(workCtx, run, leaseOwner, cancelWork)
	}()
	err = w.executeAssistantRun(workCtx, run)
	cancelWork()
	<-heartbeatDone
	if err == nil {
		w.finishAssistantRunAttempt(run, "succeeded", "", "")
		return nil
	}
	failoverCtx, cancelFailover := context.WithTimeout(context.Background(), 30*time.Second)
	requeued, failoverErr := w.retryAssistantProviderRoute(failoverCtx, run, err)
	cancelFailover()
	if failoverErr != nil {
		return failoverErr
	}
	if requeued {
		w.finishAssistantRunAttempt(run, "requeued", "provider_route_failed", sanitizeUpstreamMessage(err.Error()))
		log.Printf("assistant run %s switching provider route after %s", run.ID, assistantRouteDescription(run))
		return nil
	}

	current, getErr := store.GetAssistantRun(context.Background(), w.St.Pool, runID)
	if getErr == nil && current != nil {
		if current.Status == "canceled" {
			w.finishAssistantRunAttempt(run, "canceled", "assistant_run_canceled", "")
			_ = w.clearAssistantMessageOutputMetadata(run, "已停止生成", resolvedAssistantMode(run), "stopped",
				assistantMessageMetadata(run, nil, "stopped", ""))
			assistantstream.Publish(context.Background(), w.Stream, runID.String(),
				assistantstream.Event{Done: true, Status: "canceled"})
			return nil
		}
		if current.Status == "failed" {
			code, message := "assistant_run_failed", ""
			if current.ErrorCode != nil {
				code = *current.ErrorCode
			}
			if current.ErrorMessage != nil {
				message = *current.ErrorMessage
			}
			w.finishAssistantRunAttempt(run, "failed", code, message)
			return nil
		}
		if current.Attempt != run.Attempt || current.Status != "running" {
			w.finishAssistantRunAttempt(run, "superseded", "attempt_superseded", "")
			return nil
		}
	}
	message := sanitizeUpstreamMessage(err.Error())
	failureCode := sub2api.FailureCode(err)
	failureCtx, cancelFailure := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelFailure()
	var failed bool
	var failedContent string
	failErr := w.St.Tx(failureCtx, func(tx pgx.Tx) error {
		var err error
		failed, err = assistantbilling.FailTxAttempt(failureCtx, tx, runID, run.Attempt, failureCode, message)
		if err != nil || !failed {
			return err
		}
		if partial, partialErr := store.GetAssistantMessage(failureCtx, tx, run.AssistantMessageID); partialErr != nil {
			return partialErr
		} else if partial != nil && strings.TrimSpace(partial.Content) != "" &&
			strings.TrimSpace(partial.Content) != strings.TrimSpace(message) {
			failedContent = partial.Content
		}
		return w.clearAssistantMessageOutputMetadataTx(failureCtx, tx, run, failedContent,
			resolvedAssistantMode(run), "failed", assistantMessageMetadata(run, nil, "failed", message))
	})
	if failErr != nil {
		return failErr
	}
	if !failed {
		return nil
	}
	w.finishAssistantRunAttempt(run, "failed", failureCode, message)
	if history, histErr := store.GetTaskByIdemKey(failureCtx, w.St.Pool, run.UserID, store.UIDesignAssetHistoryIdempotencyKey(runID)); histErr == nil && history != nil {
		w.publishTaskEvent(failureCtx, history, taskstream.Event{Stage: "failed", Status: "failed", Done: true})
	}
	assistantstream.Publish(context.Background(), w.Stream, runID.String(),
		assistantstream.Event{Done: true, Status: "failed"})
	return nil
}

func (w *Worker) finishAssistantRunAttempt(run *store.AssistantRun, status, code, message string) {
	if w == nil || w.St == nil || run == nil || run.Attempt <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if strings.TrimSpace(message) != "" {
		message = sanitizeUpstreamMessage(message)
	}
	if _, err := store.FinishAssistantRunAttempt(ctx, w.St.Pool, run.ID, run.Attempt,
		status, resolvedAssistantMode(run), code, message); err != nil {
		log.Printf("assistant run %s attempt %d trace finish failed: %v", run.ID, run.Attempt, err)
	}
}

func (w *Worker) heartbeatAssistantRunLease(
	ctx context.Context,
	run *store.AssistantRun,
	owner string,
	cancelWork context.CancelFunc,
) {
	ticker := time.NewTicker(taskHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			ok, err := store.RenewAssistantRunLease(ctx, w.St.Pool, run.ID, run.Attempt, owner, now.UTC(), taskLease)
			if err != nil {
				log.Printf("assistant run %s lease heartbeat failed: %v", run.ID, err)
				continue
			}
			if !ok {
				log.Printf("assistant run %s lease was lost", run.ID)
				cancelWork()
				return
			}
		}
	}
}

func (w *Worker) setAssistantRunStage(ctx context.Context, run *store.AssistantRun, resolvedMode, stage string) error {
	changed, err := store.SetAssistantRunStageAttempt(ctx, w.St.Pool, run.ID, run.Attempt, resolvedMode, stage)
	if err != nil {
		return err
	}
	if !changed {
		return context.Canceled
	}
	return nil
}

func (w *Worker) clearAssistantMessageOutputMetadata(run *store.AssistantRun, content, kind, status string, metadata map[string]any) error {
	if w == nil || w.St == nil || run == nil {
		return errors.New("assistant output cleanup store is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return w.St.Tx(ctx, func(tx pgx.Tx) error {
		return w.clearAssistantMessageOutputMetadataTx(ctx, tx, run, content, kind, status, metadata)
	})
}

func (w *Worker) clearAssistantMessageOutputMetadataTx(ctx context.Context, q store.Q, run *store.AssistantRun, content, kind, status string, metadata map[string]any) error {
	if w == nil || w.St == nil || run == nil {
		return errors.New("assistant output cleanup store is unavailable")
	}
	preserved := make(map[string]any, len(metadata)+1)
	for key, value := range metadata {
		preserved[key] = value
	}
	message, err := store.GetAssistantMessage(ctx, q, run.AssistantMessageID)
	if err != nil {
		return err
	}
	if message != nil {
		if artifacts, ok := message.Metadata["artifacts"]; ok {
			preserved["artifacts"] = artifacts
		}
	}
	return store.ClearAssistantMessageOutputMetadata(ctx, q, run.UserID, run.AssistantMessageID,
		content, kind, status, preserved)
}

func (w *Worker) executeAssistantRun(ctx context.Context, run *store.AssistantRun) error {
	mode := run.Mode
	if mode == "image" && assistantSmallTalk(run.Prompt) {
		mode = "chat"
	}
	references, err := w.loadAssistantReferences(ctx, run.Params)
	if err != nil {
		return err
	}
	if mode != "image" && len(references) > 0 && !isCanvasWorkspaceRun(run) &&
		assistanttools.ImageToPSDRequested(run.Prompt) {
		return errors.New("AI 助手暂未开放 PSD 转换")
	}
	var client *sub2api.Client
	if mode == "agent" {
		selection, configured, selectionErr := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
		if selectionErr != nil {
			return selectionErr
		}
		if configured {
			client, err = w.configuredAssistantChatClient(selection)
		} else {
			client, err = w.assistantClient(ctx)
			if err == nil {
				if requestedModel := assistantParamString(run.Params, "model", ""); requestedModel != "" && requestedModel != client.ImageModel() {
					client = client.WithChatModel(requestedModel)
				}
			}
		}
		if err != nil {
			return err
		}
		client = client.WithMaxOutputTokens(
			assistantParamInt(run.Params, "_chatMaxOutputTokens", assistantDefaultOutputTokens),
		).WithReasoningEffort(assistantParamString(run.Params, "reasoningEffort", ""))
		if assistantArtifactRequested(run.Prompt) && !isCanvasWorkspaceRun(run) {
			run.ResolvedMode = "chat"
			stage := "preparing-context"
			if len(references) > 0 {
				stage = "analyzing-image"
			}
			if err := w.setAssistantRunStage(ctx, run, "chat", stage); err != nil {
				return err
			}
			if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "chat", "running",
				assistantMessageMetadata(run, nil, stage, "")); err != nil {
				return err
			}
			assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: "chat", Stage: stage})
			return w.executeAssistantChat(ctx, client, run, references)
		}
		history, histErr := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
		if histErr != nil {
			// 历史加载失败时退化为仅使用本轮输入，不阻塞本次运行。
			history = nil
		}
		history = assistantMessagesAfterContextBoundary(history)
		if isCanvasWorkspaceRun(run) {
			return w.executeCanvasAgent(ctx, client, run, references, history)
		}
		return w.executeAssistantAgent(ctx, client, run, references, history)
	}
	run.ResolvedMode = mode
	stage := "preparing-context"
	if mode == "image" {
		stage = "generating-image"
	} else if len(references) > 0 {
		stage = "analyzing-image"
	}
	if err := w.setAssistantRunStage(ctx, run, mode, stage); err != nil {
		return err
	}
	metadata := assistantMessageMetadata(run, nil, stage, "")
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", mode, "running", metadata); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: mode, Stage: stage})

	if mode == "image" {
		serviceKey := assistantParamString(run.Params, "serviceKey", "assistant_image")
		selection, configured, configuredErr := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindImage)
		if configuredErr != nil {
			return configuredErr
		}
		if configured {
			return w.executeConfiguredAssistantImage(ctx, run, references, selection)
		}
		provider, providerErr := settings.ImageServiceProvider(ctx, w.St.Pool, serviceKey)
		if providerErr != nil {
			return providerErr
		}
		if provider == "c2a" {
			return w.executeAssistantImageC2A(ctx, run, references, serviceKey)
		}
		if provider == "crun" {
			return w.executeAssistantImageCRUN(ctx, run)
		}
		client, err = w.assistantClient(ctx)
		if err != nil {
			return err
		}
		return w.executeAssistantImage(ctx, client, run, references)
	}
	if client == nil {
		selection, configured, selectionErr := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
		if selectionErr != nil {
			return selectionErr
		}
		if configured {
			client, err = w.configuredAssistantChatClient(selection)
		} else {
			client, err = w.assistantClient(ctx)
			if err == nil {
				if requestedModel := assistantParamString(run.Params, "model", ""); requestedModel != "" && requestedModel != client.ImageModel() {
					client = client.WithChatModel(requestedModel)
				}
			}
		}
		if err != nil {
			return err
		}
	}
	client = client.WithMaxOutputTokens(
		assistantParamInt(run.Params, "_chatMaxOutputTokens", assistantDefaultOutputTokens),
	).WithReasoningEffort(assistantParamString(run.Params, "reasoningEffort", ""))
	return w.executeAssistantChat(ctx, client, run, references)
}

func (w *Worker) configuredAssistantModelSelection(ctx context.Context, run *store.AssistantRun, kind string) (*modelconfig.Selection, bool, error) {
	prefix := "_chat"
	if kind == modelconfig.ModelKindImage {
		prefix = "_image"
	}
	providerID := assistantParamString(run.Params, prefix+"ProviderConfigId", "")
	modelID := assistantParamString(run.Params, prefix+"ModelConfigId", "")
	if kind == modelconfig.ModelKindImage && (providerID == "" || modelID == "") {
		providerID = assistantParamString(run.Params, "_providerConfigId", "")
		modelID = assistantParamString(run.Params, "_modelConfigId", "")
	}
	if providerID == "" || modelID == "" {
		return nil, false, nil
	}
	cfg, err := modelconfig.Runtime(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		return nil, false, err
	}
	routeID := assistantParamString(run.Params, prefix+"ProviderRouteId", "")
	selection, found := modelconfig.FindExecutionRoute(cfg, providerID, modelID, routeID)
	if !found {
		return nil, false, errors.New("助手任务绑定的模型或服务商配置已失效")
	}
	if selection.Model.Kind != kind {
		return nil, false, errors.New("助手任务绑定的模型类型无效")
	}
	return selection, true, nil
}

func (w *Worker) configuredAssistantChatClient(selection *modelconfig.Selection) (*sub2api.Client, error) {
	provider := selection.Provider
	if strings.TrimSpace(provider.APIKey) == "" {
		return nil, errors.New("对话模型服务商没有可用的 API Key")
	}
	client, err := sub2api.New(
		provider.BaseURL, provider.APIKey, selection.Model.UpstreamModel,
		w.Cfg.Sub2APIImageModel, provider.TimeoutSecs,
	)
	if err != nil {
		return nil, err
	}
	if provider.Adapter == modelconfig.AdapterCRUN {
		client = client.WithAPIKeyHeader("x-api-key")
	}
	return client, nil
}

func (w *Worker) executeConfiguredAssistantImage(ctx context.Context, run *store.AssistantRun, references []string, selection *modelconfig.Selection) error {
	provider := selection.Provider
	model := selection.Model.UpstreamModel
	if strings.TrimSpace(provider.APIKey) == "" {
		return errors.New("模型服务商没有可用的 API Key")
	}
	switch provider.Adapter {
	case modelconfig.AdapterOpenAI:
		client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, provider.TimeoutSecs, w.Cfg.AppEnv == "development")
		return w.executeAssistantImageC2AClient(ctx, run, references, client, model)
	case modelconfig.AdapterCRUN:
		client, err := crun.New(provider.BaseURL, provider.APIKey, model, provider.TimeoutSecs)
		if err != nil {
			return err
		}
		return w.executeAssistantImageCRUNClient(ctx, run, client)
	default:
		return errors.New("不支持的模型服务商类型")
	}
}

const (
	assistantIntentHistoryTurns  = 8    // 送入路由器的历史消息条数上限
	assistantIntentLineRunes     = 160  // 每行摘要的最大字符数
	assistantIntentSummaryRunes  = 80   // 图片消息提示词摘要的最大字符数
	assistantIntentMaxRunes      = 2000 // 整个对话摘要的最大字符数
	assistantIntentShortPromptRn = 30   // 判定“延续上一张图”时的短指令阈值
	assistantIntentTimeout       = 8 * time.Second
	assistantProposalTimeout     = 15 * time.Second
)

// assistantSmallTalkPattern matches greetings that must never launch image generation.
var assistantSmallTalkPattern = regexp.MustCompile(`(?i)^(你好|您好|嗨+|哈喽|在吗|在么|hello|hi+|hey|thanks?|thank you|谢谢(你|您)?(了)?|早上好|早安|晚上好|你是谁|你能做什么|在不在)[呀啊呢吧嘛]*[\s!！。.?？]*$`)

// assistantIntentTokenPattern 匹配回复中首个 IMAGE 或 CHAT 单词（先出现者优先）。
var assistantIntentTokenPattern = regexp.MustCompile(`\b(IMAGE|CHAT)\b`)

// assistantContinuationPattern 匹配紧跟在生成图片之后的延续/修改类短指令。
var assistantContinuationPattern = regexp.MustCompile(`再来|再生成|再画|多来|换成|改成|变成|调整|加上|去掉|移除|放大|缩小|更[亮暗大小]|颜色|背景|风格|第[一二三四12345]张|another|again|more|make it|change`)

// assistantNegatedImageActionPattern removes explicit "do not generate/edit"
// clauses before positive intent matching, so a negated verb cannot force a tool call.
var assistantNegatedImageActionPattern = regexp.MustCompile(`(?i)(不要|别|无需|不需要|不用|禁止|勿)\s*(再\s*)?(生成|画|绘制|制作|创建|设计|修改|编辑|重绘|去背景|抠图|擦除|移除|替换|添加|扩图|上色)|\b(do not|don't|dont|no need to)\s+(generate|draw|create|edit|redraw|remove|replace)\b`)

func assistantSmallTalk(prompt string) bool {
	text := strings.TrimSpace(prompt)
	if text == "" || len([]rune(text)) > 16 {
		return false
	}
	return assistantSmallTalkPattern.MatchString(text)
}

func (w *Worker) classifyAssistantRun(ctx context.Context, client *sub2api.Client, transcript, prompt string, hasReference, lastAssistantWasImage bool) string {
	if intent, certain := fastAssistantIntent(prompt, hasReference, lastAssistantWasImage); certain {
		return intent
	}
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
	intentCtx, cancel := context.WithTimeout(ctx, assistantIntentTimeout)
	defer cancel()
	result, err := client.ChatTextWithImages(intentCtx, []sub2api.Message{
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
	if intent, certain := fastAssistantIntent(prompt, hasReference, lastAssistantWasImage); certain {
		return intent
	}
	return "chat"
}

func fastAssistantIntent(prompt string, hasReference bool, lastAssistantWasImage bool) (string, bool) {
	if assistantSmallTalk(prompt) {
		return "chat", true
	}
	text := strings.ToLower(prompt)
	positiveText := assistantNegatedImageActionPattern.ReplaceAllString(text, "")
	hasNegatedImageAction := positiveText != text
	understanding := []string{"识别", "读取", "提取", "描述", "分析", "总结", "翻译", "解释", "是什么", "ocr", "read", "describe", "translate"}
	// 理解类动词优先：即使上一轮刚生成图片，也应走对话回答
	if (hasReference || lastAssistantWasImage) && containsAssistantTerm(text, understanding) {
		return "chat", true
	}
	// 上一轮刚生成图片时，短促的延续/修改指令视为继续生图
	if lastAssistantWasImage && len([]rune(strings.TrimSpace(prompt))) <= assistantIntentShortPromptRn &&
		assistantContinuationPattern.MatchString(positiveText) {
		return "image", true
	}
	mutations := []string{"修改", "编辑", "重绘", "背景", "换成", "改成", "去背景", "抠图", "擦除", "移除", "替换", "添加", "扩图", "上色", "edit", "redraw", "remove", "replace"}
	if hasReference && containsAssistantTerm(positiveText, mutations) {
		return "image", true
	}
	actions := []string{"生成", "画", "绘制", "制作", "创建", "设计", "generate", "draw", "create"}
	images := []string{"图", "照片", "人像", "海报", "插画", "头像", "壁纸", "封面", "logo", "image", "picture", "photo", "portrait", "poster"}
	if containsAssistantTerm(positiveText, actions) && containsAssistantTerm(positiveText, images) {
		return "image", true
	}
	if hasNegatedImageAction {
		return "chat", true
	}
	return "", false
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

func assistantMessagesAfterContextBoundary(messages []*store.AssistantMessage) []*store.AssistantMessage {
	boundary := -1
	for index, message := range messages {
		if message == nil {
			continue
		}
		isDivider, _ := message.Metadata["contextDivider"].(bool)
		if message.Kind == "context-divider" || isDivider {
			boundary = index
		}
	}
	if boundary < 0 {
		return messages
	}
	return messages[boundary+1:]
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

type assistantImageProposal struct {
	Action             string           `json:"action"`
	Prompt             string           `json:"prompt"`
	Reason             string           `json:"reason"`
	PlanningSummary    string           `json:"planningSummary"`
	Ratio              string           `json:"ratio"`
	Resolution         string           `json:"resolution"`
	Count              int              `json:"count"`
	Quality            string           `json:"quality"`
	Model              string           `json:"model"`
	ModelName          string           `json:"modelName"`
	RequestSize        string           `json:"requestSize"`
	Width              int              `json:"width"`
	Height             int              `json:"height"`
	ReferenceImages    []map[string]any `json:"referenceImages"`
	ReferencedImageIDs []string         `json:"referencedImageIds"`
}

type assistantCatalogImage struct {
	ID          string
	Label       string
	Description string
	Image       map[string]any
}

func assistantProposalFunctionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "propose_image_action",
		Description: "用户明确希望生成或编辑图片时，提交一份可确认、可修改的图片方案。纯对话不要调用。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"action":             map[string]any{"type": "string", "enum": []string{"generate", "edit"}},
				"prompt":             map[string]any{"type": "string", "description": "可直接交给图片模型的完整中文提示词；参考图使用图1、图2指代"},
				"reason":             map[string]any{"type": "string", "description": "一句话说明方案依据"},
				"planningSummary":    map[string]any{"type": "string", "description": "面向用户的一句简短方案摘要"},
				"ratio":              map[string]any{"type": "string", "enum": []string{"auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"}},
				"resolution":         map[string]any{"type": "string", "enum": []string{"1K", "2K", "4K"}},
				"count":              map[string]any{"type": "integer", "minimum": 1, "maximum": 4},
				"quality":            map[string]any{"type": "string", "enum": []string{"low", "medium", "high"}},
				"model":              map[string]any{"type": "string", "description": "当前可用图片模型目录中的 id"},
				"referencedImageIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			},
			"required":             []string{"action", "prompt", "reason", "planningSummary", "ratio", "resolution", "count", "quality", "model", "referencedImageIds"},
			"additionalProperties": false,
		},
	}
}

func assistantAgentInstructions(run *store.AssistantRun, catalog []assistantCatalogImage, models []map[string]any) string {
	instructions := `你是图片创作 Agent，全程使用简体中文，思考过程也使用简体中文。
直接在一次响应中完成判断：
- 纯聊天、分析、解释或需求不明确时，立即自然回答；需要澄清时直接提问，不调用工具。
- 用户明确要生成新图或编辑已有图片时，可以先给一句简短说明，然后调用 propose_image_action；工具调用成功后不要再输出 JSON 或重复提示词。
- 如果当前上游不支持工具调用，无法调用 propose_image_action，则只输出一个与该工具参数完全同结构的 JSON 对象，不要 Markdown、代码块或额外文字。
- 编辑图片时 referencedImageIds 必须来自图片目录；提示词用“图1、图2”指代参考图，不臆造参考图内容。
- 用户明确要求几张图时必须原样写入 count；未指定时使用当前默认数量。
- 参数只从工具允许值和模型目录选择，系统还会按模型能力做最终校验。`
	instructions += fmt.Sprintf("\n\n当前默认参数：比例=%s，分辨率=%s，数量=%d，质量=%s，图片模型=%s。",
		assistantParamString(run.Params, "ratio", "auto"),
		assistantParamString(run.Params, "resolution", "1K"),
		assistantParamInt(run.Params, "count", 1),
		assistantParamString(run.Params, "quality", "high"),
		assistantParamString(run.Params, "_imageModelConfigId", ""),
	)
	if catalogText := renderAssistantImageCatalog(catalog); catalogText != "" {
		instructions += "\n\n当前可用图片目录：\n" + catalogText
	} else {
		instructions += "\n\n当前可用图片目录：空"
	}
	if modelText := renderAssistantModelCatalog(models); modelText != "" {
		instructions += "\n\n当前可用图片模型：\n" + modelText
	}
	return instructions
}

func (w *Worker) executeAssistantAgent(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	references []string,
	history []*store.AssistantMessage,
) error {
	run.ResolvedMode = "agent"
	imageCatalog := buildAssistantImageCatalog(history, run.AssistantMessageID)
	modelCatalog := assistantProposalModelCatalog(run.Params)
	nextStage := "thinking"
	if len(references) > 0 {
		nextStage = "analyzing-image"
	}
	payload, _, err := w.prepareAssistantContext(ctx, run, "agent",
		assistantAgentInstructions(run, imageCatalog, modelCatalog), history, references, false, nextStage)
	if err != nil {
		return err
	}

	lastCheckpoint := time.Now()
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	answering := false
	started := time.Now()
	var firstVisible time.Time
	lastWasImage := lastAssistantMessageWasImage(history, run.UserMessageID, run.AssistantMessageID)
	fastIntent, fastIntentCertain := fastAssistantIntent(run.Prompt, len(references) > 0, lastWasImage)
	forceProposalTool := fastIntentCertain && fastIntent == "image"
	suppressProposalTool := fastIntentCertain && fastIntent == "chat"
	result, err := client.ChatAgentWithImages(ctx, payload, nil, assistantProposalFunctionTool(), forceProposalTool, func(fullText, reasoning string) error {
		markAssistantFirstToken(&firstVisible, fullText)
		markAssistantFirstToken(&firstVisible, reasoning)
		if time.Since(lastTerminationCheck) >= 400*time.Millisecond {
			lastTerminationCheck = time.Now()
			if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
				if err != nil {
					return err
				}
				return context.Canceled
			}
		}
		if !answering {
			if err := w.setAssistantRunStage(ctx, run, "agent", "answering"); err != nil {
				return err
			}
			answering = true
		}
		visibleText := fullText
		if forceProposalTool {
			visibleText = ""
		}
		if (visibleText != "" || reasoning != "") && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: visibleText, Reasoning: reasoning, Kind: "agent", Stage: "answering"})
		}
		if forceProposalTool || fullText == "" || time.Since(lastCheckpoint) < time.Second {
			return nil
		}
		lastCheckpoint = time.Now()
		metadata := assistantMessageMetadata(run, nil, "answering", "")
		attachAssistantReasoning(metadata, reasoning)
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, fullText, "agent", "running", metadata)
	})
	if err != nil {
		return &assistantProviderError{err: err, outputStarted: result.Text != "" || result.Reasoning != "" || result.ToolCall != nil}
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}

	tool := assistantProposalFunctionTool()
	if forceProposalTool || (!suppressProposalTool && result.ToolCall != nil && result.ToolCall.Name == tool.Name) {
		proposal := defaultAssistantProposal(run)
		parsedTextFallback := false
		if result.ToolCall != nil && result.ToolCall.Name == tool.Name {
			parsed, parseErr := parseAssistantProposal(result.ToolCall.Arguments)
			if parseErr != nil {
				return fmt.Errorf("解析 Agent 图片方案失败: %w", parseErr)
			}
			proposal = parsed
		} else if parsed, parseErr := parseAssistantProposal(result.Text); parseErr == nil {
			proposal = parsed
			parsedTextFallback = true
		} else {
			if refinedPrompt, ok := assistantProposalPromptFromAgentText(result.Text); ok {
				proposal.Prompt = refinedPrompt
			}
			proposal.Reason = "已根据你的要求整理可编辑的图片创作方案。"
			proposal.PlanningSummary = fmt.Sprintf("已整理 %d 张图片的生成方案。", proposal.Count)
		}
		proposal = normalizeAssistantProposalWithModels(proposal, run, modelCatalog)
		proposal = attachAssistantProposalReferences(proposal, run, imageCatalog, modelCatalog)
		content := strings.TrimSpace(result.Text)
		if parsedTextFallback {
			content = "图片创作方案已准备，可以调整后开始生成。"
		}
		if content == "" {
			content = "图片创作方案已准备，可以调整后开始生成。"
		}
		metadata := assistantMessageMetadata(run, nil, "complete", "")
		attachAssistantUsage(metadata, finalizeAssistantUsage(result.Usage, started, firstVisible, run, content))
		metadata["proposal"] = proposal
		if strings.TrimSpace(result.Text) != "" && !parsedTextFallback {
			metadata["agentAnalysis"] = result.Text
		}
		if strings.TrimSpace(result.Reasoning) != "" {
			metadata["reasoning"] = result.Reasoning
		}
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "proposal", "complete", metadata); err != nil {
			return err
		}
		completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "proposal")
		if err != nil {
			return err
		}
		if !completed {
			return context.Canceled
		}
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Content: content, Reasoning: result.Reasoning, Kind: "proposal", Stage: "complete", Done: true, Status: "succeeded",
			Usage: finalizeAssistantUsage(result.Usage, started, firstVisible, run, content).Map(),
		})
		return nil
	}

	text := strings.TrimSpace(result.Text)
	if text == "" {
		text = "没有收到模型回复，请重试。"
	}
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	attachAssistantUsage(metadata, finalizeAssistantUsage(result.Usage, started, firstVisible, run, text))
	if strings.TrimSpace(result.Reasoning) != "" {
		metadata["reasoning"] = result.Reasoning
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, "chat", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "chat")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Content: text, Reasoning: result.Reasoning, Kind: "chat", Stage: "complete", Done: true, Status: "succeeded",
		Usage: finalizeAssistantUsage(result.Usage, started, firstVisible, run, text).Map(),
	})
	return nil
}

func (w *Worker) executeAssistantProposal(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string, history []*store.AssistantMessage) error {
	transcript := buildAssistantIntentTranscript(history, run.UserMessageID, run.AssistantMessageID, run.Prompt)
	imageCatalog := buildAssistantImageCatalog(history, run.UserMessageID, run.AssistantMessageID)
	modelCatalog := assistantProposalModelCatalog(run.Params)
	system := `你是图像创作 Agent 的方案规划器。根据对话整理一份可直接执行的图片生成或编辑方案。
只输出一个 JSON 对象，不要 Markdown、代码块或解释。字段必须包含：
action（generate 或 edit）、prompt、reason、planningSummary、ratio、resolution、count、quality、model、referencedImageIds。
prompt 使用简体中文，完整描述目标画面和修改要求；有参考图时用“图1、图2”指代，不要臆造参考图内容。
ratio 使用 auto、1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、9:21、21:9 之一。
resolution 使用 1K、2K、4K 之一；count 为 1 到 4；quality 使用 low、medium、high 之一。
reason 用一句话说明方案如何响应用户需求；planningSummary 用一句面向用户的简短规划摘要，不要输出思维过程。
model 必须从模型目录选择；referencedImageIds 只填写图片目录中的 id，没有历史引用时返回空数组。`
	if catalogText := renderAssistantImageCatalog(imageCatalog); catalogText != "" {
		system += "\n\n当前对话图片目录（序号从旧到新，可用于理解‘上一张/第二张/图1’）：\n" + catalogText
	}
	if modelText := renderAssistantModelCatalog(modelCatalog); modelText != "" {
		system += "\n\n可用图片模型目录：\n" + modelText
	}
	payload := []sub2api.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: transcript, ReferenceImages: references},
	}
	planningCtx, cancel := context.WithTimeout(ctx, assistantProposalTimeout)
	defer cancel()
	started := time.Now()
	completion, err := client.CompleteChatTextWithImages(planningCtx, payload, nil, nil)
	raw := completion.Text
	proposal := defaultAssistantProposal(run)
	if err == nil {
		if parsed, parseErr := parseAssistantProposal(raw); parseErr == nil {
			proposal = normalizeAssistantProposalWithModels(parsed, run, modelCatalog)
		}
	}
	proposal = attachAssistantProposalReferences(proposal, run, imageCatalog, modelCatalog)
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	metadata["proposal"] = proposal
	content := "我整理了一份图片创作方案，你可以调整后再开始生成。"
	usage := finalizeAssistantUsage(completion.Usage, started, time.Time{}, run, content)
	attachAssistantUsage(metadata, usage)
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "proposal", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "proposal")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Kind: "proposal", Done: true, Status: "succeeded", Usage: usage.Map()})
	return nil
}

func defaultAssistantProposal(run *store.AssistantRun) assistantImageProposal {
	action := "generate"
	if len(assistantProposalReferences(run.Params)) > 0 {
		action = "edit"
	}
	return assistantImageProposal{
		Action: action, Prompt: strings.TrimSpace(run.Prompt),
		Reason:          "已根据当前对话整理生成目标和可调整参数。",
		PlanningSummary: "已结合当前对话、历史图片和可用模型整理执行方案。",
		Ratio:           assistantParamString(run.Params, "ratio", "auto"),
		Resolution:      assistantParamString(run.Params, "resolution", "1K"),
		Count:           assistantParamInt(run.Params, "count", 1),
		Quality:         assistantParamString(run.Params, "quality", "high"),
		Model:           assistantParamString(run.Params, "_imageModelConfigId", ""),
		ModelName:       assistantParamString(run.Params, "_imageModelDisplayName", "默认图片模型"),
		RequestSize:     assistantParamString(run.Params, "requestSize", "auto"),
		Width:           assistantParamInt(run.Params, "width", 0), Height: assistantParamInt(run.Params, "height", 0),
	}
}

// assistantProposalPromptFromAgentText preserves a useful plan returned by
// gateways that ignore tool calls. It removes confirmation/control text and
// keeps only the visual brief that can be sent directly to an image model.
func assistantProposalPromptFromAgentText(raw string) (string, bool) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	if raw == "" || (!strings.Contains(raw, "画面设定") && !strings.Contains(raw, "元素限制")) {
		return "", false
	}
	lines := strings.Split(raw, "\n")
	visualBrief := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(strings.ReplaceAll(line, "**", ""))
		if line == "" {
			continue
		}
		compact := strings.ReplaceAll(line, " ", "")
		if strings.HasPrefix(compact, "默认参数") || strings.Contains(compact, "等待确认") {
			break
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "-"))
		compact = strings.ReplaceAll(line, " ", "")
		if strings.HasPrefix(compact, "方案确认") || strings.HasPrefix(compact, "数量：") {
			continue
		}
		if line != "" {
			visualBrief = append(visualBrief, line)
		}
	}
	if len(visualBrief) < 3 {
		return "", false
	}
	return truncateAssistantRunes(strings.Join(visualBrief, "\n"), 6000), true
}

func parseAssistantProposal(raw string) (assistantImageProposal, error) {
	raw = strings.TrimSpace(raw)
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return assistantImageProposal{}, errors.New("proposal JSON not found")
	}
	var proposal assistantImageProposal
	if err := json.Unmarshal([]byte(raw[start:end+1]), &proposal); err != nil {
		return assistantImageProposal{}, err
	}
	if strings.TrimSpace(proposal.Prompt) == "" {
		return assistantImageProposal{}, errors.New("proposal prompt is empty")
	}
	return proposal, nil
}

func normalizeAssistantProposal(proposal assistantImageProposal, run *store.AssistantRun) assistantImageProposal {
	return normalizeAssistantProposalWithModels(proposal, run, nil)
}

func normalizeAssistantProposalWithModels(proposal assistantImageProposal, run *store.AssistantRun, models []map[string]any) assistantImageProposal {
	fallback := defaultAssistantProposal(run)
	proposal.Prompt = strings.TrimSpace(proposal.Prompt)
	proposal.Reason = strings.TrimSpace(proposal.Reason)
	if proposal.Reason == "" {
		proposal.Reason = fallback.Reason
	}
	proposal.PlanningSummary = strings.TrimSpace(proposal.PlanningSummary)
	if proposal.PlanningSummary == "" {
		proposal.PlanningSummary = proposal.Reason
	}
	proposal.PlanningSummary = truncateAssistantRunes(proposal.PlanningSummary, 220)
	if proposal.Action != "edit" && proposal.Action != "generate" {
		proposal.Action = fallback.Action
	}
	selectedModel := assistantProposalModel(proposal.Model, models)
	allowedRatios := assistantMapStrings(selectedModel, "aspectRatios")
	if len(allowedRatios) == 0 {
		allowedRatios = assistantParamStrings(run.Params, "_modelAspectRatios")
	}
	if len(allowedRatios) == 0 {
		allowedRatios = []string{"auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"}
	}
	if value, ok := assistantAllowedValue(allowedRatios, proposal.Ratio); ok {
		proposal.Ratio = value
	} else if value, ok := assistantAllowedValue(allowedRatios, fallback.Ratio); ok {
		proposal.Ratio = value
	} else {
		proposal.Ratio = allowedRatios[0]
	}
	allowedResolutions := assistantMapStrings(selectedModel, "resolutions")
	if len(allowedResolutions) == 0 {
		allowedResolutions = assistantParamStrings(run.Params, "_modelResolutions")
	}
	if len(allowedResolutions) > 0 {
		if value, ok := assistantAllowedValue(allowedResolutions, proposal.Resolution); ok {
			proposal.Resolution = value
		} else if value, ok := assistantAllowedValue(allowedResolutions, fallback.Resolution); ok {
			proposal.Resolution = value
		} else {
			proposal.Resolution = allowedResolutions[0]
		}
	}
	if proposal.Resolution == "" {
		proposal.Resolution = fallback.Resolution
	}
	if proposal.Count < 1 || proposal.Count > assistantProposalMaxImages(proposal.Model, models) {
		proposal.Count = fallback.Count
	}
	allowedQualities := assistantMapStrings(selectedModel, "qualities")
	if len(allowedQualities) == 0 {
		allowedQualities = assistantParamStrings(run.Params, "_modelQualities")
	}
	if len(allowedQualities) == 0 {
		allowedQualities = []string{"low", "medium", "high"}
	}
	if value, ok := assistantAllowedValue(allowedQualities, proposal.Quality); ok {
		proposal.Quality = value
	} else if value, ok := assistantAllowedValue(allowedQualities, fallback.Quality); ok {
		proposal.Quality = value
	} else {
		proposal.Quality = allowedQualities[0]
	}
	if selectedModel != nil {
		proposal.Model = assistantMapString(selectedModel, "id")
		proposal.ModelName = assistantMapString(selectedModel, "name")
	} else {
		proposal.Model = fallback.Model
		proposal.ModelName = fallback.ModelName
	}
	proposal.RequestSize = fallback.RequestSize
	proposal.Width = fallback.Width
	proposal.Height = fallback.Height
	return proposal
}

func assistantProposalReferences(params map[string]any) []map[string]any {
	items, _ := params["referenceImages"].([]any)
	if typed, ok := params["referenceImages"].([]map[string]any); ok {
		return append([]map[string]any(nil), typed...)
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func assistantProposalModelCatalog(params map[string]any) []map[string]any {
	if typed, ok := params["_imageModelCatalog"].([]map[string]any); ok {
		return typed
	}
	items, _ := params["_imageModelCatalog"].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func assistantProposalModel(id string, models []map[string]any) map[string]any {
	for _, model := range models {
		if assistantMapString(model, "id") == strings.TrimSpace(id) {
			return model
		}
	}
	return nil
}

func assistantProposalMaxReferences(modelID string, models []map[string]any) int {
	limit := 4
	if model := assistantProposalModel(modelID, models); model != nil {
		if value := assistantMapInt(model, "maxReferenceImages"); value > 0 {
			limit = value
		}
	}
	return limit
}

func assistantProposalMaxImages(modelID string, models []map[string]any) int {
	limit := 4
	if model := assistantProposalModel(modelID, models); model != nil {
		if value := assistantMapInt(model, "maxImages"); value > 0 {
			limit = value
		}
	}
	return limit
}

func buildAssistantImageCatalog(history []*store.AssistantMessage, excluded ...uuid.UUID) []assistantCatalogImage {
	skip := make(map[uuid.UUID]bool, len(excluded))
	for _, id := range excluded {
		skip[id] = true
	}
	out := make([]assistantCatalogImage, 0)
	seen := map[string]bool{}
	for _, message := range history {
		if message == nil || skip[message.ID] || message.Status == "failed" {
			continue
		}
		fields := []string{"referenceImages"}
		if message.Role == "assistant" {
			fields = append(fields, "images")
		}
		for _, field := range fields {
			for index, image := range assistantMetadataImages(message.Metadata, field) {
				key := assistantMapString(image, "id")
				if key == "" {
					key = assistantMapString(image, "fileKey")
				}
				if key == "" {
					key = assistantMapString(image, "dataUrl")
				}
				if key == "" || seen[key] {
					continue
				}
				seen[key] = true
				copyImage := make(map[string]any, len(image)+1)
				for k, v := range image {
					copyImage[k] = v
				}
				id := assistantMapString(copyImage, "id")
				if id == "" {
					id = fmt.Sprintf("%s-%s-%d", message.ID, field, index+1)
					copyImage["id"] = id
				}
				description := assistantMapString(copyImage, "revisedPrompt")
				if description == "" {
					description = assistantMapString(message.Metadata, "prompt")
				}
				if description == "" {
					description = assistantMapString(copyImage, "name")
				}
				if description == "" {
					description = strings.TrimSpace(message.Content)
				}
				out = append(out, assistantCatalogImage{ID: id, Label: fmt.Sprintf("图%d", len(out)+1), Description: truncateAssistantRunes(description, 120), Image: copyImage})
			}
		}
	}
	return out
}

func assistantMetadataImages(metadata map[string]any, field string) []map[string]any {
	if typed, ok := metadata[field].([]map[string]any); ok {
		return typed
	}
	items, _ := metadata[field].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func renderAssistantImageCatalog(catalog []assistantCatalogImage) string {
	lines := make([]string, 0, len(catalog))
	for _, item := range catalog {
		lines = append(lines, fmt.Sprintf("- %s id=%s：%s", item.Label, item.ID, item.Description))
	}
	return strings.Join(lines, "\n")
}

func renderAssistantModelCatalog(models []map[string]any) string {
	lines := make([]string, 0, len(models))
	for _, model := range models {
		lines = append(lines, fmt.Sprintf("- id=%s，名称=%s，说明=%s，分辨率=%s，最多参考图=%d", assistantMapString(model, "id"), assistantMapString(model, "name"), assistantMapString(model, "description"), strings.Join(assistantMapStrings(model, "resolutions"), "/"), assistantMapInt(model, "maxReferenceImages")))
	}
	return strings.Join(lines, "\n")
}

func attachAssistantProposalReferences(proposal assistantImageProposal, run *store.AssistantRun, imageCatalog []assistantCatalogImage, modelCatalog []map[string]any) assistantImageProposal {
	currentReferences := assistantProposalReferences(run.Params)
	historicalReferences := resolveAssistantProposalReferences(proposal.ReferencedImageIDs, imageCatalog, run.Prompt)
	if len(currentReferences) > 0 {
		historicalReferences = nil
	}
	proposal.ReferenceImages = mergeAssistantProposalReferences(
		currentReferences, historicalReferences, assistantProposalMaxReferences(proposal.Model, modelCatalog),
	)
	proposal.ReferencedImageIDs = assistantReferenceIDs(proposal.ReferenceImages)
	return proposal
}

func resolveAssistantProposalReferences(ids []string, catalog []assistantCatalogImage, prompt string) []map[string]any {
	byID := map[string]map[string]any{}
	for _, item := range catalog {
		byID[item.ID] = item.Image
	}
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		if image := byID[strings.TrimSpace(id)]; image != nil {
			out = append(out, image)
		}
	}
	if len(out) == 0 && len(catalog) > 0 && regexp.MustCompile(`上一张|最后一张|刚才那张|previous|last image`).MatchString(strings.ToLower(prompt)) {
		out = append(out, catalog[len(catalog)-1].Image)
	}
	if len(out) == 0 && len(catalog) > 0 {
		if match := regexp.MustCompile(`(?:第|图\s*)([1-9])张?`).FindStringSubmatch(prompt); len(match) == 2 {
			index := int(match[1][0] - '1')
			if index >= 0 && index < len(catalog) {
				out = append(out, catalog[index].Image)
			}
		}
		if match := regexp.MustCompile(`第?([一二三四五六七八九])张|图([一二三四五六七八九])`).FindStringSubmatch(prompt); len(match) == 3 {
			value := match[1]
			if value == "" {
				value = match[2]
			}
			index := map[string]int{"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "七": 6, "八": 7, "九": 8}[value]
			if index >= 0 && index < len(catalog) {
				out = append(out, catalog[index].Image)
			}
		}
	}
	return out
}

func mergeAssistantProposalReferences(groups ...any) []map[string]any {
	limit := 4
	if len(groups) > 0 {
		if value, ok := groups[len(groups)-1].(int); ok {
			limit = value
			groups = groups[:len(groups)-1]
		}
	}
	out := make([]map[string]any, 0, limit)
	seen := map[string]bool{}
	for _, group := range groups {
		images, _ := group.([]map[string]any)
		for _, image := range images {
			key := assistantMapString(image, "id")
			if key == "" {
				key = assistantMapString(image, "fileKey")
			}
			if key == "" {
				key = assistantMapString(image, "dataUrl")
			}
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, image)
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}

func assistantReferenceIDs(images []map[string]any) []string {
	out := make([]string, 0, len(images))
	for _, image := range images {
		if id := assistantMapString(image, "id"); id != "" {
			out = append(out, id)
		}
	}
	return out
}

func assistantMapStrings(item map[string]any, key string) []string {
	if item == nil {
		return nil
	}
	if typed, ok := item[key].([]string); ok {
		return typed
	}
	values, _ := item[key].([]any)
	out := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, text)
		}
	}
	return out
}
func assistantMapInt(item map[string]any, key string) int {
	if item == nil {
		return 0
	}
	switch value := item[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	}
	return 0
}

func assistantParamStrings(params map[string]any, key string) []string {
	items, _ := params[key].([]any)
	if typed, ok := params[key].([]string); ok {
		return typed
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if value, ok := item.(string); ok && strings.TrimSpace(value) != "" {
			out = append(out, value)
		}
	}
	return out
}

func assistantAllowedValue(values []string, value string) (string, bool) {
	for _, candidate := range values {
		if strings.EqualFold(strings.TrimSpace(candidate), strings.TrimSpace(value)) {
			return candidate, true
		}
	}
	return "", false
}

type assistantChatTextClient interface {
	CompleteChatTextWithImages(context.Context, []sub2api.Message, []string, func(string, string) error) (sub2api.ChatCompletion, error)
}

func parseLeadingAssistantSearchInvocation(text string) (argument, suffix string, complete bool) {
	trimmed := strings.TrimLeftFunc(text, unicode.IsSpace)
	const prefix = "search("
	if !strings.HasPrefix(trimmed, prefix) {
		return "", "", false
	}

	input := trimmed[len(prefix):]
	decoder := json.NewDecoder(strings.NewReader(input))
	if err := decoder.Decode(&argument); err != nil {
		return "", "", false
	}
	consumed := int(decoder.InputOffset())
	remainder := input[consumed:]
	closeOffset := len(remainder) - len(strings.TrimLeftFunc(remainder, unicode.IsSpace))
	if closeOffset >= len(remainder) || remainder[closeOffset] != ')' {
		return "", "", false
	}
	return argument, remainder[closeOffset+1:], true
}

func assistantLeakedSearchMatchesPrompt(argument, prompt string) bool {
	argument = strings.TrimSpace(argument)
	prompt = strings.TrimSpace(prompt)
	if argument == "" || prompt == "" || !strings.HasPrefix(strings.ToLower(argument), "user:") {
		return false
	}
	if argument == prompt {
		return true
	}
	return strings.TrimSpace(argument[len("user:"):]) == prompt
}

func cleanAssistantChatOutput(text, prompt string) (string, bool) {
	argument, suffix, complete := parseLeadingAssistantSearchInvocation(text)
	if !complete || !assistantLeakedSearchMatchesPrompt(argument, prompt) {
		return text, false
	}
	return strings.TrimLeftFunc(suffix, unicode.IsSpace), true
}

func visibleAssistantChatOutput(text, prompt string) (string, bool) {
	if cleaned, leaked := cleanAssistantChatOutput(text, prompt); leaked {
		return cleaned, strings.TrimSpace(cleaned) == ""
	}
	trimmed := strings.TrimLeftFunc(text, unicode.IsSpace)
	if strings.HasPrefix("search(", trimmed) || strings.HasPrefix(trimmed, "search(") {
		if _, _, complete := parseLeadingAssistantSearchInvocation(text); !complete {
			return "", true
		}
	}
	return text, false
}

func requestAssistantChatText(
	ctx context.Context,
	client assistantChatTextClient,
	payload []sub2api.Message,
	prompt string,
	onText func(string, string) error,
	onLeak func(attempt int, hasUsableSuffix bool),
) (string, sub2api.ChatUsage, error) {
	requestPayload := payload
	for attempt := 0; attempt < assistantChatAttempts; attempt++ {
		result, err := client.CompleteChatTextWithImages(ctx, requestPayload, nil, func(fullText, reasoning string) error {
			visible, hold := visibleAssistantChatOutput(fullText, prompt)
			if hold || onText == nil {
				return nil
			}
			return onText(visible, reasoning)
		})
		if err != nil {
			return result.Text, result.Usage, err
		}
		cleaned, leaked := cleanAssistantChatOutput(result.Text, prompt)
		if leaked && onLeak != nil {
			onLeak(attempt+1, strings.TrimSpace(cleaned) != "")
		}
		if !leaked || strings.TrimSpace(cleaned) != "" {
			if onText != nil && strings.TrimSpace(result.Reasoning) != "" {
				_ = onText(cleaned, result.Reasoning)
			}
			return cleaned, result.Usage, nil
		}
		if attempt == assistantChatAttempts-1 {
			return "", result.Usage, errAssistantLeakedToolOutput
		}
		requestPayload = make([]sub2api.Message, 0, len(payload)+1)
		requestPayload = append(requestPayload, sub2api.Message{Role: "system", Content: assistantChatRetryInstruction})
		requestPayload = append(requestPayload, payload...)
	}
	return "", sub2api.ChatUsage{}, errAssistantLeakedToolOutput
}

func (w *Worker) executeAssistantChat(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	messages, err := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
	if err != nil {
		// The current run prompt is authoritative; history is optional context.
		messages = nil
	}
	messages = assistantMessagesAfterContextBoundary(messages)
	systemPrompt := assistantChatSystemPrompt
	if len(assistantRunFileIDs(run)) > 0 {
		_, skill, skillErr := w.assistantDocumentSkill(run)
		if skillErr != nil {
			return skillErr
		}
		systemPrompt += "\n\nDocument analysis rules:\n" + skill.Instructions
	}
	nextStage := "thinking"
	if len(assistantRunFileIDs(run)) > 0 {
		nextStage = "analyzing-document"
	} else if len(references) > 0 {
		nextStage = "analyzing-image"
	}
	payload, _, err := w.prepareAssistantContext(ctx, run, "chat", systemPrompt, messages, references, false, nextStage)
	if err != nil {
		return err
	}
	lastCheckpoint := time.Now()
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	answering := false
	started := time.Now()
	var firstVisible time.Time
	var latestReasoning string
	onText := func(fullText, reasoning string) error {
		if strings.TrimSpace(reasoning) != "" {
			latestReasoning = reasoning
		}
		markAssistantFirstToken(&firstVisible, fullText)
		markAssistantFirstToken(&firstVisible, latestReasoning)
		// 真流式文本经 Redis 即时推送；PostgreSQL 只保留低频断线恢复检查点。
		if (fullText != "" || latestReasoning != "") && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: fullText, Reasoning: latestReasoning, Kind: "chat", Stage: "answering"})
		}
		if time.Since(lastTerminationCheck) >= 400*time.Millisecond {
			lastTerminationCheck = time.Now()
			if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
				if err != nil {
					return err
				}
				return context.Canceled
			}
		}
		if !answering {
			if err := w.setAssistantRunStage(ctx, run, "chat", "answering"); err != nil {
				return err
			}
			answering = true
		}
		if fullText == "" || time.Since(lastCheckpoint) < time.Second {
			return nil
		}
		lastCheckpoint = time.Now()
		metadata := assistantMessageMetadata(run, nil, "answering", "")
		attachAssistantReasoning(metadata, latestReasoning)
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, fullText, "chat", "running", metadata)
	}
	var text string
	var usedTools []string
	var artifacts []map[string]any
	var usage sub2api.ChatUsage
	if len(assistantRunFileIDs(run)) > 0 {
		text, usedTools, artifacts, usage, err = w.requestAssistantDocumentText(ctx, client, run, payload, onText)
	} else if assistantArtifactRequested(run.Prompt) {
		text, usedTools, artifacts, usage, err = w.requestAssistantArtifactText(ctx, client, run, payload, onText)
	} else {
		text, usage, err = requestAssistantChatText(ctx, client, payload, run.Prompt, onText, func(attempt int, hasUsableSuffix bool) {
			log.Printf("assistant run %s filtered leaked search prefix model=%s attempt=%d usable_suffix=%t",
				run.ID, client.ChatModel(), attempt, hasUsableSuffix)
		})
	}
	if err != nil {
		return &assistantProviderError{err: err, outputStarted: strings.TrimSpace(text) != "" || len(artifacts) > 0}
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
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	usage = finalizeAssistantUsage(usage, started, firstVisible, run, text)
	attachAssistantUsage(metadata, usage)
	attachAssistantReasoning(metadata, latestReasoning)
	if len(usedTools) > 0 {
		metadata["toolsUsed"] = usedTools
		if len(assistantRunFileIDs(run)) > 0 {
			metadata["skill"] = assistanttools.SkillDocumentAnalysis
		}
	}
	if len(artifacts) > 0 {
		metadata["artifacts"] = artifacts
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, "chat", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "chat")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Content: text, Reasoning: latestReasoning, Kind: "chat", Done: true, Status: "succeeded", Usage: usage.Map()})
	return nil
}

func (w *Worker) storeAssistantImageBytes(ctx context.Context, run *store.AssistantRun, index, count int, data []byte, revisedPrompt string) (map[string]any, error) {
	if len(data) == 0 || len(data) > assistantOutputLimit {
		return nil, errors.New("上游图片超过大小限制")
	}
	contentType, ext := assistantImageType(data)
	if contentType == "" || ext == "" {
		return nil, errors.New("上游返回了不支持的图片格式")
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return nil, fmt.Errorf("上游返回的图片无法读取: %w", err)
	}
	key := fmt.Sprintf("tasks/%s/assistant/%s/%d.%s", run.UserID, run.ID, index+1, ext)
	if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
		return nil, err
	}
	stored := map[string]any{
		"id": uuid.NewString(), "index": index, "dataUrl": "/api/v1/files/" + key, "fileKey": key,
		"revisedPrompt": revisedPrompt,
	}
	// 小图/展示图变体：尽力而为，失败只影响加载速度（前端回退原图）。
	thumbURL, displayURL := "", ""
	variantKeys := store.AssistantVariantKeys(key)
	if len(variantKeys) == 2 {
		variantCfg := w.imageVariantConfig(ctx)
		if thumb, err := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Quality: 75, MaxEdge: variantCfg.ThumbMaxEdge,
		}); err == nil {
			if err := w.Storage.UploadBytes(ctx, variantKeys[0], thumb.Data, thumb.ContentType); err == nil {
				thumbURL = "/api/v1/files/" + variantKeys[0]
				stored["thumbUrl"] = thumbURL
			}
		}
		if display, err := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Lossless: variantCfg.Lossless,
			Quality: variantCfg.Quality, MaxEdge: variantCfg.DisplayMaxEdge,
		}); err == nil {
			if err := w.Storage.UploadBytes(ctx, variantKeys[1], display.Data, display.ContentType); err == nil {
				displayURL = "/api/v1/files/" + variantKeys[1]
				stored["displayUrl"] = displayURL
			}
		}
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "image", Stage: "generating-image", ImageTotal: count,
		Image: &assistantstream.ImageEvent{
			ID: stored["id"].(string), Index: index, DataURL: stored["dataUrl"].(string),
			FileKey: key, ThumbURL: thumbURL, DisplayURL: displayURL, RevisedPrompt: revisedPrompt,
		},
	})
	return stored, nil
}

func assistantImageOutputKeys(images []map[string]any) []string {
	keys := make([]string, 0, len(images))
	seen := make(map[string]struct{}, len(images))
	for _, image := range images {
		key := strings.TrimSpace(assistantMapString(image, "fileKey"))
		if !strings.HasPrefix(key, "tasks/") {
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

func (w *Worker) enqueueAssistantOutputCleanup(keys []string) {
	if w == nil || w.St == nil || len(keys) == 0 {
		return
	}
	// 把约定路径下的小图/展示图变体一并清理。
	for _, key := range keys[:len(keys):len(keys)] {
		keys = append(keys, store.AssistantVariantKeys(key)...)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.EnqueueObjectCleanup(ctx, w.St.Pool, keys); err != nil {
		log.Printf("assistant output cleanup enqueue failed: %v", err)
	}
}

func (w *Worker) completeAssistantImageRun(ctx context.Context, run *store.AssistantRun, storedByIndex []map[string]any, expected, actual int) error {
	stored := compactAssistantImages(storedByIndex)
	content := "图片已生成"
	if actual < expected {
		content = fmt.Sprintf("已生成 %d/%d 张图片，其余图片经自动重试后仍未完成", actual, expected)
	}
	metadata := assistantMessageMetadata(run, stored, "complete", "")
	attachAssistantUsage(metadata, assistantUsageFromStartedAt(run))
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "image", "complete",
		metadata); err != nil {
		w.enqueueAssistantOutputCleanup(assistantImageOutputKeys(stored))
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "image")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	settled := run
	if latest, loadErr := store.GetAssistantRun(ctx, w.St.Pool, run.ID); loadErr == nil && latest != nil {
		settled = latest
	}
	if _, _, persistErr := store.SyncUIDesignAssetHistoryFromRun(ctx, w.St.Pool, settled, assistantImageOutputKeys(stored)); persistErr != nil {
		log.Printf("ui design asset history persist failed for run %s: %v", run.ID, persistErr)
	} else if settled != nil {
		if history, histErr := store.GetTaskByIdemKey(ctx, w.St.Pool, settled.UserID, store.UIDesignAssetHistoryIdempotencyKey(settled.ID)); histErr == nil && history != nil {
			w.publishTaskEvent(ctx, history, taskstream.Event{
				Stage: "complete", Status: history.Status, ImageCount: len(history.OutputKeys), Done: true,
			})
		}
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Kind: "image", Done: true, Status: "succeeded", ImageTotal: expected, Usage: assistantUsageFromStartedAt(run).Map()})
	return nil
}

func (w *Worker) executeAssistantImageC2A(ctx context.Context, run *store.AssistantRun, references []string, serviceKey string) error {
	taskType := "t2i"
	if serviceKey == "ui_design_asset" {
		taskType = "ui_design"
	}
	model, err := settings.TaskModel(ctx, w.St.Pool, taskType)
	if err != nil {
		return err
	}
	client := w.upstreamClient(ctx)
	return w.executeAssistantImageC2AClient(ctx, run, references, client, model)
}

func generateAssistantC2AItems(
	ctx context.Context,
	runID string,
	count int,
	generate func(context.Context, string) ([]string, error),
	onImage func(int, string) error,
) (int, error) {
	if count < 1 {
		return 0, errors.New("assistant image count must be positive")
	}
	batchCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan assistantC2AImageResult, count)
	for index := 0; index < count; index++ {
		go func(index int) {
			taskID := runID
			if count > 1 {
				taskID = fmt.Sprintf("%s-%d", runID, index+1)
			}
			currentTaskID := taskID
			var lastErr error
			for attempt := 0; attempt < assistantC2AItemAttempts; attempt++ {
				images, err := generate(batchCtx, currentTaskID)
				if len(images) > 0 && strings.TrimSpace(images[0]) != "" {
					results <- assistantC2AImageResult{index: index, encoded: images[0]}
					return
				}
				if err == nil {
					err = errors.New("上游图片任务未返回图片")
				}
				lastErr = err
				if !c2a.IsRetryableError(err) || attempt == assistantC2AItemAttempts-1 {
					break
				}
				var networkErr *c2a.NetworkError
				if !errors.As(err, &networkErr) {
					currentTaskID = fmt.Sprintf("%s-retry-%d", taskID, attempt+1)
				}
			}
			results <- assistantC2AImageResult{index: index, err: lastErr}
		}(index)
	}

	actual := 0
	var firstGenerateErr error
	var callbackErr error
	for range count {
		result := <-results
		if result.err != nil {
			if firstGenerateErr == nil {
				firstGenerateErr = result.err
			}
			continue
		}
		if callbackErr != nil {
			continue
		}
		if err := onImage(result.index, result.encoded); err != nil {
			callbackErr = err
			cancel()
			continue
		}
		actual++
	}
	if callbackErr != nil {
		return actual, callbackErr
	}
	if actual == 0 {
		if firstGenerateErr != nil {
			return 0, firstGenerateErr
		}
		return 0, errors.New("上游未返回图片")
	}
	return actual, nil
}

func (w *Worker) executeAssistantImageC2AClient(ctx context.Context, run *store.AssistantRun, references []string, client *c2a.Client, model string) error {
	finalPrompt := prompt.ConstrainAutoAspectRatio(run.Prompt, run.Params)
	size := assistantParamString(run.Params, "requestSize", "")
	if size == "auto" {
		size = ""
	}
	quality := assistantParamString(run.Params, "quality", "high")
	count := assistantParamInt(run.Params, "count", 2)
	inputs := make([]string, 0, len(references))
	for _, reference := range references {
		data, _, _, loadErr := downloadAssistantImage(ctx, reference)
		if loadErr != nil {
			return loadErr
		}
		inputs = append(inputs, base64.StdEncoding.EncodeToString(data))
	}
	storedByIndex := make([]map[string]any, count)
	actual, err := generateAssistantC2AItems(ctx, run.ID.String(), count, func(itemCtx context.Context, taskID string) ([]string, error) {
		if len(inputs) > 0 {
			return client.EditImagesWithID(itemCtx, taskID, finalPrompt, model, 1, inputs, size, quality)
		}
		return client.GenerateImagesWithID(itemCtx, taskID, finalPrompt, model, 1, size, quality)
	}, func(index int, encoded string) error {
		data, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil {
			return decodeErr
		}
		stored, storeErr := w.storeAssistantImageBytes(ctx, run, index, count, data, "")
		if storeErr != nil {
			return storeErr
		}
		storedByIndex[index] = stored
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, compactAssistantImages(storedByIndex), "generating-image", "")); err != nil {
			w.enqueueAssistantOutputCleanup([]string{assistantMapString(stored, "fileKey")})
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	return w.completeAssistantImageRun(ctx, run, storedByIndex, count, actual)
}

func (w *Worker) crunAssistantReferenceURLs(ctx context.Context, run *store.AssistantRun) ([]string, []string, error) {
	items, _ := run.Params["referenceImages"].([]any)
	urls := make([]string, 0, len(items))
	temporaryKeys := make([]string, 0, len(items))
	for index, raw := range items {
		item, _ := raw.(map[string]any)
		key := assistantMapString(item, "fileKey")
		value := assistantMapString(item, "dataUrl")
		if key == "" && strings.HasPrefix(value, "/api/v1/files/") {
			key = strings.TrimPrefix(value, "/api/v1/files/")
		}
		if key != "" {
			presigned, err := w.Storage.PresignGet(ctx, key)
			if err != nil {
				return nil, temporaryKeys, err
			}
			urls = append(urls, presigned)
			continue
		}
		if strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") {
			urls = append(urls, value)
			continue
		}
		if strings.HasPrefix(value, "data:image/") {
			data, contentType, ext, err := downloadAssistantImage(ctx, value)
			if err != nil {
				return nil, temporaryKeys, err
			}
			key = fmt.Sprintf("tasks/%s/assistant/%s/crun-input/%d.%s", run.UserID, run.ID, index+1, ext)
			if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
				return nil, temporaryKeys, err
			}
			temporaryKeys = append(temporaryKeys, key)
			presigned, err := w.Storage.PresignGet(ctx, key)
			if err != nil {
				return nil, temporaryKeys, err
			}
			urls = append(urls, presigned)
		}
	}
	return urls, temporaryKeys, nil
}

func (w *Worker) executeAssistantImageCRUN(ctx context.Context, run *store.AssistantRun) error {
	client, err := w.crunClient(ctx)
	if err != nil {
		return err
	}
	return w.executeAssistantImageCRUNClient(ctx, run, client)
}

func (w *Worker) executeAssistantImageCRUNClient(ctx context.Context, run *store.AssistantRun, client *crun.Client) error {
	finalPrompt := prompt.ConstrainAutoAspectRatio(run.Prompt, run.Params)
	references, temporaryKeys, err := w.crunAssistantReferenceURLs(ctx, run)
	if len(temporaryKeys) > 0 {
		defer w.enqueueAssistantOutputCleanup(temporaryKeys)
	}
	if err != nil {
		return err
	}
	count := assistantParamInt(run.Params, "count", 2)
	aspectRatio := normalizeCRUNAspectRatio(run.Params, assistantParamString(run.Params, "requestSize", ""))
	resolution := normalizeCRUNResolutionForAspect(normalizeCRUNResolution(run.Params), aspectRatio)
	taskIDs, err := client.CreateImageTasks(ctx, crun.OpenAIImageRequest{
		Prompt: crunPrompt(finalPrompt), N: count,
		Size:    assistantParamString(run.Params, "requestSize", ""),
		Quality: assistantParamString(run.Params, "quality", "high"), ImageURLs: references,
		AspectRatio: aspectRatio, Resolution: resolution,
	}, taskParamStrings(run.Params, "_crunTaskIds"), func(created []string) error {
		if err := store.SetAssistantRunCRUNTaskIDs(ctx, w.St.Pool, run.ID, created); err != nil {
			return err
		}
		run.Params["_crunTaskIds"] = append([]string(nil), created...)
		return nil
	})
	if err != nil {
		return err
	}
	storedByIndex := make([]map[string]any, count)
	images, err := client.WaitTasks(ctx, taskIDs, func(index int, imageURL string) error {
		if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		data, _, _, err := downloadAssistantImage(ctx, imageURL)
		if err != nil {
			return err
		}
		stored, err := w.storeAssistantImageBytes(ctx, run, index, count, data, "")
		if err != nil {
			return err
		}
		storedByIndex[index] = stored
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, compactAssistantImages(storedByIndex), "generating-image", "")); err != nil {
			w.enqueueAssistantOutputCleanup([]string{assistantMapString(stored, "fileKey")})
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	return w.completeAssistantImageRun(ctx, run, storedByIndex, count, len(images))
}

func (w *Worker) executeAssistantImage(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	finalPrompt := prompt.ConstrainAutoAspectRatio(run.Prompt, run.Params)
	size := assistantParamString(run.Params, "requestSize", "auto")
	quality := assistantParamString(run.Params, "quality", "high")
	count := assistantParamInt(run.Params, "count", 2)
	storedByIndex := make([]map[string]any, count)
	requestCtx, cancelRequest := context.WithTimeout(ctx, assistantSynchronousImageLimit)
	defer cancelRequest()
	images, err := client.GenerateImageProgressive(requestCtx, finalPrompt, size, quality, count, references, func(index int, image sub2api.Image) error {
		if terminated, err := w.assistantRunTerminated(requestCtx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		data, _, _, err := downloadAssistantImage(requestCtx, image.DataURL)
		if err != nil {
			return err
		}
		stored, err := w.storeAssistantImageBytes(requestCtx, run, index, count, data, image.RevisedPrompt)
		if err != nil {
			return err
		}
		storedByIndex[index] = stored
		partial := compactAssistantImages(storedByIndex)
		if err := store.UpdateAssistantMessage(requestCtx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, partial, "generating-image", "")); err != nil {
			w.enqueueAssistantOutputCleanup([]string{assistantMapString(stored, "fileKey")})
			return err
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
			return errors.New("图片生成超过 5 分钟仍未完成，请重试或切换图片模型")
		}
		return err
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	return w.completeAssistantImageRun(ctx, run, storedByIndex, count, len(images))
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
		if key == "" && strings.HasPrefix(value, "/api/v1/files/") {
			key = strings.TrimPrefix(value, "/api/v1/files/")
		}
		if key != "" {
			data, err := w.Storage.GetBytesLimit(ctx, key, 16<<20)
			if err != nil {
				return nil, err
			}
			contentType, _ := assistantImageType(data)
			if contentType == "" {
				return nil, fmt.Errorf("assistant reference %q is not a supported image", key)
			}
			if _, _, err := media.Dimensions(data); err != nil {
				return nil, fmt.Errorf("assistant reference %q cannot be decoded: %w", key, err)
			}
			out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
			continue
		}
		if strings.HasPrefix(value, "data:image/") {
			data, contentType, _, err := downloadAssistantImage(ctx, value)
			if err != nil {
				return nil, err
			}
			if len(data) > 16<<20 {
				return nil, errors.New("assistant reference image exceeds 16 MiB")
			}
			out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
			continue
		}
		if strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") {
			out = append(out, value)
		}
	}
	return out, nil
}

func assistantMessageMetadata(run *store.AssistantRun, images []map[string]any, stage, errorMessage string) map[string]any {
	metadata := make(map[string]any, len(run.Params)+6)
	for key, value := range run.Params {
		if key == "referenceImages" || key == "canvasSnapshot" {
			continue
		}
		metadata[key] = value
	}
	metadata["runId"] = run.ID.String()
	metadata["statusStage"] = stage
	metadata["pending"] = stage != "complete" && stage != "failed" && stage != "stopped"
	metadata["routing"] = stage == "routing"
	if run.Mode == "chat" {
		metadata["systemPromptVersion"] = assistantChatSystemPromptVersion
	}
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
		if contentType == "" || ext == "" {
			return nil, "", "", errors.New("unsupported image data URL")
		}
		if _, _, err := media.Dimensions(data); err != nil {
			return nil, "", "", fmt.Errorf("invalid image data URL: %w", err)
		}
		return data, contentType, ext, nil
	}
	if err := netguard.ValidateURL(source, false, false); err != nil {
		return nil, "", "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, "", "", err
	}
	resp, err := netguard.NewHTTPClient(90*time.Second, false, false).Do(req)
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
	if contentType == "" || ext == "" {
		return nil, "", "", errors.New("downloaded data is not a supported image")
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return nil, "", "", fmt.Errorf("downloaded image cannot be decoded: %w", err)
	}
	return data, contentType, ext, nil
}

func assistantImageType(data []byte) (string, string) {
	ext, contentType := media.Detect(data)
	return contentType, ext
}
