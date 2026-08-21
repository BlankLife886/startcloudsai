package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const assistantDocumentFinalInstruction = `Using the file passages already returned by tools, answer the user's current question now. Cite supporting evidence with the file name and locator. Do not call or imitate tools in the answer. If the attached files do not contain the answer, state that clearly. If a downloadable file was created, briefly tell the user it is available below the answer.`

func assistantRunFileIDs(run *store.AssistantRun) []uuid.UUID {
	if run == nil {
		return []uuid.UUID{}
	}
	values := assistantParamStrings(run.Params, "_assistantFileIds")
	ids := make([]uuid.UUID, 0, len(values))
	seen := make(map[uuid.UUID]bool, len(values))
	for _, value := range values {
		id, err := uuid.Parse(strings.TrimSpace(value))
		if err == nil && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func (w *Worker) assistantDocumentSkill(run *store.AssistantRun) (*assistanttools.Registry, assistanttools.Skill, error) {
	tools, skills, err := assistanttools.NewDefaultRegistries(w.St, w.Storage)
	if err != nil {
		return nil, assistanttools.Skill{}, err
	}
	skill, err := skills.Resolve(assistantParamString(run.Params, "skill", ""), true)
	if err != nil {
		return nil, assistanttools.Skill{}, err
	}
	return tools, skill, nil
}

func (w *Worker) requestAssistantDocumentText(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	payload []sub2api.Message,
	onFinalText func(string, string) error,
) (string, []string, []map[string]any, sub2api.ChatUsage, error) {
	fileIDs := assistantRunFileIDs(run)
	if len(fileIDs) == 0 {
		return "", nil, nil, sub2api.ChatUsage{}, fmt.Errorf("document chat has no attached files")
	}
	registry, skill, err := w.assistantDocumentSkill(run)
	if err != nil {
		return "", nil, nil, sub2api.ChatUsage{}, err
	}
	definitions, err := registry.Definitions(skill.AllowedTools)
	if err != nil {
		return "", nil, nil, sub2api.ChatUsage{}, err
	}
	used := make([]string, 0, skill.MaxSteps)
	artifacts := make([]map[string]any, 0, 2)
	var usage sub2api.ChatUsage
	wantsArtifact := assistantArtifactRequested(run.Prompt)
	messages := append([]sub2api.Message(nil), payload...)
	for step := 0; step < skill.MaxSteps; step++ {
		turnDefinitions := definitions
		if !assistantDocumentEvidenceRead(used) {
			turnDefinitions = assistantToolDefinitionsWithout(definitions, assistanttools.ToolFilesCreate)
		}
		toolChoice := ""
		if step == 0 {
			toolChoice = sub2api.RequiredToolChoice
		}
		result, err := client.ChatAgentWithTools(ctx, messages, nil, turnDefinitions, toolChoice, func(_, reasoning string) error {
			if onFinalText == nil || strings.TrimSpace(reasoning) == "" {
				return nil
			}
			return onFinalText("", reasoning)
		})
		usage = usage.Add(result.Usage)
		if err != nil {
			return result.Text, used, artifacts, usage, err
		}
		if result.ToolCall == nil {
			text := strings.TrimSpace(result.Text)
			if !assistantDocumentEvidenceRead(used) {
				messages = append(messages, sub2api.Message{Role: "assistant", Content: text}, sub2api.Message{
					Role: "system", Content: "Read or search at least one attached-file passage before answering.",
				})
				continue
			}
			if wantsArtifact && len(artifacts) == 0 {
				messages = append(messages, sub2api.Message{Role: "assistant", Content: text}, sub2api.Message{
					Role: "system", Content: "The user requested a downloadable file. Create it now with files_create using the evidence already read. PPTX content must use the structured JSON format described by the tool.",
				})
				continue
			}
			if text == "" {
				break
			}
			if onFinalText != nil {
				if err := onFinalText(text, strings.TrimSpace(result.Reasoning)); err != nil {
					return text, used, artifacts, usage, err
				}
			}
			return text, used, artifacts, usage, nil
		}
		call := *result.ToolCall
		messages = append(messages, sub2api.Message{
			Role: "assistant", Content: result.Text, ToolCalls: []sub2api.ToolCall{call},
		})
		toolResult, toolErr := registry.Execute(ctx, call.Name, assistanttools.Invocation{
			UserID: run.UserID, RunID: run.ID, AssistantMessageID: run.AssistantMessageID,
			Arguments: json.RawMessage(call.Arguments), FileIDs: fileIDs,
			Permissions: map[assistanttools.Permission]bool{
				assistanttools.PermissionFilesMetadata: true,
				assistanttools.PermissionFilesRead:     true,
				assistanttools.PermissionFilesWrite:    wantsArtifact && assistantDocumentEvidenceRead(used),
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
	if !assistantDocumentEvidenceRead(used) {
		return "", used, artifacts, usage, fmt.Errorf("document analysis finished without reading file evidence")
	}
	if wantsArtifact && len(artifacts) == 0 {
		return "", used, artifacts, usage, fmt.Errorf("assistant did not create the requested file")
	}
	messages = append([]sub2api.Message{{Role: "system", Content: assistantDocumentFinalInstruction}}, messages...)
	text, finalUsage, err := requestAssistantChatText(ctx, client, messages, run.Prompt, onFinalText, nil)
	return text, used, artifacts, usage.Add(finalUsage), err
}

func assistantToolDefinitionsWithout(definitions []sub2api.FunctionTool, excluded string) []sub2api.FunctionTool {
	out := make([]sub2api.FunctionTool, 0, len(definitions))
	for _, definition := range definitions {
		if definition.Name != excluded {
			out = append(out, definition)
		}
	}
	return out
}

func assistantDocumentEvidenceRead(tools []string) bool {
	for _, name := range tools {
		if name == assistanttools.ToolFilesSearch || name == assistanttools.ToolFilesRead {
			return true
		}
	}
	return false
}
