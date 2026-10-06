package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"

	"golang.org/x/image/draw"
)

// Screenshot tiling for vision models. A vision model shrinks every image to
// a fixed budget, so a full-page screenshot (750×8000) arrives as an
// unreadable strip. Cutting it into overlapping screens keeps text and
// layout legible; a normal-shaped image passes through as one tile.
const (
	screenshotTileWidth   = 1024
	screenshotTileAspect  = 1.5  // tile height / width
	screenshotTallAspect  = 2.2  // taller than this gets cut
	screenshotTileOverlap = 0.08 // share of a tile repeated in the next one
	screenshotJPEGQuality = 85
)

// ScreenshotTiles cuts data into at most maxTiles JPEG tiles, top to bottom.
// When the page needs more tiles than allowed, tiles get taller instead of
// dropping the bottom of the page.
func ScreenshotTiles(data []byte, maxTiles int) ([][]byte, error) {
	src, err := decodeBounded(data)
	if err != nil {
		return nil, err
	}
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	maxTiles = max(maxTiles, 1)
	if float64(height) <= float64(width)*screenshotTallAspect || maxTiles == 1 {
		return encodeScreenshotTiles(src, []image.Rectangle{bounds})
	}
	tileHeight := int(float64(width) * screenshotTileAspect)
	overlap := int(float64(tileHeight) * screenshotTileOverlap)
	if count := (height - overlap + tileHeight - overlap - 1) / (tileHeight - overlap); count > maxTiles {
		// Stretch tiles so maxTiles of them cover the page.
		tileHeight = (height + (maxTiles-1)*overlap + maxTiles - 1) / maxTiles
	}
	rects := []image.Rectangle{}
	for top := bounds.Min.Y; ; top += tileHeight - overlap {
		bottom := min(top+tileHeight, bounds.Max.Y)
		rects = append(rects, image.Rect(bounds.Min.X, top, bounds.Max.X, bottom))
		if bottom >= bounds.Max.Y || len(rects) == maxTiles {
			break
		}
	}
	// Integer rounding can leave a sliver; the last tile always reaches the bottom.
	rects[len(rects)-1].Max.Y = bounds.Max.Y
	return encodeScreenshotTiles(src, rects)
}

func encodeScreenshotTiles(src image.Image, rects []image.Rectangle) ([][]byte, error) {
	out := make([][]byte, 0, len(rects))
	for _, rect := range rects {
		w, h := rect.Dx(), rect.Dy()
		if w > screenshotTileWidth {
			h = max(1, h*screenshotTileWidth/w)
			w = screenshotTileWidth
		}
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		// Screenshots with transparency would turn black in JPEG.
		draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, rect, draw.Over, nil)
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: screenshotJPEGQuality}); err != nil {
			return nil, err
		}
		out = append(out, buf.Bytes())
	}
	return out, nil
}
