/**
 * AI 饰品穿戴 — independent jewelry/accessory commercial studio domain.
 * Generation uses generic ecommerce_design tasks with accessorySpec snapshots.
 */
const ACCESSORY_QA_LOCK =
  "质检硬门槛：饰品不得改款、镜像或补造；宝石、珍珠、镶爪、链节、扣头、Logo、刻字和成对数量必须与参考商品一致。佩戴部位、朝向、真实尺度、透视、接触、遮挡和阴影必须成立；禁止饰品穿透人体、悬浮、链条断裂、手指或耳朵畸形。";

export const ACCESSORY_DEFAULT_CATEGORY_ID = "earring";
export const ACCESSORY_DEFAULT_PACK_ID = "pdp";
export const ACCESSORY_DEFAULT_MATERIAL_ID = "auto";
export const ACCESSORY_DEFAULT_SCALE_ID = "visual";
export const ACCESSORY_DEFAULT_OCCLUSION_ID = "natural";
export const ACCESSORY_DEFAULT_CROP_ID = "local";
export const ACCESSORY_DEFAULT_STYLE_ID = "catalog";

export const ACCESSORY_CATEGORY_OPTIONS = [
  {
    id: "earring",
    label: "耳饰",
    anchor: "耳洞 / 耳垂",
    defaultCrop: "local",
    prompt:
      "品类：耳饰。准确定位耳洞和耳垂，保持左右成对规则、耳针或耳钩结构、垂坠方向与重力；发丝和耳廓形成真实前后遮挡。",
  },
  {
    id: "necklace",
    label: "项链 / 吊坠",
    anchor: "颈线 / 锁骨",
    defaultCrop: "half",
    prompt:
      "品类：项链或吊坠。链条沿颈部和锁骨连续贴合，长度档位、吊坠朝向和重力正确；衣领、头发与链条前后关系真实。",
  },
  {
    id: "ring",
    label: "戒指",
    anchor: "手指 / 指根",
    defaultCrop: "macro",
    prompt:
      "品类：戒指。戴在指定手指的指根位置，环体透视椭圆和指肉压合自然，不得穿透或悬浮；戒面、镶爪和主石朝向准确。",
  },
  {
    id: "bracelet",
    label: "手链 / 手镯",
    anchor: "腕骨 / 腕围",
    defaultCrop: "local",
    prompt:
      "品类：手链或手镯。围绕腕部椭圆曲面，松紧间隙、腕骨位置、扣头朝向和吊饰重力合理；袖口遮挡自然。",
  },
  {
    id: "brooch",
    label: "胸针",
    anchor: "衣料表面",
    defaultCrop: "local",
    prompt:
      "品类：胸针。贴合衣料表面法线，固定结构隐藏，布料产生轻微可信受力，商品不得像贴纸一样悬浮。",
  },
  {
    id: "hair",
    label: "发饰",
    anchor: "发束 / 头部曲面",
    defaultCrop: "local",
    prompt:
      "品类：发饰。固定点、插入方向和头发体积合理，发丝在饰品前后自然穿插，但不得覆盖关键设计细节。",
  },
  {
    id: "watch",
    label: "腕表",
    anchor: "腕部 / 表带",
    defaultCrop: "local",
    prompt:
      "品类：腕表。表盘方向、表冠、表带闭合和腕围正确；表盘文字、刻度、指针与 Logo 必须完全保持参考商品身份。",
  },
  {
    id: "glasses",
    label: "眼镜",
    anchor: "鼻梁 / 耳廓",
    defaultCrop: "half",
    prompt:
      "品类：眼镜。鼻托、镜腿和耳廓接触准确，镜框对称且不穿透面部；镜片透射、反光和轻微折射符合环境光。",
  },
];

export const ACCESSORY_PACK_OPTIONS = [
  {
    id: "single",
    label: "单张佩戴主图",
    hint: "验证商品与佩戴关系",
    use: "PDP 佩戴首图",
    shotIds: ["hero"],
  },
  {
    id: "pdp",
    label: "详情页套图",
    hint: "佩戴、角度、比例、细节",
    use: "商品详情页副图",
    shotIds: ["hero", "angle", "scale", "macro"],
  },
  {
    id: "social",
    label: "社媒种草包",
    hint: "近景、穿搭和竖屏传播",
    use: "社媒与内容投放",
    shotIds: ["hero", "style", "macro", "story"],
  },
  {
    id: "campaign",
    label: "品牌广告组",
    hint: "主视觉、工艺、品牌氛围",
    use: "活动与广告素材",
    shotIds: ["hero", "macro", "style"],
  },
];

