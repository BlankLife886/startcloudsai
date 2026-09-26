package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"
)

func TestStrictAlphaExecutionCandidatesPreventUnsupportedFailover(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Provider: modelconfig.Provider{ID: "crun-route", Adapter: modelconfig.AdapterCRUN}, Model: modelconfig.Model{Kind: modelconfig.ModelKindImage}},
		{Provider: modelconfig.Provider{ID: "openai-route", Adapter: modelconfig.AdapterOpenAI}, Model: modelconfig.Model{Kind: modelconfig.ModelKindImage}},
	}
	if got := strictAlphaExecutionCandidates(candidates, nil); len(got) != 2 {
		t.Fatalf("ordinary image routes were filtered: %#v", got)
	}
	params := map[string]any{
		"strictAlphaOutput": true, "outputFormat": "png", "quality": "high",
		"inputFidelity": "high", "transparentBackground": true,
	}
	got := strictAlphaExecutionCandidates(candidates, params)
	if len(got) != 1 || got[0].Provider.ID != "openai-route" {
		t.Fatalf("strict alpha failover must retain only the configured OpenAI route: %#v", got)
	}
	params["inputFidelity"] = "low"
	if got := strictAlphaExecutionCandidates(got, params); len(got) != 0 {
		t.Fatalf("invalid strict contract must not execute: %#v", got)
	}
}

func TestStrictAlphaExecutionCandidatesRetainBuiltInFormatRoute(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Provider: modelconfig.Provider{ID: "built-in", Adapter: modelconfig.AdapterOpenAI}, Model: modelconfig.Model{Kind: modelconfig.ModelKindImage, OutputFormats: []string{}}},
		{Provider: modelconfig.Provider{ID: "selectable", Adapter: modelconfig.AdapterOpenAI}, Model: modelconfig.Model{Kind: modelconfig.ModelKindImage, OutputFormats: []string{"png"}}},
		{Provider: modelconfig.Provider{ID: "crun", Adapter: modelconfig.AdapterCRUN}, Model: modelconfig.Model{Kind: modelconfig.ModelKindImage}},
	}
	params := map[string]any{
		"strictAlphaOutput": true, "quality": "high",
		"inputFidelity": "high", "transparentBackground": true,
	}
	got := strictAlphaExecutionCandidates(candidates, params)
	if len(got) != 1 || got[0].Provider.ID != "built-in" {
		t.Fatalf("omitted output format must retain only an eligible built-in format route: %#v", got)
	}
}

func encodeStrictAlphaPNG(t *testing.T, source image.Image) []byte {
	t.Helper()
	var encoded bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func strictAlphaFixture(width, height int, alphaAt func(int, int) uint8) *image.NRGBA {
	source := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 40, G: 160, B: 224, A: alphaAt(x, y)})
		}
	}
	return source
}

func centeredStrictAlpha(alpha uint8) func(int, int) uint8 {
	return func(x, y int) uint8 {
		if x >= 128 && x < 896 && y >= 128 && y < 896 {
			return alpha
		}
		return 0
	}
}

