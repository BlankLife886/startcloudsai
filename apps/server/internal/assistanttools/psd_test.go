package assistanttools

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantfiles"
)

func TestBuildPSDCreatesDeterministicSingleLayerWithAlpha(t *testing.T) {
	sourceImage := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	sourceImage.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 0})
	sourceImage.SetNRGBA(1, 0, color.NRGBA{G: 255, A: 64})
	sourceImage.SetNRGBA(0, 1, color.NRGBA{B: 255, A: 128})
	sourceImage.SetNRGBA(1, 1, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	var source bytes.Buffer
	if err := png.Encode(&source, sourceImage); err != nil {
		t.Fatal(err)
	}

	data, err := buildPSD(source.Bytes(), "透明示例.png")
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := buildPSD(source.Bytes(), "透明示例.png")
	if err != nil || !bytes.Equal(data, repeated) {
		t.Fatalf("PSD output must be deterministic: equal=%t err=%v", bytes.Equal(data, repeated), err)
	}
	if !bytes.HasPrefix(data, []byte("8BPS")) || binary.BigEndian.Uint16(data[12:14]) != 4 ||
		binary.BigEndian.Uint32(data[14:18]) != 2 || binary.BigEndian.Uint32(data[18:22]) != 2 {
		t.Fatalf("invalid PSD header: %x", data[:26])
	}
	if output := os.Getenv("ASSISTANT_PSD_QA_OUTPUT"); output != "" {
		if err := os.WriteFile(output, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	format, err := assistantfiles.Detect("透明示例.psd", data)
	if err != nil {
		t.Fatal(err)
	}
	document, err := assistantfiles.Parse(format, data)
	if err != nil {
		t.Fatal(err)
	}
	content := document.Segments[0].Content
	for _, expected := range []string{"Canvas: 2 x 2 px", "Channels: 4", "Layers: 1", "- 透明示例"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("PSD metadata %q does not contain %q", content, expected)
		}
	}

	composite, err := psdCompositeDataForTest(data)
	if err != nil {
		t.Fatal(err)
	}
	if got := composite[12:16]; !bytes.Equal(got, []byte{0, 64, 128, 255}) {
		t.Fatalf("merged alpha = %v", got)
	}
}

func TestImageToPSDRequestedRequiresAnExplicitCommand(t *testing.T) {
	for _, prompt := range []string{"把这张图片转换为 PSD", "保存为PSD", "Convert this image to a PSD"} {
		if !ImageToPSDRequested(prompt) {
			t.Fatalf("explicit conversion command did not match: %q", prompt)
		}
	}
	for _, prompt := range []string{"图片可以转 PSD 吗？", "PSD 是什么？", "分析这个 PSD"} {
		if ImageToPSDRequested(prompt) {
			t.Fatalf("conceptual request must not trigger conversion: %q", prompt)
		}
	}
}

func TestValidatePSDCanvasRejectsOversizedImages(t *testing.T) {
	if err := validatePSDCanvas(4096, 4096); err != nil {
		t.Fatalf("4096 square should be supported: %v", err)
	}
	if err := validatePSDCanvas(4097, 4097); err == nil {
		t.Fatal("oversized PSD canvas should be rejected")
	}
}

func psdCompositeDataForTest(data []byte) ([]byte, error) {
	offset := 26
	for range 3 {
		if offset+4 > len(data) {
			return nil, assistantfiles.ErrUnsafe
		}
		length := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		offset += 4 + length
		if offset > len(data) {
			return nil, assistantfiles.ErrUnsafe
		}
	}
	if offset+2 > len(data) || binary.BigEndian.Uint16(data[offset:offset+2]) != 0 {
		return nil, assistantfiles.ErrUnsafe
	}
	return data[offset+2:], nil
}
