package worker

import "testing"

func TestMediaSignatureRecognizesToolOutputsWithoutURLSuffix(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		ext  string
	}{
		{name: "png", data: []byte("\x89PNG\r\n\x1a\nrest"), ext: "png"},
		{name: "mp4", data: []byte("xxxxftypisomrest"), ext: "mp4"},
		{name: "webm", data: []byte{0x1a, 0x45, 0xdf, 0xa3}, ext: "webm"},
		{name: "wav", data: []byte("RIFFxxxxWAVErest"), ext: "wav"},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			ext, _ := mediaSignature(item.data)
			if ext != item.ext {
				t.Fatalf("ext = %q, want %q", ext, item.ext)
			}
		})
	}
}
