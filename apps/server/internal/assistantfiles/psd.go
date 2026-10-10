package assistantfiles

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const maxPSDLayerCount = 2_000

type psdHeader struct {
	Channels  int
	Width     int
	Height    int
	Depth     int
	ColorMode int
}

func parsePSDHeader(data []byte) (psdHeader, error) {
	if len(data) < 26 || !bytes.Equal(data[:4], []byte("8BPS")) {
		return psdHeader{}, ErrUnsupported
	}
	if binary.BigEndian.Uint16(data[4:6]) != 1 {
		return psdHeader{}, fmt.Errorf("%w: only standard PSD files are supported", ErrUnsupported)
	}
	if !bytes.Equal(data[6:12], make([]byte, 6)) {
		return psdHeader{}, fmt.Errorf("%w: invalid PSD reserved header", ErrUnsafe)
	}
	header := psdHeader{
		Channels:  int(binary.BigEndian.Uint16(data[12:14])),
		Height:    int(binary.BigEndian.Uint32(data[14:18])),
		Width:     int(binary.BigEndian.Uint32(data[18:22])),
		Depth:     int(binary.BigEndian.Uint16(data[22:24])),
		ColorMode: int(binary.BigEndian.Uint16(data[24:26])),
	}
	if header.Channels < 1 || header.Channels > 56 || header.Width < 1 || header.Width > 30_000 ||
		header.Height < 1 || header.Height > 30_000 {
		return psdHeader{}, fmt.Errorf("%w: invalid PSD dimensions or channels", ErrUnsafe)
	}
	if header.Depth != 1 && header.Depth != 8 && header.Depth != 16 && header.Depth != 32 {
		return psdHeader{}, fmt.Errorf("%w: invalid PSD bit depth", ErrUnsafe)
	}
	if _, ok := psdColorModeName(header.ColorMode); !ok {
		return psdHeader{}, fmt.Errorf("%w: invalid PSD color mode", ErrUnsafe)
	}
	return header, nil
}

func parsePSD(data []byte) (Document, error) {
	header, err := parsePSDHeader(data)
	if err != nil {
		return Document{}, err
	}
	offset := 26
	sections := make([][]byte, 3)
	for index := range sections {
		section, next, err := psdLengthSection(data, offset)
		if err != nil {
			return Document{}, err
		}
		sections[index] = section
		offset = next
	}
	if offset+2 > len(data) {
		return Document{}, fmt.Errorf("%w: missing PSD image data", ErrUnsafe)
	}
	compression := int(binary.BigEndian.Uint16(data[offset : offset+2]))
	compressionName, ok := map[int]string{0: "Raw", 1: "RLE", 2: "ZIP", 3: "ZIP with prediction"}[compression]
	if !ok {
		return Document{}, fmt.Errorf("%w: invalid PSD compression", ErrUnsafe)
	}
	colorMode, _ := psdColorModeName(header.ColorMode)
	layerNames, layerCount, err := psdLayerNames(sections[2])
	if err != nil {
		return Document{}, err
	}
	lines := []string{
		"Adobe Photoshop document",
		fmt.Sprintf("Canvas: %d x %d px", header.Width, header.Height),
		fmt.Sprintf("Color mode: %s", colorMode),
		fmt.Sprintf("Bit depth: %d bits per channel", header.Depth),
		fmt.Sprintf("Channels: %d", header.Channels),
		fmt.Sprintf("Compression: %s", compressionName),
		fmt.Sprintf("Layers: %d", layerCount),
	}
	if len(layerNames) > 0 {
		lines = append(lines, "Layer names:")
		for _, name := range layerNames {
			lines = append(lines, "- "+name)
		}
	}
	document := Document{PageCount: 1}
	appendText(&document, strings.Join(lines, "\n"), map[string]any{"kind": "psd", "width": header.Width, "height": header.Height})
	return document, nil
}

func psdLengthSection(data []byte, offset int) ([]byte, int, error) {
	if offset < 0 || offset+4 > len(data) {
		return nil, 0, fmt.Errorf("%w: truncated PSD section", ErrUnsafe)
	}
	length := binary.BigEndian.Uint32(data[offset : offset+4])
	start := offset + 4
	// #nosec G115 -- start was checked against len(data), so the remaining length is non-negative.
	if uint64(length) > uint64(len(data)-start) {
		return nil, 0, fmt.Errorf("%w: PSD section exceeds file bounds", ErrUnsafe)
	}
	// #nosec G115 -- length is bounded by the remaining in-memory byte slice above.
	end := start + int(length)
	return data[start:end], end, nil
}

