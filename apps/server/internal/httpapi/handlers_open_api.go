package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	ctxOpenAPIKey  = "openAPIKey"
	ctxOpenAPIUser = "openAPIUser"
	ctxOpenAPI     = "openAPIRequest"
)

var allowedOpenAPIScopes = map[string]bool{
	"models:read": true, "files:write": true, "tasks:write": true, "tasks:read": true,
}

func hashAPISecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func newAPISecret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "sk-sc-" + base64.RawURLEncoding.EncodeToString(raw), nil
}

func apiKeyHasScope(key *store.UserAPIKey, scope string) bool {
	for _, item := range key.Scopes {
		if item == scope {
			return true
		}
	}
	return false
}

func openAPIModelItems(cfg modelconfig.Config, allowedModelIDs []string) []gin.H {
	allowed := map[string]bool{}
	for _, id := range allowedModelIDs {
		allowed[id] = true
	}
	items := make([]gin.H, 0)
	for _, model := range cfg.Models {
		if !model.Enabled || !model.Public || model.Kind == modelconfig.ModelKindChat {
			continue
		}
		if len(allowed) > 0 && !allowed[model.ID] {
			continue
		}
		items = append(items, gin.H{
			"id": model.ID, "name": model.Name, "kind": model.Kind, "tool": model.Tool,
			"priceCents": modelconfig.EffectivePrice(model), "maxImages": model.GenerationMaxImages(),
			"maxReferenceImages": model.MaxReferenceImages, "resolutions": model.Resolutions,
			"aspectRatios": model.AspectRatios, "qualities": model.Qualities,
		})
	}
	return items
}

func normalizeOpenAPIModelIDs(cfg modelconfig.Config, values []string) ([]string, error) {
	available := map[string]bool{}
	for _, model := range cfg.Models {
		if model.Enabled && model.Public && model.Kind != modelconfig.ModelKindChat {
			available[model.ID] = true
		}
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if !available[id] {
			return nil, apperr.E("validation_error", "allowedModelIds: 包含未开放或不存在的模型", 422)
		}
		if !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	return result, nil
}

func (s *Server) openAPIOnly(scope string, handler gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !s.developerAPIEnabled(c) {
			return
		}
		authorization := strings.TrimSpace(c.GetHeader("Authorization"))
		if len(authorization) < 8 || !strings.EqualFold(authorization[:7], "Bearer ") {
			fail(c, apperr.E("api_key_required", "请使用 Authorization: Bearer <API_KEY>", 401))
			return
		}
		secret := strings.TrimSpace(authorization[7:])
		if !strings.HasPrefix(secret, "sk-sc-") || len(secret) > 128 {
			fail(c, apperr.E("api_key_invalid", "API Key 无效", 401))
			return
		}
		key, err := store.GetUserAPIKeyByHash(c.Request.Context(), s.St.Pool, hashAPISecret(secret))
		if err != nil {
			fail(c, err)
			return
		}
		now := time.Now().UTC()
		if key == nil || key.Status != "active" || (key.ExpiresAt != nil && !key.ExpiresAt.After(now)) {
			fail(c, apperr.E("api_key_invalid", "API Key 已失效", 401))
			return
		}
		if !apiKeyHasScope(key, scope) {
			fail(c, apperr.E("api_key_scope_denied", "API Key 缺少 "+scope+" 权限", 403))
			return
		}
		clientIP := strings.TrimSpace(c.ClientIP())
		if !ipAllowed(clientIP, key.IPAllowlist) {
			s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &key.UserID, APIKeyID: &key.ID,
				ClientIP: clientIP, Category: "api_key_ip_denied", Severity: "high", Score: 70,
				Action: "limited", Reason: "API Key 被非白名单 IP 使用"})
			fail(c, apperr.E("api_key_ip_denied", "当前来源 IP 不在此 API Key 的白名单中", 403))
			return
		}
		if expiresAt, blocked := s.securityBlocked(c.Request.Context(), "api_key", key.ID.String(), "open_api", now); blocked {
			fail(c, apperr.E("api_key_temporarily_blocked", "API Key 已临时受限，请在 "+expiresAt.Local().Format("15:04")+" 后重试", 429))
			return
		}
		if err := s.takeUsageLimit(c, "api-key-request-minute", key.ID.String(), int64(key.RateLimitPerMinute), 1, time.Minute); err != nil {
			s.handleAPIKeyAbuse(c, key, "API Key 每分钟请求数超过限制")
			fail(c, err)
			return
		}
		requestBytes := max(c.Request.ContentLength, 0)
		if requestBytes > 0 {
			if err := s.takeUsageLimit(c, "api-key-bytes-day", key.ID.String(), key.DailyByteLimit, requestBytes, 24*time.Hour); err != nil {
				s.freezeAPIKeyForRisk(c, key, "API Key 单日传输字节额度已用完")
				fail(c, err)
				return
			}
		}
		user, err := store.GetUserByID(c.Request.Context(), s.St.Pool, key.UserID)
		if err != nil {
			fail(c, err)
			return
		}
		if user == nil || user.Status != "active" || user.Role != "user" {
			fail(c, apperr.E("api_key_invalid", "API Key 所属账号不可用", 401))
			return
		}
		c.Set(ctxOpenAPIKey, key)
		c.Set(ctxOpenAPIUser, user)
		c.Set(ctxOpenAPI, true)
		handler(c)
		statusCode := c.Writer.Status()
		responseBytes := int64(max(c.Writer.Size(), 0))
		if responseBytes > 0 {
			if err := s.takeUsageLimit(c, "api-key-bytes-day", key.ID.String(), key.DailyByteLimit, responseBytes, 24*time.Hour); err != nil {
				s.freezeAPIKeyForRisk(c, key, "API Key 单日传输字节额度已用完")
			}
		}
		if statusCode >= 500 && s.UsageLimiter != nil {
			if _, allowed, _ := s.UsageLimiter.Take(c.Request.Context(), "api-key-server-errors", key.ID.String(), 10, 1, 10*time.Minute); !allowed {
				s.freezeAPIKeyForRisk(c, key, "API Key 在短时间内触发过多服务端失败")
			}
		}
		method, route := c.Request.Method, c.FullPath()
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = store.TouchUserAPIKey(ctx, s.St.Pool, key.ID, clientIP, nil)
			_ = store.InsertAPIKeyAccessEvent(ctx, s.St.Pool, key.ID, key.UserID, clientIP,
				method, route, statusCode, requestBytes, responseBytes)
		}()
	}
}

