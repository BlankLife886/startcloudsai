package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestDecodeEcommerceProductBrief(t *testing.T) {
	brief, err := decodeEcommerceProductBrief("```json\n{\"productName\":\"蓝牙耳机\",\"sellingPoints\":\"轻巧便携\\n舒适佩戴\"}\n```")
	if err != nil {
		t.Fatalf("decode brief: %v", err)
	}
	if brief.ProductName != "蓝牙耳机" || brief.SellingPoints != "轻巧便携\n舒适佩戴" {
		t.Fatalf("unexpected brief: %#v", brief)
	}
}

func TestDecodeEcommerceProductBriefRejectsEmptyFields(t *testing.T) {
	if _, err := decodeEcommerceProductBrief(`{"productName":"","sellingPoints":"卖点"}`); err == nil {
		t.Fatal("expected empty product name to fail")
	}
}

func TestDecodeEcommerceCatalogTitle(t *testing.T) {
	result, err := decodeEcommerceCatalogTitle("```json\n{\"title\":\"  白色针织上衣  \"}\n```")
	if err != nil {
		t.Fatalf("decode catalog title: %v", err)
	}
	if result.Title != "白色针织上衣" {
		t.Fatalf("unexpected title: %q", result.Title)
	}
}

func TestDecodeEcommerceCatalogTitleRejectsEmptyTitle(t *testing.T) {
	if _, err := decodeEcommerceCatalogTitle(`{"title":""}`); err == nil {
		t.Fatal("expected empty title to fail")
	}
}

func TestSelectEcommerceAnalysisModelUsesWorkspaceDefault(t *testing.T) {
	cfg := modelconfig.Config{
		Providers: []modelconfig.Provider{{
			ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
			BaseURL: "https://example.com", APIKey: "secret", Enabled: true,
		}},
		Models: []modelconfig.Model{
			{ID: "assistant-chat", Name: "助手模型", ProviderID: "provider", UpstreamModel: "assistant-upstream", Kind: modelconfig.ModelKindChat, Public: true, Enabled: true},
			{ID: "commerce-chat-a", Name: "商品分析 A", ProviderID: "provider", UpstreamModel: "commerce-upstream-a", Kind: modelconfig.ModelKindChat, Public: true, Enabled: true},
			{ID: "commerce-chat-b", Name: "商品分析 B", ProviderID: "provider", UpstreamModel: "commerce-upstream-b", Kind: modelconfig.ModelKindChat, Public: true, Enabled: true},
		},
		Workspaces: map[string]modelconfig.WorkspaceBinding{
			modelconfig.WorkspaceAssistant: {ModelIDs: []string{"assistant-chat"}},
			modelconfig.WorkspaceEcommerce: {
				ModelIDs:        []string{"commerce-chat-a", "commerce-chat-b"},
				DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "commerce-chat-b"},
			},
		},
	}
	selection, ok := selectEcommerceAnalysisModel(cfg)
	if !ok || selection.Model.ID != "commerce-chat-b" || selection.Model.UpstreamModel != "commerce-upstream-b" {
		t.Fatalf("ecommerce analysis selection = %#v", selection)
	}
}

func TestSelectAdminImageAnalysisModelUsesAdminSettingAndReasoning(t *testing.T) {
	cfg := modelconfig.Config{
		Providers: []modelconfig.Provider{{
			ID: "provider", Name: "Provider", Adapter: modelconfig.AdapterOpenAI,
			BaseURL: "https://example.com", APIKey: "secret", Enabled: true,
		}},
		Models: []modelconfig.Model{{
			ID: "catalog-title", Name: "素材标题", ProviderID: "provider",
			UpstreamModel: "vision-model", Kind: modelconfig.ModelKindChat,
			Public: false, Enabled: true,
			SupportedReasoningEfforts: []string{"medium", "high"},
			ReasoningPricing:          &modelconfig.ReasoningPricing{DefaultEffort: "high"},
		}},
	}
	if _, _, ok := selectAdminImageAnalysisModel(cfg, "", "", ""); ok {
		t.Fatal("empty admin setting must not select a model")
	}
	if _, _, ok := selectAdminImageAnalysisModel(cfg, "other-provider", "catalog-title", "high"); ok {
		t.Fatal("mismatched provider must not select a model")
	}
	selection, effort, ok := selectAdminImageAnalysisModel(cfg, "provider", "catalog-title", "")
	if !ok || selection.Model.ID != "catalog-title" || selection.Provider.ID != "provider" || effort != "high" {
		t.Fatalf("catalog analysis selection = %#v", selection)
	}
	if _, _, ok := selectAdminImageAnalysisModel(cfg, "provider", "catalog-title", "max"); ok {
		t.Fatal("unsupported reasoning effort must be rejected")
	}
}
