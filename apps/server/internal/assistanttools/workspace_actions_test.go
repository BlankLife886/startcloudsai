package assistanttools

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestWorkspaceActionManifestRegistersAllTools(t *testing.T) {
	registry, err := NewRegistry(NewWorkspaceActionManifest())
	if err != nil {
		t.Fatal(err)
	}
	definitions, err := registry.Definitions(WorkspaceToolNames())
	if err != nil {
		t.Fatal(err)
	}
	if len(definitions) != 8 {
		t.Fatalf("tool definitions = %d, want 8", len(definitions))
	}
	for _, name := range WorkspaceToolNames() {
		if !registry.Has(name) {
			t.Fatalf("missing tool %s", name)
		}
	}
}

func TestMediaActionCreatesConfirmationCard(t *testing.T) {
	registry, err := NewRegistry(NewWorkspaceActionManifest())
	if err != nil {
		t.Fatal(err)
	}
	arguments, _ := json.Marshal(map[string]any{
		"operation": "upscale", "referenced_image_ids": []string{"image-1"}, "instruction": "放大到 4K",
	})
	result, err := registry.Execute(context.Background(), ToolMediaAction, Invocation{
		RunID: uuid.New(), Arguments: arguments,
		Permissions: map[Permission]bool{PermissionActionsCreate: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	actions := assistantToolActionsForTest(result.Meta["toolActions"])
	if len(actions) != 1 || actions[0]["requiresConfirmation"] != true || !strings.HasPrefix(actions[0]["route"].(string), "/canvas") {
		t.Fatalf("unexpected action: %#v", actions)
	}
}

func TestExternalToolsRejectPrivateURLs(t *testing.T) {
	registry, err := NewRegistry(NewWorkspaceActionManifest())
	if err != nil {
		t.Fatal(err)
	}
	arguments := json.RawMessage(`{"url":"http://127.0.0.1/private","width":1200,"full_page":false}`)
	_, err = registry.Execute(context.Background(), ToolWebpageCapture, Invocation{
		RunID: uuid.New(), Arguments: arguments,
		Permissions: map[Permission]bool{PermissionWebRead: true},
	})
	if err == nil || !strings.Contains(err.Error(), "公开访问") {
		t.Fatalf("private URL error = %v", err)
	}
}

func TestExtractProductPagePrefersOpenGraph(t *testing.T) {
	html := []byte(`<html><head><title>Fallback title</title>
		<meta property="og:title" content="便携榨汁杯">
		<meta property="og:description" content="无线便携，容量 500ml">
		<meta property="og:image" content="/images/product.jpg">
		<meta property="product:price:amount" content="199.00">
	</head></html>`)
	product := extractProductPage(html, "https://shop.example/item/1")
	if product.Title != "便携榨汁杯" || product.Image != "https://shop.example/images/product.jpg" || product.Price != "199.00" {
		t.Fatalf("unexpected product: %#v", product)
	}
}

func TestWorkspaceExternalToolsLive(t *testing.T) {
	if os.Getenv("RUN_LIVE_ASSISTANT_TOOLS") != "1" {
		t.Skip("set RUN_LIVE_ASSISTANT_TOOLS=1 to call public services")
	}
	registry, err := NewRegistry(NewWorkspaceActionManifest())
	if err != nil {
		t.Fatal(err)
	}
	base := Invocation{RunID: uuid.New(), Permissions: map[Permission]bool{
		PermissionWebRead: true, PermissionActionsCreate: true,
	}}

	base.Arguments = json.RawMessage(`{"query":"Mount Fuji Japan","limit":2}`)
	search, err := registry.Execute(context.Background(), ToolImageSearch, base)
	if err != nil || !strings.Contains(search.Content, "imageUrl") {
		t.Fatalf("live image search failed: result=%s err=%v", search.Content, err)
	}

	base.Arguments = json.RawMessage(`{"url":"https://example.com/","width":1200,"full_page":false}`)
	capture, err := registry.Execute(context.Background(), ToolWebpageCapture, base)
	if err != nil || !strings.Contains(capture.Content, "wordpress.com") {
		t.Fatalf("live webpage capture failed: result=%s err=%v", capture.Content, err)
	}

	base.Arguments = json.RawMessage(`{"url":"https://example.com/"}`)
	product, err := registry.Execute(context.Background(), ToolProductImport, base)
	if err != nil || !strings.Contains(product.Content, "Example Domain") {
		t.Fatalf("live product import failed: result=%s err=%v", product.Content, err)
	}
}

func assistantToolActionsForTest(value any) []map[string]any {
	actions, _ := value.([]map[string]any)
	return actions
}
