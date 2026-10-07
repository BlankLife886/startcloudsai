package httpapi

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 官方技能的正文只在服务端展开，用户端接口不能下发；自己的技能照常返回正文。
func TestUserImageSkillDictHidesOfficialInstruction(t *testing.T) {
	owner := uuid.New()
	official := store.ImageSkill{ID: uuid.New(), Name: "材质插画", Slug: "material-illustration",
		Instruction: "SECRET RULES", UsageGuide: "@材质插画 画一张流程图", TaskTypes: []string{}, Tags: []string{}}
	own := store.ImageSkill{ID: uuid.New(), OwnerUserID: &owner, Name: "柔光", Slug: "soft",
		Instruction: "MY RULES", TaskTypes: []string{}, Tags: []string{}}

	officialDict := userImageSkillDict(official)
	if _, present := officialDict["instruction"]; present {
		t.Fatalf("official skill must not expose instruction: %#v", officialDict)
	}
	if officialDict["usageGuide"] != official.UsageGuide || officialDict["official"] != true {
		t.Fatalf("official skill should keep usage guide: %#v", officialDict)
	}
	if ownDict := userImageSkillDict(own); ownDict["instruction"] != "MY RULES" {
		t.Fatalf("own skill should keep instruction: %#v", ownDict)
	}
	if adminDict := imageSkillDict(official); adminDict["instruction"] != "SECRET RULES" {
		t.Fatalf("admin view keeps instruction: %#v", adminDict)
	}
}

func TestImageSkillDictExposesCoverAndSampleURLs(t *testing.T) {
	cover := "skill-images/abc/cover-1.webp"
	skill := store.ImageSkill{ID: uuid.New(), Name: "材质插画", Slug: "material-illustration", Instruction: "x",
		CoverKey: &cover, TaskTypes: []string{}, Tags: []string{},
		SampleImages: []store.SkillSampleImage{{Key: "skill-images/abc/sample-1.webp", Caption: "流程图"}}}
	dict := userImageSkillDict(skill)
	if url, _ := dict["coverUrl"].(*string); url == nil || *url != "/api/v1/files/"+cover {
		t.Fatalf("coverUrl = %#v", dict["coverUrl"])
	}
	samples, _ := dict["sampleImages"].([]gin.H)
	if len(samples) != 1 || samples[0]["caption"] != "流程图" {
		t.Fatalf("sampleImages = %#v", dict["sampleImages"])
	}
	if url, _ := samples[0]["url"].(*string); url == nil || *url != "/api/v1/files/skill-images/abc/sample-1.webp" {
		t.Fatalf("sample url = %#v", samples[0]["url"])
	}
}

// 覆盖导入 / 编辑：传空串要能清空简介和分类；只改启用状态时其它字段保持不变。
func TestApplyImageSkillInputClearsAndKeeps(t *testing.T) {
	category := "插画"
	base := store.ImageSkill{Name: "材质插画", Description: "旧简介", Category: &category, Instruction: "x", UsageGuide: "旧说明"}
	empty := ""
	applyImageSkillInput(&base, imageSkillIn{Description: &empty, Category: &empty, UsageGuide: &empty}, false)
	if base.Description != "" || base.UsageGuide != "" || base.Category == nil || *base.Category != "" {
		t.Fatalf("explicit empty values must clear fields: %+v", base)
	}
	if err := store.NormalizeSkill(&base); err != nil || base.Category != nil {
		t.Fatalf("empty category should normalize to NULL: %+v %v", base.Category, err)
	}

	kept := store.ImageSkill{Name: "人像导演", Description: "简介", Category: &category, Instruction: "x", UsageGuide: "说明"}
	active := false
	applyImageSkillInput(&kept, imageSkillIn{Active: &active}, false)
	if kept.Description != "简介" || kept.UsageGuide != "说明" || kept.Category == nil || kept.Active {
		t.Fatalf("toggle-only patch must keep other fields: %+v", kept)
	}
}

// 来源地址：用户端也能看到（显示为跳转图标）；只接受 https，传空串清空。
func TestImageSkillSourceURL(t *testing.T) {
	source := "https://github.com/helloianneo/ian-handdrawn-ppt"
	skill := store.ImageSkill{Name: "手绘 PPT", Instruction: "x"}
	applyImageSkillInput(&skill, imageSkillIn{SourceURL: &source}, false)
	if err := store.NormalizeSkill(&skill); err != nil || skill.SourceURL != source {
		t.Fatalf("source url = %q, err %v", skill.SourceURL, err)
	}
	if dict := userImageSkillDict(skill); dict["sourceUrl"] != source {
		t.Fatalf("user dict sourceUrl = %#v", dict["sourceUrl"])
	}
	for _, bad := range []string{"http://github.com/a/b", "javascript:alert(1)", "github.com/a/b", "https://user:pw@github.com/a"} {
		value := bad
		probe := store.ImageSkill{Name: "x", Instruction: "x", SourceURL: value}
		if err := store.NormalizeSkill(&probe); err == nil {
			t.Fatalf("%q should be rejected", bad)
		}
	}
	empty := ""
	applyImageSkillInput(&skill, imageSkillIn{SourceURL: &empty}, false)
	if err := store.NormalizeSkill(&skill); err != nil || skill.SourceURL != "" {
		t.Fatalf("empty source url should clear: %q %v", skill.SourceURL, err)
	}
}
