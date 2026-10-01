package assistanttools

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"sort"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	maxAutoPSDTextLayers = 24
	maxLayeredPSDBytes   = 256 << 20
)

type PSDTextRegion struct {
	Text   string
	Bounds image.Rectangle
}

type PSDLayeredInfo struct {
	LayerCount     int
	TextLayerCount int
	LayerNames     []string
}

type psdRasterLayer struct {
	name   string
	bounds image.Rectangle
	pixels *image.NRGBA
}

func CreateAutoLayeredPSDArtifact(
	ctx context.Context,
	st *store.Store,
	storage ArtifactStorage,
	invocation Invocation,
	name string,
	layerName string,
	source []byte,
	textRegions []PSDTextRegion,
) (map[string]any, PSDLayeredInfo, error) {
	data, info, err := buildAutoLayeredPSD(source, layerName, textRegions)
	if err != nil {
		return nil, PSDLayeredInfo{}, err
	}
	name = safeArtifactName(name, "psd")
	artifact, err := persistArtifact(ctx, st, storage, invocation, name, "image/vnd.adobe.photoshop", data)
	if err != nil {
		return nil, PSDLayeredInfo{}, err
	}
	artifact["layerCount"] = info.LayerCount
	artifact["textLayerCount"] = info.TextLayerCount
	artifact["autoLayered"] = true
	return artifact, info, nil
}

func buildAutoLayeredPSD(source []byte, sourceName string, textRegions []PSDTextRegion) ([]byte, PSDLayeredInfo, error) {
	canvas, err := decodePSDCanvas(source)
	if err != nil {
		return nil, PSDLayeredInfo{}, err
	}
	base := cloneNRGBA(canvas)
	textLayers := buildPSDTextLayers(canvas, base, textRegions)

	subjectMask, backgroundColor, reliable := psdSubjectMask(base)
	if !reliable {
		subjectMask = psdCentralCandidateMask(base.Rect.Dx(), base.Rect.Dy())
	}
	subjectName := "主体（自动识别）"
	if name := safePSDLayerName(sourceName); name != "Image" {
		subjectName += " - " + name
	}
	if !reliable {
		subjectName = "中央区域（自动候选）"
	}
	subject, background := splitPSDSubject(base, subjectMask, backgroundColor, subjectName)
	// PSD layer records are stored bottom-to-top.
	layers := make([]psdRasterLayer, 0, len(textLayers)+2)
	layers = append(layers, background, subject)
	layers = append(layers, textLayers...)

	data, err := encodeLayeredPSD(canvas, layers)
	if err != nil {
		return nil, PSDLayeredInfo{}, err
	}
	names := make([]string, 0, len(layers))
	for _, layer := range layers {
		names = append(names, layer.name)
	}
	return data, PSDLayeredInfo{
		LayerCount: len(layers), TextLayerCount: len(textLayers), LayerNames: names,
	}, nil
}

func decodePSDCanvas(source []byte) (*image.NRGBA, error) {
	if len(source) == 0 {
		return nil, fmt.Errorf("source image is empty")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode source image header: %w", err)
	}
	if err := validatePSDCanvas(config.Width, config.Height); err != nil {
		return nil, err
	}
	decoded, _, err := image.Decode(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode source image: %w", err)
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, config.Width, config.Height))
	draw.Draw(canvas, canvas.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	return canvas, nil
}

func cloneNRGBA(source *image.NRGBA) *image.NRGBA {
	clone := image.NewNRGBA(source.Rect)
	copy(clone.Pix, source.Pix)
	return clone
}

