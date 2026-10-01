package decision

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

type completerFunc func(ctx context.Context, system, user string) (string, error)

func (f completerFunc) Complete(ctx context.Context, system, user string) (string, error) {
	return f(ctx, system, user)
}

func routeRequest() Request {
	return Request{
		State: "用户：这个月钱都花哪了？",
		Questions: []Question{
			{ID: "domain", Kind: KindChoice, Instructions: "这一轮需要哪类能力", Options: []Option{
				{ID: "answer", Description: "直接回答"}, {ID: "my_data", Description: "查询用户自己的数据"},
			}},
			{ID: "clarify", Kind: KindYesNo, Instructions: "是否必须先追问才能继续"},
			{ID: "urgency", Kind: KindScore, Instructions: "紧急程度", Options: []Option{
				{ID: "low", Description: "不急"}, {ID: "mid", Description: "一般"}, {ID: "high", Description: "很急"},
			}},
		},
	}
}

func TestLLMParsesFencedJSONAndDropsInvalidAnswers(t *testing.T) {
	llm := LLM{Model: "m", Completer: completerFunc(func(_ context.Context, system, user string) (string, error) {
		if !strings.Contains(system, "JSON") || !strings.Contains(user, "id=domain") || !strings.Contains(user, "选项 my_data") {
			t.Fatalf("prompt missing structure:\n%s\n%s", system, user)
		}
		return "```json\n" + `{"answers":{"domain":{"choice":"my_data","confidence":0.92},"clarify":{"yes":0.1},"urgency":{"choice":"x"}}}` + "\n```", nil
	})}
	response, err := llm.Decide(context.Background(), routeRequest())
	if err != nil {
		t.Fatal(err)
	}
	if response.Calibrated || response.Provider != "llm" {
		t.Fatalf("llm must not claim calibration: %+v", response)
	}
	if got := response.Answers["domain"]; got.Choice != "my_data" || got.Confidence != 0.92 {
		t.Fatalf("domain = %+v", got)
	}
	if got := response.Answers["clarify"]; got.Yes != 0.1 || got.Confidence < 0.79 || got.Confidence > 0.81 {
		t.Fatalf("clarify = %+v", got)
	}
	if _, ok := response.Answers["urgency"]; ok {
		t.Fatal("a score question answered with a choice must be dropped")
	}
}

func TestLLMRejectsUnknownChoice(t *testing.T) {
	llm := LLM{Completer: completerFunc(func(context.Context, string, string) (string, error) {
		return `{"answers":{"domain":{"choice":"delete_everything","confidence":1}}}`, nil
	})}
	if _, err := llm.Decide(context.Background(), routeRequest()); !errors.Is(err, ErrNoAnswer) {
		t.Fatalf("err = %v", err)
	}
}

func TestChainFillsFromRulesWhenPrimaryFailsOrTimesOut(t *testing.T) {
	rules := Rules{
		"domain":  Fixed(Answer{Choice: "answer", Confidence: 0.3}),
		"clarify": Fixed(Answer{Yes: 0, Confidence: 0.3}),
	}
	slow := LLM{Completer: completerFunc(func(ctx context.Context, _, _ string) (string, error) {
		<-ctx.Done()
		return "", ctx.Err()
	})}
	response, err := Chain{Primary: slow, Fallback: rules, Timeout: 20 * time.Millisecond}.Decide(context.Background(), routeRequest())
	if err != nil {
		t.Fatal(err)
	}
	if response.Answers["domain"].Choice != "answer" || len(response.FallbackIDs) != 2 || response.Provider != "rules" {
		t.Fatalf("response = %+v", response)
	}

	partial := LLM{Completer: completerFunc(func(context.Context, string, string) (string, error) {
		return `{"answers":{"domain":{"choice":"my_data","confidence":0.8}}}`, nil
	})}
	response, err = Chain{Primary: partial, Fallback: rules}.Decide(context.Background(), routeRequest())
	if err != nil {
		t.Fatal(err)
	}
	if response.Provider != "llm" || response.Answers["domain"].Choice != "my_data" ||
		len(response.FallbackIDs) != 1 || response.FallbackIDs[0] != "clarify" {
		t.Fatalf("response = %+v", response)
	}
}

func TestRequestValidation(t *testing.T) {
	bad := []Request{
		{},
		{State: "x"},
		{State: "x", Questions: []Question{{ID: "a", Kind: KindChoice, Instructions: "i", Options: []Option{{ID: "only"}}}}},
		{State: "x", Questions: []Question{{ID: "a", Kind: "free_text", Instructions: "i"}}},
		{State: "x", Questions: []Question{{ID: "a", Kind: KindYesNo, Instructions: "i"}, {ID: "a", Kind: KindYesNo, Instructions: "i"}}},
	}
	for index, req := range bad {
		if err := req.Validate(); err == nil {
			t.Fatalf("case %d should be invalid", index)
		}
	}
}

func TestClientCompleterTalksToOpenAICompatibleUpstream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		chunk := `{"answers":{"clarify":{"yes":0.9}}}`
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", chunk)
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	client, err := sub2api.New(server.URL+"/v1", "k", "decider", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	llm := LLM{Completer: ClientCompleter{Client: client}, Model: "decider"}
	response, err := llm.Decide(context.Background(), Request{State: "用户：嗯", Questions: []Question{
		{ID: "clarify", Kind: KindYesNo, Instructions: "是否需要追问"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if response.Answers["clarify"].Yes != 0.9 {
		t.Fatalf("response = %+v", response)
	}
}
