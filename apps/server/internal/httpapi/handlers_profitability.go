package httpapi

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) adminProfitability(c *gin.Context, _ *store.User) {
	dimension := strings.ToLower(strings.TrimSpace(c.DefaultQuery("dimension", "model")))
	if dimension != "model" && dimension != "provider" && dimension != "route" && dimension != "workspace" && dimension != "user" {
		fail(c, apperr.E("validation_error", "dimension: 仅支持 model/provider/route/workspace/user", 422))
		return
	}
	days := 30
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		if raw == "7" {
			days = 7
		} else if raw != "30" {
			fail(c, apperr.E("validation_error", "days: 仅支持 7 或 30", 422))
			return
		}
	}
	now := time.Now().UTC()
	todayStart, last7DaysStart, last30DaysStart := dashboardPeriodStarts(now)
	since := last30DaysStart
	if days == 7 {
		since = last7DaysStart
	}
	items, err := store.ListProfitabilityBreakdown(c.Request.Context(), s.St.Pool, dimension, since, 50)
	if err != nil {
		fail(c, err)
		return
	}
	config, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	labels := map[string]string{
		modelconfig.WorkspaceAssistant: "AI 助手", modelconfig.WorkspaceT2I: "文生图",
		modelconfig.WorkspaceColoring: "插画染色", modelconfig.WorkspaceUIDesign: "UI 设计",
		modelconfig.WorkspaceEcommerce: "AI 电商", modelconfig.WorkspaceModelSheet: "模型图",
		modelconfig.WorkspaceGameArt: "游戏美术", modelconfig.WorkspaceCanvas: "无限画布",
	}
	for _, provider := range config.Providers {
		labels[provider.ID] = provider.Name
		for _, route := range provider.Routes {
			labels[route.ID] = provider.Name + " · " + route.Name
		}
	}
	for _, model := range config.Models {
		labels[model.ID] = model.Name
	}
	for index := range items {
		if label := strings.TrimSpace(labels[items[index].Key]); label != "" {
			items[index].Label = label
		} else if strings.TrimSpace(items[index].Label) == "" {
			items[index].Label = "未记录"
		}
	}
	summary, err := store.GetProfitabilitySummary(c.Request.Context(), s.St.Pool, todayStart, last7DaysStart, last30DaysStart)
	if err != nil {
		fail(c, err)
		return
	}
	period := summary.Last30Days
	if days == 7 {
		period = summary.Last7Days
	}
	ok(c, gin.H{"dimension": dimension, "days": days, "since": isoValue(since), "summary": period, "items": items})
}
