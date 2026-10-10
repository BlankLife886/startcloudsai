// en / note 只进提示词：gpt-image-2 编辑接口对英文部位名和约束理解更稳定，用户描述原样保留。
export const DRESSUP_CATEGORIES = [
  { id: "hair", label: "发型", en: "Hairstyle", icon: "bi-scissors", hint: "只改发型结构，发色和脸保持原样", placeholder: "例如：双马尾，保持现在的发色", note: "change only the hairstyle shape; keep the hair color and face" },
  { id: "head", label: "头戴", en: "Headwear", icon: "bi-earbuds", hint: "帽子、发箍、耳机、花环", placeholder: "例如：浅色猫耳发箍" },
  { id: "glasses", label: "眼镜", en: "Eyewear", icon: "bi-eyeglasses", hint: "眼镜或墨镜", placeholder: "例如：细圆框眼镜" },
  { id: "face", label: "面饰", en: "Face accessory", icon: "bi-emoji-smile", hint: "口罩、面贴、面纱", placeholder: "例如：浅色口罩，露出眼睛" },
  { id: "makeup", label: "妆容", en: "Makeup", icon: "bi-palette", hint: "只改妆容，五官不变", placeholder: "例如：清透自然妆", note: "change only the makeup; facial features stay identical" },
  { id: "earrings", label: "耳环", en: "Earrings", icon: "bi-gem", hint: "耳钉、耳环、耳饰", placeholder: "例如：银色圆环耳环" },
  { id: "necklace", label: "项链", en: "Necklace", icon: "bi-circle", hint: "项链、颈圈、吊坠", placeholder: "例如：细吊坠项链" },
  { id: "collar", label: "领饰", en: "Neckwear", icon: "bi-bookmark", hint: "领带、领结、围巾", placeholder: "例如：红色蝴蝶结" },
  { id: "suit", label: "套装", en: "Full outfit", icon: "bi-layers", hint: "整套替换上衣和下衣", placeholder: "例如：JK 制服套装", note: "replaces both top and bottom as one coordinated outfit" },
  { id: "top", label: "上衣", en: "Top", icon: "bi-person", hint: "单独替换上装", placeholder: "例如：宽松连帽卫衣" },
  { id: "bottom", label: "下衣", en: "Bottom", icon: "bi-square-half", hint: "裙子或裤子", placeholder: "例如：百褶短裙" },
  { id: "outer", label: "外套", en: "Outerwear", icon: "bi-wind", hint: "外套、披风、开衫", placeholder: "例如：黑色长款风衣" },
  { id: "belt", label: "腰带", en: "Belt", icon: "bi-dash-lg", hint: "皮带、腰封、腰链", placeholder: "例如：银色装饰腰链" },
  { id: "socks", label: "袜子", en: "Legwear", icon: "bi-align-bottom", hint: "短袜、过膝袜、丝袜", placeholder: "例如：白色过膝袜" },
  { id: "shoes", label: "鞋子", en: "Shoes", icon: "bi-arrow-bar-down", hint: "鞋款和颜色", placeholder: "例如：黑色短靴" },
  { id: "ankle", label: "脚踝", en: "Anklet", icon: "bi-dot", hint: "脚链、绑带", placeholder: "例如：细银脚链" },
  { id: "hands", label: "手戴", en: "Handwear", icon: "bi-hand-index", hint: "手套、手链、戒指", placeholder: "例如：黑色半指手套" },
  { id: "weapon", label: "武器", en: "Weapon", icon: "bi-lightning-charge", hint: "手持或背负的武器", placeholder: "例如：银色长剑" },
  { id: "prop", label: "道具", en: "Handheld prop", icon: "bi-mic", hint: "麦克风、玩偶、阳伞", placeholder: "例如：手持麦克风" },
  { id: "pose", label: "动作", en: "Pose", icon: "bi-person-arms-up", hint: "全身站姿，人物不换人", placeholder: "例如：单手叉腰站立", note: "same person and outfit, still a full-body standing pose" },
  { id: "back", label: "背部", en: "Back accessory", icon: "bi-feather", hint: "翅膀、披风、光环", placeholder: "例如：白色天使翼" },
  { id: "tail", label: "尾巴", en: "Tail", icon: "bi-bezier2", hint: "猫尾、狐尾等", placeholder: "例如：蓬松狐尾" },
  { id: "bag", label: "背包", en: "Bag", icon: "bi-backpack", hint: "书包、斜挎、痛包", placeholder: "例如：双肩书包" },
  { id: "companion", label: "跟随", en: "Small companion", icon: "bi-heart", hint: "小跟随物，不要场景", placeholder: "例如：身边一只小猫", note: "small and right next to the character; no scene" },
  { id: "fx", label: "特效", en: "Effects", icon: "bi-stars", hint: "星屑、花瓣、光晕，不要背景", placeholder: "例如：身边少量星屑", note: "a few small effects close to the character; no background" },
];

