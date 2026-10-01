package assistantfiles

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
	"github.com/xuri/excelize/v2"
)

const (
	ParserVersion       = "assistant-files-v4"
	MaxExtractedRunes   = 2_000_000
	MaxArchiveBytes     = 64 << 20
	MaxArchiveFiles     = 5_000
	MaxSegments         = 4_000
	segmentTargetRunes  = 1_400
	segmentOverlapRunes = 120
)

var (
	ErrUnsupported = errors.New("unsupported assistant file format")
	ErrUnsafe      = errors.New("unsafe or oversized assistant file")
	ErrNoText      = errors.New("assistant file contains no extractable text")
)

type Format struct {
	Extension   string
	ContentType string
}

type Segment struct {
	Locator map[string]any
	Content string
}

type Document struct {
	Segments  []Segment
	PageCount int
	CharCount int
	Truncated bool
}

func Detect(name string, data []byte) (Format, error) {
	if len(data) == 0 {
		return Format{}, ErrUnsupported
	}
	if bytes.HasPrefix(data, []byte("8BPS")) {
		if _, err := parsePSDHeader(data); err != nil {
			return Format{}, err
		}
		return Format{Extension: "psd", ContentType: "image/vnd.adobe.photoshop"}, nil
	}
	if bytes.HasPrefix(data, []byte("%PDF-")) {
		return Format{Extension: "pdf", ContentType: "application/pdf"}, nil
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{'P', 'K', 3, 4}) {
		kind, err := detectOfficeArchive(data)
		if err != nil {
			return Format{}, err
		}
		switch kind {
		case "docx":
			return Format{Extension: "docx", ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}, nil
		case "xlsx":
			return Format{Extension: "xlsx", ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, nil
		case "pptx":
			return Format{Extension: "pptx", ContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"}, nil
		}
		return Format{}, ErrUnsupported
	}
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(name)))
	contentType := map[string]string{
		".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
		".csv": "text/csv", ".json": "application/json",
	}[ext]
	if contentType == "" || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return Format{}, ErrUnsupported
	}
	return Format{Extension: strings.TrimPrefix(ext, "."), ContentType: contentType}, nil
}

func detectOfficeArchive(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("%w: invalid zip container", ErrUnsafe)
	}
	total := uint64(0)
	hasWord := false
	hasExcel := false
	hasPowerPoint := false
	if len(reader.File) > MaxArchiveFiles {
		return "", fmt.Errorf("%w: too many archive entries", ErrUnsafe)
	}
	for _, file := range reader.File {
		name := strings.ToLower(strings.ReplaceAll(file.Name, "\\", "/"))
		if strings.Contains(name, "../") || strings.HasPrefix(name, "/") {
			return "", fmt.Errorf("%w: invalid archive path", ErrUnsafe)
		}
		if strings.HasSuffix(name, "vbaproject.bin") {
			return "", fmt.Errorf("%w: macro-enabled documents are not accepted", ErrUnsafe)
		}
		if strings.Contains(name, "/embeddings/") || strings.Contains(name, "/activex/") {
			return "", fmt.Errorf("%w: embedded or active content is not accepted", ErrUnsafe)
		}
		total += file.UncompressedSize64
		if total > MaxArchiveBytes || (len(data) > 0 && total > uint64(len(data))*100) {
			return "", fmt.Errorf("%w: archive expansion limit exceeded", ErrUnsafe)
		}
		hasWord = hasWord || name == "word/document.xml"
		hasExcel = hasExcel || name == "xl/workbook.xml"
		hasPowerPoint = hasPowerPoint || name == "ppt/presentation.xml"
	}
	kindCount := 0
	for _, present := range []bool{hasWord, hasExcel, hasPowerPoint} {
		if present {
			kindCount++
		}
	}
	if kindCount != 1 {
		return "", ErrUnsupported
	}
	if hasWord {
		return "docx", nil
	}
	if hasExcel {
		return "xlsx", nil
	}
	return "pptx", nil
}

