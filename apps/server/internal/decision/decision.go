// Package decision answers fast, structured questions for the assistant:
// which capability domain a request needs, whether to ask a clarifying
// question first, how risky a step is. Callers depend only on the Decider
// interface; the provider behind it (a general chat model returning JSON, a
// dedicated decision model such as Jev, or plain rules) is configuration.
package decision

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Kind is the shape of a question's answer.
type Kind string

const (
	// KindChoice picks exactly one option.
	KindChoice Kind = "choice"
	// KindYesNo returns the probability that the answer is yes.
	KindYesNo Kind = "yes_no"
	// KindScore places the state on an ordered list of levels (Options).
	KindScore Kind = "score"
)

// Option is one choice, or one level of a score question (ordered low → high).
type Option struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

// Question is one structured question about the state.
type Question struct {
	ID           string   `json:"id"`
	Kind         Kind     `json:"kind"`
	Instructions string   `json:"instructions"`
	Options      []Option `json:"options,omitempty"`
}

// Answer is a typed answer with a confidence in [0, 1].
type Answer struct {
	Kind       Kind    `json:"kind"`
	Choice     string  `json:"choice,omitempty"`
	Yes        float64 `json:"yes,omitempty"`
	Score      float64 `json:"score,omitempty"`
	Confidence float64 `json:"confidence"`
}

// Request is the state to evaluate plus the questions about it.
type Request struct {
	State     string     `json:"state"`
	Questions []Question `json:"questions"`
}

// Response carries the answers and where they came from.
type Response struct {
	Answers map[string]Answer `json:"answers"`
	// Provider is "llm", "rules", or a dedicated provider name.
	Provider string `json:"provider"`
	Model    string `json:"model,omitempty"`
	// Calibrated is true only for providers whose confidence is a calibrated
	// probability. Self-reported LLM confidence is not, so thresholds must be
	// configured per provider rather than shared.
	Calibrated bool  `json:"calibrated"`
	LatencyMs  int64 `json:"latencyMs"`
	// FallbackIDs lists questions answered by a fallback provider.
	FallbackIDs []string `json:"fallbackIds,omitempty"`
}

// Decider answers structured questions.
type Decider interface {
	Name() string
	Decide(ctx context.Context, req Request) (Response, error)
}

// ErrNoAnswer means the provider produced nothing usable.
var ErrNoAnswer = errors.New("decision provider returned no usable answer")

const (
	maxQuestions  = 8
	maxOptions    = 16
	maxStateRunes = 8000
)

// Validate rejects malformed questions before any provider sees them.
func (r Request) Validate() error {
	if strings.TrimSpace(r.State) == "" {
		return errors.New("decision state is empty")
	}
	if len(r.Questions) == 0 || len(r.Questions) > maxQuestions {
		return fmt.Errorf("decision needs 1-%d questions", maxQuestions)
	}
	seen := map[string]bool{}
	for _, question := range r.Questions {
		id := strings.TrimSpace(question.ID)
		if id == "" || seen[id] {
			return fmt.Errorf("decision question id %q is empty or duplicated", question.ID)
		}
		seen[id] = true
		if strings.TrimSpace(question.Instructions) == "" {
			return fmt.Errorf("decision question %s has no instructions", id)
		}
		switch question.Kind {
		case KindYesNo:
		case KindChoice, KindScore:
			if len(question.Options) < 2 || len(question.Options) > maxOptions {
				return fmt.Errorf("decision question %s needs 2-%d options", id, maxOptions)
			}
			optionIDs := map[string]bool{}
			for _, option := range question.Options {
				if strings.TrimSpace(option.ID) == "" || optionIDs[option.ID] {
					return fmt.Errorf("decision question %s has an empty or duplicated option", id)
				}
				optionIDs[option.ID] = true
			}
		default:
			return fmt.Errorf("decision question %s has unknown kind %q", id, question.Kind)
		}
	}
	return nil
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	// Keep the tail: the newest turn of a transcript matters most.
	return string(runes[len(runes)-limit:])
}

func clamp01(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

// Chain asks Primary first and fills any missing or failed answers from
// Fallback, so a slow or broken model never blocks the assistant.
type Chain struct {
	Primary  Decider
	Fallback Decider
	// Timeout bounds the primary call; zero means 3 seconds.
	Timeout time.Duration
	// Patience lets the primary run past Timeout, up to PatientTimeout,
	// when the fallback's own answer to a listed question is below the
	// given confidence: waiting longer only where the fallback would
	// probably be wrong. Rules that matched answer straight away.
	Patience       map[string]float64
	PatientTimeout time.Duration
}

// unsure reports whether the fallback's answers leave a question the
// primary is worth waiting longer for.
func (c Chain) unsure(fallback Response, fallbackErr error) bool {
	if len(c.Patience) == 0 || c.PatientTimeout <= 0 {
		return false
	}
	if fallbackErr != nil {
		return true
	}
	for id, floor := range c.Patience {
		if answer, ok := fallback.Answers[id]; !ok || answer.Confidence < floor {
			return true
		}
	}
	return false
}

// askPrimary runs the primary within Timeout, or within PatientTimeout when
// the fallback is unsure.
func (c Chain) askPrimary(ctx context.Context, req Request, timeout time.Duration) (Response, error) {
	if len(c.Patience) == 0 || c.PatientTimeout <= timeout || c.Fallback == nil {
		primaryCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return c.Primary.Decide(primaryCtx, req)
	}
	fallback, fallbackErr := c.Fallback.Decide(ctx, req)
	limit := timeout
	if c.unsure(fallback, fallbackErr) {
		limit = c.PatientTimeout
	}
	primaryCtx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	return c.Primary.Decide(primaryCtx, req)
}

func (c Chain) Name() string {
	if c.Primary == nil {
		return "chain"
	}
	return c.Primary.Name()
}

func (c Chain) Decide(ctx context.Context, req Request) (Response, error) {
	if err := req.Validate(); err != nil {
		return Response{}, err
	}
	started := time.Now()
	var response Response
	var primaryErr error
	if c.Primary != nil {
		timeout := c.Timeout
		if timeout <= 0 {
			timeout = 3 * time.Second
		}
		response, primaryErr = c.askPrimary(ctx, req, timeout)
	} else {
		primaryErr = ErrNoAnswer
	}
	if response.Answers == nil {
		response.Answers = map[string]Answer{}
	}
	missing := make([]Question, 0)
	for _, question := range req.Questions {
		if _, ok := response.Answers[question.ID]; !ok {
			missing = append(missing, question)
		}
	}
	if len(missing) > 0 && c.Fallback != nil {
		primaryAnswered := len(response.Answers) > 0
		fallback, err := c.Fallback.Decide(ctx, Request{State: req.State, Questions: missing})
		if err == nil {
			// The provider names whoever actually answered; a primary that
			// produced nothing must not take credit for the fallback's answers.
			if !primaryAnswered {
				response.Provider = fallback.Provider
				response.Calibrated = fallback.Calibrated
			}
			for _, question := range missing {
				if answer, ok := fallback.Answers[question.ID]; ok {
					response.Answers[question.ID] = answer
					response.FallbackIDs = append(response.FallbackIDs, question.ID)
				}
			}
		}
	}
	response.LatencyMs = time.Since(started).Milliseconds()
	if len(response.Answers) == 0 {
		if primaryErr != nil {
			return response, primaryErr
		}
		return response, ErrNoAnswer
	}
	return response, nil
}
