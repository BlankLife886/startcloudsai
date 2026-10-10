package media

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	// gen2brain/webp 仅用于编码；其自带解码器有色彩偏差 bug，
	// 校验一律用官方 x/image/webp 解码。
	xwebp "golang.org/x/image/webp"
)

func transparentPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if x < w/2 {
				img.Set(x, y, color.RGBA{R: 200, G: 50, B: 50, A: 255})
			}
			// 右半保持全透明
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestEncodeVariantWebPScalesAndKeepsAlpha(t *testing.T) {
	source := transparentPNG(t, 1600, 800)
	variant, err := EncodeVariant(source, VariantOptions{Format: "webp", Quality: 85, MaxEdge: 512})
	if err != nil {
		t.Fatal(err)
	}
	if variant.Ext != "webp" || variant.ContentType != "image/webp" {
		t.Fatalf("unexpected variant meta: %+v", variant)
	}
	decoded, err := xwebp.Decode(bytes.NewReader(variant.Data))
	if err != nil {
		t.Fatalf("decode webp: %v", err)
	}
	bounds := decoded.Bounds()
	if bounds.Dx() != 512 || bounds.Dy() != 256 {
		t.Fatalf("expected 512x256, got %dx%d", bounds.Dx(), bounds.Dy())
	}
	// 右侧透明区必须仍然透明
	_, _, _, alpha := decoded.At(bounds.Dx()-2, bounds.Dy()/2).RGBA()
	if alpha != 0 {
		t.Fatalf("transparency lost: alpha=%d", alpha)
	}
}

func TestEncodeVariantPNGLossless(t *testing.T) {
	source := transparentPNG(t, 640, 320)
	variant, err := EncodeVariant(source, VariantOptions{Format: "png", MaxEdge: 512})
	if err != nil {
		t.Fatal(err)
	}
	if variant.Ext != "png" {
		t.Fatalf("expected png, got %s", variant.Ext)
	}
	decoded, err := png.Decode(bytes.NewReader(variant.Data))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 512 {
		t.Fatalf("expected width 512, got %d", decoded.Bounds().Dx())
	}
}

func TestEncodeVariantKeepsOriginalWhenSmallerAlready(t *testing.T) {
	// 一张很小的 png，webp 重编码若更大则应原样返回。
	source := transparentPNG(t, 16, 16)
	variant, err := EncodeVariant(source, VariantOptions{Format: "webp", Quality: 85, MaxEdge: 2048})
	if err != nil {
		t.Fatal(err)
	}
	if len(variant.Data) > len(source) {
		t.Fatalf("variant larger than source: %d > %d", len(variant.Data), len(source))
	}
}

func TestEncodeVariantLosslessWebP(t *testing.T) {
	// 不触发缩放（400 < MaxEdge 512），无损仅针对编码环节。
	source := transparentPNG(t, 400, 200)
	variant, err := EncodeVariant(source, VariantOptions{Format: "webp", Lossless: true, MaxEdge: 512})
	if err != nil {
		t.Fatal(err)
	}
	var decoded image.Image
	if variant.Ext == "webp" {
		decoded, err = xwebp.Decode(bytes.NewReader(variant.Data))
	} else {
		decoded, err = png.Decode(bytes.NewReader(variant.Data))
	}
	if err != nil {
		t.Fatal(err)
	}
	// 无损模式下左半像素颜色应完全一致
	r, g, b, a := decoded.At(10, 10).RGBA()
	if r>>8 != 200 || g>>8 != 50 || b>>8 != 50 || a>>8 != 255 {
		t.Fatalf("lossless pixel mismatch: %d %d %d %d", r>>8, g>>8, b>>8, a>>8)
	}
}

func TestEncodeVariantRejectsGarbage(t *testing.T) {
	if _, err := EncodeVariant([]byte("not an image"), VariantOptions{Format: "webp"}); err == nil {
		t.Fatal("expected error for garbage input")
	}
}
