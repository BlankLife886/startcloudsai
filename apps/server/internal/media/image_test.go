package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestThumbnailJPEGScalesLargeImage(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 1024, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 1024; x++ {
			source.SetRGBA(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 120, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	thumbnail, err := ThumbnailJPEG(encoded.Bytes(), 512)
	if err != nil {
		t.Fatal(err)
	}
	got, err := jpeg.DecodeConfig(bytes.NewReader(thumbnail))
	if err != nil {
		t.Fatal(err)
	}
	if got.Width != 512 || got.Height != 128 {
		t.Fatalf("thumbnail dimensions = %dx%d, want 512x128", got.Width, got.Height)
	}
}

func TestThumbnailJPEGRejectsUnsupportedData(t *testing.T) {
	if _, err := ThumbnailJPEG([]byte("not an image"), 512); err == nil {
		t.Fatal("expected unsupported image error")
	}
}
