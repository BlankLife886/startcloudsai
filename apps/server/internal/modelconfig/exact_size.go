package modelconfig

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
)

const MaxExactImageDimension = 16384

type ExactSizeLimits struct {
	MinWidth       int     `json:"minWidth"`
	MaxWidth       int     `json:"maxWidth"`
	MinHeight      int     `json:"minHeight"`
	MaxHeight      int     `json:"maxHeight"`
	Step           int     `json:"step"`
	MinPixels      int64   `json:"minPixels"`
	MaxPixels      int64   `json:"maxPixels"`
	MaxAspectRatio float64 `json:"maxAspectRatio"`
}

func DefaultExactSizeLimits() ExactSizeLimits {
	return ExactSizeLimits{MinWidth: 256, MaxWidth: 4096, MinHeight: 256, MaxHeight: 4096, Step: 1}
}

func (m Model) ExactSizeRules() ExactSizeLimits {
	if m.ExactSizeLimits != nil {
		return *m.ExactSizeLimits
	}
	return DefaultExactSizeLimits()
}

func validateExactSizeLimits(limits ExactSizeLimits) error {
	if limits.MinWidth < 1 || limits.MinHeight < 1 || limits.MaxWidth < limits.MinWidth || limits.MaxHeight < limits.MinHeight ||
		limits.MaxWidth > MaxExactImageDimension || limits.MaxHeight > MaxExactImageDimension {
		return fmt.Errorf("精确尺寸宽高范围须在 1-%d 之间，且下限不能超过上限", MaxExactImageDimension)
	}
	if limits.Step < 1 || limits.Step > MaxExactImageDimension ||
		(limits.MinWidth+limits.Step-1)/limits.Step*limits.Step > limits.MaxWidth ||
		(limits.MinHeight+limits.Step-1)/limits.Step*limits.Step > limits.MaxHeight {
		return errors.New("精确尺寸步长无效，宽高范围内必须存在步长的整数倍")
	}
	maxPixels := int64(MaxExactImageDimension) * MaxExactImageDimension
	if limits.MinPixels < 0 || limits.MaxPixels < 0 || limits.MinPixels > maxPixels || limits.MaxPixels > maxPixels ||
		(limits.MaxPixels > 0 && limits.MinPixels > limits.MaxPixels) ||
		limits.MinPixels > int64(limits.MaxWidth)*int64(limits.MaxHeight) ||
		(limits.MaxPixels > 0 && limits.MaxPixels < int64(limits.MinWidth)*int64(limits.MinHeight)) {
		return errors.New("精确尺寸总像素范围无效，0 表示不额外限制")
	}
	if math.IsNaN(limits.MaxAspectRatio) || math.IsInf(limits.MaxAspectRatio, 0) || (limits.MaxAspectRatio != 0 && limits.MaxAspectRatio < 1) {
		return errors.New("精确尺寸最大长短边比须为 0 或不小于 1")
	}
	for width := (limits.MinWidth + limits.Step - 1) / limits.Step * limits.Step; width <= limits.MaxWidth; width += limits.Step {
		minHeight, maxHeight := limits.MinHeight, limits.MaxHeight
		if limits.MinPixels > 0 {
			minHeight = max(minHeight, int((limits.MinPixels+int64(width)-1)/int64(width)))
		}
		if limits.MaxPixels > 0 {
			maxHeight = min(maxHeight, int(limits.MaxPixels/int64(width)))
		}
		if limits.MaxAspectRatio > 0 {
			ratio := math.Min(limits.MaxAspectRatio, MaxExactImageDimension)
			minHeight = max(minHeight, int(math.Ceil(float64(width)/ratio)))
			maxHeight = min(maxHeight, int(math.Floor(float64(width)*ratio)))
		}
		if (minHeight+limits.Step-1)/limits.Step*limits.Step <= maxHeight {
			return nil
		}
	}
	return errors.New("精确尺寸范围、步长、总像素与长短边比组合后没有可用尺寸")
}

func validateExactSizeConfig(model Model, provider Provider) error {
	if model.Kind == ModelKindImage {
		if err := validateExactSizeLimits(model.ExactSizeRules()); err != nil {
			return fmt.Errorf("模型 %s：%w", model.Name, err)
		}
	}
	if !model.SupportsExactSize {
		return nil
	}
	if model.Kind != ModelKindImage {
		return errors.New("仅生图模型可以开启精确尺寸")
	}
	if provider.Adapter == AdapterCRUN {
		if _, err := CRUNExactSizeFields(model); err != nil {
			return fmt.Errorf("模型 %s：%w", model.Name, err)
		}
	}
	return nil
}