export const ACCESSORY_MATERIAL_OPTIONS = [
  {
    id: "auto",
    label: "按商品识别",
    prompt: "材质只按商品参考图识别，不猜测贵金属纯度、宝石种类或证书信息。",
  },
  {
    id: "polished",
    label: "镜面金属",
    prompt:
      "镜面金属保留清晰但受控的环境反射和窄高光，金属颜色准确，禁止塑料感和大面积死白。",
  },
  {
    id: "brushed",
    label: "拉丝 / 磨砂",
    prompt:
      "拉丝或磨砂金属保留细密方向性纹理，反射柔和，不能错误改成镜面电镀。",
  },
  {
    id: "gemstone",
    label: "宝石镶嵌",
    prompt:
      "宝石数量、排列、切面、镶爪和主石颜色必须一致；火彩随光线自然出现，禁止补造假宝石或噪点高光。",
  },
  {
    id: "pearl",
    label: "珍珠 / 贝母",
    prompt:
      "珍珠或贝母保持原有数量、大小和色调，表现柔和层次高光与自然珠光，禁止过曝成白色圆球。",
  },
  {
    id: "mixed",
    label: "混合材质",
    prompt:
      "分别保持金属、宝石、皮革或珐琅的光学差异，不得把多材质统一生成成同一种表面。",
  },
];

export const ACCESSORY_SCALE_OPTIONS = [
  {
    id: "visual",
    label: "视觉比例",
    prompt:
      "按商品参考与人体锚点推定可信视觉比例，但不得宣称为精确尺码或实际试戴测量。",
  },
  {
    id: "true",
    label: "真实尺寸",
    prompt:
      "以用户填写的毫米尺寸为硬约束，按人体锚点和透视换算真实佩戴尺度，不得为突出商品而放大。",
  },
];

export const ACCESSORY_OCCLUSION_OPTIONS = [
  {
    id: "natural",
    label: "自然遮挡",
    prompt: "保留发丝、耳廓、衣领、袖口和皮肤形成的真实前后遮挡与接触阴影。",
  },
  {
    id: "clean",
    label: "商品优先",
    prompt:
      "通过姿态和发型让商品主体尽量完整可见，但不得用错误抠图、悬浮或擦除人体来强行露出商品。",
  },
  {
    id: "editorial",
    label: "编辑感遮挡",
    prompt:
      "允许克制的发丝或服装前景形成层次，关键结构、主石、Logo 和扣合关系仍须可识别。",
  },
];

export const ACCESSORY_CROP_OPTIONS = [
  {
    id: "macro",
    label: "微距特写",
    prompt: "以佩戴部位微距特写为主，工艺细节清晰。",
  },
  {
    id: "local",
    label: "局部佩戴",
    prompt: "完整交代佩戴部位与邻近人体比例。",
  },
  {
    id: "half",
    label: "半身穿搭",
    prompt: "半身构图同时展示人物气质与饰品比例。",
  },
  {
    id: "full",
    label: "全身造型",
    prompt: "全身穿搭构图，饰品仍保持可识别的视觉重点。",
  },
];

export const ACCESSORY_STYLE_OPTIONS = [
  {
    id: "catalog",
    label: "安静商品感",
    prompt: "干净克制的电商棚拍，肤色与材质准确，背景不抢商品。",
  },
  {
    id: "luxury",
    label: "高级珠宝感",
    prompt: "精确控光、深浅对比和克制留白，强调工艺而非堆砌奢华装饰。",
  },
  {
    id: "editorial",
    label: "杂志编辑感",
    prompt: "明确构图和时装语气，保留真实皮肤与摄影光学。",
  },
  {
    id: "lifestyle",
    label: "自然生活方式",
    prompt: "可信日常场景和自然姿态，避免模板化自拍和虚假用户评价感。",
  },
];

const ACCESSORY_SHOTS = {
  hero: {
    id: "hero",
    label: "佩戴主图",
    direction:
      "在正确身体锚点自然佩戴，商品完整、尺度可信、人物姿态克制，适合作为详情页核心佩戴图。",
  },
  angle: {
    id: "angle",
    label: "补充角度",
    direction:
      "使用轻微三分之四或侧向机位展示商品与人体曲面的佩戴关系，不补造参考图不可见的商品结构。",
  },
  scale: {
    id: "scale",
    label: "比例说明",
    direction:
      "构图必须同时交代商品与耳朵、锁骨、手指或腕部的相对尺度，禁止为视觉冲击任意放大商品。",
  },
  macro: {
    id: "macro",
    label: "工艺微距",
    direction:
      "聚焦镶嵌、链节、扣头、刻字或材质细节，商品结构以原始参考为准，景深不能遮掉关键工艺。",
  },
  style: {
    id: "style",
    label: "穿搭场景",
    direction:
      "在完整造型中展示饰品与服装、肤色和场景的搭配关系，饰品仍是明确视觉重点。",
  },
  story: {
    id: "story",
    label: "竖屏传播",
    direction:
      "移动端竖构图，主体位于安全区内，为标题预留空间，但画面本身不生成促销文字或虚假评价。",
  },
};

