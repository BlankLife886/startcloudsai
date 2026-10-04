package httpapi

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 客户端请求“整套锚定”时使用的参数名；服务端校验后改写为不可伪造的
// store.SeriesAnchorTaskParam，Worker 只认后者。
const seriesAnchorRequestParam = "seriesAnchorTaskId"

func taskParamIndex(params map[string]any, key string) (int, bool) {
	switch value := params[key].(type) {
	case float64:
		if value != float64(int(value)) {
			return 0, false
		}
		return int(value), true
	case int:
		return value, true
	case int64:
		return int(value), true
	}
	return 0, false
}

func invalidSeriesAnchor() error {
	return apperr.E("validation_error", "seriesAnchorTaskId: 无效的整套参考任务", 422)
}

// resolveSeriesAnchor 校验整套锚定请求：只能引用同一用户、同一批次里第 1 张
// ecommerce_design 任务，且被引用的任务自己不能再锚定别人。
// 同时删除客户端自带的锚定相关参数，避免绕过校验或跳过等待。
func resolveSeriesAnchor(ctx context.Context, q store.Q, userID uuid.UUID, taskType string, params map[string]any) (string, error) {
	raw, requested := params[seriesAnchorRequestParam]
	delete(params, seriesAnchorRequestParam)
	delete(params, store.HandheldAnchorTaskParam)
	delete(params, store.HandheldAnchorResolvedParam)
	if !requested || raw == nil {
		return "", nil
	}
	text, ok := raw.(string)
	if !ok {
		return "", invalidSeriesAnchor()
	}
	anchorID, err := uuid.Parse(strings.TrimSpace(text))
	if err != nil || taskType != "ecommerce_design" {
		return "", invalidSeriesAnchor()
	}
	batchID, _ := params["batchId"].(string)
	batchIndex, hasIndex := taskParamIndex(params, "batchIndex")
	if strings.TrimSpace(batchID) == "" || !hasIndex || batchIndex < 1 {
		return "", invalidSeriesAnchor()
	}
	anchor, err := store.GetTask(ctx, q, anchorID)
	if err != nil {
		return "", err
	}
	if anchor == nil || anchor.UserID != userID || anchor.Type != "ecommerce_design" {
		return "", invalidSeriesAnchor()
	}
	anchorBatch, _ := anchor.Params["batchId"].(string)
	anchorIndex, anchorHasIndex := taskParamIndex(anchor.Params, "batchIndex")
	if anchorBatch != batchID || !anchorHasIndex || anchorIndex != 0 {
		return "", invalidSeriesAnchor()
	}
	if _, chained := anchor.Params[store.SeriesAnchorTaskParam]; chained {
		return "", invalidSeriesAnchor()
	}
	return anchorID.String(), nil
}
