package worker

import (
	"context"
	"log"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
)

// imageVariantConfig 读取三级图编码配置，读取失败回落默认值，
// 绝不因配置问题阻断产物保存。
func (w *Worker) imageVariantConfig(ctx context.Context) settings.ImageVariantConfig {
	cfg, err := settings.ResolveImageVariants(ctx, w.St.Pool)
	if err != nil {
		log.Printf("image variant settings read failed, using defaults: %v", err)
		return settings.ImageVariantConfig{Format: "webp", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
	}
	return cfg
}
