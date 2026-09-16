package httpapi

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func decodeSkillData(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var envelope struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode response: %v body=%s", err, body)
	}
	return envelope.Data
}

// 后台录入官方词条，用户端能看到并装载；官方词条对用户只读。
func TestImageSkillLibraryFlowFromAdminToUser(t *testing.T) {
	env := newCommunityEnv(t)
	_, admin := env.newUserSession(t, "admin")
	_, token := env.newUserSession(t, "user")

	r := env.do(t, "POST", "/api/v1/admin/image-skills", map[string]any{
		"name":        "干净棚拍",
		"description": "统一棚拍风格",
		"instruction": "使用柔和顶光，背景纯净，主体居中。",
		"taskTypes":   []string{"t2i"},
	}, admin)
	if r.Code != 200 {
		t.Fatalf("create official skill: %d %s", r.Code, r.Body.String())
	}
	official := decodeSkillData(t, r.Body.Bytes())
	if official["official"] != true {
		t.Fatalf("后台录入的词条未标记为官方: %+v", official)
	}
	skillID := official["id"].(string)

	// 用户端拿到官方词条。
	r = env.do(t, "GET", "/api/v1/me/image-skills?taskType=t2i", nil, token)
	if r.Code != 200 {
		t.Fatalf("list user skills: %d %s", r.Code, r.Body.String())
	}
	items := decodeSkillData(t, r.Body.Bytes())["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("用户端未拿到官方词条: %+v", items)
	}

	// 官方词条对用户只读。
	if r := env.do(t, "PATCH", "/api/v1/me/image-skills/"+skillID, map[string]any{"name": "改名"}, token); r.Code != 404 {
		t.Fatalf("用户改动了官方词条: %d %s", r.Code, r.Body.String())
	}
	if r := env.do(t, "DELETE", "/api/v1/me/image-skills/"+skillID, nil, token); r.Code != 404 {
		t.Fatalf("用户删除了官方词条: %d %s", r.Code, r.Body.String())
	}

	// 装载到全局后，所有生图页面都带上它。
	if r := env.do(t, "PUT", "/api/v1/me/skill-bindings/global", map[string]any{"skillIds": []string{skillID}}, token); r.Code != 200 {
		t.Fatalf("bind global: %d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "GET", "/api/v1/me/image-skills/resolved?taskType=t2i", nil, token)
	if r.Code != 200 {
		t.Fatalf("resolve: %d %s", r.Code, r.Body.String())
	}
	resolved := decodeSkillData(t, r.Body.Bytes())["items"].([]any)
	if len(resolved) != 1 {
		t.Fatalf("全局装载未生效: %+v", resolved)
	}
	if first := resolved[0].(map[string]any); first["instruction"] == "" {
		t.Fatalf("解析结果缺少拼接所需的 instruction: %+v", first)
	}

	// 未知生图页面要被拒绝。
	if r := env.do(t, "GET", "/api/v1/me/image-skills/resolved?taskType=nope", nil, token); r.Code != 422 {
		t.Fatalf("未知 taskType 未被拒: %d %s", r.Code, r.Body.String())
	}
	if r := env.do(t, "PUT", "/api/v1/me/skill-bindings/nope", map[string]any{"skillIds": []string{skillID}}, token); r.Code != 422 {
		t.Fatalf("未知装载位未被拒: %d %s", r.Code, r.Body.String())
	}

	// 后台停用后，已装载的词条立即不再生效。
	if r := env.do(t, "PATCH", "/api/v1/admin/image-skills/"+skillID, map[string]any{"active": false}, admin); r.Code != 200 {
		t.Fatalf("disable: %d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "GET", "/api/v1/me/image-skills/resolved?taskType=t2i", nil, token)
	if left := decodeSkillData(t, r.Body.Bytes())["items"].([]any); len(left) != 0 {
		t.Fatalf("停用后仍在生效: %+v", left)
	}
}

// 用户自建词条只属于自己，且页面绑定覆盖全局。
func TestUserOwnedSkillIsolationAndPageOverride(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	mine, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")

	r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name":        "我的风格",
		"instruction": "偏冷色调，低饱和。",
	}, token)
	if r.Code != 200 {
		t.Fatalf("create own skill: %d %s", r.Code, r.Body.String())
	}
	ownData := decodeSkillData(t, r.Body.Bytes())
	if ownData["official"] != false {
		t.Fatalf("自建词条被标记为官方: %+v", ownData)
	}
	ownID := ownData["id"].(string)

	// 别人看不到也改不了我的词条。
	r = env.do(t, "GET", "/api/v1/me/image-skills", nil, otherToken)
	if items := decodeSkillData(t, r.Body.Bytes())["items"].([]any); len(items) != 0 {
		t.Fatalf("自建词条泄漏给了其他用户: %+v", items)
	}
	if r := env.do(t, "PATCH", "/api/v1/me/image-skills/"+ownID, map[string]any{"name": "篡改"}, otherToken); r.Code != 404 {
		t.Fatalf("其他用户改动了我的词条: %d %s", r.Code, r.Body.String())
	}
	if r := env.do(t, "PUT", "/api/v1/me/skill-bindings/global", map[string]any{"skillIds": []string{ownID}}, otherToken); r.Code != 404 {
		t.Fatalf("其他用户装载了我的词条: %d %s", r.Code, r.Body.String())
	}

	// 页面绑定覆盖全局。
	pageSkill := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "涂色专用", "instruction": "线稿清晰，配色明快。", "taskTypes": []string{"coloring"},
	}, token)
	pageID := decodeSkillData(t, pageSkill.Body.Bytes())["id"].(string)
	if r := env.do(t, "PUT", "/api/v1/me/skill-bindings/global", map[string]any{"skillIds": []string{ownID}}, token); r.Code != 200 {
		t.Fatalf("bind global: %d %s", r.Code, r.Body.String())
	}
	if r := env.do(t, "PUT", "/api/v1/me/skill-bindings/coloring", map[string]any{"skillIds": []string{pageID}}, token); r.Code != 200 {
		t.Fatalf("bind page: %d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "GET", "/api/v1/me/image-skills/resolved?taskType=coloring", nil, token)
	resolved := decodeSkillData(t, r.Body.Bytes())["items"].([]any)
	if len(resolved) != 1 || resolved[0].(map[string]any)["id"] != pageID {
		t.Fatalf("coloring 应只用页面绑定: %+v", resolved)
	}
	r = env.do(t, "GET", "/api/v1/me/image-skills/resolved?taskType=t2i", nil, token)
	fallback := decodeSkillData(t, r.Body.Bytes())["items"].([]any)
	if len(fallback) != 1 || fallback[0].(map[string]any)["id"] != ownID {
		t.Fatalf("t2i 应回落到全局: %+v", fallback)
	}

	// 删除词条要连带清掉装载记录。
	if r := env.do(t, "DELETE", "/api/v1/me/image-skills/"+pageID, nil, token); r.Code != 200 {
		t.Fatalf("delete own skill: %d %s", r.Code, r.Body.String())
	}
	bindings, err := store.GetSkillBindings(ctx, env.st.Pool, mine.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(bindings["coloring"]) != 0 {
		t.Fatalf("删除词条后装载记录未清理: %+v", bindings)
	}
	// 删掉页面绑定后 coloring 重新回落到全局。
	r = env.do(t, "GET", "/api/v1/me/image-skills/resolved?taskType=coloring", nil, token)
	back := decodeSkillData(t, r.Body.Bytes())["items"].([]any)
	if len(back) != 1 || back[0].(map[string]any)["id"] != ownID {
		t.Fatalf("删除后未回落全局: %+v", back)
	}
}
