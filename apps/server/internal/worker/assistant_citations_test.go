package worker

import (
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestAssistantCitationNumbersMatchTheSourcesRow(t *testing.T) {
	first := sub2api.WebSearchResult{Sources: []sub2api.WebSearchSource{
		{Title: "A", URL: "https://a.example/1"},
		{Title: "坏链接", URL: "ftp://x"},
		{Title: "A again", URL: "https://a.example/1"},
		{Title: "", URL: "https://b.example/2"},
	}}
	second := sub2api.WebSearchResult{Sources: []sub2api.WebSearchSource{
		{Title: "B", URL: "https://b.example/2"},
		{Title: "C", URL: "https://c.example/3"},
	}}
	index := assistantCitationIndex([]sub2api.WebSearchResult{first, second})
	if len(index) != 3 || index[0].URL != "https://a.example/1" || index[1].Title != "b.example" || index[2].Number != 3 {
		t.Fatalf("unexpected index: %+v", index)
	}
	note := assistantCitationNote([]sub2api.WebSearchResult{first, second}, second)
	if !strings.Contains(note, "[2] b.example — https://b.example/2") || !strings.Contains(note, "[3] C — https://c.example/3") || strings.Contains(note, "\n[1] ") {
		t.Fatalf("note should list the latest search's own numbers: %s", note)
	}
	if assistantCitationNote(nil, sub2api.WebSearchResult{}) != "" {
		t.Fatal("no sources, no note")
	}
}

func TestAssistantCitationIndexStopsAtTwelve(t *testing.T) {
	var sources []sub2api.WebSearchSource
	for i := 0; i < 20; i++ {
		sources = append(sources, sub2api.WebSearchSource{Title: "s", URL: "https://e.example/" + strings.Repeat("x", i+1)})
	}
	if got := len(assistantCitationIndex([]sub2api.WebSearchResult{{Sources: sources}})); got != assistantMaxCitedSources {
		t.Fatalf("got %d sources, want %d", got, assistantMaxCitedSources)
	}
}
