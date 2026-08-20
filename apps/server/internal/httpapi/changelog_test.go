package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestChangelogSeedAndLatestRelease(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()

	empty := env.do(t, http.MethodGet, "/api/v1/changelog/latest", nil, "")
	if empty.Code != http.StatusOK {
		t.Fatalf("empty latest: status %d body %s", empty.Code, empty.Body.String())
	}
	emptyData, _ := decode(t, empty)
	if emptyData != nil {
		t.Fatalf("empty latest data = %#v, want null", emptyData)
	}

	inserted, err := store.SeedDefaultChangelogEntries(ctx, env.st)
	if err != nil {
		t.Fatalf("seed changelog: %v", err)
	}
	if inserted != 63 {
		t.Fatalf("inserted changelog = %d, want 63", inserted)
	}
	inserted, err = store.SeedDefaultChangelogEntries(ctx, env.st)
	if err != nil || inserted != 0 {
		t.Fatalf("second seed inserted = %d, err = %v", inserted, err)
	}

	listed := env.do(t, http.MethodGet, "/api/v1/changelog", nil, "")
	if listed.Code != http.StatusOK {
		t.Fatalf("list changelog: status %d body %s", listed.Code, listed.Body.String())
	}
	listData, _ := decode(t, listed)
	items, _ := listData["items"].([]any)
	if len(items) != 63 {
		t.Fatalf("public changelog items = %d, want 63", len(items))
	}

	latest := env.do(t, http.MethodGet, "/api/v1/changelog/latest", nil, "")
	if latest.Code != http.StatusOK {
		t.Fatalf("latest changelog: status %d body %s", latest.Code, latest.Body.String())
	}
	latestData, _ := decode(t, latest)
	if latestData["version"] != "3.2.2" {
		t.Fatalf("seeded latest version = %#v, want 3.2.2", latestData["version"])
	}

	_, adminToken := env.newUserSession(t, "admin")
	created := env.do(t, http.MethodPost, "/api/v1/admin/changelog", map[string]any{
		"version":   "3.3.0",
		"date":      "2026-08-20",
		"tag":       "feature",
		"title":     "画布工作流模板上线",
		"summary":   "后台发版后，打开中的页面会提醒刷新。",
		"items":     []string{"用户端更新日志改由后台发布"},
		"highlight": true,
	}, adminToken)
	if created.Code != http.StatusCreated {
		t.Fatalf("create changelog: status %d body %s", created.Code, created.Body.String())
	}

	nextLatest := env.do(t, http.MethodGet, "/api/v1/changelog/latest", nil, "")
	nextData, _ := decode(t, nextLatest)
	if nextData["version"] != "3.3.0" || nextData["title"] != "画布工作流模板上线" {
		t.Fatalf("published latest = %#v", nextData)
	}

	listed = env.do(t, http.MethodGet, "/api/v1/changelog", nil, "")
	listData, _ = decode(t, listed)
	items, _ = listData["items"].([]any)
	if len(items) != 64 {
		t.Fatalf("changelog after publish = %d, want 64", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["version"] != "3.3.0" || first["highlight"] != true {
		t.Fatalf("newest changelog = %#v", first)
	}
	highlights := 0
	for _, item := range items {
		row, _ := item.(map[string]any)
		if row["highlight"] == true {
			highlights++
		}
	}
	if highlights != 1 {
		t.Fatalf("highlight count = %d, want 1", highlights)
	}
}
