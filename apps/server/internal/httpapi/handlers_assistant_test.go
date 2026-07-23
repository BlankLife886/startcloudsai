package httpapi

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestValidateAssistantMessages(t *testing.T) {
	tests := []struct {
		name     string
		messages []sub2api.Message
		wantErr  bool
	}{
		{name: "valid", messages: []sub2api.Message{{Role: "user", Content: "hello"}}},
		{name: "empty", wantErr: true},
		{name: "invalid role", messages: []sub2api.Message{{Role: "tool", Content: "hello"}}, wantErr: true},
		{name: "empty content", messages: []sub2api.Message{{Role: "user", Content: "  "}}, wantErr: true},
		{name: "message too long", messages: []sub2api.Message{{Role: "user", Content: strings.Repeat("x", maxAssistantMessageRunes+1)}}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateAssistantMessages(tt.messages); (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateAssistantReferenceImages(t *testing.T) {
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	tests := []struct {
		name    string
		images  []string
		wantErr bool
	}{
		{name: "empty"},
		{name: "data url", images: []string{valid}},
		{name: "remote url", images: []string{"https://example.com/image.png"}},
		{name: "too many", images: []string{valid, valid, valid, valid, valid}, wantErr: true},
		{name: "relative url", images: []string{"/image.png"}, wantErr: true},
		{name: "broken data", images: []string{"data:image/png;base64,not-base64"}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateAssistantReferenceImages(tt.images)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestNormalizeAssistantChatReferenceImages(t *testing.T) {
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	messages := []sub2api.Message{
		{Role: "user", Content: "先看图", ReferenceImages: []string{"  " + valid + "  "}},
		{Role: "assistant", Content: "好的"},
		{Role: "user", Content: "继续分析"},
	}
	legacy, err := normalizeAssistantChatReferenceImages(messages, []string{"https://example.com/latest.png"})
	if err != nil {
		t.Fatal(err)
	}
	if len(messages[0].ReferenceImages) != 1 || messages[0].ReferenceImages[0] != valid {
		t.Fatalf("message references = %#v", messages[0].ReferenceImages)
	}
	if len(legacy) != 1 || legacy[0] != "https://example.com/latest.png" {
		t.Fatalf("legacy references = %#v", legacy)
	}
}

func TestNormalizeAssistantChatReferenceImagesRejectsInvalidPlacementAndTotal(t *testing.T) {
	valid := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	tests := []struct {
		name     string
		messages []sub2api.Message
		legacy   []string
	}{
		{
			name: "assistant image",
			messages: []sub2api.Message{
				{Role: "assistant", Content: "answer", ReferenceImages: []string{valid}},
			},
		},
		{
			name: "more than four across messages",
			messages: []sub2api.Message{
				{Role: "user", Content: "first", ReferenceImages: []string{valid, valid}},
				{Role: "user", Content: "second", ReferenceImages: []string{valid, valid}},
			},
			legacy: []string{valid},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeAssistantChatReferenceImages(tt.messages, tt.legacy); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestValidateAssistantImageSize(t *testing.T) {
	tests := []struct {
		name    string
		size    string
		wantErr bool
	}{
		{name: "automatic", size: "auto"},
		{name: "square", size: "1024x1024"},
		{name: "widescreen", size: "1024x576"},
		{name: "portrait", size: "576x1024"},
		{name: "maximum", size: "4096x4096"},
		{name: "invalid format", size: "1024", wantErr: true},
		{name: "too small", size: "255x1024", wantErr: true},
		{name: "too large", size: "4097x1024", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateAssistantImageSize(tt.size); (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
