package httpapi

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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

func TestAdminAnnouncementAppearsOnPublicTabNotInbox(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	_, userToken := env.newUserSession(t, "user")

	createdResponse := env.do(t, http.MethodPost, "/api/v1/admin/announcements", gin.H{
		"title": "AI商品图全新升级",
		"body":  "一键出图更高效，详情请查看通知中心。",
	}, adminToken)
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create announcement: status %d body %s", createdResponse.Code, createdResponse.Body.String())
	}
	created, _ := decode(t, createdResponse)
	announcementID, _ := created["id"].(string)
	if announcementID == "" {
		t.Fatalf("created announcement = %#v", created)
	}

	if item := findNotificationByKind(listUserNotifications(t, env, userToken), "announcement"); item != nil {
		t.Fatalf("announcement leaked into inbox: %#v", item)
	}
	public := mustFindPublicAnnouncement(t, env, announcementID)
	if public["title"] != "AI商品图全新升级" {
		t.Fatalf("public announcement = %#v", public)
	}

	patchResponse := env.do(t, http.MethodPatch, "/api/v1/admin/announcements/"+announcementID, gin.H{
		"title": "AI商品图升级完成",
		"body":  "通知中心可查看完整说明。",
	}, adminToken)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("patch announcement: status %d body %s", patchResponse.Code, patchResponse.Body.String())
	}
	updated := mustFindPublicAnnouncement(t, env, announcementID)
	if updated["title"] != "AI商品图升级完成" {
		t.Fatalf("updated public announcement = %#v", updated)
	}

	deleteResponse := env.do(t, http.MethodDelete, "/api/v1/admin/announcements/"+announcementID, nil, adminToken)
	if deleteResponse.Code != http.StatusNoContent && deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete announcement: status %d body %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if leftover := findPublicAnnouncement(listPublicAnnouncements(t, env), announcementID); leftover != nil {
		t.Fatalf("deleted announcement still public: %#v", leftover)
	}
}

func listUserNotifications(t *testing.T, env *communityEnv, userToken string) []any {
	t.Helper()
	response := env.do(t, http.MethodGet, "/api/v1/me/notifications?limit=50", nil, userToken)
	if response.Code != http.StatusOK {
		t.Fatalf("list notifications: status %d body %s", response.Code, response.Body.String())
	}
	data, _ := decode(t, response)
	items, _ := data["items"].([]any)
	return items
}

func listPublicAnnouncements(t *testing.T, env *communityEnv) []any {
	t.Helper()
	response := env.do(t, http.MethodGet, "/api/v1/announcements", nil, "")
	if response.Code != http.StatusOK {
		t.Fatalf("list announcements: status %d body %s", response.Code, response.Body.String())
	}
	data, _ := decode(t, response)
	items, _ := data["items"].([]any)
	return items
}

func findNotificationByKind(items []any, kind string) map[string]any {
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["kind"] == kind {
			return item
		}
	}
	return nil
}

func findPublicAnnouncement(items []any, id string) map[string]any {
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["id"] == id {
			return item
		}
	}
	return nil
}

func mustFindPublicAnnouncement(t *testing.T, env *communityEnv, id string) map[string]any {
	t.Helper()
	item := findPublicAnnouncement(listPublicAnnouncements(t, env), id)
	if item == nil {
		t.Fatalf("missing public announcement %s", id)
	}
	return item
}

func TestAdminUploadAnnouncementImage(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")

	missing := env.do(t, http.MethodPost, "/api/v1/admin/announcements/images", nil, adminToken)
	if missing.Code != http.StatusUnprocessableEntity {
		t.Fatalf("missing file: status %d body %s", missing.Code, missing.Body.String())
	}

	var invalid bytes.Buffer
	invalidWriter := multipart.NewWriter(&invalid)
	part, err := invalidWriter.CreateFormFile("file", "notice.txt")
	if err != nil {
		t.Fatalf("create invalid file: %v", err)
	}
	if _, err := part.Write([]byte("not an image")); err != nil {
		t.Fatalf("write invalid file: %v", err)
	}
	if err := invalidWriter.Close(); err != nil {
		t.Fatalf("close invalid writer: %v", err)
	}
	invalidReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/announcements/images", &invalid)
	invalidReq.Header.Set("Content-Type", invalidWriter.FormDataContentType())
	invalidReq.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: adminToken})
	invalidRes := httptest.NewRecorder()
	env.engine.ServeHTTP(invalidRes, invalidReq)
	if invalidRes.Code != http.StatusBadRequest {
		t.Fatalf("unsupported file: status %d body %s", invalidRes.Code, invalidRes.Body.String())
	}

	if _, err := normalizeAnnouncementConfig(&announcementConfigIn{
		Placement: "modal", Layout: "image_top", AllowClose: true,
		Frequency: "session_once", Version: 1, DismissHours: 24, CarouselIntervalMS: 4500,
		Assets: []announcementAssetIn{{
			URL: "/api/v1/files/announcement-images/notice.webp",
			Alt: "活动图",
		}},
	}); err != nil {
		t.Fatalf("uploaded url rejected: %v", err)
	}
}
