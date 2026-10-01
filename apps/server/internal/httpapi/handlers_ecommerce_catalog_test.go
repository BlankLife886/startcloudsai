package httpapi

import "testing"

func TestParseTryonCatalogKindSupportsSharedCatalogKinds(t *testing.T) {
	for _, kind := range []string{"model", "scene", "garment", "hand"} {
		got, err := parseTryonCatalogKind(kind, true)
		if err != nil {
			t.Fatalf("parseTryonCatalogKind(%q) returned error: %v", kind, err)
		}
		if got != kind {
			t.Fatalf("parseTryonCatalogKind(%q) = %q", kind, got)
		}
	}
}

func TestParseTryonCatalogKindRejectsUnknownKind(t *testing.T) {
	if _, err := parseTryonCatalogKind("virtual-tryon-only", true); err == nil {
		t.Fatal("parseTryonCatalogKind accepted an unknown kind")
	}
}
