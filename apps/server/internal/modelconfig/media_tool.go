package modelconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"unicode/utf8"
)

var mediaInputKinds = map[string]string{
	"img_urls": "image", "images": "image", "image_url": "image",
	"reference_images": "image", "video_urls": "video", "video_url": "video",
	"reference_videos": "video", "audio_url": "audio", "reference_audios": "audio",
	"reference_medias": "media",
}

func MediaInputKind(field string) string {
	return mediaInputKinds[strings.ToLower(strings.TrimSpace(field))]
}

func IsMediaInputField(field string) bool { return MediaInputKind(field) != "" }

func ToolInputProperties(model Model) map[string]any {
	properties, _ := model.UpstreamInputSchema["properties"].(map[string]any)
	return properties
}

func ValidateMediaToolInput(model Model, input map[string]any, files map[string][]string, inputKeys []string) error {
	if model.Kind != ModelKindImageTool {
		return errors.New("所选模型不是媒体工具")
	}
	properties := ToolInputProperties(model)
	if len(properties) == 0 {
		return errors.New("媒体工具参数尚未通过上游 schema 验证")
	}
	allowed := make(map[string]bool, len(model.UpstreamInputFields))
	for _, field := range model.UpstreamInputFields {
		allowed[field] = true
	}
	for field, value := range input {
		if !allowed[field] || properties[field] == nil {
			return fmt.Errorf("工具参数 %s 不在 CRUN 当前 schema 中", field)
		}
		if IsMediaInputField(field) {
			return fmt.Errorf("工具参数 %s 必须通过本站文件上传", field)
		}
		schema, _ := properties[field].(map[string]any)
		if err := validateSchemaValue(field, value, schema); err != nil {
			return err
		}
	}
	flatFiles := make([]string, 0, len(inputKeys))
	for field, keys := range files {
		if !allowed[field] || !IsMediaInputField(field) {
			return fmt.Errorf("文件参数 %s 不在 CRUN 当前 schema 中", field)
		}
		schema, _ := properties[field].(map[string]any)
		minItems, _ := schemaNumber(schema["minItems"])
		maxItems, _ := schemaNumber(schema["maxItems"])
		if len(keys) == 0 || minItems > 0 && float64(len(keys)) < minItems || maxItems > 0 && float64(len(keys)) > maxItems {
			return fmt.Errorf("文件参数 %s 的数量不符合 CRUN schema", field)
		}
		for _, key := range keys {
			key = strings.TrimSpace(key)
			if key == "" {
				return fmt.Errorf("文件参数 %s 包含空文件", field)
			}
			flatFiles = append(flatFiles, key)
		}
	}
	for _, field := range model.UpstreamRequiredInputFields {
		_, hasInput := input[field]
		hasFiles := len(files[field]) > 0
		if !hasInput && !hasFiles {
			return fmt.Errorf("缺少 CRUN schema 必填参数 %s", field)
		}
	}
	sort.Strings(flatFiles)
	want := append([]string(nil), inputKeys...)
	for index := range want {
		want[index] = strings.TrimSpace(want[index])
	}
	sort.Strings(want)
	if !reflect.DeepEqual(flatFiles, want) {
		return errors.New("工具文件参数与任务上传文件不一致")
	}
	return nil
}

func validateSchemaValue(field string, value any, schema map[string]any) error {
	if value == nil {
		if schemaAllowsNull(schema) {
			return nil
		}
		return fmt.Errorf("工具参数 %s 不能为空", field)
	}
	if values, ok := schema["enum"].([]any); ok && len(values) > 0 {
		matched := false
		for _, candidate := range values {
			if reflect.DeepEqual(normalizeJSONNumber(candidate), normalizeJSONNumber(value)) {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("工具参数 %s 不在 CRUN schema 允许范围内", field)
		}
	}
	types := schemaTypes(schema)
	if len(types) == 0 {
		return nil
	}
	valid := false
	for _, kind := range types {
		switch kind {
		case "string":
			text, ok := value.(string)
			if !ok {
				continue
			}
			if min, ok := schemaNumber(schema["minLength"]); ok && float64(utf8.RuneCountInString(text)) < min {
				return fmt.Errorf("工具参数 %s 长度低于 CRUN schema 下限", field)
			}
			if max, ok := schemaNumber(schema["maxLength"]); ok && float64(utf8.RuneCountInString(text)) > max {
				return fmt.Errorf("工具参数 %s 长度超过 CRUN schema 上限", field)
			}
			valid = true
		case "number", "integer":
			number, ok := schemaNumber(value)
			if !ok || kind == "integer" && math.Trunc(number) != number {
				continue
			}
			if min, ok := schemaNumber(schema["minimum"]); ok && number < min {
				return fmt.Errorf("工具参数 %s 小于 CRUN schema 下限", field)
			}
			if max, ok := schemaNumber(schema["maximum"]); ok && number > max {
				return fmt.Errorf("工具参数 %s 超过 CRUN schema 上限", field)
			}
			valid = true
		case "boolean":
			_, valid = value.(bool)
		case "object":
			_, valid = value.(map[string]any)
		case "array":
			_, valid = value.([]any)
		}
		if valid {
			break
		}
	}
	if !valid {
		return fmt.Errorf("工具参数 %s 的类型不符合 CRUN schema", field)
	}
	return nil
}

func schemaTypes(schema map[string]any) []string {
	result := []string{}
	if value, ok := schema["type"].(string); ok && value != "null" {
		result = append(result, value)
	}
	if variants, ok := schema["anyOf"].([]any); ok {
		for _, variant := range variants {
			item, _ := variant.(map[string]any)
			if value, ok := item["type"].(string); ok && value != "null" {
				result = append(result, value)
			}
		}
	}
	return result
}

func schemaAllowsNull(schema map[string]any) bool {
	if values, ok := schema["enum"].([]any); ok {
		for _, value := range values {
			if value == nil {
				return true
			}
		}
	}
	if variants, ok := schema["anyOf"].([]any); ok {
		for _, variant := range variants {
			item, _ := variant.(map[string]any)
			if item["type"] == "null" {
				return true
			}
		}
	}
	return false
}

func schemaNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		parsed, err := number.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func normalizeJSONNumber(value any) any {
	if number, ok := schemaNumber(value); ok {
		return number
	}
	return value
}
