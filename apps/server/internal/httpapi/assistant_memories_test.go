package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAssistantMemoryEndpoints(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	owner, ownerToken := env.newUserSession(t, "user")
	_, strangerToken := env.newUserSession(t, "user")
	decode := func(body []byte) map[string]any {
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Data
	}

	response := env.do(t, http.MethodPost, "/api/v1/assistant/memories", map[string]any{"kind": "brand", "title": "品牌色", "content": "雾霾蓝"}, ownerToken)
	if response.Code != http.StatusOK {
		t.Fatalf("create: %d %s", response.Code, response.Body.String())
	}
	created := decode(response.Body.Bytes())["memory"].(map[string]any)
	id := created["id"].(string)
	if created["source"] != assistantmemory.SourceUser {
		t.Fatalf("created = %#v", created)
	}
	if response := env.do(t, http.MethodPost, "/api/v1/assistant/memories", map[string]any{"kind": "secret", "title": "x"}, ownerToken); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid kind: %d", response.Code)
	}

	// A stranger sees none of it and can change none of it.
	if listed := decode(env.do(t, http.MethodGet, "/api/v1/assistant/memories", nil, strangerToken).Body.Bytes()); len(listed["items"].([]any)) != 0 {
		t.Fatalf("stranger list = %#v", listed)
	}
	if response := env.do(t, http.MethodPatch, "/api/v1/assistant/memories/"+id, map[string]any{"content": "红"}, strangerToken); response.Code != http.StatusNotFound {
		t.Fatalf("stranger patch: %d", response.Code)
	}
	if response := env.do(t, http.MethodDelete, "/api/v1/assistant/memories/"+id, nil, strangerToken); response.Code != http.StatusNotFound {
		t.Fatalf("stranger delete: %d", response.Code)
	}

	response = env.do(t, http.MethodPatch, "/api/v1/assistant/memories/"+id, map[string]any{"content": "雾霾蓝 #8FA3B8"}, ownerToken)
	if changed := decode(response.Body.Bytes()); response.Code != http.StatusOK || changed["previous"].(map[string]any)["content"] != "雾霾蓝" {
		t.Fatalf("patch: %d %s", response.Code, response.Body.String())
	}

	// A finished commerce set becomes a favourite; someone else's cannot.
	set, err := store.InsertCommerceSet(ctx, env.st.Pool, &store.CommerceSet{UserID: owner.ID, Brief: json.RawMessage(`{"productName":"保温杯"}`),
		Summary: "清爽白蓝", InputKeys: []string{"uploads/cup.png"}, ModelID: "img", Shots: []store.CommerceSetShot{{ID: "white", Label: "白底主图"}}})
	if err != nil {
		t.Fatal(err)
	}
	if response := env.do(t, http.MethodPost, "/api/v1/assistant/memories", map[string]any{"commerceSetId": set.ID.String()}, strangerToken); response.Code != http.StatusNotFound {
		t.Fatalf("stranger favourite: %d", response.Code)
	}
	response = env.do(t, http.MethodPost, "/api/v1/assistant/memories", map[string]any{"commerceSetId": set.ID.String()}, ownerToken)
	if favorite := decode(response.Body.Bytes())["memory"].(map[string]any); response.Code != http.StatusOK || favorite["kind"] != "favorite" || favorite["commerceSetId"] != set.ID.String() {
		t.Fatalf("favourite: %d %s", response.Code, response.Body.String())
	}

	if response := env.do(t, http.MethodPut, "/api/v1/assistant/memories/settings", map[string]any{"enabled": false}, ownerToken); response.Code != http.StatusOK {
		t.Fatalf("switch off: %d", response.Code)
	}
	listed := decode(env.do(t, http.MethodGet, "/api/v1/assistant/memories", nil, ownerToken).Body.Bytes())
	if listed["enabled"] != false || len(listed["items"].([]any)) != 2 {
		t.Fatalf("list while off = %#v", listed)
	}
	if response := env.do(t, http.MethodDelete, "/api/v1/assistant/memories/"+id, nil, ownerToken); response.Code != http.StatusOK {
		t.Fatalf("delete: %d", response.Code)
	}
}
