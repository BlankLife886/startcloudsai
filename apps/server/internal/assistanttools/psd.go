package assistanttools

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg"
	_ "image/png"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	_ "golang.org/x/image/webp"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	maxPSDCanvasPixels   = 4096 * 4096
	maxGeneratedPSDBytes = 144 << 20
	maxPSDLayerNameRunes = 255
)

var imageToPSDPattern = regexp.MustCompile(`(?i)\b(?:convert|export|save|make|create)\b.{0,40}\b(?:to|as)\s+(?:an?\s+)?psd\b`)

// ImageToPSDRequested deliberately matches explicit conversion commands only.
// Questions such as "can an image become a PSD?" remain normal chat requests.
func ImageToPSDRequested(prompt string) bool {
	value := strings.ToLower(strings.TrimSpace(prompt))
	if value == "" || !strings.Contains(value, "psd") {
		return false
	}
	compact := strings.NewReplacer(" ", "", "\t", "", "\r", "", "\n", "").Replace(value)
	for _, phrase := range []string{
		"转成psd", "转换成psd", "转为psd", "转换为psd", "做成psd",
		"导出psd", "导出为psd", "保存为psd", "生成psd", "制作psd", "输出psd",
	} {
		if strings.Contains(compact, phrase) {
			return true
		}
	}
	return imageToPSDPattern.MatchString(value)
}

// CreatePSDArtifact converts a supported raster image into a standard PSD v1
// file with one pixel layer and stores it as an authenticated assistant artifact.
func CreatePSDArtifact(
	ctx context.Context,
	st *store.Store,
	storage ArtifactStorage,
	invocation Invocation,
	name string,
	layerName string,
	source []byte,
) (map[string]any, error) {
	data, err := buildPSD(source, layerName)
	if err != nil {
		return nil, err
	}
	name = safeArtifactName(name, "psd")
	return persistArtifact(ctx, st, storage, invocation, name, "image/vnd.adobe.photoshop", data)
}

func buildPSD(source []byte, layerName string) ([]byte, error) {
	if len(source) == 0 {
		return nil, errors.New("source image is empty")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode source image header: %w", err)
	}
	if err := validatePSDCanvas(config.Width, config.Height); err != nil {
		return nil, err
	}
	src, _, err := image.Decode(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode source image: %w", err)
	}
	width, height := config.Width, config.Height
	pixels := width * height
	estimated := 256 + pixels*8
	if estimated > maxGeneratedPSDBytes {
		return nil, fmt.Errorf("generated PSD would exceed %d MiB", maxGeneratedPSDBytes>>20)
	}

	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(canvas, canvas.Bounds(), src, src.Bounds().Min, draw.Src)
	layerName = safePSDLayerName(layerName)

	out := bytes.NewBuffer(make([]byte, 0, estimated))
	writePSDString(out, "8BPS")
	writePSDUint16(out, 1)
	out.Write(make([]byte, 6))
	writePSDUint16(out, 4)
	writePSDUint32(out, checkedPSDUint32(height))
	writePSDUint32(out, checkedPSDUint32(width))
	writePSDUint16(out, 8)
	writePSDUint16(out, 3)
	writePSDUint32(out, 0) // color mode data
	writePSDUint32(out, 0) // image resources

	layerMaskLengthOffset := reservePSDUint32(out)
	layerMaskStart := out.Len()
	layerInfoLengthOffset := reservePSDUint32(out)
	layerInfoStart := out.Len()
	writePSDInt16(out, -1) // one layer; merged alpha contains transparency
	writePSDLayerRecord(out, width, height, pixels, layerName)

	plane := make([]byte, pixels)
	for channel := 0; channel < 4; channel++ {
		writePSDUint16(out, 0) // raw layer channel data
		fillPSDPlane(plane, canvas, channel)
		out.Write(plane)
	}
	if (out.Len()-layerInfoStart)%2 != 0 {
		out.WriteByte(0)
	}
	patchPSDUint32(out.Bytes(), layerInfoLengthOffset, out.Len()-layerInfoStart)
	writePSDUint32(out, 0) // global layer mask info
	patchPSDUint32(out.Bytes(), layerMaskLengthOffset, out.Len()-layerMaskStart)

	writePSDUint16(out, 0) // raw merged image data
	for channel := 0; channel < 4; channel++ {
		fillPSDPlane(plane, canvas, channel)
		out.Write(plane)
	}
	if out.Len() > maxGeneratedPSDBytes {
		return nil, fmt.Errorf("generated PSD exceeds %d MiB", maxGeneratedPSDBytes>>20)
	}
	return out.Bytes(), nil
}

func validatePSDCanvas(width, height int) error {
	if width <= 0 || height <= 0 || width > 30_000 || height > 30_000 ||
		int64(width)*int64(height) > maxPSDCanvasPixels {
		return fmt.Errorf("image dimensions exceed PSD conversion limit (%d megapixels)", maxPSDCanvasPixels/1_000_000)
	}
	return nil
}

