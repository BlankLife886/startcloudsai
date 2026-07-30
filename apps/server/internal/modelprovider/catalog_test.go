package modelprovider

import (
	"fmt"
	"strings"
	"testing"
)

func TestModelsEndpointAcceptsOriginAndVersionedBaseURL(t *testing.T) {
	tests := map[string]string{
		"https://gpt.xkyh.cc.cd/v1":  "https://gpt.xkyh.cc.cd/v1/models",
		"https://rsimage.xkyh.cc.cd": "https://rsimage.xkyh.cc.cd/v1/models",
	}
	for input, want := range tests {
		got, err := modelsEndpoint(input)
		if err != nil {
			t.Fatalf("modelsEndpoint(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("modelsEndpoint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCRUNModelsEndpointUsesRealVersionedAPI(t *testing.T) {
	tests := map[string]string{
		"https://api.crun.ai":               "https://api.crun.ai/api/v1/models",
		"https://api.crun.ai/api/v1":        "https://api.crun.ai/api/v1/models",
		"https://api.crun.ai/api/v1/models": "https://api.crun.ai/api/v1/models",
	}
	for input, want := range tests {
		got, err := crunModelsEndpoint(input)
		if err != nil {
			t.Fatalf("crunModelsEndpoint(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("crunModelsEndpoint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestParseCRUNTaskModelRegistry(t *testing.T) {
	var source strings.Builder
	source.WriteString(`prefix Registry={`)
	source.WriteString(`nano_banana:"google/nano-banana"`)
	for index := 1; index < 55; index++ {
		source.WriteString(fmt.Sprintf(`,model_%d:"provider/model-%d"`, index, index))
	}
	source.WriteString(`},suffix={ignored:"not-a-model"}`)

	models, err := parseCRUNTaskModelRegistry(source.String())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 55 {
		t.Fatalf("models count = %d, want 55", len(models))
	}
	if models[0] != "google/nano-banana" || models[len(models)-1] != "provider/model-9" {
		t.Fatalf("unexpected sorted models: first=%q last=%q", models[0], models[len(models)-1])
	}
}
