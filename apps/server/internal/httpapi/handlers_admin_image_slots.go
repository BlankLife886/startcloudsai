package httpapi

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/imageslots"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// adminGetImageSlots is the resolution-slot status panel: which member each
// slot is using, member health, probe budget and recent history.
func (s *Server) adminGetImageSlots(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	overview, err := imageslots.BuildOverview(ctx, s.St.Pool, cfg, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, overview)
}

func (s *Server) adminPutImageSlotSettings(c *gin.Context, _ *store.User) {
	var input imageslots.Settings
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	switch {
	case input.FailureThreshold < 1 || input.FailureThreshold > imageslots.MaxFailureThreshold:
		fail(c, apperr.E("validation_error", fmt.Sprintf("连续失败次数须在 1-%d 之间", imageslots.MaxFailureThreshold), 422))
		return
	case input.ProbeIntervalMin < imageslots.MinProbeIntervalMin || input.ProbeIntervalMin > imageslots.MaxProbeIntervalMin:
		fail(c, apperr.E("validation_error", fmt.Sprintf("检测间隔须在 %d-%d 分钟之间", imageslots.MinProbeIntervalMin, imageslots.MaxProbeIntervalMin), 422))
		return
	case input.ProbeDailyLimit < 0 || input.ProbeDailyLimit > imageslots.MaxProbeDailyLimit:
		fail(c, apperr.E("validation_error", fmt.Sprintf("每 24 小时检测上限须在 0-%d 次之间", imageslots.MaxProbeDailyLimit), 422))
		return
	}
	ctx := c.Request.Context()
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		for key, value := range map[string]int{
			"image_slot_failure_threshold":      input.FailureThreshold,
			"image_slot_probe_interval_minutes": input.ProbeIntervalMin,
			"image_slot_probe_daily_limit":      input.ProbeDailyLimit,
		} {
			raw, _ := json.Marshal(value)
			if err := settings.Set(ctx, tx, key, raw); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	s.adminGetImageSlots(c, nil)
}

type imageSlotMemberInput struct {
	ModelID       string `json:"modelId"`
	Resolution    string `json:"resolution"`
	MemberModelID string `json:"memberModelId"`
}

func (s *Server) bindImageSlotMember(c *gin.Context) (imageSlotMemberInput, modelconfig.Config, bool) {
	var input imageSlotMemberInput
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return input, modelconfig.Config{}, false
	}
	input.ModelID = strings.TrimSpace(input.ModelID)
	input.MemberModelID = strings.TrimSpace(input.MemberModelID)
	input.Resolution = strings.ToUpper(strings.TrimSpace(input.Resolution))
	if input.MemberModelID == "" || input.Resolution == "" {
		fail(c, apperr.E("validation_error", "请指定模型和分辨率", 422))
		return input, modelconfig.Config{}, false
	}
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return input, cfg, false
	}
	return input, cfg, true
}

// adminSwitchImageSlot points a manual-mode slot at one of its members.
func (s *Server) adminSwitchImageSlot(c *gin.Context, _ *store.User) {
	input, cfg, valid := s.bindImageSlotMember(c)
	if !valid {
		return
	}
	ctx := c.Request.Context()
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		return imageslots.SwitchManual(ctx, tx, cfg, input.ModelID, input.Resolution, input.MemberModelID, time.Now().UTC())
	})
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	s.adminGetImageSlots(c, nil)
}

// adminResetImageSlotMember marks a member healthy by hand.
func (s *Server) adminResetImageSlotMember(c *gin.Context, _ *store.User) {
	input, cfg, valid := s.bindImageSlotMember(c)
	if !valid {
		return
	}
	ctx := c.Request.Context()
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		return imageslots.ResetMember(ctx, tx, cfg, input.MemberModelID, input.Resolution, time.Now().UTC())
	}); err != nil {
		fail(c, err)
		return
	}
	s.adminGetImageSlots(c, nil)
}

// adminProbeImageSlotMember runs one probe now. It spends the same 24-hour
// budget as the scheduled probes.
func (s *Server) adminProbeImageSlotMember(c *gin.Context, _ *store.User) {
	input, cfg, valid := s.bindImageSlotMember(c)
	if !valid {
		return
	}
	ctx := c.Request.Context()
	conf := imageslots.LoadSettings(ctx, s.St.Pool)
	used, err := store.CountImageSlotProbesSince(ctx, s.St.Pool, time.Now().UTC().Add(-24*time.Hour))
	if err != nil {
		fail(c, err)
		return
	}
	if used >= int64(conf.ProbeDailyLimit) {
		fail(c, apperr.E("probe_budget_exhausted", fmt.Sprintf("24 小时内的检测次数已用完（%d 次），可调高上限后再试", conf.ProbeDailyLimit), 429))
		return
	}
	runtime, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	target := imageslots.ProbeTarget{ModelID: input.MemberModelID, Resolution: input.Resolution}
	for _, model := range cfg.Models {
		if model.ID == input.ModelID {
			target.Qualities = model.Qualities
		}
	}
	passed, message := imageslots.Probe(ctx, runtime, target, s.Cfg.C2APrivateNetworkAllowed())
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		return imageslots.RecordProbe(ctx, tx, cfg, target, passed, message, time.Now().UTC())
	}); err != nil {
		fail(c, err)
		return
	}
	s.adminGetImageSlots(c, nil)
}
