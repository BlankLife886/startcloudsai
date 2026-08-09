package httpapi

import (
	"bytes"
	"image"
	"image/png"
	"testing"

	"github.com/google/uuid"
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
