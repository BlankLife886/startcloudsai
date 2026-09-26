package media

import (
	"bytes"
	"fmt"
	"image"
	"image/png"

	"github.com/gen2brain/webp"
	"golang.org/x/image/draw"
)

// VariantOptions 三级图中"小图/展示图"的编码参数（后台可配）。
type VariantOptions struct {
	// Format "webp" 或 "png"，两者都完整保留透明通道。
	Format string
	// Lossless 仅对 webp 生效；png 天生无损。
	Lossless bool
	// Quality 1-100，仅对有损 webp 生效。
	Quality int
	// MaxEdge 最长边像素数，超出等比缩小；不放大小图。
	MaxEdge int
}

// Variant 编码结果。
type Variant struct {
	Data        []byte
	Ext         string
	ContentType string
}

func decodeScaled(data []byte, maxEdge int) (image.Image, bool, error) {
	if ext, _ := Detect(data); ext == "" {
		return nil, false, fmt.Errorf("unsupported image data")
	}
	width, height, err := Dimensions(data)
	if err != nil {
		return nil, false, err
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, false, err
	}
	if maxEdge <= 0 || (width <= maxEdge && height <= maxEdge) {
		return src, false, nil
	}
	w, h := width, height
	if w >= h {
		h = max(1, h*maxEdge/w)
		w = maxEdge
	} else {
		w = max(1, w*maxEdge/h)
		h = maxEdge
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	return dst, true, nil
}

// EncodeVariant 按配置把原图重编码为小图/展示图变体。
// 若图片本来就不超过 MaxEdge 且重编码后反而更大，则直接返回原始字节
//（避免"压缩"出一张更大的图）。
func EncodeVariant(data []byte, opts VariantOptions) (Variant, error) {
	img, scaled, err := decodeScaled(data, opts.MaxEdge)
	if err != nil {
		return Variant{}, err
	}
	var out bytes.Buffer
	variant := Variant{}
	switch opts.Format {
	case "png":
		encoder := png.Encoder{CompressionLevel: png.BestCompression}
		if err := encoder.Encode(&out, img); err != nil {
			return Variant{}, err
		}
		variant.Ext, variant.ContentType = "png", "image/png"
	default: // webp
		quality := opts.Quality
		if quality < 1 || quality > 100 {
			quality = 85
		}
		if err := webp.Encode(&out, img, webp.Options{
			Quality:  quality,
			Lossless: opts.Lossless,
			// 无损时保留全透明像素的 RGB 原值，保证 100% 无损。
			Exact:  opts.Lossless,
			Method: 4,
		}); err != nil {
			return Variant{}, err
		}
		variant.Ext, variant.ContentType = "webp", "image/webp"
	}
	variant.Data = out.Bytes()
	// 没缩小尺寸且重编码后更大：保留原始字节更划算。
	if !scaled && len(variant.Data) >= len(data) {
		ext, contentType := Detect(data)
		return Variant{Data: data, Ext: ext, ContentType: contentType}, nil
	}
	return variant, nil
}
