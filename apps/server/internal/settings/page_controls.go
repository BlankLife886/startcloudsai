package settings

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	PageStatusNormal      = "normal"
	PageStatusMaintenance = "maintenance"
	PageStatusDeveloping  = "developing"
	PageStatusRemoved     = "removed"
)

type PageControl struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

var PageControlKeys = []string{
	"studio",
	"canvas",
	"ecommerce.tryon",
	"ecommerce.handheld",
	"ecommerce.accessory",
	"ecommerce.shoot",
	"ecommerce.listing",
	"ecommerce.detail",
	"ecommerce.campaign",
	"ecommerce.background",
	"ecommerce.backdrop",
	"ecommerce.shadow",
	"ecommerce.outpaint",
	"ecommerce.enhance",
	"assistant",
	"developer_api",
	"text_to_image",
	"model_sheet",
	"illustration_coloring",
	"ui_design",
	"game_art",
	"pricing",
	"activity.checkin",
	"activity.trial",
	"activity.usage",
	"activity.group",
	"activity.suggestion",
	"activity.failure",
}

func PageControlDefaults() map[string]PageControl {
	controls := make(map[string]PageControl, len(PageControlKeys))
	for _, key := range PageControlKeys {
		controls[key] = PageControl{Status: PageStatusNormal}
	}
	// These workspaces were already presented as under development before page controls existed.
	for _, key := range []string{"illustration_coloring", "game_art"} {
		controls[key] = PageControl{Status: PageStatusDeveloping, Reason: "功能正在开发中，敬请期待。"}
	}
	for _, key := range []string{
		"activity.checkin",
		"activity.trial",
		"activity.usage",
		"activity.group",
		"activity.suggestion",
		"activity.failure",
	} {
		controls[key] = PageControl{Status: PageStatusRemoved, Reason: "活动已下架。"}
	}
	controls["developer_api"] = PageControl{
		Status: PageStatusRemoved,
		Reason: "开放 API 正在内部测试。",
	}
	return controls
}

func mustMarshalPageControls(controls map[string]PageControl) json.RawMessage {
	raw, err := json.Marshal(controls)
	if err != nil {
		panic(err)
	}
	return raw
}

func ValidPageControlKey(key string) bool {
	for _, candidate := range PageControlKeys {
		if candidate == key {
			return true
		}
	}
	return false
}

func ValidPageStatus(status string) bool {
	switch status {
	case PageStatusNormal, PageStatusMaintenance, PageStatusDeveloping, PageStatusRemoved:
		return true
	default:
		return false
	}
}

// ResolvePageControls merges stored values over defaults so newly added pages
// remain controllable even when an older, partial settings value exists.
func ResolvePageControls(ctx context.Context, q store.Q) (map[string]PageControl, error) {
	controls := PageControlDefaults()
	raw, err := Get(ctx, q, "page_controls")
	if err != nil {
		return nil, err
	}
	stored := map[string]PageControl{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &stored)
	}
	for key, control := range stored {
		control.Status = strings.TrimSpace(control.Status)
		control.Reason = strings.TrimSpace(control.Reason)
		if ValidPageControlKey(key) && ValidPageStatus(control.Status) {
			controls[key] = control
		}
	}
	return controls, nil
}