func TestValidateStrictAlphaOutput(t *testing.T) {
	tests := []struct {
		name    string
		alphaAt func(int, int) uint8
		wantErr string
	}{
		{name: "opaque subject", alphaAt: centeredStrictAlpha(255)},
		{name: "translucent subject", alphaAt: centeredStrictAlpha(80)},
		{name: "small visible subject", alphaAt: func(x, y int) uint8 {
			if x >= 486 && x < 538 && y >= 486 && y < 538 {
				return 245
			}
			return 0
		}},
		{name: "subject touching bottom edge", alphaAt: func(x, y int) uint8 {
			if x >= 128 && x < 896 && y >= 128 {
				return 255
			}
			return 0
		}},
		{name: "opaque image", alphaAt: func(int, int) uint8 { return 255 }, wantErr: "1%"},
		{name: "fully transparent image", alphaAt: func(int, int) uint8 { return 0 }, wantErr: "visible alpha"},
		{name: "near transparent noise", alphaAt: centeredStrictAlpha(8), wantErr: "visible alpha"},
		{name: "single transparent pixel", alphaAt: func(x, y int) uint8 {
			if x == 0 && y == 0 {
				return 0
			}
			return 255
		}, wantErr: "1%"},
		{name: "transparent one pixel border", alphaAt: func(x, y int) uint8 {
			if x == 0 || x == 1023 || y == 0 || y == 1023 {
				return 0
			}
			return 255
		}, wantErr: "1%"},
		{name: "transparent interior and opaque background perimeter", alphaAt: func(x, y int) uint8 {
			return 255 - centeredStrictAlpha(255)(x, y)
		}, wantErr: "perimeter"},
		{name: "tiny foreground speck", alphaAt: func(x, y int) uint8 {
			if x >= 500 && x < 516 && y >= 500 && y < 516 {
				return 255
			}
			return 0
		}, wantErr: "visible alpha"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data := encodeStrictAlphaPNG(t, strictAlphaFixture(1024, 1024, test.alphaAt))
			err := validateStrictAlphaOutput(data)
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("valid subject rejected: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestValidateStrictAlphaRejectsPaintedCheckerboard(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 1024, 1024))
	for y := 0; y < 1024; y++ {
		for x := 0; x < 1024; x++ {
			shade := uint8(255)
			if (x/16+y/16)%2 == 0 {
				shade = 192
			}
			source.SetNRGBA(x, y, color.NRGBA{R: shade, G: shade, B: shade, A: 255})
		}
	}
	if err := validateStrictAlphaOutput(encodeStrictAlphaPNG(t, source)); err == nil {
		t.Fatal("opaque checkerboard was mistaken for actual transparency")
	}
}

func strictAlphaPNGHeader(width, height uint32) []byte {
	data := make([]byte, 33)
	copy(data, "\x89PNG\r\n\x1a\n")
	binary.BigEndian.PutUint32(data[8:12], 13)
	copy(data[12:16], "IHDR")
	binary.BigEndian.PutUint32(data[16:20], width)
	binary.BigEndian.PutUint32(data[20:24], height)
	data[24], data[25] = 8, 6
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
	return data
}

func TestStrictAlphaOutputRejectsInvalidFormatAndDimensionsBeforeDecode(t *testing.T) {
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 1024, 1024)), nil); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		data    []byte
		wantErr string
	}{
		{name: "JPEG", data: jpegData.Bytes(), wantErr: "valid PNG"},
		{name: "unsupported bytes", data: []byte("not a png"), wantErr: "valid PNG"},
		{name: "low resolution", data: strictAlphaPNGHeader(1023, 1536), wantErr: "short edge"},
		{name: "oversized compressed image", data: strictAlphaPNGHeader(8000, 4001), wantErr: "decoded pixels"},
		{name: "corrupt image data", data: strictAlphaPNGHeader(1024, 1024), wantErr: "cannot decode"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateStrictAlphaOutput(test.data)
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("error = %v, want %q", err, test.wantErr)
			}
		})
	}
	weight, err := strictAlphaOutputMemoryWeight(base64.StdEncoding.EncodeToString(strictAlphaPNGHeader(1024, 1536)))
	if err != nil || weight != 1024*1536*32 {
		t.Fatalf("memory reservation = %d, %v, want decoded-pixel weight", weight, err)
	}
}

