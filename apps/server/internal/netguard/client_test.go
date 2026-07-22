package netguard

import (
	"net/http"
	"testing"
	"time"
)

func TestValidateURLRejectsPrivateAndUnsafeURLs(t *testing.T) {
	for _, raw := range []string{
		"http://127.0.0.1/service",
		"http://[::1]/service",
		"http://169.254.169.254/latest/meta-data",
		"file:///etc/passwd",
		"https://user:password@example.com/",
	} {
		if err := ValidateURL(raw, false, false); err == nil {
			t.Fatalf("ValidateURL(%q) unexpectedly succeeded", raw)
		}
	}
}

func TestHTTPClientRejectsRedirectToPrivateAddress(t *testing.T) {
	client := NewHTTPClient(time.Second, false, false)
	req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1/internal", nil)
	previous, _ := http.NewRequest(http.MethodGet, "https://example.com/start", nil)
	if err := client.CheckRedirect(req, []*http.Request{previous}); err == nil {
		t.Fatal("private redirect unexpectedly allowed")
	}
}

func TestHTTPClientRejectsHTTPSDowngrade(t *testing.T) {
	client := NewHTTPClient(time.Second, true, false)
	req, _ := http.NewRequest(http.MethodGet, "http://example.com/next", nil)
	previous, _ := http.NewRequest(http.MethodGet, "https://example.com/start", nil)
	if err := client.CheckRedirect(req, []*http.Request{previous}); err == nil {
		t.Fatal("HTTPS downgrade unexpectedly allowed")
	}
}
