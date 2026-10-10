// Package commerceset plans and produces a set of e-commerce product images
// (主图 + 详情页) for the AI assistant. It mirrors the 商品套图 workbench:
// the same shot types, the same copy planning and the same per-shot prompt
// assembly, so a set made in the assistant matches one made in the workbench
// and its tasks show up there as ordinary ecommerce_design work.
package commerceset

import (
	_ "embed"
	"encoding/json"
	"strings"
)

// catalog.json is a snapshot of the workbench catalog
// (apps/web-react/src/features/ecommerce/listing/listingCatalog.js),
// exported with node. Refresh it when the workbench catalog changes.
//
//go:embed catalog.json
var catalogJSON []byte

// ShotType is one kind of image in a set.
type ShotType struct {
	ID        string `json:"id"`
	Group     string `json:"group"`
	Role      string `json:"role"` // main | detail
	Label     string `json:"label"`
	Hint      string `json:"hint"`
	Direction string `json:"direction"`
}

type styleOption struct {
	Label  string `json:"label"`
	Prompt string `json:"prompt"`
}

type catalogFile struct {
	MaxShots           int        `json:"maxShots"`
	MaxPerType         int        `json:"maxPerType"`
	DefaultMainRatio   string     `json:"defaultMainRatio"`
	DefaultDetailRatio string     `json:"defaultDetailRatio"`
	Types              []ShotType `json:"types"`
	DefaultItems       []struct {
		ID    string `json:"id"`
		Count int    `json:"count"`
	} `json:"defaultItems"`
	Platforms []string      `json:"platforms"`
	Markets   []string      `json:"markets"`
	Languages []string      `json:"languages"`
	Styles    []styleOption `json:"styles"`
	Ratios    []string      `json:"ratios"`
}

var catalog = func() catalogFile {
	var file catalogFile
	if err := json.Unmarshal(catalogJSON, &file); err != nil {
		panic("commerceset: bad catalog.json: " + err.Error())
	}
	return file
}()

var typeByID = func() map[string]ShotType {
	out := make(map[string]ShotType, len(catalog.Types))
	for _, item := range catalog.Types {
		out[item.ID] = item
	}
	return out
}()

// MaxShots bounds one set, like the workbench.
func MaxShots() int { return catalog.MaxShots }

// MaxPerType bounds how many images of one type a set may hold.
func MaxPerType() int { return catalog.MaxPerType }

// Types lists every built-in shot type in catalog order.
func Types() []ShotType { return append([]ShotType(nil), catalog.Types...) }

// TypeByID finds a built-in shot type.
func TypeByID(id string) (ShotType, bool) {
	item, ok := typeByID[strings.TrimSpace(id)]
	return item, ok
}

// Platforms, Markets and Languages are the workbench's choices; free text is
// still accepted, these only guide the model.
func Platforms() []string { return append([]string(nil), catalog.Platforms...) }
func Markets() []string   { return append([]string(nil), catalog.Markets...) }
func Languages() []string { return append([]string(nil), catalog.Languages...) }

// StyleLabels lists the preset style names.
func StyleLabels() []string {
	out := make([]string, 0, len(catalog.Styles))
	for _, style := range catalog.Styles {
		out = append(out, style.Label)
	}
	return out
}

// stylePrompt mirrors listingStylePrompt: presets expand, free text passes.
func stylePrompt(style string) string {
	value := strings.TrimSpace(style)
	if value == "" {
		return ""
	}
	for _, preset := range catalog.Styles {
		if preset.Label == value {
			return preset.Prompt
		}
	}
	return value + "。"
}

// Ratios lists the aspect ratios the workbench offers.
func Ratios() []string { return append([]string(nil), catalog.Ratios...) }

func validRatio(ratio string) bool {
	for _, value := range catalog.Ratios {
		if value == ratio {
			return true
		}
	}
	return false
}
