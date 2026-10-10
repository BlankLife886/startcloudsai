package assistantfiles

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

const (
	maxImageOCRRegions = 32
	maxImageOCRPixels  = 4096 * 4096
)

type ImageTextRegion struct {
	Text   string
	Bounds image.Rectangle
}

type ImageOCRConfig struct {
	TesseractPath string
	Languages     string
	Timeout       time.Duration
}

// OCRImageRegions returns line-level text bounds. OCR is best-effort for PSD
// layering, so callers may fall back to subject/background layers on error.
func OCRImageRegions(ctx context.Context, data []byte, cfg ImageOCRConfig) ([]ImageTextRegion, error) {
	if !filepath.IsAbs(cfg.TesseractPath) || cfg.Languages == "" ||
		len(cfg.Languages) > 100 || !ocrLanguageRE.MatchString(cfg.Languages) {
		return nil, fmt.Errorf("%w: invalid image OCR configuration", ErrOCRFailed)
	}
	if len(data) == 0 || len(data) > maxOCRInputBytes {
		return nil, fmt.Errorf("%w: invalid or oversized image", ErrOCRFailed)
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: decode image: %v", ErrOCRFailed, err)
	}
	bounds := decoded.Bounds()
	if bounds.Empty() || int64(bounds.Dx())*int64(bounds.Dy()) > maxImageOCRPixels {
		return nil, fmt.Errorf("%w: image dimensions exceed OCR limit", ErrOCRFailed)
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	if timeout > 2*time.Minute {
		timeout = 2 * time.Minute
	}
	workCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tempDir, err := os.MkdirTemp("", "assistant-image-ocr-")
	if err != nil {
		return nil, fmt.Errorf("%w: create temporary directory", ErrOCRFailed)
	}
	defer os.RemoveAll(tempDir)
	inputPath := filepath.Join(tempDir, "input.png")
	// #nosec G304 -- inputPath is a fixed filename inside a newly created private temp directory.
	input, err := os.OpenFile(inputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("%w: create OCR input", ErrOCRFailed)
	}
	encodeErr := png.Encode(input, decoded)
	closeErr := input.Close()
	if encodeErr != nil || closeErr != nil {
		return nil, fmt.Errorf("%w: encode OCR input", ErrOCRFailed)
	}
	raw, err := (systemOCRCommandRunner{}).Run(workCtx, cfg.TesseractPath, []string{
		inputPath, "stdout", "-l", cfg.Languages, "--psm", "11", "-c", "tessedit_create_tsv=1",
	}, maxOCRPageTextBytes)
	if err != nil {
		return nil, fmt.Errorf("%w: recognize image: %v", ErrOCRFailed, err)
	}
	return parseTesseractTSV(raw, bounds.Dx(), bounds.Dy())
}

type tesseractWord struct {
	block, paragraph, line int
	text                   string
	bounds                 image.Rectangle
}

func parseTesseractTSV(data []byte, width, height int) ([]ImageTextRegion, error) {
	reader := csv.NewReader(bytes.NewReader(data))
	reader.Comma = '\t'
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil || len(records) == 0 {
		return nil, fmt.Errorf("%w: invalid Tesseract TSV", ErrOCRFailed)
	}
	words := make([]tesseractWord, 0, len(records))
	for index, record := range records {
		if index == 0 || len(record) < 12 || strings.TrimSpace(record[0]) != "5" {
			continue
		}
		confidence, _ := strconv.ParseFloat(strings.TrimSpace(record[10]), 64)
		text := strings.TrimSpace(record[11])
		if confidence < 35 || text == "" {
			continue
		}
		left, leftErr := strconv.Atoi(record[6])
		top, topErr := strconv.Atoi(record[7])
		boxWidth, widthErr := strconv.Atoi(record[8])
		boxHeight, heightErr := strconv.Atoi(record[9])
		if errors.Join(leftErr, topErr, widthErr, heightErr) != nil || boxWidth <= 0 || boxHeight <= 0 {
			continue
		}
		box := image.Rect(left, top, left+boxWidth, top+boxHeight).Intersect(image.Rect(0, 0, width, height))
		if box.Empty() {
			continue
		}
		block, _ := strconv.Atoi(record[2])
		paragraph, _ := strconv.Atoi(record[3])
		line, _ := strconv.Atoi(record[4])
		words = append(words, tesseractWord{block: block, paragraph: paragraph, line: line, text: text, bounds: box})
	}
	if len(words) == 0 {
		return []ImageTextRegion{}, nil
	}
	type lineKey struct{ block, paragraph, line int }
	grouped := make(map[lineKey][]tesseractWord)
	order := make([]lineKey, 0)
	for _, word := range words {
		key := lineKey{word.block, word.paragraph, word.line}
		if _, ok := grouped[key]; !ok {
			order = append(order, key)
		}
		grouped[key] = append(grouped[key], word)
	}
	regions := make([]ImageTextRegion, 0, min(len(order), maxImageOCRRegions))
	canvas := image.Rect(0, 0, width, height)
	for _, key := range order {
		lineWords := grouped[key]
		sort.SliceStable(lineWords, func(i, j int) bool { return lineWords[i].bounds.Min.X < lineWords[j].bounds.Min.X })
		box := lineWords[0].bounds
		parts := make([]string, 0, len(lineWords))
		for _, word := range lineWords {
			box = box.Union(word.bounds)
			parts = append(parts, word.text)
		}
		padding := max(2, box.Dy()/8)
		box = image.Rect(box.Min.X-padding, box.Min.Y-padding, box.Max.X+padding, box.Max.Y+padding).Intersect(canvas)
		regions = append(regions, ImageTextRegion{Text: strings.Join(parts, " "), Bounds: box})
		if len(regions) >= maxImageOCRRegions {
			break
		}
	}
	return regions, nil
}
