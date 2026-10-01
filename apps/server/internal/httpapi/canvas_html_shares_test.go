package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

func TestCanvasHTMLSharePublishServeUpdateRevoke(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	page := `<!doctype html><html><head><title>demo</title></head><body><h1>Hello</h1></body></html>`

	if result := env.do(t, http.MethodPost, "/api/v1/canvas/html-shares", map[string]any{"html": page}, ""); result.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous publish: status=%d", result.Code)
	}
	created := env.do(t, http.MethodPost, "/api/v1/canvas/html-shares", map[string]any{"html": page, "title": "demo"}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("publish: status=%d body=%s", created.Code, created.Body.String())
	}
	payload, _ := decode(t, created)
	slug, _ := payload["id"].(string)
	path, _ := payload["path"].(string)
	if slug == "" || path != "/api/v1/public/html-shares/"+slug {
		t.Fatalf("unexpected publish result: %#v", payload)
	}

	served := env.do(t, http.MethodGet, path, nil, "")
	if served.Code != http.StatusOK || !strings.Contains(served.Body.String(), "<h1>Hello</h1>") {
		t.Fatalf("public page: status=%d body=%s", served.Code, served.Body.String())
	}
	csp := served.Header().Get("Content-Security-Policy")
	if !strings.HasPrefix(csp, "sandbox ") || strings.Contains(csp, "allow-same-origin") {
		t.Fatalf("shared page must be sandboxed without same-origin, got %q", csp)
	}
	if served.Header().Get("X-Robots-Tag") == "" || !strings.HasPrefix(served.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("unexpected headers: %#v", served.Header())
	}

	// Another account cannot overwrite the link; its "update" publishes a separate share instead.
	hijack := env.do(t, http.MethodPost, "/api/v1/canvas/html-shares", map[string]any{"html": "<p>other</p>", "shareId": slug}, otherToken)
	hijackPayload, _ := decode(t, hijack)
	if hijack.Code != http.StatusCreated || hijackPayload["id"] == slug {
		t.Fatalf("other account must not update the share: status=%d body=%s", hijack.Code, hijack.Body.String())
	}
	if body := env.do(t, http.MethodGet, path, nil, "").Body.String(); !strings.Contains(body, "<h1>Hello</h1>") {
		t.Fatalf("share content changed by another account: %s", body)
	}

	updated := env.do(t, http.MethodPost, "/api/v1/canvas/html-shares", map[string]any{"html": strings.Replace(page, "Hello", "Updated", 1), "shareId": slug}, token)
	updatedPayload, _ := decode(t, updated)
	if updated.Code != http.StatusOK || updatedPayload["id"] != slug {
		t.Fatalf("owner update: status=%d body=%s", updated.Code, updated.Body.String())
	}
	if body := env.do(t, http.MethodGet, path, nil, "").Body.String(); !strings.Contains(body, "Updated") {
		t.Fatalf("update not served: %s", body)
	}

	if result := env.do(t, http.MethodDelete, "/api/v1/canvas/html-shares/"+slug, nil, otherToken); result.Code != http.StatusNotFound {
		t.Fatalf("other account revoke: status=%d", result.Code)
	}
	if result := env.do(t, http.MethodDelete, "/api/v1/canvas/html-shares/"+slug, nil, token); result.Code != http.StatusNoContent {
		t.Fatalf("owner revoke: status=%d body=%s", result.Code, result.Body.String())
	}
	if result := env.do(t, http.MethodGet, path, nil, ""); result.Code != http.StatusNotFound {
		t.Fatalf("revoked share still served: status=%d", result.Code)
	}
}
