package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	appconfig "github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/aws/smithy-go"
)

type statusError int

func (e statusError) Error() string       { return "response error" }
func (e statusError) HTTPStatusCode() int { return int(e) }

func TestIsNotFound(t *testing.T) {
	missing := &smithy.GenericAPIError{Code: "NoSuchKey", Message: "missing"}
	if !IsNotFound(missing) {
		t.Fatal("NoSuchKey must map to not found")
	}
	if !IsNotFound(fmt.Errorf("wrapped: %w", missing)) {
		t.Fatal("wrapped NoSuchKey must map to not found")
	}
	if !IsNotFound(fmt.Errorf("wrapped: %w", statusError(404))) {
		t.Fatal("wrapped HTTP 404 must map to not found")
	}
	if IsNotFound(statusError(500)) {
		t.Fatal("HTTP 500 must not map to not found")
	}
	if IsNotFound(&smithy.GenericAPIError{Code: "AccessDenied"}) {
		t.Fatal("AccessDenied must not map to not found")
	}
	if IsNotFound(errors.New("plain error")) {
		t.Fatal("plain errors must not map to not found")
	}
}

func TestTransientObjectReadError(t *testing.T) {
	for _, err := range []error{
		context.DeadlineExceeded,
		io.EOF,
		io.ErrUnexpectedEOF,
		statusError(503),
		errors.New("remote error: tls handshake timeout"),
	} {
		if !transientObjectReadError(err) {
			t.Fatalf("expected transient error: %v", err)
		}
	}
	for _, err := range []error{
		context.Canceled,
		statusError(404),
		errors.New("access denied"),
	} {
		if transientObjectReadError(err) {
			t.Fatalf("expected permanent error: %v", err)
		}
	}
}

func TestValidateConfigRejectsIncompleteConfig(t *testing.T) {
	err := ValidateConfig(&appconfig.Config{ObjectStorageBucket: "starcloudsai"})
	if err == nil {
		t.Fatal("incomplete object storage configuration must be rejected")
	}
	for _, key := range []string{"OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("error %q does not mention %s", err, key)
		}
	}
}

func TestValidateConfigAcceptsOSS(t *testing.T) {
	cfg := &appconfig.Config{
		ObjectStorageEndpoint:          "https://s3.oss-cn-hongkong.aliyuncs.com",
		ObjectStorageRegion:            "cn-hongkong",
		ObjectStorageAccessKeyID:       "test-access-key",
		ObjectStorageSecretAccessKey:   "test-secret-key",
		ObjectStorageBucket:            "starcloudsai",
		ObjectStoragePresignExpireSecs: 3600,
		ObjectStorageCDNBaseURL:        "https://media.example.com/assets",
	}
	if err := ValidateConfig(cfg); err != nil {
		t.Fatalf("valid OSS configuration rejected: %v", err)
	}
}

func TestOSSPresignUsesVirtualHostedBucketAndConfiguredRegion(t *testing.T) {
	cfg := &appconfig.Config{
		ObjectStorageEndpoint:          "https://s3.oss-cn-hongkong-internal.aliyuncs.com",
		ObjectStoragePublicEndpoint:    "https://s3.oss-cn-hongkong.aliyuncs.com",
		ObjectStorageRegion:            "cn-hongkong",
		ObjectStorageAccessKeyID:       "test-access-key",
		ObjectStorageSecretAccessKey:   "test-secret-key",
		ObjectStorageBucket:            "starcloudsai-test",
		ObjectStoragePresignExpireSecs: 900,
	}
	storage, err := New(cfg)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	rawURL, err := storage.PresignGet(context.Background(), "private/user 1/input.png")
	if err != nil {
		t.Fatalf("PresignGet() error = %v", err)
	}
	presigned, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse presigned URL: %v", err)
	}
	if presigned.Host != "starcloudsai-test.s3.oss-cn-hongkong.aliyuncs.com" {
		t.Fatalf("presigned host = %q", presigned.Host)
	}
	if presigned.EscapedPath() != "/private/user%201/input.png" {
		t.Fatalf("presigned path = %q", presigned.EscapedPath())
	}
	credential := presigned.Query().Get("X-Amz-Credential")
	if !strings.Contains(credential, "/cn-hongkong/s3/aws4_request") {
		t.Fatalf("presigned credential uses wrong region: %q", credential)
	}
}

