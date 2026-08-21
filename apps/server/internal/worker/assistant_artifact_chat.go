package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const assistantArtifactInstruction = `The user requested one or more downloadable files. Use files_create to create the requested result. Supported formats are TXT, Markdown, CSV, JSON, and PPTX. For PPTX, pass content as a JSON string with title, optional subtitle, and slides; every slide contains a title and a bullets array. Put the complete useful content in the file, then briefly tell the user that the download is available below the answer. Never output a fake path or claim a file exists unless files_create succeeded.`

func assistantArtifactRequested(prompt string) bool {
	value := strings.ToLower(strings.TrimSpace(prompt))
	if value == "" {
		return false
	}
	verbs := []string{"生成", "创建", "制作", "导出", "输出", "整理成", "保存为", "下载", "create", "make", "generate", "export", "download", "save as"}
	nouns := []string{"文件", "文档", "附件", "表格", "演示文稿", "幻灯片", "ppt", "powerpoint", ".txt", ".md", ".csv", ".json", ".pptx", " txt", " markdown", " csv", " json", " file", " document", " attachment", " presentation", " slide deck"}
	hasVerb := false
	for _, word := range verbs {
		if strings.Contains(value, word) {
			hasVerb = true
			break
		}
	}
	if !hasVerb {
		return false
	}
	for _, word := range nouns {
		if strings.Contains(value, word) {
			return true
		}
	}
	return false
}

func (w *Worker) requestAssistantArtifactText(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	payload []sub2api.Message,
	onFinalText func(string) error,
) (string, []string, []map[string]any, error) {
	registry, skills, err := assistanttools.NewDefaultRegistries(w.St, w.Storage)
	if err != nil {
		return "", nil, nil, err
	}
	skill, err := skills.Resolve(assistanttools.SkillGeneral, false)
	if err != nil {
		return "", nil, nil, err
	}
	definitions, err := registry.Definitions(skill.AllowedTools)
	if err != nil {
		return "", nil, nil, err
	}
	if len(definitions) == 0 {
		return "", nil, nil, fmt.Errorf("file creation tool is unavailable")
	}
	messages := make([]sub2api.Message, 0, len(payload)+8)
	messages = append(messages, sub2api.Message{Role: "system", Content: assistantArtifactInstruction})
	messages = append(messages, payload...)
	used := make([]string, 0, skill.MaxSteps)
	artifacts := make([]map[string]any, 0, 2)
	for step := 0; step < skill.MaxSteps; step++ {
		toolChoice := ""
		if len(artifacts) == 0 {
			toolChoice = sub2api.RequiredToolChoice
		}
		result, err := client.ChatAgentWithTools(ctx, messages, nil, definitions, toolChoice, nil)
		if err != nil {
			return result.Text, used, artifacts, err
		}
		if result.ToolCall == nil {
			text := strings.TrimSpace(result.Text)
			if len(artifacts) == 0 {
				messages = append(messages, sub2api.Message{Role: "assistant", Content: text}, sub2api.Message{
					Role: "system", Content: "Create the requested downloadable file with files_create before answering.",
				})
				continue
			}
			if text == "" {
				break
			}
			if onFinalText != nil {
				if err := onFinalText(text); err != nil {
					return text, used, artifacts, err
				}
			}
			return text, used, artifacts, nil
		}
		call := *result.ToolCall
		messages = append(messages, sub2api.Message{
			Role: "assistant", Content: result.Text, ToolCalls: []sub2api.ToolCall{call},
		})
		toolResult, toolErr := registry.Execute(ctx, call.Name, assistanttools.Invocation{
			UserID: run.UserID, RunID: run.ID, AssistantMessageID: run.AssistantMessageID,
			Arguments: json.RawMessage(call.Arguments),
			Permissions: map[assistanttools.Permission]bool{
				assistanttools.PermissionFilesWrite: true,
			},
		})
		content := toolResult.Content
		if toolErr != nil {
			raw, _ := json.Marshal(map[string]any{"error": toolErr.Error()})
			content = string(raw)
		}
		messages = append(messages, sub2api.Message{
			Role: "tool", Name: call.Name, ToolCallID: call.ID, Content: content,
		})
		used = append(used, call.Name)
		if artifact, ok := toolResult.Meta["artifact"].(map[string]any); ok && toolErr == nil {
			artifacts = append(artifacts, artifact)
		}
	}
	if len(artifacts) == 0 {
		return "", used, artifacts, fmt.Errorf("assistant did not create the requested file")
	}
	messages = append([]sub2api.Message{{Role: "system", Content: "Answer now without calling tools. Tell the user the generated file is available in the download section below."}}, messages...)
	text, err := requestAssistantChatText(ctx, client, messages, run.Prompt, onFinalText, nil)
	return text, used, artifacts, err
}
