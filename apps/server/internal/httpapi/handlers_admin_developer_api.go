package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// adminDeveloperAPIFilter reads the shared filters of the admin API 调用 page.
func adminDeveloperAPIFilter(c *gin.Context) (store.AdminDeveloperAPICallFilter, error) {
	base, err := adminListFilter(c)
	if err != nil {
		return store.AdminDeveloperAPICallFilter{}, err
	}
	f := store.AdminDeveloperAPICallFilter{
		From: base.From, To: base.To, UserSearch: base.UserSearch,
		Status: strings.TrimSpace(c.Query("status")), Kind: strings.TrimSpace(c.Query("kind")),
		ModelID: strings.TrimSpace(c.Query("model")), KeySearch: strings.TrimSpace(c.Query("key")),
	}
	if f.Status != "" && !store.Contains([]string{"charged", "refunded", "pending"}, f.Status) {
		return f, apperr.E("validation_error", "status 只支持 charged、refunded、pending", http.StatusUnprocessableEntity)
	}
	if f.Kind != "" && f.Kind != "image" && f.Kind != "chat" {
		return f, apperr.E("validation_error", "kind 只支持 image 或 chat", http.StatusUnprocessableEntity)
	}
	if len([]rune(f.KeySearch)) > 200 || len(f.ModelID) > 200 {
		return f, apperr.E("validation_error", "搜索内容不能超过 200 个字符", http.StatusUnprocessableEntity)
	}
	return f, nil
}

type developerAPINames struct {
	models, providers, routes map[string]string
}

func loadDeveloperAPINames(cfg modelconfig.Config) developerAPINames {
	names := developerAPINames{models: map[string]string{}, providers: map[string]string{}, routes: map[string]string{}}
	for _, model := range cfg.Models {
		names.models[model.ID] = openAIPublicModelID(model)
	}
	for _, provider := range cfg.Providers {
		names.providers[provider.ID] = provider.Name
		for _, route := range provider.Routes {
			names.routes[provider.ID+"/"+route.ID] = route.Name
		}
	}
	return names
}

func (n developerAPINames) model(id string) string {
	if name := n.models[id]; name != "" {
		return name
	}
	if id == "" {
		return ""
	}
	return "已下线的模型"
}

// adminDeveloperAPICalls lists /v1 requests across users for operators.
func (s *Server) adminDeveloperAPICalls(c *gin.Context, _ *store.User) {
	filter, err := adminDeveloperAPIFilter(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, page, err := pageWindow(c, 20, 100)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	total, err := store.CountAdminDeveloperAPICallsCapped(ctx, s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	calls, err := store.ListAdminDeveloperAPICalls(ctx, s.St.Pool, filter, limit, (page-1)*limit)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	names := loadDeveloperAPINames(cfg)
	items := make([]gin.H, 0, len(calls))
	for _, call := range calls {
		items = append(items, adminDeveloperAPICallDict(call, names))
	}
	// The page number doubles as the cursor so the shared admin pager can step
	// forward without a keyset on the text billing id.
	var next any
	if int64(page*limit) < total.Value {
		next = strconv.Itoa(page + 1)
	}
	ok(c, gin.H{"items": items, "nextCursor": next, "page": page, "total": total.Value, "totalCapped": total.Capped})
}

// adminDeveloperAPISummary totals the requests matching the page filters.
func (s *Server) adminDeveloperAPISummary(c *gin.Context, _ *store.User) {
	filter, err := adminDeveloperAPIFilter(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	summary, err := store.SummarizeAdminDeveloperAPICalls(ctx, s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	names := loadDeveloperAPINames(cfg)
	models := make([]gin.H, 0, len(summary.Models))
	for _, item := range summary.Models {
		models = append(models, gin.H{
			"modelId": item.ModelID, "model": names.model(item.ModelID), "calls": item.Calls, "charged": item.Charged,
			"revenueCents": item.RevenueCents, "upstreamCostCents": item.UpstreamCostCents,
			"grossProfitCents": item.RevenueCents - item.UpstreamCostCents,
		})
	}
	// Site models that API models point at, for the filter (calls are
	// recorded against the site model that ran them).
	entries, err := s.developerCatalog(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	options := make([]gin.H, 0)
	seen := map[string]bool{}
	for _, entry := range entries {
		model, found := siteModelByID(cfg, entry.TargetModelID)
		if !found || seen[model.ID] || entry.Status == store.DeveloperAPIModelDraft {
			continue
		}
		seen[model.ID] = true
		options = append(options, gin.H{"id": model.ID, "name": openAIPublicModelID(model), "kind": model.Kind})
	}
	ok(c, gin.H{
		"calls": summary.Calls, "charged": summary.Charged, "refunded": summary.Refunded, "pending": summary.Pending,
		"revenueCents": summary.RevenueCents, "upstreamCostCents": summary.UpstreamCostCents,
		"grossProfitCents": summary.RevenueCents - summary.UpstreamCostCents,
		"users": summary.Users, "keys": summary.Keys, "models": models, "modelOptions": options,
	})
}

func adminDeveloperAPICallDict(call *store.AdminDeveloperAPICall, names developerAPINames) gin.H {
	var metadata struct {
		Operation      string          `json:"operation"`
		ErrorCode      string          `json:"errorCode"`
		Note           string          `json:"note"`
		Usage          json.RawMessage `json:"usage"`
		ResponseFormat string          `json:"responseFormat"`
	}
	_ = json.Unmarshal(call.Metadata, &metadata)
	var tokens struct {
		Prompt     *int64 `json:"prompt_tokens"`
		Completion *int64 `json:"completion_tokens"`
		Total      *int64 `json:"total_tokens"`
	}
	_ = json.Unmarshal(metadata.Usage, &tokens)
	view := developerAPICallDict(&store.DeveloperAPICall{
		SourceType: call.SourceType, Status: call.Status, PriceCents: call.PriceCents, CreatedAt: call.CreatedAt,
		KeyLabel: call.KeyLabel, KeyPrefix: call.KeyPrefix, ModelID: call.ModelID, APIModelName: call.APIModelName, Units: call.Units,
		Operation: metadata.Operation, ErrorCode: metadata.ErrorCode, Note: metadata.Note,
		PromptTokens: tokens.Prompt, CompletionTokens: tokens.Completion, TotalTokens: tokens.Total,
	}, names.models)
	view["billingId"] = call.BillingID
	view["modelId"] = call.ModelID
	view["provider"] = names.providers[call.ProviderID]
	view["route"] = names.routes[call.ProviderID+"/"+call.RouteID]
	view["upstreamCostCents"] = int64(0)
	if call.Status == store.DeveloperAPIRequestSucceeded {
		view["upstreamCostCents"] = call.UpstreamCostCents
	}
	view["errorCode"] = metadata.ErrorCode
	view["note"] = metadata.Note
	view["responseFormat"] = metadata.ResponseFormat
	view["rawStatus"] = call.Status
	if call.SettledAt != nil {
		view["settledAt"] = call.SettledAt.UTC().Format(time.RFC3339)
	}
	if len(metadata.Usage) > 0 && string(metadata.Usage) != "null" {
		view["usage"] = metadata.Usage
	}
	var user gin.H
	if call.UserID != nil {
		user = gin.H{"id": call.UserID.String()}
		if call.UserEmail != nil {
			user["email"] = *call.UserEmail
		}
		if call.Username != nil {
			user["username"] = *call.Username
		}
	}
	view["user"] = user
	return view
}
