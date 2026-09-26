package httpapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	imageSkillOAuthScope       = "images"
	imageSkillOAuthCodeTTL     = 10 * time.Minute
	imageSkillOAuthTokenTTL    = 180 * 24 * time.Hour
	imageSkillOAuthClientTTL   = 10 * 365 * 24 * time.Hour
	imageSkillOAuthKeyLabel    = "StarClouds Image Skill"
	imageSkillOAuthMaxStateLen = 2048
)

var imageSkillPKCEPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

type imageSkillOAuthClient struct {
	Name         string   `json:"name"`
	RedirectURIs []string `json:"redirect_uris"`
	ExpiresAt    int64    `json:"expires_at"`
}

type imageSkillOAuthApproval struct {
	UserID        string `json:"user_id"`
	ClientID      string `json:"client_id"`
	RedirectURI   string `json:"redirect_uri"`
	State         string `json:"state"`
	CodeChallenge string `json:"code_challenge"`
	Scope         string `json:"scope"`
	ExpiresAt     int64  `json:"expires_at"`
}

var imageSkillOAuthConsentPage = template.Must(template.New("image-skill-oauth-consent").Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权星空云绘图片工具</title></head>
<body><main><h1>授权 StarClouds Image Skill</h1><p>应用：{{.ClientName}}</p><p>登录账号：{{.UserEmail}}</p><p>授权后，本地图片技能可以读取图片模型并通过开发者 API 创建和编辑图片。应用无法读取你的密码。</p>
<form method="post" action="/oauth/authorize"><input type="hidden" name="approval_token" value="{{.ApprovalToken}}"><button type="submit" name="decision" value="approve">允许并返回应用</button><button type="submit" name="decision" value="deny">取消</button></form></main></body></html>`))

func imageSkillOAuthRandomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (s *Server) signImageSkillOAuthValue(kind string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(s.Cfg.AppSecret))
	_, _ = mac.Write([]byte(kind + "." + payload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return kind + "." + payload + "." + signature, nil
}

func (s *Server) verifyImageSkillOAuthValue(token, kind string, destination any) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != kind {
		return false
	}
	mac := hmac.New(sha256.New, []byte(s.Cfg.AppSecret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	expected := mac.Sum(nil)
	provided, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || subtle.ConstantTimeCompare(expected, provided) != 1 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	return err == nil && json.Unmarshal(raw, destination) == nil
}

func validImageSkillOAuthRedirect(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Fragment != "" || parsed.User != nil || parsed.Host == "" {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme != "http" {
		return false
	}
	host := strings.Trim(strings.ToLower(parsed.Hostname()), "[]")
	return host == "127.0.0.1" || host == "::1" || host == "localhost"
}

func imageSkillOAuthRedirectAllowed(client imageSkillOAuthClient, redirectURI string) bool {
	for _, allowed := range client.RedirectURIs {
		if allowed == redirectURI {
			return true
		}
	}
	return false
}

func requestPublicOrigin(c *gin.Context) string {
	scheme := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0])
	if scheme != "http" && scheme != "https" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + c.Request.Host
}

func (s *Server) imageSkillOAuthLoginOrigin(c *gin.Context) string {
	origin := requestPublicOrigin(c)
	// In local development the API is served on :8000 while the user web app
	// is Vite on :3105. Keep the OAuth issuer on the API origin, but send the
	// interactive login page to the frontend that actually owns /auth.
	if s.Cfg.AppEnv == "development" {
		if parsed, err := url.Parse(origin); err == nil && (parsed.Port() == "8000" || parsed.Port() == "") {
			switch parsed.Hostname() {
			case "127.0.0.1":
				return "http://127.0.0.1:3105"
			case "localhost":
				return "http://localhost:3105"
			}
		}
	}
	return origin
}

func (s *Server) imageSkillOAuthAuthorizationServer(c *gin.Context) {
	origin := requestPublicOrigin(c)
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, gin.H{
		"issuer": origin, "authorization_endpoint": origin + "/oauth/authorize",
		"token_endpoint": origin + "/oauth/token", "registration_endpoint": origin + "/oauth/register",
		"response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code"},
		"code_challenge_methods_supported": []string{"S256"}, "token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported": []string{imageSkillOAuthScope},
	})
}

func (s *Server) registerImageSkillOAuthClient(c *gin.Context) {
	var request struct {
		ClientName              string   `json:"client_name"`
		RedirectURIs            []string `json:"redirect_uris"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	}
	if c.ShouldBindJSON(&request) != nil || len(request.RedirectURIs) < 1 || len(request.RedirectURIs) > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_client_metadata", "error_description": "redirect_uris is required"})
		return
	}
	redirects := make([]string, 0, len(request.RedirectURIs))
	seen := map[string]bool{}
	for _, redirect := range request.RedirectURIs {
		redirect = strings.TrimSpace(redirect)
		if !validImageSkillOAuthRedirect(redirect) || seen[redirect] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_redirect_uri", "error_description": "redirect_uri is invalid or duplicated"})
			return
		}
		seen[redirect] = true
		redirects = append(redirects, redirect)
	}
	if request.TokenEndpointAuthMethod != "" && request.TokenEndpointAuthMethod != "none" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_client_metadata", "error_description": "only public PKCE clients are supported"})
		return
	}
	name := strings.TrimSpace(request.ClientName)
	if name == "" {
		name = "Codex"
	}
	if runes := []rune(name); len(runes) > 80 {
		name = string(runes[:80])
	}
	issuedAt := time.Now().UTC()
	client := imageSkillOAuthClient{Name: name, RedirectURIs: redirects, ExpiresAt: issuedAt.Add(imageSkillOAuthClientTTL).Unix()}
	clientID, err := s.signImageSkillOAuthValue("imageskillclient", client)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"client_id": clientID, "client_id_issued_at": issuedAt.Unix(), "client_name": name,
		"redirect_uris": redirects, "token_endpoint_auth_method": "none",
		"grant_types": []string{"authorization_code"}, "response_types": []string{"code"},
	})
}

