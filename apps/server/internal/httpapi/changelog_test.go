package httpapi

import (
	"context"
	"encoding/json"
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

func TestAdminChangelogImportExportRoundTrip(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")

	createdResponse := env.do(t, http.MethodPost, "/api/v1/admin/changelog", map[string]any{
		"version": "3.3.0", "date": "2026-08-27", "tag": "feature",
		"title": "画布工作流升级", "summary": "初始摘要",
		"items": []string{"初始条目"}, "highlight": false, "sort": 10,
	}, adminToken)
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create changelog: status %d body %s", createdResponse.Code, createdResponse.Body.String())
	}
	created, _ := decode(t, createdResponse)
	createdID, _ := created["id"].(string)

	exportedResponse := env.do(t, http.MethodGet, "/api/v1/admin/changelog/export", nil, adminToken)
	if exportedResponse.Code != http.StatusOK {
		t.Fatalf("export changelog: status %d body %s", exportedResponse.Code, exportedResponse.Body.String())
	}
	if disposition := exportedResponse.Header().Get("Content-Disposition"); disposition == "" {
		t.Fatal("export missing Content-Disposition")
	}
	var transfer changelogTransferFile
	if err := json.Unmarshal(exportedResponse.Body.Bytes(), &transfer); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if transfer.Format != changelogTransferFormat || transfer.SchemaVersion != 1 || len(transfer.Entries) != 1 {
		t.Fatalf("unexpected export: %#v", transfer)
	}
	transfer.Entries[0].Title = "画布工作流全面升级"
	transfer.Entries[0].Summary = "更新后的摘要"
	transfer.Entries[0].Items = []string{"Agent 意图识别升级", "节点工作流可复用"}
	transfer.Entries = append(transfer.Entries, changelogTransferEntry{
		Version: "3.3.1", Date: "2026-08-28", Tag: "experience", Title: "创作体验优化",
		Summary: "新增导入导出", Items: []string{"更新说明支持 JSON 导入导出"}, Highlight: true, Sort: 20,
	})

	importedResponse := env.do(t, http.MethodPost, "/api/v1/admin/changelog/import", transfer, adminToken)
	if importedResponse.Code != http.StatusOK {
		t.Fatalf("import changelog: status %d body %s", importedResponse.Code, importedResponse.Body.String())
	}
	imported, _ := decode(t, importedResponse)
	if imported["created"] != float64(1) || imported["updated"] != float64(1) || imported["unchanged"] != float64(0) {
		t.Fatalf("import result = %#v", imported)
	}

	listResponse := env.do(t, http.MethodGet, "/api/v1/admin/changelog", nil, adminToken)
	list, _ := decode(t, listResponse)
	items, _ := list["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("changelog count = %d, want 2", len(items))
	}
	highlights, updatedFound := 0, false
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["highlight"] == true {
			highlights++
		}
		if item["id"] == createdID && item["title"] == "画布工作流全面升级" {
			updatedFound = true
		}
	}
	if highlights != 1 || !updatedFound {
		t.Fatalf("imported items = %#v", items)
	}

	exportedResponse = env.do(t, http.MethodGet, "/api/v1/admin/changelog/export", nil, adminToken)
	if err := json.Unmarshal(exportedResponse.Body.Bytes(), &transfer); err != nil {
		t.Fatalf("decode second export: %v", err)
	}
	unchangedResponse := env.do(t, http.MethodPost, "/api/v1/admin/changelog/import", transfer, adminToken)
	unchanged, _ := decode(t, unchangedResponse)
	if unchanged["unchanged"] != float64(2) || unchanged["created"] != float64(0) || unchanged["updated"] != float64(0) {
		t.Fatalf("second import result = %#v", unchanged)
	}

	invalid := changelogTransferFile{Format: changelogTransferFormat, SchemaVersion: 1, Entries: []changelogTransferEntry{
		{Version: "4.0.0", Date: "2026-09-01", Tag: "feature", Title: "焦点一", Highlight: true},
		{Version: "4.0.1", Date: "2026-09-02", Tag: "feature", Title: "焦点二", Highlight: true},
	}}
	invalidResponse := env.do(t, http.MethodPost, "/api/v1/admin/changelog/import", invalid, adminToken)
	if invalidResponse.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid import: status %d body %s", invalidResponse.Code, invalidResponse.Body.String())
	}
	listResponse = env.do(t, http.MethodGet, "/api/v1/admin/changelog", nil, adminToken)
	list, _ = decode(t, listResponse)
	items, _ = list["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("invalid import changed changelog count to %d", len(items))
	}
}
