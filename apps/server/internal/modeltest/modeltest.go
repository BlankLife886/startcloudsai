// Package modeltest runs real test calls against one configured model through
// the production client stack: chat models answer a prompt and are probed for
// tool calling; image models generate an image and optionally edit it. It is
// shared by the admin model catalog and the model-smoke command.
package modeltest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/providerclient"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const (
	DefaultChatPrompt  = "用一句中文介绍你自己，并说出你的模型名称。"
	DefaultImagePrompt = "一只戴着宇航员头盔的橘猫坐在月球表面，远处是地球，写实摄影风格"
	DefaultEditPrompt  = "保持这只猫不变，把背景改成夜晚的城市霓虹街道"
	// StepToolCall is optional: a model without tool calling still passes.
	StepToolCall = "工具调用"
)

// Step is one test call.
type Step struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	Optional  bool   `json:"optional,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
	Detail    string `json:"detail,omitempty"`
	// Image is the generated image, base64 encoded (image steps only).
	Image string `json:"image,omitempty"`
	// Pending marks an image step the upstream accepted as an async task.
	Pending bool `json:"pending,omitempty"`
}

// Result is the outcome for one model.
type Result struct {
	Model string `json:"model"`
	Kind  string `json:"kind"`
	Steps []Step `json:"steps"`
}

// OK reports whether every required step passed.
func (r Result) OK() bool {
	for _, step := range r.Steps {
		if !step.OK && !step.Optional {
			return false
		}
	}
	return len(r.Steps) > 0
}

// ChatOptions tunes a chat test.
type ChatOptions struct {
	Prompt string
	// SkipTools leaves out the tool-calling probe.
	SkipTools bool
	// ToolChoice overrides the probe's tool_choice (default "auto").
	ToolChoice string
	// ReasoningEffort is sent as reasoning_effort, as the assistant does.
	ReasoningEffort string
}

// Chat sends a prompt and, unless skipped, a tool-calling probe.
func Chat(ctx context.Context, selection *modelconfig.Selection, options ChatOptions) Result {
	result := Result{Model: selection.Model.UpstreamModel, Kind: modelconfig.ModelKindChat}
	client, err := providerclient.ChatForSelection(selection, "")
	if err != nil {
		result.Steps = append(result.Steps, Step{Name: "对话", Detail: err.Error()})
		return result
	}
	call := func(step Step, body map[string]any, read func(map[string]any) (bool, string)) {
		raw, _ := json.Marshal(body)
		callCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		defer cancel()
		started := time.Now()
		resp, err := client.PostChatCompletions(callCtx, raw)
		if err != nil {
			step.LatencyMs, step.Detail = time.Since(started).Milliseconds(), Truncate(err.Error(), 300)
			result.Steps = append(result.Steps, step)
			return
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		step.LatencyMs = time.Since(started).Milliseconds()
		var payload map[string]any
		if err := json.Unmarshal(data, &payload); err != nil {
			step.Detail = "响应不是 JSON：" + Truncate(string(data), 200)
		} else {
			step.OK, step.Detail = read(payload)
		}
		result.Steps = append(result.Steps, step)
	}
	model := selection.Model.UpstreamModel
	prompt := strings.TrimSpace(options.Prompt)
	if prompt == "" {
		prompt = DefaultChatPrompt
	}
	effort := strings.ToLower(strings.TrimSpace(options.ReasoningEffort))
	chatBody := map[string]any{
		"model": model, "stream": false,
		"messages": []any{map[string]any{"role": "user", "content": prompt}},
	}
	if effort != "" {
		chatBody["reasoning_effort"] = effort
		client = client.WithReasoningEffort(effort)
	}
	call(Step{Name: "对话"}, chatBody, func(payload map[string]any) (bool, string) {
		text, _ := firstChoiceMessage(payload)["content"].(string)
		if strings.TrimSpace(text) == "" {
			return false, "没有返回文本"
		}
		return true, Truncate(strings.TrimSpace(text), 600) + usageNote(payload)
	})
	if options.SkipTools {
		return result
	}
	// Probe tool calling through the same streamed agent call the AI
	// assistant uses, so the result matches production behaviour.
	step := Step{Name: StepToolCall, Optional: true}
	toolCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	choice := ""
	if options.ToolChoice == sub2api.RequiredToolChoice {
		choice = sub2api.RequiredToolChoice
	}
	started := time.Now()
	agent, err := client.ChatAgentWithTools(toolCtx,
		[]sub2api.Message{{Role: "user", Content: "北京今天天气怎么样？请调用工具查询。"}}, nil,
		[]sub2api.FunctionTool{{
			Name: "get_weather", Description: "查询城市天气",
			Parameters: map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []string{"city"}},
		}}, choice, nil)
	step.LatencyMs = time.Since(started).Milliseconds()
	switch {
	case err != nil:
		step.Detail = Truncate(err.Error(), 300)
	case len(agent.ToolCalls) == 0:
		reply := strings.TrimSpace(agent.Text)
		if reply == "" {
			reply = "（无文本）"
		}
		step.Detail = "未发起工具调用（流式，与 AI 助手相同）。模型回复：" + Truncate(reply, 200)
	default:
		step.OK = true
		step.Detail = fmt.Sprintf("调用 %s(%s)", agent.ToolCalls[0].Name, agent.ToolCalls[0].Arguments)
	}
	result.Steps = append(result.Steps, step)
	return result
}

// usageNote reports token usage, including reasoning tokens when the
// upstream returns them, so reasoning levels can be compared.
func usageNote(payload map[string]any) string {
	usage, _ := payload["usage"].(map[string]any)
	if usage == nil {
		return ""
	}
	note := fmt.Sprintf("（输出 %v tokens", usage["completion_tokens"])
	if details, _ := usage["completion_tokens_details"].(map[string]any); details != nil && details["reasoning_tokens"] != nil {
		note += fmt.Sprintf("，其中推理 %v", details["reasoning_tokens"])
	}
	return note + "）"
}

func firstChoiceMessage(payload map[string]any) map[string]any {
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return map[string]any{}
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	if message == nil {
		return map[string]any{}
	}
	return message
}

// ImageOptions tunes an image test.
type ImageOptions struct {
	Prompt     string
	EditPrompt string
	Size       string
	// Quality is the platform quality (low/medium/high/auto); default medium.
	Quality string
	// Edit also runs an image-to-image call on the generated image.
	Edit bool
}

// Image generates one image and, with Edit, edits it as a reference.
func Image(ctx context.Context, selection *modelconfig.Selection, allowPrivate bool, options ImageOptions) Result {
	result := Result{Model: selection.Model.UpstreamModel, Kind: modelconfig.ModelKindImage}
	client := providerclient.TaskImageForSelection(selection, allowPrivate)
	model := selection.Model.UpstreamModel
	tag := strings.NewReplacer("/", "_", ":", "_").Replace(model)
	run := func(name string, submit func(context.Context) ([]string, bool, string, error)) []string {
		callCtx, cancel := context.WithTimeout(ctx, 6*time.Minute)
		defer cancel()
		started := time.Now()
		images, pending, _, err := submit(callCtx)
		step := Step{Name: name, LatencyMs: time.Since(started).Milliseconds()}
		switch {
		case err != nil:
			step.Detail = Truncate(err.Error(), 300)
		case pending:
			step.Pending = true
			step.Detail = "上游返回异步任务（测试只支持同步出图）"
		case len(images) == 0 || images[0] == "":
			step.Detail = "没有返回图片"
		default:
			step.OK, step.Image = true, images[0]
			step.Detail = fmt.Sprintf("%d KB", len(images[0])*3/4/1024)
		}
		result.Steps = append(result.Steps, step)
		if step.OK {
			return images
		}
		return nil
	}
	prompt := firstNonEmpty(options.Prompt, DefaultImagePrompt)
	size := firstNonEmpty(options.Size, "1024x1024")
	quality := firstNonEmpty(options.Quality, "medium")
	generated := run("文生图", func(callCtx context.Context) ([]string, bool, string, error) {
		return client.SubmitGenerateImagesTracked(callCtx, "model-test-"+tag, prompt, model, 1, size, c2a.ImageOptions{Quality: quality})
	})
	if options.Edit && len(generated) > 0 && !strings.HasPrefix(strings.ToLower(model), "imagen") {
		editPrompt := firstNonEmpty(options.EditPrompt, DefaultEditPrompt)
		run("图生图", func(callCtx context.Context) ([]string, bool, string, error) {
			return client.SubmitEditImagesTracked(callCtx, "model-test-edit-"+tag, editPrompt, model, 1, generated[:1], size, c2a.ImageOptions{Quality: quality})
		})
	}
	return result
}

func firstNonEmpty(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}

// Truncate shortens value to limit runes.
func Truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
