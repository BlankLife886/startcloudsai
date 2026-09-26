package worker

import (
	"errors"
	"fmt"

	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func crunExactSizeFields(params map[string]any, models []modelconfig.Model) ([]string, error) {
	_, _, exact, err := modelconfig.ExactImageDimensions(params)
	if err != nil {
		return nil, err
	}
	for _, item := range assistantMetadataImages(params, "imagePlanItems") {
		_, _, itemExact, itemErr := modelconfig.ExactImageDimensions(item)
		if itemErr != nil {
			return nil, itemErr
		}
		exact = exact || itemExact
	}
	if !exact {
		return nil, nil
	}
	if len(models) == 0 {
		return nil, errors.New("精确尺寸缺少已验证的模型配置，已阻止上游提交")
	}
	selection := &modelconfig.Selection{Model: models[0], Provider: modelconfig.Provider{Adapter: modelconfig.AdapterCRUN}}
	if err := modelconfig.ValidateExactImageSelection(selection, params); err != nil {
		return nil, err
	}
	return modelconfig.CRUNExactSizeFields(models[0])
}

func applyCRUNExactSize(request *crun.OpenAIImageRequest, params map[string]any, fields []string) error {
	width, height, exact, err := modelconfig.ExactImageDimensions(params)
	if err != nil {
		return err
	}
	request.ExactSize = exact
	request.ExactSizeFields = nil
	if !exact {
		return nil
	}
	if len(fields) == 0 {
		return errors.New("CRUN 模型不支持精确尺寸，已阻止上游提交")
	}
	request.ExactWidth, request.ExactHeight = width, height
	request.Size = fmt.Sprintf("%dx%d", width, height)
	request.AspectRatio, request.Resolution = "", ""
	request.ExactSizeFields = append([]string(nil), fields...)
	return nil
}
