package taskflow

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestTaskNotifyPathOpensOriginPage(t *testing.T) {
	cases := []struct {
		name string
		task *store.Task
		want string
	}{
		{"nil", nil, "/history"},
		{"text to image", &store.Task{Type: "t2i"}, "/text-to-image"},
		{"ecommerce", &store.Task{Type: "ecommerce_design"}, "/ecommerce-design"},
		{"canvas origin wins over type", &store.Task{Type: "t2i", Params: map[string]any{"_source": "react_canvas"}}, "/canvas"},
		{"assistant conversation", &store.Task{Type: "assistant", Params: map[string]any{"conversationId": "6F1C2D3E-0000-4000-8000-000000000001"}}, "/assistant?c=6f1c2d3e-0000-4000-8000-000000000001"},
		{"assistant bad id", &store.Task{Type: "assistant", Params: map[string]any{"conversationId": "x/y"}}, "/assistant"},
		{"media tool", &store.Task{Type: "media_tool", Params: map[string]any{"publicModelKey": "Upscale-V2"}}, "/tools/Upscale-V2"},
		{"media tool unsafe key", &store.Task{Type: "media_tool", Params: map[string]any{"publicModelKey": "../admin"}}, "/history"},
		{"unknown", &store.Task{Type: "mystery"}, "/history"},
	}
	for _, tc := range cases {
		if got := taskNotifyPath(tc.task); got != tc.want {
			t.Errorf("%s: taskNotifyPath = %q, want %q", tc.name, got, tc.want)
		}
	}
}
