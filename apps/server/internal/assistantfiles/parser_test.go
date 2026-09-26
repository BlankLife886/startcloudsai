package assistantfiles

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/xuri/excelize/v2"
)

func zipFixture(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func psdFixture(t *testing.T, layerName string) []byte {
	t.Helper()
	write := func(buffer *bytes.Buffer, value any) {
		if err := binary.Write(buffer, binary.BigEndian, value); err != nil {
			t.Fatal(err)
		}
	}
	var extra bytes.Buffer
	write(&extra, uint32(0))
	write(&extra, uint32(0))
	legacy := []byte("Layer")
	extra.WriteByte(byte(len(legacy)))
	extra.Write(legacy)
	for extra.Len()%4 != 0 {
		extra.WriteByte(0)
	}
	var unicodeName bytes.Buffer
	units := utf16.Encode([]rune(layerName))
	write(&unicodeName, uint32(len(units)))
	for _, unit := range units {
		write(&unicodeName, unit)
	}
	extra.WriteString("8BIMluni")
	write(&extra, uint32(unicodeName.Len()))
	extra.Write(unicodeName.Bytes())
	if unicodeName.Len()%2 != 0 {
		extra.WriteByte(0)
	}

	var record bytes.Buffer
	for range 4 {
		write(&record, int32(0))
	}
	write(&record, uint16(0))
	record.WriteString("8BIMnorm")
	record.Write([]byte{255, 0, 0, 0})
	write(&record, uint32(extra.Len()))
	record.Write(extra.Bytes())

	var layerInfo bytes.Buffer
	write(&layerInfo, int16(1))
	layerInfo.Write(record.Bytes())
	var layerMask bytes.Buffer
	write(&layerMask, uint32(layerInfo.Len()))
	layerMask.Write(layerInfo.Bytes())

	var out bytes.Buffer
	out.WriteString("8BPS")
	write(&out, uint16(1))
	out.Write(make([]byte, 6))
	write(&out, uint16(4))
	write(&out, uint32(1080))
	write(&out, uint32(1920))
	write(&out, uint16(8))
	write(&out, uint16(3))
	write(&out, uint32(0))
	write(&out, uint32(0))
	write(&out, uint32(layerMask.Len()))
	out.Write(layerMask.Bytes())
	write(&out, uint16(1))
	return out.Bytes()
}

func TestDetectAndParseText(t *testing.T) {
	format, err := Detect("notes.md", []byte("# 标题\n\n重要内容"))
	if err != nil || format.Extension != "md" {
		t.Fatalf("format=%#v err=%v", format, err)
	}
	document, err := Parse(format, []byte("# 标题\n\n重要内容"))
	if err != nil || len(document.Segments) != 1 || !strings.Contains(document.Segments[0].Content, "重要内容") {
		t.Fatalf("document=%#v err=%v", document, err)
	}
}

func TestDetectAndParseDOCX(t *testing.T) {
	data := zipFixture(t, map[string]string{
		"[Content_Types].xml": "<Types/>",
		"word/document.xml":   `<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>`,
	})
	format, err := Detect("document.bin", data)
	if err != nil || format.Extension != "docx" {
		t.Fatalf("format=%#v err=%v", format, err)
	}
	document, err := Parse(format, data)
	if err != nil || len(document.Segments) != 2 || document.CharCount == 0 {
		t.Fatalf("document=%#v err=%v", document, err)
	}
}

func TestRejectsMacroEnabledOfficeArchive(t *testing.T) {
	data := zipFixture(t, map[string]string{
		"word/document.xml": "<document/>", "word/vbaProject.bin": "macro",
	})
	if _, err := Detect("document.docm", data); err == nil || !strings.Contains(err.Error(), "macro") {
		t.Fatalf("error = %v", err)
	}
}

func TestRejectsEmbeddedOfficeObjects(t *testing.T) {
	data := zipFixture(t, map[string]string{
		"ppt/presentation.xml":          "<presentation/>",
		"ppt/slides/slide1.xml":         "<slide/>",
		"ppt/embeddings/oleObject1.bin": "embedded",
	})
	if _, err := Detect("slides.pptx", data); err == nil || !strings.Contains(err.Error(), "embedded") {
		t.Fatalf("error = %v", err)
	}
}

func TestDetectAndParseXLSX(t *testing.T) {
	book := excelize.NewFile()
	t.Cleanup(func() { _ = book.Close() })
	if err := book.SetCellValue("Sheet1", "A1", "项目预算"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("Sheet1", "B1", 120); err != nil {
		t.Fatal(err)
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	format, err := Detect("budget.xlsx", buffer.Bytes())
	if err != nil || format.Extension != "xlsx" {
		t.Fatalf("format=%#v err=%v", format, err)
	}
	document, err := Parse(format, buffer.Bytes())
	if err != nil || len(document.Segments) == 0 || !strings.Contains(document.Segments[0].Content, "项目预算") {
		t.Fatalf("document=%#v err=%v", document, err)
	}
	if document.Segments[0].Locator["sheet"] != "Sheet1" {
		t.Fatalf("locator=%#v", document.Segments[0].Locator)
	}
}

func TestDetectAndParsePPTX(t *testing.T) {
	data := zipFixture(t, map[string]string{
		"[Content_Types].xml":          "<Types/>",
		"ppt/presentation.xml":         "<p:presentation xmlns:p=\"urn:p\"/>",
		"ppt/slides/slide2.xml":        `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>第二页结论</a:t></a:r></a:p></p:cSld></p:sld>`,
		"ppt/slides/slide1.xml":        `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>项目计划</a:t></a:r><a:br/><a:r><a:t>第一阶段</a:t></a:r></a:p></p:cSld></p:sld>`,
		"ppt/slideLayouts/layout1.xml": `<p:sldLayout xmlns:p="urn:p"/>`,
	})
	format, err := Detect("slides.bin", data)
	if err != nil || format.Extension != "pptx" {
		t.Fatalf("format=%#v err=%v", format, err)
	}
	document, err := Parse(format, data)
	if err != nil || document.PageCount != 2 || len(document.Segments) != 2 {
		t.Fatalf("document=%#v err=%v", document, err)
	}
	if document.Segments[0].Locator["slide"] != 1 || !strings.Contains(document.Segments[0].Content, "第一阶段") ||
		document.Segments[1].Locator["slide"] != 2 || !strings.Contains(document.Segments[1].Content, "第二页结论") {
		t.Fatalf("segments=%#v", document.Segments)
	}
}

func TestDetectAndParsePSDMetadataAndLayerNames(t *testing.T) {
	data := psdFixture(t, "主视觉 / 标题")
	format, err := Detect("design.bin", data)
	if err != nil || format.Extension != "psd" || format.ContentType != "image/vnd.adobe.photoshop" {
		t.Fatalf("format=%#v err=%v", format, err)
	}
	document, err := Parse(format, data)
	if err != nil || document.PageCount != 1 || len(document.Segments) != 1 {
		t.Fatalf("document=%#v err=%v", document, err)
	}
	content := document.Segments[0].Content
	for _, expected := range []string{"1920 x 1080", "Color mode: RGB", "Layers: 1", "主视觉 / 标题"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("PSD content %q does not contain %q", content, expected)
		}
	}
}

func TestRejectsTruncatedOrPSBData(t *testing.T) {
	truncated := append([]byte("8BPS\x00\x01"), make([]byte, 20)...)
	if _, err := Detect("broken.psd", truncated); err == nil || !errors.Is(err, ErrUnsafe) {
		t.Fatalf("truncated PSD error = %v", err)
	}
	psb := psdFixture(t, "Layer")
	binary.BigEndian.PutUint16(psb[4:6], 2)
	if _, err := Detect("large.psb", psb); err == nil || !errors.Is(err, ErrUnsupported) {
		t.Fatalf("PSB error = %v", err)
	}
}