func buildPSDTextLayers(source, base *image.NRGBA, regions []PSDTextRegion) []psdRasterLayer {
	canvas := source.Bounds()
	regions = append([]PSDTextRegion(nil), regions...)
	sort.SliceStable(regions, func(i, j int) bool {
		if regions[i].Bounds.Min.Y != regions[j].Bounds.Min.Y {
			return regions[i].Bounds.Min.Y < regions[j].Bounds.Min.Y
		}
		return regions[i].Bounds.Min.X < regions[j].Bounds.Min.X
	})
	layers := make([]psdRasterLayer, 0, min(len(regions), maxAutoPSDTextLayers))
	for _, region := range regions {
		bounds := region.Bounds.Intersect(canvas)
		if bounds.Empty() || bounds.Dx()*bounds.Dy() > canvas.Dx()*canvas.Dy()/3 {
			continue
		}
		background := dominantPSDColor(source, bounds)
		crop := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
		selected := 0
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			for x := bounds.Min.X; x < bounds.Max.X; x++ {
				pixel := source.NRGBAAt(x, y)
				if pixel.A < 8 || psdColorDistance(pixel, background) < 56 {
					continue
				}
				crop.SetNRGBA(x-bounds.Min.X, y-bounds.Min.Y, pixel)
				base.SetNRGBA(x, y, color.NRGBA{R: background.R, G: background.G, B: background.B, A: pixel.A})
				selected++
			}
		}
		if selected < max(2, bounds.Dx()*bounds.Dy()/250) {
			continue
		}
		label := strings.TrimSpace(region.Text)
		if label == "" {
			label = fmt.Sprintf("区域 %d", len(layers)+1)
		}
		runes := []rune(label)
		if len(runes) > 28 {
			label = string(runes[:28])
		}
		layers = append(layers, psdRasterLayer{
			name: fmt.Sprintf("文字 %d：%s（栅格）", len(layers)+1, label), bounds: bounds, pixels: crop,
		})
		if len(layers) >= maxAutoPSDTextLayers {
			break
		}
	}
	return layers
}

func dominantPSDColor(source *image.NRGBA, bounds image.Rectangle) color.NRGBA {
	type bucket struct {
		count            int
		red, green, blue int64
	}
	buckets := make(map[uint16]bucket)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := source.NRGBAAt(x, y)
			if pixel.A < 32 {
				continue
			}
			key := uint16(pixel.R>>4)<<8 | uint16(pixel.G>>4)<<4 | uint16(pixel.B>>4)
			value := buckets[key]
			value.count++
			value.red += int64(pixel.R)
			value.green += int64(pixel.G)
			value.blue += int64(pixel.B)
			buckets[key] = value
		}
	}
	best := bucket{}
	for _, value := range buckets {
		if value.count > best.count {
			best = value
		}
	}
	if best.count == 0 {
		return color.NRGBA{A: 255}
	}
	return color.NRGBA{
		R: psdColorByte(best.red / int64(best.count)), G: psdColorByte(best.green / int64(best.count)),
		B: psdColorByte(best.blue / int64(best.count)), A: 255,
	}
}

func psdSubjectMask(source *image.NRGBA) ([]bool, color.NRGBA, bool) {
	width, height := source.Rect.Dx(), source.Rect.Dy()
	pixels := width * height
	palette := psdCornerPalette(source)
	background := averagePSDColors(palette)
	distances := make([]int, 0, 2*(width+height))
	for x := 0; x < width; x++ {
		distances = append(distances, nearestPSDColorDistance(source.NRGBAAt(x, 0), palette))
		if height > 1 {
			distances = append(distances, nearestPSDColorDistance(source.NRGBAAt(x, height-1), palette))
		}
	}
	for y := 1; y+1 < height; y++ {
		distances = append(distances, nearestPSDColorDistance(source.NRGBAAt(0, y), palette))
		if width > 1 {
			distances = append(distances, nearestPSDColorDistance(source.NRGBAAt(width-1, y), palette))
		}
	}
	sort.Ints(distances)
	threshold := 72
	if len(distances) > 0 {
		threshold = min(150, max(48, distances[len(distances)*3/4]+24))
	}
	backgroundMask := make([]bool, pixels)
	queue := make([]int, 0, min(pixels, 1<<20))
	push := func(x, y int) {
		index := y*width + x
		if backgroundMask[index] {
			return
		}
		pixel := source.NRGBAAt(x, y)
		if pixel.A >= 8 && nearestPSDColorDistance(pixel, palette) > threshold {
			return
		}
		backgroundMask[index] = true
		queue = append(queue, index)
	}
	for x := 0; x < width; x++ {
		push(x, 0)
		push(x, height-1)
	}
	for y := 1; y+1 < height; y++ {
		push(0, y)
		push(width-1, y)
	}
	for head := 0; head < len(queue); head++ {
		index := queue[head]
		x, y := index%width, index/width
		if x > 0 {
			push(x-1, y)
		}
		if x+1 < width {
			push(x+1, y)
		}
		if y > 0 {
			push(x, y-1)
		}
		if y+1 < height {
			push(x, y+1)
		}
	}
	subject := make([]bool, pixels)
	count := 0
	for index := range subject {
		x, y := index%width, index/width
		if !backgroundMask[index] && source.NRGBAAt(x, y).A >= 8 {
			subject[index] = true
			count++
		}
	}
	coverage := float64(count) / float64(max(1, pixels))
	return subject, background, coverage >= 0.02 && coverage <= 0.92
}