export const DRESSUP_GROUPS = [
  { id: "head", label: "头部", icon: "bi-person-bounding-box", items: ["hair", "head", "glasses", "face", "makeup", "earrings"] },
  { id: "wear", label: "服装", icon: "bi-handbag", items: ["suit", "top", "bottom", "outer", "socks", "shoes"] },
  { id: "acc", label: "配饰", icon: "bi-gem", items: ["necklace", "collar", "belt", "hands", "ankle", "bag"] },
  { id: "prop", label: "道具", icon: "bi-magic", items: ["weapon", "prop", "companion"] },
  { id: "fx", label: "姿态特效", icon: "bi-stars", items: ["pose", "back", "tail", "fx"] },
];

// 一次改太多部位，编辑模型容易把脸和身材一起改掉；超过的分几轮换。
export const DRESSUP_MAX_PARTS = 4;
// 第一张参考图固定是当前立绘，其余名额给部位参考图。
export const DRESSUP_DEFAULT_MAX_REFERENCES = 4;

// 套装与上衣/下衣互斥，界面直接锁住冲突的一侧。
const DRESSUP_EXCLUSIVE = { suit: ["top", "bottom"], top: ["suit"], bottom: ["suit"] };

export const DRESSUP_PRESETS = [
  { id: "jk", label: "JK 制服", tone: "#6d8cff", slots: { suit: "藏青色 JK 水手服套装，红色领结", socks: "黑色过膝袜", shoes: "棕色乐福鞋" } },
  { id: "cyber", label: "赛博机能", tone: "#35d6ff", slots: { outer: "黑色机能风长外套，荧光蓝线条", glasses: "半透明科技护目镜", hands: "黑色半指战术手套" } },
  { id: "hanfu", label: "古风汉服", tone: "#ff8fb1", slots: { suit: "浅粉色齐胸襦裙汉服，轻纱披帛", head: "珍珠流苏发簪" } },
  { id: "street", label: "休闲街头", tone: "#ffb74d", slots: { top: "宽松白色连帽卫衣", bottom: "浅蓝色阔腿牛仔裤", shoes: "白色厚底运动鞋" } },
  { id: "knight", label: "奇幻骑士", tone: "#b8c4ff", slots: { suit: "银白色轻型骑士铠甲", weapon: "银色长剑", back: "深蓝色长披风" } },
  { id: "lolita", label: "甜系洛丽塔", tone: "#f5a3ff", slots: { suit: "粉白色洛丽塔连衣裙", head: "蕾丝蝴蝶结发饰", shoes: "玛丽珍圆头鞋" } },
];

export const DEFAULT_DRESSUP_PROMPT_TEMPLATE = [
  "Image 1 is the current character. Edit only the items listed below and keep everything else identical to image 1: the same person, face, body proportions, hair color, pose, art style and line quality.",
  "Any later reference images show items only: copy their design, color, material and structure onto the character, fitted to the character's body and perspective. Never copy the person, pose or background from them.",
  "Changes:",
  "{{items}}",
  "Keep the whole figure visible from head to toe in the same vertical 2:3 framing. Output the character on a genuinely fully transparent alpha background; everything outside the character's silhouette stays transparent. No backdrop, floor, platform, cast shadow, frame or text.",
].join("\n");

