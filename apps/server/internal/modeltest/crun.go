package modeltest

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// CRUNImageOptions tunes a CRUN image test. Empty values use the model's
// first configured resolution and ratio.
type CRUNImageOptions struct {
	Prompt       string
	EditPrompt   string
	Resolution   string
	AspectRatio  string
	Quality      string
	ReferenceURL string
	Edit         bool
}

// CRUNImage runs the same CreateTask request the worker builds for a
// schema-driven CRUN model: stored input fields, pinned variant, schema
// spelling for resolution and ratio. Step images are CRUN result URLs.
func CRUNImage(ctx context.Context, provider modelconfig.Provider, model modelconfig.Model, options CRUNImageOptions) Result {
	result := Result{Model: model.UpstreamModel, Kind: modelconfig.ModelKindImage}
	client, err := crun.New(provider.BaseURL, provider.APIKey, model.UpstreamModel, provider.TimeoutSecs)
	if err != nil {
		result.Steps = append(result.Steps, Step{Name: "文生图", Detail: Truncate(err.Error(), 300)})
		return result
	}
	resolution := firstNonEmpty(options.Resolution, firstOf(model.Resolutions))
	ratio := firstNonEmpty(options.AspectRatio, firstConcrete(model.AspectRatios))
	quality := ""
	if !model.QualityNotSent && slices.Contains(model.Qualities, options.Quality) {
		quality = options.Quality
	}
	run := func(name, prompt string, references []string) []string {
		callCtx, cancel := context.WithTimeout(ctx, 6*time.Minute)
		defer cancel()
		adapted := modelconfig.AdaptCRUNImage(model, modelconfig.CRUNImageParams{Prompt: prompt, AspectRatio: ratio, Resolution: resolution})
		started := time.Now()
		step := Step{Name: name}
		taskID, err := client.CreateTaskWithRequest(callCtx, crun.OpenAIImageRequest{
			Prompt: adapted.Prompt, N: 1, AspectRatio: adapted.AspectRatio, Resolution: adapted.Resolution,
			Quality: quality, ImageURLs: references, AllowedInputFields: model.UpstreamInputFields,
			FixedInput: model.UpstreamFixedInput, ForceQuality: model.QualityAlwaysSent,
		})
		var urls []string
		if err == nil {
			urls, err = client.WaitTasks(callCtx, []string{taskID}, nil)
		}
		step.LatencyMs = time.Since(started).Milliseconds()
		switch {
		case err != nil:
			step.Detail = Truncate(err.Error(), 300)
		case len(urls) == 0 || urls[0] == "":
			step.Detail = "没有返回图片"
		default:
			step.OK, step.Image = true, urls[0]
			step.Detail = crunTestDetail(adapted, quality, model.UpstreamFixedInput, taskID)
		}
		result.Steps = append(result.Steps, step)
		if step.OK {
			return urls
		}
		return nil
	}
	reference := strings.TrimSpace(options.ReferenceURL)
	editPrompt := firstNonEmpty(options.EditPrompt, DefaultEditPrompt)
	if modelconfig.CRUNRequiresReference(model) {
		if reference == "" {
			result.Steps = append(result.Steps, Step{Name: "图生图", Detail: errors.New("该模型只支持改图，请填写一张公网可访问的参考图地址").Error()})
			return result
		}
		run("图生图", editPrompt, []string{reference})
		return result
	}
	generated := run("文生图", firstNonEmpty(options.Prompt, DefaultImagePrompt), nil)
	if options.Edit && slices.Contains(model.UpstreamInputFields, "img_urls") {
		if reference == "" && len(generated) > 0 {
			reference = generated[0]
		}
		if reference != "" {
			run("图生图", editPrompt, []string{reference})
		}
	}
	return result
}

func crunTestDetail(params modelconfig.CRUNImageParams, quality string, fixed map[string]string, taskID string) string {
	parts := []string{}
	for _, part := range []string{params.Resolution, params.AspectRatio, quality} {
		if part != "" {
			parts = append(parts, part)
		}
	}
	for field, value := range fixed {
		parts = append(parts, field+"="+value)
	}
	return strings.Join(append(parts, "任务 "+taskID), " · ")
}

func firstOf(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func firstConcrete(ratios []string) string {
	for _, ratio := range ratios {
		if ratio != "auto" {
			return ratio
		}
	}
	return ""
}
