package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const (
	ctxOpenAPIKey  = "openAPIKey"
	ctxOpenAPIUser = "openAPIUser"
)

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

func (s *Server) openAPIOnly(handler gin.HandlerFunc) gin.HandlerFunc {
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
			fail(c, apperr.E("api_key_invalid", "API Key 格式不正确：应以 sk-sc- 开头，请检查是否完整复制", 401))
			return
		}
		key, err := store.GetUserAPIKeyByHash(c.Request.Context(), s.St.Pool, hashAPISecret(secret))
		if err != nil {
			fail(c, err)
			return
		}
		now := time.Now().UTC()
		if err := apiKeyUsableError(key, now); err != nil {
			fail(c, err)
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
		c.Request = c.Request.WithContext(wallet.WithSubscriptionScope(c.Request.Context(), "api", ""))
		handler(c)
		statusCode := c.Writer.Status()
		responseBytes := int64(max(c.Writer.Size(), 0))
		if responseBytes > 0 {
			if err := s.takeUsageLimit(c, "api-key-bytes-day", key.ID.String(), key.DailyByteLimit, responseBytes, 24*time.Hour); err != nil {
				s.freezeAPIKeyForRisk(c, key, "API Key 单日传输字节额度已用完")
			}
		}
		if apiKeyServerErrorCountsAsAbuse(statusCode, c.GetString(ctxPlatformErrorKey)) && s.UsageLimiter != nil {
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

// apiKeyUsableError explains why a Key cannot authenticate. A frozen, paused or
// expired Key gets its own code so the owner knows to unfreeze or rotate it
// rather than assuming the secret was mistyped.
func apiKeyUsableError(key *store.UserAPIKey, now time.Time) error {
	switch {
	case key == nil || key.Status == "revoked":
		return apperr.E("api_key_invalid", "API Key 不存在或已被撤销，请在控制台确认这把 Key 是否仍可用", 401)
	case key.Status == "frozen":
		message := "API Key 已被风控冻结，请在API 调用控制台查看原因并申请解冻"
		if key.FreezeReason != nil && strings.TrimSpace(*key.FreezeReason) != "" {
			message += "（原因：" + strings.TrimSpace(*key.FreezeReason) + "）"
		}
		return apperr.E("api_key_frozen", message, 403)
	case key.Status == "paused":
		return apperr.E("api_key_paused", "API Key 已被停用，请在API 调用控制台重新启用", 403)
	case key.Status != "active":
		return apperr.E("api_key_invalid", "API Key 已失效", 401)
	case key.ExpiresAt != nil && !key.ExpiresAt.After(now):
		return apperr.E("api_key_expired", "API Key 已过期，请创建或轮换新的 Key", 401)
	}
	return nil
}

// apiKeyServerErrorCountsAsAbuse limits the automatic freeze to failures the
// caller can plausibly provoke. Upstream outages, upstream timeouts and our own
// dependency failures are not the Key owner's behaviour and must not freeze it.
func apiKeyServerErrorCountsAsAbuse(status int, code string) bool {
	if status != http.StatusInternalServerError {
		return false
	}
	return code == "" || code == "internal_error"
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

// apiKeyDisplayPrefix keeps "sk-sc-" plus four secret characters: enough to
// tell keys apart without echoing a long slice of the secret back to clients.
func apiKeyDisplayPrefix(stored string) string {
	const visible = len("sk-sc-") + 4
	return stored[:min(visible, len(stored))]
}

func userAPIKeyDict(key *store.UserAPIKey, usage store.APIKeyUsageSummary) gin.H {
	return gin.H{
		"id": key.ID.String(), "prefix": apiKeyDisplayPrefix(key.KeyPrefix), "label": key.Label, "status": key.Status,
		"allowedModelIds": key.AllowedAPIModelIDs,
		"dailyTaskLimit":  key.DailyTaskLimit, "monthlyTaskLimit": key.MonthlyTaskLimit,
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
	settings, err := s.parseAPIKeySettings(c, &body)
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
		UserID: user.ID, KeyPrefix: secret[:min(18, len(secret))], KeyHash: hashAPISecret(secret), Label: settings.Label,
		AllowedAPIModelIDs: settings.AllowedAPIModelIDs, DailyTaskLimit: settings.DailyTaskLimit,
		MonthlyTaskLimit: settings.MonthlyTaskLimit, DailySpendLimitCents: settings.DailySpendLimitCents,
		MonthlySpendLimitCents: settings.MonthlySpendLimitCents, IPAllowlist: settings.IPAllowlist,
		RateLimitPerMinute: settings.RateLimitPerMinute, DailyByteLimit: settings.DailyByteLimit, ExpiresAt: settings.ExpiresAt,
	})
	if err != nil {
		// Database errors carry table and constraint names; keep them in the log.
		log.Printf("developer API key insert failed user_id=%s: %v", user.ID, err)
		fail(c, apperr.E("validation_error", "API Key 设置无效，请检查额度、有效期和白名单后重试", 422))
		return
	}
	data := userAPIKeyDict(key, store.APIKeyUsageSummary{})
	data["secret"] = secret
	respondCreated(c, data)
}

func (s *Server) patchMyAPIKey(c *gin.Context) {
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
	var body createAPIKeyInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	settings, err := s.parseAPIKeySettings(c, &body)
	if err != nil {
		fail(c, err)
		return
	}
	key, err := store.UpdateUserAPIKey(c.Request.Context(), s.St.Pool, user.ID, id, &store.UserAPIKey{
		Label: settings.Label, AllowedAPIModelIDs: settings.AllowedAPIModelIDs,
		DailyTaskLimit: settings.DailyTaskLimit, MonthlyTaskLimit: settings.MonthlyTaskLimit,
		DailySpendLimitCents: settings.DailySpendLimitCents, MonthlySpendLimitCents: settings.MonthlySpendLimitCents,
		IPAllowlist: settings.IPAllowlist, RateLimitPerMinute: settings.RateLimitPerMinute,
		DailyByteLimit: settings.DailyByteLimit, ExpiresAt: settings.ExpiresAt,
	})
	if err != nil {
		fail(c, err)
		return
	}
	if key == nil {
		fail(c, apperr.E("api_key_not_found", "API Key 不存在或已撤销", 404))
		return
	}
	usage, err := store.GetAPIKeyUsageSummary(c.Request.Context(), s.St.Pool, key.ID, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, userAPIKeyDict(key, usage))
}

type apiKeySettings struct {
	Label                  string
	AllowedAPIModelIDs     []string
	DailyTaskLimit         int
	MonthlyTaskLimit       int
	DailySpendLimitCents   int64
	MonthlySpendLimitCents int64
	IPAllowlist            []string
	RateLimitPerMinute     int
	DailyByteLimit         int64
	ExpiresAt              *time.Time
}

func (s *Server) parseAPIKeySettings(c *gin.Context, body *createAPIKeyInput) (*apiKeySettings, error) {
	body.Label = strings.TrimSpace(body.Label)
	if body.Label == "" || len([]rune(body.Label)) > 80 {
		return nil, apperr.E("validation_error", "label: 须为 1-80 个字符", 422)
	}
	var expiresAt *time.Time
	if body.ExpiresAt != nil && strings.TrimSpace(*body.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ExpiresAt))
		if err != nil || !parsed.After(time.Now().UTC()) {
			return nil, apperr.E("validation_error", "expiresAt: 必须是未来的 RFC3339 时间", 422)
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
		return nil, apperr.E("validation_error", "ipAllowlist: 最多 20 项", 422)
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
				return nil, apperr.E("validation_error", "ipAllowlist: 仅支持 IP 或 CIDR", 422)
			}
		}
		if !seenIPs[value] {
			seenIPs[value] = true
			allowlist = append(allowlist, value)
		}
	}
	if body.DailyTaskLimit < 1 || body.DailyTaskLimit > 100000 ||
		body.MonthlyTaskLimit < body.DailyTaskLimit || body.MonthlyTaskLimit > 1000000 ||
		body.DailySpendLimitCents < 1 || body.DailySpendLimitCents > 1000000000 ||
		body.MonthlySpendLimitCents < body.DailySpendLimitCents || body.MonthlySpendLimitCents > 10000000000 {
		return nil, apperr.E("validation_error", "API Key 的日/月任务或积分额度无效", 422)
	}
	if body.RateLimitPerMinute < 1 || body.RateLimitPerMinute > 10000 ||
		body.DailyByteLimit < 1<<20 || body.DailyByteLimit > 1<<40 {
		return nil, apperr.E("validation_error", "API Key 的每分钟请求或每日流量额度无效", 422)
	}
	entries, err := s.developerCatalog(c.Request.Context())
	if err != nil {
		return nil, err
	}
	apiModelIDs, err := normalizeAPIModelIDs(entries, body.AllowedModelIDs)
	if err != nil {
		return nil, err
	}
	return &apiKeySettings{
		Label: body.Label, AllowedAPIModelIDs: apiModelIDs,
		DailyTaskLimit: body.DailyTaskLimit, MonthlyTaskLimit: body.MonthlyTaskLimit,
		DailySpendLimitCents: body.DailySpendLimitCents, MonthlySpendLimitCents: body.MonthlySpendLimitCents,
		IPAllowlist: allowlist, RateLimitPerMinute: body.RateLimitPerMinute,
		DailyByteLimit: body.DailyByteLimit, ExpiresAt: expiresAt,
	}, nil
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