// ExactImageDimensions only activates the new contract for an explicit mode.
// Historical clients' size/outputSize pixel strings keep their original behavior.
func ExactImageDimensions(params map[string]any) (width, height int, exact bool, err error) {
	mode, _ := params["sizeMode"].(string)
	if !strings.EqualFold(strings.TrimSpace(mode), "exact") {
		return 0, 0, false, nil
	}
	read := func(key string) (int, error) {
		number, ok := schemaNumber(params[key])
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < 1 || number > MaxExactImageDimension {
			return 0, fmt.Errorf("%s: 精确尺寸须为 1-%d 的整数", key, MaxExactImageDimension)
		}
		return int(number), nil
	}
	width, err = read("exactWidth")
	if err != nil {
		return 0, 0, true, err
	}
	height, err = read("exactHeight")
	return width, height, true, err
}

func ValidateExactImageSize(model Model, width, height int) error {
	if model.Kind != ModelKindImage || !model.SupportsExactSize {
		return errors.New("所选模型不支持精确尺寸，请切换尺寸模式或选择支持的模型")
	}
	limits := model.ExactSizeRules()
	if err := validateExactSizeLimits(limits); err != nil {
		return err
	}
	if width < limits.MinWidth || width > limits.MaxWidth || height < limits.MinHeight || height > limits.MaxHeight {
		return fmt.Errorf("精确尺寸超出模型范围：宽 %d-%d，高 %d-%d", limits.MinWidth, limits.MaxWidth, limits.MinHeight, limits.MaxHeight)
	}
	if width%limits.Step != 0 || height%limits.Step != 0 {
		return fmt.Errorf("精确尺寸宽高须为 %d 的整数倍", limits.Step)
	}
	pixels := int64(width) * int64(height)
	if pixels < limits.MinPixels || (limits.MaxPixels > 0 && pixels > limits.MaxPixels) {
		return errors.New("精确尺寸总像素超出模型允许范围")
	}
	if limits.MaxAspectRatio > 0 && float64(max(width, height))/float64(min(width, height)) > limits.MaxAspectRatio {
		return fmt.Errorf("精确尺寸长短边比不能超过 %g", limits.MaxAspectRatio)
	}
	return nil
}

var exactPixelSizePattern = regexp.MustCompile(`^[1-9][0-9]*x[1-9][0-9]*$`)

func exactSchemaTypes(schema map[string]any) []string {
	result := schemaTypes(schema)
	switch values := schema["type"].(type) {
	case []any:
		for _, value := range values {
			if kind, ok := value.(string); ok && kind != "null" {
				result = append(result, kind)
			}
		}
	case []string:
		for _, kind := range values {
			if kind != "null" {
				result = append(result, kind)
			}
		}
	}
	return result
}

// CRUNExactSizeFields requires an explicit, typed input declaration. An empty
// legacy field list cannot prove that an upstream accepts exact dimensions.
func CRUNExactSizeFields(model Model) ([]string, error) {
	properties := ToolInputProperties(model)
	fieldSupports := func(field string, kinds ...string) bool {
		if !containsFold(model.UpstreamInputFields, field) {
			return false
		}
		schema, _ := properties[field].(map[string]any)
		for _, kind := range exactSchemaTypes(schema) {
			if containsFold(kinds, kind) {
				return true
			}
		}
		return false
	}
	if fieldSupports("size", "string") {
		schema, _ := properties["size"].(map[string]any)
		values, hasEnum := schema["enum"].([]any)
		if !hasEnum || len(values) == 0 {
			return []string{"size"}, nil
		}
		for _, value := range values {
			if text, ok := value.(string); ok && exactPixelSizePattern.MatchString(text) {
				return []string{"size"}, nil
			}
		}
	}
	if fieldSupports("width", "integer", "number") && fieldSupports("height", "integer", "number") {
		return []string{"width", "height"}, nil
	}
	return nil, errors.New("CRUN 模型须声明字符串 size 或数值 width、height 参数才能使用精确尺寸")
}

