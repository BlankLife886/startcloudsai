package httpapi

import (
	"context"
	"encoding/json"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestHomeBannerValidation(t *testing.T) {
	for _, value := range []string{"javascript:alert(1)", "//evil.test", "/\\evil.test", "https://user:pass@example.com/x", "/x\nfoo", "data:image/png;base64,xxx", ""} {
		if validHomeBannerURL(value) {
			t.Errorf("accepted unsafe URL %q", value)
		}
	}
	for _, value := range []string{"/sucai/test.webp", "/text-to-image?mode=new", "https://example.com/banner.webp"} {
		if !validHomeBannerURL(value) {
			t.Errorf("rejected URL %q", value)
		}
	}
	base := func() store.HomeBanner {
		return store.HomeBanner{Title: "轮播", ImageURL: "/sucai/image.webp", DurationMS: 5000}
	}
	for _, change := range []func(*store.HomeBanner){
		func(b *store.HomeBanner) { b.Title = strings.Repeat("字", 61) }, func(b *store.HomeBanner) { b.DurationMS = 1 },
		func(b *store.HomeBanner) { b.SortOrder = -1 }, func(b *store.HomeBanner) { b.ButtonText = strings.Repeat("字", 21) },
		func(b *store.HomeBanner) { now := time.Now(); b.StartsAt = &now; b.EndsAt = &now },
	} {
		b := base()
		change(&b)
		if validateHomeBanner(&b) == nil {
			t.Errorf("accepted invalid banner %+v", b)
		}
	}
	b := base()
	if err := validateHomeBanner(&b); err != nil {
		t.Fatal(err)
	}
	for _, title := range []string{"", " \t\n\u3000", strings.Repeat("字", 60)} {
		b := base()
		b.Title, b.LinkURL, b.ButtonText = title, " \t", " 查看详情 "
		if err := validateHomeBanner(&b); err != nil {
			t.Fatalf("optional title/link rejected: %v", err)
		}
		if b.Title != strings.TrimSpace(title) || b.LinkURL != "" || b.ButtonText != "查看详情" {
			t.Fatalf("optional fields were not preserved/trimmed: %+v", b)
		}
	}
}

func TestHomeBannerOptionalTitleAndLinkRoundTrip(t *testing.T) {
	st := testdb.Setup(t)
	s := &Server{St: st, Cfg: config.Load()}
	r := gin.New()
	r.POST("/banners", func(c *gin.Context) { s.adminSaveHomeBanner(c, nil) })
	r.PUT("/banners/:id", func(c *gin.Context) { s.adminSaveHomeBanner(c, nil) })
	r.GET("/banners", s.homeBanners)
	r.GET("/admin/banners", func(c *gin.Context) { s.adminHomeBanners(c, nil) })
	input := store.HomeBanner{
		Title: " \t\n\u3000", ImageURL: "/api/v1/files/announcement-images/home-banners/original.png",
		LinkURL: " \t", ButtonText: " 查看详情 ", Active: true, DurationMS: 5000,
	}
	created := authRequest(t, r, http.MethodPost, "/banners", input)
	if created.Code != http.StatusCreated {
		t.Fatalf("create without title/link status=%d body=%s", created.Code, created.Body.String())
	}
	var saved struct {
		Data store.HomeBanner `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Data.Title != "" || saved.Data.LinkURL != "" || saved.Data.ButtonText != "查看详情" {
		t.Fatalf("create response did not preserve optional fields: %+v", saved.Data)
	}
	path := "/banners/" + saved.Data.ID.String()
	for _, update := range []struct{ Title, Link string }{
		{Title: "活动介绍", Link: "/studio"},
		{Title: " \n\u3000", Link: " \t"},
	} {
		saved.Data.Title, saved.Data.LinkURL = update.Title, update.Link
		response := authRequest(t, r, http.MethodPut, path, saved.Data)
		if response.Code != http.StatusOK {
			t.Fatalf("update optional fields status=%d body=%s", response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil {
			t.Fatal(err)
		}
		if saved.Data.Title != strings.TrimSpace(update.Title) || saved.Data.LinkURL != strings.TrimSpace(update.Link) || saved.Data.ButtonText != "查看详情" {
			t.Fatalf("update response changed optional fields: %+v", saved.Data)
		}
	}
	for _, method := range []string{http.MethodPost, http.MethodPut} {
		for _, invalid := range []struct{ Title, Link string }{
			{Title: strings.Repeat("字", 61)},
			{Link: "javascript:alert(1)"},
			{Link: "//evil.test"},
		} {
			body := saved.Data
			body.Title, body.LinkURL = invalid.Title, invalid.Link
			target := path
			if method == http.MethodPost {
				target = "/banners"
			}
			response := authRequest(t, r, method, target, body)
			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("invalid banner accepted: method=%s status=%d body=%s", method, response.Code, response.Body.String())
			}
		}
	}
	for _, endpoint := range []string{"/banners", "/admin/banners"} {
		response := authRequest(t, r, http.MethodGet, endpoint, nil)
		var listed struct {
			Data struct {
				Items []store.HomeBanner `json:"items"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || len(listed.Data.Items) != 1 {
			t.Fatalf("read optional banner: status=%d body=%s", response.Code, response.Body.String())
		}
		item := listed.Data.Items[0]
		if item.Title != "" || item.LinkURL != "" || item.ButtonText != "查看详情" {
			t.Fatalf("read lost optional fields: %+v", item)
		}
	}
}

func TestHomeBannerCRUDAndSchedule(t *testing.T) {
	st := testdb.Setup(t)
	s := &Server{St: st, Cfg: config.Load()}
	r := gin.New()
	r.POST("/banners", func(c *gin.Context) { s.adminSaveHomeBanner(c, nil) })
	r.PUT("/banners/:id", func(c *gin.Context) { s.adminSaveHomeBanner(c, nil) })
	r.DELETE("/banners/:id", func(c *gin.Context) { s.adminDeleteHomeBanner(c, nil) })
	r.GET("/banners", s.homeBanners)
	create := func(title string, active bool, sort int, start, end *time.Time) store.HomeBanner {
		t.Helper()
		result := authRequest(t, r, "POST", "/banners", store.HomeBanner{Title: title, ImageURL: "/sucai/banner.webp", Active: active, SortOrder: sort, DurationMS: 5000, StartsAt: start, EndsAt: end})
		if result.Code != 201 {
			t.Fatalf("create: %s", result.Body.String())
		}
		var payload struct {
			Data store.HomeBanner `json:"data"`
		}
		if err := json.Unmarshal(result.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Data
	}
	later := time.Now().Add(time.Hour)
	earlier := time.Now().Add(-time.Hour)
	first := create("second", true, 20, nil, nil)
	create("first", true, 10, nil, nil)
	create("disabled", false, 0, nil, nil)
	create("future", true, 0, &later, nil)
	create("expired", true, 0, nil, &earlier)
	response := authRequest(t, r, "GET", "/banners", nil)
	var payload struct {
		Data struct {
			Items []store.HomeBanner `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || len(payload.Data.Items) != 2 || payload.Data.Items[0].Title != "first" {
		t.Fatalf("public schedule/order: %s", response.Body.String())
	}
	all, err := store.ListHomeBanners(context.Background(), st.Pool, false)
	if err != nil || len(all) != 5 {
		t.Fatalf("admin list: %v %v", all, err)
	}
	first.Title = "edited"
	first.Active = false
	if result := authRequest(t, r, "PUT", "/banners/"+first.ID.String(), first); result.Code != 200 {
		t.Fatalf("update: %s", result.Body.String())
	}
	for _, want := range []int{204, 404} {
		result := authRequest(t, r, "DELETE", "/banners/"+first.ID.String(), nil)
		if result.Code != want {
			t.Fatalf("delete: %d want %d", result.Code, want)
		}
	}
	if result := authRequest(t, r, "PUT", "/banners/"+first.ID.String(), first); result.Code != 404 {
		t.Fatal("missing update must return 404")
	}
	router := s.Router()
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
		path := "/api/v1/admin/home-banners"
		if method == "PUT" || method == "DELETE" {
			path += "/" + first.ID.String()
		}
		result := authRequest(t, router, method, path, nil)
		if result.Code != 401 && result.Code != 403 {
			t.Fatalf("unprotected %s: %d", method, result.Code)
		}
	}
}
