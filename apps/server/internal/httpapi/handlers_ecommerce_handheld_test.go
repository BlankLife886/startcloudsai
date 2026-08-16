package httpapi

import (
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

func validHandheldSpec() handheldSpecIn {
	return handheldSpecIn{
		Pose: "grip", Hand: "right", Crop: "wrist", Pack: "single",
		PackState: "unboxed", Platform: "taobao", Lens: "portrait",
		Light: "fill", Camera: "eye", Architecture: "auto", AspectRatio: "4:5",
		Depth: "balanced", Focus: "product_identity", MaterialInteraction: "glass",
		Inputs: []handheldInputIn{{Role: "product_front", Key: "uploads/user/front.png"}},
		Shots:  []handheldShotIn{{ID: "hero", Label: "手持主图", Direction: "展示正面"}},
	}
}

func TestValidateHandheldSpecRequiresProductIdentity(t *testing.T) {
	spec := validHandheldSpec()
	spec.Inputs[0].Role = "scene"
	if err := validateHandheldSpec(&spec); err == nil {
		t.Fatal("expected product identity validation error")
	}
}

func TestValidateHandheldSpecRejectsTryonRoles(t *testing.T) {
	spec := validHandheldSpec()
	spec.Inputs = append(spec.Inputs, handheldInputIn{Role: "garment", Key: "uploads/user/garment.png"})
	if err := validateHandheldSpec(&spec); err == nil {
		t.Fatal("expected try-on role to be rejected")
	}
}

func TestValidateHandheldSpecOrdersProductReferencesFirst(t *testing.T) {
	spec := validHandheldSpec()
	spec.Inputs = []handheldInputIn{
		{Role: "scene", Key: "uploads/user/scene.png"},
		{Role: "hand_or_model", Key: "uploads/user/model.png"},
		{Role: "product_side", Key: "uploads/user/side.png"},
		{Role: "product_front", Key: "uploads/user/front.png"},
	}
	if err := validateHandheldSpec(&spec); err != nil {
		t.Fatalf("validate input order: %v", err)
	}
	want := []string{"product_front", "product_side", "hand_or_model", "scene"}
	for index, role := range want {
		if spec.Inputs[index].Role != role {
			t.Fatalf("input %d role = %q, want %q", index, spec.Inputs[index].Role, role)
		}
	}
}

func TestHandheldGenerationParamsUseHighFidelityAndDropExecutionState(t *testing.T) {
	batchID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	itemID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	params := handheldGenerationParams(map[string]any{
		"quality":                  "low",
		"inputFidelity":            "low",
		"moderationLevel":          "low",
		"batchId":                  "stale-batch",
		"_failedProviderConfigIds": []string{"stale-provider"},
		"_upstreamStage":           "async_pending",
	}, "model-id", "3:4", batchID, itemID, 2, 4, "product-id", map[string]any{"title": "product"}, map[string]any{"pack": "listing"}, []handheldInputIn{{Role: "product_front", Key: "front.png"}})
	if params["quality"] != "high" || params["inputFidelity"] != "high" {
		t.Fatalf("handheld fidelity params = quality:%#v fidelity:%#v", params["quality"], params["inputFidelity"])
	}
	if params["batchId"] != batchID.String() || params["handheldItemId"] != itemID.String() {
		t.Fatalf("handheld identity params = batch:%#v item:%#v", params["batchId"], params["handheldItemId"])
	}
	if params["moderationLevel"] != "low" {
		t.Fatalf("semantic retry option was not preserved: %#v", params)
	}
	for _, key := range []string{"_failedProviderConfigIds", "_upstreamStage"} {
		if _, exists := params[key]; exists {
			t.Fatalf("execution state %s leaked into retry params: %#v", key, params)
		}
	}
	if params["_kind"] != "ui-design-ecommerce-handheld-generation" {
		t.Fatalf("handheld task kind = %#v", params["_kind"])
	}
}

func TestCompileHandheldPromptCarriesProductTruth(t *testing.T) {
	spec := validHandheldSpec()
	prompt := compileHandheldPrompt(map[string]any{
		"title": "星云精华瓶", "sku": "SKU-42", "brand": "StarClouds",
		"material": "磨砂玻璃", "color": "海盐蓝", "dimensions": "42x42x118mm",
		"protectedElements": []string{"瓶身金色 Logo", "正面净含量 30ml"},
	}, spec, spec.Shots[0])
	for _, required := range []string{"StarClouds", "42x42x118mm", "瓶身金色 Logo", "正面净含量 30ml", "product_front", "景深与距离", "第一视觉中心", "玻璃透明"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt missing %q: %s", required, prompt)
		}
	}
}

