package imageslots

import (
	"context"
	"fmt"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modeltest"
	"github.com/BlankLife886/startcloudsai/server/internal/prompt"
)

const (
	probeTimeout = 6 * time.Minute
	probePrompt  = "一只橘猫坐在窗台上，简洁插画风格"
)

// Probe makes one real low-cost generation on the member at the slot's
// resolution, using runtime (decrypted) configuration. An async acceptance
// counts as healthy: the upstream took the job, which a dead key or an
// exhausted account would not.
func Probe(ctx context.Context, runtime modelconfig.Config, target ProbeTarget, allowPrivate bool) (bool, string) {
	var member *modelconfig.Model
	for index := range runtime.Models {
		if runtime.Models[index].ID == target.ModelID {
			member = &runtime.Models[index]
		}
	}
	if member == nil || !member.Enabled {
		return false, "模型不存在或未启用"
	}
	selection, found := modelconfig.FindExecution(runtime, member.ProviderID, member.ID)
	if !found {
		return false, "服务商未启用或没有可用线路"
	}
	switch selection.Provider.Adapter {
	case modelconfig.AdapterOpenAI, modelconfig.AdapterGemini, modelconfig.AdapterDashScope, modelconfig.AdapterMiniMax:
	default:
		return false, "该服务商类型暂不支持自动检测，恢复后请手动标记为正常"
	}
	// The cheapest quality both the member and the slot's owner offer.
	quality := ""
	for _, candidate := range modelconfig.ImageQualities {
		if contains(member.Qualities, candidate) && (len(target.Qualities) == 0 || contains(target.Qualities, candidate)) {
			quality = candidate
			break
		}
	}
	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	result := modeltest.Image(probeCtx, selection, allowPrivate, modeltest.ImageOptions{
		Prompt: probePrompt, Size: prompt.ImageSizeFor("1:1", target.Resolution), Quality: quality,
	})
	if result.OK() {
		return true, fmt.Sprintf("检测出图成功（%s · %s）", target.Resolution, quality)
	}
	if len(result.Steps) > 0 && result.Steps[0].Pending {
		return true, "上游已受理检测任务（异步出图）"
	}
	detail := "检测未返回结果"
	if len(result.Steps) > 0 && result.Steps[0].Detail != "" {
		detail = result.Steps[0].Detail
	}
	return false, modeltest.Truncate(detail, 300)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
