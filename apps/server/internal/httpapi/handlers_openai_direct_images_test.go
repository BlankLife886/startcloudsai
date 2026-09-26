package httpapi

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

func TestDirectOpenAIImageResponseUsesRequestedDeliveryFormat(t *testing.T) {
	upstream := c2a.StandardImageResponse{Created: 123, Data: []c2a.StandardImageData{
		{B64JSON: "encoded", URL: "https://cdn.example.test/image.png"},
	}}

	b64, err := directOpenAIImageResponse(upstream, "b64_json")
	if err != nil || len(b64.Data) != 1 || b64.Data[0].B64JSON != "encoded" || b64.Data[0].URL != "" {
		t.Fatalf("b64 response=%#v err=%v", b64, err)
	}
	urlResponse, err := directOpenAIImageResponse(upstream, "url")
	if err != nil || len(urlResponse.Data) != 1 || urlResponse.Data[0].URL != "https://cdn.example.test/image.png" || urlResponse.Data[0].B64JSON != "" {
		t.Fatalf("url response=%#v err=%v", urlResponse, err)
	}
}

func TestDirectOpenAIImageResponseRejectsMissingRequestedRepresentation(t *testing.T) {
	if _, err := directOpenAIImageResponse(c2a.StandardImageResponse{Data: []c2a.StandardImageData{{URL: "https://cdn.example.test/image.png"}}}, "b64_json"); err == nil {
		t.Fatal("expected b64_json response mismatch to fail")
	}
	if _, err := directOpenAIImageResponse(c2a.StandardImageResponse{Data: []c2a.StandardImageData{{B64JSON: "encoded"}}}, "url"); err == nil {
		t.Fatal("expected url response mismatch to fail")
	}
}

func TestDirectImageErrorAmbiguityKeepsBillingOpen(t *testing.T) {
	for name, err := range map[string]error{
		"deadline":       context.DeadlineExceeded,
		"network":        &c2a.NetworkError{Message: "connection reset"},
		"upstream 502":   &c2a.UpstreamError{StatusCode: 502},
		"gateway 504":    &c2a.UpstreamError{StatusCode: 504},
		"bad request":    &c2a.UpstreamError{StatusCode: 400},
		"rate limited":   &c2a.UpstreamError{StatusCode: 429},
		"validation 400": apperr.E("invalid_request", "invalid", 400),
	} {
		want := name != "bad request" && name != "rate limited" && name != "validation 400"
		if got := directImageErrorAmbiguous(err); got != want {
			t.Errorf("%s: ambiguous=%t, want %t", name, got, want)
		}
	}
}
