package assistantfiles

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestParseTesseractTSVGroupsWordsIntoTextLines(t *testing.T) {
	tsv := strings.Join([]string{
		"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
		"5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t92.0\tStar",
		"5\t1\t1\t1\t1\t2\t45\t20\t38\t12\t88.0\tClouds",
		"5\t1\t1\t1\t2\t1\t12\t50\t45\t14\t90.0\t设计",
		"5\t1\t1\t1\t3\t1\t0\t0\t10\t10\t10.0\t低置信度",
	}, "\n")
	regions, err := parseTesseractTSV([]byte(tsv), 200, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 2 || regions[0].Text != "Star Clouds" || regions[1].Text != "设计" {
		t.Fatalf("regions=%#v", regions)
	}
	if regions[0].Bounds.Min.X >= 10 || regions[0].Bounds.Max.X <= 83 {
		t.Fatalf("line bounds were not padded: %v", regions[0].Bounds)
	}
}

func TestOCRImageRegionsRunsTesseractAndReturnsBounds(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	dir := t.TempDir()
	executable := filepath.Join(dir, "fake-tesseract")
	tsv := strings.Join([]string{
		"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
		"5\t1\t1\t1\t1\t1\t3\t4\t8\t5\t96.0\tLogo",
	}, "\n")
	script := "#!/bin/sh\nprintf '%s\\n' '" + strings.ReplaceAll(tsv, "'", "'\\''") + "'\n"
	if err := os.WriteFile(executable, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	input := image.NewNRGBA(image.Rect(0, 0, 20, 12))
	for index := range input.Pix {
		input.Pix[index] = 255
	}
	input.SetNRGBA(4, 5, color.NRGBA{A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, input); err != nil {
		t.Fatal(err)
	}
	regions, err := OCRImageRegions(context.Background(), encoded.Bytes(), ImageOCRConfig{
		TesseractPath: executable, Languages: "eng", Timeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 1 || regions[0].Text != "Logo" || !regions[0].Bounds.In(image.Rect(0, 0, 20, 12)) {
		t.Fatalf("regions=%#v", regions)
	}
}
