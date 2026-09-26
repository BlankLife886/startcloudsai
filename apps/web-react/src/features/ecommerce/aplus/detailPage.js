/**
 * AI 详情页（多平台）：出图方向 → 策划方案 → 单张版块图 blueprint。
 * 平台为 Amazon 时，把每个方向映射到 A+ 官方模块尺寸并附带 Seller Central 合规约束；
 * 其他平台按用户选择的画幅出图，多张可拼接成详情长图。
 */
import {
  aplusAspectRatio,
  aplusMarketplaceById,
  aplusModuleTypeById,
  aplusTierById,
} from "./amazonAplus.js";

export const DETAIL_NOTE_MAX = 2000;
export const DETAIL_EXTRA_REFERENCE_MAX = 3;
export const DETAIL_PRODUCT_REFERENCE_MAX = 6;
export const DETAIL_EXTRA_REFERENCE_ROLE =
  "补充参考图（模特 / 细节 / 证书 / 配件）：只用于对应版块的事实依据，不改变商品身份";

export const DETAIL_RATIO_OPTIONS = [
  { value: "3:4", label: "3:4 详情" },
  { value: "1:1", label: "1:1 方图" },
  { value: "4:5", label: "4:5 竖图" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "4:3", label: "4:3 横图" },
  { value: "16:9", label: "16:9 横图" },
];

export function isAmazonPlatform(platform) {
  return /amazon|亚马逊/i.test(String(platform || ""));
}

// PEPCF 角色 → A+ 官方模块类型；Premium 档位的首屏 / 证明位换成 Premium 模块
const AMAZON_MODULE_BY_PEPCF = {
  basic: {
    Problem: ["std-header"],
    Explain: ["std-overlay-light", "std-four-image"],
    Compare: ["std-compare"],
    Proof: ["std-specs", "std-highlights"],
    Finish: ["std-overlay-dark"],
  },
  premium: {
    Problem: ["premium-banner", "std-header"],
    Explain: ["premium-three", "std-overlay-light", "std-four-image"],
    Compare: ["std-compare"],
    Proof: ["premium-hotspots", "std-specs", "std-highlights"],
    Finish: ["std-overlay-dark"],
  },
};

export function amazonModuleForDirection(direction, tierId = "basic", usage = {}) {
  const tier = aplusTierById(tierId);
  const table = AMAZON_MODULE_BY_PEPCF[tier.id] || AMAZON_MODULE_BY_PEPCF.basic;
  const candidates = table[direction?.pepcf] || table.Explain;
  // 同一 PEPCF 角色多张时轮换模块类型，避免整页都是同一种版式
  const used = usage[direction?.pepcf] || 0;
  const typeId = candidates[used % candidates.length];
  return aplusModuleTypeById(typeId);
}

/**
 * @param {Array} directions 已勾选的出图方向（含自定义）
 * @param {object|null} plan 后端策划结果 { summary, painPoints, items[{id, headline, subline, direction}] }
 * @param {object} options { platform, aspectRatio, amazon: { marketplaceId, tier } }
 */
