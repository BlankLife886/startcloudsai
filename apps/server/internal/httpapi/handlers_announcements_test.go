package httpapi

import (
	"encoding/json"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestNormalizeAnnouncementConfigDefaults(t *testing.T) {
	raw, err := normalizeAnnouncementConfig(nil)
	if err != nil {
		t.Fatal(err)
	}
	var config announcementConfigIn
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	if config.Placement != "modal" || config.Layout != "text_only" || !config.AllowClose || config.Frequency != "session_once" {
		t.Fatalf("defaults = %#v", config)
	}
}

func TestNormalizeAnnouncementConfigValidatesURLsAndCTA(t *testing.T) {
	base := announcementConfigIn{
		Placement: "banner", Layout: "image_top", AllowClose: true,
		Frequency: "daily", Version: 2, DismissHours: 24, CarouselIntervalMS: 4500,
		Assets: []announcementAssetIn{{URL: "https://example.com/notice.webp", Alt: "活动图"}},
	}
	if _, err := normalizeAnnouncementConfig(&base); err != nil {
		t.Fatal(err)
	}
	base.CTAURL = "javascript:alert(1)"
	base.CTAText = "查看详情"
	if _, err := normalizeAnnouncementConfig(&base); err == nil {
		t.Fatal("unsafe CTA URL should be rejected")
	}
}

func TestAnnouncementDictExposesDisplayConfig(t *testing.T) {
	announcement := &store.Announcement{
		ID: uuid.New(), Title: "更新公告", Config: json.RawMessage(`{
			"placement":"banner","layout":"image_top","ctaText":"立即体验",
			"allowClose":true,"frequency":"daily","version":3
		}`),
	}
	dict := announcementDict(announcement)
	if dict["placement"] != "banner" || dict["frequency"] != "daily" || dict["ctaText"] != "立即体验" {
		t.Fatalf("display config = %#v", dict)
	}
	config, ok := dict["config"].(gin.H)
	if !ok || config["layout"] != "image_top" {
		t.Fatalf("nested config = %#v", dict["config"])
	}
}
