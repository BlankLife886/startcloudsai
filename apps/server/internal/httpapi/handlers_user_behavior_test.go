package httpapi

import (
	"testing"

	"github.com/google/uuid"
)

func TestSanitizeUserBehaviorEventRejectsSensitiveMetadata(t *testing.T) {
	valid := userBehaviorEventIn{
		ClientEventID: uuid.NewString(), EventName: "reference_upload_completed", Feature: "canvas",
		Metadata: map[string]any{"uploadKind": "reference", "itemCount": float64(2)},
	}
	if _, err := sanitizeUserBehaviorEvent(valid); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
	for _, key := range []string{"prompt", "imageUrl", "filename", "content", "pageUrl"} {
		input := valid
		input.Metadata = map[string]any{key: "secret"}
		if _, err := sanitizeUserBehaviorEvent(input); err == nil {
			t.Fatalf("sensitive metadata %q was accepted", key)
		}
	}
}

func TestSanitizeUserBehaviorEventUsesStrictAllowlists(t *testing.T) {
	base := userBehaviorEventIn{ClientEventID: uuid.NewString(), EventName: "feature_open", Feature: "assistant"}
	badEvent := base
	badEvent.EventName = "prompt_copied"
	if _, err := sanitizeUserBehaviorEvent(badEvent); err == nil {
		t.Fatal("unsupported event was accepted")
	}
	badFeature := base
	badFeature.Feature = "admin"
	if _, err := sanitizeUserBehaviorEvent(badFeature); err == nil {
		t.Fatal("unsupported feature was accepted")
	}
}