func TestHandheldAnnotationsAreValidatedStoredAndCompiled(t *testing.T) {
	spec := validHandheldSpec()
	spec.Language = "en"
	spec.Annotations = []handheldAnnotationIn{{
		ID: "front-copy", Role: "product_front", X: 0.42, Y: 0.31,
		Text: "保留净含量 30ml",
	}}
	if err := validateHandheldSpec(&spec); err != nil {
		t.Fatalf("validate annotations: %v", err)
	}
	stored := handheldSpecMap(spec)
	if stored["language"] != "en" {
		t.Fatalf("language not stored: %#v", stored)
	}
	if _, ok := stored["annotations"]; !ok {
		t.Fatalf("annotations not stored: %#v", stored)
	}
	prompt := compileHandheldPrompt(map[string]any{}, spec, spec.Shots[0])
	for _, required := range []string{"画面文案语言：英文", "图片位置标注", "product_front (42%, 31%)", "保留净含量 30ml"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt missing %q: %s", required, prompt)
		}
	}
}

func TestValidateHandheldAnnotationsRejectsInvalidInput(t *testing.T) {
	for name, annotation := range map[string]handheldAnnotationIn{
		"role":       {ID: "a", Role: "scene", X: 0.5, Y: 0.5, Text: "说明"},
		"coordinate": {ID: "a", Role: "product_front", X: 1.1, Y: 0.5, Text: "说明"},
		"empty":      {ID: "a", Role: "product_front", X: 0.5, Y: 0.5, Text: ""},
	} {
		t.Run(name, func(t *testing.T) {
			spec := validHandheldSpec()
			spec.Annotations = []handheldAnnotationIn{annotation}
			if err := validateHandheldSpec(&spec); err == nil {
				t.Fatal("expected annotation validation error")
			}
		})
	}
	spec := validHandheldSpec()
	spec.Language = "unknown"
	if err := validateHandheldSpec(&spec); err == nil {
		t.Fatal("expected language validation error")
	}
}

func TestValidateHandheldSpecKeepsPicturePlanEmpty(t *testing.T) {
	spec := validHandheldSpec()
	spec.Pose = ""
	spec.Hand = ""
	spec.PackState = ""
	spec.Category = ""
	spec.Lens = ""
	spec.Light = ""
	spec.Camera = ""
	spec.Depth = ""
	spec.Focus = ""
	spec.MaterialInteraction = ""
	spec.Architecture = ""
	if err := validateHandheldSpec(&spec); err != nil {
		t.Fatalf("validate empty picture plan: %v", err)
	}
	for key, value := range map[string]string{
		"pose": spec.Pose, "hand": spec.Hand, "packState": spec.PackState,
		"category": spec.Category,
		"lens":     spec.Lens, "light": spec.Light, "camera": spec.Camera,
		"depth": spec.Depth, "focus": spec.Focus,
		"materialInteraction": spec.MaterialInteraction, "architecture": spec.Architecture,
	} {
		if value != "" {
			t.Fatalf("unselected %s was defaulted to %q", key, value)
		}
	}
	stored := handheldSpecMap(spec)
	for _, key := range []string{"pose", "hand", "packState", "category", "lens", "light", "camera", "depth", "focus", "materialInteraction", "architecture"} {
		if _, exists := stored[key]; exists {
			t.Fatalf("unselected %s leaked into stored job spec", key)
		}
	}
}

func TestCompileHandheldPromptUsesVisibleShotRulesExactly(t *testing.T) {
	spec := validHandheldSpec()
	spec.Crop = "full"
	spec.Hand = "right"
	spec.Inputs = append(spec.Inputs,
		handheldInputIn{Role: "hand_or_model", Key: "uploads/user/model.png"},
		handheldInputIn{Role: "scene", Key: "uploads/user/scene.png"},
	)
	spec.Shots[0].Prompt = "用户可见的完整规则\n只使用已选择的配置。\n" + handheldExecutionConstraints(spec, spec.Shots[0])
	if err := validateHandheldSpec(&spec); err != nil {
		t.Fatalf("validate prompt override: %v", err)
	}
	prompt := compileHandheldPrompt(map[string]any{}, spec, spec.Shots[0])
	if prompt != spec.Shots[0].Prompt {
		t.Fatalf("visible prompt changed before upstream: %q", prompt)
	}
}