func Parse(format Format, data []byte) (Document, error) {
	var document Document
	var err error
	switch format.Extension {
	case "pdf":
		document, err = parsePDF(data)
	case "docx":
		document, err = parseDOCX(data)
	case "xlsx":
		document, err = parseXLSX(data)
	case "pptx":
		document, err = parsePPTX(data)
	case "psd":
		document, err = parsePSD(data)
	case "txt", "md", "markdown", "csv", "json":
		document, err = parseText(format.Extension, data)
	default:
		err = ErrUnsupported
	}
	if err != nil {
		return Document{}, err
	}
	if len(document.Segments) == 0 || document.CharCount == 0 {
		return document, ErrNoText
	}
	return document, nil
}

func parseText(extension string, data []byte) (Document, error) {
	value := strings.TrimPrefix(string(data), "\ufeff")
	if extension == "json" {
		var decoded any
		if json.Unmarshal(data, &decoded) == nil {
			if formatted, err := json.MarshalIndent(decoded, "", "  "); err == nil {
				value = string(formatted)
			}
		}
	}
	document := Document{}
	appendText(&document, cleanText(value), map[string]any{"kind": extension})
	return document, nil
}

func parsePDF(data []byte) (Document, error) {
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Document{}, err
	}
	document := Document{PageCount: reader.NumPage()}
	for pageNumber := 1; pageNumber <= reader.NumPage() && !document.Truncated; pageNumber++ {
		rows, err := reader.Page(pageNumber).GetTextByRow()
		if err != nil {
			continue
		}
		lines := make([]string, 0, len(rows))
		for _, row := range rows {
			words := make([]string, 0, len(row.Content))
			for _, word := range row.Content {
				if value := strings.TrimSpace(word.S); value != "" {
					words = append(words, value)
				}
			}
			if len(words) > 0 {
				lines = append(lines, strings.Join(words, " "))
			}
		}
		appendText(&document, cleanText(strings.Join(lines, "\n")), map[string]any{"page": pageNumber})
	}
	return document, nil
}

func parseDOCX(data []byte) (Document, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Document{}, err
	}
	var documentXML *zip.File
	for _, file := range reader.File {
		if strings.EqualFold(file.Name, "word/document.xml") {
			documentXML = file
			break
		}
	}
	if documentXML == nil {
		return Document{}, ErrUnsupported
	}
	stream, err := documentXML.Open()
	if err != nil {
		return Document{}, err
	}
	defer stream.Close()
	decoder := xml.NewDecoder(io.LimitReader(stream, MaxArchiveBytes+1))
	document := Document{}
	paragraph := strings.Builder{}
	paragraphNumber := 0
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Document{}, err
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "t":
				var text string
				if err := decoder.DecodeElement(&text, &value); err != nil {
					return Document{}, err
				}
				paragraph.WriteString(text)
			case "tab":
				paragraph.WriteByte('\t')
			case "br":
				paragraph.WriteByte('\n')
			}
		case xml.EndElement:
			if value.Name.Local == "p" {
				paragraphNumber++
				appendText(&document, cleanText(paragraph.String()), map[string]any{"paragraph": paragraphNumber})
				paragraph.Reset()
				if document.Truncated {
					return document, nil
				}
			}
		}
	}
	return document, nil
}

func parseXLSX(data []byte) (Document, error) {
	book, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{
		RawCellValue: true, UnzipSizeLimit: MaxArchiveBytes, UnzipXMLSizeLimit: 16 << 20,
	})
	if err != nil {
		return Document{}, err
	}
	defer book.Close()
	document := Document{}
	for _, sheet := range book.GetSheetList() {
		rows, err := book.Rows(sheet)
		if err != nil {
			return Document{}, err
		}
		rowNumber := 0
		for rows.Next() {
			rowNumber++
			columns, err := rows.Columns()
			if err != nil {
				_ = rows.Close()
				return Document{}, err
			}
			for index := range columns {
				columns[index] = strings.TrimSpace(columns[index])
			}
			appendText(&document, cleanText(strings.Join(columns, "\t")), map[string]any{
				"sheet": sheet, "rowStart": rowNumber, "rowEnd": rowNumber,
			})
			if document.Truncated {
				break
			}
		}
		if err := rows.Close(); err != nil {
			return Document{}, err
		}
		if document.Truncated {
			break
		}
	}
	return document, nil
}

