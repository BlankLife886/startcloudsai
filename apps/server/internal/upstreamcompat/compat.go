// Package upstreamcompat rewrites outgoing JSON request bodies so one
// OpenAI-compatible client can talk to vendors that differ in small ways
// (rejected fields, renamed fields, aspect_ratio instead of size).
package upstreamcompat

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

const maxRewriteBodyBytes = 64 << 20

// Wrap returns a transport that applies compat to JSON request bodies. A nil
// or empty compat returns base unchanged.
func Wrap(base http.RoundTripper, compat *modelconfig.RequestCompat) http.RoundTripper {
	if !compat.RewritesBody() {
		return base
	}
	if base == nil {
		base = http.DefaultTransport
	}
	return &transport{base: base, compat: compat}
}

// Wrapper adapts Wrap to the client option shape used by c2a and sub2api.
func Wrapper(compat *modelconfig.RequestCompat) func(http.RoundTripper) http.RoundTripper {
	if !compat.RewritesBody() {
		return nil
	}
	return func(base http.RoundTripper) http.RoundTripper { return Wrap(base, compat) }
}

type transport struct {
	base   http.RoundTripper
	compat *modelconfig.RequestCompat
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Body == nil || req.Body == http.NoBody || !isJSON(req.Header.Get("Content-Type")) {
		return t.base.RoundTrip(req)
	}
	raw, err := io.ReadAll(io.LimitReader(req.Body, maxRewriteBodyBytes+1))
	_ = req.Body.Close()
	if err != nil {
		return nil, err
	}
	if len(raw) <= maxRewriteBodyBytes {
		raw = Rewrite(raw, req.URL.Path, t.compat)
	}
	clone := req.Clone(req.Context())
	clone.Body = io.NopCloser(bytes.NewReader(raw))
	clone.ContentLength = int64(len(raw))
	clone.Header.Set("Content-Length", strconv.Itoa(len(raw)))
	clone.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(raw)), nil }
	return t.base.RoundTrip(clone)
}

func isJSON(contentType string) bool {
	return strings.Contains(strings.ToLower(contentType), "json")
}

// Rewrite applies compat to a JSON object body. Anything that is not a JSON
// object is returned unchanged.
func Rewrite(body []byte, path string, compat *modelconfig.RequestCompat) []byte {
	if !compat.RewritesBody() {
		return body
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		return body
	}
	if strings.Contains(path, "/images/") {
		if compat.ImageParamRules != nil {
			ApplyImageParamRules(payload, *compat.ImageParamRules)
		} else {
			rewriteImageSize(payload, compat.ImageSizeParam)
		}
	}
	for from, to := range compat.RenameParams {
		if value, ok := payload[from]; ok {
			delete(payload, from)
			payload[to] = value
		}
	}
	for _, name := range compat.DropParams {
		delete(payload, name)
	}
	for key, value := range compat.ExtraBody {
		payload[key] = value
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return out
}

func rewriteImageSize(payload map[string]any, mode string) {
	switch mode {
	case modelconfig.ImageSizeParamNone:
		delete(payload, "size")
	case modelconfig.ImageSizeParamAspectRatio:
		size, _ := payload["size"].(string)
		delete(payload, "size")
		if _, exists := payload["aspect_ratio"]; exists {
			return
		}
		if ratio := AspectRatioForSize(size); ratio != "" {
			payload["aspect_ratio"] = ratio
		}
	}
}

// ApplyImageParamRules turns the platform's unified image fields (size as
// WxH, quality, background, …) into the dialect a profile describes.
func ApplyImageParamRules(payload map[string]any, rules modelconfig.ImageParamRules) {
	size, _ := payload["size"].(string)
	if rules.SizeMode != modelconfig.ImageSizeModeSize {
		delete(payload, "size")
	}
	switch rules.SizeMode {
	case modelconfig.ImageSizeModeAspect, modelconfig.ImageSizeModeAspectTier:
		if ratio := profileAspect(size, rules.AspectRatios); ratio != "" {
			payload[rules.AspectField] = ratio
		}
		if rules.SizeMode == modelconfig.ImageSizeModeAspectTier {
			if tier := profileTier(size, rules.TierValues); tier != "" {
				payload[rules.TierField] = tier
			}
		}
	}
	switch rules.QualityMode {
	case modelconfig.ImageQualityDrop:
		delete(payload, "quality")
	case modelconfig.ImageQualityMap:
		quality, _ := payload["quality"].(string)
		if mapped := rules.QualityMap[quality]; mapped != "" {
			payload["quality"] = mapped
		} else {
			delete(payload, "quality")
		}
	}
	for _, field := range rules.Drop {
		delete(payload, field)
	}
}

// profileAspect maps WxH to the closest allowed ratio, or to the exact
// reduced ratio when the profile lists none. "auto" passes through only when
// allowed.
func profileAspect(size string, allowed []string) string {
	if strings.EqualFold(strings.TrimSpace(size), "auto") {
		for _, ratio := range allowed {
			if ratio == "auto" {
				return "auto"
			}
		}
		return ""
	}
	width, height, ok := parseSize(size)
	if !ok {
		return ""
	}
	if len(allowed) == 0 {
		divisor := gcd(width, height)
		return strconv.Itoa(width/divisor) + ":" + strconv.Itoa(height/divisor)
	}
	target := float64(width) / float64(height)
	best, bestDistance := "", math.MaxFloat64
	for _, ratio := range allowed {
		w, h, ok := parseRatio(ratio)
		if !ok {
			continue
		}
		if distance := math.Abs(math.Log(target) - math.Log(w/h)); distance < bestDistance {
			best, bestDistance = ratio, distance
		}
	}
	return best
}

// profileTier derives the platform tier from the long edge (1K ≈ 1024,
// 2K ≈ 2048, 4K ≈ 3840) and maps it; a tier the upstream lacks falls back to
// the highest mapped tier below it.
func profileTier(size string, values map[string]string) string {
	width, height, ok := parseSize(size)
	if !ok || len(values) == 0 {
		return ""
	}
	tiers := []string{"1K", "2K", "4K"}
	index := 0
	switch edge := max(width, height); {
	case edge > 2880:
		index = 2
	case edge > 1536:
		index = 1
	}
	for ; index >= 0; index-- {
		if value := values[tiers[index]]; value != "" {
			return value
		}
	}
	return ""
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// AspectRatioForSize maps WxH to the nearest ratio vendors commonly accept.
func AspectRatioForSize(size string) string {
	width, height, ok := parseSize(size)
	if !ok {
		return ""
	}
	target := float64(width) / float64(height)
	best, bestDistance := "", math.MaxFloat64
	for _, ratio := range modelconfig.ImageAspectRatios {
		w, h, ok := parseRatio(ratio)
		if !ok {
			continue
		}
		distance := math.Abs(math.Log(target) - math.Log(w/h))
		if distance < bestDistance {
			best, bestDistance = ratio, distance
		}
	}
	return best
}

func parseSize(size string) (int, int, bool) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

func parseRatio(ratio string) (float64, float64, bool) {
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	w, errW := strconv.ParseFloat(parts[0], 64)
	h, errH := strconv.ParseFloat(parts[1], 64)
	if errW != nil || errH != nil || w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}