func TestCompileHandheldPromptRestoresMissingExecutionConstraints(t *testing.T) {
	spec := validHandheldSpec()
	spec.Crop = "full"
	spec.Hand = "right"
	spec.Inputs = append(spec.Inputs,
		handheldInputIn{Role: "hand_or_model", Key: "uploads/user/model.png"},
		handheldInputIn{Role: "scene", Key: "uploads/user/scene.png"},
	)
	spec.Shots[0].Prompt = "旧客户端提交的可见规则"
	prompt := compileHandheldPrompt(map[string]any{}, spec, spec.Shots[0])
	for _, required := range []string{handheldFinalConstraintMarker, "从头顶到双脚", "参考若只有上半身", "人物本人的右手", "场景参考为唯一背景事实"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt missing execution constraint %q: %s", required, prompt)
		}
	}
}

func TestCompileHandheldPromptRestoresUseShotSharpnessForLegacyPrompt(t *testing.T) {
	spec := validHandheldSpec()
	spec.Shots = []handheldShotIn{{
		ID: "use", Label: "使用瞬间", Direction: "表现正在使用商品",
		Prompt: "旧客户端提交的可见规则\n" + handheldExecutionConstraints(spec, handheldShotIn{ID: "hero"}),
	}}
	prompt := compileHandheldPrompt(map[string]any{}, spec, spec.Shots[0])
	if !strings.Contains(prompt, handheldUseShotSharpnessOverride) {
		t.Fatalf("legacy use-shot prompt missing sharpness override: %s", prompt)
	}
	if strings.Count(prompt, "本张使用瞬间覆盖") != 1 {
		t.Fatalf("expected one sharpness override, got: %s", prompt)
	}
}

func TestCompileHandheldPromptForcesUseShotFullFrameSharpness(t *testing.T) {
	spec := validHandheldSpec()
	spec.Depth = "balanced"
	spec.Shots = []handheldShotIn{{ID: "use", Label: "使用瞬间", Direction: "表现正在使用商品"}}
	prompt := compileHandheldPrompt(map[string]any{}, spec, spec.Shots[0])
	for _, required := range []string{"整张画面必须锐利清晰", "禁止浅景深", "禁止只让人物清晰"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("use-shot prompt missing %q: %s", required, prompt)
		}
	}
	for _, absent := range []string{"背景柔和分离", "只允许虚化背景或手背"} {
		if strings.Contains(prompt, absent) {
			t.Fatalf("use-shot prompt still allows partial blur %q: %s", absent, prompt)
		}
	}
}

func TestCompileHandheldPromptOmitsEmptyPicturePlan(t *testing.T) {
	spec := validHandheldSpec()
	spec.Pose, spec.Hand, spec.PackState, spec.Category = "", "", "", ""
	spec.Lens, spec.Light, spec.Camera = "", "", ""
	spec.Depth, spec.Focus, spec.MaterialInteraction = "", "", ""
	spec.Architecture, spec.Style = "", ""
	prompt := compileHandheldPrompt(map[string]any{}, spec, spec.Shots[0])
	for _, required := range []string{"刚性外形", "对焦平面必须落在商品身份面", "手迁就商品", "严禁生成裸露"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt missing product fidelity %q: %s", required, prompt)
		}
	}
	for _, absent := range []string{"姿势=", "手=", "包装状态=", "品类=", "镜头=", "光线=", "机位=", "生成架构=", "视觉风格=", "景深与距离：", "视觉焦点：", "材质交互："} {
		if strings.Contains(prompt, absent) {
			t.Fatalf("unselected picture plan leaked %q: %s", absent, prompt)
		}
	}
}

func TestHandheldEnumsMatchFrontendDomain(t *testing.T) {
	for key, value := range map[string]string{
		"crop": "noface", "packState": "kit", "platform": "xhs",
		"lens": "normal", "light": "available", "architecture": "composite",
		"depth": "deep", "focus": "functional_detail", "materialInteraction": "screen",
	} {
		if !store.Contains(handheldEnums[key], value) {
			t.Fatalf("%s must support frontend value %q", key, value)
		}
	}
}

func TestHandheldAssetObjectKeysAreStablePerItem(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	itemID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	original, thumbnail := handheldAssetObjectKeys(userID, itemID, "png", "jpg")
	if original != "uploads/11111111-1111-1111-1111-111111111111/original/handheld-22222222-2222-2222-2222-222222222222.png" {
		t.Fatalf("unexpected original key: %s", original)
	}
	if thumbnail != "uploads/11111111-1111-1111-1111-111111111111/thumb/handheld-22222222-2222-2222-2222-222222222222.jpg" {
		t.Fatalf("unexpected thumbnail key: %s", thumbnail)
	}
}
