package worker

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestInlineTextRunsNeverEnterDownloadableFileMode(t *testing.T) {
	prompt := "请输出一个完整、可直接运行的单文件 HTML 网站，不要引用本地文件"
	if !assistantArtifactRequested(prompt) {
		t.Fatal("prompt should look like a file request to the keyword heuristic")
	}
	run := &store.AssistantRun{Prompt: prompt, Params: map[string]any{}}
	if !assistantRunArtifactRequested(run) {
		t.Fatal("without inlineText the heuristic still applies")
	}
	run.Params["inlineText"] = true
	if assistantRunArtifactRequested(run) {
		t.Fatal("inlineText runs must answer in the message body")
	}
}
