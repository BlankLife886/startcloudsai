// AI 商拍（创意商拍）可选镜头目录：工作台 packs / 出图结构与提示词方向都从这里取。

export const CREATIVE_SHOOT_SHOTS = [
  {
    id: "hero",
    label: "商品主视觉",
    enLabel: "Hero image",
    hint: "完整展示商品，建立第一印象",
    enHint: "Show the complete product clearly",
    direction:
      "完整商品全部入镜并保留安全边距，使用信息最完整的可信角度，商品是唯一明确视觉中心，适合作为首张主视觉。",
  },
  {
    id: "lifestyle",
    label: "使用场景",
    enLabel: "Lifestyle scene",
    hint: "说明使用方式、环境和人群",
    enHint: "Show context, environment and audience",
    direction:
      "把商品自然置入目标用户真实使用环境，清楚表达使用方式、尺度和场景价值，保持商品身份与主视觉一致。",
  },
  {
    id: "detail",
    label: "材质细节",
    enLabel: "Material detail",
    hint: "证明材质、工艺和品质",
    enHint: "Prove material, craft and quality",
    direction:
      "聚焦参考图中确实可见的材质、纹理、接口或工艺细节，只放大已有事实，不补造不可见结构。",
  },
  {
    id: "selling",
    label: "卖点表达",
    enLabel: "Selling point",
    hint: "围绕一个核心购买理由构图",
    enHint: "Build around one purchase reason",
    direction:
      "围绕用户填写的一个核心卖点组织商业构图，通过场景和视觉关系表达价值，不虚构参数、认证或效果。",
  },
  {
    id: "scale",
    label: "尺寸比例",
    enLabel: "Scale reference",
    hint: "帮助用户理解真实大小",
    enHint: "Communicate real-world size",
    direction:
      "通过可信参照物或使用关系说明商品真实尺寸和比例，不改变商品本体，不使用会误导尺度的夸张透视。",
  },
  {
    id: "packaging",
    label: "包装与配件",
    enLabel: "Packaging set",
    hint: "展示包装、配件和完整清单",
    enHint: "Show packaging and included items",
    direction:
      "根据参考图展示真实包装、配件和商品组合，只呈现明确提供的物品、数量和文字，不补造赠品或包装信息。",
  },
];

export function creativeShootShotById(id) {
  return CREATIVE_SHOOT_SHOTS.find((shot) => shot.id === id) || null;
}