func writePSDLayerRecord(out *bytes.Buffer, width, height, pixels int, layerName string) {
	writePSDInt32(out, 0)
	writePSDInt32(out, 0)
	writePSDInt32(out, checkedPSDInt32(height))
	writePSDInt32(out, checkedPSDInt32(width))
	writePSDUint16(out, 4)
	for _, channelID := range []int16{0, 1, 2, -1} {
		writePSDInt16(out, channelID)
		writePSDUint32(out, checkedPSDUint32(2+pixels))
	}
	writePSDString(out, "8BIM")
	writePSDString(out, "norm")
	out.Write([]byte{255, 0, 0, 0})

	extraLengthOffset := reservePSDUint32(out)
	extraStart := out.Len()
	writePSDUint32(out, 0) // layer mask data
	writePSDUint32(out, 0) // blending ranges
	writePSDPascalName(out, layerName)
	writePSDUnicodeLayerName(out, layerName)
	patchPSDUint32(out.Bytes(), extraLengthOffset, out.Len()-extraStart)
}

func fillPSDPlane(dst []byte, image *image.NRGBA, channel int) {
	index := 0
	for y := 0; y < image.Rect.Dy(); y++ {
		row := image.Pix[y*image.Stride : y*image.Stride+image.Rect.Dx()*4]
		for x := channel; x < len(row); x += 4 {
			dst[index] = row[x]
			index++
		}
	}
}

func safePSDLayerName(value string) string {
	value = strings.TrimSpace(strings.TrimSuffix(filepath.Base(strings.ReplaceAll(value, "\\", "/")), filepath.Ext(value)))
	if value == "" || value == "." {
		value = "Image"
	}
	runes := []rune(value)
	if len(runes) > maxPSDLayerNameRunes {
		value = string(runes[:maxPSDLayerNameRunes])
	}
	return value
}

func writePSDPascalName(out *bytes.Buffer, value string) {
	legacy := []byte(value)
	if len(legacy) > 255 {
		legacy = legacy[:255]
		for len(legacy) > 0 && !utf8.Valid(legacy) {
			legacy = legacy[:len(legacy)-1]
		}
	}
	start := out.Len()
	out.WriteByte(byte(len(legacy)))
	out.Write(legacy)
	for (out.Len()-start)%4 != 0 {
		out.WriteByte(0)
	}
}

func writePSDUnicodeLayerName(out *bytes.Buffer, value string) {
	units := utf16.Encode([]rune(value))
	writePSDString(out, "8BIM")
	writePSDString(out, "luni")
	length := 4 + len(units)*2
	writePSDUint32(out, checkedPSDUint32(length))
	writePSDUint32(out, checkedPSDUint32(len(units)))
	for _, unit := range units {
		writePSDUint16(out, unit)
	}
	if length%2 != 0 {
		out.WriteByte(0)
	}
}

func reservePSDUint32(out *bytes.Buffer) int {
	offset := out.Len()
	writePSDUint32(out, 0)
	return offset
}

func patchPSDUint32(data []byte, offset, value int) {
	binary.BigEndian.PutUint32(data[offset:offset+4], checkedPSDUint32(value))
}

func checkedPSDUint32(value int) uint32 {
	if value < 0 || value > 1<<30 {
		panic("PSD uint32 field exceeds encoder limit")
	}
	// #nosec G115 -- the value is restricted to a positive 30-bit range above.
	return uint32(value)
}

func checkedPSDInt32(value int) int32 {
	if value < -(1<<30) || value > 1<<30 {
		panic("PSD int32 field exceeds encoder limit")
	}
	// #nosec G115 -- the value is restricted to a signed 31-bit range above.
	return int32(value)
}

func checkedPSDInt16(value int) int16 {
	if value < -(1<<15) || value >= 1<<15 {
		panic("PSD int16 field exceeds encoder limit")
	}
	// #nosec G115 -- the value is restricted to the int16 range above.
	return int16(value)
}

func psdColorByte(value int64) uint8 {
	value = max(int64(0), min(int64(255), value))
	// #nosec G115 -- the color component is clamped to [0, 255] above.
	return uint8(value)
}

func writePSDString(out *bytes.Buffer, value string) { _, _ = out.WriteString(value) }
func writePSDUint16(out *bytes.Buffer, value uint16) { _ = binary.Write(out, binary.BigEndian, value) }
func writePSDInt16(out *bytes.Buffer, value int16)   { _ = binary.Write(out, binary.BigEndian, value) }
func writePSDUint32(out *bytes.Buffer, value uint32) { _ = binary.Write(out, binary.BigEndian, value) }
func writePSDInt32(out *bytes.Buffer, value int32)   { _ = binary.Write(out, binary.BigEndian, value) }
