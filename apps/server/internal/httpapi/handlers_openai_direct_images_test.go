package httpapi

import (
	"testing"

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

func TestDirectOpenAIImageResponsePassesOnWhatUpstreamReturned(t *testing.T) {
	onlyURL := c2a.StandardImageResponse{Data: []c2a.StandardImageData{{URL: "https://cdn.example.test/image.png"}}}
	result, err := directOpenAIImageResponse(onlyURL, "b64_json")
	if err != nil || len(result.Data) != 1 || result.Data[0].URL != "https://cdn.example.test/image.png" || result.Data[0].B64JSON != "" {
		t.Fatalf("url-only upstream for b64_json request: %#v err=%v", result, err)
	}
	onlyB64 := c2a.StandardImageResponse{Data: []c2a.StandardImageData{{B64JSON: "encoded"}}}
	result, err = directOpenAIImageResponse(onlyB64, "url")
	if err != nil || len(result.Data) != 1 || result.Data[0].B64JSON != "encoded" || result.Data[0].URL != "" {
		t.Fatalf("b64-only upstream for url request: %#v err=%v", result, err)
	}
	if _, err := directOpenAIImageResponse(c2a.StandardImageResponse{}, "b64_json"); err == nil {
		t.Fatal("expected an empty upstream result to fail")
	}
}