func (s *Server) parseImageSkillOAuthRequest(c *gin.Context) (imageSkillOAuthClient, imageSkillOAuthApproval, string, bool) {
	clientID := strings.TrimSpace(c.Query("client_id"))
	redirectURI := strings.TrimSpace(c.Query("redirect_uri"))
	state := c.Query("state")
	challenge := strings.TrimSpace(c.Query("code_challenge"))
	scope := strings.TrimSpace(c.Query("scope"))
	if scope == "" {
		scope = imageSkillOAuthScope
	}
	var client imageSkillOAuthClient
	valid := c.Query("response_type") == "code" && len(state) <= imageSkillOAuthMaxStateLen && scope == imageSkillOAuthScope &&
		c.Query("code_challenge_method") == "S256" && imageSkillPKCEPattern.MatchString(challenge) &&
		s.verifyImageSkillOAuthValue(clientID, "imageskillclient", &client) && client.ExpiresAt > time.Now().Unix() &&
		imageSkillOAuthRedirectAllowed(client, redirectURI)
	approval := imageSkillOAuthApproval{ClientID: clientID, RedirectURI: redirectURI, State: state, CodeChallenge: challenge, Scope: scope}
	return client, approval, redirectURI, valid
}

func (s *Server) authorizeImageSkillOAuth(c *gin.Context) {
	client, approval, _, valid := s.parseImageSkillOAuthRequest(c)
	if !valid {
		c.String(http.StatusBadRequest, "OAuth authorization request is invalid")
		return
	}
	user, err := s.currentUser(c)
	if err != nil {
		c.String(http.StatusInternalServerError, "Unable to read login session")
		return
	}
	if user == nil {
		returnTo := c.Request.URL.RequestURI()
		loginURL := s.imageSkillOAuthLoginOrigin(c) + "/auth?mode=login&redirect=" + url.QueryEscape(returnTo)
		c.Redirect(http.StatusFound, loginURL)
		return
	}
	approval.UserID = user.ID.String()
	approval.ExpiresAt = time.Now().Add(imageSkillOAuthCodeTTL).Unix()
	token, err := s.signImageSkillOAuthValue("imageskillapproval", approval)
	if err != nil {
		c.String(http.StatusInternalServerError, "Unable to prepare authorization")
		return
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Status(http.StatusOK)
	_ = imageSkillOAuthConsentPage.Execute(c.Writer, gin.H{"ClientName": client.Name, "UserEmail": user.Email, "ApprovalToken": token})
}

func redirectImageSkillOAuthResult(c *gin.Context, redirectURI string, values url.Values) {
	parsed, err := url.Parse(redirectURI)
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid redirect URI")
		return
	}
	query := parsed.Query()
	for key, items := range values {
		for _, value := range items {
			query.Add(key, value)
		}
	}
	parsed.RawQuery = query.Encode()
	// 303 is required after the consent form POST so the OAuth client follows
	// the callback with GET rather than replaying the POST body.
	c.Header("Cache-Control", "no-store")
	c.Redirect(http.StatusSeeOther, parsed.String())
}

