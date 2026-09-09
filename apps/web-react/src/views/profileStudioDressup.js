export const DRESSUP_CATEGORIES = [
  { id: "hair", label: "发型", icon: "bi-scissors", hint: "只改发型结构，发色和脸保持原样", placeholder: "例如：双马尾，保持现在的发色" },
  { id: "head", label: "头戴", icon: "bi-earbuds", hint: "帽子、发箍、耳机、花环", placeholder: "例如：浅色猫耳发箍" },
  { id: "glasses", label: "眼镜", icon: "bi-eyeglasses", hint: "眼镜或墨镜", placeholder: "例如：细圆框眼镜" },
  { id: "face", label: "面饰", icon: "bi-emoji-smile", hint: "口罩、面贴、面纱", placeholder: "例如：浅色口罩，露出眼睛" },
  { id: "makeup", label: "妆容", icon: "bi-palette", hint: "只改妆容，五官不变", placeholder: "例如：清透自然妆" },
  { id: "earrings", label: "耳环", icon: "bi-gem", hint: "耳钉、耳环、耳饰", placeholder: "例如：银色圆环耳环" },
  { id: "necklace", label: "项链", icon: "bi-circle", hint: "项链、颈圈、吊坠", placeholder: "例如：细吊坠项链" },
  { id: "collar", label: "领饰", icon: "bi-bookmark", hint: "领带、领结、围巾", placeholder: "例如：红色蝴蝶结" },
  { id: "suit", label: "套装", icon: "bi-layers", hint: "整套替换上衣和下衣", placeholder: "例如：JK 制服套装" },
  { id: "top", label: "上衣", icon: "bi-person", hint: "单独替换上装", placeholder: "例如：宽松连帽卫衣" },
  { id: "bottom", label: "下衣", icon: "bi-square-half", hint: "裙子或裤子", placeholder: "例如：百褶短裙" },
  { id: "outer", label: "外套", icon: "bi-wind", hint: "外套、披风、开衫", placeholder: "例如：黑色长款风衣" },
  { id: "belt", label: "腰带", icon: "bi-dash-lg", hint: "皮带、腰封、腰链", placeholder: "例如：银色装饰腰链" },
  { id: "socks", label: "袜子", icon: "bi-align-bottom", hint: "短袜、过膝袜、丝袜", placeholder: "例如：白色过膝袜" },
  { id: "shoes", label: "鞋子", icon: "bi-arrow-bar-down", hint: "鞋款和颜色", placeholder: "例如：黑色短靴" },
  { id: "ankle", label: "脚踝", icon: "bi-dot", hint: "脚链、绑带", placeholder: "例如：细银脚链" },
  { id: "hands", label: "手戴", icon: "bi-hand-index", hint: "手套、手链、戒指", placeholder: "例如：黑色半指手套" },
  { id: "weapon", label: "武器", icon: "bi-lightning-charge", hint: "手持或背负的武器", placeholder: "例如：银色长剑" },
  { id: "prop", label: "道具", icon: "bi-mic", hint: "麦克风、玩偶、阳伞", placeholder: "例如：手持麦克风" },
  { id: "pose", label: "动作", icon: "bi-person-arms-up", hint: "全身站姿，人物不换人", placeholder: "例如：单手叉腰站立" },
  { id: "back", label: "背部", icon: "bi-feather", hint: "翅膀、披风、光环", placeholder: "例如：白色天使翼" },
  { id: "tail", label: "尾巴", icon: "bi-bezier2", hint: "猫尾、狐尾等", placeholder: "例如：蓬松狐尾" },
  { id: "bag", label: "背包", icon: "bi-backpack", hint: "书包、斜挎、痛包", placeholder: "例如：双肩书包" },
  { id: "companion", label: "跟随", icon: "bi-heart", hint: "小跟随物，不要场景", placeholder: "例如：身边一只小猫" },
  { id: "fx", label: "特效", icon: "bi-stars", hint: "星屑、花瓣、光晕，不要背景", placeholder: "例如：身边少量星屑" },
];

