package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	storagepkg "github.com/BlankLife886/startcloudsai/server/internal/storage"
)

func TestSniffUploadMedia(t *testing.T) {
	tests := []struct {
		name        string
		data        []byte
		ext         string
		contentType string
		image       bool
	}{
		{name: "png", data: []byte("\x89PNG\r\n\x1a\n"), ext: "png", contentType: "image/png", image: true},
		{name: "jpeg", data: []byte{0xff, 0xd8, 0xff}, ext: "jpg", contentType: "image/jpeg", image: true},
		{name: "webp", data: []byte("RIFFxxxxWEBP"), ext: "webp", contentType: "image/webp", image: true},
		{name: "mp4", data: []byte("xxxxftypisom"), ext: "mp4", contentType: "video/mp4"},
		{name: "webm", data: []byte{0x1a, 0x45, 0xdf, 0xa3}, ext: "webm", contentType: "video/webm"},
		{name: "mp3 id3", data: []byte("ID3audio"), ext: "mp3", contentType: "audio/mpeg"},
		{name: "mp3 frame", data: []byte{0xff, 0xfb, 0x90, 0x64}, ext: "mp3", contentType: "audio/mpeg"},
		{name: "wav", data: []byte("RIFFxxxxWAVE"), ext: "wav", contentType: "audio/wav"},
		{name: "m4a", data: []byte("xxxxftypM4A "), ext: "m4a", contentType: "audio/mp4"},
		{name: "ogg", data: []byte("OggSaudio"), ext: "ogg", contentType: "audio/ogg"},
		{name: "unknown", data: []byte("not-media")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ext, contentType, image := sniffUploadMedia(test.data)
			if ext != test.ext || contentType != test.contentType || image != test.image {
				t.Fatalf("got (%q, %q, %v), want (%q, %q, %v)", ext, contentType, image, test.ext, test.contentType, test.image)
			}
		})
	}
}

func TestIsOwnedUserUploadImageKey(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	prefix := "uploads/" + userID.String() + "/"
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "original", key: prefix + "original/image.jpg", want: true},
		{name: "thumbnail", key: prefix + "thumb/image.jpg", want: true},
		{name: "other user", key: "uploads/22222222-2222-2222-2222-222222222222/original/image.jpg"},
		{name: "task output", key: "tasks/" + userID.String() + "/image.jpg"},
		{name: "empty filename", key: prefix + "original/"},
		{name: "nested filename", key: prefix + "original/nested/image.jpg"},
		{name: "path traversal", key: prefix + "original/../image.jpg"},
		{name: "backslash", key: prefix + "original\\image.jpg"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isOwnedUserUploadImageKey(userID, test.key); got != test.want {
				t.Fatalf("isOwnedUserUploadImageKey(%q) = %v, want %v", test.key, got, test.want)
			}
		})
	}
}

func TestIsOwnedTaskOutputImageKey(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	taskID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	prefix := "tasks/" + userID.String() + "/" + taskID.String() + "/"
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "original", key: prefix + "original/0.png", want: true},
		{name: "thumbnail", key: prefix + "thumb/0.jpg", want: true},
		{name: "other user", key: "tasks/22222222-2222-2222-2222-222222222222/" + taskID.String() + "/original/0.png"},
		{name: "invalid task", key: "tasks/" + userID.String() + "/not-a-task/original/0.png"},
		{name: "nested filename", key: prefix + "original/nested/0.png"},
		{name: "wrong directory", key: prefix + "source/0.png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isOwnedTaskOutputImageKey(userID, test.key); got != test.want {
				t.Fatalf("isOwnedTaskOutputImageKey(%q) = %v, want %v", test.key, got, test.want)
			}
		})
	}
}

func TestIsOwnedAssistantOutputImageKey(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	runID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	prefix := "tasks/" + userID.String() + "/assistant/" + runID.String() + "/"
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "generated image", key: prefix + "1.png", want: true},
		{name: "invalid run", key: "tasks/" + userID.String() + "/assistant/not-a-run/1.png"},
		{name: "nested internal input", key: prefix + "crun-input/1.png"},
		{name: "other user", key: "tasks/22222222-2222-2222-2222-222222222222/assistant/" + runID.String() + "/1.png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isOwnedAssistantOutputImageKey(userID, test.key); got != test.want {
				t.Fatalf("isOwnedAssistantOutputImageKey(%q) = %v, want %v", test.key, got, test.want)
			}
		})
	}
}