func psdCornerPalette(source *image.NRGBA) []color.NRGBA {
	width, height := source.Rect.Dx(), source.Rect.Dy()
	size := min(24, max(2, min(width, height)/24))
	areas := []image.Rectangle{
		image.Rect(0, 0, size, size), image.Rect(width-size, 0, width, size),
		image.Rect(0, height-size, size, height), image.Rect(width-size, height-size, width, height),
	}
	palette := make([]color.NRGBA, 0, len(areas))
	for _, area := range areas {
		palette = append(palette, averagePSDRect(source, area.Intersect(source.Rect)))
	}
	return palette
}

func averagePSDRect(source *image.NRGBA, bounds image.Rectangle) color.NRGBA {
	var red, green, blue, count int64
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := source.NRGBAAt(x, y)
			if pixel.A < 8 {
				continue
			}
			red += int64(pixel.R)
			green += int64(pixel.G)
			blue += int64(pixel.B)
			count++
		}
	}
	if count == 0 {
		return color.NRGBA{}
	}
	return color.NRGBA{R: psdColorByte(red / count), G: psdColorByte(green / count), B: psdColorByte(blue / count), A: 255}
}

func averagePSDColors(values []color.NRGBA) color.NRGBA {
	var red, green, blue, alpha int
	for _, value := range values {
		red += int(value.R)
		green += int(value.G)
		blue += int(value.B)
		alpha += int(value.A)
	}
	count := max(1, len(values))
	return color.NRGBA{
		R: psdColorByte(int64(red / count)), G: psdColorByte(int64(green / count)),
		B: psdColorByte(int64(blue / count)), A: psdColorByte(int64(alpha / count)),
	}
}

func psdColorDistance(left, right color.NRGBA) int {
	return absInt(int(left.R)-int(right.R)) + absInt(int(left.G)-int(right.G)) + absInt(int(left.B)-int(right.B))
}

func nearestPSDColorDistance(value color.NRGBA, palette []color.NRGBA) int {
	best := 3 * 255
	for _, candidate := range palette {
		best = min(best, psdColorDistance(value, candidate))
	}
	return best
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func psdCentralCandidateMask(width, height int) []bool {
	mask := make([]bool, width*height)
	left, right := width/6, width-width/6
	top, bottom := height/6, height-height/6
	for y := top; y < bottom; y++ {
		for x := left; x < right; x++ {
			mask[y*width+x] = true
		}
	}
	return mask
}

func splitPSDSubject(base *image.NRGBA, mask []bool, backgroundColor color.NRGBA, subjectName string) (psdRasterLayer, psdRasterLayer) {
	width, height := base.Rect.Dx(), base.Rect.Dy()
	background := cloneNRGBA(base)
	bounds := image.Rectangle{Min: image.Pt(width, height)}
	for index, selected := range mask {
		if !selected {
			continue
		}
		x, y := index%width, index/width
		bounds.Min.X = min(bounds.Min.X, x)
		bounds.Min.Y = min(bounds.Min.Y, y)
		bounds.Max.X = max(bounds.Max.X, x+1)
		bounds.Max.Y = max(bounds.Max.Y, y+1)
		original := background.NRGBAAt(x, y)
		fillAlpha := original.A
		if backgroundColor.A < 8 {
			fillAlpha = 0
		}
		background.SetNRGBA(x, y, color.NRGBA{R: backgroundColor.R, G: backgroundColor.G, B: backgroundColor.B, A: fillAlpha})
	}
	if bounds.Empty() {
		bounds = image.Rect(0, 0, 1, 1)
	}
	subjectPixels := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if mask[y*width+x] {
				subjectPixels.SetNRGBA(x-bounds.Min.X, y-bounds.Min.Y, base.NRGBAAt(x, y))
			}
		}
	}
	return psdRasterLayer{name: subjectName, bounds: bounds, pixels: subjectPixels},
		psdRasterLayer{name: "背景（自动补色）", bounds: base.Rect, pixels: background}
}

