package media

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
)

// ParseMaskRect 解析 "x,y,w,h" 形式的裁剪矩形。
func ParseMaskRect(raw string) (image.Rectangle, error) {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	if len(parts) != 4 {
		return image.Rectangle{}, fmt.Errorf("mask rect must be x,y,w,h")
	}
	values := make([]int, 4)
	for i, part := range parts {
		v, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return image.Rectangle{}, fmt.Errorf("mask rect component %d: %w", i, err)
		}
		values[i] = v
	}
	if values[2] <= 0 || values[3] <= 0 {
		return image.Rectangle{}, fmt.Errorf("mask rect has empty size")
	}
	return image.Rect(values[0], values[1], values[0]+values[2], values[1]+values[3]), nil
}

func decodeBounded(data []byte) (image.Image, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > MaxDecodedPixels {
		return nil, fmt.Errorf("image dimensions exceed limit")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	return img, err
}

func toRGBA(src image.Image) *image.RGBA {
	if rgba, ok := src.(*image.RGBA); ok && rgba.Bounds().Min == (image.Point{}) {
		return rgba
	}
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Copy(dst, image.Point{}, src, b, draw.Src, nil)
	return dst
}

// maskEditLevels 提取编辑强度：蒙版契约为「不透明=保留，alpha=0=编辑」，
// 蒙版尺寸与 rect 不一致时先缩放对齐。
func maskEditLevels(mask image.Image, w, h int) []uint8 {
	scaled := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), mask, mask.Bounds(), draw.Src, nil)
	levels := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		row := scaled.Pix[y*scaled.Stride : y*scaled.Stride+w*4]
		for x := 0; x < w; x++ {
			levels[y*w+x] = 255 - row[x*4+3]
		}
	}
	return levels
}

// dilate 分离式最大值滤波，把编辑区向外扩 radius 像素，
// 让接缝落在新生成的像素上而不是贴着笔迹边缘。
func dilate(levels []uint8, w, h, radius int) []uint8 {
	if radius <= 0 {
		return levels
	}
	pass := func(src []uint8, stride, lineLen, lines, step int) []uint8 {
		dst := make([]uint8, len(src))
		for line := 0; line < lines; line++ {
			base := line * stride
			for i := 0; i < lineLen; i++ {
				v := uint8(0)
				lo := i - radius
				if lo < 0 {
					lo = 0
				}
				hi := i + radius
				if hi > lineLen-1 {
					hi = lineLen - 1
				}
				for j := lo; j <= hi; j++ {
					if src[base+j*step] > v {
						v = src[base+j*step]
					}
				}
				dst[base+i*step] = v
			}
		}
		return dst
	}
	horizontal := pass(levels, w, w, h, 1)
	return pass(horizontal, 1, h, w, w)
}

// boxBlur 分离式盒式模糊，水平+垂直各跑三遍近似高斯，产生羽化过渡带。
func boxBlur(levels []uint8, w, h, radius int) []uint8 {
	if radius <= 0 {
		return levels
	}
	pass := func(src []uint8, stride, lineLen, lines, step int) []uint8 {
		dst := make([]uint8, len(src))
		window := 2*radius + 1
		for line := 0; line < lines; line++ {
			base := line * stride
			sum := 0
			for j := -radius; j <= radius; j++ {
				idx := j
				if idx < 0 {
					idx = 0
				} else if idx > lineLen-1 {
					idx = lineLen - 1
				}
				sum += int(src[base+idx*step])
			}
			for i := 0; i < lineLen; i++ {
				// #nosec G115 -- the average of uint8 samples is always within [0, 255].
				dst[base+i*step] = uint8(sum / window)
				add := i + radius + 1
				if add > lineLen-1 {
					add = lineLen - 1
				}
				remove := i - radius
				if remove < 0 {
					remove = 0
				}
				sum += int(src[base+add*step]) - int(src[base+remove*step])
			}
		}
		return dst
	}
	out := levels
	for i := 0; i < 3; i++ {
		out = pass(out, w, w, h, 1)
		out = pass(out, 1, h, w, w)
	}
	return out
}

