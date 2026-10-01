package decision

import (
	"context"
	"time"
)

// Rule answers one question from the state, or reports that it cannot.
type Rule func(state string) (Answer, bool)

// Rules is the last-resort provider: deterministic, instant, and honest about
// its limits. A rule should only answer when it is genuinely certain; the
// default for anything else belongs in the question's caller.
type Rules map[string]Rule

func (r Rules) Name() string { return "rules" }

func (r Rules) Decide(_ context.Context, req Request) (Response, error) {
	started := time.Now()
	response := Response{Provider: r.Name(), Calibrated: false, Answers: map[string]Answer{}}
	for _, question := range req.Questions {
		rule, ok := r[question.ID]
		if !ok {
			continue
		}
		if answer, ok := rule(req.State); ok {
			answer.Kind = question.Kind
			response.Answers[question.ID] = answer
		}
	}
	response.LatencyMs = time.Since(started).Milliseconds()
	if len(response.Answers) == 0 {
		return response, ErrNoAnswer
	}
	return response, nil
}

// Fixed returns a rule that always gives answer; useful for safe defaults
// such as "no clarification needed" with low confidence.
func Fixed(answer Answer) Rule {
	return func(string) (Answer, bool) { return answer, true }
}
