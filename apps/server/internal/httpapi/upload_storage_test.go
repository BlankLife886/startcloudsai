package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func uploadTestPNG(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 6, 4))); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func uploadTestHeader(t *testing.T, data []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "untrusted-filename.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/v1/images/edits", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = request.MultipartForm.RemoveAll() })
	return request.MultipartForm.File["image"][0]
}

func TestReadUploadFileEnforcesActualSize(t *testing.T) {
	data := uploadTestPNG(t)
	header := uploadTestHeader(t, data)
	header.Size = 1 // A declared length must never bypass the bounded read.
	if _, err := readUploadFile(header, int64(len(data)-1)); err == nil {
		t.Fatal("upload exceeding the real byte limit was accepted")
	} else if app, ok := apperr.As(err); !ok || app.Code != "upload_too_large" {
		t.Fatalf("size error = %v", err)
	}
	got, err := readUploadFile(header, int64(len(data)))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("bounded upload read = %d bytes, error %v", len(got), err)
	}
	if _, err := readUploadFile(uploadTestHeader(t, nil), 1024); err == nil {
		t.Fatal("empty image accepted")
	}
	if _, err := readUploadFile(nil, 1024); err == nil {
		t.Fatal("missing image accepted")
	}
}

type stubUserUploadStorage struct {
	mu            sync.Mutex
	objects       map[string][]byte
	writes        []string
	deleted       []string
	failDirectory string
	deleteCtxErr  error
}

func (stub *stubUserUploadStorage) UploadBytes(_ context.Context, key string, data []byte, _ string) error {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.objects == nil {
		stub.objects = make(map[string][]byte)
	}
	stub.objects[key] = append([]byte(nil), data...)
	stub.writes = append(stub.writes, key)
	// Simulate an uncertain write: storage saved it, then the response failed.
	if stub.failDirectory != "" && strings.Contains(key, "/"+stub.failDirectory+"/") {
		return errors.New("storage response lost")
	}
	return nil
}

func (stub *stubUserUploadStorage) DeleteKeys(ctx context.Context, keys []string) error {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.deleteCtxErr = ctx.Err()
	for _, key := range keys {
		delete(stub.objects, key)
		stub.deleted = append(stub.deleted, key)
	}
	return ctx.Err()
}

