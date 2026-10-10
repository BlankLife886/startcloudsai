// AI 商拍（创意商拍）可选镜头目录：工作台 packs / 出图结构与提示词方向都从这里取。

export const CREATIVE_SHOOT_SHOTS = [
  {
    id: "hero",
    label: "商品主视觉",
    enLabel: "Hero image",
    hint: "完整展示商品，建立第一印象",
    enHint: "Show the complete product clearly",
    direction:
      "景别：全景主视觉。完整商品全部入镜并保留安全边距，平视或略俯的 3/4 可信角度，商品占画面约 55%–70%；背景按整套基调保持简洁，主光塑形加自然接触阴影，商品是唯一视觉中心，适合作为首张主视觉。",
  },
  {
    id: "lifestyle",
    label: "使用场景",
    enLabel: "Lifestyle scene",
    hint: "说明使用方式、环境和人群",
    enHint: "Show context, environment and audience",
    direction:
      "景别：中景使用场景。按商品品类推断目标用户真实会使用它的地方（如桌面、厨房、浴室、户外、车内），把商品放进这个真实环境，商品占画面约 25%–40%；可出现手部或人物局部表达使用方式，但不遮挡商品关键识别部位。必须是真实生活环境，不要影棚纯色背景，也不要科幻或抽象空间。",
  },
  {
    id: "detail",
    label: "材质细节",
    enLabel: "Material detail",
    hint: "证明材质、工艺和品质",
    enHint: "Prove material, craft and quality",
    direction:
      "景别：微距特写。只拍参考图中确实可见的一处材质、纹理、接口或工艺细节，让这个局部占满画面 70% 以上，浅景深，背景完全虚化；不需要展示完整商品，只放大已有事实，不补造不可见结构。",
  },
  {
    id: "selling",
    label: "卖点表达",
    enLabel: "Selling point",
    hint: "围绕一个核心购买理由构图",
    enHint: "Build around one purchase reason",
    direction:
      "景别：广告构图。只围绕一个核心卖点（优先用用户填写的卖点，没有就从商品外观判断最突出的一点）设计画面，用道具、动势、光效或环境关系把这个好处“演”出来，构图与主视觉明显不同（如低机位仰拍、斜构图或留出大块留白）；不虚构参数、认证或效果，不加文字。",
  },
  {
    id: "scale",
    label: "尺寸比例",
    enLabel: "Scale reference",
    hint: "帮助用户理解真实大小",
    enHint: "Communicate real-world size",
    direction:
      "景别：尺寸参照。让商品与手部或常见日常物件（如手机、水杯、A4 纸）同框，用可信的比例关系说明真实大小；标准镜头、无夸张透视，不改变商品本体。",
  },
  {
    id: "packaging",
    label: "包装与配件",
    enLabel: "Packaging set",
    hint: "展示包装、配件和完整清单",
    enHint: "Show packaging and included items",
    direction:
      "景别：俯拍平铺或陈列。展示参考图中真实可见的包装、配件与商品组合，排列整齐、间距均匀；只呈现明确提供的物品、数量和文字，不补造赠品或包装信息。",
  },
];

export function creativeShootShotById(id) {
  return CREATIVE_SHOOT_SHOTS.find((shot) => shot.id === id) || null;
}