func TestValidateStrictAlphaPreservesSoftEdgesAndHiddenColor(t *testing.T) {
	alphaLevels := []uint8{0, 1, 4, 8, 12, 32, 64, 127, 200, 244, 245, 250, 255}
	source := strictAlphaFixture(1024, 1024, func(x, y int) uint8 {
		if x >= 128 && x < 896 && y >= 128 && y < 896 {
			return alphaLevels[(x-128)%len(alphaLevels)]
		}
		return 0
	})
	data := encodeStrictAlphaPNG(t, source)
	before := append([]byte(nil), data...)
	if err := validateStrictAlphaOutput(data); err != nil {
		t.Fatalf("soft edges rejected: %v", err)
	}
	if !bytes.Equal(before, data) {
		t.Fatal("validation modified the original PNG bytes")
	}
	decoded, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	for index, alpha := range alphaLevels {
		got := color.NRGBAModel.Convert(decoded.At(128+index, 128)).(color.NRGBA)
		if got != (color.NRGBA{R: 40, G: 160, B: 224, A: alpha}) {
			t.Fatalf("edge pixel %d changed: %#v", index, got)
		}
	}
}

func TestValidateStrictAlphaAcceptsPaletteAnd16BitPNG(t *testing.T) {
	palette := image.NewPaletted(image.Rect(0, 0, 1024, 1024), color.Palette{
		color.NRGBA{}, color.NRGBA{R: 40, G: 160, B: 224, A: 255},
	})
	sixteenBit := image.NewNRGBA64(image.Rect(0, 0, 1024, 1024))
	for y := 128; y < 896; y++ {
		for x := 128; x < 896; x++ {
			palette.SetColorIndex(x, y, 1)
			sixteenBit.SetNRGBA64(x, y, color.NRGBA64{R: 10000, G: 30000, B: 50000, A: 30000})
		}
	}
	for _, source := range []image.Image{palette, sixteenBit} {
		if err := validateStrictAlphaOutput(encodeStrictAlphaPNG(t, source)); err != nil {
			t.Fatalf("%T PNG rejected: %v", source, err)
		}
	}
}

func TestStrictAlphaTaskOutputIsOptInAndNonRetryable(t *testing.T) {
	for _, params := range []map[string]any{nil, {}, {"strictAlphaOutput": false}, {"strictAlphaOutput": "true"}} {
		if err := validateStrictAlphaTaskOutput(&store.Task{Params: params}, []byte("legacy output")); err != nil {
			t.Fatalf("legacy task output was changed: %v", err)
		}
	}
	if err := validateStrictAlphaTaskOutput(nil, nil); err != nil {
		t.Fatalf("nil task was rejected: %v", err)
	}
	err := validateStrictAlphaTaskOutput(&store.Task{Params: map[string]any{"strictAlphaOutput": true}}, []byte("legacy output"))
	var processingErr *taskOutputProcessingError
	if !errors.As(err, &processingErr) || processingErr.stage != "transparent output validation" {
		t.Fatalf("invalid alpha must use post-processing cleanup and refund path: %v", err)
	}
	if isRetryableTaskError(err) {
		t.Fatal("invalid transparency must not silently generate a new paid image")
	}
}

func TestTaskOutputCollectorRejectsStrictAlphaBeforeStorage(t *testing.T) {
	for _, source := range []image.Image{
		strictAlphaFixture(1024, 1024, func(int, int) uint8 { return 255 }),
		strictAlphaFixture(512, 512, centeredStrictAlpha(255)),
	} {
		w := &Worker{imageMemoryBytes: 64 << 20, imageMemory: semaphore.NewWeighted(64 << 20)}
		task := &store.Task{ID: uuid.New(), Count: 1, Params: map[string]any{"strictAlphaOutput": true}}
		collector := newTaskOutputCollector(w, context.Background(), task)
		// The stage write is unrelated to validation; no database or storage is configured.
		collector.stageOnce.Do(func() {})
		err := collector.persist(0, base64.StdEncoding.EncodeToString(encodeStrictAlphaPNG(t, source)))
		var processingErr *taskOutputProcessingError
		if !errors.As(err, &processingErr) || processingErr.stage != "transparent output validation" {
			t.Fatalf("invalid subject must stop before storage and partial success: %v", err)
		}
		outputs, thumbnails := collector.completed()
		if len(outputs) != 0 || len(thumbnails) != 0 {
			t.Fatalf("invalid subject was published: %v, %v", outputs, thumbnails)
		}
	}
}
