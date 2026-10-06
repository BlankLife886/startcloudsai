package media

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func pngOf(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		img.Set(width/2, y, color.Black)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestScreenshotTilesKeepsNormalImagesWhole(t *testing.T) {
	tiles, err := ScreenshotTiles(pngOf(t, 800, 1200), 6)
	if err != nil || len(tiles) != 1 {
		t.Fatalf("tiles=%d err=%v", len(tiles), err)
	}
}

func TestScreenshotTilesCutsTallPagesIntoReadableScreens(t *testing.T) {
	tiles, err := ScreenshotTiles(pngOf(t, 750, 8000), 12)
	if err != nil {
		t.Fatal(err)
	}
	// 750 wide → 1125 tall tiles with 90px overlap: 8 screens.
	if len(tiles) != 8 {
		t.Fatalf("tiles = %d, want 8", len(tiles))
	}
	for index, tile := range tiles {
		w, h, err := Dimensions(tile)
		if err != nil || w != 750 || float64(h) > 750*1.5+1 {
			t.Fatalf("tile %d = %dx%d err=%v", index, w, h, err)
		}
	}
}

func TestScreenshotTilesStretchesTilesToFitTheCap(t *testing.T) {
	tiles, err := ScreenshotTiles(pngOf(t, 2000, 20000), 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(tiles) != 4 {
		t.Fatalf("tiles = %d, want 4", len(tiles))
	}
	total := 0
	for _, tile := range tiles {
		w, h, _ := Dimensions(tile)
		if w != screenshotTileWidth {
			t.Fatalf("tile width = %d, want %d", w, screenshotTileWidth)
		}
		total += h
	}
	// Scaled page is 10240 tall; tiles plus overlap must cover it.
	if total < 10240 {
		t.Fatalf("tiles cover %d px of a 10240 px page", total)
	}
}
