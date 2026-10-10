package httpapi

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantmodel"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantreview"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantv2"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/statseval"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/useraccount"
)

// reviewEvalBudget keeps a regression run inside the server's write timeout;
// cases still running at the deadline are reported as errors.
const reviewEvalBudget = 280 * time.Second

// reviewProbeOutputTokens is ample for a first move: a tool call with its
// arguments, or the start of a reply.
const reviewProbeOutputTokens = 1200

func qualityDays(raw string) (time.Time, error) {
	days, _ := strconv.Atoi(raw)
	if days != 7 && days != 30 {
		return time.Time{}, apperr.E("validation_error", "days: 仅支持 7 或 30", 422)
	}
	return time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour), nil
}

// adminAssistantQuality shows what users' behaviour says about the assistant:
// rates per mode, model and prompt version, a daily trend, and the one-tap
// corrections grouped by kind. Nobody reviews turns by hand.
func (s *Server) adminAssistantQuality(c *gin.Context, _ *store.User) {
	since, err := qualityDays(c.DefaultQuery("days", "7"))
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	groups, err := store.AssistantQualityGroups(ctx, s.St.Pool, since)
	if err != nil {
		fail(c, err)
		return
	}
	days, err := store.AssistantQualityDays(ctx, s.St.Pool, since, "Asia/Shanghai")
	if err != nil {
		fail(c, err)
		return
	}
	corrections, err := store.AssistantCorrectionSummaries(ctx, s.St.Pool, since, 5)
	if err != nil {
		fail(c, err)
		return
	}
	negative, err := store.AssistantNegativeFeedbackList(ctx, s.St.Pool, since, 100)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"groups": groups, "days": days, "corrections": corrections, "negative": negative})
}

// adminAssistantQualityCases lists the built-in cases and the ones users' corrections produced.
func (s *Server) adminAssistantQualityCases(c *gin.Context, _ *store.User) {
	stored, err := s.assistantStoredCases(c.Request.Context(), false)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"builtin": assistantreview.BuiltinCases, "stored": stored, "models": assistantmodel.Candidates(cfg)})
}

func (s *Server) assistantStoredCases(ctx context.Context, activeOnly bool) ([]assistantreview.Case, error) {
	rows, err := store.ListAssistantAgentCases(ctx, s.St.Pool, activeOnly)
	if err != nil {
		return nil, err
	}
	cases := make([]assistantreview.Case, 0, len(rows))
	for _, row := range rows {
		item := assistantreview.Case{
			ID: row.ID.String(), Source: assistantreview.SourceUser, Mode: row.Mode, Prompt: row.Prompt,
			ReferenceCount: row.ReferenceCount, Expected: row.Expected, Note: row.Note, Active: row.Active,
		}
		_ = json.Unmarshal(row.Context, &item.Context)
		cases = append(cases, item)
	}
	return cases, nil
}

func (s *Server) adminPatchAssistantQualityCase(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		Active *bool `json:"active"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Active == nil {
		fail(c, apperr.E("validation_error", "active 必填", 422))
		return
	}
	item, err := store.SetAssistantAgentCaseActive(c.Request.Context(), s.St.Pool, id, *body.Active)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "用例不存在", 404))
		return
	}
	ok(c, gin.H{"case": item})
}

func (s *Server) adminDeleteAssistantQualityCase(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	deleted, err := store.DeleteAssistantAgentCase(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("not_found", "用例不存在", 404))
		return
	}
	ok(c, gin.H{"deleted": true})
}

// adminRunAssistantQualityEval asks the agent for its first move on every
// active case, with the real instructions and tools and no tool run. Each
// case is a real model call, so the admin page asks for confirmation.
func (s *Server) adminRunAssistantQualityEval(c *gin.Context, _ *store.User) {
	var body struct {
		ModelID string `json:"modelId"`
		Scope   string `json:"scope"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	scope := strings.TrimSpace(body.Scope)
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != assistantreview.SourceBuiltin && scope != assistantreview.SourceUser {
		fail(c, apperr.E("validation_error", "scope: 仅支持 all、builtin 或 user", 422))
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), reviewEvalBudget)
	defer cancel()
	cases := []assistantreview.Case{}
	if scope != assistantreview.SourceUser {
		cases = append(cases, assistantreview.BuiltinCases...)
	}
	if scope != assistantreview.SourceBuiltin {
		stored, err := s.assistantStoredCases(ctx, true)
		if err != nil {
			fail(c, err)
			return
		}
		cases = append(cases, stored...)
	}
	if len(cases) == 0 {
		fail(c, apperr.E("validation_error", "没有可评测的用例", 422))
		return
	}
	client, modelID, err := s.assistantEvalClient(ctx, body.ModelID)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if s.AssistantProber == nil {
		fail(c, apperr.E("service_unavailable", "当前服务没有启用评测", 503))
		return
	}
	ok(c, gin.H{"report": assistantreview.Evaluate(ctx, cases, s.assistantProbe(client, cfg), modelID, 6)})
}

