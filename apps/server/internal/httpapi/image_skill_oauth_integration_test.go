package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
)

var approvalTokenPattern = regexp.MustCompile(`name="approval_token" value="([^"]+)"`)

func TestImageSkillOAuthLoginOriginUsesDevelopmentFrontend(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{Cfg: &config.Config{AppEnv: "development"}}

	for _, testCase := range []struct {
		host string
		want string
	}{
		{host: "127.0.0.1:8000", want: "http://127.0.0.1:3105"},
		{host: "localhost:8000", want: "http://localhost:3105"},
	} {
		t.Run(testCase.host, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://"+testCase.host+"/oauth/authorize", nil)
			request.Host = testCase.host
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = request
			if got := server.imageSkillOAuthLoginOrigin(context); got != testCase.want {
				t.Fatalf("imageSkillOAuthLoginOrigin() = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestImageSkillOAuthDCRAuthorizeAndTokenExchange(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := t.Context()
	clientResponse := env.serve(t, env.request(http.MethodPost, "/oauth/register", "application/json", "", strings.NewReader(`{"client_name":"Codex Test","redirect_uris":["http://127.0.0.1/callback/test"]}`)))
	if clientResponse.Code != http.StatusCreated {
		t.Fatalf("register status=%d body=%s", clientResponse.Code, clientResponse.Body.String())
	}
	var client map[string]any
	if err := json.Unmarshal(clientResponse.Body.Bytes(), &client); err != nil {
		t.Fatal(err)
	}
	clientID := client["client_id"].(string)
	verifier := strings.Repeat("v", 43)
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	state := "oauth-state"
	authorizeQuery := url.Values{
		"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {"http://127.0.0.1/callback/test"},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "scope": {imageSkillOAuthScope}, "state": {state},
	}
	sessionToken := auth.NewSessionToken()
	if err := store.InsertSession(ctx, env.st.Pool, env.user.ID, auth.HashToken(sessionToken), time.Now().UTC().Add(24*time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	get := env.request(http.MethodGet, "/oauth/authorize?"+authorizeQuery.Encode(), "", "", nil)
	get.AddCookie(&http.Cookie{Name: env.srv.Cfg.SessionCookieName, Value: sessionToken})
	consent := env.serve(t, get)
	if consent.Code != http.StatusOK {
		t.Fatalf("authorize status=%d body=%s", consent.Code, consent.Body.String())
	}
	approval := approvalTokenPattern.FindStringSubmatch(consent.Body.String())
	if len(approval) != 2 {
		t.Fatalf("consent page omitted approval token: %s", consent.Body.String())
	}
	form := url.Values{"approval_token": {approval[1]}, "decision": {"approve"}}
	approve := env.request(http.MethodPost, "/oauth/authorize", "application/x-www-form-urlencoded", "", strings.NewReader(form.Encode()))
	approve.AddCookie(&http.Cookie{Name: env.srv.Cfg.SessionCookieName, Value: sessionToken})
	approved := env.serve(t, approve)
	if approved.Code != http.StatusSeeOther {
		t.Fatalf("approve status=%d body=%s", approved.Code, approved.Body.String())
	}
	callback, err := url.Parse(approved.Header().Get("Location"))
	if err != nil || callback.Query().Get("state") != state || callback.Query().Get("code") == "" {
		t.Fatalf("callback=%s error=%v", approved.Header().Get("Location"), err)
	}
	code := callback.Query().Get("code")
	tokenForm := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {clientID}, "redirect_uri": {"http://127.0.0.1/callback/test"}, "code_verifier": {verifier}}
	tokenResponse := env.serve(t, env.request(http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", "", strings.NewReader(tokenForm.Encode())))
	if tokenResponse.Code != http.StatusOK {
		t.Fatalf("token status=%d body=%s", tokenResponse.Code, tokenResponse.Body.String())
	}
	var token map[string]any
	if err := json.Unmarshal(tokenResponse.Body.Bytes(), &token); err != nil || token["access_token"] == "" {
		t.Fatalf("token=%s error=%v", tokenResponse.Body.String(), err)
	}
	accessToken := token["access_token"].(string)
	modelsRequest := env.request(http.MethodGet, "/v1/models", "", "", nil)
	modelsRequest.Header.Set("Authorization", "Bearer "+accessToken)
	modelsResponse := env.serve(t, modelsRequest)
	if modelsResponse.Code != http.StatusOK || !strings.Contains(modelsResponse.Body.String(), `"object":"list"`) {
		t.Fatalf("Images API with OAuth token status=%d body=%s", modelsResponse.Code, modelsResponse.Body.String())
	}
	replay := env.serve(t, env.request(http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", "", strings.NewReader(tokenForm.Encode())))
	if replay.Code != http.StatusBadRequest || !strings.Contains(replay.Body.String(), `"error":"invalid_grant"`) {
		t.Fatalf("authorization code replay status=%d body=%s", replay.Code, replay.Body.String())
	}
}
