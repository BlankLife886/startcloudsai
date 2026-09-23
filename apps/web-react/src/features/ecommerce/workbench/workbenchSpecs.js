// 通用电商工作台（画布优先）模块规格。
// 复用手持 / 饰品 / 试衣三个模块的视觉语言，把“商品套图、爆款复刻、营销图、
// 背景图、扩图、增强、背景复刻、商品阴影、创意商拍”统一到同一套画布交互上。

export const WORKBENCH_RATIO_CHANNELS = Object.freeze([
  { id: "1:1", label: "方图", ratio: "1:1", hint: "货架主图 · 淘宝 / Amazon" },
  { id: "4:5", label: "竖图", ratio: "4:5", hint: "通用竖构图 · 社媒" },
  { id: "3:4", label: "详情", ratio: "3:4", hint: "详情页配图 · 小红书" },
  { id: "16:9", label: "横图", ratio: "16:9", hint: "官网 Banner · 横版投放" },
  { id: "9:16", label: "竖屏", ratio: "9:16", hint: "抖音 / 信息流投放" },
]);

const OUTPAINT_CHANNELS = Object.freeze([
  { id: "1:1", label: "方图", ratio: "1:1", hint: "扩成货架主图" },
  { id: "4:5", label: "竖图", ratio: "4:5", hint: "扩成社媒竖图" },
  { id: "3:4", label: "详情", ratio: "3:4", hint: "扩成详情配图" },
  { id: "16:9", label: "横幅", ratio: "16:9", hint: "扩成 Banner 横图" },
  { id: "9:16", label: "竖屏", ratio: "9:16", hint: "扩成信息流竖屏" },
]);

const PRODUCT_SLOT = Object.freeze({
  index: 0,
  tag: "商品",
  icon: "bi-box-seam",
  emptyLabel: "拖拽或点击",
  required: true,
  angles: true,
  side: "left",
});

// 可选的风格 / 构图参考图：独立于商品参考序列，生成时追加为最后一张
const STYLE_SLOT = Object.freeze({
  key: "style",
  tag: "参考图",
  icon: "bi-image",
  emptyLabel: "可选：风格 / 构图参考",
  required: false,
  side: "right",
});

