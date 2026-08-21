package assistantfiles

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeOCRRunner struct {
	calls []fakeOCRCall
}

type fakeOCRCall struct {
	name string
	args []string
}

func (runner *fakeOCRRunner) Run(_ context.Context, name string, args []string, _ int64) ([]byte, error) {
	runner.calls = append(runner.calls, fakeOCRCall{name: name, args: append([]string(nil), args...)})
	if strings.Contains(name, "pdftoppm") {
		return nil, os.WriteFile(args[len(args)-1]+".png", []byte("png"), 0o600)
	}
	page := (len(runner.calls) + 1) / 2
	return []byte("recognized page " + string(rune('0'+page))), nil
}

func TestOCRPDFUsesBoundedFixedCommands(t *testing.T) {
	runner := &fakeOCRRunner{}
	document, err := ocrPDFWithRunner(context.Background(), []byte("%PDF-test"), 3, OCRConfig{
		PDFToPPMPath: "/usr/bin/pdftoppm", TesseractPath: "/usr/bin/tesseract",
		Languages: "chi_sim+eng", MaxPages: 2, Timeout: time.Second,
	}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Segments) != 2 || !document.Truncated || document.PageCount != 3 {
		t.Fatalf("document = %#v", document)
	}
	if len(runner.calls) != 4 {
		t.Fatalf("calls = %#v", runner.calls)
	}
	for index, call := range runner.calls {
		if !filepath.IsAbs(call.name) {
			t.Fatalf("call %d used non-absolute executable: %#v", index, call)
		}
		for _, arg := range call.args {
			if strings.ContainsAny(arg, ";\n") {
				t.Fatalf("call %d contains unsafe argument: %#v", index, call)
			}
		}
	}
	if got := runner.calls[0].args; got[0] != "-f" || got[1] != "1" || got[4] != "-singlefile" {
		t.Fatalf("render args = %#v", got)
	}
	if got := runner.calls[1].args; got[1] != "stdout" || got[2] != "-l" || got[3] != "chi_sim+eng" {
		t.Fatalf("tesseract args = %#v", got)
	}
}

func TestOCRPDFRejectsUnsafeConfiguration(t *testing.T) {
	tests := []OCRConfig{
		{PDFToPPMPath: "pdftoppm", TesseractPath: "/usr/bin/tesseract", Languages: "eng"},
		{PDFToPPMPath: "/usr/bin/pdftoppm", TesseractPath: "/usr/bin/tesseract", Languages: "eng;touch /tmp/x"},
		{PDFToPPMPath: "/usr/bin/pdftoppm", TesseractPath: "/usr/bin/tesseract", Languages: "eng", MaxPages: 21},
	}
	for _, cfg := range tests {
		if _, err := ocrPDFWithRunner(context.Background(), []byte("%PDF-test"), 1, cfg, &fakeOCRRunner{}); err == nil {
			t.Fatalf("configuration should fail: %#v", cfg)
		}
	}
}