func (s *Server) approveImageSkillOAuth(c *gin.Context) {
	if c.Request.ParseForm() != nil {
		c.String(http.StatusBadRequest, "Invalid authorization response")
		return
	}
	var approval imageSkillOAuthApproval
	if !s.verifyImageSkillOAuthValue(c.PostForm("approval_token"), "imageskillapproval", &approval) || approval.ExpiresAt <= time.Now().Unix() {
		c.String(http.StatusBadRequest, "Authorization has expired")
		return
	}
	userID, err := uuid.Parse(approval.UserID)
	if err != nil {
		c.String(http.StatusBadRequest, "Authorization has expired")
		return
	}
	user, err := store.GetUserByID(c.Request.Context(), s.St.Pool, userID)
	if err != nil || user == nil || user.Status != "active" || user.Role != "user" {
		c.String(http.StatusUnauthorized, "StarClouds account is unavailable")
		return
	}
	var client imageSkillOAuthClient
	if !s.verifyImageSkillOAuthValue(approval.ClientID, "imageskillclient", &client) || !imageSkillOAuthRedirectAllowed(client, approval.RedirectURI) {
		c.String(http.StatusBadRequest, "OAuth client is invalid")
		return
	}
	if c.PostForm("decision") != "approve" {
		redirectImageSkillOAuthResult(c, approval.RedirectURI, url.Values{"error": {"access_denied"}, "state": {approval.State}})
		return
	}
	code, err := imageSkillOAuthRandomToken()
	if err != nil {
		c.String(http.StatusInternalServerError, "Unable to create authorization code")
		return
	}
	if err := store.InsertImageSkillOAuthAuthorizationCode(c.Request.Context(), s.St.Pool, store.ImageSkillOAuthAuthorizationCode{
		CodeHash: hashAPISecret(code), UserID: user.ID, ClientID: approval.ClientID,
		RedirectURI: approval.RedirectURI, CodeChallenge: approval.CodeChallenge,
		Scope: approval.Scope, ExpiresAt: time.Now().UTC().Add(imageSkillOAuthCodeTTL),
	}); err != nil {
		c.String(http.StatusInternalServerError, "Unable to store authorization code")
		return
	}
	redirectImageSkillOAuthResult(c, approval.RedirectURI, url.Values{"code": {code}, "state": {approval.State}})
}

func imageSkillOAuthTokenError(c *gin.Context, code, description string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusBadRequest, gin.H{"error": code, "error_description": description})
}

func (s *Server) exchangeImageSkillOAuthToken(c *gin.Context) {
	if c.Request.ParseForm() != nil || c.PostForm("grant_type") != "authorization_code" {
		imageSkillOAuthTokenError(c, "unsupported_grant_type", "Only authorization_code is supported")
		return
	}
	code := strings.TrimSpace(c.PostForm("code"))
	clientID := strings.TrimSpace(c.PostForm("client_id"))
	redirectURI := strings.TrimSpace(c.PostForm("redirect_uri"))
	verifier := strings.TrimSpace(c.PostForm("code_verifier"))
	if code == "" || clientID == "" || redirectURI == "" || !imageSkillPKCEPattern.MatchString(verifier) {
		imageSkillOAuthTokenError(c, "invalid_grant", "Authorization code, client, redirect URI, or PKCE verifier is invalid")
		return
	}
	stored, err := store.ConsumeImageSkillOAuthAuthorizationCode(c.Request.Context(), s.St.Pool, hashAPISecret(code), time.Now().UTC())
	if err != nil || stored == nil || stored.ClientID != clientID || stored.RedirectURI != redirectURI || stored.Scope != imageSkillOAuthScope {
		imageSkillOAuthTokenError(c, "invalid_grant", "Authorization code is invalid, expired, or already used")
		return
	}
	digest := sha256.Sum256([]byte(verifier))
	expectedChallenge := base64.RawURLEncoding.EncodeToString(digest[:])
	if subtle.ConstantTimeCompare([]byte(expectedChallenge), []byte(stored.CodeChallenge)) != 1 {
		imageSkillOAuthTokenError(c, "invalid_grant", "PKCE verification failed")
		return
	}
	user, err := store.GetUserByID(c.Request.Context(), s.St.Pool, stored.UserID)
	if err != nil || user == nil || user.Status != "active" || user.Role != "user" {
		imageSkillOAuthTokenError(c, "access_denied", "The StarClouds account is unavailable")
		return
	}
	activeKeys, err := store.CountActiveUserAPIKeys(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil || activeKeys >= 10 {
		imageSkillOAuthTokenError(c, "access_denied", "The account has reached its active API credential limit")
		return
	}
	secret, err := newAPISecret()
	if err != nil {
		imageSkillOAuthTokenError(c, "server_error", "Unable to issue access token")
		return
	}
	expiresAt := time.Now().UTC().Add(imageSkillOAuthTokenTTL)
	_, err = store.InsertUserAPIKey(c.Request.Context(), s.St.Pool, &store.UserAPIKey{
		UserID: user.ID, KeyPrefix: secret[:min(18, len(secret))], KeyHash: hashAPISecret(secret), Label: imageSkillOAuthKeyLabel,
		Scopes: []string{"models:read", "files:write", "tasks:write", "tasks:read"}, AllowedModelIDs: []string{},
		DailyTaskLimit: 100, MonthlyTaskLimit: 2000, DailySpendLimitCents: 10000, MonthlySpendLimitCents: 200000,
		RateLimitPerMinute: 120, DailyByteLimit: 2 << 30, ExpiresAt: &expiresAt,
	})
	if err != nil {
		imageSkillOAuthTokenError(c, "server_error", "Unable to issue access token")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"access_token": secret, "token_type": "Bearer", "expires_in": int64(imageSkillOAuthTokenTTL / time.Second), "scope": imageSkillOAuthScope,
	})
}
