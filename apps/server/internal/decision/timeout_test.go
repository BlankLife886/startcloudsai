package decision

import (
	"context"
	"testing"
	"time"
)

func TestThresholdTimeoutDefaultsAndBounds(t *testing.T) {
	if (Thresholds{}).Timeout() != DefaultTimeout || (Thresholds{TimeoutMs: 6000}).Timeout() != 6*time.Second {
		t.Fatal("timeout not applied")
	}
	for _, ms := range []int{500, 20000} {
		if err := (Override{Thresholds: map[string]Thresholds{"m": {Intent: 0.6, Clarify: 0.7, TimeoutMs: ms}}}).Validate(); err == nil {
			t.Fatalf("timeout %d accepted", ms)
		}
	}
	if err := (Override{Thresholds: map[string]Thresholds{"m": {Intent: 0.6, Clarify: 0.7, TimeoutMs: 6000}}}).Validate(); err != nil {
		t.Fatal(err)
	}
}

// slowDecider answers after a delay unless its context ends first.
type slowDecider struct{ delay time.Duration }

func (s slowDecider) Name() string { return "llm" }

func (s slowDecider) Decide(ctx context.Context, req Request) (Response, error) {
	select {
	case <-time.After(s.delay):
		return Response{Provider: "llm", Answers: map[string]Answer{"intent": {Kind: KindChoice, Choice: "create", Confidence: 0.9}}}, nil
	case <-ctx.Done():
		return Response{}, ctx.Err()
	}
}

func TestChainWaitsLongerOnlyWhenTheFallbackIsUnsure(t *testing.T) {
	request := Request{State: "用户：我要粉色的小狗", Questions: []Question{{ID: "intent", Kind: KindChoice, Instructions: "x",
		Options: []Option{{ID: "answer", Description: "a"}, {ID: "create", Description: "c"}}}}}
	chain := func(confidence float64) Chain {
		return Chain{
			Primary:        slowDecider{delay: 80 * time.Millisecond},
			Fallback:       Rules{"intent": Fixed(Answer{Choice: "answer", Confidence: confidence})},
			Timeout:        30 * time.Millisecond,
			Patience:       map[string]float64{"intent": 0.5},
			PatientTimeout: 500 * time.Millisecond,
		}
	}
	// No rule matched (0.2): the model gets the longer wait and decides.
	if response, err := chain(0.2).Decide(context.Background(), request); err != nil || response.Answers["intent"].Choice != "create" || response.Provider != "llm" {
		t.Fatalf("unsure fallback should wait for the model: %+v %v", response, err)
	}
	// A matched rule (0.5) keeps the short wait and answers.
	if response, err := chain(0.5).Decide(context.Background(), request); err != nil || response.Answers["intent"].Choice != "answer" || response.Provider != "rules" {
		t.Fatalf("confident fallback should answer at the short timeout: %+v %v", response, err)
	}
	// The patient wait is still bounded.
	slow := chain(0.2)
	slow.Primary = slowDecider{delay: time.Second}
	started := time.Now()
	if response, _ := slow.Decide(context.Background(), request); response.Provider != "rules" || time.Since(started) > 800*time.Millisecond {
		t.Fatalf("patient wait must stop at PatientTimeout: %+v after %v", response, time.Since(started))
	}
}