function byId(options, id, fallbackId) {
  return (
    options.find((item) => item.id === id) ||
    options.find((item) => item.id === fallbackId) ||
    options[0]
  );
}

export function accessoryCategoryById(id) {
  return byId(ACCESSORY_CATEGORY_OPTIONS, id, ACCESSORY_DEFAULT_CATEGORY_ID);
}

export function accessoryPackById(id) {
  return byId(ACCESSORY_PACK_OPTIONS, id, ACCESSORY_DEFAULT_PACK_ID);
}

export function accessoryShotBlueprints(packId) {
  return accessoryPackById(packId).shotIds.map((id) => ACCESSORY_SHOTS[id]);
}

export const ACCESSORY_SLOT_ROLES = ["product", "model", "scene"];
export const ACCESSORY_SLOT_LABELS = {
  product: "饰品",
  model: "模特",
  scene: "场景",
};

export function emptyAccessorySlots() {
  return { product: null, model: null, scene: null };
}

/** Pack slots for ecommerce_design: scene only ships when model is present. */
export function packAccessorySlotFiles(slots = {}) {
  const files = [];
  if (slots.product?.file) files.push(slots.product.file);
  if (slots.model?.file) files.push(slots.model.file);
  if (slots.model?.file && slots.scene?.file) files.push(slots.scene.file);
  return files;
}

export function accessorySlotPresence(slots = {}) {
  const hasProduct = Boolean(slots.product?.file);
  const hasModel = Boolean(slots.model?.file);
  const hasSceneFile = Boolean(slots.scene?.file);
  return {
    hasProduct,
    hasModel,
    hasScene: hasModel && hasSceneFile,
    sceneIgnoredWithoutModel: hasSceneFile && !hasModel,
    referenceCount:
      (hasProduct ? 1 : 0) +
      (hasModel ? 1 : 0) +
      (hasModel && hasSceneFile ? 1 : 0),
  };
}

export function accessoryReferencesFromSlots(slots = {}) {
  return ACCESSORY_SLOT_ROLES.map((role) => slots[role] || null);
}

export function nextEmptyAccessorySlot(slots = {}) {
  return (
    ACCESSORY_SLOT_ROLES.find((role) => !slots[role]?.file) ||
    ACCESSORY_SLOT_ROLES[0]
  );
}

export function accessoryReferenceRoles(referenceCount = 1) {
  return ["饰品身份", "模特身份", "场景环境"].slice(
    0,
    Math.max(1, Math.min(3, Number(referenceCount) || 1)),
  );
}

export function buildAccessorySpec({
  category = ACCESSORY_DEFAULT_CATEGORY_ID,
  pack = ACCESSORY_DEFAULT_PACK_ID,
  material = ACCESSORY_DEFAULT_MATERIAL_ID,
  scale = ACCESSORY_DEFAULT_SCALE_ID,
  sizeMm = "",
  occlusion = ACCESSORY_DEFAULT_OCCLUSION_ID,
  crop = ACCESSORY_DEFAULT_CROP_ID,
  style = ACCESSORY_DEFAULT_STYLE_ID,
  platform = "独立站",
  market = "中国大陆",
  aspectRatio = "4:5",
  productName = "",
  sku = "",
  sellingPoints = "",
  hasModel = false,
  hasScene = false,
  shotId = "",
  shotLabel = "",
} = {}) {
  const spec = {
    schemaVersion: 1,
    category: accessoryCategoryById(category).id,
    pack: accessoryPackById(pack).id,
    material: byId(
      ACCESSORY_MATERIAL_OPTIONS,
      material,
      ACCESSORY_DEFAULT_MATERIAL_ID,
    ).id,
    scale: byId(ACCESSORY_SCALE_OPTIONS, scale, ACCESSORY_DEFAULT_SCALE_ID).id,
    sizeMm: String(sizeMm || "").trim(),
    occlusion: byId(
      ACCESSORY_OCCLUSION_OPTIONS,
      occlusion,
      ACCESSORY_DEFAULT_OCCLUSION_ID,
    ).id,
    crop: byId(ACCESSORY_CROP_OPTIONS, crop, ACCESSORY_DEFAULT_CROP_ID).id,
    style: byId(ACCESSORY_STYLE_OPTIONS, style, ACCESSORY_DEFAULT_STYLE_ID).id,
    platform: String(platform || "").trim() || "独立站",
    market: String(market || "").trim() || "中国大陆",
    aspectRatio: String(aspectRatio || "").trim() || "4:5",
    productName: String(productName || "").trim(),
    sku: String(sku || "").trim(),
    sellingPoints: String(sellingPoints || "").trim(),
    hasModel: Boolean(hasModel),
    hasScene: Boolean(hasScene),
  };
  if (String(shotId || "").trim()) spec.shotId = String(shotId).trim();
  if (String(shotLabel || "").trim()) spec.shotLabel = String(shotLabel).trim();
  return spec;
}

