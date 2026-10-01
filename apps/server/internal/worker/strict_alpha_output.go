package worker

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

const (
	strictAlphaMinShortEdge = 1024
	strictAlphaMaxPixels    = 32_000_000
	strictAlphaClear        = uint32(8 * 257)
	strictAlphaOpaque       = uint32(245 * 257)
	strictAlphaMaximum      = uint64(65535)
)

func strictAlphaExecutionCandidates(candidates []modelconfig.Selection, params map[string]any) []modelconfig.Selection {
	if !taskParamBool(params, "strictAlphaOutput") {
		return candidates
	}
	compatible := candidates[:0]
	for index := range candidates {
		if taskflow.ValidateStrictAlphaImageRequest(&candidates[index], params) == nil {
			compatible = append(compatible, candidates[index])
		}
	}
	return compatible
}

func strictAlphaOutputConfig(reader io.Reader) (image.Config, error) {
	cfg, err := png.DecodeConfig(reader)
	if err != nil {
		return image.Config{}, fmt.Errorf("transparent subject must be a valid PNG: %w", err)
	}
	if min(cfg.Width, cfg.Height) < strictAlphaMinShortEdge {
		return image.Config{}, fmt.Errorf("transparent subject short edge must be at least %d pixels", strictAlphaMinShortEdge)
	}
	if int64(cfg.Width)*int64(cfg.Height) > strictAlphaMaxPixels {
		return image.Config{}, fmt.Errorf("transparent subject exceeds %d decoded pixels", strictAlphaMaxPixels)
	}
	return cfg, nil
}

func strictAlphaOutputMemoryWeight(encoded string) (int64, error) {
	cfg, err := strictAlphaOutputConfig(base64.NewDecoder(base64.StdEncoding, strings.NewReader(encoded)))
	if err != nil {
		return 0, &taskOutputProcessingError{stage: "transparent output validation", err: err}
	}
	// PNG compression is not a useful bound for decoded alpha and variant buffers.
	return int64(cfg.Width) * int64(cfg.Height) * 32, nil
}

func validateStrictAlphaTaskOutput(task *store.Task, data []byte) error {
	if task == nil || !taskParamBool(task.Params, "strictAlphaOutput") {
		return nil
	}
	if err := validateStrictAlphaOutput(data); err != nil {
		return &taskOutputProcessingError{stage: "transparent output validation", err: err}
	}
	return nil
}

// This is structural acceptance only; it does not establish semantic cutout quality.
func validateStrictAlphaOutput(data []byte) error {
	cfg, err := strictAlphaOutputConfig(bytes.NewReader(data))
	if err != nil {
		return err
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("cannot decode transparent subject PNG: %w", err)
	}

	total := uint64(cfg.Width) * uint64(cfg.Height)
	borderTotal := uint64(2*cfg.Width + 2*cfg.Height - 4)
	var clearPixels, clearBorderPixels, opaquePixels, alphaMass uint64
	bounds := img.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := img.At(x, y).RGBA()
			if alpha <= strictAlphaClear {
				clearPixels++
				if x == bounds.Min.X || x == bounds.Max.X-1 || y == bounds.Min.Y || y == bounds.Max.Y-1 {
					clearBorderPixels++
				}
			} else {
				alphaMass += uint64(alpha - strictAlphaClear)
			}
			if alpha >= strictAlphaOpaque {
				opaquePixels++
			}
		}
	}
	if clearPixels*100 < total {
		return fmt.Errorf("transparent subject has less than 1%% genuinely transparent pixels")
	}
	if clearBorderPixels*5 < borderTotal {
		return fmt.Errorf("transparent subject has less than 20%% transparent perimeter")
	}
	// The alpha-mass alternative accepts glass and other translucent subjects
	// without requiring hard opaque edges. Near-clear alpha does not count as a subject.
	if opaquePixels*500 < total && alphaMass*500 < total*(strictAlphaMaximum-uint64(strictAlphaClear)) {
		return fmt.Errorf("transparent subject has insufficient visible alpha content")
	}
	return nil
}
