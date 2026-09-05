package httpapi

import "testing"

func TestRequestBodyLimitAllowsPromptCoverMultipart(t *testing.T) {
	tests := []struct {
		path string
		want int64
	}{
		{path: "/api/v1/admin/prompts/4be6463a-e469-4db5-82ff-bfd3e9071f85/cover", want: promptCoverMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/canvas-workflow-templates/4be6463a-e469-4db5-82ff-bfd3e9071f85/cover", want: promptCoverMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/canvas-workflow-templates/analyze", want: 2 << 20},
		{path: "/api/v1/admin/canvas-workflow-templates", want: canvasTemplatePackageMaxBytes + (2 << 20)},
		{path: "/api/v1/admin/prompt-import-batches/355dea02-8dd3-4554-8092-f63e4645fc57/items/4be6463a-e469-4db5-82ff-bfd3e9071f85/cover", want: promptCoverMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/prompts/order", want: 1 << 20},
		{path: "/api/v1/admin/prompts", want: 1 << 20},
		{path: "/api/v1/admin/prompt-import-batches/upload", want: promptTransferMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/announcements/images", want: promptCoverMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/ecommerce/tryon-catalog", want: tryonCatalogMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/ecommerce/tryon-catalog/4be6463a-e469-4db5-82ff-bfd3e9071f85/image", want: tryonCatalogMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/ecommerce/catalog", want: tryonCatalogMaxBytes + (1 << 20)},
		{path: "/api/v1/admin/ecommerce/catalog/4be6463a-e469-4db5-82ff-bfd3e9071f85/image", want: tryonCatalogMaxBytes + (1 << 20)},
	}
	for _, test := range tests {
		if got := requestBodyLimit(test.path, 15<<20); got != test.want {
			t.Fatalf("requestBodyLimit(%q) = %d, want %d", test.path, got, test.want)
		}
	}
}
