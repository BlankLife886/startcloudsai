package httpapi

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

var handheldEnums = map[string][]string{
	"pose":                {"grip", "present", "pinch", "two-finger", "use", "open", "spray", "pour", "apply", "wear", "drink", "two-hands", "unbox"},
	"hand":                {"left", "right", "both"},
	"crop":                {"hand", "wrist", "noface", "bust", "full"},
	"pack":                {"single", "listing", "social", "unbox-set", "ab", "sku", "clone"},
	"packState":           {"unboxed", "boxed", "kit"},
	"platform":            {"taobao", "detail", "xhs", "douyin", "amazon", "shop"},
	"lens":                {"auto", "normal", "portrait", "macro"},
	"light":               {"available", "fill", "rim", "hard"},
	"camera":              {"eye", "high", "low"},
	"depth":               {"balanced", "deep", "shallow", "contextual"},
	"focus":               {"product_identity", "hand_contact", "functional_detail", "lifestyle_action"},
	"materialInteraction": {"balanced", "glass", "metal", "matte", "plastic", "paper", "soft_goods", "screen"},
	"architecture":        {"auto", "diffusion", "insert", "composite", "swap"},
	"language":            {"zh-CN", "zh-TW", "en", "ja", "ko", "es", "fr", "de", "pt", "ar", "ru"},
}

