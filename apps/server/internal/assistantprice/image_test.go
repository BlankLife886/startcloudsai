package assistantprice

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func selectionAt(priceCents, upstreamCents int64, allowZero, allowLossLeader bool) *modelconfig.Selection {
	return &modelconfig.Selection{Model: modelconfig.Model{
		ID:                "model-test",
		PriceCents:        priceCents,
		UpstreamCostCents: upstreamCents,
		AllowZeroPrice:    allowZero,
		AllowLossLeader:   allowLossLeader,
	}}
}

// 价格要按张数乘，别算成一张的钱就放行——这会让批量出图收一张的价。
func TestGuardImageModelChargesEveryImage(t *testing.T) {
	price, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, selectionAt(30, 10, false, false), 3)
	if err != nil {
		t.Fatalf("正常定价不该报错：%v", err)
	}
	if price.Total != 90 || price.Unit != 30 {
		t.Errorf("三张图应为总价 90、单价 30，得到总价 %d、单价 %d", price.Total, price.Unit)
	}

	// count 缺省或非法时按一张算，不能除零。
	single, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, selectionAt(30, 10, false, false), 0)
	if err != nil {
		t.Fatalf("张数缺省时不该报错：%v", err)
	}
	if single.Total != 30 || single.Unit != 30 {
		t.Errorf("张数缺省应按一张算，得到总价 %d、单价 %d", single.Total, single.Unit)
	}
}

// 这两道闸挡的是钱：价格没配好就调用等于白送上游成本，售价低于成本则每次调用都在亏。
func TestGuardImageModelBlocksZeroPriceAndInvertedPrice(t *testing.T) {
	if _, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, selectionAt(0, 10, false, false), 1); err == nil {
		t.Error("价格未配置时必须拦住")
	}
	if _, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, selectionAt(5, 10, false, false), 1); err == nil {
		t.Error("售价低于上游成本时必须拦住")
	}

	// 明确允许的例外要放行，否则免费模型和引流品就没法上线了。
	if _, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, selectionAt(0, 0, true, false), 1); err != nil {
		t.Errorf("模型允许零价时应放行：%v", err)
	}
	if _, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, selectionAt(5, 10, false, true), 1); err != nil {
		t.Errorf("模型允许做引流品时应放行：%v", err)
	}
}

// 没有选中图片模型时不该凭空造出价格，也不该报错——调用方据此判断“这一轮不出图”。
func TestGuardImageModelIgnoresMissingSelection(t *testing.T) {
	price, err := GuardImageModel(modelconfig.Config{}, modelconfig.WorkspaceAssistant, nil, 3)
	if err != nil || price.Total != 0 || price.Unit != 0 {
		t.Errorf("未选图片模型时应返回零价且无错误，得到 %+v err=%v", price, err)
	}
}