export function detailShotBlueprintsFromPlan(directions = [], plan = null, options = {}) {
  const { platform = "", aspectRatio = "3:4", amazon = {} } = options;
  const amazonMode = isAmazonPlatform(platform);
  const tier = aplusTierById(amazon.tier);
  const planItems = new Map(
    (plan?.items || []).map((item) => [String(item.id || ""), item]),
  );
  const usage = {};
  const list = amazonMode ? directions.slice(0, tier.maxModules) : directions;
  return list.map((direction, index) => {
    const planned = planItems.get(String(direction.value)) || null;
    const headline = String(planned?.headline || "").trim();
    const subline = String(planned?.subline || "").trim();
    const plannedDirection = String(planned?.direction || "").trim();
    const base = {
      id: direction.value || `detail-${index + 1}`,
      label: direction.label,
      headline,
      subline,
      direction: [
        direction.direction || "",
        plannedDirection ? `策划方向：${plannedDirection}` : "",
        headline ? `画面主标题：「${headline}」。` : "",
        subline ? `副文案：「${subline}」。` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
    if (!amazonMode) {
      return { ...base, aspectRatio };
    }
    const moduleType = amazonModuleForDirection(direction, tier.id, usage);
    usage[direction.pepcf] = (usage[direction.pepcf] || 0) + 1;
    const outputSize = `${moduleType.width}x${moduleType.height}`;
    return {
      ...base,
      direction: `${base.direction} 亚马逊 A+ 模块「${moduleType.amazonName}」，精确输出 ${outputSize} RGB。`,
      aspectRatio: aplusAspectRatio(moduleType.width, moduleType.height),
      outputSize,
      aplusSpec: {
        id: base.id,
        typeId: moduleType.id,
        amazonName: moduleType.amazonName,
        pepcf: direction.pepcf || moduleType.pepcf,
        width: moduleType.width,
        height: moduleType.height,
        outputSize,
        headline,
        body: subline,
      },
    };
  });
}

export function buildDetailTaskPrompt({
  platform = "",
  market = "",
  language = "",
  tone = "",
  productName = "",
  sellingPoints = "",
  note = "",
  plan = null,
  hasExtraReferences = false,
  amazon = null,
} = {}) {
  const amazonMode = isAmazonPlatform(platform);
  const marketplace = amazonMode ? aplusMarketplaceById(amazon?.marketplaceId) : null;
  const lines = [
    "任务：电商详情页版块出图。每张是一张独立的版块图，多张连续可拼成详情长图；不是整页截图，不是编辑器界面。",
    `投放平台：${platform || "通用电商"}；目标市场：${market || "通用"}；画面文字语言：${language || "简体中文"}。`,
    productName.trim() ? `商品名称：${productName.trim()}。` : "",
    sellingPoints.trim() ? `已确认卖点与参数：${sellingPoints.trim()}。` : "",
    tone ? `视觉风格：${tone}。` : "",
    note.trim() ? `用户补充描述：${note.trim()}。` : "",
    plan?.summary ? `整页视觉主线：${plan.summary}。` : "",
    plan?.painPoints?.length
      ? `买家核心痛点：${plan.painPoints.join("、")}。版块顺序要先回应痛点再给证明。`
      : "",
    hasExtraReferences ? `${DETAIL_EXTRA_REFERENCE_ROLE}。` : "",
    "画面文字只能使用已提供的商品名、卖点、参数和策划文案；无法可靠生成时优先留白，不虚构认证、参数、销量、评价和价格。",
  ];
  if (amazonMode && marketplace) {
    lines.push(
      `Amazon A+ 规范：目标站 ${marketplace.label}（${marketplace.site}），文案语言 ${marketplace.language}，单位 ${marketplace.units}。`,
      `画面风格参考：${marketplace.imageStyle}。`,
      amazon?.asin ? `本商品 ASIN：${amazon.asin}。` : "",
      amazon?.competitorAsin
        ? `竞品 ASIN ${amazon.competitorAsin} 只用于版块结构与卖点参考，禁止复制其品牌、商标或原文案。`
        : "",
      "合规：无水印、无 GIF、无 HTML、无外链、无价格、无未证实的极限词；画面不要自行加 AI 标记，卖家须在 Seller Central 手动勾选 AI Disclosure。",
    );
  }
  lines.push("严格保持参考商品造型、颜色、比例、Logo、包装文字与材质细节一致。");
  return lines.filter(Boolean).join("\n");
}

export function detailExportChecklist(blueprints = [], rows = [], meta = {}) {
  const amazonMode = isAmazonPlatform(meta.platform);
  return blueprints.map((shot, index) => {
    const row = rows[index];
    return {
      index: index + 1,
      platform: meta.platform || "",
      asin: amazonMode ? meta.asin || "" : "",
      marketplace: amazonMode ? meta.marketplaceId || "" : meta.market || "",
      module: shot.aplusSpec?.amazonName || shot.label,
      pepcf: shot.aplusSpec?.pepcf || "",
      size: shot.outputSize || shot.aspectRatio || "",
      headline: shot.headline || "",
      body: shot.subline || "",
      imageReady: Boolean(row?.url),
      note: amazonMode
        ? "Upload this RGB image into the matching A+ module. Mark AI-generated content Disclosure in Seller Central. Do not add HTML, GIF, prices or off-Amazon links."
        : "按顺序拼接为详情长图；上传前核对文案与平台规范。",
    };
  });
}

export function detailChecklistCsv(rows = []) {
  const header = [
    "index",
    "platform",
    "asin",
    "marketplace",
    "module",
    "pepcf",
    "size",
    "headline",
    "body",
    "note",
  ];
  const escape = (value) => `"${String(value || "").replace(/"/g, '""')}"`;
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => escape(row[key])).join(",")),
  ].join("\n");
}
