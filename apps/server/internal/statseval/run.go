package statseval

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantv2"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// Agent answers one question and reports what it did.
type Agent func(ctx context.Context, prompt string) (Transcript, error)

const (
	maxSteps    = 6
	caseTimeout = 90 * time.Second
)

// NewAgent answers with the v2 system prompt and read-only tools, against
// userID's own data (the admin running the evaluation). It mirrors the
// worker's tool loop without streaming, billing or persistence.
func NewAgent(client *sub2api.Client, registry *assistanttools.Registry, userID uuid.UUID, timezone string, now func() time.Time) Agent {
	tools, toolErr := registry.Definitions(assistantv2.ToolsFor(registry))
	permissions := map[assistanttools.Permission]bool{}
	for _, permission := range assistantv2.ReadPermissions {
		permissions[permission] = true
	}
	return func(ctx context.Context, prompt string) (Transcript, error) {
		transcript := Transcript{Calls: []Call{}}
		if toolErr != nil {
			return transcript, toolErr
		}
		started := time.Now()
		messages := []sub2api.Message{
			{Role: "system", Content: assistantv2.SystemPrompt(timezone, now(), "", false)},
			{Role: "user", Content: prompt},
		}
		for step := 0; ; step++ {
			if step >= maxSteps {
				completion, err := client.CompleteChatTextWithImages(ctx, messages, nil, nil)
				if err != nil {
					return transcript, err
				}
				transcript.Answer = completion.Text
				break
			}
			result, err := client.ChatAgentWithTools(ctx, messages, nil, tools, "", nil)
			if err != nil {
				return transcript, err
			}
			if len(result.ToolCalls) == 0 {
				transcript.Answer = result.Text
				break
			}
			messages = append(messages, sub2api.Message{Role: "assistant", Content: result.Text, ToolCalls: result.ToolCalls})
			for index, call := range result.ToolCalls {
				id := strings.TrimSpace(call.ID)
				if id == "" {
					id = fmt.Sprintf("eval-%d-%d", step, index)
				}
				content := ""
				if level, ok := registry.Level(call.Name); !ok || level != assistanttools.LevelRead {
					content = `{"error":"该工具在评测中不可用"}`
				} else {
					arguments := []byte(strings.TrimSpace(call.Arguments))
					if len(arguments) == 0 {
						arguments = []byte("{}")
					}
					executed, err := registry.Execute(ctx, call.Name, assistanttools.Invocation{
						UserID: userID, Arguments: arguments, Permissions: permissions, Timezone: timezone,
					})
					if err != nil {
						content = fmt.Sprintf(`{"error":%q}`, err.Error())
					} else {
						content = executed.Content
					}
				}
				transcript.Calls = append(transcript.Calls, Call{Name: call.Name, Arguments: call.Arguments, Result: content})
				messages = append(messages, sub2api.Message{Role: "tool", ToolCallID: id, Name: call.Name, Content: content})
			}
		}
		transcript.Answer = strings.TrimSpace(transcript.Answer)
		transcript.LatencyMs = time.Since(started).Milliseconds()
		return transcript, nil
	}
}

// CaseResult is one evaluated case.
type CaseResult struct {
	Case
	Grade      Grade      `json:"grade"`
	Transcript Transcript `json:"transcript"`
	Error      string     `json:"error,omitempty"`
}

// CategoryScore counts one category's passes.
type CategoryScore struct {
	Category string `json:"category"`
	Total    int    `json:"total"`
	Passed   int    `json:"passed"`
}

// Report summarises an evaluation. Rates are 0–1.
type Report struct {
	ModelID      string          `json:"modelId"`
	Total        int             `json:"total"`
	Passed       int             `json:"passed"`
	PassRate     float64         `json:"passRate"`
	ToolRate     float64         `json:"toolRate"`
	ArgsRate     float64         `json:"argsRate"`
	GroundedRate float64         `json:"groundedRate"`
	Errors       int             `json:"errors"`
	AvgLatencyMs float64         `json:"avgLatencyMs"`
	ByCategory   []CategoryScore `json:"byCategory"`
	Failures     []CaseResult    `json:"failures"`
	Cases        []CaseResult    `json:"cases"`
	DurationMs   int64           `json:"durationMs"`
}

func rate(part, total int) float64 {
	if total == 0 {
		return 0
	}
	return math.Round(float64(part)/float64(total)*1000) / 1000
}

// Evaluate runs every case through agent with bounded concurrency and grades
// it. now and loc must match what the agent was told, so relative windows
// ("上个月") resolve the same way on both sides.
func Evaluate(ctx context.Context, cases []Case, agent Agent, modelID string, now time.Time, loc *time.Location, concurrency int) Report {
	started := time.Now()
	concurrency = max(concurrency, 1)
	results := make([]CaseResult, len(cases))
	slots := make(chan struct{}, concurrency)
	var wait sync.WaitGroup
	for index, item := range cases {
		wait.Add(1)
		go func(index int, item Case) {
			defer wait.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			caseCtx, cancel := context.WithTimeout(ctx, caseTimeout)
			defer cancel()
			transcript, err := agent(caseCtx, item.Prompt)
			result := CaseResult{Case: item, Transcript: transcript}
			if err != nil {
				result.Error = err.Error()
				result.Grade = Grade{Problems: []string{"回答失败：" + err.Error()}, Ungrounded: []string{}}
			} else {
				result.Grade = GradeTranscript(item, transcript, now, loc)
			}
			results[index] = result
		}(index, item)
	}
	wait.Wait()

	report := Report{ModelID: modelID, Total: len(results), Cases: results, Failures: []CaseResult{}, ByCategory: []CategoryScore{}}
	byCategory := map[string]*CategoryScore{}
	toolOK, argsOK, grounded, answered := 0, 0, 0, 0
	var latency int64
	for _, result := range results {
		score := byCategory[result.Category]
		if score == nil {
			score = &CategoryScore{Category: result.Category}
			byCategory[result.Category] = score
		}
		score.Total++
		if result.Error != "" {
			report.Errors++
		} else {
			answered++
			latency += result.Transcript.LatencyMs
			if len(result.Grade.Ungrounded) == 0 {
				grounded++
			}
		}
		if result.Grade.ToolOK {
			toolOK++
		}
		if result.Grade.ArgsOK {
			argsOK++
		}
		if result.Grade.Passed {
			report.Passed++
			score.Passed++
		} else {
			report.Failures = append(report.Failures, result)
		}
	}
	for _, category := range Categories {
		if score := byCategory[category]; score != nil {
			report.ByCategory = append(report.ByCategory, *score)
		}
	}
	report.PassRate = rate(report.Passed, report.Total)
	report.ToolRate = rate(toolOK, report.Total)
	report.ArgsRate = rate(argsOK, report.Total)
	report.GroundedRate = rate(grounded, answered)
	if answered > 0 {
		report.AvgLatencyMs = math.Round(float64(latency) / float64(answered))
	}
	report.DurationMs = time.Since(started).Milliseconds()
	return report
}
