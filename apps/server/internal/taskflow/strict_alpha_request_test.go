package taskflow

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func strictAlphaRequestParams() map[string]any {
	return map[string]any{
		"strictAlphaOutput": true, "outputFormat": "png", "quality": "high",
		"inputFidelity": "high", "transparentBackground": true,
	}
}

func TestValidateStrictAlphaImageRequestRequiresCompleteContract(t *testing.T) {
	selection := &modelconfig.Selection{
		Provider: modelconfig.Provider{Adapter: modelconfig.AdapterOpenAI},
		Model:    modelconfig.Model{Kind: modelconfig.ModelKindImage, OutputFormats: []string{"png"}},
	}
	if err := ValidateStrictAlphaImageRequest(selection, strictAlphaRequestParams()); err != nil {
		t.Fatalf("complete OpenAI contract rejected: %v", err)
	}
	for _, field := range []string{"outputFormat", "quality", "inputFidelity", "transparentBackground"} {
		t.Run(field, func(t *testing.T) {
			params := strictAlphaRequestParams()
			delete(params, field)
			err := ValidateStrictAlphaImageRequest(selection, params)
			appErr, ok := apperr.As(err)
			if !ok || appErr.Code != "validation_error" || appErr.Status != 422 {
				t.Fatalf("missing %s must reject before quotation or charging: %v", field, err)
			}
		})
	}
	for field, value := range map[string]any{
		"outputFormat": "jpeg", "quality": "medium", "inputFidelity": "low", "transparentBackground": "true",
	} {
		t.Run("invalid "+field, func(t *testing.T) {
			params := strictAlphaRequestParams()
			params[field] = value
			if err := ValidateStrictAlphaImageRequest(selection, params); err == nil {
				t.Fatalf("invalid %s accepted", field)
			}
		})
	}
}

func TestValidateStrictAlphaImageRequestAllowsBuiltInFormat(t *testing.T) {
	selection := &modelconfig.Selection{
		Provider: modelconfig.Provider{Adapter: modelconfig.AdapterOpenAI},
		Model: modelconfig.Model{
			Kind: modelconfig.ModelKindImage, OutputFormats: []string{},
			Qualities: []string{"high"}, TransparentBackground: true, MaxReferenceImages: 1,
		},
	}
	params := strictAlphaRequestParams()
	delete(params, "outputFormat")
	if err := ValidateStrictAlphaImageRequest(selection, params); err != nil {
		t.Fatalf("built-in format rejected by strict request contract: %v", err)
	}
	if err := ValidateModelImageCapabilities(selection.Model, params, 1); err != nil {
		t.Fatalf("built-in format rejected by model capabilities: %v", err)
	}
	if _, present := params["outputFormat"]; present {
		t.Fatal("request validation must not add an unsupported output-format parameter")
	}
	for _, field := range []string{"quality", "inputFidelity", "transparentBackground"} {
		t.Run("missing "+field, func(t *testing.T) {
			incomplete := strictAlphaRequestParams()
			delete(incomplete, "outputFormat")
			delete(incomplete, field)
			if err := ValidateStrictAlphaImageRequest(selection, incomplete); err == nil {
				t.Fatalf("built-in format must not bypass required %s", field)
			}
		})
	}
	for _, format := range []string{"jpeg", "webp", "avif"} {
		t.Run("reject "+format, func(t *testing.T) {
			invalid := strictAlphaRequestParams()
			invalid["outputFormat"] = format
			if err := ValidateStrictAlphaImageRequest(selection, invalid); err == nil {
				t.Fatalf("built-in format must not allow explicit %s output", format)
			}
		})
	}
	params["outputFormat"] = "png"
	if err := ValidateModelImageCapabilities(selection.Model, params, 1); err == nil {
		t.Fatal("a model without selectable formats must still reject an explicit format")
	}
}

func TestValidateStrictAlphaImageRequestRejectsUnsupportedRoutes(t *testing.T) {
	for _, adapter := range []string{modelconfig.AdapterCRUN, "sub2api", "c2a", ""} {
		t.Run(adapter, func(t *testing.T) {
			selection := &modelconfig.Selection{
				Provider: modelconfig.Provider{Adapter: adapter},
				Model:    modelconfig.Model{Kind: modelconfig.ModelKindImage},
			}
			err := ValidateStrictAlphaImageRequest(selection, strictAlphaRequestParams())
			appErr, ok := apperr.As(err)
			if !ok || appErr.Code != "validation_error" || appErr.Status != 422 {
				t.Fatalf("unsupported route %q must reject before quotation or charging: %v", adapter, err)
			}
		})
	}
	if err := ValidateStrictAlphaImageRequest(nil, strictAlphaRequestParams()); err == nil {
		t.Fatal("unconfigured legacy fallback must not accept strict alpha requests")
	}
	if err := ValidateStrictAlphaImageRequest(&modelconfig.Selection{
		Provider: modelconfig.Provider{Adapter: modelconfig.AdapterOpenAI},
		Model:    modelconfig.Model{Kind: modelconfig.ModelKindImageTool},
	}, strictAlphaRequestParams()); err == nil {
		t.Fatal("image tool must not bypass the image generation contract")
	}
}

func TestValidateStrictAlphaImageRequestAcceptsTransparentAliases(t *testing.T) {
	selection := &modelconfig.Selection{
		Provider: modelconfig.Provider{Adapter: modelconfig.AdapterOpenAI},
		Model:    modelconfig.Model{Kind: modelconfig.ModelKindImage},
	}
	for _, alias := range []string{"transparentPngEnabled", "transparentPng", "transparentBackground"} {
		params := strictAlphaRequestParams()
		delete(params, "transparentBackground")
		params[alias] = true
		if err := ValidateStrictAlphaImageRequest(selection, params); err != nil {
			t.Fatalf("transparent alias %s rejected: %v", alias, err)
		}
	}
	params := strictAlphaRequestParams()
	params["outputFormat"], params["quality"], params["inputFidelity"] = " PNG ", " HIGH ", " HIGH "
	if err := ValidateStrictAlphaImageRequest(selection, params); err != nil {
		t.Fatalf("normalized high-fidelity parameters rejected: %v", err)
	}
}

func TestValidateStrictAlphaImageRequestDoesNotChangeOrdinaryGeneration(t *testing.T) {
	for _, params := range []map[string]any{nil, {}, {"strictAlphaOutput": false}, {"strictAlphaOutput": "true"}} {
		if err := ValidateStrictAlphaImageRequest(nil, params); err != nil {
			t.Fatalf("legacy generation without opt-in rejected: %v", err)
		}
		if err := ValidateStrictAlphaImageRequest(&modelconfig.Selection{
			Provider: modelconfig.Provider{Adapter: modelconfig.AdapterCRUN},
		}, params); err != nil {
			t.Fatalf("ordinary CRUN generation rejected: %v", err)
		}
	}
}