func uploadTestVariants() settings.ImageVariantConfig {
	return settings.ImageVariantConfig{Format: "png", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
}

func TestPersistUserUploadPreservesOriginalAndResponse(t *testing.T) {
	userID := uuid.New()
	data := uploadTestPNG(t)
	storage := &stubUserUploadStorage{}
	var registered []store.UserUploadObjectSize
	item, err := persistUserUpload(context.Background(), userID, data, uploadTestVariants(), storage,
		func(_ context.Context, owner uuid.UUID, objects []store.UserUploadObjectSize) error {
			if owner != userID {
				t.Fatalf("registered owner = %s", owner)
			}
			registered = append(registered, objects...)
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(item.Key, "uploads/"+userID.String()+"/original/") || !strings.HasSuffix(item.Key, ".png") {
		t.Fatalf("original key = %q", item.Key)
	}
	if !bytes.Equal(storage.objects[item.Key], data) || item.SHA256 != fmt.Sprintf("%x", sha256.Sum256(data)) {
		t.Fatal("stored original bytes/hash differ from the input")
	}
	if item.ContentType != "image/png" || item.SizeBytes != int64(len(data)) || len(registered) != 3 {
		t.Fatalf("upload = %#v, registered = %#v", item, registered)
	}
	if !reflect.DeepEqual(registered, item.Objects) {
		t.Fatal("result includes an object that was not quota-registered")
	}
	response := item.response("/api/open/v1/files/")
	if len(response) != 8 || response["url"] != "/api/open/v1/files/"+item.Key || response["thumbnailKey"] != item.ThumbnailKey || response["displayKey"] != item.DisplayKey {
		t.Fatalf("legacy upload response changed: %#v", response)
	}
	if _, exposed := response["SHA256"]; exposed {
		t.Fatal("internal fingerprint leaked into legacy response")
	}
}

func TestPersistUserUploadCleansUncertainRequiredWrite(t *testing.T) {
	storage := &stubUserUploadStorage{failDirectory: "original"}
	registered := false
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	item, err := persistUserUpload(ctx, uuid.New(), uploadTestPNG(t), uploadTestVariants(), storage,
		func(context.Context, uuid.UUID, []store.UserUploadObjectSize) error {
			registered = true
			return nil
		})
	if err == nil || item != nil || registered {
		t.Fatalf("failed storage upload item=%#v error=%v registered=%v", item, err, registered)
	}
	if len(storage.objects) != 0 || len(storage.deleted) != 3 || storage.deleteCtxErr != nil {
		t.Fatalf("cleanup failed: objects=%v deleted=%v context=%v", storage.objects, storage.deleted, storage.deleteCtxErr)
	}
}

func TestPersistUserUploadPreservesLegacyMediaShape(t *testing.T) {
	storage := &stubUserUploadStorage{}
	item, err := persistUserUpload(context.Background(), uuid.New(), []byte("ID3audio"), uploadTestVariants(), storage,
		func(context.Context, uuid.UUID, []store.UserUploadObjectSize) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(item.Objects) != 1 || item.ThumbnailKey != "" || item.DisplayKey != "" || item.ContentType != "audio/mpeg" {
		t.Fatalf("legacy media upload changed: %#v", item)
	}
	if response := item.response("/api/v1/files/"); len(response) != 4 || response["url"] != "/api/v1/files/"+item.Key {
		t.Fatalf("legacy media response changed: %#v", response)
	}
}

func TestPersistUserUploadCleansQuotaFailure(t *testing.T) {
	storage := &stubUserUploadStorage{}
	want := errors.New("storage quota exceeded")
	item, err := persistUserUpload(context.Background(), uuid.New(), uploadTestPNG(t), uploadTestVariants(), storage,
		func(context.Context, uuid.UUID, []store.UserUploadObjectSize) error { return want })
	if !errors.Is(err, want) || item != nil || len(storage.objects) != 0 || len(storage.deleted) != 3 {
		t.Fatalf("quota failure result item=%#v err=%v objects=%v cleanup=%v", item, err, storage.objects, storage.deleted)
	}
}

func TestPersistUserUploadAllowsOptionalDisplayFailure(t *testing.T) {
	storage := &stubUserUploadStorage{failDirectory: "display"}
	item, err := persistUserUpload(context.Background(), uuid.New(), uploadTestPNG(t), uploadTestVariants(), storage,
		func(context.Context, uuid.UUID, []store.UserUploadObjectSize) error { return nil })
	if err != nil || item == nil || len(item.Objects) != 2 || len(storage.objects) != 2 {
		t.Fatalf("optional display failure item=%#v err=%v objects=%v", item, err, storage.objects)
	}
	if len(storage.deleted) != 1 || storage.deleted[0] != item.DisplayKey {
		t.Fatalf("uncertain optional write was not removed: %v", storage.deleted)
	}
}

func TestPersistUserUploadRejectsTruncatedImageBeforeWriting(t *testing.T) {
	storage := &stubUserUploadStorage{}
	registered := false
	_, err := persistUserUpload(context.Background(), uuid.New(), []byte("\x89PNG\r\n\x1a\n"), uploadTestVariants(), storage,
		func(context.Context, uuid.UUID, []store.UserUploadObjectSize) error {
			registered = true
			return nil
		})
	if err == nil || registered || len(storage.writes) != 0 {
		t.Fatalf("invalid content reached storage: error=%v writes=%v registered=%v", err, storage.writes, registered)
	}
}

func TestUploadCleanupProtectsReferencedImageGroupsAndForeignObjects(t *testing.T) {
	userID := uuid.New()
	prefix := "uploads/" + userID.String() + "/"
	original, thumbnail := prefix+"original/image.png", prefix+"thumb/image"
	foreign := "uploads/" + uuid.NewString() + "/original/foreign.png"
	item := &storedUserUpload{Key: original, ThumbnailKey: thumbnail,
		Objects: []store.UserUploadObjectSize{{Key: original}, {Key: thumbnail}, {Key: foreign}}}
	groups := uploadCleanupGroups(userID, []*storedUserUpload{item, nil, {Key: foreign}})
	if !reflect.DeepEqual(groups, [][]string{{original, thumbnail}}) {
		t.Fatalf("cleanup targets = %v", groups)
	}
	for _, unreferenced := range [][]string{{thumbnail}, {original}, nil} {
		if targets := unreferencedUploadGroupKeys(groups, unreferenced); len(targets) != 0 {
			t.Fatalf("partly referenced image group selected for cleanup: %v", targets)
		}
	}
	if targets := unreferencedUploadGroupKeys(groups, []string{original, thumbnail}); !reflect.DeepEqual(targets, []string{original, thumbnail}) {
		t.Fatalf("fully unreferenced group cleanup = %v", targets)
	}
}
