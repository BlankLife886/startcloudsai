package modelconfig

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// crunPlatformInputFields are filled from the user's request on every image
// task, so a model must not pin them.
var crunPlatformInputFields = map[string]bool{
	"prompt": true, "img_urls": true, "aspect_ratio": true, "resolution": true,
	"quality": true, "background": true, "output_format": true, "moderation": true,
	"size": true, "width": true, "height": true, "n": true, "num_outputs": true,
}

func cleanFixedInput(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	cleaned := make(map[string]string, len(input))
	for field, value := range input {
		field, value = strings.TrimSpace(field), strings.TrimSpace(value)
		if field != "" && value != "" {
			cleaned[field] = value
		}
	}
	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}

func validateFixedInput(model Model, provider Provider) error {
	if len(model.UpstreamFixedInput) == 0 {
		return nil
	}
	if provider.Adapter != AdapterCRUN || model.Kind != ModelKindImage {
		return fmt.Errorf("模型 %s 的固定上游参数只支持 CRUN 生图模型", model.Name)
	}
	for field, value := range model.UpstreamFixedInput {
		if crunPlatformInputFields[field] {
			return fmt.Errorf("模型 %s 的固定上游参数 %s 由平台按请求填写，不能固定", model.Name, field)
		}
		if !containsFold(model.UpstreamInputFields, field) {
			return fmt.Errorf("模型 %s 的固定上游参数 %s 不在上游 schema 中", model.Name, field)
		}
		if _, ok := CRUNEnumValue(model, field, value); !ok {
			return fmt.Errorf("模型 %s 的固定上游参数 %s=%s 不在上游可选值中", model.Name, field, value)
		}
	}
	return nil
}

// CRUNEnumValue returns the schema's own spelling of value for field, matched
// case-insensitively. Fields without an enum accept any value.
func CRUNEnumValue(model Model, field, value string) (string, bool) {
	schema, _ := ToolInputProperties(model)[field].(map[string]any)
	options, _ := schema["enum"].([]any)
	if len(options) == 0 {
		return value, true
	}
	for _, option := range options {
		text := strings.TrimSpace(fmt.Sprint(option))
		if text != "" && strings.EqualFold(text, strings.TrimSpace(value)) {
			return text, true
		}
	}
	return "", false
}

// CRUNResolution maps the platform's 1K/2K/4K tier onto the model's schema
// spelling (some CRUN models expect "1k"), falling back to the model's first
// configured resolution when the requested tier is not offered upstream.
func CRUNResolution(model Model, requested string) string {
	if !containsFold(model.UpstreamInputFields, "resolution") {
		return requested
	}
	if value, ok := CRUNEnumValue(model, "resolution", requested); ok {
		return value
	}
	for _, resolution := range model.Resolutions {
		if value, ok := CRUNEnumValue(model, "resolution", resolution); ok {
			return value
		}
	}
	return requested
}

// CRUNRequiresReference reports whether the model's schema only edits images.
func CRUNRequiresReference(model Model) bool {
	return containsFold(model.UpstreamRequiredInputFields, "img_urls")
}

// CRUNImageParams are the request values that depend on one CRUN model's schema.
type CRUNImageParams struct {
	Prompt      string
	AspectRatio string
	Resolution  string
}

// AdaptCRUNImage fits prompt, aspect ratio and resolution to the model's
// stored schema: schema spelling, nearest supported ratio and prompt length.
func AdaptCRUNImage(model Model, params CRUNImageParams) CRUNImageParams {
	params.Resolution = CRUNResolution(model, params.Resolution)
	params.AspectRatio = CRUNAspectRatio(model, params.AspectRatio)
	if limit := crunPromptLimit(model); limit > 0 {
		if runes := []rune(params.Prompt); len(runes) > limit {
			params.Prompt = string(runes[:limit])
		}
	}
	return params
}

// CRUNAspectRatio returns the requested ratio in the schema's spelling, the
// nearest ratio the schema offers, or "" to leave the field out. Auto is sent
// only when the schema lists it.
func CRUNAspectRatio(model Model, requested string) string {
	requested = strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(requested), " ", ""), "/", ":")
	if !containsFold(model.UpstreamInputFields, "aspect_ratio") || requested == "" {
		return requested
	}
	if value, ok := CRUNEnumValue(model, "aspect_ratio", requested); ok {
		return value
	}
	if strings.EqualFold(requested, "auto") {
		return ""
	}
	target := ratioValue(requested)
	if target == 0 {
		return ""
	}
	schema, _ := ToolInputProperties(model)["aspect_ratio"].(map[string]any)
	options, _ := schema["enum"].([]any)
	best, bestDistance := "", math.MaxFloat64
	for _, option := range options {
		text := strings.TrimSpace(fmt.Sprint(option))
		if value := ratioValue(text); value > 0 && math.Abs(value-target) < bestDistance {
			best, bestDistance = text, math.Abs(value-target)
		}
	}
	return best
}

func ratioValue(value string) float64 {
	width, height, found := strings.Cut(value, ":")
	if !found {
		return 0
	}
	w, errW := strconv.ParseFloat(width, 64)
	h, errH := strconv.ParseFloat(height, 64)
	if errW != nil || errH != nil || w <= 0 || h <= 0 {
		return 0
	}
	return w / h
}

// MaxPromptChars bounds a model's own prompt limit, matching the global setting.
const MaxPromptChars = 100000

// crunPromptLimit prefers the admin's per-model limit over the schema's.
func crunPromptLimit(model Model) int {
	if model.PromptMaxChars > 0 {
		return model.PromptMaxChars
	}
	schema, _ := ToolInputProperties(model)["prompt"].(map[string]any)
	limit, _ := schemaNumber(schema["maxLength"])
	return int(limit)
}

// Admins may offer any ratio a model takes (1:4, 8:1, 9:19.5 …), not only the
// common list; anything beyond 1:20 is treated as a typo.
const maxCustomAspectRatio = 20.0

// ValidAspectRatio reports whether value is auto or a positive w:h ratio.
func ValidAspectRatio(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "auto" {
		return true
	}
	ratio := ratioValue(value)
	return ratio > 0 && ratio <= maxCustomAspectRatio && ratio >= 1/maxCustomAspectRatio
}

// cleanAspectRatios keeps valid ratios once each: the common ones in their
// usual order, then the admin's own ones from widest to tallest.
func cleanAspectRatios(values []string) []string {
	selected := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), " ", ""))
		if ValidAspectRatio(value) {
			selected[value] = true
		}
	}
	out := make([]string, 0, len(selected))
	for _, ratio := range ImageAspectRatios {
		if selected[ratio] {
			out = append(out, ratio)
			delete(selected, ratio)
		}
	}
	custom := make([]string, 0, len(selected))
	for ratio := range selected {
		custom = append(custom, ratio)
	}
	sort.Slice(custom, func(i, j int) bool {
		if a, b := ratioValue(custom[i]), ratioValue(custom[j]); a != b {
			return a > b
		}
		return custom[i] < custom[j]
	})
	return append(out, custom...)
}