export const WORKBENCH_SPECS = Object.freeze({
  shoot: {
    id: "shoot",
    resultLabel: "商拍成片",
    slots: [PRODUCT_SLOT, STYLE_SLOT],
    channels: WORKBENCH_RATIO_CHANNELS,
    channelKicker: "投放到",
    packKind: "shoot",
    packs: [
      { id: "hero", label: "商品主视觉", shotIds: ["hero"] },
      { id: "duo", label: "主图 + 场景", shotIds: ["hero", "lifestyle"] },
      {
        id: "set",
        label: "商业成片",
        shotIds: ["hero", "lifestyle", "detail", "selling"],
      },
    ],
    picks: [{ key: "direction", label: "拍摄方向" }],
    note: true,
    emptyTitle: "还没有商拍成片",
    emptySteps: ["上传商品图", "选择投放比例与成片组合", "点生成，首张锁定系列视觉"],
    historyLabel: "AI 商拍",
  },
  listing: {
    id: "listing",
    resultLabel: "商品套图",
    slots: [PRODUCT_SLOT, STYLE_SLOT],
    channels: WORKBENCH_RATIO_CHANNELS,
    channelKicker: "投放到",
    packKind: "types",
    packs: [],
    picks: [],
    note: true,
    planning: true,
    emptyTitle: "还没有商品套图",
    emptySteps: [
      "上传商品图（可多角度）",
      "勾选出图类型，填好商品卖点",
      "智能直出，或先让 AI 策划每张文案",
    ],
    historyLabel: "商品套图",
  },
  clone: {
    id: "clone",
    resultLabel: "爆款复刻",
    slots: [
      {
        index: 0,
        tag: "爆款参考",
        icon: "bi-copy",
        emptyLabel: "拖入爆款图",
        required: true,
        side: "left",
      },
      {
        index: 1,
        tag: "你的商品",
        icon: "bi-box-seam",
        emptyLabel: "替换为你的商品",
        required: false,
        side: "right",
      },
    ],
    channels: WORKBENCH_RATIO_CHANNELS,
    channelKicker: "投放到",
    packKind: "count",
    packs: [
      { id: "single", label: "结构复刻", count: 1 },
      { id: "duo", label: "结构 + 场景", count: 2 },
      { id: "set", label: "整套复刻", count: 4 },
    ],
    picks: [],
    note: true,
    emptyTitle: "还没有复刻结果",
    emptySteps: ["上传爆款参考图", "右侧放入需要替换的商品", "补充说明后生成"],
    historyLabel: "爆款复刻",
  },
  campaign: {
    id: "campaign",
    resultLabel: "营销图",
    slots: [PRODUCT_SLOT, STYLE_SLOT],
    channels: WORKBENCH_RATIO_CHANNELS,
    channelKicker: "投放到",
    packKind: "count",
    packs: [
      { id: "single", label: "活动主视觉", count: 1 },
      { id: "duo", label: "主图 + 利益点", count: 2 },
      { id: "set", label: "全套营销图", count: 4 },
    ],
    picks: [{ key: "campaign", label: "营销目标" }],
    note: true,
    emptyTitle: "还没有营销图",
    emptySteps: ["上传商品图", "选择营销目标与投放版位", "生成可直接投放的营销视觉"],
    historyLabel: "营销图",
  },
  background: {
    id: "background",
    resultLabel: "背景图",
    slots: [PRODUCT_SLOT, STYLE_SLOT],
    channels: WORKBENCH_RATIO_CHANNELS,
    channelKicker: "投放到",
    packKind: "count",
    packs: [
      { id: "single", label: "单张主场景", count: 1 },
      { id: "duo", label: "主图 + 场景", count: 2 },
      { id: "set", label: "全套版位", count: 4 },
    ],
    picks: [{ key: "scene", label: "背景类型" }],
    note: true,
    emptyTitle: "还没有背景图",
    emptySteps: ["上传商品图", "选择背景类型与比例", "商品不变，只重做背景"],
    historyLabel: "背景生成",
  },
  outpaint: {
    id: "outpaint",
    resultLabel: "扩图结果",
    slots: [
      {
        index: 0,
        tag: "原图",
        icon: "bi-arrows-angle-expand",
        emptyLabel: "拖入需要扩展的图",
        required: true,
        side: "left",
      },
      STYLE_SLOT,
    ],
    channels: OUTPAINT_CHANNELS,
    channelKicker: "扩展到",
    packKind: "variants",
    packs: [],
    picks: [],
    note: true,
    emptyTitle: "还没有扩图结果",
    emptySteps: ["上传原图", "选择目标画幅", "原图内容不变，边界自然延展"],
    historyLabel: "智能扩图",
  },
  enhance: {
    id: "enhance",
    resultLabel: "增强结果",
    slots: [
      {
        index: 0,
        tag: "原图",
        icon: "bi-badge-hd",
        emptyLabel: "拖入模糊的商品图",
        required: true,
        side: "left",
      },
    ],
    channels: null,
    channelKicker: "",
    packKind: "variants",
    packs: [],
    picks: [],
    note: true,
    emptyTitle: "还没有增强结果",
    emptySteps: ["上传原图", "点生成", "修复模糊、噪点与压缩痕迹，不改构图"],
    historyLabel: "清晰增强",
  },
  backdrop: {
    id: "backdrop",
    resultLabel: "背景复刻",
    slots: [
      { ...PRODUCT_SLOT, angles: false },
      {
        index: 1,
        tag: "背景参考",
        icon: "bi-layers",
        emptyLabel: "拖入想复刻的背景",
        required: true,
        side: "right",
      },
    ],
    channels: WORKBENCH_RATIO_CHANNELS,
    channelKicker: "投放到",
    packKind: "count",
    packs: [
      { id: "single", label: "背景复刻", count: 1 },
      { id: "duo", label: "双构图", count: 2 },
      { id: "set", label: "整套构图", count: 4 },
    ],
    picks: [],
    note: true,
    emptyTitle: "还没有复刻结果",
    emptySteps: ["上传商品图", "右侧放入背景参考", "迁移空间、光线与色彩"],
    historyLabel: "背景复刻",
  },
  shadow: {
    id: "shadow",
    resultLabel: "阴影结果",
    slots: [
      {
        index: 0,
        tag: "商品",
        icon: "bi-circle-half",
        emptyLabel: "拖入白底 / 透明商品图",
        required: true,
        side: "left",
      },
    ],
    channels: null,
    channelKicker: "",
    packKind: "variants",
    packs: [],
    picks: [{ key: "shadow", label: "阴影类型" }],
    note: true,
    emptyTitle: "还没有阴影结果",
    emptySteps: ["上传白底商品图", "选择阴影类型", "只补阴影，商品与背景不变"],
    historyLabel: "商品阴影",
  },
});

export const WORKBENCH_MODE_IDS = Object.freeze(Object.keys(WORKBENCH_SPECS));

export function isWorkbenchMode(id) {
  return Object.prototype.hasOwnProperty.call(WORKBENCH_SPECS, String(id || ""));
}

export function workbenchSpecById(id) {
  return WORKBENCH_SPECS[String(id || "")] || null;
}

export function workbenchHasStyleSlot(spec) {
  return Boolean(spec?.slots?.some((slot) => slot.key === "style"));
}

export function workbenchPackForCount(spec, count) {
  const packs = spec?.packs || [];
  const value = Math.max(1, Number(count) || 1);
  return (
    packs.find((item) => Number(item.count) === value) ||
    [...packs].reverse().find((item) => Number(item.count) <= value) ||
    packs[0] ||
    null
  );
}

export function workbenchPackForShootShots(spec, shotIds = []) {
  const packs = spec?.packs || [];
  const key = shotIds.join("|");
  return (
    packs.find((item) => (item.shotIds || []).join("|") === key) || null
  );
}