func validateExactSchemaValue(field string, value any, schema map[string]any) error {
	if err := validateSchemaValue(field, value, schema); err != nil {
		return err
	}
	if kinds := exactSchemaTypes(schema); len(kinds) > 0 {
		validType := false
		for _, kind := range kinds {
			if validateSchemaValue(field, value, map[string]any{"type": kind}) == nil {
				validType = true
				break
			}
		}
		if !validType {
			return fmt.Errorf("精确尺寸参数 %s 类型不符合 CRUN schema", field)
		}
	}
	for _, variantKey := range []string{"anyOf", "oneOf", "allOf"} {
		variants, _ := schema[variantKey].([]any)
		if len(variants) == 0 {
			continue
		}
		matched := 0
		for _, variant := range variants {
			child, _ := variant.(map[string]any)
			if child["type"] != "null" && validateExactSchemaValue(field, value, child) == nil {
				matched++
			}
		}
		if matched == 0 || (variantKey == "oneOf" && matched != 1) || (variantKey == "allOf" && matched != len(variants)) {
			return fmt.Errorf("精确尺寸参数 %s 不符合 CRUN schema", field)
		}
	}
	if number, ok := schemaNumber(value); ok {
		if minimum, exists := schemaNumber(schema["minimum"]); exists && number < minimum {
			return fmt.Errorf("精确尺寸参数 %s 小于 CRUN 下限", field)
		}
		if maximum, exists := schemaNumber(schema["maximum"]); exists && number > maximum {
			return fmt.Errorf("精确尺寸参数 %s 超过 CRUN 上限", field)
		}
		if multiple, exists := schemaNumber(schema["multipleOf"]); exists && (multiple <= 0 || math.Abs(number/multiple-math.Round(number/multiple)) > 1e-9) {
			return fmt.Errorf("精确尺寸参数 %s 不符合 CRUN 步长", field)
		}
		if minimum, exists := schemaNumber(schema["exclusiveMinimum"]); exists && number <= minimum {
			return fmt.Errorf("精确尺寸参数 %s 必须大于 CRUN 下限", field)
		}
		if maximum, exists := schemaNumber(schema["exclusiveMaximum"]); exists && number >= maximum {
			return fmt.Errorf("精确尺寸参数 %s 必须小于 CRUN 上限", field)
		}
	}
	if text, ok := value.(string); ok {
		if pattern, exists := schema["pattern"].(string); exists {
			expression, err := regexp.Compile(pattern)
			if err != nil || !expression.MatchString(text) {
				return fmt.Errorf("精确尺寸参数 %s 不符合 CRUN 格式", field)
			}
		}
	}
	return nil
}

func ValidateExactImageParams(model Model, adapter string, params map[string]any) error {
	width, height, exact, err := ExactImageDimensions(params)
	if err != nil || !exact {
		return err
	}
	if err := ValidateExactImageSize(model, width, height); err != nil {
		return err
	}
	if adapter != AdapterCRUN {
		return nil
	}
	fields, err := CRUNExactSizeFields(model)
	if err != nil {
		return err
	}
	values := map[string]any{"size": fmt.Sprintf("%dx%d", width, height), "width": width, "height": height}
	properties := ToolInputProperties(model)
	for _, field := range fields {
		schema, _ := properties[field].(map[string]any)
		if err := validateExactSchemaValue(field, values[field], schema); err != nil {
			return err
		}
	}
	return nil
}

func ValidateExactImageSelection(selection *Selection, params map[string]any) error {
	_, _, exact, err := ExactImageDimensions(params)
	if err != nil {
		return err
	}
	if exact {
		if selection == nil {
			return errors.New("精确尺寸需要选择已配置且支持该能力的生图模型")
		}
		if err := ValidateExactImageParams(selection.Model, selection.Provider.Adapter, params); err != nil {
			return err
		}
	}
	var items []map[string]any
	switch raw := params["imagePlanItems"].(type) {
	case []map[string]any:
		items = raw
	case []any:
		for _, value := range raw {
			if item, ok := value.(map[string]any); ok {
				items = append(items, item)
			}
		}
	}
	for _, item := range items {
		// Plan items contain scalar image parameters, never nested plans.
		_, _, itemExact, itemErr := ExactImageDimensions(item)
		if itemErr != nil {
			return itemErr
		}
		if itemExact {
			if selection == nil {
				return errors.New("精确尺寸方案需要选择支持该能力的生图模型")
			}
			if err := ValidateExactImageParams(selection.Model, selection.Provider.Adapter, item); err != nil {
				return err
			}
		}
	}
	return nil
}

func NormalizeExactImageParams(model Model, adapter string, params map[string]any) error {
	if err := ValidateExactImageParams(model, adapter, params); err != nil {
		return err
	}
	width, height, exact, _ := ExactImageDimensions(params)
	if !exact {
		return nil
	}
	params["sizeMode"] = "exact"
	params["exactWidth"], params["exactHeight"] = width, height
	params["width"], params["height"] = width, height
	size := fmt.Sprintf("%dx%d", width, height)
	params["size"], params["outputSize"], params["requestSize"] = size, size, size
	for _, key := range []string{"resolution", "resolutionScale", "aspectRatio", "ratio", "requestedAspectRatio", "autoAspectRatioCandidates"} {
		delete(params, key)
	}
	return nil
}
