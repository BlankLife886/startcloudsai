package assistanttools

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantfiles"
)

func TestBuildAutoLayeredPSDCreatesBackgroundSubjectAndTextLayers(t *testing.T) {
	input := image.NewNRGBA(image.Rect(0, 0, 40, 30))
	for y := 0; y < 30; y++ {
		for x := 0; x < 40; x++ {
			input.SetNRGBA(x, y, color.NRGBA{R: 244, G: 244, B: 244, A: 255})
		}
	}
	for y := 7; y < 25; y++ {
		for x := 12; x < 29; x++ {
			input.SetNRGBA(x, y, color.NRGBA{R: 35, G: 110, B: 220, A: 255})
		}
	}
	for y := 2; y < 6; y++ {
		for x := 4; x < 18; x++ {
			if x%3 != 0 {
				input.SetNRGBA(x, y, color.NRGBA{R: 20, G: 20, B: 20, A: 255})
			}
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, input); err != nil {
		t.Fatal(err)
	}
	segmentationBase := cloneNRGBA(input)
	_ = buildPSDTextLayers(input, segmentationBase, []PSDTextRegion{{Text: "标题", Bounds: image.Rect(2, 1, 20, 8)}})
	mask, backgroundColor, reliable := psdSubjectMask(segmentationBase)
	if !reliable {
		t.Fatal("clean product image should produce a reliable subject mask")
	}
	subjectLayer, _ := splitPSDSubject(segmentationBase, mask, backgroundColor, "subject")
	if subjectLayer.bounds.Min.X < 10 || subjectLayer.bounds.Max.X > 31 || subjectLayer.bounds.Min.Y < 6 || subjectLayer.bounds.Max.Y > 26 {
		t.Fatalf("subject bounds=%v", subjectLayer.bounds)
	}
	data, info, err := buildAutoLayeredPSD(encoded.Bytes(), "示例海报.png", []PSDTextRegion{{
		Text: "标题", Bounds: image.Rect(2, 1, 20, 8),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if info.LayerCount != 3 || info.TextLayerCount != 1 {
		t.Fatalf("info=%#v", info)
	}
	if output := os.Getenv("ASSISTANT_LAYERED_PSD_QA_OUTPUT"); output != "" {
		if err := os.WriteFile(output, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	format, err := assistantfiles.Detect("示例海报.psd", data)
	if err != nil {
		t.Fatal(err)
	}
	document, err := assistantfiles.Parse(format, data)
	if err != nil {
		t.Fatal(err)
	}
	content := document.Segments[0].Content
	for _, expected := range []string{"Layers: 3", "文字 1：标题（栅格）", "主体（自动识别）", "背景（自动补色）"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("layered PSD metadata %q does not contain %q", content, expected)
		}
	}
	composite, err := psdCompositeDataForTest(data)
	if err != nil {
		t.Fatal(err)
	}
	pixels := 40 * 30
	if len(composite) != pixels*4 || composite[12*40+14] != input.NRGBAAt(14, 12).R ||
		composite[pixels+12*40+14] != input.NRGBAAt(14, 12).G {
		t.Fatal("merged composite no longer matches the source image")
	}
}
