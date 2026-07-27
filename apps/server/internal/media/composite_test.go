package media

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func TestParseMaskRect(t *testing.T) {
	rect, err := ParseMaskRect("10,20,30,40")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if rect != image.Rect(10, 20, 40, 60) {
		t.Fatalf("unexpected rect %v", rect)
	}
	for _, bad := range []string{"", "1,2,3", "1,2,0,4", "a,b,c,d"} {
		if _, err := ParseMaskRect(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

// 蒙版契约：不透明=保留，alpha=0=编辑。
// 200x200 蓝色底图，rect=(40,40)-(160,160)，蒙版中心 60x60 全透明（编辑区），
// 上游结果为红色。合成后：编辑区中心为红，rect 外保持蓝色原样。
func TestCompositeMaskedEdit(t *testing.T) {
	blue := color.NRGBA{B: 255, A: 255}
	base := image.NewNRGBA(image.Rect(0, 0, 200, 200))
	for i := range base.Pix {
		base.Pix[i] = 0
	}
	for y := 0; y < 200; y++ {
		for x := 0; x < 200; x++ {
			base.SetNRGBA(x, y, blue)
		}
	}

	// 裁剪蒙版尺寸 = rect 尺寸 120x120，中心 60x60 透明
	mask := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 120; x++ {
			a := uint8(255)
			if x >= 30 && x < 90 && y >= 30 && y < 90 {
				a = 0
			}
			mask.SetNRGBA(x, y, color.NRGBA{A: a})
		}
	}

	result := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 120; x++ {
			result.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
		}
	}

	rect, err := ParseMaskRect("40,40,120,120")
	if err != nil {
		t.Fatalf("rect: %v", err)
	}
	out, err := CompositeMaskedEdit(
		encodePNG(t, base), encodePNG(t, mask), encodePNG(t, result), rect,
	)
	if err != nil {
		t.Fatalf("composite: %v", err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}

	// 编辑区中心（原图坐标 100,100）应为红色
	r, g, b, _ := decoded.At(100, 100).RGBA()
	if r>>8 < 200 || g>>8 > 60 || b>>8 > 60 {
		t.Fatalf("edit center should be red, got r=%d g=%d b=%d", r>>8, g>>8, b>>8)
	}
	// rect 外角落应保持蓝色不变
	r, g, b, _ = decoded.At(5, 5).RGBA()
	if b>>8 < 200 || r>>8 > 5 || g>>8 > 5 {
		t.Fatalf("outside rect should stay blue, got r=%d g=%d b=%d", r>>8, g>>8, b>>8)
	}
	// rect 内、编辑区羽化带之外（如 45,45，距编辑区 25px）应仍接近蓝色
	r, _, b, _ = decoded.At(45, 45).RGBA()
	if b>>8 < 180 || r>>8 > 80 {
		t.Fatalf("unmasked pixel inside rect drifted, got r=%d b=%d", r>>8, b>>8)
	}
}

// 上游结果分辨率与 rect 不同（模拟 1024 档生成）时应缩放贴回。
func TestCompositeMaskedEditScalesResult(t *testing.T) {
	base := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			base.SetNRGBA(x, y, color.NRGBA{G: 255, A: 255})
		}
	}
	mask := image.NewNRGBA(image.Rect(0, 0, 50, 50)) // 全透明 = 全部编辑
	result := image.NewNRGBA(image.Rect(0, 0, 200, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 200; x++ {
			result.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	rect, _ := ParseMaskRect("25,25,50,50")
	out, err := CompositeMaskedEdit(encodePNG(t, base), encodePNG(t, mask), encodePNG(t, result), rect)
	if err != nil {
		t.Fatalf("composite: %v", err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	r, _, _, _ := decoded.At(50, 50).RGBA()
	if r>>8 < 200 {
		t.Fatalf("center should be edited red, got r=%d", r>>8)
	}
}