// pauseMyAPIKey and resumeMyAPIKey let the owner stop a Key and start it again
// without changing its secret; a frozen or revoked Key is left alone.
func (s *Server) pauseMyAPIKey(c *gin.Context)  { s.setMyAPIKeyPaused(c, true) }
func (s *Server) resumeMyAPIKey(c *gin.Context) { s.setMyAPIKeyPaused(c, false) }

func (s *Server) setMyAPIKeyPaused(c *gin.Context, paused bool) {
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
	key, err := store.SetUserAPIKeyPaused(c.Request.Context(), s.St.Pool, user.ID, id, paused)
	if err != nil {
		fail(c, err)
		return
	}
	if key == nil {
		message := "只有可用的 Key 可以停用"
		if !paused {
			message = "只有已停用的 Key 可以重新启用"
		}
		fail(c, apperr.E("api_key_state_conflict", message, 409))
		return
	}
	usage, err := store.GetAPIKeyUsageSummary(c.Request.Context(), s.St.Pool, key.ID, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, userAPIKeyDict(key, usage))
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
		var currentStatus string
		if err := tx.QueryRow(c.Request.Context(), `SELECT status FROM user_api_keys WHERE id=$1 AND user_id=$2 FOR UPDATE`, id, user.ID).Scan(&currentStatus); err != nil {
			return err
		}
		if currentStatus != "active" {
			return apperr.E("api_key_not_active", "仅可轮换有效 Key，已冻结的 Key 请联系管理员", 403)
		}
		var insertErr error
		replacement, insertErr = store.InsertUserAPIKey(c.Request.Context(), tx, &store.UserAPIKey{
			UserID: existing.UserID, KeyPrefix: secret[:min(18, len(secret))], KeyHash: hashAPISecret(secret),
			Label: existing.Label, AllowedAPIModelIDs: existing.AllowedAPIModelIDs,
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
	entries, err := s.developerCatalog(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": developerModelItems(entries, cfg)})
}
