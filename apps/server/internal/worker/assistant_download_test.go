package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestAssistantImageTypeRejectsUnknownData(t *testing.T) {
	if contentType, ext := assistantImageType([]byte("not an image")); contentType != "" || ext != "" {
		t.Fatalf("unknown data detected as contentType=%q ext=%q", contentType, ext)
	}
}

func TestDownloadAssistantImageValidatesDataURL(t *testing.T) {
	invalid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not an image"))
	if _, _, _, err := downloadAssistantImage(context.Background(), invalid); err == nil {
		t.Fatal("invalid data URL unexpectedly accepted")
	}

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 4, 3))); err != nil {
		t.Fatal(err)
	}
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	data, contentType, ext, err := downloadAssistantImage(context.Background(), valid)
	if err != nil {
		t.Fatalf("valid data URL rejected: %v", err)
	}
	if len(data) != encoded.Len() || contentType != "image/png" || ext != "png" {
		t.Fatalf("got data=%d contentType=%q ext=%q", len(data), contentType, ext)
	}
}

func TestDownloadAssistantImageRejectsUnsafeURL(t *testing.T) {
	for _, source := range []string{
		"http://127.0.0.1/internal",
		"http://[::1]/internal",
		"http://169.254.169.254/latest/meta-data",
		"file:///etc/passwd",
	} {
		if _, _, _, err := downloadAssistantImage(context.Background(), source); err == nil {
			t.Fatalf("unsafe URL %q unexpectedly accepted", source)
		}
	}
}

func TestLoadAssistantReferencesValidatesDataURLs(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 4, 3))); err != nil {
		t.Fatal(err)
	}
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	w := &Worker{}
	refs, err := w.loadAssistantReferences(context.Background(), map[string]any{
		"referenceImages": []any{map[string]any{"dataUrl": valid}},
	})
	if err != nil {
		t.Fatalf("valid data URL rejected: %v", err)
	}
	if len(refs) != 1 || refs[0] != valid {
		t.Fatalf("normalized references = %#v, want original valid data URL", refs)
	}

	invalid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not an image"))
	if _, err := w.loadAssistantReferences(context.Background(), map[string]any{
		"referenceImages": []any{map[string]any{"dataUrl": invalid}},
	}); err == nil {
		t.Fatal("invalid data URL unexpectedly accepted")
	}
}

func TestSanitizeUpstreamMessageBoundsExternalText(t *testing.T) {
	got := sanitizeUpstreamMessage(strings.Repeat("x", maxUpstreamMessageRunes+500))
	if len([]rune(got)) != maxUpstreamMessageRunes {
		t.Fatalf("sanitized message length = %d, want %d", len([]rune(got)), maxUpstreamMessageRunes)
	}
}

func TestSanitizeUpstreamMessageHidesInvalidatedToken(t *testing.T) {
	got := sanitizeUpstreamMessage(`chat_requirements_prepare failed: status=401, body={"error":{"code":"token_invalidated"}}`)
	if strings.Contains(got, "chat_requirements_prepare") || strings.Contains(got, "token_invalidated") {
		t.Fatalf("raw upstream leaked: %q", got)
	}
	if !strings.Contains(got, "认证失效") {
		t.Fatalf("got %q", got)
	}
}

func TestPendingImagePollFailureUsesSanitizedUpstreamReason(t *testing.T) {
	code, message := pendingImagePollFailure("text_review", "内容审核拒绝：参考图不符合服务政策 https://internal.example/review/123")
	if code != "upstream_error" {
		t.Fatalf("code = %q, want upstream_error", code)
	}
	if strings.Contains(message, "http") || message != "内容审核拒绝：参考图不符合服务政策" {
		t.Fatalf("message = %q", message)
	}
}

func TestPendingImagePollFailureExplainsMissingUpstreamReason(t *testing.T) {
	code, message := pendingImagePollFailure("text_review", "")
	if code != "upstream_error" || !strings.Contains(message, "未返回具体失败原因") {
		t.Fatalf("code=%q message=%q", code, message)
	}
}
