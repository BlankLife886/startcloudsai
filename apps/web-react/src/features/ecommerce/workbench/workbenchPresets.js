// 通用工作台的“预置选项 / 细节补充 / 参考图 / 清晰度 / 出图数量”业务定义。
// 字段集对齐主流电商 AI 作图工具（seeany 等）各单点工具的预置选项：
// 每个字段既可从建议里选，也可以直接输入，全部可选；留空时不写进 prompt。

export const WORKBENCH_RESOLUTIONS = Object.freeze(["1K", "2K", "4K"]);

export const WORKBENCH_NOTE_MAX = 2000;

// 参考图（风格 / 构图参考）在参考序列里的角色说明，追加为最后一张
export const STYLE_REFERENCE_ROLE =
  "风格与构图参考（只借鉴色调、光线、构图与氛围；不得复制其中的商品、人物、文字或品牌）";

export const STYLE_REFERENCE_PROMPT =
  "最后一张参考图是风格与构图参考：只借鉴它的色调、光线方向、构图节奏与氛围；严禁把其中的商品、人物、文字、Logo 或品牌元素带入结果。";

const PRODUCT_TYPE_OPTIONS = [
  "3C 数码",
  "家居家纺",
  "美妆个护",
  "服饰鞋包",
  "食品饮料",
  "母婴用品",
  "运动户外",
  "宠物用品",
  "汽车用品",
  "办公文具",
];

const SCENE_TYPE_OPTIONS = [
  "家居生活",
  "办公桌面",
  "户外自然",
  "都市街景",
  "厨房餐桌",
  "卫浴空间",
  "影棚纯色",
  "节日氛围",
];

// 每个工作台模块的预置字段。bind 表示直接绑定到既有业务状态（scene / tone / campaign），
// 其余字段存放在 presetValues 里；prompt 前缀用于组装提示词。
export const WORKBENCH_PRESET_FIELDS = Object.freeze({
  shoot: [
    {
      key: "productType",
      label: "产品类型",
      placeholder: "请选择，或直接输入",
      options: PRODUCT_TYPE_OPTIONS,
    },
    {
      key: "scene",
      bind: "scene",
      label: "场景类型",
      placeholder: "请选择，或直接输入",
      options: SCENE_TYPE_OPTIONS,
    },
    {
      key: "display",
      label: "产品展示",
      placeholder: "请选择，或直接输入",
      options: [
        "单品主体",
        "多件组合",
        "使用中状态",
        "开箱陈列",
        "手持展示",
        "悬浮特写",
      ],
    },
    {
      key: "layout",
      label: "排版呈现",
      placeholder: "请选择，或直接输入",
      options: [
        "居中留白",
        "左图右文",
        "上图下文",
        "满版沉浸",
        "对角构图",
        "局部放大",
      ],
    },
    {
      key: "mood",
      label: "氛围营造",
      placeholder: "请选择，或直接输入",
      options: [
        "明亮清新",
        "温馨治愈",
        "高级质感",
        "科技冷感",
        "自然有机",
        "热闹促销",
      ],
    },
    {
      key: "value",
      label: "价值导向",
      placeholder: "请选择，或直接输入",
      options: ["品质感", "性价比", "便捷高效", "健康安全", "时尚潮流", "情感陪伴"],
    },
  ],
  listing: [],
  clone: [],
  campaign: [
    {
      key: "productType",
      label: "产品类型",
      placeholder: "请选择，或直接输入",
      options: PRODUCT_TYPE_OPTIONS,
    },
    {
      key: "background",
      label: "场景背景",
      placeholder: "请选择，或直接输入",
      options: [
        "纯色影棚",
        "家居场景",
        "节日促销氛围",
        "自然户外",
        "抽象几何",
        "渐变光效",
        "都市生活",
      ],
    },
    {
      key: "tone",
      bind: "tone",
      label: "视觉风格",
      placeholder: "请选择，或直接输入",
      options: ["极简高级", "清新明亮", "真实自然", "轻奢质感", "潮流活力", "科技未来"],
    },
    {
      key: "elements",
      label: "营销元素",
      placeholder: "请选择，或直接输入",
      options: [
        "促销标签",
        "价格 / 折扣角标",
        "限时倒计时",
        "赠品组合",
        "新品标识",
        "无营销元素（纯视觉）",
      ],
    },
  ],
  background: [
    {
      key: "scene",
      bind: "scene",
      label: "背景类型",
      placeholder: "请选择，或直接输入",
      options: [
        "纯色影棚",
        "家居生活",
        "自然户外",
        "都市街景",
        "科技空间",
        "节日氛围",
        "大理石台面",
        "木质桌面",
      ],
    },
    {
      key: "lighting",
      label: "风格与光影",
      placeholder: "请选择，或直接输入",
      options: [
        "柔和自然光",
        "影棚硬光",
        "逆光轮廓",
        "暖调黄昏",
        "冷调清晨",
        "高级灰调",
        "高对比戏剧光",
      ],
    },
  ],
  outpaint: [],
  enhance: [],
  backdrop: [],
  shadow: [],
});

export function workbenchPresetFields(modeId) {
  return WORKBENCH_PRESET_FIELDS[String(modeId || "")] || [];
}

// 把预置字段值整理成 prompt 行；bound 字段由调用方传入当前值
// skipBound：这些绑定字段（scene / tone / campaign）已由模块自身的 fields 写进 prompt，避免重复
export function presetPromptLines(modeId, values = {}, bound = {}, { skipBound } = {}) {
  return workbenchPresetFields(modeId)
    .map((field) => {
      if (field.bind && skipBound?.has?.(field.bind)) return "";
      const raw = field.bind ? bound[field.bind] : values[field.key];
      const value = String(raw || "").trim();
      return value ? `${field.label}：${value}。` : "";
    })
    .filter(Boolean);
}

// 预置字段是否有任何填写（用于工具栏摘要）
// 只统计用户主动填写的字段；绑定字段（scene / tone / campaign）始终有默认值，不计入
export function presetFilledCount(modeId, values = {}) {
  return workbenchPresetFields(modeId).filter((field) => {
    if (field.bind) return false;
    return String(values[field.key] || "").trim().length > 0;
  }).length;
}

// 多方案出图：同一 blueprint 重复 N 份，每份带方案序号，让模型做出差异化
export function expandVariantBlueprints(blueprints = [], count = 1) {
  const list = Array.isArray(blueprints) ? blueprints.filter(Boolean) : [];
  const total = Math.max(1, Math.min(4, Number(count) || 1));
  if (!list.length || total <= 1) return list;
  const base = list[0];
  return Array.from({ length: total }, (_, index) => ({
    ...base,
    id: `${base.id || "shot"}-v${index + 1}`,
    label: `方案 ${index + 1}`,
    direction: `${base.direction || ""} 这是第 ${index + 1}/${total} 个备选方案：在遵守同一职责与边界锁的前提下，让延展细节、光线或构图与其他方案有可感知的差异。`,
  }));
}