func parsePPTX(data []byte) (Document, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Document{}, err
	}
	type slideFile struct {
		number int
		file   *zip.File
	}
	slides := make([]slideFile, 0)
	for _, file := range reader.File {
		if number, ok := pptxSlideNumber(file.Name); ok {
			slides = append(slides, slideFile{number: number, file: file})
		}
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].number < slides[j].number })
	if len(slides) == 0 {
		return Document{}, ErrUnsupported
	}
	document := Document{PageCount: len(slides)}
	for _, slide := range slides {
		text, err := readPPTXSlide(slide.file)
		if err != nil {
			return Document{}, err
		}
		appendText(&document, text, map[string]any{"slide": slide.number})
		if document.Truncated {
			break
		}
	}
	return document, nil
}

func pptxSlideNumber(name string) (int, bool) {
	name = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	const prefix = "ppt/slides/slide"
	const suffix = ".xml"
	if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
		return 0, false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(name, prefix), suffix)
	if value == "" || strings.Contains(value, "/") {
		return 0, false
	}
	number, err := strconv.Atoi(value)
	return number, err == nil && number > 0
}

func readPPTXSlide(file *zip.File) (string, error) {
	stream, err := file.Open()
	if err != nil {
		return "", err
	}
	defer stream.Close()
	decoder := xml.NewDecoder(io.LimitReader(stream, MaxArchiveBytes+1))
	paragraph := strings.Builder{}
	lines := make([]string, 0)
	flush := func() {
		if text := cleanText(paragraph.String()); text != "" {
			lines = append(lines, text)
		}
		paragraph.Reset()
	}
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "t":
				var text string
				if err := decoder.DecodeElement(&text, &value); err != nil {
					return "", err
				}
				paragraph.WriteString(text)
			case "tab":
				paragraph.WriteByte('\t')
			case "br":
				paragraph.WriteByte('\n')
			}
		case xml.EndElement:
			if value.Name.Local == "p" {
				flush()
			}
		}
	}
	flush()
	return cleanText(strings.Join(lines, "\n")), nil
}

func cleanText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || !unicode.IsControl(r) {
			return r
		}
		return -1
	}, value)
	lines := strings.Split(value, "\n")
	out := lines[:0]
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func appendText(document *Document, value string, locator map[string]any) {
	if document == nil || value == "" || document.Truncated || len(document.Segments) >= MaxSegments {
		if document != nil && len(document.Segments) >= MaxSegments {
			document.Truncated = true
		}
		return
	}
	remaining := MaxExtractedRunes - document.CharCount
	if remaining <= 0 {
		document.Truncated = true
		return
	}
	runes := []rune(value)
	if len(runes) > remaining {
		runes = runes[:remaining]
		document.Truncated = true
	}
	for start := 0; start < len(runes) && len(document.Segments) < MaxSegments; {
		end := min(start+segmentTargetRunes, len(runes))
		if end < len(runes) {
			for candidate := end; candidate > start+segmentTargetRunes/2; candidate-- {
				if runes[candidate-1] == '\n' {
					end = candidate
					break
				}
			}
		}
		chunk := strings.TrimSpace(string(runes[start:end]))
		if chunk != "" {
			cloned := make(map[string]any, len(locator)+1)
			for key, item := range locator {
				cloned[key] = item
			}
			cloned["part"] = len(document.Segments) + 1
			document.Segments = append(document.Segments, Segment{Locator: cloned, Content: chunk})
		}
		if end >= len(runes) {
			break
		}
		start = max(end-segmentOverlapRunes, start+1)
	}
	document.CharCount += len(runes)
	if len(document.Segments) >= MaxSegments {
		document.Truncated = true
	}
}
