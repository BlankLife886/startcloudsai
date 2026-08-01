package media

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const MaxDecodedPixels = 40_000_000

func Dimensions(data []byte) (int, int, error) {
	if ext, _ := Detect(data); ext == "" {
		return 0, 0, fmt.Errorf("unsupported image data")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > MaxDecodedPixels {
		return 0, 0, fmt.Errorf("image dimensions exceed limit")
	}
	return cfg.Width, cfg.Height, nil
}

func Detect(data []byte) (ext, contentType string) {
	if len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		return "png", "image/png"
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "jpg", "image/jpeg"
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "webp", "image/webp"
	}
	return "", ""
}

func ThumbnailJPEG(data []byte, maxDimension int) ([]byte, error) {
	if ext, _ := Detect(data); ext == "" {
		return nil, fmt.Errorf("unsupported image data")
	}
	width, height, err := Dimensions(data)
	if err != nil {
		return nil, err
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	w, h := width, height
	if w > maxDimension || h > maxDimension {
		if w >= h {
			h = max(1, h*maxDimension/w)
			w = maxDimension
		} else {
			w = max(1, w*maxDimension/h)
			h = maxDimension
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