func (s *Server) handleAPIKeyAbuse(c *gin.Context, key *store.UserAPIKey, reason string) {
	if s.UsageLimiter != nil {
		_, allowed, err := s.UsageLimiter.Take(c.Request.Context(), "api-key-abuse-strikes", key.ID.String(), 3, 1, 10*time.Minute)
		if err == nil && !allowed {
			s.freezeAPIKeyForRisk(c, key, reason)
			return
		}
	}
	s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &key.UserID, APIKeyID: &key.ID,
		ClientIP: c.ClientIP(), Category: "api_key_abuse", Severity: "medium", Score: 55,
		Action: "limited", Reason: reason})
}

func (s *Server) freezeAPIKeyForRisk(c *gin.Context, key *store.UserAPIKey, reason string) {
	frozen, _ := store.FreezeUserAPIKey(c.Request.Context(), s.St.Pool, key.ID, reason)
	action := "limited"
	if frozen {
		action = "key_frozen"
	}
	s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &key.UserID, APIKeyID: &key.ID,
		ClientIP: c.ClientIP(), Category: "api_key_abuse", Severity: "high", Score: 85,
		Action: action, Reason: reason})
}

func openAPIKeyFromContext(c *gin.Context) *store.UserAPIKey {
	value, exists := c.Get(ctxOpenAPIKey)
	if !exists {
		return nil
	}
	key, _ := value.(*store.UserAPIKey)
	return key
}

func userAPIKeyDict(key *store.UserAPIKey, usage store.APIKeyUsageSummary) gin.H {
	return gin.H{
		"id": key.ID.String(), "prefix": key.KeyPrefix, "label": key.Label, "status": key.Status,
		"scopes": key.Scopes, "allowedModelIds": key.AllowedModelIDs,
		"dailyTaskLimit": key.DailyTaskLimit, "monthlyTaskLimit": key.MonthlyTaskLimit,
		"dailySpendLimitCents": key.DailySpendLimitCents, "monthlySpendLimitCents": key.MonthlySpendLimitCents,
		"ipAllowlist": key.IPAllowlist, "rateLimitPerMinute": key.RateLimitPerMinute,
		"dailyByteLimit": key.DailyByteLimit, "autoFrozenAt": iso(key.AutoFrozenAt), "freezeReason": key.FreezeReason,
		"usage": usage, "expiresAt": iso(key.ExpiresAt), "lastUsedAt": iso(key.LastUsedAt),
		"lastUsedIp": key.LastUsedIP, "lastError": key.LastError,
		"createdAt": isoValue(key.CreatedAt), "updatedAt": isoValue(key.UpdatedAt),
	}
}

