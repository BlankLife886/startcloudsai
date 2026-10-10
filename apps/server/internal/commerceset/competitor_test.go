package commerceset

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const competitorReply = "```json\n" + `{"notListing":false,"platform":"Ozon","category":"洗护","summary":"深蓝色块压大字，卖点逐屏放大",
"palette":[{"name":"深海蓝","hex":"#0a2a5e","role":"背景"},{"name":"坏颜色","hex":"blue","role":"x"},{"name":"白","hex":"#FFFFFF","role":"文字"}],
"lighting":"顶部柔光，瓶身左侧高光。","background":"纯白主图，详情页深蓝渐变","typography":"粗黑体大标题","textDensity":"每屏 1 个标题 + 3 行小字","props":"水花、绿叶",
"slots":[{"type":"white","purpose":"主图","layout":"正面居中"},{"type":"selling","purpose":"放大保湿卖点","layout":"左图右文","copyPattern":"数字+利益点"},
{"type":"nonsense","purpose":"x","layout":"y"},{"type":"scene","purpose":"浴室场景","layout":"台面近景"},{"type":"selling","purpose":"放大香味卖点","layout":"上图下文"},{"type":"review","purpose":"买家好评","layout":"评分卡片"}],
"strengths":["卖点一屏一个"],"improvements":["参数信息更直观"],"avoidTerms":["AquaPure","「24 小时持久」"]}` + "\n```"

func TestParseCompetitorStyleKeepsUsableParts(t *testing.T) {
	style, err := ParseCompetitorStyle(competitorReply)
	if err != nil {
		t.Fatal(err)
	}
	if len(style.Slots) != 5 || style.Slots[2].Type != "scene" {
		t.Fatalf("unknown slot types must be dropped: %+v", style.Slots)
	}
	if len(style.Palette) != 2 || style.Palette[0].Hex != "#0A2A5E" {
		t.Fatalf("palette = %+v", style.Palette)
	}
	shots := ShotsFromCompetitor(style)
	if len(shots) != 3 || shots[0].Type != "white" || shots[1].Type != "selling" || shots[1].Count != 2 || shots[2].Type != "scene" {
		t.Fatalf("shots should follow the competitor's order and skip proof-only slots: %+v", shots)
	}
	text := CompetitorStyleText(style)
	if strings.Contains(text, "。。") || strings.Contains(text, "；。") {
		t.Fatalf("style text has doubled punctuation: %s", text)
	}
	for _, want := range []string{"深海蓝 #0A2A5E", "顶部柔光", "禁止出现：AquaPure", "不复制竞品"} {
		if !strings.Contains(text, want) {
			t.Fatalf("style text misses %q: %s", want, text)
		}
	}
}

func TestParseCompetitorStyleRejectsReplyWithoutStructure(t *testing.T) {
	if _, err := ParseCompetitorStyle(`{"summary":"x","slots":[{"type":"bogus"}]}`); err == nil {
		t.Fatal("a reply with no known slot must fail")
	}
	style, err := ParseCompetitorStyle(`{"notListing":true,"reason":"这是聊天截图"}`)
	if err != nil || !style.NotListing {
		t.Fatalf("not a listing should be reported, style=%+v err=%v", style, err)
	}
}

func TestPlanFollowsCompetitorWithoutUsingItsScreenshots(t *testing.T) {
	f := setup(t)
	style, err := ParseCompetitorStyle(competitorReply)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(style)
	ref, err := store.InsertCompetitorRef(f.ctx, f.st.Pool, &store.CompetitorRef{UserID: f.user.ID, ImageKeys: []string{"uploads/rival.png"}, Style: raw})
	if err != nil {
		t.Fatal(err)
	}
	var copyPrompt string
	set, err := f.service.Plan(f.ctx, PlanInput{
		UserID: f.user.ID, InputKeys: []string{"uploads/rival.png", "uploads/mine.png"},
		Brief: Brief{ProductName: "洗发水", Reference: "模型伪造的参考"}, Competitor: ref,
		Copy: func(_ context.Context, prompt string) (string, error) { copyPrompt = prompt; return `{"summary":"","items":[]}`, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(set.InputKeys) != 1 || set.InputKeys[0] != "uploads/mine.png" {
		t.Fatalf("competitor screenshots must not be product references: %v", set.InputKeys)
	}
	if len(set.Shots) != 4 || set.Shots[0].TypeID != "white" || set.Shots[2].TypeID != "selling" || set.Shots[3].TypeID != "scene" {
		t.Fatalf("shots should follow the competitor: %+v", set.Shots)
	}
	if !strings.Contains(copyPrompt, "竞品的图片顺序与版式") || !strings.Contains(copyPrompt, "放大香味卖点") || strings.Contains(copyPrompt, "模型伪造的参考") {
		t.Fatalf("copy prompt = %s", copyPrompt)
	}
	var brief Brief
	_ = json.Unmarshal(set.Brief, &brief)
	prompts := Prompts(brief, set.Summary, RestoreDirections([]Shot{{ID: "white", TypeID: "white", Label: "产品白底图"}}), 1)
	if !strings.Contains(prompts[0], "深海蓝 #0A2A5E") || !strings.Contains(prompts[0], "禁止出现：AquaPure") || brief.CompetitorRefID != ref.ID.String() {
		t.Fatalf("generation prompt should carry the style: %s", prompts[0])
	}
}

func TestPlanNeedsOwnProductPhotosBesideCompetitorScreenshots(t *testing.T) {
	f := setup(t)
	style, _ := ParseCompetitorStyle(competitorReply)
	raw, _ := json.Marshal(style)
	ref, err := store.InsertCompetitorRef(f.ctx, f.st.Pool, &store.CompetitorRef{UserID: f.user.ID, ImageKeys: []string{"uploads/rival.png"}, Style: raw})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.service.Plan(f.ctx, PlanInput{UserID: f.user.ID, InputKeys: []string{"uploads/rival.png"}, Brief: Brief{}, Competitor: ref})
	if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "自己的商品图") {
		t.Fatalf("err = %v", err)
	}
}
