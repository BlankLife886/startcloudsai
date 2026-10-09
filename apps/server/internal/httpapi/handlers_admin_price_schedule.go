package httpapi

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/pricerules"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// adminGetPriceSchedule 是「动态调价」面板：规则、订阅优惠、可参与的站内模型及其原价，
// 以及此刻（北京时间）生效的规则。
func (s *Server) adminGetPriceSchedule(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	schedule, err := pricerules.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, priceSchedulePayload(cfg, schedule, time.Now()))
}

func priceSchedulePayload(cfg modelconfig.Config, schedule pricerules.Schedule, now time.Time) gin.H {
	providers := make(map[string]string, len(cfg.Providers))
	for _, provider := range cfg.Providers {
		providers[provider.ID] = provider.Name
	}
	models := make([]gin.H, 0, len(cfg.Models))
	for _, model := range cfg.Models {
		if !model.Public {
			continue
		}
		low, high := modelconfig.EffectivePrice(model), modelconfig.EffectivePrice(model)
		if modelconfig.HasImagePricing(model) {
			low, high = modelconfig.ImagePriceBounds(model)
		}
		models = append(models, gin.H{
			"id": model.ID, "name": model.Name, "kind": model.Kind, "tool": model.Tool,
			"providerName": providers[model.ProviderID], "enabled": model.Enabled,
			"standardPricePoints": model.PriceCents, "pricePoints": modelconfig.EffectivePrice(model),
			"minPricePoints": low, "maxPricePoints": high, "tiered": modelconfig.HasImagePricing(model),
			"upstreamCostPoints": model.UpstreamCostCents,
			"allowZeroPrice":     model.AllowZeroPrice, "allowLossLeader": model.AllowLossLeader,
		})
	}
	return gin.H{
		"schedule": schedule, "models": models,
		"now":    now.In(pricerules.Beijing).Format("2006-01-02T15:04:05"),
		"active": pricerules.ActiveFor(schedule, now), "nextChangeAt": optionalTime(pricerules.NextChange(schedule, now)),
	}
}

func (s *Server) adminPutPriceSchedule(c *gin.Context, _ *store.User) {
	var input pricerules.Schedule
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var cfg modelconfig.Config
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		if cfg, err = modelconfig.Load(ctx, tx); err != nil {
			return err
		}
		if err := pricerules.Validate(input, cfg); err != nil {
			return err
		}
		return pricerules.Save(ctx, tx, input)
	})
	if err != nil {
		fail(c, err)
		return
	}
	// The public status page shows the price in force; rebuild it now.
	s.invalidateModelStatus()
	saved, err := pricerules.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, priceSchedulePayload(cfg, saved, time.Now()))
}
