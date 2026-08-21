package sub2api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestUnexpectedEOFIsRetryableForImageRequests(t *testing.T) {
	if !transientImageError(io.ErrUnexpectedEOF) {
		t.Fatal("unexpected EOF should be retried")
	}
}

func TestRetryableOnAlternateRouteClassifiesRouteFailures(t *testing.T) {
	for _, err := range []error{
		&UpstreamError{Status: http.StatusUnauthorized, Message: "bad key"},
		&UpstreamError{Status: http.StatusTooManyRequests, Message: "busy"},
		errChatStreamIncomplete,
	} {
		if !RetryableOnAlternateRoute(context.Background(), err) {
			t.Fatalf("expected retryable route error: %v", err)
		}
	}
	if RetryableOnAlternateRoute(context.Background(), &UpstreamError{Status: http.StatusBadRequest, Message: "bad request"}) {
		t.Fatal("400 validation errors must not fail over")
	}
}

func TestFailureCodeClassifiesProviderFailures(t *testing.T) {
	tests := []struct {
		err  error
		want string
	}{
		{context.Canceled, "assistant_interrupted"},
		{context.DeadlineExceeded, "upstream_timeout"},
		{errChatStreamIdle, "upstream_timeout"},
		{errChatStreamTruncated, "output_limit_reached"},
		{errChatStreamFiltered, "content_filtered"},
		{errChatStreamIncomplete, "upstream_stream_incomplete"},
		{errChatStreamEmpty, "upstream_empty_response"},
		{&UpstreamError{Status: http.StatusUnauthorized}, "upstream_auth_failed"},
		{&UpstreamError{Status: http.StatusTooManyRequests}, "upstream_rate_limited"},
		{&UpstreamError{Status: http.StatusBadGateway}, "upstream_unavailable"},
		{&UpstreamError{Status: http.StatusUnprocessableEntity}, "upstream_rejected"},
		{errors.New("other"), "assistant_run_failed"},
	}
	for _, test := range tests {
		if got := FailureCode(test.err); got != test.want {
			t.Errorf("FailureCode(%v) = %q, want %q", test.err, got, test.want)
		}
	}
}

func TestApplyChatOutputLimitUsesModelCompatibleField(t *testing.T) {
	tests := []struct {
		model   string
		field   string
		missing string
	}{
		{model: "gpt-4.1", field: "max_tokens", missing: "max_completion_tokens"},
		{model: "gpt-5.4", field: "max_completion_tokens", missing: "max_tokens"},
		{model: "o3-mini", field: "max_completion_tokens", missing: "max_tokens"},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			payload := map[string]any{}
			(&Client{chatModel: tt.model, maxOutputTokens: 4096}).applyChatOutputLimit(payload)
			if payload[tt.field] != 4096 {
				t.Fatalf("payload = %#v", payload)
			}
			if _, exists := payload[tt.missing]; exists {
				t.Fatalf("incompatible token field present: %#v", payload)
			}
		})
	}
}

func TestChatStreamUsesOpenAIContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("request = %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "gpt-test" || body["stream"] != true || body["max_tokens"] != float64(2048) || body["reasoning_effort"] != "high" {
			t.Fatalf("body = %#v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, err := New(server.URL+"/v1", "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.WithMaxOutputTokens(2048).WithReasoningEffort(" HIGH ").ChatStream(
		context.Background(), []Message{{Role: "user", Content: "hello"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestChatStreamSupportsProviderAPIKeyHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "test-key" {
			t.Fatalf("authorization=%q x-api-key=%q", r.Header.Get("Authorization"), r.Header.Get("x-api-key"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, err := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.WithAPIKeyHeader("x-api-key").ChatStream(
		context.Background(), []Message{{Role: "user", Content: "hello"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestChatTextWithImagesPublishesCumulativeSSEDeltas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("response writer does not support flushing")
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"，世界\"}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	var snapshots []string
	text, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil,
		func(fullText string) error {
			snapshots = append(snapshots, fullText)
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if text != "你好，世界" {
		t.Fatalf("text = %q", text)
	}
	want := []string{"你好", "你好，世界"}
	if len(snapshots) != len(want) {
		t.Fatalf("snapshots = %#v", snapshots)
	}
	for index := range want {
		if snapshots[index] != want[index] {
			t.Fatalf("snapshot %d = %q, want %q", index, snapshots[index], want[index])
		}
	}
}

func TestChatTextWithImagesFinalMessageReplacesStreamedText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"你好"}}]}`+"\n\n")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"，世界"}}]}`+"\n\n")
		fmt.Fprint(w, `data: {"choices":[{"message":{"content":"你好，世界"}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	text, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "你好，世界" {
		t.Fatalf("text = %q", text)
	}
}

func TestChatTextWithImagesRejectsPrematureEOF(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"半截回答"}}]}`+"\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	text, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil, nil)
	if !errors.Is(err, errChatStreamIncomplete) || text != "半截回答" || requests != 1 {
		t.Fatalf("text=%q requests=%d err=%v", text, requests, err)
	}
}

func TestChatTextWithImagesAcceptsFinishReasonWithoutDoneMarker(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"完整回答"}}]}`+"\n\n")
		fmt.Fprint(w, `data: {"choices":[{"finish_reason":"stop"}]}`+"\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	text, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil, nil)
	if err != nil || text != "完整回答" {
		t.Fatalf("text=%q err=%v", text, err)
	}
}

func TestChatTextWithImagesRejectsTruncatedFinishReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"过长"},"finish_reason":"length"}]}`+"\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	_, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil, nil)
	if !errors.Is(err, errChatStreamTruncated) {
		t.Fatalf("err=%v", err)
	}
}

func TestChatTextWithImagesEnforcesIdleTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, ": connected\n\n")
		flusher.Flush()
		time.Sleep(100 * time.Millisecond)
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	client.streamIdleTimeout = 20 * time.Millisecond
	_, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil, nil)
	if !errors.Is(err, errChatStreamIdle) {
		t.Fatalf("err=%v", err)
	}
}

func TestStreamTextFragmentsPrefersTopLevelProviderDelta(t *testing.T) {
	fragments := streamTextFragments(map[string]any{
		"delta": "唯一增量",
		"choices": []any{map[string]any{
			"delta": map[string]any{"content": "重复增量"},
		}},
	})
	if len(fragments) != 1 || fragments[0].value != "唯一增量" {
		t.Fatalf("fragments = %#v", fragments)
	}
}

