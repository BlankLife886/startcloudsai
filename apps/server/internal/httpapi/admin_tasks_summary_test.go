package httpapi

import (
	"net/http"
	"testing"
)

func TestAdminTasksOptionalSummary(t *testing.T) {
	env := newCommunityEnv(t)
	user, _ := env.newUserSession(t, "user")
	_, token := env.newUserSession(t, "admin")
	env.newSucceededTask(t, user.ID)
	for _, suffix := range []string{"", "?summary=false"} {
		response := env.do(t, http.MethodGet, "/api/v1/admin/tasks"+suffix, nil, token)
		data, code := decode(t, response)
		if response.Code != 200 || code != "" {
			t.Fatalf("response %d: %s", response.Code, response.Body.String())
		}
		_, hasSummary := data["summary"]
		if hasSummary != (suffix == "") {
			t.Fatalf("unexpected summary presence for %q", suffix)
		}
		if len(data["items"].([]any)) != 1 {
			t.Fatalf("lost task data for %q", suffix)
		}
	}
}