// CompositeMaskedEdit 把上游返回的局部编辑结果贴回原图：
// result 缩放到 rect 尺寸后，用「膨胀 + 羽化」的蒙版 alpha 与原图混合；
// rect 之外以及蒙版未选中的像素与原图逐位一致。
func CompositeMaskedEdit(baseData, maskData, resultData []byte, rect image.Rectangle) ([]byte, error) {
	baseImg, err := decodeBounded(baseData)
	if err != nil {
		return nil, fmt.Errorf("decode base: %w", err)
	}
	maskImg, err := decodeBounded(maskData)
	if err != nil {
		return nil, fmt.Errorf("decode mask: %w", err)
	}
	resultImg, err := decodeBounded(resultData)
	if err != nil {
		return nil, fmt.Errorf("decode result: %w", err)
	}

	base := toRGBA(baseImg)
	rect = rect.Intersect(base.Bounds())
	if rect.Empty() {
		return nil, fmt.Errorf("mask rect outside base image")
	}
	w, h := rect.Dx(), rect.Dy()

	scaledResult := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(scaledResult, scaledResult.Bounds(), resultImg, resultImg.Bounds(), draw.Src, nil)

	short := w
	if h < short {
		short = h
	}
	dilateRadius := max(2, short/128)
	featherRadius := max(3, short*3/200)
	levels := maskEditLevels(maskImg, w, h)
	levels = dilate(levels, w, h, dilateRadius)
	levels = boxBlur(levels, w, h, featherRadius/2+1)

	for y := 0; y < h; y++ {
		baseRow := base.Pix[(rect.Min.Y+y)*base.Stride+rect.Min.X*4:]
		editRow := scaledResult.Pix[y*scaledResult.Stride:]
		for x := 0; x < w; x++ {
			a := int(levels[y*w+x])
			if a == 0 {
				continue
			}
			bi, ei := x*4, x*4
			if a == 255 {
				copy(baseRow[bi:bi+4], editRow[ei:ei+4])
				continue
			}
			for c := 0; c < 4; c++ {
				bv := int(baseRow[bi+c])
				ev := int(editRow[ei+c])
				// #nosec G115 -- alpha blending of uint8 channels stays within [0, 255].
				baseRow[bi+c] = uint8((ev*a + bv*(255-a) + 127) / 255)
			}
		}
	}

	var out bytes.Buffer
	if err := png.Encode(&out, base); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// CompositePreservedCanvas restores the complete source canvas into the center
// of an outpaint result. The source is scaled uniformly only when the target
// dimensions require it; its geometry is never regenerated by the model.
func CompositePreservedCanvas(sourceData, resultData []byte) ([]byte, error) {
	sourceImg, err := decodeBounded(sourceData)
	if err != nil {
		return nil, fmt.Errorf("decode source: %w", err)
	}
	resultImg, err := decodeBounded(resultData)
	if err != nil {
		return nil, fmt.Errorf("decode result: %w", err)
	}

	result := toRGBA(resultImg)
	sourceBounds := sourceImg.Bounds()
	targetBounds := result.Bounds()
	if sourceBounds.Empty() || targetBounds.Empty() {
		return nil, fmt.Errorf("source or result image is empty")
	}

	targetW, targetH := targetBounds.Dx(), targetBounds.Dy()
	sourceW, sourceH := sourceBounds.Dx(), sourceBounds.Dy()
	fitW := targetW
	fitH := sourceH * targetW / sourceW
	if fitH > targetH {
		fitH = targetH
		fitW = sourceW * targetH / sourceH
	}
	fitW = max(1, fitW)
	fitH = max(1, fitH)

	scaled := image.NewRGBA(image.Rect(0, 0, fitW, fitH))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), sourceImg, sourceBounds, draw.Src, nil)
	offsetX := (targetW - fitW) / 2
	offsetY := (targetH - fitH) / 2
	short := min(fitW, fitH)
	// A broad transition hides luminance/color differences between the generated
	// extension and the restored source background while the product stays well
	// inside the fully preserved center.
	feather := max(16, short/20)

	for y := 0; y < fitH; y++ {
		for x := 0; x < fitW; x++ {
			edgeDistance := min(x, y, fitW-1-x, fitH-1-y)
			blend := 255
			if edgeDistance < feather {
				blend = edgeDistance * 255 / feather
			}
			si := y*scaled.Stride + x*4
			sourceAlpha := int(scaled.Pix[si+3])
			blend = blend * sourceAlpha / 255
			if blend <= 0 {
				continue
			}
			di := (offsetY+y)*result.Stride + (offsetX+x)*4
			for channel := 0; channel < 3; channel++ {
				sv := int(scaled.Pix[si+channel])
				dv := int(result.Pix[di+channel])
				// #nosec G115 -- source channels and blend are bytes, so the weighted average is in [0, 255].
				result.Pix[di+channel] = uint8((sv*blend + dv*(255-blend) + 127) / 255)
			}
			result.Pix[di+3] = 255
		}
	}

	var out bytes.Buffer
	if err := png.Encode(&out, result); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