func TestIsAllowedTaskInputImageKey(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	owned := "uploads/" + userID.String() + "/original/image.jpg"
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "owned upload", key: owned, want: true},
		{name: "catalog", key: "ecommerce-catalog/" + uuid.NewString() + ".png", want: true},
		{name: "legacy tryon", key: "ecommerce-tryon/model.jpg", want: true},
		{name: "handheld", key: "ecommerce-handheld/scene.webp", want: true},
		{name: "empty catalog prefix", key: "ecommerce-catalog/"},
		{name: "other bucket", key: "prompt-covers/cover.png"},
		{name: "path traversal", key: "ecommerce-catalog/../uploads/x.png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isAllowedTaskInputImageKey(userID, test.key); got != test.want {
				t.Fatalf("isAllowedTaskInputImageKey(%q) = %v, want %v", test.key, got, test.want)
			}
		})
	}
}

func TestMapTaskImageReadError(t *testing.T) {
	if err := mapTaskImageReadError(context.DeadlineExceeded); !errors.Is(err, errTaskImageTimeout) {
		t.Fatalf("deadline = %v, want timeout", err)
	}
	if err := mapTaskImageReadError(fmt.Errorf("GetObject: %w", context.DeadlineExceeded)); !errors.Is(err, errTaskImageTimeout) {
		t.Fatalf("wrapped deadline = %v, want timeout", err)
	}
	if err := mapTaskImageReadError(fmt.Errorf("missing")); !errors.Is(err, errTaskImageMissing) {
		t.Fatalf("generic = %v, want missing", err)
	}
}

func TestInspectUserUploadImageData(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 4, 3))); err != nil {
		t.Fatal(err)
	}
	size, contentType, err := inspectUserUploadImageData(encoded.Bytes())
	if err != nil {
		t.Fatalf("valid PNG rejected: %v", err)
	}
	if size != int64(encoded.Len()) || contentType != "image/png" {
		t.Fatalf("got size=%d contentType=%q, want size=%d contentType=%q", size, contentType, encoded.Len(), "image/png")
	}

	for _, data := range [][]byte{[]byte("xxxxftypisom"), []byte("\x89PNG\r\n\x1a\n")} {
		if _, _, err := inspectUserUploadImageData(data); err == nil {
			t.Fatalf("unsupported or truncated data %q was accepted", data)
		}
	}
}

func TestGetFileAuthorizesBeforeOSSDelivery(t *testing.T) {
	env := newCommunityEnv(t)
	owner, ownerToken := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	key := "tasks/" + owner.ID.String() + "/task/original/result image.png"
	path := "/api/v1/files/" + strings.ReplaceAll(key, " ", "%20")

	unauthenticated := env.do(t, http.MethodGet, path, nil, "")
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous private file status = %d, want 401; body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}
	if location := unauthenticated.Header().Get("Location"); location != "" {
		t.Fatalf("anonymous private file redirected to %q", location)
	}

	foreign := env.do(t, http.MethodGet, path, nil, otherToken)
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign private file status = %d, want 404; body=%s", foreign.Code, foreign.Body.String())
	}
	if location := foreign.Header().Get("Location"); location != "" {
		t.Fatalf("foreign private file redirected to %q", location)
	}

	ownedRequest := httptest.NewRequest(http.MethodGet, path, nil)
	ownedRequest.Header.Set("If-None-Match", objectKeyETag(key))
	ownedRequest.AddCookie(&http.Cookie{Name: env.cfg.SessionCookieName, Value: ownerToken})
	owned := httptest.NewRecorder()
	env.engine.ServeHTTP(owned, ownedRequest)
	if owned.Code != http.StatusNotModified {
		t.Fatalf("owned private file status = %d, want 304; body=%s", owned.Code, owned.Body.String())
	}
	if location := owned.Header().Get("Location"); location != "" {
		t.Fatalf("owned private file redirected to %q", location)
	}

	publicKey := "prompt-covers/item/cover.png"
	publicRequest := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+publicKey, nil)
	publicRequest.Header.Set("If-None-Match", objectKeyETag(publicKey))
	public := httptest.NewRecorder()
	env.engine.ServeHTTP(public, publicRequest)
	if public.Code != http.StatusNotModified {
		t.Fatalf("public cover status = %d, want 304; body=%s", public.Code, public.Body.String())
	}
	if location := public.Header().Get("Location"); location != "" {
		t.Fatalf("public cover redirected to %q", location)
	}
}

