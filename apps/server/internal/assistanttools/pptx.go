package assistanttools

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode"
)

const (
	maxPPTXSlides          = 40
	maxPPTXBullets         = 8
	maxPPTXTitleRunes      = 54
	maxPPTXSubtitleRunes   = 72
	maxPPTXBulletRunes     = 160
	maxPPTXBodyLayoutUnits = 440
)

type pptxDeck struct {
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle,omitempty"`
	Slides   []pptxSlide `json:"slides"`
}

type pptxSlide struct {
	Title   string   `json:"title"`
	Bullets []string `json:"bullets"`
}

func buildPPTX(raw []byte) ([]byte, error) {
	var deck pptxDeck
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&deck); err != nil {
		return nil, fmt.Errorf("PPTX content must be valid structured JSON: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	deck.Title = cleanPPTXText(deck.Title, maxPPTXTitleRunes)
	deck.Subtitle = cleanPPTXText(deck.Subtitle, maxPPTXSubtitleRunes)
	if deck.Title == "" || len(deck.Slides) == 0 || len(deck.Slides) > maxPPTXSlides {
		return nil, fmt.Errorf("PPTX requires a title and between 1 and %d content slides", maxPPTXSlides)
	}
	for index := range deck.Slides {
		deck.Slides[index].Title = cleanPPTXText(deck.Slides[index].Title, maxPPTXTitleRunes)
		if deck.Slides[index].Title == "" || len(deck.Slides[index].Bullets) > maxPPTXBullets {
			return nil, fmt.Errorf("PPTX slide %d requires a title and at most %d bullets", index+1, maxPPTXBullets)
		}
		bullets := make([]string, 0, len(deck.Slides[index].Bullets))
		layoutUnits := 0
		for _, bullet := range deck.Slides[index].Bullets {
			if value := cleanPPTXText(bullet, maxPPTXBulletRunes); value != "" {
				// Each bullet consumes at least one visual line in addition to
				// its text. Bounding both keeps generated body copy on-slide.
				layoutUnits += 40 + len([]rune(value))
				if layoutUnits > maxPPTXBodyLayoutUnits {
					return nil, fmt.Errorf("PPTX slide %d contains too much text; shorten or split the slide", index+1)
				}
				bullets = append(bullets, value)
			}
		}
		deck.Slides[index].Bullets = bullets
	}

	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := pptxStaticEntries(len(deck.Slides) + 1)
	entries["ppt/slides/slide1.xml"] = pptxCoverSlide(deck.Title, deck.Subtitle)
	for index, slide := range deck.Slides {
		number := index + 2
		entries[fmt.Sprintf("ppt/slides/slide%d.xml", number)] = pptxContentSlide(slide, number, len(deck.Slides)+1)
	}
	for _, name := range pptxEntryOrder(entries) {
		entry, err := writer.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := io.WriteString(entry, entries[name]); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("PPTX content contains trailing JSON data")
	}
	return nil
}

func cleanPPTXText(value string, limit int) string {
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || !unicode.IsControl(r) {
			return r
		}
		return -1
	}, value))
	runes := []rune(value)
	if len(runes) > limit {
		value = string(runes[:limit])
	}
	return value
}

func pptxEntryOrder(entries map[string]string) []string {
	order := []string{
		"[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml",
		"ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "ppt/theme/theme1.xml",
		"ppt/slideMasters/slideMaster1.xml", "ppt/slideMasters/_rels/slideMaster1.xml.rels",
		"ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
		"ppt/presProps.xml", "ppt/viewProps.xml", "ppt/tableStyles.xml",
	}
	for number := 1; ; number++ {
		slide := fmt.Sprintf("ppt/slides/slide%d.xml", number)
		if _, ok := entries[slide]; !ok {
			break
		}
		order = append(order, slide, fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", number))
	}
	return order
}

func pptxStaticEntries(slideCount int) map[string]string {
	entries := map[string]string{
		"[Content_Types].xml":                          pptxContentTypes(slideCount),
		"_rels/.rels":                                  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
		"docProps/app.xml":                             fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>StarClouds AI</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>%d</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><Company>StarClouds AI</Company><AppVersion>1.0</AppVersion></Properties>`, slideCount),
		"docProps/core.xml":                            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>StarClouds AI</dc:creator><cp:lastModifiedBy>StarClouds AI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`,
		"ppt/presentation.xml":                         pptxPresentation(slideCount),
		"ppt/_rels/presentation.xml.rels":              pptxPresentationRels(slideCount),
		"ppt/theme/theme1.xml":                         pptxTheme,
		"ppt/slideMasters/slideMaster1.xml":            pptxSlideMaster,
		"ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
		"ppt/slideLayouts/slideLayout1.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
		"ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
		"ppt/presProps.xml":                            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
		"ppt/viewProps.xml":                            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr/><p:slideViewPr/><p:notesTextViewPr/><p:gridSpacing cx="78028800" cy="78028800"/></p:viewPr>`,
		"ppt/tableStyles.xml":                          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
	}
	for number := 1; number <= slideCount; number++ {
		entries[fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", number)] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
	}
	return entries
}

func pptxContentTypes(slideCount int) string {
	var slides strings.Builder
	for number := 1; number <= slideCount; number++ {
		fmt.Fprintf(&slides, `<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, number)
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` + slides.String() + `</Types>`
}

func pptxPresentation(slideCount int) string {
	var ids strings.Builder
	for number := 1; number <= slideCount; number++ {
		fmt.Fprintf(&ids, `<p:sldId id="%d" r:id="rId%d"/>`, 255+number, number+1)
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` + ids.String() + `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`
}

func pptxPresentationRels(slideCount int) string {
	var rels strings.Builder
	rels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`)
	for number := 1; number <= slideCount; number++ {
		fmt.Fprintf(&rels, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, number+1, number)
	}
	rels.WriteString(`</Relationships>`)
	return rels.String()
}

func pptxCoverSlide(title, subtitle string) string {
	return pptxSlideXML(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`+pptxShapeProperties(1050000, 1800000, 10092000, 1400000, "FFFFFF")+pptxTextBody(title, 5000, true, "FFFFFF", "ctr", false)+`</p:sp>`+
		`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`+pptxShapeProperties(1650000, 3550000, 8892000, 900000, "FFFFFF")+pptxTextBody(subtitle, 2400, false, "DDEBFF", "ctr", false)+`</p:sp>`, "12355B", true)
}

