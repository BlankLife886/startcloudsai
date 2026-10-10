package assistantfiles

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultOCRMaxPages    = 20
	defaultOCRTimeout     = 90 * time.Second
	maxOCRInputBytes      = 16 << 20
	maxOCRPageImageBytes  = 16 << 20
	maxOCRCommandLogBytes = 32 << 10
	maxOCRPageTextBytes   = 2 << 20
)

var (
	ErrOCRFailed  = errors.New("assistant PDF OCR failed")
	ocrLanguageRE = regexp.MustCompile(`^[A-Za-z0-9_.+-]+$`)
)

type OCRConfig struct {
	PDFToPPMPath  string
	TesseractPath string
	Languages     string
	MaxPages      int
	Timeout       time.Duration
}

type ocrCommandRunner interface {
	Run(ctx context.Context, name string, args []string, stdoutLimit int64) ([]byte, error)
}

type systemOCRCommandRunner struct{}

func (systemOCRCommandRunner) Run(ctx context.Context, name string, args []string, stdoutLimit int64) ([]byte, error) {
	stdout := &limitedCommandBuffer{limit: stdoutLimit}
	stderr := &limitedCommandBuffer{limit: maxOCRCommandLogBytes}
	// #nosec G204 -- validateOCRConfig requires trusted absolute executable paths; arguments bypass the shell.
	command := exec.CommandContext(ctx, name, args...)
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return nil, fmt.Errorf("%w: %s", err, message)
		}
		return nil, err
	}
	return stdout.Bytes(), nil
}

type limitedCommandBuffer struct {
	buffer bytes.Buffer
	limit  int64
}

func (buffer *limitedCommandBuffer) Write(value []byte) (int, error) {
	remaining := buffer.limit - int64(buffer.buffer.Len())
	if remaining <= 0 {
		return 0, errors.New("command output limit exceeded")
	}
	if int64(len(value)) > remaining {
		_, _ = buffer.buffer.Write(value[:remaining])
		return int(remaining), errors.New("command output limit exceeded")
	}
	return buffer.buffer.Write(value)
}

func (buffer *limitedCommandBuffer) Bytes() []byte  { return buffer.buffer.Bytes() }
func (buffer *limitedCommandBuffer) String() string { return buffer.buffer.String() }

func OCRPDF(ctx context.Context, data []byte, pageCount int, cfg OCRConfig) (Document, error) {
	return ocrPDFWithRunner(ctx, data, pageCount, cfg, systemOCRCommandRunner{})
}

func ocrPDFWithRunner(
	ctx context.Context,
	data []byte,
	pageCount int,
	cfg OCRConfig,
	runner ocrCommandRunner,
) (Document, error) {
	if err := validateOCRConfig(cfg); err != nil {
		return Document{}, err
	}
	if pageCount <= 0 || len(data) == 0 || len(data) > maxOCRInputBytes {
		return Document{}, fmt.Errorf("%w: invalid or oversized PDF", ErrOCRFailed)
	}
	maxPages := cfg.MaxPages
	if maxPages <= 0 {
		maxPages = defaultOCRMaxPages
	}
	if pageCount < maxPages {
		maxPages = pageCount
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultOCRTimeout
	}
	workCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tempDir, err := os.MkdirTemp("", "assistant-ocr-")
	if err != nil {
		return Document{}, fmt.Errorf("%w: create temporary directory", ErrOCRFailed)
	}
	defer os.RemoveAll(tempDir)
	inputPath := filepath.Join(tempDir, "input.pdf")
	if err := os.WriteFile(inputPath, data, 0o600); err != nil {
		return Document{}, fmt.Errorf("%w: write temporary PDF", ErrOCRFailed)
	}

	document := Document{PageCount: pageCount}
	for page := 1; page <= maxPages && !document.Truncated; page++ {
		outputPrefix := filepath.Join(tempDir, "page")
		imagePath := outputPrefix + ".png"
		_ = os.Remove(imagePath)
		_, err := runner.Run(workCtx, cfg.PDFToPPMPath, []string{
			"-f", strconv.Itoa(page), "-l", strconv.Itoa(page),
			"-singlefile", "-scale-to", "2000", "-png", inputPath, outputPrefix,
		}, maxOCRCommandLogBytes)
		if err != nil {
			return Document{}, fmt.Errorf("%w: render page %d: %v", ErrOCRFailed, page, err)
		}
		info, err := os.Stat(imagePath)
		if err != nil || info.Size() <= 0 || info.Size() > maxOCRPageImageBytes {
			return Document{}, fmt.Errorf("%w: rendered page %d exceeds limits", ErrOCRFailed, page)
		}
		text, err := runner.Run(workCtx, cfg.TesseractPath, []string{
			imagePath, "stdout", "-l", cfg.Languages, "--psm", "6",
		}, maxOCRPageTextBytes)
		if err != nil {
			return Document{}, fmt.Errorf("%w: recognize page %d: %v", ErrOCRFailed, page, err)
		}
		appendText(&document, cleanText(string(text)), map[string]any{"page": page, "source": "ocr"})
		_ = os.Remove(imagePath)
	}
	document.Truncated = document.Truncated || pageCount > maxPages
	if len(document.Segments) == 0 || document.CharCount == 0 {
		return document, ErrNoText
	}
	return document, nil
}

func validateOCRConfig(cfg OCRConfig) error {
	if !filepath.IsAbs(cfg.PDFToPPMPath) || !filepath.IsAbs(cfg.TesseractPath) {
		return fmt.Errorf("%w: OCR executable paths must be absolute", ErrOCRFailed)
	}
	if cfg.Languages == "" || len(cfg.Languages) > 100 || !ocrLanguageRE.MatchString(cfg.Languages) {
		return fmt.Errorf("%w: invalid OCR language list", ErrOCRFailed)
	}
	if cfg.MaxPages < 0 || cfg.MaxPages > defaultOCRMaxPages {
		return fmt.Errorf("%w: OCR page limit cannot exceed %d", ErrOCRFailed, defaultOCRMaxPages)
	}
	if cfg.Timeout < 0 || cfg.Timeout > 5*time.Minute {
		return fmt.Errorf("%w: OCR timeout exceeds limit", ErrOCRFailed)
	}
	return nil
}
