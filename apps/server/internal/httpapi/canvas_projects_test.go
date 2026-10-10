package httpapi

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCanvasProjectCRUDRevisionAndOwnership(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")

	w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
		"title":    "第一张画布",
		"document": map[string]any{"version": 1, "nodes": []any{}, "edges": []any{}},
	}, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: status %d body %s", w.Code, w.Body.String())
	}
	created, _ := decode(t, w)
	id := created["id"].(string)
	if created["revision"] != float64(1) {
		t.Fatalf("created revision = %v", created["revision"])
	}

	w = env.do(t, http.MethodGet, "/api/v1/canvas-projects", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("list: status %d body %s", w.Code, w.Body.String())
	}
	listed, _ := decode(t, w)
	if len(listed["items"].([]any)) != 1 {
		t.Fatalf("list items = %#v", listed["items"])
	}

	w = env.do(t, http.MethodGet, "/api/v1/canvas-projects/"+id, nil, otherToken)
	if w.Code != http.StatusNotFound {
		t.Fatalf("other user read: status %d body %s", w.Code, w.Body.String())
	}

	w = env.do(t, http.MethodPatch, "/api/v1/canvas-projects/"+id, map[string]any{
		"title": "已更新画布", "revision": 1,
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("patch: status %d body %s", w.Code, w.Body.String())
	}
	updated, _ := decode(t, w)
	if updated["title"] != "已更新画布" || updated["revision"] != float64(2) {
		t.Fatalf("updated = %#v", updated)
	}

	w = env.do(t, http.MethodPatch, "/api/v1/canvas-projects/"+id, map[string]any{
		"title": "过期更新", "revision": 1,
	}, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "revision_conflict" {
		t.Fatalf("stale patch: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	w = env.do(t, http.MethodDelete, "/api/v1/canvas-projects/"+id, nil, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: status %d body %s", w.Code, w.Body.String())
	}
}

func TestCanvasProjectAcceptsReactDocumentAndClientID(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	id := uuid.NewString()
	document := map[string]any{
		"version": 3, "nodes": []any{}, "connections": []any{},
		"viewport": map[string]any{"x": 0, "y": 0, "k": 1},
	}

	w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
		"id": id, "title": "React 画布", "document": document,
	}, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("create react document: status %d body %s", w.Code, w.Body.String())
	}
	created, _ := decode(t, w)
	if created["id"] != id {
		t.Fatalf("created id = %v, want %s", created["id"], id)
	}

	// A client may retry after the first response is lost. Reusing its UUID must
	// update the same project instead of returning an opaque database error.
	w = env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
		"id": id, "title": "React 画布重试", "document": document,
	}, token)
	retried, _ := decode(t, w)
	if w.Code != http.StatusCreated || retried["title"] != "React 画布重试" || retried["revision"] != float64(2) {
		t.Fatalf("retry create: status %d body %s", w.Code, w.Body.String())
	}

	w = env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
		"id": id, "title": "越权冲突", "document": document,
	}, otherToken)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "id_conflict" {
		t.Fatalf("other user id conflict: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestCanvasProjectRejectsMalformedDocument(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")

	for _, document := range []map[string]any{
		{"version": 4, "nodes": []any{}, "edges": []any{}},
		{"version": 3, "nodes": []any{}, "edges": []any{}},
		{"version": 1, "nodes": "invalid", "edges": []any{}},
		{"version": 1, "nodes": []any{}, "edges": "invalid"},
		{"version": 1, "nodes": []any{}, "edges": []any{}, "viewport": "invalid"},
	} {
		w := env.do(t, http.MethodPost, "/api/v1/canvas-projects", map[string]any{
			"title": "损坏文档", "document": document,
		}, token)
		if _, code := decode(t, w); w.Code != http.StatusUnprocessableEntity || code != "validation_error" {
			t.Fatalf("document %#v: status %d code %s body %s", document, w.Code, code, w.Body.String())
		}
	}
}