func TestOSSUploadDoesNotUseUnsupportedAWSChunkedTrailer(t *testing.T) {
	payload := []byte("test-image-data")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/starcloudsai-test/tasks/test.png" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if got := strings.ToLower(r.Header.Get("Content-Encoding")); strings.Contains(got, "aws-chunked") {
			t.Fatalf("unsupported content encoding sent: %q", got)
		}
		if got := r.Header.Get("X-Amz-Trailer"); got != "" {
			t.Fatalf("unsupported checksum trailer sent: %q", got)
		}
		if got := r.Header.Get("X-Amz-Sdk-Checksum-Algorithm"); got != "" {
			t.Fatalf("optional checksum algorithm sent: %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read upload body: %v", err)
		}
		if string(body) != string(payload) {
			t.Fatalf("upload body = %q, want %q", body, payload)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	storage, err := New(&appconfig.Config{
		ObjectStorageEndpoint:          server.URL,
		ObjectStorageRegion:            "ap-northeast-1",
		ObjectStorageAccessKeyID:       "test-access-key",
		ObjectStorageSecretAccessKey:   "test-secret-key",
		ObjectStorageBucket:            "starcloudsai-test",
		ObjectStorageUsePathStyle:      true,
		ObjectStoragePresignExpireSecs: 900,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := storage.UploadBytes(context.Background(), "tasks/test.png", payload, "image/png"); err != nil {
		t.Fatalf("UploadBytes() error = %v", err)
	}
}

func TestValidateConfigRejectsInvalidPublicEndpoint(t *testing.T) {
	cfg := &appconfig.Config{
		ObjectStorageEndpoint:          "https://s3.oss-cn-hongkong-internal.aliyuncs.com",
		ObjectStoragePublicEndpoint:    "file:///private/oss",
		ObjectStorageAccessKeyID:       "test-access-key",
		ObjectStorageSecretAccessKey:   "test-secret-key",
		ObjectStorageBucket:            "starcloudsai",
		ObjectStoragePresignExpireSecs: 3600,
	}
	err := ValidateConfig(cfg)
	if err == nil || !strings.Contains(err.Error(), "OBJECT_STORAGE_PUBLIC_ENDPOINT") {
		t.Fatalf("unexpected validation error: %v", err)
	}
}

func TestPublicURL(t *testing.T) {
	base, err := url.Parse("https://media.example.com/assets")
	if err != nil {
		t.Fatal(err)
	}
	storage := &Storage{cdnBaseURL: base}
	got, ok := storage.PublicURL("outputs/user 1/result #1.png")
	if !ok {
		t.Fatal("configured CDN must return a URL")
	}
	if want := "https://media.example.com/assets/outputs/user%201/result%20%231.png"; got != want {
		t.Fatalf("PublicURL() = %q, want %q", got, want)
	}
	if got, ok := (&Storage{}).PublicURL("private/input.png"); ok || got != "" {
		t.Fatalf("unconfigured CDN returned %q, %v", got, ok)
	}
}

func TestOSSDeleteKeysUsesBoundedIndividualRequests(t *testing.T) {
	keys := make([]string, 24)
	for i := range keys {
		keys[i] = fmt.Sprintf("tasks/user/task/original/%d.png", i)
	}

	var active atomic.Int32
	var maxActive atomic.Int32
	var requestsMu sync.Mutex
	requests := make(map[string]int, len(keys))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("method = %s, want DELETE", r.Method)
			http.Error(w, "unexpected method", http.StatusBadRequest)
			return
		}
		if r.URL.Query().Has("delete") {
			t.Errorf("multi-delete query must not be used: %q", r.URL.RawQuery)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read delete body: %v", err)
		}
		if len(body) != 0 {
			t.Errorf("individual delete body = %q", body)
		}
		if got := r.Header.Get("X-Amz-Trailer"); got != "" {
			t.Errorf("unsupported checksum trailer sent: %q", got)
		}

		current := active.Add(1)
		defer active.Add(-1)
		for {
			observed := maxActive.Load()
			if current <= observed || maxActive.CompareAndSwap(observed, current) {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
		requestsMu.Lock()
		requests[r.URL.Path]++
		requestsMu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	storage, err := New(&appconfig.Config{
		ObjectStorageEndpoint:          server.URL,
		ObjectStorageRegion:            "ap-northeast-1",
		ObjectStorageAccessKeyID:       "test-access-key",
		ObjectStorageSecretAccessKey:   "test-secret-key",
		ObjectStorageBucket:            "starcloudsai-test",
		ObjectStorageUsePathStyle:      true,
		ObjectStoragePresignExpireSecs: 900,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := storage.DeleteKeys(context.Background(), keys); err != nil {
		t.Fatalf("DeleteKeys() error = %v", err)
	}
	if got := maxActive.Load(); got < 2 || got > objectDeleteConcurrency {
		t.Fatalf("maximum concurrent deletes = %d, want 2..%d", got, objectDeleteConcurrency)
	}
	for _, key := range keys {
		path := "/starcloudsai-test/" + key
		if requests[path] != 1 {
			t.Errorf("requests for %q = %d, want 1", path, requests[path])
		}
	}
}

func TestOSSDeleteKeysTreatsMissingObjectsAsSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`)
	}))
	defer server.Close()

	storage, err := New(&appconfig.Config{
		ObjectStorageEndpoint:          server.URL,
		ObjectStorageRegion:            "ap-northeast-1",
		ObjectStorageAccessKeyID:       "test-access-key",
		ObjectStorageSecretAccessKey:   "test-secret-key",
		ObjectStorageBucket:            "starcloudsai-test",
		ObjectStorageUsePathStyle:      true,
		ObjectStoragePresignExpireSecs: 900,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := storage.DeleteKeys(context.Background(), []string{"already-gone.png"}); err != nil {
		t.Fatalf("missing object should be idempotent: %v", err)
	}
}

func TestSummarizeDeleteErrorsDoesNotExposeProviderMessage(t *testing.T) {
	err := summarizeDeleteErrors([]error{&smithy.GenericAPIError{
		Code: "AccessDenied", Message: "secret object path and signed request",
	}})
	if err == nil || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("unexpected delete error = %v", err)
	}
	if strings.Contains(err.Error(), "secret object path") || strings.Contains(err.Error(), "signed request") {
		t.Fatalf("delete error exposes provider details: %v", err)
	}
}
