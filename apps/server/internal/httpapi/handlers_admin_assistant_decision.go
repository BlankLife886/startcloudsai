package httpapi

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantdecision"
	"github.com/BlankLife886/startcloudsai/server/internal/decision"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type adminDecisionCandidate struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	PageDefault   bool   `json:"pageDefault"`
	Available     bool   `json:"available"`
	UpstreamModel string `json:"upstreamModel"`
}

// adminAssistantDecisionPayload describes the decision-model setup: what is
// stored, what is actually used, and what can be chosen. Secrets never leave.
func (s *Server) adminAssistantDecisionPayload(c *gin.Context) (gin.H, error) {
	ctx := c.Request.Context()
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		return nil, err
	}
	override, err := decision.LoadOverride(ctx, s.St.Pool)
	if err != nil {
		return nil, err
	}
	effective, source := decision.SelectModel(cfg, override)
	pageDefault, _ := decision.SelectModel(cfg, decision.Override{})
	candidates := []adminDecisionCandidate{}
	for _, selection := range modelconfig.PublicModelsForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat) {
		candidates = append(candidates, adminDecisionCandidate{
			ID: selection.Model.ID, Name: selection.Model.Name, UpstreamModel: selection.Model.UpstreamModel,
			Available:   selection.Model.Available(),
			PageDefault: pageDefault != nil && pageDefault.Model.ID == selection.Model.ID,
		})
	}
	thresholds := override.Thresholds
	if thresholds == nil {
		thresholds = map[string]decision.Thresholds{}
	}
	payload := gin.H{
		"override":          gin.H{"modelId": override.ModelID, "thresholds": thresholds},
		"defaultThresholds": decision.DefaultThresholds,
		"source":            source,
		"candidates":        candidates,
		"effective":         nil,
		// An override that no longer resolves (model disabled or removed from
		// the assistant page) silently falls back; surface it.
		"overrideIgnored": override.ModelID != "" && source != decision.SourceOverride,
	}
	if effective != nil {
		payload["effective"] = gin.H{
			"modelId": effective.Model.ID, "name": effective.Model.Name,
			"thresholds": override.ThresholdsFor(effective.Model.ID),
		}
	}
	return payload, nil
}

func (s *Server) adminGetAssistantDecision(c *gin.Context, _ *store.User) {
	payload, err := s.adminAssistantDecisionPayload(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, payload)
}

func (s *Server) adminPutAssistantDecision(c *gin.Context, _ *store.User) {
	var body decision.Override
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.ModelID = strings.TrimSpace(body.ModelID)
	if body.ModelID != "" {
		cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
		if err != nil {
			fail(c, err)
			return
		}
		if _, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat, body.ModelID); !ok {
			fail(c, apperr.E("validation_error", "所选模型不是 AI 助手页面可用的对话模型", 422))
			return
		}
	}
	if err := body.Validate(); err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	if err := decision.SaveOverride(c.Request.Context(), s.St.Pool, body, time.Now().UTC()); err != nil {
		fail(c, err)
		return
	}
	payload, err := s.adminAssistantDecisionPayload(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, payload)
}

func (s *Server) adminAssistantDecisionStats(c *gin.Context, _ *store.User) {
	days := 7
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 90 {
			fail(c, apperr.E("validation_error", "days 须在 1-90 之间", 422))
			return
		}
		days = parsed
	}
	stats, err := store.GetAssistantDecisionStats(c.Request.Context(), s.St.Pool, time.Now().UTC().AddDate(0, 0, -days))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"days": days, "stats": stats})
}

// adminRunAssistantDecisionEval runs the built-in evaluation set. "rules"
// costs nothing; "model" calls the chosen decision model once per case, so
// the admin page asks for confirmation before sending it.
func (s *Server) adminRunAssistantDecisionEval(c *gin.Context, _ *store.User) {
	var body struct {
		Mode    string `json:"mode"`
		ModelID string `json:"modelId"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	mode := strings.TrimSpace(body.Mode)
	if mode != "rules" && mode != "model" {
		fail(c, apperr.E("validation_error", "mode 须为 rules 或 model", 422))
		return
	}
	ctx := c.Request.Context()
	modelID := strings.TrimSpace(body.ModelID)
	setupFor := func(prompt string) assistantdecision.Setup {
		return assistantdecision.RulesOnly(prompt, decision.DefaultThresholds)
	}
	if mode == "model" {
		probe := assistantdecision.Resolve(ctx, s.St.Pool, s.Cfg.AppSecret, "", modelID)
		if probe.ModelID == "" {
			fail(c, apperr.E("validation_error", "没有可用的判断模型（检查模型是否已分配给 AI 助手页面且服务商可用）", 422))
			return
		}
		setupFor = func(prompt string) assistantdecision.Setup {
			return assistantdecision.Resolve(ctx, s.St.Pool, s.Cfg.AppSecret, prompt, probe.ModelID)
		}
	}
	report := assistantdecision.Evaluate(ctx, assistantdecision.BuiltinCases, mode, setupFor, 4)
	ok(c, gin.H{"report": report})
}
