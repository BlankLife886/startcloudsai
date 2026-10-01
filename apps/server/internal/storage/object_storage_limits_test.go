package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	appconfig "github.com/BlankLife886/startcloudsai/server/internal/config"
)

func TestObjectReadLimitsReturnTypedErrors(t *testing.T) {
	for _, declaredLength := range []bool{true, false} {
		t.Run(strconv.FormatBool(declaredLength), func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.Method != http.MethodGet || r.URL.Path != "/fixture-bucket/result.bin" {
					t.Errorf("unexpected fixture request: %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/octet-stream")
				if declaredLength {
					w.Header().Set("Content-Length", "9")
				} else {
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
				}
				_, _ = io.WriteString(w, "123456789")
			}))
			defer server.Close()
			objects, err := New(&appconfig.Config{
				ObjectStorageEndpoint: server.URL, ObjectStorageRegion: "test-region",
				ObjectStorageAccessKeyID: "fixture-key", ObjectStorageSecretAccessKey: "fixture-secret",
				ObjectStorageBucket: "fixture-bucket", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 60,
			})
			if err != nil {
				t.Fatal(err)
			}
			data, err := objects.GetBytesLimit(context.Background(), "result.bin", 8)
			if !errors.Is(err, ErrObjectTooLarge) || data != nil {
				t.Fatalf("oversized object must return a typed error without a partial body: bytes=%d error=%v", len(data), err)
			}
			if requests.Load() != 1 {
				t.Fatalf("size errors must not trigger a storage retry: requests=%d", requests.Load())
			}
			data, err = objects.GetBytesLimit(context.Background(), "result.bin", 9)
			if err != nil || string(data) != "123456789" {
				t.Fatalf("exact-limit object should remain readable: bytes=%q error=%v", data, err)
			}
			if declaredLength {
				stream, err := objects.OpenObjectRange(context.Background(), "result.bin", "", 8)
				if stream != nil {
					stream.Body.Close()
				}
				if !errors.Is(err, ErrObjectTooLarge) || stream != nil {
					t.Fatalf("metadata limit should return the same typed error: stream=%v error=%v", stream, err)
				}
			}
		})
	}
}
