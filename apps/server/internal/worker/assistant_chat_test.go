package worker

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

type scriptedAssistantChatClient struct {
	responses []string
	payloads  [][]sub2api.Message
}

func (c *scriptedAssistantChatClient) ChatTextWithImages(
	_ context.Context,
	messages []sub2api.Message,
	_ []string,
	onText func(string) error,
) (string, error) {
	cloned := append([]sub2api.Message(nil), messages...)
	c.payloads = append(c.payloads, cloned)
	response := c.responses[len(c.payloads)-1]
	for end := 1; end <= len(response); end++ {
		if onText != nil {
			if err := onText(response[:end]); err != nil {
				return response[:end], err
			}
		}
	}
	return response, nil
}

func leakedSearchResponse(prompt, suffix string) string {
	return "search(" + strconv.QuoteToASCII(prompt) + ")" + suffix
}

func TestRequestAssistantChatTextRemovesMatchingLeakedSearchPrefix(t *testing.T) {
	prompt := "user: 参考图片编号：图片1、图片2。请按这些编号理解提示词中的图片引用。"
	client := &scriptedAssistantChatClient{responses: []string{
		leakedSearchResponse(prompt, "## 电商产品制作简报\n\n- 产品：无线耳机"),
	}}
	var snapshots []string
	text, err := requestAssistantChatText(context.Background(), client,
		[]sub2api.Message{{Role: "user", Content: prompt}}, prompt,
		func(value string) error {
			snapshots = append(snapshots, value)
			return nil
		}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "## 电商产品制作简报\n\n- 产品：无线耳机" {
		t.Fatalf("text = %q", text)
	}
	if len(snapshots) == 0 || snapshots[len(snapshots)-1] != text {
		t.Fatalf("snapshots = %#v", snapshots)
	}
	for _, snapshot := range snapshots {
		if strings.Contains(snapshot, "search(") || strings.Contains(snapshot, `\\u53c2`) {
			t.Fatalf("leaked snapshot = %q", snapshot)
		}
	}
}

func TestRequestAssistantChatTextRetriesEmptyLeakedSearchOutput(t *testing.T) {
	prompt := "user: 分析这张商品图"
	client := &scriptedAssistantChatClient{responses: []string{
		leakedSearchResponse(prompt, ""),
		"这是可用的商品分析。",
	}}
	text, err := requestAssistantChatText(context.Background(), client,
		[]sub2api.Message{{Role: "user", Content: prompt}}, prompt, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "这是可用的商品分析。" || len(client.payloads) != 2 {
		t.Fatalf("text=%q requests=%d", text, len(client.payloads))
	}
	if got := client.payloads[1][0]; got.Role != "system" || got.Content != assistantChatRetryInstruction {
		t.Fatalf("retry instruction = %#v", got)
	}
}

func TestRequestAssistantChatTextFailsAfterRepeatedEmptyLeak(t *testing.T) {
	prompt := "user: 分析这张商品图"
	leaked := leakedSearchResponse(prompt, "")
	client := &scriptedAssistantChatClient{responses: []string{leaked, leaked}}
	_, err := requestAssistantChatText(context.Background(), client,
		[]sub2api.Message{{Role: "user", Content: prompt}}, prompt, nil, nil)
	if !errors.Is(err, errAssistantLeakedToolOutput) {
		t.Fatalf("error = %v", err)
	}
}

func TestCleanAssistantChatOutputPreservesLegitimateSearchText(t *testing.T) {
	prompt := "user: 解释 search 函数"
	for _, value := range []string{
		`代码示例：search("user: query")`,
		`search("user: another prompt") is a code example`,
		"```js\nsearch(\"user: query\")\n```",
	} {
		cleaned, leaked := cleanAssistantChatOutput(value, prompt)
		if leaked || cleaned != value {
			t.Fatalf("value=%q cleaned=%q leaked=%v", value, cleaned, leaked)
		}
	}
}