func TestGetFileOSSDeliverySupportsViewAndDownload(t *testing.T) {
	env := newCommunityEnv(t)
	owner, token := env.newUserSession(t, "user")
	key := "tasks/" + owner.ID.String() + "/task/original/result.png"
	etag := objectKeyETag(key)

	tests := []struct {
		name            string
		query           string
		wantDisposition bool
	}{
		{name: "view"},
		{name: "download", query: "?download=1&name=custom.png", wantDisposition: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+key+test.query, nil)
			req.Header.Set("If-None-Match", etag)
			req.AddCookie(&http.Cookie{Name: env.cfg.SessionCookieName, Value: token})
			response := httptest.NewRecorder()
			env.engine.ServeHTTP(response, req)

			if response.Code != http.StatusNotModified {
				t.Fatalf("status = %d, want 304; body=%s", response.Code, response.Body.String())
			}
			if location := response.Header().Get("Location"); location != "" {
				t.Fatalf("OSS request redirected to %q", location)
			}
			if disposition := response.Header().Get("Content-Disposition"); test.wantDisposition != (disposition != "") {
				t.Fatalf("Content-Disposition = %q, expected presence %v", disposition, test.wantDisposition)
			}
		})
	}
}

func TestGetFileOptionalMissingPreviewReturnsNoContent(t *testing.T) {
	env := newCommunityEnv(t)
	objectStoreServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`))
	}))
	defer objectStoreServer.Close()
	env.cfg.ObjectStorageEndpoint = objectStoreServer.URL
	env.cfg.ObjectStoragePublicEndpoint = ""
	env.cfg.ObjectStorageRegion = "ap-northeast-1"
	env.cfg.ObjectStorageAccessKeyID = "test-access-key"
	env.cfg.ObjectStorageSecretAccessKey = "test-secret-key"
	env.cfg.ObjectStorageBucket = "starcloudsai-test"
	env.cfg.ObjectStorageUsePathStyle = true
	env.cfg.ObjectStoragePresignExpireSecs = 900
	objectStore, err := storagepkg.New(env.cfg)
	if err != nil {
		t.Fatalf("init object storage stub: %v", err)
	}
	env.engine = (&Server{Cfg: env.cfg, St: env.st, Storage: objectStore}).Router()

	owner, token := env.newUserSession(t, "user")
	key := "uploads/" + owner.ID.String() + "/thumb/missing.jpg"

	optional := env.do(t, http.MethodGet, "/api/v1/files/"+key+"?soft_missing=1", nil, token)
	if optional.Code != http.StatusNoContent {
		t.Fatalf("optional missing preview status = %d, want 204; body=%s", optional.Code, optional.Body.String())
	}
	if got := optional.Header().Get("X-StarCloud-Media-Missing"); got != "1" {
		t.Fatalf("optional missing preview header = %q, want 1", got)
	}
	if got := optional.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("optional missing preview cache control = %q, want private, no-store", got)
	}

	regular := env.do(t, http.MethodGet, "/api/v1/files/"+key, nil, token)
	if regular.Code != http.StatusNotFound {
		t.Fatalf("regular missing file status = %d, want 404; body=%s", regular.Code, regular.Body.String())
	}
}

func TestSmallPreviewObjectKeysBypassOnlyInlineEgressLimits(t *testing.T) {
	tests := []struct {
		name     string
		key      string
		download bool
		want     bool
	}{
		{name: "assistant thumbnail", key: "tasks/user/assistant/run/1-thumb"},
		{name: "upload thumbnail", key: "uploads/user/thumb/image"},
		{name: "task thumbnail", key: "tasks/user/task/thumb/1.webp"},
		{name: "explicit thumbnail download", key: "tasks/user/assistant/run/1-thumb", download: true, want: true},
		{name: "assistant display", key: "tasks/user/assistant/run/1-display", want: true},
		{name: "assistant original", key: "tasks/user/assistant/run/1.png", want: true},
		{name: "upload display", key: "uploads/user/display/image", want: true},
		{name: "thumbnail word in filename", key: "uploads/user/original/thumb/image.png", want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldApplyFileEgressLimits(test.key, test.download); got != test.want {
				t.Fatalf("shouldApplyFileEgressLimits(%q, %v) = %v, want %v", test.key, test.download, got, test.want)
			}
		})
	}
}
