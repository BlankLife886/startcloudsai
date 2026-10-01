package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
)

const handheldProductClassifySettingKey = "ecommerce_handheld_product_classify_enabled"

// 与试衣服装识别一样：上传后的辅助预填，单独限流，不占策划配额
const handheldProductClassifyPerMinute = 30

const handheldProductClassifyMaxBytes = 12 << 20

// 与前端 HANDHELD_CATEGORY_OPTIONS 的 id 一致
var handheldCategoryIDs = map[string]bool{
	"perfume": true, "skincare": true, "lipstick": true, "earbuds": true,
	"powerbank": true, "cup": true, "gift": true, "other": true,
}

type handheldProductClassifyIn struct {
	InputKey string `json:"inputKey"`
}

type handheldProductClassification struct {
	Category string          `json:"category"`
	Label    string          `json:"label"`
	SizeMm   *handheldSizeIn `json:"sizeMm"`
}

func (s *Server) handheldProductClassifyEnabled(c *gin.Context) bool {
	enabled, err := settings.GetBool(c.Request.Context(), s.St.Pool, handheldProductClassifySettingKey)
	if err != nil {
		return true
	}
	return enabled
}

func (s *Server) classifyHandheldProduct(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	// 后台“AI 电商 › AI 辅助功能”可关闭；关闭时前端静默跳过，品类与尺寸由用户手选
	if !s.handheldProductClassifyEnabled(c) {
		fail(c, apperr.E("feature_disabled", "手持商品识别已关闭", http.StatusForbidden))
		return
	}
	if !s.enforceUsageLimit(c, "ecommerce-handheld-classify-minute", user.ID.String(), handheldProductClassifyPerMinute, 1, time.Minute) {
		return
	}
	var body handheldProductClassifyIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	key := strings.TrimSpace(body.InputKey)
	if key == "" {
		fail(c, apperr.E("validation_error", "请先上传商品图", 422))
		return
	}
	prompt := `你是电商手持商品图的商品识别助手。只根据图片中真实可见的商品判断，不得虚构品牌或型号。

category 只能是以下之一：
- "perfume"：香水、玻璃瓶水剂
- "skincare"：护肤品瓶罐、乳液、精华、面霜
- "lipstick"：口红、唇釉、唇膏等细长彩妆管
- "earbuds"：耳机、充电盒、小型数码配件
- "powerbank"：充电宝、手机、小家电等扁平硬质电子产品
- "cup"：杯子、马克杯、保温杯、水杯
- "gift"：礼盒、套装盒
- "other"：以上都不是、但一只手能拿的其他小件（帽子、玩具、食品包装等）

label 用 2-10 个汉字描述看得见的商品，例如"蓝色按压精华瓶"。

sizeMm 是商品本体的估计实物尺寸（毫米）：length=左右宽度，width=前后厚度，height=上下高度。
三个数都是外形的直线长度（从一边量到另一边），不是周长、头围、容量或尺码，例如渔夫帽给帽檐直径约 360，不能给头围 560。
估计时必须符合图中商品的长宽比例（例如图中高度约是宽度的 4 倍，则 height 约为 length 的 4 倍），再结合这类商品常见的真实大小。
看不出大小线索时仍给出该类商品最常见的尺寸。

只返回 JSON，不要 Markdown 或解释：{"category":"...","label":"...","sizeMm":{"length":0,"width":0,"height":0}}`
	reply, done := s.askEcommerceAnalysisAboutImage(c, user.ID, key, handheldProductClassifyMaxBytes, prompt, "handheld product classify", "商品")
	if !done {
		return
	}
	result, err := decodeHandheldProductClassification(reply)
	if err != nil {
		log.Printf("handheld product classify: bad reply (%v): %.300q", err, reply)
		fail(c, apperr.E("assistant_bad_response", "未能识别商品品类，请手动选择", 502))
		return
	}
	ok(c, result)
}

func decodeHandheldProductClassification(raw string) (*handheldProductClassification, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var result handheldProductClassification
	if err := json.Unmarshal([]byte(text[start:end+1]), &result); err != nil {
		return nil, err
	}
	result.Category = strings.TrimSpace(result.Category)
	if !handheldCategoryIDs[result.Category] {
		return nil, fmt.Errorf("unknown category %q", result.Category)
	}
	result.Label = truncateEcommerceBrief(strings.TrimSpace(result.Label), 16)
	// 尺寸是辅助预填：任何一项不合理就整组丢掉，由前端退回品类默认尺寸
	if size := result.SizeMm; size != nil {
		valid := true
		for _, value := range []*float64{&size.Length, &size.Width, &size.Height} {
			if *value < 1 || *value > 2000 || math.IsNaN(*value) {
				valid = false
				break
			}
			*value = math.Round(*value)
		}
		if !valid {
			result.SizeMm = nil
		}
	}
	return &result, nil
}
