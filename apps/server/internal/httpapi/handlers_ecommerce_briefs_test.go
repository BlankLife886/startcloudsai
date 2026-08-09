package httpapi

import "testing"

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