func (s *Server) myAPIKeys(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	keys, err := store.ListUserAPIKeys(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(keys))
	for _, key := range keys {
		usage, err := store.GetAPIKeyUsageSummary(c.Request.Context(), s.St.Pool, key.ID, time.Now().UTC())
		if err != nil {
			fail(c, err)
			return
		}
		recentIPs, err := store.ListAPIKeyRecentIPs(c.Request.Context(), s.St.Pool, key.ID, 5)
		if err != nil {
			fail(c, err)
			return
		}
		item := userAPIKeyDict(key, usage)
		item["recentIps"] = recentIPs
		item["expiresSoon"] = key.ExpiresAt != nil && key.ExpiresAt.After(time.Now().UTC()) && key.ExpiresAt.Before(time.Now().UTC().Add(14*24*time.Hour))
		items = append(items, item)
	}
	ok(c, gin.H{"items": items})
}

type createAPIKeyInput struct {
	Label                  string   `json:"label"`
	Scopes                 []string `json:"scopes"`
	AllowedModelIDs        []string `json:"allowedModelIds"`
	DailyTaskLimit         int      `json:"dailyTaskLimit"`
	MonthlyTaskLimit       int      `json:"monthlyTaskLimit"`
	DailySpendLimitCents   int64    `json:"dailySpendLimitCents"`
	MonthlySpendLimitCents int64    `json:"monthlySpendLimitCents"`
	ExpiresAt              *string  `json:"expiresAt"`
	IPAllowlist            []string `json:"ipAllowlist"`
	RateLimitPerMinute     int      `json:"rateLimitPerMinute"`
	DailyByteLimit         int64    `json:"dailyByteLimit"`
}

func (s *Server) createMyAPIKey(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body createAPIKeyInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	count, err := store.CountActiveUserAPIKeys(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if count >= 10 {
		fail(c, apperr.E("api_key_limit", "每个账号最多保留 10 个有效 API Key", 422))
		return
	}
	body.Label = strings.TrimSpace(body.Label)
	if body.Label == "" || len([]rune(body.Label)) > 80 {
		fail(c, apperr.E("validation_error", "label: 须为 1-80 个字符", 422))
		return
	}
	if len(body.Scopes) == 0 {
		body.Scopes = []string{"models:read", "files:write", "tasks:write", "tasks:read"}
	}
	seenScopes := map[string]bool{}
	scopes := make([]string, 0, len(body.Scopes))
	for _, raw := range body.Scopes {
		scope := strings.TrimSpace(raw)
		if !allowedOpenAPIScopes[scope] {
			fail(c, apperr.E("validation_error", "scopes: 包含不支持的权限", 422))
			return
		}
		if !seenScopes[scope] {
			seenScopes[scope] = true
			scopes = append(scopes, scope)
		}
	}
	var expiresAt *time.Time
	if body.ExpiresAt != nil && strings.TrimSpace(*body.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ExpiresAt))
		if err != nil || !parsed.After(time.Now().UTC()) {
			fail(c, apperr.E("validation_error", "expiresAt: 必须是未来的 RFC3339 时间", 422))
			return
		}
		parsed = parsed.UTC()
		expiresAt = &parsed
	}
	if body.DailyTaskLimit == 0 {
		body.DailyTaskLimit = 100
	}
	if body.MonthlyTaskLimit == 0 {
		body.MonthlyTaskLimit = 2000
	}
	if body.DailySpendLimitCents == 0 {
		body.DailySpendLimitCents = 10000
	}
	if body.MonthlySpendLimitCents == 0 {
		body.MonthlySpendLimitCents = 200000
	}
	if body.RateLimitPerMinute == 0 {
		body.RateLimitPerMinute = 120
	}
	if body.DailyByteLimit == 0 {
		body.DailyByteLimit = 2 << 30
	}
	if len(body.IPAllowlist) > 20 {
		fail(c, apperr.E("validation_error", "ipAllowlist: 最多 20 项", 422))
		return
	}
	allowlist := make([]string, 0, len(body.IPAllowlist))
	seenIPs := map[string]bool{}
	for _, raw := range body.IPAllowlist {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if !validIPAddress(value) {
			if _, _, err := net.ParseCIDR(value); err != nil {
				fail(c, apperr.E("validation_error", "ipAllowlist: 仅支持 IP 或 CIDR", 422))
				return
			}
		}
		if !seenIPs[value] {
			seenIPs[value] = true
			allowlist = append(allowlist, value)
		}
	}
	body.IPAllowlist = allowlist
	if body.DailyTaskLimit < 1 || body.DailyTaskLimit > 100000 ||
		body.MonthlyTaskLimit < body.DailyTaskLimit || body.MonthlyTaskLimit > 1000000 ||
		body.DailySpendLimitCents < 1 || body.DailySpendLimitCents > 1000000000 ||
		body.MonthlySpendLimitCents < body.DailySpendLimitCents || body.MonthlySpendLimitCents > 10000000000 {
		fail(c, apperr.E("validation_error", "API Key 的日/月任务或积分额度无效", 422))
		return
	}
	if body.RateLimitPerMinute < 1 || body.RateLimitPerMinute > 10000 ||
		body.DailyByteLimit < 1<<20 || body.DailyByteLimit > 1<<40 {
		fail(c, apperr.E("validation_error", "API Key 的每分钟请求或每日流量额度无效", 422))
		return
	}
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	allowedModelIDs, err := normalizeOpenAPIModelIDs(cfg, body.AllowedModelIDs)
	if err != nil {
		fail(c, err)
		return
	}
	secret, err := newAPISecret()
	if err != nil {
		fail(c, err)
		return
	}
	key, err := store.InsertUserAPIKey(c.Request.Context(), s.St.Pool, &store.UserAPIKey{
		UserID: user.ID, KeyPrefix: secret[:min(18, len(secret))], KeyHash: hashAPISecret(secret), Label: body.Label,
		Scopes: scopes, AllowedModelIDs: allowedModelIDs, DailyTaskLimit: body.DailyTaskLimit,
		MonthlyTaskLimit: body.MonthlyTaskLimit, DailySpendLimitCents: body.DailySpendLimitCents,
		MonthlySpendLimitCents: body.MonthlySpendLimitCents, IPAllowlist: body.IPAllowlist,
		RateLimitPerMinute: body.RateLimitPerMinute, DailyByteLimit: body.DailyByteLimit, ExpiresAt: expiresAt,
	})
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	data := userAPIKeyDict(key, store.APIKeyUsageSummary{})
	data["secret"] = secret
	respondCreated(c, data)
}

