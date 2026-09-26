package httpapi

import (
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

// 后台录入官方词条，用户端能看到；官方词条对用户只读。
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

	// 列表带云端配额信息。
	r = env.do(t, "GET", "/api/v1/me/image-skills", nil, token)
	data := decodeSkillData(t, r.Body.Bytes())
	if data["owned"] != float64(0) || data["maxOwned"] != float64(store.SkillMaxOwnedPerUser) {
		t.Fatalf("列表缺少云端配额: %+v", data)
	}

	// 后台停用后，用户端立即看不到。
	if r := env.do(t, "PATCH", "/api/v1/admin/image-skills/"+skillID, map[string]any{"active": false}, admin); r.Code != 200 {
		t.Fatalf("disable: %d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "GET", "/api/v1/me/image-skills", nil, token)
	if left := decodeSkillData(t, r.Body.Bytes())["items"].([]any); len(left) != 0 {
		t.Fatalf("停用后仍可见: %+v", left)
	}
}

// 用户自建词条只属于自己；云端配额按用户各算。
func TestUserOwnedSkillIsolationAndCloudQuota(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
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

	// 云端配额：满了要 422，删掉一个后又能存。
	for index := 1; index < store.SkillMaxOwnedPerUser; index++ {
		if r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
			"name": "填充", "instruction": "x",
		}, token); r.Code != 200 {
			t.Fatalf("第 %d 个云端技能应成功: %d %s", index+1, r.Code, r.Body.String())
		}
	}
	if r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "超出", "instruction": "x",
	}, token); r.Code != 422 {
		t.Fatalf("超出云端配额应 422: %d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "GET", "/api/v1/me/image-skills", nil, token)
	if data := decodeSkillData(t, r.Body.Bytes()); data["owned"] != float64(store.SkillMaxOwnedPerUser) {
		t.Fatalf("owned 应为满额: %+v", data)
	}
	if r := env.do(t, "DELETE", "/api/v1/me/image-skills/"+ownID, nil, token); r.Code != 200 {
		t.Fatalf("delete own skill: %d %s", r.Code, r.Body.String())
	}
	if r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "腾出位置后", "instruction": "x",
	}, token); r.Code != 200 {
		t.Fatalf("删掉后应能再存: %d %s", r.Code, r.Body.String())
	}
	// 配额只算自己的：别人一个都没存。
	r = env.do(t, "GET", "/api/v1/me/image-skills", nil, otherToken)
	if data := decodeSkillData(t, r.Body.Bytes()); data["owned"] != float64(0) {
		t.Fatalf("配额串到了其他用户: %+v", data)
	}
}

// 调用名：可自定义、留空自动推导、重复要被 422 拒绝，改名不影响调用名。
func TestImageSkillSlug(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")

	r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "柔光人像", "slug": "Soft-Light", "instruction": "柔和顶光。",
	}, token)
	if r.Code != 200 {
		t.Fatalf("create with slug: %d %s", r.Code, r.Body.String())
	}
	first := decodeSkillData(t, r.Body.Bytes())
	if first["slug"] != "soft-light" {
		t.Fatalf("调用名未收敛为小写: %+v", first)
	}
	r = env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "Product Hero", "instruction": "突出材质。",
	}, token)
	second := decodeSkillData(t, r.Body.Bytes())
	if second["slug"] != "product-hero" {
		t.Fatalf("留空的调用名未从名称推导: %+v", second)
	}
	if r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "撞名", "slug": "soft-light", "instruction": "x",
	}, token); r.Code != 422 {
		t.Fatalf("重复调用名应 422: %d %s", r.Code, r.Body.String())
	}
	if r := env.do(t, "POST", "/api/v1/me/image-skills", map[string]any{
		"name": "坏格式", "slug": "Bad_Slug!", "instruction": "x",
	}, token); r.Code != 422 {
		t.Fatalf("非法调用名应 422: %d %s", r.Code, r.Body.String())
	}
	// 改名不影响已有调用名；显式改调用名要生效。
	firstID := first["id"].(string)
	r = env.do(t, "PATCH", "/api/v1/me/image-skills/"+firstID, map[string]any{"name": "改名"}, token)
	if decodeSkillData(t, r.Body.Bytes())["slug"] != "soft-light" {
		t.Fatalf("改名不该改调用名: %s", r.Body.String())
	}
	r = env.do(t, "PATCH", "/api/v1/me/image-skills/"+firstID, map[string]any{"slug": "soft-light-v2"}, token)
	if decodeSkillData(t, r.Body.Bytes())["slug"] != "soft-light-v2" {
		t.Fatalf("显式改调用名未生效: %s", r.Body.String())
	}

	// 搜索支持按调用名找。
	r = env.do(t, "GET", "/api/v1/me/image-skills?search=$product", nil, token)
	if found := decodeSkillData(t, r.Body.Bytes())["items"].([]any); len(found) != 1 {
		t.Fatalf("按调用名搜索失败: %+v", found)
	}
}
