package decision

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// Completer sends one system + user exchange to a chat model and returns its
// text. *sub2api.Client satisfies it through CompleterFunc in model.go.
type Completer interface {
	Complete(ctx context.Context, system, user string) (string, error)
}

// LLM asks a general chat model to answer in JSON. Its confidence is
// self-reported and therefore not calibrated.
type LLM struct {
	Completer Completer
	Model     string
}

func (d LLM) Name() string { return "llm" }

const llmSystemPrompt = `你是一个结构化判断器。根据【状态】回答每个【问题】，只输出一个 JSON 对象，不要输出任何解释或 Markdown。

输出格式：
{"answers": {"<问题 id>": <答案>, ...}}

答案格式按问题类型：
- choice：{"choice": "<选项 id>", "confidence": <0 到 1>}，choice 必须是给出的选项 id 之一。
- yes_no：{"yes": <回答“是”的概率，0 到 1>}
- score：{"score": <等级序号，从 0 开始，可以是小数>, "confidence": <0 到 1>}

confidence 表示你对答案的把握：拿不准时如实给低分，不要一律给 1。`

func renderLLMQuestions(req Request) string {
	var builder strings.Builder
	builder.WriteString("【状态】\n")
	builder.WriteString(truncateRunes(strings.TrimSpace(req.State), maxStateRunes))
	builder.WriteString("\n\n【问题】\n")
	for _, question := range req.Questions {
		fmt.Fprintf(&builder, "- id=%s 类型=%s：%s\n", question.ID, question.Kind, strings.TrimSpace(question.Instructions))
		for index, option := range question.Options {
			if question.Kind == KindScore {
				fmt.Fprintf(&builder, "    等级 %d（%s）：%s\n", index, option.ID, option.Description)
			} else {
				fmt.Fprintf(&builder, "    选项 %s：%s\n", option.ID, option.Description)
			}
		}
	}
	return builder.String()
}

// extractJSONObject returns the outermost {...} in text, tolerating code
// fences or stray prose around it.
func extractJSONObject(text string) string {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return ""
	}
	return text[start : end+1]
}

type llmAnswer struct {
	Choice     *string  `json:"choice"`
	Yes        *float64 `json:"yes"`
	Score      *float64 `json:"score"`
	Confidence *float64 `json:"confidence"`
}

// parseLLMAnswers keeps only answers that fit their question; anything else
// is dropped so the chain can fill it from the fallback.
func parseLLMAnswers(req Request, text string) map[string]Answer {
	raw := extractJSONObject(text)
	if raw == "" {
		return nil
	}
	var payload struct {
		Answers map[string]llmAnswer `json:"answers"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil
	}
	out := map[string]Answer{}
	for _, question := range req.Questions {
		answer, ok := payload.Answers[question.ID]
		if !ok {
			continue
		}
		confidence := 0.5
		if answer.Confidence != nil && !math.IsNaN(*answer.Confidence) {
			confidence = clamp01(*answer.Confidence)
		}
		switch question.Kind {
		case KindChoice:
			if answer.Choice == nil {
				continue
			}
			choice := strings.TrimSpace(*answer.Choice)
			valid := false
			for _, option := range question.Options {
				if option.ID == choice {
					valid = true
					break
				}
			}
			if !valid {
				continue
			}
			out[question.ID] = Answer{Kind: KindChoice, Choice: choice, Confidence: confidence}
		case KindYesNo:
			if answer.Yes == nil || math.IsNaN(*answer.Yes) {
				continue
			}
			yes := clamp01(*answer.Yes)
			out[question.ID] = Answer{Kind: KindYesNo, Yes: yes, Confidence: math.Abs(yes-0.5) * 2}
		case KindScore:
			if answer.Score == nil || math.IsNaN(*answer.Score) {
				continue
			}
			score := math.Max(0, math.Min(float64(len(question.Options)-1), *answer.Score))
			out[question.ID] = Answer{Kind: KindScore, Score: score, Confidence: confidence}
		}
	}
	return out
}

func (d LLM) Decide(ctx context.Context, req Request) (Response, error) {
	if err := req.Validate(); err != nil {
		return Response{}, err
	}
	if d.Completer == nil {
		return Response{}, ErrNoAnswer
	}
	started := time.Now()
	text, err := d.Completer.Complete(ctx, llmSystemPrompt, renderLLMQuestions(req))
	response := Response{Provider: d.Name(), Model: d.Model, LatencyMs: time.Since(started).Milliseconds()}
	if err != nil {
		return response, err
	}
	response.Answers = parseLLMAnswers(req, text)
	if len(response.Answers) == 0 {
		return response, ErrNoAnswer
	}
	return response, nil
}
