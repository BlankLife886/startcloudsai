package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestModelConfigAdapters(t *testing.T) {
	if !modelconfig.ValidAdapter("openai") || !modelconfig.ValidAdapter("crun") {
		t.Fatal("expected OpenAI and CRUN adapters to be valid")
	}
	if modelconfig.ValidAdapter("sub2api") || modelconfig.ValidAdapter("c2a") {
		t.Fatal("legacy service names must not remain provider protocols")
	}
}
