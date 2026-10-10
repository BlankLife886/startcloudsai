package modelconfig

import (
	"fmt"
	"strings"
)

// ImageTierPrice is one cell of an image model's resolution × quality price
// matrix. PriceCents/DiscountPriceCents are what users pay for one image at
// that cell; UpstreamCostCents is what the model's provider charges for it.
type ImageTierPrice struct {
	PriceCents         int64  `json:"priceCents"`
	DiscountPriceCents *int64 `json:"discountPriceCents"`
	UpstreamCostCents  int64  `json:"upstreamCostCents"`
}

func (p ImageTierPrice) Effective() int64 {
	if p.DiscountPriceCents != nil {
		return *p.DiscountPriceCents
	}
	return p.PriceCents
}

// ImageTier names the cell a request is billed and executed at.
type ImageTier struct {
	Resolution string `json:"resolution"`
	Quality    string `json:"quality"`
}

// ImageResolutions are the resolution tiers in ascending order.
var ImageResolutions = []string{"1K", "2K", "4K"}

// Exact sizes are billed at the smallest tier that holds their pixel count.
// 1K covers OpenAI's 1536x1024; 2K covers 2048x2048.
const (
	imageTier1KMaxPixels = 1536 * 1024
	imageTier2KMaxPixels = 2048 * 2048
)

// ResolutionTierForPixels maps an exact output size to a resolution tier.
func ResolutionTierForPixels(width, height int) string {
	pixels := width * height
	switch {
	case pixels <= imageTier1KMaxPixels:
		return "1K"
	case pixels <= imageTier2KMaxPixels:
		return "2K"
	default:
		return "4K"
	}
}

// HasImagePricing reports whether the model bills by resolution × quality.
func HasImagePricing(model Model) bool {
	return model.Kind == ModelKindImage && len(model.ImagePricing) > 0
}

// NormalizeImageQuality maps the legacy DALL·E names onto the GPT Image ones.
func NormalizeImageQuality(quality string) string {
	switch quality = strings.ToLower(strings.TrimSpace(quality)); quality {
	case "standard":
		return "medium"
	case "hd":
		return "high"
	}
	return quality
}

// DefaultImageQuality is the concrete quality used when a request leaves it
// out, or asks for auto on a model that does not offer auto as its own tier.
func DefaultImageQuality(model Model) string {
	if containsExact(model.Qualities, model.DefaultQuality) {
		return model.DefaultQuality
	}
	if containsExact(model.Qualities, "medium") {
		return "medium"
	}
	if len(model.Qualities) > 0 {
		return model.Qualities[0]
	}
	return ""
}

// DefaultImageResolution is the tier an image without a resolution renders at
// (the size compiler's 1024px long edge).
func DefaultImageResolution(model Model) string {
	if len(model.Resolutions) == 0 || containsFold(model.Resolutions, "1K") {
		return "1K"
	}
	return strings.ToUpper(model.Resolutions[0])
}

// ImageBillingTier picks the matrix cell for a request's params.
func ImageBillingTier(model Model, params map[string]any) ImageTier {
	tier := ImageTier{}
	if width, height, exact, err := ExactImageDimensions(params); err == nil && exact {
		tier.Resolution = ResolutionTierForPixels(width, height)
	} else {
		for _, key := range []string{"resolutionScale", "resolution"} {
			if value, ok := params[key].(string); ok && strings.TrimSpace(value) != "" {
				tier.Resolution = strings.ToUpper(strings.TrimSpace(value))
				break
			}
		}
	}
	if tier.Resolution == "" {
		tier.Resolution = DefaultImageResolution(model)
	}
	if value, ok := params["quality"].(string); ok {
		tier.Quality = NormalizeImageQuality(value)
	}
	// A model that offers auto prices it as its own column; otherwise auto
	// (whose cost the upstream decides) bills and runs at the default.
	if tier.Quality == "" || (tier.Quality == "auto" && !containsExact(model.Qualities, "auto")) {
		tier.Quality = DefaultImageQuality(model)
	}
	return tier
}

func imageTierCell(model Model, tier ImageTier) (ImageTierPrice, bool) {
	row, ok := model.ImagePricing[strings.ToUpper(tier.Resolution)]
	if !ok {
		return ImageTierPrice{}, false
	}
	cell, ok := row[tier.Quality]
	return cell, ok
}

// ResolveImageTierPrice returns the user price of one image at the tier. A
// model without a matrix, or a cell left out, keeps the model's flat price.
func ResolveImageTierPrice(model Model, tier ImageTier) ResolvedWorkspacePrice {
	if cell, ok := imageTierCell(model, tier); ok && HasImagePricing(model) {
		return ResolvedWorkspacePrice{
			PriceCents: cell.PriceCents, DiscountPriceCents: cell.DiscountPriceCents,
			EffectiveCents: cell.Effective(),
		}
	}
	return ResolvedWorkspacePrice{
		PriceCents: model.PriceCents, DiscountPriceCents: model.DiscountPriceCents,
		EffectiveCents: EffectivePrice(model),
	}
}