func TestChatTextWithImagesDoesNotRetryCallbackFailure(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"部分输出"}}]}`+"\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	_, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil,
		func(string) error { return errors.New("temporary callback failure") })
	if err == nil {
		t.Fatal("expected callback failure")
	}
	if requests != 1 {
		t.Fatalf("callback failure retried %d requests", requests)
	}
}

func TestChatAgentWithImagesStreamsTextReasoningAndToolArguments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		tools, _ := body["tools"].([]any)
		if len(tools) != 1 {
			t.Fatalf("tools = %#v", body["tools"])
		}
		tool, _ := tools[0].(map[string]any)
		function, _ := tool["function"].(map[string]any)
		parameters, _ := function["parameters"].(map[string]any)
		properties, _ := parameters["properties"].(map[string]any)
		if function["name"] != "propose_image_action" || properties["count"] == nil {
			t.Fatalf("function tool = %#v", function)
		}
		if _, exists := tool["n"]; exists {
			t.Fatalf("n must be inside function parameters: %#v", tool)
		}
		choice, _ := body["tool_choice"].(map[string]any)
		choiceFunction, _ := choice["function"].(map[string]any)
		if choice["type"] != "function" || choiceFunction["name"] != "propose_image_action" {
			t.Fatalf("tool_choice = %#v", body["tool_choice"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"我会","reasoning_content":"分析","tool_calls":[{"index":0,"function":{"name":"propose_image_action","arguments":"{\"action\":\"generate\","}}]}}]}`+"\n\n")
		flusher.Flush()
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"准备方案","tool_calls":[{"index":0,"function":{"arguments":"\"prompt\":\"星空\"}"}}]}}]}`+"\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	var snapshots []string
	result, err := client.ChatAgentWithImages(context.Background(), []Message{{Role: "user", Content: "生成星空"}}, nil,
		FunctionTool{Name: "propose_image_action", Parameters: map[string]any{
			"type": "object", "properties": map[string]any{"count": map[string]any{"type": "integer"}},
		}}, true, func(text, reasoning string) error {
			snapshots = append(snapshots, text+"|"+reasoning)
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "我会准备方案" || result.Reasoning != "分析" {
		t.Fatalf("result = %#v", result)
	}
	if result.ToolCall == nil || result.ToolCall.Name != "propose_image_action" || result.ToolCall.Arguments != `{"action":"generate","prompt":"星空"}` {
		t.Fatalf("tool call = %#v", result.ToolCall)
	}
	if len(snapshots) != 2 || snapshots[0] != "我会|分析" || snapshots[1] != "我会准备方案|分析" {
		t.Fatalf("snapshots = %#v", snapshots)
	}
}

func TestChatAgentWithToolsSupportsRequiredChoice(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["tool_choice"] != RequiredToolChoice {
			t.Fatalf("tool_choice = %#v", body["tool_choice"])
		}
		tools, _ := body["tools"].([]any)
		declaration, _ := tools[0].(map[string]any)
		function, _ := declaration["function"].(map[string]any)
		if function["strict"] != true {
			t.Fatalf("strict tool declaration = %#v", declaration)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"canvas_reply","arguments":"{\"content\":\"你好\"}"}}]}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	result, err := client.ChatAgentWithTools(context.Background(), []Message{{Role: "user", Content: "你好"}}, nil,
		[]FunctionTool{{Name: "canvas_reply", Parameters: map[string]any{"type": "object"}, Strict: true}}, RequiredToolChoice, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.ToolCall == nil || result.ToolCall.Name != "canvas_reply" {
		t.Fatalf("result = %#v", result)
	}
}

func TestChatAgentWithToolsSendsReasoningEffortAndReadsUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["reasoning_effort"] != "xhigh" {
			t.Fatalf("reasoning_effort = %#v", body["reasoning_effort"])
		}
		streamOptions, _ := body["stream_options"].(map[string]any)
		if streamOptions["include_usage"] != true {
			t.Fatalf("stream_options = %#v", body["stream_options"])
		}
		if body["parallel_tool_calls"] != false {
			t.Fatalf("parallel_tool_calls = %#v", body["parallel_tool_calls"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"reasoning_content":"真实分析"}}]}`+"\n\n")
		fmt.Fprint(w, `data: {"choices":[],"usage":{"completion_tokens":42,"completion_tokens_details":{"reasoning_tokens":17}}}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	result, err := client.WithReasoningEffort(" XHIGH ").ChatAgentWithTools(
		context.Background(),
		[]Message{{Role: "user", Content: "分析画布"}},
		nil,
		[]FunctionTool{{Name: "canvas_reply", Parameters: map[string]any{"type": "object"}}},
		RequiredToolChoice,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Reasoning != "真实分析" || result.ReasoningTokens != 17 {
		t.Fatalf("result = %#v", result)
	}
}

func TestChatAgentWithToolsOmitsEmptyReasoningEffort(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if _, exists := body["reasoning_effort"]; exists {
			t.Fatalf("reasoning_effort must be omitted: %#v", body["reasoning_effort"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"canvas_reply","arguments":"{}"}}]}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-5-6", "image-test", 30)
	_, err := client.WithReasoningEffort("  ").ChatAgentWithTools(
		context.Background(),
		[]Message{{Role: "user", Content: "分析画布"}},
		nil,
		[]FunctionTool{{Name: "canvas_reply", Parameters: map[string]any{"type": "object"}}},
		RequiredToolChoice,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
}

func TestChatAgentWithImagesFinalMessageReplacesStreamedSnapshots(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"准备","reasoning_content":"先分析","tool_calls":[{"index":0,"function":{"name":"propose_image_action","arguments":"{\"count\":"}}]}}]}`+"\n\n")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"方案","reasoning_content":"再规划","tool_calls":[{"index":0,"function":{"arguments":"3}"}}]}}]}`+"\n\n")
		fmt.Fprint(w, `data: {"choices":[{"message":{"content":"准备方案","reasoning_content":"先分析再规划","tool_calls":[{"index":0,"function":{"name":"propose_image_action","arguments":"{\"count\":3}"}}]}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	result, err := client.ChatAgentWithImages(context.Background(), []Message{{Role: "user", Content: "生成三张图"}}, nil,
		FunctionTool{Name: "propose_image_action", Parameters: map[string]any{"type": "object"}}, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "准备方案" || result.Reasoning != "先分析再规划" {
		t.Fatalf("final snapshots were duplicated: %#v", result)
	}
	if result.ToolCall == nil || result.ToolCall.Arguments != `{"count":3}` {
		t.Fatalf("final tool call = %#v", result.ToolCall)
	}
}

func TestChatAgentWithImagesRetriesTransientFailureBeforeOutput(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		if requests == 1 {
			http.Error(w, `{"error":{"message":"temporary gateway error"}}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"恢复成功"}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	result, err := client.ChatAgentWithImages(context.Background(), []Message{{Role: "user", Content: "你好"}}, nil,
		FunctionTool{Name: "propose_image_action", Parameters: map[string]any{"type": "object"}}, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || result.Text != "恢复成功" {
		t.Fatalf("requests=%d result=%#v", requests, result)
	}
}

func TestChatAgentRejectsMultipleToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"delta":{"tool_calls":[`+
			`{"index":0,"function":{"name":"first","arguments":"{}"}},`+
			`{"index":1,"function":{"name":"second","arguments":"{}"}}]}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	_, err := client.ChatAgentWithTools(context.Background(), []Message{{Role: "user", Content: "run"}}, nil,
		[]FunctionTool{{Name: "first", Parameters: map[string]any{"type": "object"}}, {Name: "second", Parameters: map[string]any{"type": "object"}}}, "", nil)
	if err == nil || !strings.Contains(err.Error(), "multiple tool calls") {
		t.Fatalf("err=%v", err)
	}
}

func TestStreamToolCallFragmentsSupportsLegacyFunctionCall(t *testing.T) {
	fragments := streamToolCallFragments(map[string]any{
		"choices": []any{map[string]any{
			"delta": map[string]any{"function_call": map[string]any{
				"name": "propose_image_action", "arguments": `{"count":3}`,
			}},
		}},
	})
	if len(fragments) != 1 || fragments[0].name != "propose_image_action" || fragments[0].arguments != `{"count":3}` {
		t.Fatalf("fragments = %#v", fragments)
	}
}

func TestChatStreamIsNotCutOffByHTTPClientTotalTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"持续\"}}]}\n\n")
		flusher.Flush()
		time.Sleep(40 * time.Millisecond)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"输出\"}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	client.httpClient.Timeout = 15 * time.Millisecond
	text, err := client.ChatTextWithImages(context.Background(), []Message{{Role: "user", Content: "hello"}}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "持续输出" {
		t.Fatalf("text = %q", text)
	}
}

func TestChatStreamWithImagesUsesMultimodalContent(t *testing.T) {
	reference := "data:image/png;base64,aW1hZ2U="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		parts, ok := body.Messages[len(body.Messages)-1].Content.([]any)
		if !ok || len(parts) != 2 {
			t.Fatalf("content = %#v", body.Messages[len(body.Messages)-1].Content)
		}
		imagePart, ok := parts[1].(map[string]any)
		imageURL, _ := imagePart["image_url"].(map[string]any)
		if !ok || imagePart["type"] != "image_url" || imageURL["url"] != reference {
			t.Fatalf("image part = %#v", parts[1])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	resp, err := client.ChatStreamWithImages(context.Background(), []Message{
		{Role: "assistant", Content: "请上传图片"},
		{Role: "user", Content: "识别图片中的文字"},
	}, []string{reference})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestChatStreamWithImagesPreservesPerMessageVisualContext(t *testing.T) {
	reference := "data:image/png;base64,aGlzdG9yeQ=="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		parts, ok := body.Messages[0].Content.([]any)
		if !ok || len(parts) != 2 {
			t.Fatalf("historical content = %#v", body.Messages[0].Content)
		}
		imagePart, _ := parts[1].(map[string]any)
		imageURL, _ := imagePart["image_url"].(map[string]any)
		if imageURL["url"] != reference {
			t.Fatalf("historical image = %#v", imagePart)
		}
		if body.Messages[2].Content != "图片里写了什么？" {
			t.Fatalf("latest content = %#v", body.Messages[2].Content)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	resp, err := client.ChatStreamWithImages(context.Background(), []Message{
		{Role: "user", Content: "请看这张图片", ReferenceImages: []string{reference}},
		{Role: "assistant", Content: "好的"},
		{Role: "user", Content: "图片里写了什么？"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestGenerateImageFansOutWithoutNAndCombinesResults(t *testing.T) {
	var mu sync.Mutex
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, exists := body["n"]; exists {
			t.Errorf("request unexpectedly contains n: %#v", body["n"])
		}
		if body["size"] != "1024x576" {
			t.Errorf("size = %#v", body["size"])
		}
		if body["prompt"] != "cloud\n\n输出图片尺寸为 1024x576。输出图片分辨率为 1K。输出图片质量为 high。" {
			t.Errorf("prompt = %#v", body["prompt"])
		}
		mu.Lock()
		requestCount++
		index := requestCount
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":"aW1hZ2Ut%d","revised_prompt":"cloud %d"}]}`, index, index)
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "gpt-image-2", 30)
	images, err := client.GenerateImage(context.Background(), "cloud", "1024x576", "high", 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 2 {
		t.Fatalf("images = %#v", images)
	}
	mu.Lock()
	defer mu.Unlock()
	if requestCount != 2 {
		t.Fatalf("requestCount = %d", requestCount)
	}
}

func TestGenerateImageProgressivePublishesBeforeAllBranchesFinish(t *testing.T) {
	var mu sync.Mutex
	requestCount := 0
	releaseSlow := make(chan struct{})
	slowStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		requestCount++
		requestNumber := requestCount
		mu.Unlock()
		if requestNumber == 2 {
			close(slowStarted)
			<-releaseSlow
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":"aW1hZ2U=","revised_prompt":"image %d"}]}`, requestNumber)
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "gpt-image-2", 30)
	callback := make(chan int, 2)
	done := make(chan error, 1)
	go func() {
		_, err := client.GenerateImageProgressive(context.Background(), "cloud", "1024x1024", "high", 2, nil,
			func(index int, _ Image) error {
				callback <- index
				return nil
			})
		done <- err
	}()

	select {
	case <-slowStarted:
	case <-time.After(time.Second):
		t.Fatal("slow branch did not start")
	}
	select {
	case <-callback:
	case <-time.After(time.Second):
		t.Fatal("first completed image was not published while another branch was pending")
	}
	select {
	case err := <-done:
		t.Fatalf("generation returned before slow branch was released: %v", err)
	default:
	}
	close(releaseSlow)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestGenerateImageUsesEditsForReferenceImages(t *testing.T) {
	reference := "data:image/png;base64,aW1hZ2U="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var body struct {
			Images        []map[string]string `json:"images"`
			InputFidelity string              `json:"input_fidelity"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Images) != 1 || body.Images[0]["image_url"] != reference {
			t.Fatalf("images = %#v", body.Images)
		}
		if body.InputFidelity != "high" {
			t.Fatalf("input_fidelity = %q", body.InputFidelity)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"b64_json":"ZWRpdGVk"}]}`)
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "gpt-image-2", 30)
	images, err := client.GenerateImageProgressiveWithOptions(
		context.Background(), "translate text", "1024x1024", "high", 1,
		[]string{reference}, ImageOptions{InputFidelity: "high"}, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].DataURL != "data:image/png;base64,ZWRpdGVk" {
		t.Fatalf("images = %#v", images)
	}
}

func TestBuildImagePromptAutoSize(t *testing.T) {
	if got := buildImagePrompt(" cloud ", "auto", "auto"); got != "cloud" {
		t.Fatalf("prompt = %q", got)
	}
}

func TestListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("request = %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"id":"gpt-test"},{"id":"image-test"}]}`)
	}))
	defer server.Close()

	client, err := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "gpt-test" || models[1] != "image-test" {
		t.Fatalf("models = %#v", models)
	}
}