export function dressupCategory(id) {
  return DRESSUP_CATEGORIES.find((category) => category.id === id) || null;
}

export function dressupGroupOf(categoryId) {
  return DRESSUP_GROUPS.find((group) => group.items.includes(categoryId)) || DRESSUP_GROUPS[0];
}

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

export function dressupUsage(selection = {}, maxReferenceImages = DRESSUP_DEFAULT_MAX_REFERENCES) {
  const picked = selectedDressupSlots(selection);
  const images = picked.filter(({ slot }) => hasDressupImage(slot)).length;
  const imageLimit = Math.max(0, (Number(maxReferenceImages) || DRESSUP_DEFAULT_MAX_REFERENCES) - 1);
  return { parts: picked.length, partLimit: DRESSUP_MAX_PARTS, images, imageLimit };
}

// 返回该部位不能再填写的原因；已填写的部位始终可以修改或清空。
export function dressupSlotLock(selection = {}, categoryId, maxReferenceImages) {
  const slot = selection[categoryId] || emptyDressupSlot();
  const usage = dressupUsage(selection, maxReferenceImages);
  const conflict = (DRESSUP_EXCLUSIVE[categoryId] || []).find((id) => isDressupSlotFilled(selection[id]));
  if (conflict && !isDressupSlotFilled(slot)) {
    return { locked: true, imageLocked: true, reason: `已选「${dressupCategory(conflict)?.label}」，与「${dressupCategory(categoryId)?.label}」冲突，先移除它再换` };
  }
  if (!isDressupSlotFilled(slot) && usage.parts >= usage.partLimit) {
    return { locked: true, imageLocked: true, reason: `一轮最多换 ${usage.partLimit} 个部位，先生成，再在结果上继续换` };
  }
  if (!hasDressupImage(slot) && usage.images >= usage.imageLimit) {
    return {
      locked: false,
      imageLocked: true,
      reason: usage.imageLimit
        ? `参考图名额已满（${usage.imageLimit} 张），这个部位可以只写描述`
        : "当前模型只接受立绘一张参考图，部位只能写描述",
    };
  }
  return { locked: false, imageLocked: false, reason: "" };
}

