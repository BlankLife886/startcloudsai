// Package assistantprice 存放助手出图的定价校验，供 HTTP 入口和 worker 共用。
//
// 单独成包的唯一目的是不让定价出现第二份实现：Agent 在执行过程中也要创建出图任务，
// 如果那边照抄一遍价格计算，同一张图就会在两个入口算出两个价格，而且以后改价时
// 一定会漏掉一边。宁可多一个包，也不要两份定价。
package assistantprice

import (
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// ImagePrice 是一次出图的定价结果。Total 是本次全部图片的价格，Unit 是单张价格。
type ImagePrice struct {
	Total int64
	Unit  int64
}

// GuardImageModel 计算出图价格，并挡住两种不该放行的配置。
//
// 零价：价格没配好就调用，等于白送上游成本，除非模型明确允许零价。
// 倒挂：售价低于上游成本，每调一次都在亏钱，除非模型明确允许做引流品。
// 这两道闸必须在扣费之前，放过去之后再发现就只能事后补账了。
func GuardImageModel(cfg modelconfig.Config, workspace string, selection *modelconfig.Selection, count int) (ImagePrice, error) {
	if selection == nil {
		return ImagePrice{}, nil
	}
	if count < 1 {
		count = 1
	}
	total := modelconfig.EffectiveWorkspacePrice(cfg, workspace, selection.Model) * int64(count)
	unit := total / int64(count)
	if unit == 0 && !selection.Model.AllowZeroPrice {
		return ImagePrice{}, apperr.E("model_zero_price_blocked", "图片模型价格尚未配置，已阻止零积分调用", 503)
	}
	if unit < selection.Model.UpstreamCostCents && !selection.Model.AllowLossLeader {
		return ImagePrice{}, apperr.E("model_price_inverted", "图片模型价格低于上游成本，已暂停调用，请联系管理员", 503)
	}
	return ImagePrice{Total: total, Unit: unit}, nil
}
