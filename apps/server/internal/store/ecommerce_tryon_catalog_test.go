package store

import (
	"testing"

	"github.com/google/uuid"
)

func TestApplyCatalogOrderedIDsKeepsUnselectedRelativeSlots(t *testing.T) {
	ids := []uuid.UUID{uuid.New(), uuid.New(), uuid.New(), uuid.New()}
	got, err := applyCatalogOrderedIDs(ids, []uuid.UUID{ids[2], ids[0]})
	if err != nil {
		t.Fatal(err)
	}
	want := []uuid.UUID{ids[2], ids[1], ids[0], ids[3]}
	if len(got) != len(want) {
		t.Fatalf("len(got)=%d, want %d", len(got), len(want))
	}
	for index, id := range want {
		if got[index] != id {
			t.Fatalf("slot %d = %s, want %s", index, got[index], id)
		}
	}
}

func TestApplyCatalogOrderedIDsRejectsUnknownID(t *testing.T) {
	ids := []uuid.UUID{uuid.New(), uuid.New()}
	if _, err := applyCatalogOrderedIDs(ids, []uuid.UUID{uuid.New()}); err == nil {
		t.Fatal("expected unknown catalog id to fail")
	}
}

func TestApplyCatalogOrderedIDsRejectsDuplicateID(t *testing.T) {
	id := uuid.New()
	if _, err := applyCatalogOrderedIDs([]uuid.UUID{id}, []uuid.UUID{id, id}); err == nil {
		t.Fatal("expected duplicate catalog id to fail")
	}
}
