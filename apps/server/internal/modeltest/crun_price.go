package modeltest

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// estimateReferenceURL stands in for a reference image in price quotes; CRUN
// prices the shape of the request and does not download it for an estimate.
const estimateReferenceURL = "https://example.com/reference.png"

const maxPriceQuoteRows = 48

// PriceQuote is CRUN's credit estimate for one combination of the model's own
// options. Values are the schema's spelling, including tiers the platform
// does not offer yet.
type PriceQuote struct {
	Resolution    string  `json:"resolution,omitempty"`
	Quality       string  `json:"quality,omitempty"`
	WithReference bool    `json:"withReference"`
	Credits       float64 `json:"credits"`
	Error         string  `json:"error,omitempty"`
}

// CRUNPriceQuotes asks CRUN's EstimateTask for every resolution × quality ×
// reference combination the model's stored schema declares. Nothing runs.
func CRUNPriceQuotes(ctx context.Context, provider modelconfig.Provider, model modelconfig.Model) ([]PriceQuote, float64, error) {
	client, err := crun.New(provider.BaseURL, provider.APIKey, model.UpstreamModel, provider.TimeoutSecs)
	if err != nil {
		return nil, 0, err
	}
	resolutions := schemaOptions(model, "resolution")
	qualities := schemaOptions(model, "quality")
	references := []bool{false}
	if slices.Contains(model.UpstreamInputFields, "img_urls") {
		references = append(references, true)
	}
	if modelconfig.CRUNRequiresReference(model) {
		references = []bool{true}
	}
	// Some tiers reject some ratios (CRUN gpt-image-2 has no 4K square), so a
	// quote moves on to the next ratio when the upstream names the ratio.
	ratios := []string{}
	for _, option := range schemaOptions(model, "aspect_ratio") {
		if option != "auto" && strings.Contains(option, ":") {
			ratios = append(ratios, option)
		}
	}
	if len(ratios) == 0 {
		ratios = []string{""}
	}
	quotes := make([]PriceQuote, 0, len(resolutions)*len(qualities)*len(references))
	for _, withReference := range references {
		for _, resolution := range resolutions {
			for _, quality := range qualities {
				quotes = append(quotes, PriceQuote{Resolution: resolution, Quality: quality, WithReference: withReference})
			}
		}
	}
	if len(quotes) > maxPriceQuoteRows {
		quotes = quotes[:maxPriceQuoteRows]
	}
	var balance float64
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for index := range quotes {
		wg.Add(1)
		go func(quote *PriceQuote) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			var estimate *crun.MediaEstimate
			var err error
			for _, ratio := range ratios {
				request := crun.OpenAIImageRequest{
					Prompt: "price estimate", AspectRatio: ratio, Resolution: quote.Resolution, Quality: quote.Quality,
					AllowedInputFields: model.UpstreamInputFields, FixedInput: model.UpstreamFixedInput,
				}
				if quote.WithReference {
					request.ImageURLs = []string{estimateReferenceURL}
				}
				estimate, err = client.EstimateImage(callCtx, request)
				if err == nil || !strings.Contains(strings.ToLower(err.Error()), "aspect ratio") {
					break
				}
			}
			if err != nil {
				quote.Error = Truncate(err.Error(), 200)
				return
			}
			quote.Credits = estimate.EstimatedCredits
			mu.Lock()
			balance = estimate.Balance
			mu.Unlock()
		}(&quotes[index])
	}
	wg.Wait()
	return quotes, balance, nil
}

// schemaOptions lists a field's enum in schema spelling, or one empty option
// when the model does not take the field.
func schemaOptions(model modelconfig.Model, field string) []string {
	if !slices.Contains(model.UpstreamInputFields, field) {
		return []string{""}
	}
	schema, _ := modelconfig.ToolInputProperties(model)[field].(map[string]any)
	values, _ := schema["enum"].([]any)
	options := make([]string, 0, len(values))
	for _, value := range values {
		if text := strings.TrimSpace(fmt.Sprint(value)); value != nil && text != "" {
			options = append(options, text)
		}
	}
	if len(options) == 0 {
		return []string{""}
	}
	return options
}
