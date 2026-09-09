package taskflow

import (
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// ValidateStrictAlphaImageRequest validates high-fidelity transparent requests
// before quotation or charging. Models without selectable formats use their
// built-in format; the worker still validates the actual PNG and alpha output.
func ValidateStrictAlphaImageRequest(selection *modelconfig.Selection, params map[string]any) error {
	if !boolParam(params, "strictAlphaOutput") {
		return nil
	}
	if selection == nil || selection.Provider.Adapter != modelconfig.AdapterOpenAI || selection.Model.Kind != modelconfig.ModelKindImage {
		return apperr.E("validation_error", "该线路无法完整传递高保真透明 PNG 参数，请选择已配置的原生 OpenAI 图片线路", 422)
	}
	outputFormat := stringParam(params, "outputFormat")
	if outputFormat != "png" && !(outputFormat == "" && len(selection.Model.OutputFormats) == 0) {
		return apperr.E("validation_error", "精细透明主体必须使用 PNG 输出格式", 422)
	}
	if stringParam(params, "quality") != "high" {
		return apperr.E("validation_error", "精细透明主体必须使用 high 输出质量", 422)
	}
	if stringParam(params, "inputFidelity") != "high" {
		return apperr.E("validation_error", "精细透明主体必须启用 high 参考图保真度", 422)
	}
	if !boolParam(params, "transparentPngEnabled", "transparentPng", "transparentBackground") {
		return apperr.E("validation_error", "精细透明主体必须启用原生透明背景", 422)
	}
	return nil
}