func psdLayerNames(section []byte) ([]string, int, error) {
	if len(section) == 0 {
		return []string{}, 0, nil
	}
	if len(section) < 4 {
		return nil, 0, fmt.Errorf("%w: truncated PSD layer section", ErrUnsafe)
	}
	length := int(binary.BigEndian.Uint32(section[:4]))
	if length == 0 {
		return []string{}, 0, nil
	}
	if length < 2 || length > len(section)-4 {
		return nil, 0, fmt.Errorf("%w: PSD layer records exceed section bounds", ErrUnsafe)
	}
	data := section[4 : 4+length]
	rawCount := binary.BigEndian.Uint16(data[:2])
	count := int(rawCount)
	if rawCount&0x8000 != 0 {
		count = 1<<16 - count
	}
	if count > maxPSDLayerCount {
		return nil, 0, fmt.Errorf("%w: too many PSD layers", ErrUnsafe)
	}
	offset := 2
	names := make([]string, 0, min(count, 200))
	seen := make(map[string]bool)
	for index := 0; index < count; index++ {
		if offset+18 > len(data) {
			return nil, 0, fmt.Errorf("%w: truncated PSD layer record", ErrUnsafe)
		}
		offset += 16
		channels := int(binary.BigEndian.Uint16(data[offset : offset+2]))
		offset += 2
		if channels > 56 || offset+channels*6+16 > len(data) {
			return nil, 0, fmt.Errorf("%w: invalid PSD layer channels", ErrUnsafe)
		}
		offset += channels * 6
		if !bytes.Equal(data[offset:offset+4], []byte("8BIM")) {
			return nil, 0, fmt.Errorf("%w: invalid PSD layer signature", ErrUnsafe)
		}
		offset += 12
		extraLength := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		offset += 4
		if extraLength > len(data)-offset {
			return nil, 0, fmt.Errorf("%w: PSD layer extra data exceeds bounds", ErrUnsafe)
		}
		extra := data[offset : offset+extraLength]
		offset += extraLength
		legacy, unicodeName, err := psdLayerExtraNames(extra)
		if err != nil {
			return nil, 0, err
		}
		name := strings.TrimSpace(unicodeName)
		if name == "" {
			name = strings.TrimSpace(legacy)
		}
		if name != "" && !seen[name] && len(names) < 200 {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names, count, nil
}

func psdLayerExtraNames(extra []byte) (string, string, error) {
	offset := 0
	for range 2 {
		if offset+4 > len(extra) {
			return "", "", fmt.Errorf("%w: truncated PSD layer extra data", ErrUnsafe)
		}
		length := int(binary.BigEndian.Uint32(extra[offset : offset+4]))
		offset += 4
		if length > len(extra)-offset {
			return "", "", fmt.Errorf("%w: invalid PSD layer extra length", ErrUnsafe)
		}
		offset += length
	}
	if offset >= len(extra) {
		return "", "", nil
	}
	nameLength := int(extra[offset])
	if nameLength > len(extra)-offset-1 {
		return "", "", fmt.Errorf("%w: invalid PSD layer name", ErrUnsafe)
	}
	legacyBytes := extra[offset+1 : offset+1+nameLength]
	legacy := psdLegacyName(legacyBytes)
	offset += (1 + nameLength + 3) &^ 3
	unicodeName := ""
	for offset+12 <= len(extra) {
		signature := string(extra[offset : offset+4])
		key := string(extra[offset+4 : offset+8])
		length := int(binary.BigEndian.Uint32(extra[offset+8 : offset+12]))
		offset += 12
		if (signature != "8BIM" && signature != "8B64") || length > len(extra)-offset {
			return "", "", fmt.Errorf("%w: invalid PSD additional layer data", ErrUnsafe)
		}
		payload := extra[offset : offset+length]
		if key == "luni" {
			value, err := psdUnicodeName(payload)
			if err != nil {
				return "", "", err
			}
			unicodeName = value
		}
		offset += length
		if length%2 != 0 {
			offset++
		}
	}
	return legacy, unicodeName, nil
}

func psdUnicodeName(data []byte) (string, error) {
	if len(data) < 4 {
		return "", fmt.Errorf("%w: truncated PSD Unicode layer name", ErrUnsafe)
	}
	count := int(binary.BigEndian.Uint32(data[:4]))
	if count > (len(data)-4)/2 {
		return "", fmt.Errorf("%w: invalid PSD Unicode layer name", ErrUnsafe)
	}
	units := make([]uint16, count)
	for index := range units {
		units[index] = binary.BigEndian.Uint16(data[4+index*2 : 6+index*2])
	}
	return string(utf16.Decode(units)), nil
}

func psdLegacyName(data []byte) string {
	if utf8.Valid(data) {
		return string(data)
	}
	runes := make([]rune, 0, len(data))
	for _, value := range data {
		if value >= 32 && value != 127 {
			runes = append(runes, rune(value))
		}
	}
	return string(runes)
}

func psdColorModeName(value int) (string, bool) {
	name, ok := map[int]string{
		0: "Bitmap", 1: "Grayscale", 2: "Indexed", 3: "RGB", 4: "CMYK",
		7: "Multichannel", 8: "Duotone", 9: "Lab",
	}[value]
	return name, ok
}