func encodeLayeredPSD(canvas *image.NRGBA, layers []psdRasterLayer) ([]byte, error) {
	if canvas == nil || len(layers) < 2 || len(layers) > 64 {
		return nil, fmt.Errorf("layered PSD requires between 2 and 64 layers")
	}
	canvasPixels := canvas.Rect.Dx() * canvas.Rect.Dy()
	estimated := 512 + canvasPixels*4
	for _, layer := range layers {
		if layer.pixels == nil || layer.bounds.Empty() || layer.pixels.Rect.Dx() != layer.bounds.Dx() || layer.pixels.Rect.Dy() != layer.bounds.Dy() {
			return nil, fmt.Errorf("invalid PSD layer %q", layer.name)
		}
		estimated += 512 + layer.bounds.Dx()*layer.bounds.Dy()*4
	}
	if estimated > maxLayeredPSDBytes {
		return nil, fmt.Errorf("generated layered PSD would exceed %d MiB", maxLayeredPSDBytes>>20)
	}
	out := bytes.NewBuffer(make([]byte, 0, estimated))
	writePSDString(out, "8BPS")
	writePSDUint16(out, 1)
	out.Write(make([]byte, 6))
	writePSDUint16(out, 4)
	writePSDUint32(out, checkedPSDUint32(canvas.Rect.Dy()))
	writePSDUint32(out, checkedPSDUint32(canvas.Rect.Dx()))
	writePSDUint16(out, 8)
	writePSDUint16(out, 3)
	writePSDUint32(out, 0)
	writePSDUint32(out, 0)

	layerMaskLengthOffset := reservePSDUint32(out)
	layerMaskStart := out.Len()
	layerInfoLengthOffset := reservePSDUint32(out)
	layerInfoStart := out.Len()
	writePSDInt16(out, checkedPSDInt16(-len(layers)))
	for _, layer := range layers {
		writePSDLayerRecordBounds(out, layer)
	}
	for _, layer := range layers {
		plane := make([]byte, layer.bounds.Dx()*layer.bounds.Dy())
		for channel := 0; channel < 4; channel++ {
			writePSDUint16(out, 0)
			fillPSDPlane(plane, layer.pixels, channel)
			out.Write(plane)
		}
	}
	if (out.Len()-layerInfoStart)%2 != 0 {
		out.WriteByte(0)
	}
	patchPSDUint32(out.Bytes(), layerInfoLengthOffset, out.Len()-layerInfoStart)
	writePSDUint32(out, 0)
	patchPSDUint32(out.Bytes(), layerMaskLengthOffset, out.Len()-layerMaskStart)

	writePSDUint16(out, 0)
	plane := make([]byte, canvasPixels)
	for channel := 0; channel < 4; channel++ {
		fillPSDPlane(plane, canvas, channel)
		out.Write(plane)
	}
	if out.Len() > maxLayeredPSDBytes {
		return nil, fmt.Errorf("generated layered PSD exceeds %d MiB", maxLayeredPSDBytes>>20)
	}
	return out.Bytes(), nil
}

func writePSDLayerRecordBounds(out *bytes.Buffer, layer psdRasterLayer) {
	writePSDInt32(out, checkedPSDInt32(layer.bounds.Min.Y))
	writePSDInt32(out, checkedPSDInt32(layer.bounds.Min.X))
	writePSDInt32(out, checkedPSDInt32(layer.bounds.Max.Y))
	writePSDInt32(out, checkedPSDInt32(layer.bounds.Max.X))
	writePSDUint16(out, 4)
	pixels := layer.bounds.Dx() * layer.bounds.Dy()
	for _, channelID := range []int16{0, 1, 2, -1} {
		writePSDInt16(out, channelID)
		writePSDUint32(out, checkedPSDUint32(2+pixels))
	}
	writePSDString(out, "8BIM")
	writePSDString(out, "norm")
	out.Write([]byte{255, 0, 0, 0})
	extraLengthOffset := reservePSDUint32(out)
	extraStart := out.Len()
	writePSDUint32(out, 0)
	writePSDUint32(out, 0)
	writePSDPascalName(out, safePSDLayerName(layer.name))
	writePSDUnicodeLayerName(out, safePSDLayerName(layer.name))
	patchPSDUint32(out.Bytes(), extraLengthOffset, out.Len()-extraStart)
}
