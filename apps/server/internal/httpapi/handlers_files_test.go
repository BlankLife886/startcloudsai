package httpapi

import "testing"

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