type handheldInputIn struct {
	Role string `json:"role"`
	Key  string `json:"key"`
}
type handheldShotIn struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Direction   string `json:"direction"`
	AspectRatio string `json:"aspectRatio"`
	Prompt      string `json:"prompt"`
}
type handheldAnnotationIn struct {
	ID   string  `json:"id"`
	Role string  `json:"role"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Text string  `json:"text"`
}
type handheldSpecIn struct {
	Pose                string                 `json:"pose"`
	Hand                string                 `json:"hand"`
	Crop                string                 `json:"crop"`
	Pack                string                 `json:"pack"`
	PackState           string                 `json:"packState"`
	Platform            string                 `json:"platform"`
	Lens                string                 `json:"lens"`
	Light               string                 `json:"light"`
	Camera              string                 `json:"camera"`
	Depth               string                 `json:"depth"`
	Focus               string                 `json:"focus"`
	MaterialInteraction string                 `json:"materialInteraction"`
	Architecture        string                 `json:"architecture"`
	Category            string                 `json:"category"`
	Style               string                 `json:"style"`
	AspectRatio         string                 `json:"aspectRatio"`
	SKU                 string                 `json:"sku"`
	ProductName         string                 `json:"productName"`
	SellingPoints       string                 `json:"sellingPoints"`
	Language            string                 `json:"language"`
	Colorways           []string               `json:"colorways"`
	Annotations         []handheldAnnotationIn `json:"annotations"`
	Inputs              []handheldInputIn      `json:"inputs"`
	Shots               []handheldShotIn       `json:"shots"`
}
type handheldJobIn struct {
	ProjectID     *string        `json:"projectId"`
	ProductID     *string        `json:"productId"`
	ParentBatchID *string        `json:"parentBatchId"`
	ModelID       string         `json:"modelId"`
	Spec          handheldSpecIn `json:"spec"`
}
type handheldQuoteIn struct {
	ModelID     string `json:"modelId"`
	AspectRatio string `json:"aspectRatio"`
	Quality     string `json:"quality"`
	InputCount  int    `json:"inputCount"`
	ItemCount   int    `json:"itemCount"`
}
type handheldProjectIn struct {
	ProductID *string        `json:"productId"`
	Name      string         `json:"name"`
	Draft     map[string]any `json:"draft"`
}
type handheldDraftIn struct {
	Draft map[string]any `json:"draft"`
}
type handheldSaveAssetIn struct {
	Title string `json:"title"`
}

func parseOptionalUUID(raw *string, field string) (*uuid.UUID, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(strings.TrimSpace(*raw))
	if err != nil {
		return nil, apperr.E("validation_error", field+": 无效 UUID", 422)
	}
	return &id, nil
}

func handheldProductSnapshot(product *store.EcommerceProduct) map[string]any {
	if product == nil {
		return map[string]any{}
	}
	return map[string]any{"id": product.ID.String(), "sku": product.SKU, "title": product.Title, "brand": product.Brand, "category": product.Category, "sellingPoints": product.SellingPoints, "targetAudience": product.TargetAudience, "material": product.Material, "color": product.Color, "dimensions": product.Dimensions, "platform": product.Platform, "market": product.Market, "language": product.Language, "assetIds": append([]string(nil), product.AssetIDs...), "protectedElements": append([]string(nil), product.ProtectedElements...), "capturedAt": isoValue(product.UpdatedAt)}
}

func (s *Server) resolveHandheldProduct(ctx context.Context, userID uuid.UUID, raw *string) (*store.EcommerceProduct, *uuid.UUID, map[string]any, error) {
	id, err := parseOptionalUUID(raw, "productId")
	if err != nil {
		return nil, nil, nil, err
	}
	if id == nil {
		return nil, nil, map[string]any{}, nil
	}
	p, err := store.GetEcommerceProduct(ctx, s.St.Pool, userID, *id)
	if err != nil {
		return nil, nil, nil, err
	}
	if p == nil {
		return nil, nil, nil, apperr.E("not_found", "商品不存在或不属于当前用户", 404)
	}
	return p, id, handheldProductSnapshot(p), nil
}

func validateHandheldSpec(spec *handheldSpecIn) error {
	requiredDefaults := map[string]string{"crop": "wrist", "pack": "single", "platform": "taobao"}
	required := map[string]*string{"crop": &spec.Crop, "pack": &spec.Pack, "platform": &spec.Platform}
	for key, target := range required {
		*target = strings.TrimSpace(*target)
		if *target == "" {
			*target = requiredDefaults[key]
		}
		if !store.Contains(handheldEnums[key], *target) {
			return apperr.E("validation_error", key+": 无效选项", 422)
		}
	}
	optional := map[string]*string{"pose": &spec.Pose, "hand": &spec.Hand, "packState": &spec.PackState, "lens": &spec.Lens, "light": &spec.Light, "camera": &spec.Camera, "depth": &spec.Depth, "focus": &spec.Focus, "materialInteraction": &spec.MaterialInteraction, "architecture": &spec.Architecture}
	for key, target := range optional {
		*target = strings.TrimSpace(*target)
		if *target != "" && !store.Contains(handheldEnums[key], *target) {
			return apperr.E("validation_error", key+": 无效选项", 422)
		}
	}
	spec.Style = strings.TrimSpace(spec.Style)
	spec.Language = strings.TrimSpace(spec.Language)
	if spec.Language != "" && !store.Contains(handheldEnums["language"], spec.Language) {
		return apperr.E("validation_error", "language: 无效语言", 422)
	}
	if spec.AspectRatio == "" {
		spec.AspectRatio = "4:5"
	}
	if !store.Contains(modelconfig.ImageAspectRatios, spec.AspectRatio) {
		return apperr.E("validation_error", "aspectRatio: 无效比例", 422)
	}
	if len(spec.Inputs) < 1 || len(spec.Inputs) > 6 {
		return apperr.E("validation_error", "inputs: 须提供 1-6 张角色图片", 422)
	}
	if len(spec.Shots) < 1 || len(spec.Shots) > 24 {
		return apperr.E("validation_error", "shots: 须提供 1-24 个生成项", 422)
	}
	if len(spec.Annotations) > 12 {
		return apperr.E("validation_error", "annotations: 最多 12 条", 422)
	}
	annotationIDs := map[string]bool{}
	for i := range spec.Annotations {
		annotation := &spec.Annotations[i]
		annotation.ID = strings.TrimSpace(annotation.ID)
		annotation.Role = strings.TrimSpace(annotation.Role)
		annotation.Text = strings.TrimSpace(annotation.Text)
		if annotation.ID == "" {
			annotation.ID = fmt.Sprintf("annotation-%d", i+1)
		}
		if annotationIDs[annotation.ID] {
			return apperr.E("validation_error", "annotations: 标注 ID 不能重复", 422)
		}
		annotationIDs[annotation.ID] = true
		if !store.Contains([]string{"product_front", "product_side", "product_back", "logo_detail", "colorway"}, annotation.Role) {
			return apperr.E("validation_error", "annotations: 图片角色无效", 422)
		}
		if annotation.X < 0 || annotation.X > 1 || annotation.Y < 0 || annotation.Y > 1 {
			return apperr.E("validation_error", "annotations: 坐标必须在 0-1 之间", 422)
		}
		if annotation.Text == "" || utf8.RuneCountInString(annotation.Text) > 240 || utf8.RuneCountInString(annotation.ID) > 80 {
			return apperr.E("validation_error", "annotations: 说明为空或过长", 422)
		}
	}
	roles := map[string]int{}
	hasProduct := false
	for i := range spec.Inputs {
		input := &spec.Inputs[i]
		input.Role = strings.TrimSpace(input.Role)
		input.Key = strings.TrimSpace(input.Key)
		if !store.Contains(store.EcommerceHandheldInputRoles, input.Role) || input.Key == "" {
			return apperr.E("validation_error", "inputs: 角色或文件无效", 422)
		}
		roles[input.Role]++
		if input.Role == "product_front" || input.Role == "product_side" || input.Role == "product_back" {
			hasProduct = true
		}
		if input.Role != "colorway" && roles[input.Role] > 1 {
			return apperr.E("validation_error", "inputs: 同一角色不能重复", 422)
		}
	}
	if !hasProduct {
		return apperr.E("validation_error", "inputs: 至少需要一张商品身份图", 422)
	}
	inputPriority := map[string]int{
		"product_front": 0, "product_side": 1, "product_back": 2,
		"logo_detail": 3, "colorway": 4, "hand_or_model": 5,
		"scene": 6, "layout": 7,
	}
	sort.SliceStable(spec.Inputs, func(left, right int) bool {
		return inputPriority[spec.Inputs[left].Role] < inputPriority[spec.Inputs[right].Role]
	})
	for i := range spec.Shots {
		shot := &spec.Shots[i]
		shot.ID = strings.TrimSpace(shot.ID)
		shot.Label = strings.TrimSpace(shot.Label)
		shot.Direction = strings.TrimSpace(shot.Direction)
		shot.Prompt = strings.TrimSpace(shot.Prompt)
		if shot.ID == "" {
			shot.ID = fmt.Sprintf("shot-%d", i+1)
		}
		if shot.Label == "" {
			shot.Label = fmt.Sprintf("手持商品图 %d", i+1)
		}
		if utf8.RuneCountInString(shot.Label) > 80 || utf8.RuneCountInString(shot.Direction) > 1200 || utf8.RuneCountInString(shot.Prompt) > 30000 {
			return apperr.E("validation_error", "shots: 内容过长", 422)
		}
		if shot.AspectRatio == "" {
			shot.AspectRatio = spec.AspectRatio
		}
		if !store.Contains(modelconfig.ImageAspectRatios, shot.AspectRatio) {
			return apperr.E("validation_error", "shots: 包含无效比例", 422)
		}
	}
	return nil
}

const handheldFinalConstraintMarker = "最终执行硬约束（优先级最高）："

func isHandheldUseShot(id string) bool {
	return id == "use" || strings.HasPrefix(id, "use-")
}

func handheldExecutionConstraints(spec handheldSpecIn, shot handheldShotIn) string {
	hasModel := false
	hasScene := false
	for _, input := range spec.Inputs {
		switch input.Role {
		case "hand_or_model":
			hasModel = true
		case "scene":
			hasScene = true
		}
	}
	focusConstraint := "对焦平面必须落在商品身份面。商品是画面中唯一最锐利的物体，Logo、印刷和边缘必须比手指、皮肤和人脸更清晰；若景深不够，只允许虚化背景或手背，严禁虚化、雾化或重绘商品。禁止把自动对焦打在指节、指甲或人脸。"
	if isHandheldUseShot(shot.ID) {
		focusConstraint = "本张是使用瞬间：整张画面必须锐利清晰，商品、手、人物和场景陈设都要清楚；使用深景深，禁止浅景深，禁止只让人物清晰而虚化商品、手或环境。商品身份面仍须清楚可读，但不得以虚化其余区域为代价。"
	}
	constraints := []string{
		"商品必须保持参考图的刚性外形，长宽厚比例、轮廓、边角、孔位、接缝和印刷位置不得拉伸、挤压、弯曲、融化或圆角化；手迁就商品，商品不得迁就手。",
		focusConstraint,
		"严禁生成裸露、走光、色情、性暗示或暴露私密部位的画面，人物必须穿着完整、可上架的日常或商业服装；也不得生成暴力、血腥或其他不宜上架内容。",
	}
	if spec.Crop == "full" {
		if hasModel {
			constraints = append(constraints, "每张都必须从头顶到双脚完整显示同一位参考模特，双脚和鞋完整可见，严禁半身、胸像、近景裁切。模特参考若只有上半身，只锁定人物身份与可见外观，必须自然补全符合该人物的下半身、站姿和服装延续，绝不能继承参考图的半身画幅。")
		} else {
			constraints = append(constraints, "每张都必须从头顶到双脚完整显示人物，双脚和鞋完整可见，严禁半身、胸像或近景裁切。")
		}
	}
	switch spec.Hand {
	case "right":
		constraints = append(constraints, "每张都必须由人物本人的右手握持商品；人物正对镜头时，该手通常位于画面左侧。严禁镜像、左右手互换或改用左手。")
	case "left":
		constraints = append(constraints, "每张都必须由人物本人的左手握持商品；人物正对镜头时，该手通常位于画面右侧。严禁镜像、左右手互换或改用右手。")
	case "both":
		constraints = append(constraints, "每张都必须使用人物本人的双手配合完成握持动作，不得改成单手。")
	}
	if hasScene {
		sceneConstraint := "每张都必须直接以场景参考为唯一背景事实，保留同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围；允许改变机位和景深，但严禁换成另一个房间、影棚、街景、纯色背景或泛化相似场景。"
		if isHandheldUseShot(shot.ID) {
			sceneConstraint = "每张都必须直接以场景参考为唯一背景事实，保留同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围；允许改变机位，但必须保持深景深、整张清晰，严禁浅景深或只让人物清晰；严禁换成另一个房间、影棚、街景、纯色背景或泛化相似场景。"
		}
		constraints = append(constraints, sceneConstraint)
	}
	if len(constraints) == 0 {
		return ""
	}
	return handheldFinalConstraintMarker + strings.Join(constraints, "")
}

const handheldUseShotSharpnessOverride = "本张使用瞬间覆盖（优先于上文景深与虚化要求）：整张画面必须锐利清晰，商品、手、人物和场景陈设都要清楚；使用约 f/8 至 f/16 的深景深。禁止浅景深，禁止背景柔和分离，禁止只让人物清晰而把商品、手或环境拍虚。"

func appendHandheldExecutionConstraints(prompt string, spec handheldSpecIn, shot handheldShotIn) string {
	value := strings.TrimSpace(prompt)
	constraints := handheldExecutionConstraints(spec, shot)
	if strings.Contains(value, handheldFinalConstraintMarker) {
		if isHandheldUseShot(shot.ID) && !strings.Contains(value, "本张使用瞬间覆盖") && !strings.Contains(value, "本张是使用瞬间") {
			if value == "" {
				return handheldUseShotSharpnessOverride
			}
			return value + "\n" + handheldUseShotSharpnessOverride
		}
		return value
	}
	if constraints == "" {
		return value
	}
	if value == "" {
		return constraints
	}
	return value + "\n" + constraints
}

func compileHandheldPrompt(snapshot map[string]any, spec handheldSpecIn, shot handheldShotIn) string {
	if prompt := strings.TrimSpace(shot.Prompt); prompt != "" {
		return appendHandheldExecutionConstraints(prompt, spec, shot)
	}
	value := func(key string) string {
		if v, ok := snapshot[key].(string); ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	protected := ""
	if values, ok := snapshot["protectedElements"].([]string); ok {
		protected = strings.Join(values, "、")
	} else if values, ok := snapshot["protectedElements"].([]any); ok {
		parts := []string{}
		for _, v := range values {
			parts = append(parts, fmt.Sprint(v))
		}
		protected = strings.Join(parts, "、")
	}
	depthPrompt := map[string]string{
		"balanced":   "中近景；对焦商品身份面，商品必须比手更锐利，背景柔和分离",
		"deep":       "约 f/11 至 f/16 的深景深效果；商品正面到边缘保持最清晰，手指不得抢过商品",
		"shallow":    "浅景深也必须对焦商品身份面与 Logo，虚化只能落在背景或手背",
		"contextual": "环境中景；交代真实使用空间，但商品仍是最锐利、最醒目的主体",
	}[spec.Depth]
	if isHandheldUseShot(shot.ID) {
		depthPrompt = "整张画面必须锐利清晰，使用约 f/8 至 f/16 的深景深；商品、手、人物和场景陈设都要清楚，禁止浅景深，禁止只让人物清晰而虚化其余区域"
	}
	focusPrompt := map[string]string{
		"product_identity":  "第一视觉中心与对焦都锁定商品品牌面、轮廓与配色，手指只是支撑，不得成为最清晰区域",
		"hand_contact":      "对焦商品与指腹接触区，商品表面仍须比皮肤更清晰",
		"functional_detail": "对焦开口、按钮、盖子、镜头模组或使用部件，功能结构不得被遮住",
		"lifestyle_action":  "先读懂真实使用动作，再读到商品身份，人物与环境不得抢主体",
	}[spec.Focus]
	materialPrompt := map[string]string{
		"balanced":   "根据商品参考匹配表面反光、手指压力、接触阴影与边缘遮挡，不改变原材质",
		"glass":      "保留玻璃透明、折射、受控高光与液面边缘，手指透射和遮挡真实",
		"metal":      "金属边缘呈连续线性高光，反射跟随主光，禁止融化、拉伸或塑料化",
		"matte":      "保留微颗粒与柔和明暗，指腹仅产生轻微压痕，禁止油亮",
		"plastic":    "使用克制光泽和准确硬边，避免蜡感、过曝与软化变形",
		"paper":      "印刷、折边、压纹与盒角清楚，握持不得压坏包装结构",
		"soft_goods": "表现织纹、自然褶皱与受力压缩，轮廓和品牌标识准确",
		"screen":     "锁定屏幕或镜面平面并控制反射，禁止界面、孔位和边框变形",
	}[spec.MaterialInteraction]
	settings := []string{
		"人物范围=" + spec.Crop,
		"平台=" + spec.Platform,
	}
	languageLabel := map[string]string{
		"zh-CN": "简体中文", "zh-TW": "繁体中文", "en": "英文", "ja": "日文",
		"ko": "韩文", "es": "西班牙文", "fr": "法文", "de": "德文",
		"pt": "葡萄牙文", "ar": "阿拉伯文", "ru": "俄文",
	}[spec.Language]
	annotationLines := []string{}
	for index, annotation := range spec.Annotations {
		annotationLines = append(annotationLines, fmt.Sprintf("%d. %s (%.0f%%, %.0f%%)：%s。", index+1, annotation.Role, annotation.X*100, annotation.Y*100, annotation.Text))
	}
	for _, entry := range []struct{ label, value string }{
		{"姿势", spec.Pose},
		{"手", spec.Hand},
		{"包装状态", spec.PackState},
		{"镜头", spec.Lens},
		{"光线", spec.Light},
		{"机位", spec.Camera},
		{"生成架构", spec.Architecture},
		{"视觉风格", spec.Style},
	} {
		if strings.TrimSpace(entry.value) != "" {
			settings = append(settings, entry.label+"="+entry.value)
		}
	}
	inputRoles := []string{}
	for _, input := range spec.Inputs {
		inputRoles = append(inputRoles, input.Role)
	}
	sellingPoints := firstNonEmpty(value("sellingPoints"), spec.SellingPoints)
	if sellingPoints == "未填写" {
		sellingPoints = ""
	}
	productFacts := []string{}
	for _, entry := range []struct{ label, value string }{
		{"商品", firstNonEmpty(value("title"), spec.ProductName)},
		{"SKU", firstNonEmpty(value("sku"), spec.SKU)},
		{"品牌", value("brand")},
		{"品类", firstNonEmpty(value("category"), spec.Category)},
		{"材质", value("material")},
		{"颜色", value("color")},
		{"真实尺寸", value("dimensions")},
	} {
		if strings.TrimSpace(entry.value) != "" && entry.value != "未填写" {
			productFacts = append(productFacts, entry.label+"="+entry.value)
		}
	}
	productInfo := "商品信息只根据商品参考图识别，不补写用户未选择或未填写的属性。"
	if len(productFacts) > 0 {
		productInfo = "商品信息：" + strings.Join(productFacts, "；") + "。"
	}
	parts := []string{
		"任务域：AI 电商手持商品摄影。以角色为 product_front/product_side/product_back/logo_detail/colorway 的参考图作为唯一商品事实来源。",
		productInfo,
		func() string {
			if languageLabel != "" {
				return "画面文案语言：" + languageLabel + "。若画面出现新增文案或标注要求重绘文字，只能使用该语言，不得混用其他语言。"
			}
			return ""
		}(),
		func() string {
			if len(annotationLines) > 0 {
				return "图片位置标注（坐标以商品图左上角为原点，必须逐条应用到对应位置，不得调换）：\n" + strings.Join(annotationLines, "\n")
			}
			return ""
		}(),
		fmt.Sprintf("不可改变的商品元素：%s。必须保持几何轮廓、长宽厚比例、包装、Logo、文字、颜色、材质和真实毫米尺度。", firstNonEmpty(protected, "商品结构、品牌面与包装文字")),
		fmt.Sprintf("镜头配置：%s，比例=%s。", strings.Join(settings, "，"), shot.AspectRatio),
		func() string {
			if sellingPoints != "" {
				return "卖点与上架要求：" + sellingPoints + "。"
			}
			return ""
		}(),
		func() string {
			if len(inputRoles) > 0 {
				return "已选参考图角色：" + strings.Join(inputRoles, "、") + "；未列出的角色不得推断为已选择。"
			}
			return ""
		}(),
		func() string {
			if depthPrompt != "" {
				return "景深与距离：" + depthPrompt + "。"
			}
			return ""
		}(),
		func() string {
			if focusPrompt != "" {
				return "视觉焦点：" + focusPrompt + "。"
			}
			return ""
		}(),
		func() string {
			if materialPrompt != "" {
				return "材质交互：" + materialPrompt + "。"
			}
			return ""
		}(),
		fmt.Sprintf("本张：%s。%s", shot.Label, shot.Direction),
		"手部硬约束：五指、骨骼与关节方向正确，握持受力合理，禁止多指、融合指、反折、穿模；接触阴影、遮挡、透视与反光必须一致；手指不得遮住关键品牌面。",
		"商业质检约束：商品不得变形、拉伸、挤压或融化；Logo 与包装文字锐利清晰准确；商品身份面对焦优先于人脸和背景；尺度符合真人手掌；严禁裸露、色情、性暗示、暴力血腥及其他不宜上架内容；输出可直接进入电商审核。不得把场景或构图参考中的原商品、人物或品牌带入结果。",
	}
	filtered := parts[:0]
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			filtered = append(filtered, part)
		}
	}
	return appendHandheldExecutionConstraints(strings.Join(filtered, "\n"), spec, shot)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return "未填写"
}

func (s *Server) handheldUnitPrice(ctx context.Context, modelID string, params map[string]any, inputCount int) (int64, error) {
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		return 0, err
	}
	selection, configured := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceEcommerce, modelconfig.ModelKindImage, modelID)
	if configured {
		if err := taskflow.ValidateModelImageCapabilities(selection.Model, params, inputCount); err != nil {
			return 0, err
		}
		return modelconfig.EffectiveWorkspacePrice(cfg, modelconfig.WorkspaceEcommerce, selection.Model), nil
	}
	if modelconfig.HasWorkspaceBinding(cfg, modelconfig.WorkspaceEcommerce) || modelID != "" {
		return 0, apperr.E("validation_error", "所选图片模型未分配给电商页面", 422)
	}
	return settings.TaskPriceCents(ctx, s.St.Pool, "ecommerce_design")
}

func (s *Server) publicHandheldCatalog(c *gin.Context) {
	s.publicEcommerceCatalog(c)
}

func (s *Server) quoteHandheldJob(c *gin.Context) {
	if _, err := s.requireUser(c); err != nil {
		fail(c, err)
		return
	}
	var body handheldQuoteIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.ItemCount < 1 || body.ItemCount > 24 || body.InputCount < 1 || body.InputCount > 6 {
		fail(c, apperr.E("validation_error", "生成数量或参考图数量无效", 422))
		return
	}
	params := map[string]any{"publicModelKey": body.ModelID}
	if aspectRatio := strings.TrimSpace(body.AspectRatio); aspectRatio != "" {
		params["aspectRatio"] = aspectRatio
	}
	if quality := strings.TrimSpace(body.Quality); quality != "" {
		params["quality"] = quality
	}
	unit, err := s.handheldUnitPrice(c.Request.Context(), body.ModelID, params, body.InputCount)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"currency": "credits", "unitPriceCents": unit, "itemCount": body.ItemCount, "totalCostCents": unit * int64(body.ItemCount), "authoritative": true})
}

func handheldProjectDict(p *store.EcommerceHandheldProject) gin.H {
	return gin.H{"id": p.ID.String(), "productId": p.ProductID, "name": p.Name, "productSnapshot": p.ProductSnapshot, "draft": p.Draft, "createdAt": isoValue(p.CreatedAt), "updatedAt": isoValue(p.UpdatedAt)}
}

func (s *Server) createHandheldProject(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body handheldProjectIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	_, productID, snapshot, err := s.resolveHandheldProduct(c.Request.Context(), user.ID, body.ProductID)
	if err != nil {
		fail(c, err)
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = firstNonEmpty(fmt.Sprint(snapshot["title"]), "未命名手持项目")
	}
	p := &store.EcommerceHandheldProject{UserID: user.ID, ProductID: productID, Name: name, ProductSnapshot: snapshot, Draft: body.Draft}
	if err := store.InsertEcommerceHandheldProject(c.Request.Context(), s.St.Pool, p); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, handheldProjectDict(p))
}
func (s *Server) listHandheldProjects(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListEcommerceHandheldProjects(c.Request.Context(), s.St.Pool, user.ID, 50)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, p := range rows {
		items = append(items, handheldProjectDict(p))
	}
	ok(c, gin.H{"items": items})
}
func (s *Server) getHandheldProject(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	p, err := store.GetEcommerceHandheldProject(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if p == nil {
		fail(c, apperr.E("not_found", "项目不存在", 404))
		return
	}
	ok(c, handheldProjectDict(p))
}
func (s *Server) updateHandheldProjectDraft(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body handheldDraftIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := store.UpdateEcommerceHandheldProjectDraft(c.Request.Context(), s.St.Pool, user.ID, id, body.Draft); err == pgx.ErrNoRows {
		fail(c, apperr.E("not_found", "项目不存在", 404))
		return
	} else if err != nil {
		fail(c, err)
		return
	}
	p, _ := store.GetEcommerceHandheldProject(c.Request.Context(), s.St.Pool, user.ID, id)
	ok(c, handheldProjectDict(p))
}

func handheldSpecMap(spec handheldSpecIn) map[string]any {
	result := map[string]any{"crop": spec.Crop, "pack": spec.Pack, "platform": spec.Platform, "aspectRatio": spec.AspectRatio, "inputs": spec.Inputs, "shots": spec.Shots}
	for key, value := range map[string]string{"pose": spec.Pose, "hand": spec.Hand, "packState": spec.PackState, "category": spec.Category, "lens": spec.Lens, "light": spec.Light, "camera": spec.Camera, "depth": spec.Depth, "focus": spec.Focus, "materialInteraction": spec.MaterialInteraction, "architecture": spec.Architecture, "style": spec.Style, "sku": spec.SKU, "productName": spec.ProductName, "sellingPoints": spec.SellingPoints, "language": spec.Language} {
		if strings.TrimSpace(value) != "" {
			result[key] = value
		}
	}
	if len(spec.Colorways) > 0 {
		result["colorways"] = spec.Colorways
	}
	if len(spec.Annotations) > 0 {
		result["annotations"] = spec.Annotations
	}
	return result
}

func handheldAssetObjectKeys(userID, itemID uuid.UUID, originalExt, thumbnailExt string) (string, string) {
	prefix := fmt.Sprintf("uploads/%s", userID)
	return fmt.Sprintf("%s/original/handheld-%s.%s", prefix, itemID, originalExt),
		fmt.Sprintf("%s/thumb/handheld-%s.%s", prefix, itemID, thumbnailExt)
}

func handheldGenerationParams(base map[string]any, modelID, aspectRatio string, batchID, itemID uuid.UUID, batchIndex, batchSize int, productID string, snapshot, spec map[string]any, inputRoles any) map[string]any {
	params := make(map[string]any, len(base)+14)
	for key, value := range base {
		if strings.HasPrefix(key, "_") {
			continue
		}
		switch key {
		case "aspectRatio", "quality", "inputFidelity", "moderationLevel", "outputFormat", "resolution", "resolutionScale", "size", "outputSize", "transparentPngEnabled", "transparentBackground":
			continue
		}
		params[key] = value
	}
	params["publicModelKey"] = modelID
	params["aspectRatio"] = aspectRatio
	params["_kind"] = "ui-design-ecommerce-handheld-generation"
	params["handheldBatchId"] = batchID.String()
	params["handheldItemId"] = itemID.String()
	params["batchId"] = batchID.String()
	params["batchIndex"] = batchIndex
	params["batchSize"] = batchSize
	params["commerceProductId"] = productID
	params["commerceProductSnapshot"] = snapshot
	params["handheldSpec"] = spec
	params["inputRoles"] = inputRoles
	return params
}

func (s *Server) createHandheldJob(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body handheldJobIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := validateHandheldSpec(&body.Spec); err != nil {
		fail(c, err)
		return
	}
	_, productID, snapshot, err := s.resolveHandheldProduct(c.Request.Context(), user.ID, body.ProductID)
	if err != nil {
		fail(c, err)
		return
	}
	if productID == nil {
		snapshot = map[string]any{"sku": body.Spec.SKU, "title": body.Spec.ProductName, "category": body.Spec.Category, "sellingPoints": body.Spec.SellingPoints, "protectedElements": []string{}}
	}
	projectID, err := parseOptionalUUID(body.ProjectID, "projectId")
	if err != nil {
		fail(c, err)
		return
	}
	if projectID != nil {
		project, err := store.GetEcommerceHandheldProject(c.Request.Context(), s.St.Pool, user.ID, *projectID)
		if err != nil {
			fail(c, err)
			return
		}
		if project == nil {
			fail(c, apperr.E("not_found", "项目不存在", 404))
			return
		}
		if productID == nil {
			productID = project.ProductID
			snapshot = project.ProductSnapshot
		}
	}
	parentBatchID, err := parseOptionalUUID(body.ParentBatchID, "parentBatchId")
	if err != nil {
		fail(c, err)
		return
	}
	if parentBatchID != nil {
		parent, err := store.GetEcommerceHandheldBatch(c.Request.Context(), s.St.Pool, user.ID, *parentBatchID)
		if err != nil {
			fail(c, err)
			return
		}
		if parent == nil {
			fail(c, apperr.E("not_found", "父批次不存在或不属于当前用户", 404))
			return
		}
	}
	keys := make([]string, len(body.Spec.Inputs))
	for i, input := range body.Spec.Inputs {
		keys[i] = input.Key
	}
	inspect := func(ctx context.Context, key string, max int64) (int64, error) {
		return s.inspectOwnedTaskImage(ctx, user.ID, key, max)
	}
	if err := validateTaskInputImages(c.Request.Context(), user.ID, keys, s.Cfg.UploadMaxBytes, inspect); err != nil {
		fail(c, err)
		return
	}
	params := map[string]any{"aspectRatio": body.Spec.AspectRatio, "publicModelKey": body.ModelID}
	unit, err := s.handheldUnitPrice(c.Request.Context(), body.ModelID, params, len(keys))
	if err != nil {
		fail(c, err)
		return
	}
	batch := &store.EcommerceHandheldBatch{UserID: user.ID, ProjectID: projectID, ProductID: productID, ParentBatchID: parentBatchID, Status: "queued", ModelID: body.ModelID, ProductSnapshot: snapshot, JobSpec: handheldSpecMap(body.Spec), ItemCount: len(body.Spec.Shots), TotalCostCents: unit * int64(len(body.Spec.Shots))}
	if err := store.InsertEcommerceHandheldBatch(c.Request.Context(), s.St.Pool, batch); err != nil {
		fail(c, err)
		return
	}
	for ordinal, input := range body.Spec.Inputs {
		if err := store.InsertEcommerceHandheldInput(c.Request.Context(), s.St.Pool, &store.EcommerceHandheldInput{BatchID: batch.ID, Role: input.Role, ObjectKey: input.Key, Ordinal: ordinal}); err != nil {
			s.compensateHandheldTasks(c.Request.Context(), user.ID, batch.ID, nil)
			fail(c, err)
			return
		}
	}
	createdTasks := []*store.Task{}
	items := []*store.EcommerceHandheldItem{}
	for index, shot := range body.Spec.Shots {
		prompt := compileHandheldPrompt(snapshot, body.Spec, shot)
		item := &store.EcommerceHandheldItem{BatchID: batch.ID, UserID: user.ID, ItemIndex: index, Label: shot.Label, Prompt: prompt, ShotSpec: map[string]any{"id": shot.ID, "label": shot.Label, "direction": shot.Direction, "aspectRatio": shot.AspectRatio, "prompt": prompt}, Status: "queued", QAStatus: "pending", ReviewStatus: "unreviewed"}
		if err := store.InsertEcommerceHandheldItem(c.Request.Context(), s.St.Pool, item); err != nil {
			s.compensateHandheldTasks(c.Request.Context(), user.ID, batch.ID, createdTasks)
			fail(c, err)
			return
		}
		idem := "handheld:" + item.ID.String()
		commerceProductID := ""
		if productID != nil {
			commerceProductID = productID.String()
		}
		taskParams := handheldGenerationParams(nil, body.ModelID, shot.AspectRatio, batch.ID, item.ID, index, len(body.Spec.Shots), commerceProductID, snapshot, batch.JobSpec, body.Spec.Inputs)
		task, _, err := taskflow.CreateTask(c.Request.Context(), s.St, user.ID, taskflow.CreateInput{Type: "ecommerce_design", Prompt: prompt, Params: taskParams, InputKeys: keys, Count: 1, IdempotencyKey: &idem})
		if err != nil {
			s.compensateHandheldTasks(c.Request.Context(), user.ID, batch.ID, createdTasks)
			fail(c, err)
			return
		}
		item.TaskID = &task.ID
		if err := store.AttachEcommerceHandheldItemTask(c.Request.Context(), s.St.Pool, user.ID, item.ID, task.ID); err != nil {
			s.compensateHandheldTasks(c.Request.Context(), user.ID, batch.ID, append(createdTasks, task))
			fail(c, err)
			return
		}
		_ = store.InsertEcommerceHandheldQualityReport(c.Request.Context(), s.St.Pool, item.ID)
		createdTasks = append(createdTasks, task)
		items = append(items, item)
	}
	if err := store.UpdateEcommerceHandheldBatchStatus(c.Request.Context(), s.St.Pool, user.ID, batch.ID, "generating"); err != nil {
		s.compensateHandheldTasks(c.Request.Context(), user.ID, batch.ID, createdTasks)
		fail(c, err)
		return
	}
	batch.Status = "generating"
	for _, task := range createdTasks {
		if s.Queue != nil {
			if err := s.Queue.EnqueueRunTask(c.Request.Context(), task.ID.String()); err != nil {
				log.Printf("handheld task %s enqueue deferred: %v", task.ID, err)
			}
		}
	}
	respondCreated(c, s.handheldBatchResponse(c, batch, items, createdTasks))
}

func (s *Server) compensateHandheldTasks(ctx context.Context, userID, batchID uuid.UUID, tasks []*store.Task) {
	for _, task := range tasks {
		_, _ = taskflow.CancelQueuedTaskSilently(ctx, s.St, userID, task.ID)
	}
	_ = store.UpdateEcommerceHandheldBatchStatus(ctx, s.St.Pool, userID, batchID, "failed")
}

func (s *Server) handheldBatchResponse(c *gin.Context, b *store.EcommerceHandheldBatch, items []*store.EcommerceHandheldItem, tasks []*store.Task) gin.H {
	taskMap := map[uuid.UUID]*store.Task{}
	for _, task := range tasks {
		taskMap[task.ID] = task
	}
	rows := make([]gin.H, 0, len(items))
	for _, item := range items {
		row := gin.H{"id": item.ID.String(), "batchId": item.BatchID.String(), "index": item.ItemIndex, "label": item.Label, "shotSpec": item.ShotSpec, "status": item.Status, "qaStatus": item.QAStatus}
		if item.TaskID != nil {
			row["taskId"] = item.TaskID.String()
			if task := taskMap[*item.TaskID]; task != nil {
				row["task"] = taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task))
				row["status"] = task.Status
			}
		}
		rows = append(rows, row)
	}
	return gin.H{"id": b.ID.String(), "projectId": b.ProjectID, "productId": b.ProductID, "parentBatchId": b.ParentBatchID, "status": b.Status, "modelId": b.ModelID, "productSnapshot": b.ProductSnapshot, "jobSpec": b.JobSpec, "itemCount": b.ItemCount, "totalCostCents": b.TotalCostCents, "items": rows, "createdAt": isoValue(b.CreatedAt), "updatedAt": isoValue(b.UpdatedAt)}
}

func (s *Server) getHandheldJob(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	b, err := store.GetEcommerceHandheldBatch(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if b == nil {
		fail(c, apperr.E("not_found", "手持批次不存在", 404))
		return
	}
	items, err := store.ListEcommerceHandheldItems(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	ids := []uuid.UUID{}
	for _, item := range items {
		if item.TaskID != nil {
			ids = append(ids, *item.TaskID)
		}
	}
	taskMap, err := store.GetTasksByIDs(c.Request.Context(), s.St.Pool, ids)
	if err != nil {
		fail(c, err)
		return
	}
	tasks := make([]*store.Task, 0, len(taskMap))
	succeeded, failed, active, canceled := 0, 0, 0, 0
	for _, item := range items {
		if item.TaskID == nil {
			continue
		}
		task := taskMap[*item.TaskID]
		if task == nil {
			continue
		}
		tasks = append(tasks, task)
		switch task.Status {
		case "succeeded":
			succeeded++
		case "failed":
			failed++
		case "canceled":
			canceled++
		default:
			active++
		}
	}
	status := b.Status
	if active > 0 {
		status = "generating"
	} else if len(items) > 0 && succeeded == len(items) {
		status = "review_ready"
	} else if succeeded > 0 {
		status = "partial"
	} else if canceled == len(items) {
		status = "canceled"
	} else if failed > 0 {
		status = "failed"
	}
	if status != b.Status {
		_ = store.UpdateEcommerceHandheldBatchStatus(c.Request.Context(), s.St.Pool, user.ID, b.ID, status)
		b.Status = status
	}
	ok(c, s.handheldBatchResponse(c, b, items, tasks))
}

func (s *Server) cancelHandheldJob(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	b, err := store.GetEcommerceHandheldBatch(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if b == nil {
		fail(c, apperr.E("not_found", "手持批次不存在", 404))
		return
	}
	items, _ := store.ListEcommerceHandheldItems(c.Request.Context(), s.St.Pool, user.ID, id)
	for _, item := range items {
		if item.TaskID == nil {
			continue
		}
		task, _ := store.GetTask(c.Request.Context(), s.St.Pool, *item.TaskID)
		if task != nil && task.Status == "queued" {
			_, _ = taskflow.CancelTask(c.Request.Context(), s.St, user.ID, task.ID)
		}
	}
	status := b.Status
	if refreshed, refreshErr := store.GetEcommerceHandheldBatch(c.Request.Context(), s.St.Pool, user.ID, id); refreshErr != nil {
		fail(c, refreshErr)
		return
	} else if refreshed != nil {
		status = refreshed.Status
	}
	ok(c, gin.H{"id": id.String(), "status": status})
}

func (s *Server) retryHandheldItem(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	itemID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetEcommerceHandheldItem(c.Request.Context(), s.St.Pool, user.ID, itemID)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil || item.TaskID == nil {
		fail(c, apperr.E("not_found", "失败图片不存在或不属于当前用户", 404))
		return
	}
	previousTask, err := store.GetTask(c.Request.Context(), s.St.Pool, *item.TaskID)
	if err != nil {
		fail(c, err)
		return
	}
	if previousTask == nil || previousTask.UserID != user.ID {
		fail(c, apperr.E("not_found", "失败任务不存在", 404))
		return
	}
	if previousTask.Status != "failed" && previousTask.Status != "canceled" {
		fail(c, apperr.E("handheld_item_not_retryable", "只能重试失败或已取消的图片", 409))
		return
	}
	batch, err := store.GetEcommerceHandheldBatch(c.Request.Context(), s.St.Pool, user.ID, item.BatchID)
	if err != nil {
		fail(c, err)
		return
	}
	if batch == nil {
		fail(c, apperr.E("not_found", "手持批次不存在", 404))
		return
	}
	inputs, err := store.ListEcommerceHandheldInputs(c.Request.Context(), s.St.Pool, batch.ID)
	if err != nil {
		fail(c, err)
		return
	}
	keys := make([]string, 0, len(inputs))
	inputRoles := make([]handheldInputIn, 0, len(inputs))
	for _, input := range inputs {
		keys = append(keys, input.ObjectKey)
		inputRoles = append(inputRoles, handheldInputIn{Role: input.Role, Key: input.ObjectKey})
	}
	if len(keys) == 0 {
		fail(c, apperr.E("validation_error", "原批次参考图已失效，无法重试", 422))
		return
	}
	aspectRatio, _ := item.ShotSpec["aspectRatio"].(string)
	if strings.TrimSpace(aspectRatio) == "" {
		aspectRatio, _ = batch.JobSpec["aspectRatio"].(string)
	}
	if strings.TrimSpace(aspectRatio) == "" {
		fail(c, apperr.E("validation_error", "原任务缺少画面比例，无法重试", 422))
		return
	}
	productID := ""
	if batch.ProductID != nil {
		productID = batch.ProductID.String()
	}
	previousTaskID := *item.TaskID
	idem := "handheld-retry:" + item.ID.String() + ":" + uuid.NewString()
	taskParams := handheldGenerationParams(previousTask.Params, batch.ModelID, aspectRatio, batch.ID, item.ID, item.ItemIndex, batch.ItemCount, productID, batch.ProductSnapshot, batch.JobSpec, inputRoles)
	task, _, err := taskflow.CreateTaskWithCommitHook(c.Request.Context(), s.St, user.ID, taskflow.CreateInput{
		Type:           "ecommerce_design",
		Prompt:         item.Prompt,
		Params:         taskParams,
		InputKeys:      keys,
		Count:          1,
		IdempotencyKey: &idem,
	}, func(ctx context.Context, tx pgx.Tx, createdTask *store.Task, _ bool) error {
		updatedBatchID, updated, err := store.RetryEcommerceHandheldItem(ctx, tx, user.ID, item.ID, previousTaskID, createdTask.ID, createdTask.CostCents)
		if err != nil {
			return err
		}
		if !updated || updatedBatchID != batch.ID {
			return apperr.E("handheld_item_not_retryable", "该图片已被重试或任务状态已变化", 409)
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	item.TaskID = &task.ID
	item.Status = task.Status
	item.QAStatus = "pending"
	item.ReviewStatus = "unreviewed"
	item.ReviewNote = ""
	batch.Status = "generating"
	batch.TotalCostCents += task.CostCents
	if s.Queue != nil {
		if err := s.Queue.EnqueueRunTask(c.Request.Context(), task.ID.String()); err != nil {
			log.Printf("handheld retry task %s enqueue deferred: %v", task.ID, err)
		}
	}
	ok(c, gin.H{
		"id":      item.ID.String(),
		"batchId": batch.ID.String(),
		"taskId":  task.ID.String(),
		"task":    taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task)),
	})
}

func (s *Server) saveHandheldItemAsset(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body handheldSaveAssetIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetEcommerceHandheldItem(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil || item.TaskID == nil {
		fail(c, apperr.E("not_found", "生成项不存在", 404))
		return
	}
	task, err := store.GetTask(c.Request.Context(), s.St.Pool, *item.TaskID)
	if err != nil {
		fail(c, err)
		return
	}
	if task == nil || task.UserID != user.ID || task.Status != "succeeded" || len(task.OutputKeys) == 0 {
		fail(c, apperr.E("validation_error", "仅已完成的手持商品图可以保存", 422))
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		title = item.Label
	}
	if title == "" || utf8.RuneCountInString(title) > 120 {
		fail(c, apperr.E("validation_error", "title: 长度须在 1-120 之间", 422))
		return
	}
	original, err := s.Storage.GetBytes(c.Request.Context(), task.OutputKeys[0])
	if err != nil {
		fail(c, apperr.E("validation_error", "生成结果文件已失效，请重新生成", 422))
		return
	}
	if len(original) > maxUserAssetImageBytes {
		fail(c, apperr.E("validation_error", "生成结果超过素材库 10MB 限制", 422))
		return
	}
	ext, contentType := sniffImage(original)
	if ext == "" {
		fail(c, apperr.E("validation_error", "生成结果不是有效图片", 422))
		return
	}
	thumbnail := original
	thumbExt := ext
	thumbContentType := contentType
	if len(task.ThumbnailKeys) > 0 {
		if data, readErr := s.Storage.GetBytes(c.Request.Context(), task.ThumbnailKeys[0]); readErr == nil {
			if detected, detectedType := sniffImage(data); detected != "" && len(data) <= maxUserAssetImageBytes {
				thumbnail, thumbExt = data, detected
				thumbContentType = detectedType
			}
		}
	}
	originalKey, thumbnailKey := handheldAssetObjectKeys(user.ID, item.ID, ext, thumbExt)
	var asset *store.UserAsset
	created := false
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		if err := store.LockUserAssetCreation(c.Request.Context(), tx, user.ID); err != nil {
			return err
		}
		existing, err := store.GetUserAssetByFileKey(c.Request.Context(), tx, user.ID, originalKey)
		if err != nil {
			return err
		}
		if existing != nil {
			asset = existing
			return nil
		}
		count, err := store.CountUserAssets(c.Request.Context(), tx, user.ID)
		if err != nil {
			return err
		}
		if count >= maxUserAssets {
			return apperr.E("asset_limit_reached", "素材库最多保存 200 项", 409)
		}
		if err := s.Storage.UploadBytes(c.Request.Context(), originalKey, original, contentType); err != nil {
			return err
		}
		if err := s.Storage.UploadBytes(c.Request.Context(), thumbnailKey, thumbnail, thumbContentType); err != nil {
			_ = s.Storage.DeleteKeys(c.Request.Context(), []string{originalKey})
			return err
		}
		cleanup := func() {
			_ = s.Storage.DeleteKeys(c.Request.Context(), []string{originalKey, thumbnailKey})
		}
		asset, err = store.InsertUserAsset(c.Request.Context(), tx, user.ID, title, originalKey, thumbnailKey, contentType, int64(len(original)), nil)
		if err != nil {
			cleanup()
			return err
		}
		if err := store.AddUserUploadReferences(c.Request.Context(), tx, user.ID, store.UploadReferenceUserAsset, asset.ID, []string{originalKey, thumbnailKey}); err != nil {
			cleanup()
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	if created {
		respondCreated(c, userAssetDict(asset))
		return
	}
	ok(c, userAssetDict(asset))
}
