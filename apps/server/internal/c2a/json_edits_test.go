package c2a

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONImageEditFormats(t *testing.T) {
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	cases := []struct {
		format, path string
		check        func(body map[string]any) bool
	}{
		{ImageEditJSONImageURL, "/v1/images/edits", func(body map[string]any) bool {
			image, _ := body["image"].(map[string]any)
			return image["type"] == "image_url" && strings.HasPrefix(image["url"].(string), "data:image/png;base64,")
		}},
		{ImageEditJSONGenerations, "/v1/images/generations", func(body map[string]any) bool {
			image, _ := body["image"].(string)
			return strings.HasPrefix(image, "data:image/png;base64,")
		}},
	}
	for _, tc := range cases {
		var path string
		var body map[string]any
		var contentType string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			path, contentType = r.URL.Path, r.Header.Get("Content-Type")
			_ = json.Unmarshal(raw, &body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+png+`"}]}`)
		}))
		client := NewWithPolicy(srv.URL, "k", 30, true).WithStandardImages().WithImageEditFormat(tc.format)
		images, _, _, err := client.SubmitEditImagesTracked(context.Background(), "t", "edit", "m", 1, []string{png}, "1024x1024", ImageOptions{})
		srv.Close()
		if err != nil || len(images) != 1 {
			t.Fatalf("%s: images=%d err=%v", tc.format, len(images), err)
		}
		if path != tc.path || !strings.HasPrefix(contentType, "application/json") || !tc.check(body) || body["prompt"] != "edit" {
			t.Fatalf("%s: %s %s %v", tc.format, path, contentType, body)
		}
	}
}
