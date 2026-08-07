package httpapi

import "testing"

func TestParsePromptTransferJSON(t *testing.T) {
	items, err := parsePromptTransferJSON([]byte(`{"schemaVersion":1,"items":[{"title":"海报","prompt":"clean product poster prompt","taskType":"t2i","tags":["poster"]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Title != "海报" || items[0].Tags[0] != "poster" {
		t.Fatalf("unexpected JSON items: %#v", items)
	}
}

func TestParsePromptTransferCSV(t *testing.T) {
	raw := []byte("title,prompt,taskType,category,tags,coverKey\n海报,clean product poster prompt,t2i,design,poster|product,https://example.com/a.jpg\n")
	items, err := parsePromptTransferCSV(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Category != "design" || len(items[0].Tags) != 2 {
		t.Fatalf("unexpected CSV items: %#v", items)
	}
}