export function revokeDressupPreview(slot) {
  const url = String(slot?.previewUrl || "");
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function revokeDressupSelection(selection = {}) {
  DRESSUP_CATEGORIES.forEach((category) => revokeDressupPreview(selection[category.id]));
}

export function dressupSelectionFromPreset(preset) {
  const selection = emptyDressupSelection();
  for (const [id, text] of Object.entries(preset?.slots || {})) {
    if (selection[id]) selection[id] = { ...emptyDressupSlot(), text };
  }
  return selection;
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

export function buildDressupSourcePlan(selection = {}, options = {}) {
  const extras = [];
  const lines = [];
  let nextImage = 2;
  const picked = selectedDressupSlots(selection);
  for (const { category, slot, text } of picked) {
    const parts = [];
    if (text) parts.push(text);
    if (hasDressupImage(slot)) {
      parts.push(`match the item shown in image ${nextImage}`);
      if (slot.file) extras.push({ file: slot.file });
      else if (slot.sourceUrl) extras.push({ url: slot.sourceUrl });
      nextImage += 1;
    }
    if (category.note) parts.push(category.note);
    lines.push(`- ${category.en}: ${parts.join("; ")}`);
  }
  const template = String(options.template || "").includes("{{items}}")
    ? String(options.template)
    : DEFAULT_DRESSUP_PROMPT_TEMPLATE;
  const prompt = template.replace("{{items}}", lines.join("\n")).trim();
  return { prompt, extras, files: extras.map((item) => item.file).filter(Boolean), picked };
}

export function buildDressupPrompt(selection = {}, options = {}) {
  return buildDressupSourcePlan(selection, options).prompt;
}

// ---- 衣橱：只存在本机浏览器，按账号隔离 ----

const WARDROBE_PREFIX = "starclouds.profile-wardrobe:";
export const WARDROBE_LIMIT = 30;

function wardrobeKey(userId) {
  return `${WARDROBE_PREFIX}${String(userId || "").trim()}`;
}

export function readWardrobe(userId) {
  if (!userId || typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(wardrobeKey(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.url === "string" && item.url) : [];
  } catch {
    return [];
  }
}

function writeWardrobe(userId, items) {
  if (!userId || typeof localStorage === "undefined") return items;
  try {
    localStorage.setItem(wardrobeKey(userId), JSON.stringify(items.slice(0, WARDROBE_LIMIT)));
  } catch {
    // Storage may be full or blocked; the wardrobe is a convenience only.
  }
  return items.slice(0, WARDROBE_LIMIT);
}

// 衣橱只能记「生成任务原图」：账号里的形象文件在换下一张时会被服务端清理，
// 而任务原图随生成记录长期保留，穿回时服务端会重新拷贝一份作为形象。
export function isTaskOriginalUrl(url = "") {
  return /\/api\/v1\/files\/tasks\/[^/?#]+\/[^/?#]+\/original\//i.test(String(url));
}

// kind: "look" 为换装结果，"before" 为换装前的形象（用于撤销）。同一张原图只保留一条。
// url 是任务原图（穿回用），savedUrl 是它当前在账号里的形象地址（判断「穿着中」用）。
export function addWardrobeEntry(userId, entry) {
  const url = String(entry?.url || "").trim();
  if (!url) return readWardrobe(userId);
  const current = readWardrobe(userId).filter((item) => item.url !== url);
  const next = [
    {
      id: entry.id || `look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      savedUrl: String(entry.savedUrl || "").trim(),
      kind: entry.kind === "before" ? "before" : "look",
      labels: Array.isArray(entry.labels) ? entry.labels.slice(0, 8) : [],
      createdAt: entry.createdAt || new Date().toISOString(),
    },
    ...current,
  ];
  return writeWardrobe(userId, next);
}

export function removeWardrobeEntry(userId, id) {
  return writeWardrobe(userId, readWardrobe(userId).filter((item) => item.id !== id));
}

export function updateWardrobeEntry(userId, id, patch) {
  return writeWardrobe(
    userId,
    readWardrobe(userId).map((item) => (item.id === id ? { ...item, ...patch } : item)),
  );
}

export function isWearingLook(item = {}, currentFigureUrl = "") {
  const current = String(currentFigureUrl || "").trim();
  return Boolean(current) && (item.savedUrl === current || item.url === current);
}

// 账号形象地址 → 生成它的任务原图。撤销换装时靠它找回「换装前」的原图。
const FIGURE_SOURCE_PREFIX = "starclouds.profile-figure-source:";

function readFigureSources(userId) {
  if (!userId || typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(`${FIGURE_SOURCE_PREFIX}${userId}`) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberFigureSource(userId, savedUrl, sourceUrl) {
  const saved = String(savedUrl || "").trim();
  const source = String(sourceUrl || "").trim();
  if (!userId || !saved || !isTaskOriginalUrl(source) || typeof localStorage === "undefined") return;
  const entries = Object.entries({ ...readFigureSources(userId), [saved]: source }).slice(-WARDROBE_LIMIT);
  try {
    localStorage.setItem(`${FIGURE_SOURCE_PREFIX}${userId}`, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Convenience only.
  }
}

export function figureSourceFor(userId, savedUrl) {
  const saved = String(savedUrl || "").trim();
  if (!saved) return "";
  if (isTaskOriginalUrl(saved)) return saved;
  const fromMap = readFigureSources(userId)[saved];
  if (fromMap) return fromMap;
  const look = readWardrobe(userId).find((item) => item.savedUrl === saved);
  return look && isTaskOriginalUrl(look.url) ? look.url : "";
}
