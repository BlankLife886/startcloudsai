package assistanttools

import (
	"testing"

	"github.com/google/uuid"
)

// A follow-up turn may call the set tools without the id: it then means the
// conversation's set. A bad id is still an error.
func TestParseSetIDFallsBackToTheConversationSet(t *testing.T) {
	open := uuid.New()
	turn := CommerceSetContext{OpenSetID: &open}
	if id, err := parseSetID("", turn); err != nil || id != open {
		t.Fatalf("empty id = %v %v", id, err)
	}
	other := uuid.New()
	if id, err := parseSetID(" "+other.String()+" ", turn); err != nil || id != other {
		t.Fatalf("given id = %v %v", id, err)
	}
	if _, err := parseSetID("", CommerceSetContext{}); err == nil {
		t.Fatal("empty id without an open set should fail")
	}
	if _, err := parseSetID("not-an-id", turn); err == nil {
		t.Fatal("bad id should fail")
	}
}