export function emptyDressupSlot() {
  return { previewUrl: "", file: null, text: "", sourceUrl: "" };
}

export function emptyDressupSelection() {
  return Object.fromEntries(DRESSUP_CATEGORIES.map((category) => [category.id, emptyDressupSlot()]));
}

export function hasDressupImage(slot = {}) {
  return Boolean(slot.file || String(slot.sourceUrl || "").trim() || String(slot.previewUrl || "").trim());
}

export function isDressupSlotFilled(slot = {}) {
  return Boolean(String(slot.text || "").trim() || hasDressupImage(slot));
}

export function dressupSlotSummary(slot = {}) {
  const text = String(slot.text || "").trim();
  if (hasDressupImage(slot)) {
    const kind = slot.file ? "已上传参考图" : "已选资产";
    return text ? `参考图 · ${text}` : kind;
  }
  return text;
}

export function selectedDressupSlots(selection = {}) {
  return DRESSUP_CATEGORIES.map((category) => {
    const slot = selection[category.id] || emptyDressupSlot();
    if (!isDressupSlotFilled(slot)) return null;
    return { category, slot, text: String(slot.text || "").trim() };
  }).filter(Boolean);
}

export function revokeDressupPreview(slot) {
  const url = String(slot?.previewUrl || "");
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function revokeDressupSelection(selection = {}) {
  DRESSUP_CATEGORIES.forEach((category) => revokeDressupPreview(selection[category.id]));
}

export function serializeDressupSelection(selection = {}) {
  return Object.fromEntries(
    DRESSUP_CATEGORIES.map((category) => {
      const slot = selection[category.id] || emptyDressupSlot();
      return [
        category.id,
        {
          text: String(slot.text || "").trim(),
          hasImage: hasDressupImage(slot),
        },
      ];
    }),
  );
}

export function buildDressupSourcePlan(selection = {}) {
  const extras = [];
  const lines = [];
  let nextImage = 2;
  const picked = selectedDressupSlots(selection);
  const suit = picked.find(({ category }) => category.id === "suit");
  for (const { category, slot, text } of picked) {
    const parts = [];
    if (hasDressupImage(slot)) {
      parts.push(
        `按第${nextImage}张参考图的款式、颜色、材质与结构替换该部位，贴合当前角色身材与透视，不要把参考图里的人物换进来`,
      );
      if (slot.file) extras.push({ file: slot.file });
      else if (slot.sourceUrl) extras.push({ url: slot.sourceUrl });
      nextImage += 1;
    }
    if (text) parts.push(text);
    lines.push(`${category.label}：${parts.join("；")}`);
  }
  const prompt = [
    "第一张图是当前角色立绘。严格保留其外貌、脸型、发色、身材比例与气质，不要换成另一个人。若装扮要求改变发型，只改发型结构，发色与脸仍保持一致。",
    "按以下装扮更新形象；未提到的部位保持第一张参考图原样：",
    ...lines.map((line) => `- ${line}`),
    suit ? "若已填写套装，以上衣与下衣以套装整体为准，不要再拆成冲突的单件。" : "",
    "固定 2:3 竖构图，全身入镜，高像素高清二次元插画。透明背景。不要任何场景、地面、圆形或椭圆平台、展示台、光圈、光效背景、阴影底板、角色周围的圆形或椭圆边框、立绘外框、轮廓线或文字。no oval frame, no circular border, no standing platform, no vignette. 人物边缘干净，适合直接作为个人工作室形象。",
  ]
    .filter(Boolean)
    .join("\n");
  return { prompt, extras, files: extras.map((item) => item.file).filter(Boolean), picked };
}

export function buildDressupPrompt(selection = {}) {
  return buildDressupSourcePlan(selection).prompt;
}
