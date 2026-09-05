package worker

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

func TestEnsureUpstreamOutputErrorRetriesEmptyCompletion(t *testing.T) {
	err := ensureUpstreamOutputError(nil, nil)
	if err == nil || !c2a.IsRetryableError(err) {
		t.Fatalf("empty upstream completion must be retryable: %v", err)
	}
	existing := &c2a.UpstreamError{Message: "explicit failure"}
	if got := ensureUpstreamOutputError(existing, nil); got != existing {
		t.Fatalf("existing error changed: %v", got)
	}
	if got := ensureUpstreamOutputError(nil, []string{"stored/output.png"}); got != nil {
		t.Fatalf("stored output should stay successful: %v", got)
	}
}

func TestShouldRecoverEmptyOpenAISubmit(t *testing.T) {
	attemptID := uuid.New()
	if !shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, false, nil, nil) {
		t.Fatal("configured OpenAI empty submit must enter asynchronous recovery")
	}
	if shouldRecoverEmptyOpenAISubmit(uuid.Nil, modelconfig.AdapterOpenAI, false, nil, nil) {
		t.Fatal("legacy request without a durable attempt cannot enter recovery")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterCRUN, false, nil, nil) {
		t.Fatal("CRUN empty submit must keep its adapter-specific handling")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, false, []string{"image"}, nil) {
		t.Fatal("completed OpenAI image must not enter recovery")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, false, nil, errors.New("explicit failure")) {
		t.Fatal("explicit OpenAI failure must be preserved")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, true, nil, nil) {
		t.Fatal("synchronous OpenAI edit must not enter asynchronous recovery")
	}
}

func TestCallConfiguredUpstreamPropagatesReferenceImageTextResult(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	objectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/test-bucket/input.png" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png)
	}))
	defer objectServer.Close()
	objectStorage, err := storage.New(&config.Config{
		ObjectStorageEndpoint: objectServer.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test",
		ObjectStorageBucket: "test-bucket", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300,
	})
	if err != nil {
		t.Fatal(err)
	}

	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/edits" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":{"content":[{"type":"output_text","text":"无法按当前参考图生成图片"}]}}`))
	}))
	defer upstreamServer.Close()

	w := &Worker{Cfg: &config.Config{AppEnv: "development"}, Storage: objectStorage}
	task := &store.Task{
		ID: uuid.New(), Type: "t2i", Prompt: "edit the image", Params: map[string]any{}, Count: 1,
		InputKeys: []string{"input.png"},
	}
	images, err := w.callConfiguredUpstream(context.Background(), task, &modelconfig.Selection{
		Provider: modelconfig.Provider{
			Adapter: modelconfig.AdapterOpenAI, BaseURL: upstreamServer.URL, APIKey: "test", TimeoutSecs: 30,
		},
		Model: modelconfig.Model{UpstreamModel: "gpt-image-2"},
	}, nil)
	if len(images) != 0 || err == nil || err.Error() != "无法按当前参考图生成图片" || c2a.IsRetryableError(err) {
		t.Fatalf("images=%#v err=%v retryable=%v, want immediate non-retryable text result", images, err, c2a.IsRetryableError(err))
	}
}
