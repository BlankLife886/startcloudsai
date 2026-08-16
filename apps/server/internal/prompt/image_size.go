package prompt

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	gptImageStep           = 16
	gptImageMaxEdge        = 3840
	gptImageMinPixels      = 655_360
	gptImageMaxPixels      = 8_294_400
	gptImageMaxAspectRatio = 3
)

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func deriveImageSize(aspectRatio, resolution string) string {
	ratio := strings.TrimSpace(aspectRatio)
	if ratio == "" {
		return ""
	}
	if strings.EqualFold(ratio, "auto") {
		return "auto"
	}
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return ""
	}
	rawWidth, errWidth := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	rawHeight, errHeight := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if errWidth != nil || errHeight != nil || rawWidth <= 0 || rawHeight <= 0 {
		return ""
	}
	longSide := 1024
	switch strings.ToUpper(strings.TrimSpace(resolution)) {
	case "2K":
		longSide = 2048
	case "4K":
		longSide = 3840
	}
	var width, height float64
	if rawWidth >= rawHeight {
		width = float64(longSide)
		height = float64(longSide) * rawHeight / rawWidth
	} else {
		height = float64(longSide)
		width = float64(longSide) * rawWidth / rawHeight
	}
	normalized := normalizeGptImageOutputSize(int(math.Round(width)), int(math.Round(height)))
	return fmt.Sprintf("%dx%d", normalized.width, normalized.height)
}

type gptImageSize struct {
	width  int
	height int
}

func normalizeGptImageOutputSize(width, height int) gptImageSize {
	requestedWidth := positiveInt(width)
	requestedHeight := positiveInt(height)
	landscape := requestedWidth >= requestedHeight
	requestedLongEdge := max(requestedWidth, requestedHeight)
	requestedShortEdge := min(requestedWidth, requestedHeight)
	targetRatio := math.Max(1/gptImageMaxAspectRatio, float64(requestedShortEdge)/float64(requestedLongEdge))
	best := gptImageSize{}
	bestScore := math.Inf(1)
	found := false
	for longEdge := gptImageStep; longEdge <= gptImageMaxEdge; longEdge += gptImageStep {
		shortEdge := max(gptImageStep, int(math.Round(float64(longEdge)*targetRatio/gptImageStep))*gptImageStep)
		candidateWidth := longEdge
		candidateHeight := shortEdge
		if !landscape {
			candidateWidth, candidateHeight = shortEdge, longEdge
		}
		if !validGptImageSize(candidateWidth, candidateHeight) {
			continue
		}
		sizeDistance := math.Abs(float64(longEdge - requestedLongEdge))
		ratioDistance := math.Abs(float64(shortEdge)/float64(longEdge) - targetRatio)
		score := sizeDistance*1000 + ratioDistance
		if !found || score < bestScore {
			best = gptImageSize{width: candidateWidth, height: candidateHeight}
			bestScore = score
			found = true
		}
	}
	if !found {
		return gptImageSize{width: 1024, height: 1024}
	}
	return best
}

func validGptImageSize(width, height int) bool {
	pixels := width * height
	longEdge := max(width, height)
	shortEdge := min(width, height)
	return width%gptImageStep == 0 &&
		height%gptImageStep == 0 &&
		longEdge <= gptImageMaxEdge &&
		float64(longEdge)/float64(shortEdge) <= gptImageMaxAspectRatio &&
		pixels >= gptImageMinPixels &&
		pixels <= gptImageMaxPixels
}

func positiveInt(value int) int {
	if value > 0 {
		return value
	}
	return 1
}
