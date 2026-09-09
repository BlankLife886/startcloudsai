package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
)

func TestReadOpenAIImageBytesMapsStorageLimit(t *testing.T) {
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = io.WriteString(w, "123456789")
	}))
	defer fixture.Close()
	objects, err := storage.New(&config.Config{
		ObjectStorageEndpoint: fixture.URL, ObjectStorageRegion: "test-region",
		ObjectStorageAccessKeyID: "fixture-key", ObjectStorageSecretAccessKey: "fixture-secret",
		ObjectStorageBucket: "fixture-bucket", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 60,
	})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{Storage: objects}
	ctx := context.Background()
	_, err = server.readOwnedTaskImageBytes(ctx, "result.png", 8)
	if !errors.Is(err, errTaskImageMissing) || !errors.Is(err, storage.ErrObjectTooLarge) {
		t.Fatalf("the shared reader must preserve both classifications: %v", err)
	}
	data, err := server.readOpenAIImageBytes(ctx, "result.png", 8)
	appErr, ok := apperr.As(err)
	if !ok || appErr.Status != http.StatusRequestEntityTooLarge || appErr.Code != "image_response_too_large" || data != nil {
		t.Fatalf("oversized result must offer delivery recovery instead of a 500: bytes=%d error=%v", len(data), err)
	}
	if !strings.Contains(appErr.Message, "response_format=url") || !strings.Contains(appErr.Message, "same Idempotency-Key") {
		t.Fatalf("recovery advice must preserve the original paid task: %q", appErr.Message)
	}
	data, err = server.readOpenAIImageBytes(ctx, "result.png", 9)
	if err != nil || string(data) != "123456789" {
		t.Fatalf("images at the limit must still be returned: bytes=%q error=%v", data, err)
	}
}