func (s *Server) revokeMyAPIKey(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.RevokeUserAPIKey(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("api_key_not_found", "API Key 不存在或已撤销", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) rotateMyAPIKey(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	existing, err := store.GetUserAPIKey(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if existing == nil || existing.Status == "revoked" {
		fail(c, apperr.E("api_key_not_found", "API Key 不存在或已撤销", 404))
		return
	}
	secret, err := newAPISecret()
	if err != nil {
		fail(c, err)
		return
	}
	var replacement *store.UserAPIKey
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		var insertErr error
		replacement, insertErr = store.InsertUserAPIKey(c.Request.Context(), tx, &store.UserAPIKey{
			UserID: existing.UserID, KeyPrefix: secret[:min(18, len(secret))], KeyHash: hashAPISecret(secret),
			Label: existing.Label, Scopes: existing.Scopes, AllowedModelIDs: existing.AllowedModelIDs,
			DailyTaskLimit: existing.DailyTaskLimit, MonthlyTaskLimit: existing.MonthlyTaskLimit,
			DailySpendLimitCents: existing.DailySpendLimitCents, MonthlySpendLimitCents: existing.MonthlySpendLimitCents,
			IPAllowlist: existing.IPAllowlist, RateLimitPerMinute: existing.RateLimitPerMinute,
			DailyByteLimit: existing.DailyByteLimit, ExpiresAt: existing.ExpiresAt,
		})
		if insertErr != nil {
			return insertErr
		}
		_, insertErr = store.RevokeUserAPIKey(c.Request.Context(), tx, user.ID, existing.ID)
		return insertErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	data := userAPIKeyDict(replacement, store.APIKeyUsageSummary{})
	data["secret"] = secret
	respondCreated(c, data)
}

func (s *Server) openAPIModels(c *gin.Context) {
	key := openAPIKeyFromContext(c)
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": openAPIModelItems(cfg, key.AllowedModelIDs)})
}

func (s *Server) myOpenAPIModels(c *gin.Context) {
	if _, err := s.requireUser(c); err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": openAPIModelItems(cfg, nil)})
}

var allowedWebhookEvents = map[string]bool{
	"task.succeeded": true, "task.failed": true, "task.canceled": true,
}

func webhookEndpointDict(endpoint *store.APIWebhookEndpoint) gin.H {
	return gin.H{
		"id": endpoint.ID.String(), "label": endpoint.Label, "url": endpoint.URL,
		"events": endpoint.Events, "enabled": endpoint.Enabled,
		"createdAt": isoValue(endpoint.CreatedAt), "updatedAt": isoValue(endpoint.UpdatedAt),
	}
}

func normalizeWebhookEvents(values []string) ([]string, error) {
	if len(values) == 0 {
		values = []string{"task.succeeded", "task.failed", "task.canceled"}
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if !allowedWebhookEvents[value] {
			return nil, apperr.E("validation_error", "events: 包含不支持的事件", 422)
		}
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result, nil
}

func (s *Server) myWebhooks(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListAPIWebhookEndpoints(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, webhookEndpointDict(item))
	}
	ok(c, gin.H{"items": result})
}

type webhookInput struct {
	Label        string   `json:"label"`
	URL          string   `json:"url"`
	Events       []string `json:"events"`
	Enabled      *bool    `json:"enabled"`
	RotateSecret bool     `json:"rotateSecret"`
}

func validateWebhookInput(body webhookInput) (string, string, []string, error) {
	label, target := strings.TrimSpace(body.Label), strings.TrimSpace(body.URL)
	if label == "" || len([]rune(label)) > 80 {
		return "", "", nil, apperr.E("validation_error", "label: 须为 1-80 个字符", 422)
	}
	if len(target) > 2000 || netguard.ValidateURL(target, false, true) != nil {
		return "", "", nil, apperr.E("validation_error", "url: 必须是公网 HTTPS 地址", 422)
	}
	events, err := normalizeWebhookEvents(body.Events)
	return label, target, events, err
}

func (s *Server) createMyWebhook(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body webhookInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	count, err := store.CountAPIWebhookEndpoints(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if count >= 10 {
		fail(c, apperr.E("webhook_limit", "每个账号最多配置 10 个 Webhook", 422))
		return
	}
	label, target, events, err := validateWebhookInput(body)
	if err != nil {
		fail(c, err)
		return
	}
	secret, err := newAPISecret()
	if err != nil {
		fail(c, err)
		return
	}
	encrypted, err := settings.EncryptSecret(secret, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	endpoint, err := store.InsertAPIWebhookEndpoint(c.Request.Context(), s.St.Pool, &store.APIWebhookEndpoint{
		UserID: user.ID, Label: label, URL: target, SecretEncrypted: encrypted, Events: events, Enabled: enabled,
	})
	if err != nil {
		fail(c, err)
		return
	}
	data := webhookEndpointDict(endpoint)
	data["secret"] = secret
	respondCreated(c, data)
}

func (s *Server) patchMyWebhook(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	var body webhookInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	label, target, events, err := validateWebhookInput(body)
	if err != nil {
		fail(c, err)
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	secret, encrypted := "", ""
	if body.RotateSecret {
		secret, err = newAPISecret()
		if err == nil {
			encrypted, err = settings.EncryptSecret(secret, s.Cfg.AppSecret)
		}
		if err != nil {
			fail(c, err)
			return
		}
	}
	endpoint, err := store.UpdateAPIWebhookEndpoint(c.Request.Context(), s.St.Pool, user.ID, id, label, target, encrypted, events, enabled)
	if err != nil {
		fail(c, err)
		return
	}
	if endpoint == nil {
		fail(c, apperr.E("webhook_not_found", "Webhook 不存在", 404))
		return
	}
	data := webhookEndpointDict(endpoint)
	if secret != "" {
		data["secret"] = secret
	}
	ok(c, data)
}

func (s *Server) deleteMyWebhook(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.DeleteAPIWebhookEndpoint(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("webhook_not_found", "Webhook 不存在", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) myWebhookDeliveries(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListAPIWebhookDeliveries(c.Request.Context(), s.St.Pool, user.ID, 100)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) retryMyWebhookDelivery(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.RetryAPIWebhookDelivery(c.Request.Context(), s.St.Pool, user.ID, id, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("webhook_delivery_not_retryable", "投递记录不存在或当前无需重试", 404))
		return
	}
	ok(c, gin.H{"status": "pending"})
}
