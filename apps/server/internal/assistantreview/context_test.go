package assistantreview

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestContextFromKeepsTextBeforeTheTurn(t *testing.T) {
	userID := uuid.New()
	at := time.Now()
	history := []*store.AssistantMessage{
		{ID: uuid.New(), Role: "user", Content: "画一只小狗", Status: "complete", CreatedAt: at},
		{ID: uuid.New(), Role: "assistant", Kind: "image", Status: "complete", CreatedAt: at,
			Metadata: map[string]any{"prompt": "小狗", "images": []any{map[string]any{"id": "1"}}}},
		{ID: uuid.New(), Role: "assistant", Kind: "proposal", Content: "方案已准备", Status: "complete", CreatedAt: at,
			Metadata: map[string]any{"proposal": map[string]any{"prompt": "粉色小狗"}}},
		{ID: uuid.New(), Role: "assistant", Content: "出错了", Status: "failed", CreatedAt: at},
		{ID: userID, Role: "user", Content: "改成 4K", Status: "complete", CreatedAt: at},
		{ID: uuid.New(), Role: "assistant", Content: "之后的回答", Status: "complete", CreatedAt: at},
	}
	context := ContextFrom(history, userID)
	if len(context) != 3 || context[0].Content != "画一只小狗" || context[1].Content != "[生成了 1 张图片：小狗]" ||
		!strings.Contains(context[2].Content, "出了图片方案：粉色小狗") {
		t.Fatalf("context = %+v", context)
	}
}