// ImageTierUpstreamCost is the provider's cost of one image at the tier.
func ImageTierUpstreamCost(model Model, tier ImageTier) int64 {
	if cell, ok := imageTierCell(model, tier); ok && HasImagePricing(model) {
		return cell.UpstreamCostCents
	}
	return model.UpstreamCostCents
}

// ImagePriceBounds is the lowest and highest effective price over the matrix
// (the flat price when there is none).
func ImagePriceBounds(model Model) (int64, int64) {
	if !HasImagePricing(model) {
		price := EffectivePrice(model)
		return price, price
	}
	first := true
	var low, high int64
	for _, row := range model.ImagePricing {
		for _, cell := range row {
			price := cell.Effective()
			if first || price < low {
				low = price
			}
			if first || price > high {
				high = price
			}
			first = false
		}
	}
	return low, high
}

// PublicImagePricing is the matrix without upstream costs, for clients.
func PublicImagePricing(model Model) map[string]map[string]ImageTierPrice {
	if !HasImagePricing(model) {
		return nil
	}
	out := make(map[string]map[string]ImageTierPrice, len(model.ImagePricing))
	for resolution, row := range model.ImagePricing {
		cells := make(map[string]ImageTierPrice, len(row))
		for quality, cell := range row {
			cell.UpstreamCostCents = 0
			cells[quality] = cell
		}
		out[resolution] = cells
	}
	return out
}

func normalizeImagePricing(model *Model) {
	model.DefaultQuality = NormalizeImageQuality(model.DefaultQuality)
	if model.Kind != ModelKindImage || len(model.ImagePricing) == 0 {
		model.ImagePricing = nil
		return
	}
	out := make(map[string]map[string]ImageTierPrice, len(model.ImagePricing))
	for resolution, row := range model.ImagePricing {
		resolution = strings.ToUpper(strings.TrimSpace(resolution))
		if resolution == "" || len(row) == 0 {
			continue
		}
		cells := make(map[string]ImageTierPrice, len(row))
		for quality, cell := range row {
			if quality = NormalizeImageQuality(quality); quality != "" {
				cells[quality] = cell
			}
		}
		if len(cells) > 0 {
			out[resolution] = cells
		}
	}
	if len(out) == 0 {
		out = nil
	}
	model.ImagePricing = out
}

// validateImagePricing requires a matrix to cover every resolution × quality
// the model offers, so no request silently falls back to the flat price.
func validateImagePricing(model Model) error {
	if model.DefaultQuality != "" && !containsExact(model.Qualities, model.DefaultQuality) {
		return fmt.Errorf("模型 %s 的默认质量不在可选质量中", model.Name)
	}
	if !HasImagePricing(model) {
		return nil
	}
	if len(model.Resolutions) == 0 || len(model.Qualities) == 0 {
		return fmt.Errorf("模型 %s 配置了分档价格，必须同时设定分辨率和输出质量", model.Name)
	}
	for resolution, row := range model.ImagePricing {
		if !containsFold(model.Resolutions, resolution) {
			return fmt.Errorf("模型 %s 的分档价格包含未开放的分辨率 %s", model.Name, resolution)
		}
		for quality := range row {
			if !containsExact(model.Qualities, quality) {
				return fmt.Errorf("模型 %s 的分档价格包含未开放的质量 %s", model.Name, quality)
			}
		}
	}
	for _, resolution := range model.Resolutions {
		for _, quality := range model.Qualities {
			cell, ok := imageTierCell(model, ImageTier{Resolution: resolution, Quality: quality})
			if !ok {
				return fmt.Errorf("模型 %s 的分档价格缺少 %s · %s", model.Name, resolution, quality)
			}
			label := fmt.Sprintf("模型 %s 的 %s · %s 档", model.Name, resolution, quality)
			if cell.PriceCents < 0 || (cell.DiscountPriceCents != nil && *cell.DiscountPriceCents < 0) || cell.UpstreamCostCents < 0 {
				return fmt.Errorf("%s价格和成本不能为负", label)
			}
			if cell.DiscountPriceCents != nil && *cell.DiscountPriceCents > cell.PriceCents {
				return fmt.Errorf("%s折扣价不能高于标准价", label)
			}
			if !model.Enabled || !model.Public {
				continue
			}
			if cell.Effective() == 0 && !model.AllowZeroPrice {
				return fmt.Errorf("%s用户价格为 0；如确需免费，请显式开启允许零价", label)
			}
			if cell.Effective() < cell.UpstreamCostCents && !model.AllowLossLeader {
				return fmt.Errorf("%s用户价格低于上游成本；如确需补贴，请显式开启允许亏损", label)
			}
		}
	}
	return nil
}