// assistantProbe is the first-move probe for evaluations and comparisons.
func (s *Server) assistantProbe(client *sub2api.Client, cfg modelconfig.Config) assistantreview.Probe {
	params := map[string]any{"_imageModelCatalog": assistantProbeImageCatalog(cfg)}
	client = client.WithoutRetry().WithMaxOutputTokens(reviewProbeOutputTokens).WithReasoningEffort("low")
	return func(ctx context.Context, item assistantreview.Case) (assistantreview.Action, error) {
		return s.AssistantProber.Probe(ctx, client, item, params)
	}
}

// adminCompareAssistantVersion replays a random sample of recent real turns
// through the current prompt and the chosen model, and lists only the turns
// whose first move changed (or that users corrected and still go wrong),
// judged by what those users did. No tool runs.
func (s *Server) adminCompareAssistantVersion(c *gin.Context, _ *store.User) {
	var body struct {
		ModelID string `json:"modelId"`
		Days    int    `json:"days"`
		Sample  int    `json:"sample"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Days == 0 {
		body.Days = 7
	}
	since, err := qualityDays(strconv.Itoa(body.Days))
	if err != nil {
		fail(c, err)
		return
	}
	if body.Sample == 0 {
		body.Sample = 200
	}
	if body.Sample < 20 || body.Sample > 300 {
		fail(c, apperr.E("validation_error", "sample: 须在 20-300 之间", 422))
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), reviewEvalBudget)
	defer cancel()
	client, modelID, err := s.assistantEvalClient(ctx, body.ModelID)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if s.AssistantProber == nil {
		fail(c, apperr.E("service_unavailable", "当前服务没有启用评测", 503))
		return
	}
	turns, err := store.SampleAssistantTurns(ctx, s.St.Pool, since, body.Sample)
	if err != nil {
		fail(c, err)
		return
	}
	if len(turns) == 0 {
		fail(c, apperr.E("validation_error", "这段时间没有可回放的对话", 422))
		return
	}
	replays := make([]assistantreview.Replay, 0, len(turns))
	histories := map[uuid.UUID][]*store.AssistantMessage{}
	for _, turn := range turns {
		history, seen := histories[turn.ConversationID]
		if !seen {
			if history, err = store.ListAssistantMessages(ctx, s.St.Pool, turn.ConversationID, 200); err != nil {
				fail(c, err)
				return
			}
			histories[turn.ConversationID] = history
		}
		mode := assistantreview.ModeAgent
		if turn.Mode == assistantreview.ModeChat {
			mode = assistantreview.ModeChat
		}
		replay := assistantreview.Replay{
			Case: assistantreview.Case{
				ID: turn.AssistantMessageID.String(), Source: assistantreview.SourceUser, Mode: mode, Prompt: turn.Prompt,
				Context: assistantreview.ContextFrom(history, turn.UserMessageID), ReferenceCount: turn.ReferenceCount,
			},
			Recorded: assistantreview.RecordedMove(turn.Kind, turn.Status, turn.Tools), Label: turn.Expected, CreatedAt: turn.CreatedAt,
		}
		for _, event := range turn.Events {
			switch event {
			case assistantreview.EventProposalExecuted:
				replay.Executed = true
			case assistantreview.EventStopped, assistantreview.EventNegativeFeedback, assistantreview.EventImageDeleted, assistantreview.EventCorrectedInText:
				replay.Doubted = true
			}
		}
		replays = append(replays, replay)
	}
	ok(c, gin.H{"report": assistantreview.Compare(ctx, replays, s.assistantProbe(client, cfg), modelID, 6)})
}

// assistantProbeImageCatalog describes the assistant page's image models the
// way a run's parameters do, so the probe's image tool matches production.
func assistantProbeImageCatalog(cfg modelconfig.Config) []map[string]any {
	catalog := []map[string]any{}
	for _, selection := range modelconfig.PublicModelsForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindImage) {
		catalog = append(catalog, map[string]any{
			"id": selection.Model.ID, "name": selection.Model.Name, "description": selection.Model.Description,
			"resolutions": selection.Model.Resolutions, "aspectRatios": selection.Model.AspectRatios,
			"qualities": selection.Model.Qualities, "maxReferenceImages": selection.Model.MaxReferenceImages,
			"maxImages": selection.Model.GenerationMaxImages(), "imageBatchLimit": selection.Model.GenerationMaxImages(),
			"fastMode": selection.Model.FastMode,
		})
	}
	return catalog
}

// assistantEvalClient resolves the model an evaluation runs: the one asked
// for, or the assistant page's default chat model. Asking for an unusable
// model is an error rather than a silent fallback, so a report never shows
// numbers for a model the admin did not choose.
func (s *Server) assistantEvalClient(ctx context.Context, requested string) (*sub2api.Client, string, error) {
	requested = strings.TrimSpace(requested)
	selection, err := assistantmodel.Resolve(ctx, s.St.Pool, s.Cfg.AppSecret, requested)
	if err != nil {
		return nil, "", apperr.E("validation_error", "没有可用的对话模型（检查模型是否已启用、服务商是否可用）", 422)
	}
	if requested != "" && selection.Model.ID != requested {
		return nil, "", apperr.E("validation_error", "所选模型当前不可用（已停用、维护中或服务商未启用）", 422)
	}
	client, err := assistantmodel.NewChatClient(selection)
	if err != nil {
		return nil, "", err
	}
	return client, selection.Model.ID, nil
}

// statsEvalBudget keeps a full statistics evaluation inside the server's
// write timeout; cases still running at the deadline are reported as errors.
const statsEvalBudget = 280 * time.Second

// adminRunAssistantStatsEval answers the built-in statistics questions with
// the platform prompt and tools against the admin's own data, then grades
// tool choice, arguments and whether every number in the answer is grounded.
// Each case makes real model calls, so the admin page asks for confirmation.
func (s *Server) adminRunAssistantStatsEval(c *gin.Context, admin *store.User) {
	var body struct {
		ModelID    string   `json:"modelId"`
		Categories []string `json:"categories"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	cases := statseval.BuiltinCases
	if len(body.Categories) > 0 {
		wanted := map[string]bool{}
		for _, category := range body.Categories {
			wanted[strings.TrimSpace(category)] = true
		}
		cases = []statseval.Case{}
		for _, item := range statseval.BuiltinCases {
			if wanted[item.Category] {
				cases = append(cases, item)
			}
		}
		if len(cases) == 0 {
			fail(c, apperr.E("validation_error", "没有匹配的评测分类", 422))
			return
		}
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), statsEvalBudget)
	defer cancel()
	client, modelID, err := s.assistantEvalClient(ctx, body.ModelID)
	if err != nil {
		fail(c, err)
		return
	}
	registry, err := assistantv2.Registry(s.St, time.Now, false)
	if err != nil {
		fail(c, err)
		return
	}
	const timezone = "Asia/Shanghai"
	now := time.Now()
	agent := statseval.NewAgent(client.WithoutRetry(), registry, admin.ID, timezone, func() time.Time { return now })
	report := statseval.Evaluate(ctx, cases, agent, modelID, now, useraccount.Location(timezone), 6)
	ok(c, gin.H{"report": report})
}

func (s *Server) adminAssistantStatsEvalCases(c *gin.Context, _ *store.User) {
	ok(c, gin.H{"cases": statseval.BuiltinCases, "categories": statseval.Categories})
}