func pptxContentSlide(slide pptxSlide, number, total int) string {
	var body strings.Builder
	body.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`)
	body.WriteString(pptxShapeProperties(800000, 560000, 10500000, 900000, "FFFFFF"))
	body.WriteString(pptxTextBody(slide.Title, 3600, true, "12355B", "l", false))
	body.WriteString(`</p:sp>`)
	body.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`)
	body.WriteString(pptxShapeProperties(1100000, 1750000, 9950000, 3900000, "F4F8FC"))
	body.WriteString(`<p:txBody><a:bodyPr wrap="square" lIns="360000" rIns="300000" tIns="260000" bIns="180000"/><a:lstStyle/>`)
	for _, bullet := range slide.Bullets {
		body.WriteString(`<a:p><a:pPr marL="420000" indent="-240000"><a:buChar char="•"/></a:pPr>` + pptxRun(bullet, 2000, false, "243447") + `<a:endParaRPr lang="zh-CN" sz="2000"/></a:p>`)
	}
	if len(slide.Bullets) == 0 {
		body.WriteString(`<a:p>` + pptxRun(" ", 2000, false, "243447") + `<a:endParaRPr lang="zh-CN" sz="2000"/></a:p>`)
	}
	body.WriteString(`</p:txBody></p:sp>`)
	body.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="4" name="Page"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` + pptxShapeProperties(10400000, 6200000, 1000000, 300000, "FFFFFF") + pptxTextBody(fmt.Sprintf("%d / %d", number, total), 900, false, "60758A", "r", false) + `</p:sp>`)
	return pptxSlideXML(body.String(), "FFFFFF", false)
}

func pptxSlideXML(shapes, background string, cover bool) string {
	accent := `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` + pptxShapeProperties(0, 0, map[bool]int{true: 12192000, false: 180000}[cover], 6858000, "19B8A5") + `</p:sp>`
	if cover {
		accent = `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` + pptxShapeProperties(900000, 1250000, 1800000, 100000, "FFD166") + `</p:sp>`
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="` + background + `"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` + accent + shapes + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

func pptxShapeProperties(x, y, width, height int, fill string) string {
	return fmt.Sprintf(`<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="%s"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>`, x, y, width, height, fill)
}

func pptxTextBody(text string, size int, bold bool, color, align string, bullet bool) string {
	pPr := `<a:pPr algn="` + align + `"/>`
	if bullet {
		pPr = `<a:pPr algn="` + align + `"><a:buChar char="•"/></a:pPr>`
	}
	return `<p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p>` + pPr + pptxRun(text, size, bold, color) + `<a:endParaRPr lang="zh-CN" sz="` + fmt.Sprint(size) + `"/></a:p></p:txBody>`
}

func pptxRun(text string, size int, bold bool, color string) string {
	weight := "0"
	if bold {
		weight = "1"
	}
	return `<a:r><a:rPr lang="zh-CN" sz="` + fmt.Sprint(size) + `" b="` + weight + `"><a:solidFill><a:srgbClr val="` + color + `"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>` + escapePPTXXML(text) + `</a:t></a:r>`
}

func escapePPTXXML(value string) string {
	var out bytes.Buffer
	_ = xml.EscapeText(&out, []byte(value))
	return out.String()
}

const pptxSlideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`

const pptxTheme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="StarClouds"><a:themeElements><a:clrScheme name="StarClouds"><a:dk1><a:srgbClr val="172033"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="12355B"/></a:dk2><a:lt2><a:srgbClr val="F4F8FC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="19B8A5"/></a:accent2><a:accent3><a:srgbClr val="FFD166"/></a:accent3><a:accent4><a:srgbClr val="E05D5D"/></a:accent4><a:accent5><a:srgbClr val="60758A"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="8B5CF6"/></a:folHlink></a:clrScheme><a:fontScheme name="Aptos"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="StarClouds"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:solidFill><a:schemeClr val="lt2"/></a:solidFill><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