export function buildAccessoryIdentityLock({
  hasModel = false,
  hasScene = false,
} = {}) {
  return [
    "饰品身份锁：第 1 张参考图是唯一商品事实来源，锁定外轮廓、部件拓扑、宝石与珍珠数量、镶爪、链节、扣头、Logo、刻字、颜色、材质、正反面和真实佩戴尺度；不可镜像、补造、删减或换成相似款。",
    hasModel
      ? "人物身份锁：第 2 张参考图只定义同一位模特，锁定脸型、五官比例、肤色、年龄感、发型和体型；只允许调整姿态与机位。"
      : "未提供模特参考时生成自然、非名人化的商业模特，同一套图保持同一人物身份。",
    hasScene
      ? "场景分离锁：第 3 张只提供环境、光线、色彩和空间，不得带入其中的人物、商品、Logo 或文字。"
      : "场景按所选商业风格生成，保持克制并服务于饰品识别。",
  ].join("\n");
}

export function buildAccessoryTaskPrompt({
  productName = "",
  sku = "",
  sellingPoints = "",
  category = ACCESSORY_DEFAULT_CATEGORY_ID,
  pack = ACCESSORY_DEFAULT_PACK_ID,
  material = ACCESSORY_DEFAULT_MATERIAL_ID,
  scale = ACCESSORY_DEFAULT_SCALE_ID,
  sizeMm = "",
  occlusion = ACCESSORY_DEFAULT_OCCLUSION_ID,
  crop = ACCESSORY_DEFAULT_CROP_ID,
  style = ACCESSORY_DEFAULT_STYLE_ID,
  platform = "独立站",
  market = "中国大陆",
  aspectRatio = "4:5",
  hasModel = false,
  hasScene = false,
} = {}) {
  const categoryOption = accessoryCategoryById(category);
  const packOption = accessoryPackById(pack);
  const materialOption = byId(
    ACCESSORY_MATERIAL_OPTIONS,
    material,
    ACCESSORY_DEFAULT_MATERIAL_ID,
  );
  const scaleOption = byId(
    ACCESSORY_SCALE_OPTIONS,
    scale,
    ACCESSORY_DEFAULT_SCALE_ID,
  );
  const occlusionOption = byId(
    ACCESSORY_OCCLUSION_OPTIONS,
    occlusion,
    ACCESSORY_DEFAULT_OCCLUSION_ID,
  );
  const cropOption = byId(
    ACCESSORY_CROP_OPTIONS,
    crop,
    ACCESSORY_DEFAULT_CROP_ID,
  );
  const styleOption = byId(
    ACCESSORY_STYLE_OPTIONS,
    style,
    ACCESSORY_DEFAULT_STYLE_ID,
  );
  const normalizedSize = String(sizeMm || "").trim();

  return [
    "任务：生成可用于电商详情页或商业投放的饰品真人穿戴图。AI 只负责人物、场景和融合，不得重新设计商品。",
    `商品：${String(productName || "").trim() || "根据第 1 张参考图准确识别"}。`,
    String(sku || "").trim() ? `SKU / 货号：${String(sku).trim()}。` : "",
    String(sellingPoints || "").trim()
      ? `已确认卖点与要求：${String(sellingPoints).trim()}。未提供的信息不得猜测。`
      : "未提供的材质纯度、宝石种类、产地、证书和功效不得猜测或写入画面。",
    categoryOption.prompt,
    `人体锚点：${categoryOption.anchor}。`,
    materialOption.prompt,
    scaleOption.prompt,
    scale === "true" && normalizedSize
      ? `真实尺寸：${normalizedSize} mm，以此为硬约束。`
      : scale === "true"
        ? "当前未填写毫米尺寸，只能保持可信视觉比例，不得输出精确尺码声明。"
        : "",
    occlusionOption.prompt,
    cropOption.prompt,
    styleOption.prompt,
    `本次交付：${packOption.label}，用于${packOption.use}。`,
    `适配平台：${platform}；目标市场：${market}；画面比例：${aspectRatio}。`,
    hasModel
      ? "人物身份以第 2 张参考图为准。"
      : "生成同一位自然、非名人化商业模特并在整套图中保持身份一致。",
    hasScene
      ? "环境以第 3 张参考图为准。"
      : "背景保持商业摄影质感，不添加促销文字。",
    "摄影要求：真实全画幅商业摄影，保留皮肤纹理；金属高光、宝石火彩、珍珠珠光和接触阴影随环境光成立，禁止 CG、塑料感和过度磨皮。",
    ACCESSORY_QA_LOCK,
  ]
    .filter(Boolean)
    .join("\n");
}
