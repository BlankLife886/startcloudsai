// 商品套图目录：出图类型（主图 / 详情页 / 信任背书 / 营销素材）、投放选项、
// 画幅与品类套图模板库。对齐主流电商 AI 套图工具的完整能力，内容由我们自行编写。
//
// role 决定一张图用主图画幅还是详情页画幅，并告诉策划模型这张图的职责：
//   main   = 搜索列表 / 首屏曝光，提升点击
//   detail = 详情页转化与说服

export const LISTING_MAX_SHOTS = 18;
export const LISTING_MAX_PER_TYPE = 4;
export const LISTING_MAX_CUSTOM_TYPES = 8;
export const LISTING_PRODUCT_INFO_MAX = 1000;
export const LISTING_NOTE_MAX = 2000;
export const LISTING_SMART_MAX_MAIN = 6;
export const LISTING_SMART_MAX_DETAIL = 15;

export const LISTING_TYPE_GROUPS = Object.freeze([
  { id: "main", label: "商品主图", hint: "提升曝光与点击", visibleLimit: 6 },
  {
    id: "detail",
    label: "核心转化详情页",
    hint: "深度转化与说服",
    visibleLimit: 12,
  },
  { id: "trust", label: "信任背书详情页", hint: "打消顾虑", visibleLimit: 8 },
  { id: "marketing", label: "营销素材", hint: "投放与种草", visibleLimit: 4 },
]);

const NO_FABRICATION =
  "只呈现商品图和用户资料里可以确认的信息，不得虚构参数、认证、销量、价格或日期。";

export const LISTING_IMAGE_TYPES = Object.freeze([
  // ---------- 商品主图 ----------
  {
    id: "white",
    group: "main",
    role: "main",
    label: "产品白底图",
    hint: "纯白背景，突出商品本体",
    icon: "bi-square",
    direction:
      "使用纯白或平台合规的干净背景，商品完整入镜、正面主视角、占画面约 85%，不添加装饰、人物、道具和无关文字。",
  },
  {
    id: "amazon",
    group: "main",
    role: "main",
    label: "亚马逊主图",
    hint: "纯白底 · 85% 占比",
    icon: "bi-amazon",
    direction:
      "严格遵守亚马逊主图规范：纯白背景 RGB(255,255,255)，商品占画面 85% 以上，无文字、无 Logo 水印、无道具、无边框、无多角度拼图。",
  },
  {
    id: "closeup",
    group: "main",
    role: "main",
    label: "细节特写",
    hint: "放大质感与做工",
    icon: "bi-zoom-in",
    direction:
      "以微距视角放大商品最能体现品质的一处材质或工艺细节，主体清晰锐利、背景干净虚化，作为主图组里的质感展示。只放大已有细节，不补造结构。",
  },
  {
    id: "angles",
    group: "main",
    role: "main",
    label: "产品多角度",
    hint: "多视角看清外观结构",
    icon: "bi-grid-3x3-gap",
    direction:
      "在同一画面内以 2-4 个整齐排列的视角（正面、侧面、背面或顶部）展示商品外观结构，背景统一干净，各视角比例一致；只使用参考图中能确认的角度。",
  },
  {
    id: "promo-hero",
    group: "main",
    role: "main",
    label: "营销主图海报",
    hint: "强视觉 · 突出核心利益",
    icon: "bi-badge-ad",
    direction:
      "以强视觉冲击的海报式构图突出商品与一句核心利益点，商品占主导，标题区醒目但不遮挡商品；不虚构价格和折扣。",
  },
  {
    id: "sale-hero",
    group: "main",
    role: "main",
    label: "大促营销主图",
    hint: "利益点 · 限时氛围",
    icon: "bi-lightning",
    direction:
      "营造大促节点的热烈氛围（色块、光效、角标区），商品仍是视觉中心，为价格与利益点预留清晰信息区；用户未提供时只写通用表述，不得编造折扣、价格或日期。",
  },
  {
    id: "perk-hero",
    group: "main",
    role: "main",
    label: "平台权益主图",
    hint: "包邮 / 保障等权益角标",
    icon: "bi-shield-plus",
    direction:
      "在干净主图基础上以角标或边栏呈现平台服务权益（如包邮、正品保障、极速发货），角标克制不喧宾夺主；只写用户明确提供的权益。",
  },
  {
    id: "scene-hero",
    group: "main",
    role: "main",
    label: "场景主图",
    hint: "场景代入 · 一眼看懂用途",
    icon: "bi-house",
    direction:
      "把商品放入最典型的使用场景作为主图，商品清晰突出、占画面 60% 以上，场景简洁可信，让买家一眼看懂用途。",
  },
  {
    id: "selling-hero",
    group: "main",
    role: "main",
    label: "卖点主图",
    hint: "放大优势 · 凸显差异",
    icon: "bi-stars",
    direction:
      "主图中用简短标题加 1-3 个图标化卖点突出商品差异优势，排版干净、层级清晰，商品占主导；" +
      NO_FABRICATION,
  },
  {
    id: "model-hero",
    group: "main",
    role: "main",
    label: "模特试穿主图",
    hint: "真人穿搭 · 比例参考",
    icon: "bi-person-standing-dress",
    direction:
      "由与目标市场匹配的真人模特穿着商品作为主图，全身或半身构图，清楚呈现版型与上身比例；保持商品款式、颜色、材质不变，模特不得指向真实名人。",
  },
  {
    id: "handheld-hero",
    group: "main",
    role: "main",
    label: "手持展示主图",
    hint: "手持呈现 · 直观感知大小",
    icon: "bi-hand-index-thumb",
    direction:
      "由自然的手部握持或托举商品，直观呈现商品尺寸与使用方式，手部姿态真实、比例可信，商品正面清晰；背景干净简洁。",
  },
  {
    id: "wear-hero",
    group: "main",
    role: "main",
    label: "配饰佩戴主图",
    hint: "真人佩戴 · 效果直观",
    icon: "bi-gem",
    direction:
      "由真人模特佩戴商品作为主图，近景突出佩戴部位与商品细节，尺度关系真实；保持商品款式与材质不变，模特不得指向真实名人。",
  },

  // ---------- 核心转化详情页 ----------
  {
    id: "hero",
    group: "detail",
    role: "detail",
    label: "首屏视觉图",
    hint: "首屏吸睛，提升转化",
    icon: "bi-image",
    direction:
      "商品占据明确视觉中心，构图干净有呼吸感，预留克制的标题安全区，用一句核心价值主张建立第一印象。",
  },
  {
    id: "endorsement",
    group: "detail",
    role: "detail",
    label: "产品代言互动",
    hint: "人物代言 + 互动引导",
    icon: "bi-person-heart",
    direction:
      "由与目标市场匹配的真人模特自然使用或展示商品，人物只是配角，商品仍是唯一焦点；不得出现可识别的名人或受保护形象。",
  },
  {
    id: "painpoint",
    group: "detail",
    role: "detail",
    label: "客户痛点展示",
    hint: "指出痛点并给出解决",
    icon: "bi-lightning-charge",
    direction:
      "先呈现目标用户遇到的一个真实痛点，再展示商品如何解决，情绪表达克制可信；不夸大效果，不贬低具体竞品。",
  },
  {
    id: "selling",
    group: "detail",
    role: "detail",
    label: "核心卖点图",
    hint: "一句话卖点 + 图形强化",
    icon: "bi-stars",
    direction:
      "围绕一个最重要卖点组织视觉，用标注、局部放大或图标辅助说明；只呈现可由商品图或用户描述确认的信息，不虚构参数。",
  },
  {
    id: "scene",
    group: "detail",
    role: "detail",
    label: "产品场景展示图",
    hint: "真实使用场景带入感",
    icon: "bi-house-heart",
    direction:
      "把商品自然放入目标用户的真实使用环境，比例、接触关系、光线和阴影可信，场景服务于商品而不抢戏。",
  },
  {
    id: "wear",
    group: "detail",
    role: "detail",
    label: "试穿试戴场景",
    hint: "上身 / 上手效果",
    icon: "bi-person-standing",
    direction:
      "由真人模特按正确方式穿着或佩戴商品，展示上身效果与尺度关系；保持商品款式、颜色、材质不变，模特身份不得指向真实名人。",
  },
  {
    id: "craft",
    group: "detail",
    role: "detail",
    label: "细节工艺图",
    hint: "局部细节分点说明",
    icon: "bi-search",
    direction:
      "聚焦 1-3 处真实材质、接缝、接口或工艺细节做特写并分点标注，纹理、Logo 和包装文字准确；只放大已有细节，不补造结构。",
  },
  {
    id: "compare",
    group: "detail",
    role: "detail",
    label: "使用对比图",
    hint: "前后 / 方案对比更直观",
    icon: "bi-layout-split",
    direction:
      "以左右或上下分屏呈现有真实依据的使用前后或方案差异，对比维度明确；不伪造实验数据、检测结果和效果，不点名贬低竞品。",
  },
  {
    id: "package",
    group: "detail",
    role: "detail",
    label: "包装展示图",
    hint: "包装与配件清单",
    icon: "bi-box2-heart",
    direction:
      "展示参考图中可以确认的商品、外包装和随附配件，陈列整齐；无法从参考图确认的物品不得补造。",
  },
  {
    id: "shipping",
    group: "detail",
    role: "detail",
    label: "运输安装",
    hint: "包装运输与安装步骤",
    icon: "bi-truck",
    direction:
      "用步骤式版式说明用户提供的安装、组装或收货流程，图示简洁清晰；不承诺未提供的物流时效或服务。",
  },
  {
    id: "design",
    group: "detail",
    role: "detail",
    label: "产品设计图",
    hint: "结构示意，讲清设计亮点",
    icon: "bi-vector-pen",
    direction:
      "以爆炸图、线稿叠加或分层视角展示商品的设计语言与结构关系，只展示参考图中可见的部件，不虚构内部构造。",
  },
  {
    id: "spec",
    group: "detail",
    role: "detail",
    label: "规格参数图",
    hint: "尺寸参数一图看懂",
    icon: "bi-rulers",
    direction:
      "清晰呈现用户已经提供的尺寸、容量、重量或规格信息，用标注线与信息区排版；没有可靠参数时保留信息区，不得虚构数值。",
  },
  {
    id: "interact",
    group: "detail",
    role: "detail",
    label: "真人场景互动图",
    hint: "真人互动 · 用户定位",
    icon: "bi-people",
    direction:
      "由符合目标人群画像的真人在生活场景中与商品自然互动，体现「谁在用、在哪用」，表情与动作真实不做作；商品清晰可辨。",
  },
  {
    id: "usage",
    group: "detail",
    role: "detail",
    label: "真实使用状态图",
    hint: "真实使用 · 沉浸代入",
    icon: "bi-camera-reels",
    direction:
      "呈现商品正在被使用的真实状态（开启、装载、穿戴或运行中），第一人称或近景视角增强代入感，细节真实可信。",
  },
  {
    id: "multiscene",
    group: "detail",
    role: "detail",
    label: "多场景展示图",
    hint: "多面覆盖 · 拓宽想象",
    icon: "bi-grid-1x2",
    direction:
      "以 2-4 宫格拼图展示商品在不同场景中的用法，各格场景差异明显、光线色调统一，同一商品在每格中的外观保持一致。",
  },
  {
    id: "outfit-single",
    group: "detail",
    role: "detail",
    label: "服装单场景试穿图",
    hint: "单场景 · 上身效果",
    icon: "bi-person-standing-dress",
    direction:
      "模特在一个与商品风格匹配的场景中完整展示服装上身效果，姿态自然，版型、垂感与细节清晰；保持服装款式、颜色、面料不变。",
  },
  {
    id: "outfit-multi",
    group: "detail",
    role: "detail",
    label: "服装多场景试穿图",
    hint: "多场景组合 · 多面参考",
    icon: "bi-collection",
    direction:
      "以 2-3 个场景的组合画面展示同一件服装的不同穿搭场合（通勤、休闲、出游等），同一模特、同一服装，场景之间风格统一。",
  },
  {
    id: "accessory-single",
    group: "detail",
    role: "detail",
    label: "服饰穿戴图",
    hint: "单场景 · 细节呈现",
    icon: "bi-handbag",
    direction:
      "模特在单一场景中穿戴或携带商品（鞋、包、帽、配饰），近中景同时交代搭配效果与商品细节，尺度真实。",
  },
  {
    id: "accessory-multi",
    group: "detail",
    role: "detail",
    label: "服饰佩戴多场景",
    hint: "多角度组合 · 全面展示",
    icon: "bi-images",
    direction:
      "以多格组合展示商品在不同角度、不同搭配下的佩戴效果，同一商品外观在各格保持一致。",
  },
  {
    id: "material",
    group: "detail",
    role: "detail",
    label: "成分材质解析图",
    hint: "拆解原料 · 品质认知",
    icon: "bi-droplet-half",
    direction:
      "以原料、面料或材质的微距与分层示意解析商品构成，信息分区清晰；成分与比例只写用户提供的内容，不得虚构功效。",
  },
  {
    id: "principle",
    group: "detail",
    role: "detail",
    label: "功能原理解析图",
    hint: "透视解构 · 讲清原理",
    icon: "bi-gear-wide-connected",
    direction:
      "用剖面、透视或示意箭头讲清商品的工作原理与功能结构，风格专业简洁；只示意可确认的结构，不虚构内部部件与技术指标。",
  },
  {
    id: "demo",
    group: "detail",
    role: "detail",
    label: "真人使用示范图",
    hint: "真人演示 · 可信参考",
    icon: "bi-person-video2",
    direction:
      "由真人按正确方式演示商品的关键用法，动作清晰、手部与商品接触关系真实，画面有明确的动作焦点。",
  },
  {
    id: "steps",
    group: "detail",
    role: "detail",
    label: "操作步骤演示图",
    hint: "步骤指引 · 轻松上手",
    icon: "bi-list-ol",
    direction:
      "以 3-4 步的分格或流程版式演示商品的使用步骤，每步配简短说明与序号，动作连贯；步骤只基于用户提供或常识可确认的用法。",
  },
  {
    id: "gift",
    group: "detail",
    role: "detail",
    label: "赠品礼遇清单图",
    hint: "赠品清单 · 超值感",
    icon: "bi-gift",
    direction:
      "以整齐陈列的清单式构图展示用户明确提供的赠品与随附礼遇，主商品居中突出；未提供赠品信息时保留清单区，不得补造赠品。",
  },
  {
    id: "faq",
    group: "detail",
    role: "detail",
    label: "高频问题 FAQ 图",
    hint: "集中答疑 · 降低咨询",
    icon: "bi-question-circle",
    direction:
      "以问答卡片版式整理 3-4 个买家最关心的问题与简短解答，配商品小图；答案只基于用户资料，不确定的内容不写。",
  },

  // ---------- 信任背书详情页 ----------
  {
    id: "review",
    group: "trust",
    role: "detail",
    label: "真实好评口碑图",
    hint: "晒单口碑佐证",
    icon: "bi-chat-square-quote",
    direction:
      "以评价卡片、星级与引用排版组织用户明确提供的口碑内容；没有提供时保留评价区版式并使用占位文字，不得编造评价、销量或用户身份。",
  },
  {
    id: "cert",
    group: "trust",
    role: "detail",
    label: "权威资质认证图",
    hint: "资质报告 · 品质背书",
    icon: "bi-patch-check",
    direction:
      "仅展示用户明确提供的认证、专利或检测信息，用徽章式版式呈现；不得虚构任何认证标志、机构名称或证书编号。",
  },
  {
    id: "inspection",
    group: "trust",
    role: "detail",
    label: "质检检测报告图",
    hint: "专业检测 · 品质佐证",
    icon: "bi-clipboard2-check",
    direction:
      "以检测报告、质检流程或实验室场景呈现品质把控，数据只写用户提供的内容；没有报告时展示质检环节示意，不得伪造报告编号与检测结论。",
  },
  {
    id: "factory",
    group: "trust",
    role: "detail",
    label: "工厂实力实拍图",
    hint: "源头工厂 · 实力见证",
    icon: "bi-building-gear",
    direction:
      "以整洁专业的生产车间、仓储或流水线场景体现供应实力，商品在画面中可辨；不出现可识别的真实企业标识，不虚构产能与规模数据。",
  },
  {
    id: "process",
    group: "trust",
    role: "detail",
    label: "生产工艺流程图",
    hint: "流程透明 · 标准可控",
    icon: "bi-diagram-3",
    direction:
      "以横向或环形流程版式展示 3-5 个关键生产工序，每步配示意图与简短说明；工序只基于常识或用户资料，不虚构专利工艺。",
  },
  {
    id: "service",
    group: "trust",
    role: "detail",
    label: "售后保障服务图",
    hint: "质保退换 · 安心购",
    icon: "bi-shield-check",
    direction:
      "以图标化卡片呈现用户提供的售后承诺（质保、退换、客服响应等），版式简洁可信；未提供的服务条款不得承诺。",
  },
  {
    id: "logistics",
    group: "trust",
    role: "detail",
    label: "物流发货说明图",
    hint: "时效透明 · 发货无忧",
    icon: "bi-box-seam",
    direction:
      "以流程或地图示意说明下单、打包、发货与签收环节，突出包装防护；时效与承运信息只写用户提供的内容。",
  },

  // ---------- 营销素材 ----------
  {
    id: "ugc",
    group: "marketing",
    role: "detail",
    label: "通用买家秀",
    hint: "真实感买家秀氛围",
    icon: "bi-camera",
    direction:
      "模拟真实买家手机随拍的生活化质感：自然光、略随意的构图、真实环境细节，商品身份仍必须准确，不做过度修饰。",
  },
  {
    id: "poster",
    group: "marketing",
    role: "main",
    label: "活动海报",
    hint: "促销信息，用于投放",
    icon: "bi-megaphone",
    direction:
      "围绕活动主题建立视觉层级，保留标题与利益点安全区；不虚构折扣、价格和日期，营销氛围服从商品主体。",
  },
]);

const TYPE_BY_ID = new Map(LISTING_IMAGE_TYPES.map((item) => [item.id, item]));

export function listingTypeById(id) {
  return TYPE_BY_ID.get(String(id || "")) || null;
}

// 自由组合的默认选择：2 张主图 + 5 张详情页，覆盖首图、卖点、场景、细节与参数
export const LISTING_DEFAULT_FREE_ITEMS = Object.freeze([
  { id: "white", count: 1 },
  { id: "scene-hero", count: 1 },
  { id: "hero", count: 1 },
  { id: "selling", count: 1 },
  { id: "scene", count: 1 },
  { id: "craft", count: 1 },
  { id: "spec", count: 1 },
]);

// 兼容旧调用：默认勾选的出图类型 id
export const LISTING_DEFAULT_TYPE_IDS = Object.freeze(
  LISTING_DEFAULT_FREE_ITEMS.map((item) => item.id),
);

// ---------- 产品信息与市场 ----------

export const LISTING_PLATFORM_OPTIONS = Object.freeze([
  "大陆电商",
  "亚马逊",
  "TikTok",
  "Temu",
  "淘宝",
  "天猫",
  "京东",
  "拼多多",
  "唯品会",
  "得物",
  "1688",
  "抖音电商",
  "快手电商",
  "小红书",
  "美团",
  "全球速卖通",
  "阿里巴巴国际站",
  "Shopee",
  "Lazada",
  "美客多",
  "Shein",
  "Etsy",
  "乐天",
  "Coupang",
  "Ozon",
  "Jumia",
  "Souq",
  "Noon",
  "Shopify",
  "独立站",
]);

export const LISTING_MARKET_OPTIONS = Object.freeze([
  "中国大陆",
  "北美",
  "韩国",
  "日本",
  "俄罗斯",
  "中东阿拉伯",
  "港澳",
  "中国台湾",
  "土耳其",
  "南美",
  "澳洲",
  "东南亚",
  "印度",
  "非洲",
  "英国",
  "德国",
  "法国",
  "欧洲",
  "东欧",
]);

export const LISTING_LANGUAGE_OPTIONS = Object.freeze([
  "简体中文",
  "英语",
  "无需文案",
  "繁体中文",
  "中英文混合",
  "俄语",
  "西班牙语",
  "法语",
  "德语",
  "意大利语",
  "葡萄牙语",
  "阿拉伯语",
  "日语",
  "韩语",
  "印尼语",
  "越南语",
  "泰语",
  "荷兰语",
  "马来语",
  "印地语",
  "土耳其语",
]);

export const LISTING_STYLE_OPTIONS = Object.freeze([
  {
    label: "简约清新风",
    prompt: "简约清新：浅色干净背景、柔和自然光、低饱和配色，留白充足。",
  },
  {
    label: "高级质感风",
    prompt:
      "高级质感：克制的深浅对比、精准布光突出材质与边缘高光，版式精致有品牌感。",
  },
  {
    label: "活泼吸睛风",
    prompt:
      "活泼吸睛：明快高饱和配色、活力构图与图形元素，但商品仍是视觉中心。",
  },
  {
    label: "复古怀旧风",
    prompt: "复古怀旧：暖调胶片质感、复古道具与字体氛围，保持商品真实颜色。",
  },
  {
    label: "场景写实风",
    prompt: "场景写实：真实生活场景与自然光影，像实拍而非渲染。",
  },
  {
    label: "科技未来风",
    prompt:
      "科技未来：冷色调光效、几何线条与干净的科技感空间，避免夸张科幻元素。",
  },
  {
    label: "国风古韵风",
    prompt: "国风古韵：东方美学配色、留白与传统纹样元素点缀，气质雅致。",
  },
]);

export function listingStylePrompt(style) {
  const value = String(style || "").trim();
  if (!value) return "";
  const preset = LISTING_STYLE_OPTIONS.find((item) => item.label === value);
  return preset ? preset.prompt : `${value}。`;
}

export const LISTING_PRODUCT_INFO_PLACEHOLDER = [
  "建议包含以下信息，生成更精准：",
  "1. 产品名称",
  "2. 核心卖点",
  "3. 适用人群",
  "4. 期望场景",
  "5. 具体参数（尺寸、容量、材质等）",
].join("\n");

// ---------- 画幅 ----------

export const LISTING_RATIO_OPTIONS = Object.freeze([
  { value: "1:1", label: "方图 1:1" },
  { value: "3:4", label: "竖图 3:4" },
  { value: "4:5", label: "竖图 4:5" },
  { value: "2:3", label: "竖图 2:3" },
  { value: "9:16", label: "竖图 9:16" },
  { value: "16:9", label: "横图 16:9" },
  { value: "4:3", label: "横图 4:3" },
  { value: "5:4", label: "横图 5:4" },
  { value: "3:2", label: "横图 3:2" },
  { value: "21:9", label: "横图 21:9" },
]);

export const LISTING_DEFAULT_MAIN_RATIO = "1:1";
export const LISTING_DEFAULT_DETAIL_RATIO = "3:4";

// ---------- 出图规划方向 / 出图方式 ----------

export const LISTING_PLAN_MODES = Object.freeze([
  {
    id: "smart",
    label: "智能组图",
    icon: "bi-magic",
    hint: "设定张数，AI 自动挑选类型",
  },
  {
    id: "free",
    label: "自由组合",
    icon: "bi-grid-3x3-gap",
    hint: "自选出图类型与张数",
  },
  {
    id: "template",
    label: "品类模板",
    icon: "bi-collection",
    hint: "套用行业高转化分镜",
  },
]);

export const LISTING_RUN_MODES = Object.freeze([
  {
    id: "auto",
    label: "智能直出",
    icon: "bi-rocket-takeoff",
    hint: "基于出图类型策划每张文案与构图，并直接生成",
  },
  {
    id: "confirm",
    label: "逐步确认",
    icon: "bi-list-check",
    hint: "AI 先策划，在【策划方案】里确认或修改后再出图",
  },
  {
    id: "fast",
    label: "极速出图",
    icon: "bi-lightning-charge",
    hint: "跳过策划，使用出图类型的预置方向直接出图",
    // 智能组图需要 AI 选类型、品类模板的分镜需要文案，二者都必须先策划
    planModes: ["free"],
  },
]);

export function listingRunModeAllowed(runMode, planMode) {
  const option = LISTING_RUN_MODES.find((item) => item.id === runMode);
  return (
    Boolean(option) &&
    (!option.planModes || option.planModes.includes(planMode))
  );
}

// ---------- 品类套图模板库 ----------
// 一级品类 → 二级品类；每个二级品类按品类族（family）套用一组分镜原型生成模板。

export const LISTING_TEMPLATE_CATEGORIES = Object.freeze([
  {
    id: "women",
    label: "女装",
    family: "apparel",
    subs: [
      "连衣裙",
      "T恤",
      "衬衫",
      "牛仔裤",
      "休闲裤",
      "阔腿裤",
      "外套",
      "大衣",
      "风衣",
      "羽绒服",
      "半身裙",
      "卫衣",
      "针织衫",
      "针织开衫",
      "吊带背心",
      "连体裤",
      "马甲",
      "汉服",
      "旗袍",
      "小礼服",
    ],
  },
  {
    id: "men",
    label: "男装",
    family: "apparel",
    subs: [
      "男士T恤",
      "POLO衫",
      "商务衬衫",
      "休闲衬衫",
      "西服套装",
      "夹克外套",
      "冲锋衣",
      "风衣大衣",
      "羽绒服",
      "卫衣卫裤",
      "针织毛衣",
      "牛仔裤",
      "休闲长裤",
      "运动卫裤",
      "休闲短裤",
    ],
  },
  {
    id: "underwear",
    label: "内衣家居服",
    family: "apparel",
    subs: [
      "文胸",
      "内裤",
      "家居服套装",
      "睡衣睡裙",
      "晨袍",
      "保暖内衣",
      "打底裤",
      "丝袜",
      "塑身衣",
      "袜子",
    ],
  },
  {
    id: "shoes",
    label: "鞋靴",
    family: "shoes",
    subs: [
      "运动鞋",
      "休闲板鞋",
      "高跟鞋",
      "平底鞋",
      "马丁靴",
      "长筒靴",
      "雪地棉鞋",
      "凉鞋",
      "拖鞋",
    ],
  },
  {
    id: "bags",
    label: "箱包皮具",
    family: "bags",
    subs: [
      "托特包",
      "单肩斜挎包",
      "手提包",
      "双肩背包",
      "公文包",
      "胸包腰包",
      "钱包卡包",
      "行李箱",
      "化妆包",
    ],
  },
  {
    id: "jewelry",
    label: "珠宝配饰",
    family: "jewelry",
    subs: [
      "项链吊坠",
      "戒指",
      "耳饰",
      "手链手镯",
      "眼镜墨镜",
      "帽子头饰",
      "腰带皮带",
      "丝巾围巾",
      "胸针发饰",
    ],
  },
  {
    id: "phone",
    label: "手机数码",
    family: "digital",
    subs: [
      "智能手机",
      "平板电脑",
      "蓝牙耳机",
      "智能手表",
      "手机保护壳",
      "手机保护膜",
      "移动电源",
      "充电器线材",
      "手机支架",
    ],
  },
  {
    id: "computer",
    label: "电脑办公",
    family: "digital",
    subs: [
      "笔记本电脑",
      "台式机",
      "显示器",
      "键盘",
      "鼠标",
      "投影仪",
      "移动存储",
      "打印机",
      "拓展坞",
      "电脑支架",
    ],
  },
  {
    id: "small-appliance",
    label: "生活电器",
    family: "appliance",
    subs: [
      "空气炸锅",
      "电饭煲",
      "破壁料理机",
      "咖啡机",
      "养生水壶",
      "洗地机",
      "扫地机器人",
      "空气净化器",
      "除湿机",
      "挂烫机",
    ],
  },
  {
    id: "large-appliance",
    label: "大家电",
    family: "appliance",
    subs: [
      "冰箱",
      "洗衣机",
      "空调",
      "平板电视",
      "吸油烟机",
      "洗碗机",
      "热水器",
      "回音壁音响",
    ],
  },
  {
    id: "furniture",
    label: "家具软装",
    family: "home",
    subs: [
      "沙发",
      "茶几边几",
      "餐桌餐椅",
      "床架",
      "床垫",
      "衣柜",
      "办公桌椅",
      "电视柜",
      "窗帘布艺",
      "地毯",
    ],
  },
  {
    id: "hardware",
    label: "建材五金",
    family: "home",
    subs: [
      "智能马桶",
      "浴室柜",
      "花洒",
      "智能门锁",
      "灯具照明",
      "五金工具",
      "电动晾衣架",
      "水槽龙头",
    ],
  },
  {
    id: "daily",
    label: "日用百货",
    family: "daily",
    subs: [
      "床上四件套",
      "收纳箱盒",
      "锅具",
      "水杯水壶",
      "餐具套装",
      "清洁用具",
      "雨伞",
      "香薰",
    ],
  },
  {
    id: "beauty",
    label: "美妆个护",
    family: "beauty",
    subs: [
      "面部护理",
      "面膜",
      "底妆遮瑕",
      "彩妆",
      "洗护发",
      "身体洗护",
      "美发电器",
      "美容仪",
    ],
  },
  {
    id: "food",
    label: "食饮生鲜",
    family: "food",
    subs: [
      "休闲零食",
      "方便速食",
      "茶叶冲饮",
      "乳品饮料",
      "酒水",
      "粮油调味",
      "新鲜水果",
      "生鲜肉禽",
    ],
  },
  {
    id: "baby",
    label: "母婴玩具",
    family: "baby",
    subs: [
      "婴幼童装",
      "奶粉辅食",
      "纸尿裤",
      "喂养用品",
      "孕产用品",
      "婴儿推车",
      "安全座椅",
      "益智玩具",
    ],
  },
  {
    id: "sports",
    label: "运动户外",
    family: "sports",
    subs: [
      "运动服饰",
      "瑜伽服",
      "健身器材",
      "瑜伽用品",
      "露营装备",
      "骑行装备",
      "垂钓渔具",
      "游泳装备",
      "球拍",
      "球类装备",
      "轮滑滑板",
      "拳击护具",
    ],
  },
  {
    id: "stationery",
    label: "文具图书",
    family: "daily",
    subs: [
      "书写工具",
      "本册纸品",
      "学生文具",
      "办公文具",
      "美术画材",
      "绘本",
      "图书",
      "文创周边",
    ],
  },
  {
    id: "health",
    label: "医疗保健",
    family: "health",
    subs: [
      "家用检测",
      "康复护具",
      "理疗养生",
      "日常防护",
      "膳食补充",
      "传统滋补",
    ],
  },
  {
    id: "pet",
    label: "宠物用品",
    family: "pet",
    subs: [
      "主粮",
      "宠物零食",
      "猫砂用品",
      "宠物玩具",
      "窝垫",
      "牵引服饰",
      "洗护美容",
      "智能养宠",
    ],
  },
  {
    id: "auto",
    label: "汽车用品",
    family: "daily",
    subs: [
      "行车记录仪",
      "车载电器",
      "汽车脚垫",
      "座套",
      "车载香薰",
      "车载收纳",
      "洗车用品",
      "应急装备",
      "车膜",
    ],
  },
  {
    id: "festival",
    label: "节日庆典",
    family: "festival",
    subs: [
      "圣诞用品",
      "万圣装扮",
      "新年年货",
      "生日派对",
      "婚庆用品",
      "节日彩灯",
      "礼品包装",
      "派对道具",
    ],
  },
]);

// 分镜：[画面描述, 出图类型 id]；{sub} 替换为二级品类名
const shot = (label, type) => ({ label, type });

// 各品类族通用的分镜原型：标准 / 跨境合规 / 大促引流 / 高端质感，再加 1-2 个品类特色原型
const FAMILY_ARCHETYPES = {
  apparel: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖完整购买决策链路",
      shots: [
        shot("正面全身白底展示图", "white"),
        shot("背面全身白底展示图", "angles"),
        shot("核心版型主视觉首图", "hero"),
        shot("核心卖点解析图", "selling"),
        shot("领口 + 走线 + 面料细节特写", "craft"),
        shot("日常场景上身效果图", "outfit-single"),
        shot("全身站姿版型展示图", "wear"),
        shot("面料成分与特性说明图", "material"),
        shot("尺码参数标注图", "spec"),
        shot("售后保障服务说明图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "亚马逊等跨境平台合规款，英文卖点与双单位尺码",
      shots: [
        shot("纯白背景正面主图", "amazon"),
        shot("背面与侧面白底展示图", "angles"),
        shot("图标化核心卖点图", "selling-hero"),
        shot("面料走线细节特写图", "craft"),
        shot("欧美模特全身版型图", "wear"),
        shot("多生活场景组合图", "outfit-multi"),
        shot("面料成分说明图", "material"),
        shot("双单位尺码参数图", "spec"),
        shot("洗涤保养步骤说明图", "steps"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，适配价格敏感人群",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("爆款版型主视觉首图", "hero"),
        shot("正面全身白底展示图", "white"),
        shot("核心价值卖点解析图", "selling"),
        shot("多风格试穿组合图", "outfit-multi"),
        shot("上身前后效果对比图", "compare"),
        shot("赠品礼遇清单图", "gift"),
        shot("尺码参数标注图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "高端品质定位，适配中高消费人群",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("高端场景人物互动图", "interact"),
        shot("设计剪裁卖点解析图", "selling"),
        shot("面料微距 + 工艺特写", "craft"),
        shot("精致场合上身效果图", "outfit-single"),
        shot("面料溯源说明图", "material"),
        shot("礼盒包装开箱展示图", "package"),
        shot("尺码参数标注图", "spec"),
      ],
    },
    {
      key: "plus",
      name: "{sub}大码显瘦套图",
      desc: "遮肉显瘦卖点，适配微胖身材人群",
      shots: [
        shot("显瘦效果主视觉首图", "hero"),
        shot("大码正面全身白底图", "white"),
        shot("遮肉显瘦卖点解析图", "selling"),
        shot("版型剪裁细节特写", "craft"),
        shot("普通款 vs 本款显瘦对比图", "compare"),
        shot("日常逛街上身效果图", "outfit-single"),
        shot("多场景穿搭组合图", "outfit-multi"),
        shot("全尺码参数标注图", "spec"),
      ],
    },
  ],
  shoes: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖外观、脚感与尺码",
      shots: [
        shot("单只侧面白底主图", "white"),
        shot("正侧后底多角度展示", "angles"),
        shot("核心卖点主视觉首图", "hero"),
        shot("鞋面材质 + 走线细节特写", "craft"),
        shot("鞋底结构与防滑纹理解析", "design"),
        shot("上脚穿搭效果图", "accessory-single"),
        shot("日常出行场景图", "scene"),
        shot("尺码对照参数图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出舒适科技与尺码换算",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("多角度白底展示", "angles"),
        shot("缓震舒适卖点图", "selling"),
        shot("鞋底科技原理解析", "principle"),
        shot("上脚穿搭多场景", "accessory-multi"),
        shot("欧美尺码换算参数图", "spec"),
        shot("包装与配件展示", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出利益点与热卖氛围",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("热卖款主视觉首图", "hero"),
        shot("多配色展示图", "angles"),
        shot("核心卖点图", "selling"),
        shot("上脚前后对比图", "compare"),
        shot("买家秀氛围图", "ugc"),
        shot("尺码参数图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "高端皮具工艺定位，强调材质与手工",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("皮料微距工艺特写", "craft"),
        shot("手工工艺流程图", "process"),
        shot("精致场合穿搭图", "accessory-single"),
        shot("礼盒包装展示", "package"),
        shot("尺码参数图", "spec"),
        shot("售后保养说明图", "service"),
      ],
    },
    {
      key: "comfort",
      name: "{sub}舒适脚感套图",
      desc: "主打舒适与功能，适配通勤久站人群",
      shots: [
        shot("脚感舒适主视觉首图", "hero"),
        shot("久站痛点展示", "painpoint"),
        shot("鞋垫与中底结构解析", "principle"),
        shot("真实行走使用状态", "usage"),
        shot("透气材质解析", "material"),
        shot("通勤场景上脚图", "accessory-single"),
        shot("尺码参数图", "spec"),
      ],
    },
  ],
  bags: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖外观、容量与背法",
      shots: [
        shot("正面白底主图", "white"),
        shot("多角度外观展示", "angles"),
        shot("核心卖点主视觉首图", "hero"),
        shot("五金 + 走线 + 皮面细节特写", "craft"),
        shot("内部分层与容量展示", "design"),
        shot("上身背法效果图", "accessory-single"),
        shot("尺寸参数标注图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出容量与双单位尺寸",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("多角度白底展示", "angles"),
        shot("图标化卖点主图", "selling-hero"),
        shot("容量装载演示图", "usage"),
        shot("多场景背法组合", "accessory-multi"),
        shot("双单位尺寸参数图", "spec"),
        shot("材质细节特写", "craft"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出颜色选择与利益点",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("热卖款主视觉首图", "hero"),
        shot("多配色展示图", "angles"),
        shot("核心卖点图", "selling"),
        shot("买家秀氛围图", "ugc"),
        shot("赠品礼遇清单图", "gift"),
        shot("尺寸参数图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "轻奢定位，强调皮料工艺与礼赠属性",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("皮料微距工艺特写", "craft"),
        shot("高端场景人物互动", "interact"),
        shot("精致穿搭背法图", "accessory-single"),
        shot("礼盒包装开箱展示", "package"),
        shot("尺寸参数图", "spec"),
        shot("保养与售后说明", "service"),
      ],
    },
    {
      key: "commute",
      name: "{sub}通勤出行套图",
      desc: "通勤与旅行场景，突出收纳与耐用",
      shots: [
        shot("通勤场景主图", "scene-hero"),
        shot("收纳分区设计图", "design"),
        shot("装载前后对比图", "compare"),
        shot("防泼水耐磨材质解析", "material"),
        shot("通勤出行场景图", "scene"),
        shot("多场景背法组合", "accessory-multi"),
        shot("尺寸参数图", "spec"),
      ],
    },
  ],
  jewelry: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖外观、佩戴与材质",
      shots: [
        shot("白底正面主图", "white"),
        shot("微距细节特写主图", "closeup"),
        shot("核心设计主视觉首图", "hero"),
        shot("真人佩戴效果图", "wear"),
        shot("材质与工艺解析图", "material"),
        shot("尺寸参数标注图", "spec"),
        shot("礼盒包装展示", "package"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出材质说明与尺寸",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("多角度展示", "angles"),
        shot("佩戴主图", "wear-hero"),
        shot("材质成分说明图", "material"),
        shot("双单位尺寸参数图", "spec"),
        shot("礼盒包装图", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}节日送礼套图",
      desc: "节日礼赠场景，突出心意与包装",
      shots: [
        shot("节日营销主图", "sale-hero"),
        shot("送礼场景主视觉", "hero"),
        shot("情侣 / 亲友互动场景", "interact"),
        shot("佩戴效果图", "wear"),
        shot("礼盒开箱展示", "package"),
        shot("赠品礼遇清单", "gift"),
        shot("尺寸参数图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "高端珠宝定位，强调光泽、工艺与证书",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("宝石 / 金属微距光泽特写", "closeup"),
        shot("镶嵌工艺细节图", "craft"),
        shot("晚宴场合佩戴图", "wear"),
        shot("权威鉴定证书图", "cert"),
        shot("礼盒包装展示", "package"),
        shot("尺寸参数图", "spec"),
      ],
    },
    {
      key: "wear",
      name: "{sub}佩戴氛围套图",
      desc: "多场景佩戴氛围，适配社媒种草",
      shots: [
        shot("佩戴氛围主图", "wear-hero"),
        shot("多场景佩戴组合", "accessory-multi"),
        shot("日常穿搭场景图", "accessory-single"),
        shot("细节特写图", "craft"),
        shot("买家秀氛围图", "ugc"),
        shot("尺寸参数图", "spec"),
      ],
    },
  ],
  digital: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖外观、功能与参数",
      shots: [
        shot("白底正面主图", "white"),
        shot("多角度外观展示", "angles"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("功能原理解析图", "principle"),
        shot("接口与细节特写", "craft"),
        shot("真实使用场景图", "scene"),
        shot("规格参数图", "spec"),
        shot("包装配件清单", "package"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，英文卖点与兼容说明",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("核心功能解析图", "principle"),
        shot("多场景使用组合", "multiscene"),
        shot("兼容性与参数图", "spec"),
        shot("包装配件清单", "package"),
        shot("操作步骤演示图", "steps"),
        shot("常见问题 FAQ 图", "faq"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出性价比与赠品",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("同价位方案对比图", "compare"),
        shot("赠品礼遇清单", "gift"),
        shot("规格参数图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "旗舰定位，强调设计语言与材质工艺",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("设计结构爆炸图", "design"),
        shot("材质工艺特写", "craft"),
        shot("高端场景使用图", "scene"),
        shot("核心科技原理解析", "principle"),
        shot("规格参数图", "spec"),
        shot("包装开箱展示", "package"),
      ],
    },
    {
      key: "tech",
      name: "{sub}参数硬核套图",
      desc: "技术党视角，参数与原理讲透",
      shots: [
        shot("卖点主图", "selling-hero"),
        shot("核心参数图", "spec"),
        shot("功能原理解析图", "principle"),
        shot("性能对比图", "compare"),
        shot("结构设计图", "design"),
        shot("质检检测图", "inspection"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
  ],
  appliance: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖功能、场景与参数",
      shots: [
        shot("白底正面主图", "white"),
        shot("场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("功能原理解析图", "principle"),
        shot("家居使用场景图", "scene"),
        shot("操作面板细节特写", "craft"),
        shot("规格参数图", "spec"),
        shot("配件清单图", "package"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出电压规格与使用说明",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("功能原理解析图", "principle"),
        shot("真实使用状态图", "usage"),
        shot("操作步骤演示图", "steps"),
        shot("规格参数图", "spec"),
        shot("配件清单图", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出省心省力与利益点",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("痛点展示图", "painpoint"),
        shot("核心卖点图", "selling"),
        shot("使用前后对比图", "compare"),
        shot("赠品礼遇清单", "gift"),
        shot("规格参数图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "高端家电定位，强调设计与空间融合",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("空间融合场景图", "scene"),
        shot("设计细节特写", "craft"),
        shot("核心科技解析", "principle"),
        shot("质检检测报告图", "inspection"),
        shot("规格参数图", "spec"),
        shot("安装与售后服务图", "shipping"),
      ],
    },
    {
      key: "demo",
      name: "{sub}功能演示套图",
      desc: "真人演示关键功能，降低决策门槛",
      shots: [
        shot("真人使用主图", "handheld-hero"),
        shot("真人使用示范图", "demo"),
        shot("操作步骤演示图", "steps"),
        shot("使用前后对比图", "compare"),
        shot("多场景展示图", "multiscene"),
        shot("规格参数图", "spec"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
  ],
  home: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖外观、空间与尺寸",
      shots: [
        shot("白底正面主图", "white"),
        shot("空间场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("材质工艺细节特写", "craft"),
        shot("结构设计图", "design"),
        shot("家居空间场景图", "scene"),
        shot("尺寸参数图", "spec"),
        shot("运输安装说明图", "shipping"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出尺寸换算与安装",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("多角度展示", "angles"),
        shot("图标化卖点主图", "selling-hero"),
        shot("多空间场景组合", "multiscene"),
        shot("双单位尺寸参数图", "spec"),
        shot("安装步骤说明图", "steps"),
        shot("材质成分解析图", "material"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出性价比与配送安装",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("场景主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("多色可选展示", "angles"),
        shot("送货安装服务图", "shipping"),
        shot("尺寸参数图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "高端家居定位，强调设计与材质",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("设计师空间场景图", "scene"),
        shot("材质微距特写", "craft"),
        shot("材质溯源解析", "material"),
        shot("生产工艺流程图", "process"),
        shot("尺寸参数图", "spec"),
        shot("质保与安装服务", "service"),
      ],
    },
    {
      key: "space",
      name: "{sub}空间搭配套图",
      desc: "多风格空间搭配，帮助买家想象落地效果",
      shots: [
        shot("空间场景主图", "scene-hero"),
        shot("多风格空间组合", "multiscene"),
        shot("真人居家互动图", "interact"),
        shot("细节工艺图", "craft"),
        shot("尺寸与空间占用图", "spec"),
        shot("买家秀氛围图", "ugc"),
      ],
    },
  ],
  daily: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖外观、用法与规格",
      shots: [
        shot("白底正面主图", "white"),
        shot("场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("细节工艺图", "craft"),
        shot("生活使用场景图", "scene"),
        shot("规格参数图", "spec"),
        shot("包装展示图", "package"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出多用途与尺寸",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("多场景展示图", "multiscene"),
        shot("真实使用状态图", "usage"),
        shot("双单位规格参数图", "spec"),
        shot("包装配件清单", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出囤货与利益点",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("痛点展示图", "painpoint"),
        shot("核心卖点图", "selling"),
        shot("使用前后对比图", "compare"),
        shot("赠品礼遇清单", "gift"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "品质生活定位，强调材质与设计感",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("材质微距特写", "craft"),
        shot("品质生活场景图", "scene"),
        shot("材质成分解析", "material"),
        shot("礼盒包装展示", "package"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "life",
      name: "{sub}生活好物套图",
      desc: "种草向生活方式呈现，适配内容平台",
      shots: [
        shot("生活场景主图", "scene-hero"),
        shot("真人互动场景图", "interact"),
        shot("多场景展示图", "multiscene"),
        shot("使用步骤演示图", "steps"),
        shot("买家秀氛围图", "ugc"),
        shot("规格参数图", "spec"),
      ],
    },
  ],
  beauty: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖功效、成分与用法",
      shots: [
        shot("白底正面主图", "white"),
        shot("质地微距主图", "closeup"),
        shot("首屏主视觉图", "hero"),
        shot("核心功效卖点图", "selling"),
        shot("成分解析图", "material"),
        shot("真人使用示范图", "demo"),
        shot("使用步骤图", "steps"),
        shot("规格参数图", "spec"),
        shot("质检认证图", "cert"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出成分说明与用法",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("成分解析图", "material"),
        shot("质地展示图", "craft"),
        shot("使用步骤图", "steps"),
        shot("规格参数图", "spec"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出套装赠品与利益点",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心功效卖点图", "selling"),
        shot("赠品礼遇清单", "gift"),
        shot("买家秀口碑图", "review"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}高端质感套图",
      desc: "高端美妆定位，强调质地光泽与仪式感",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("质地光泽微距特写", "closeup"),
        shot("成分溯源解析", "material"),
        shot("仪式感使用场景", "scene"),
        shot("礼盒包装展示", "package"),
        shot("权威资质认证图", "cert"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "effect",
      name: "{sub}成分功效套图",
      desc: "成分党视角，讲清成分与使用感受",
      shots: [
        shot("成分卖点主图", "selling-hero"),
        shot("肌肤痛点展示", "painpoint"),
        shot("成分解析图", "material"),
        shot("作用原理示意图", "principle"),
        shot("真人使用示范图", "demo"),
        shot("质检检测报告图", "inspection"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
  ],
  food: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖食欲、原料与规格",
      shots: [
        shot("白底包装主图", "white"),
        shot("食欲场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("原料产地解析图", "material"),
        shot("食用场景图", "scene"),
        shot("吃法步骤图", "steps"),
        shot("规格参数图", "spec"),
        shot("包装展示图", "package"),
        shot("物流发货说明图", "logistics"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出配料与规格",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("配料成分说明图", "material"),
        shot("食用场景组合", "multiscene"),
        shot("规格参数图", "spec"),
        shot("包装展示图", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出囤货与赠品",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("食欲主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("赠品礼遇清单", "gift"),
        shot("买家秀氛围图", "ugc"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "lux",
      name: "{sub}礼盒质感套图",
      desc: "高端礼赠定位，强调产地与包装",
      shots: [
        shot("大片质感主视觉海报", "promo-hero"),
        shot("原料微距特写", "closeup"),
        shot("产地溯源解析", "material"),
        shot("生产工艺流程图", "process"),
        shot("礼盒开箱展示", "package"),
        shot("送礼场景图", "interact"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "fresh",
      name: "{sub}新鲜直达套图",
      desc: "生鲜时效与品质，打消新鲜度顾虑",
      shots: [
        shot("新鲜场景主图", "scene-hero"),
        shot("切面 / 质地特写", "closeup"),
        shot("产地实拍图", "factory"),
        shot("质检检测图", "inspection"),
        shot("冷链物流说明图", "logistics"),
        shot("售后保障服务图", "service"),
      ],
    },
  ],
  baby: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖安全、材质与用法",
      shots: [
        shot("白底正面主图", "white"),
        shot("场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("材质安全解析图", "material"),
        shot("亲子使用场景图", "interact"),
        shot("细节工艺图", "craft"),
        shot("规格参数图", "spec"),
        shot("质检认证图", "cert"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出适用年龄与安全说明",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("材质安全解析图", "material"),
        shot("使用步骤图", "steps"),
        shot("适龄与规格参数图", "spec"),
        shot("包装配件清单", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出囤货与赠品",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("赠品礼遇清单", "gift"),
        shot("真实好评口碑图", "review"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "safe",
      name: "{sub}安全放心套图",
      desc: "宝妈关注点，讲透安全与品质",
      shots: [
        shot("安心主视觉首图", "hero"),
        shot("育儿痛点展示", "painpoint"),
        shot("材质安全解析图", "material"),
        shot("质检检测报告图", "inspection"),
        shot("工厂实力实拍图", "factory"),
        shot("权威资质认证图", "cert"),
        shot("售后保障服务图", "service"),
      ],
    },
  ],
  sports: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖功能、场景与规格",
      shots: [
        shot("白底正面主图", "white"),
        shot("运动场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("材质科技解析图", "material"),
        shot("真人运动使用图", "usage"),
        shot("细节工艺图", "craft"),
        shot("规格参数图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出功能与尺寸",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("功能原理解析图", "principle"),
        shot("多运动场景组合", "multiscene"),
        shot("双单位规格参数图", "spec"),
        shot("包装配件清单", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出性价比与赠品",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("同类方案对比图", "compare"),
        shot("赠品礼遇清单", "gift"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "pro",
      name: "{sub}专业运动套图",
      desc: "专业玩家视角，突出性能与耐用",
      shots: [
        shot("专业运动主图", "handheld-hero"),
        shot("性能原理解析", "principle"),
        shot("真人使用示范图", "demo"),
        shot("耐用测试 / 质检图", "inspection"),
        shot("结构设计图", "design"),
        shot("规格参数图", "spec"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
  ],
  health: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，合规呈现功能与用法（不作疗效承诺）",
      shots: [
        shot("白底正面主图", "white"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("功能原理示意图", "principle"),
        shot("真人使用示范图", "demo"),
        shot("使用步骤图", "steps"),
        shot("规格参数图", "spec"),
        shot("权威资质认证图", "cert"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，严格避免医疗功效宣称",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("成分材质说明图", "material"),
        shot("使用步骤图", "steps"),
        shot("规格参数图", "spec"),
        shot("包装配件清单", "package"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "trust",
      name: "{sub}专业信赖套图",
      desc: "专业品质背书，打消安全与效果顾虑",
      shots: [
        shot("专业感主视觉首图", "hero"),
        shot("使用痛点展示", "painpoint"),
        shot("质检检测报告图", "inspection"),
        shot("生产工艺流程图", "process"),
        shot("权威资质认证图", "cert"),
        shot("真实好评口碑图", "review"),
        shot("售后保障服务图", "service"),
      ],
    },
  ],
  pet: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖材质、用法与规格",
      shots: [
        shot("白底正面主图", "white"),
        shot("萌宠场景主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("材质安全解析图", "material"),
        shot("宠物使用场景图", "usage"),
        shot("细节工艺图", "craft"),
        shot("规格参数图", "spec"),
        shot("售后保障服务图", "service"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出适用体型与尺寸",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("材质安全解析图", "material"),
        shot("多场景使用组合", "multiscene"),
        shot("适用体型与尺寸图", "spec"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}大促引流套图",
      desc: "大促节点引流，突出囤货与赠品",
      shots: [
        shot("大促营销主图", "sale-hero"),
        shot("核心卖点图", "selling"),
        shot("使用前后对比图", "compare"),
        shot("赠品礼遇清单", "gift"),
        shot("买家秀氛围图", "ugc"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "cute",
      name: "{sub}萌宠互动套图",
      desc: "萌宠互动种草，适配内容平台",
      shots: [
        shot("萌宠互动主图", "scene-hero"),
        shot("主人与宠物互动图", "interact"),
        shot("宠物使用状态图", "usage"),
        shot("多场景展示图", "multiscene"),
        shot("买家秀氛围图", "ugc"),
        shot("规格参数图", "spec"),
      ],
    },
  ],
  festival: [
    {
      key: "std",
      name: "{sub}标准套图",
      desc: "全平台通用基础款，覆盖氛围、用法与规格",
      shots: [
        shot("白底正面主图", "white"),
        shot("节日氛围主图", "scene-hero"),
        shot("首屏主视觉图", "hero"),
        shot("核心卖点图", "selling"),
        shot("节日布置场景图", "scene"),
        shot("细节工艺图", "craft"),
        shot("套装清单图", "package"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "amz",
      name: "{sub}跨境合规套图",
      desc: "跨境平台合规款，突出套装内容与尺寸",
      shots: [
        shot("纯白背景主图", "amazon"),
        shot("图标化卖点主图", "selling-hero"),
        shot("多场景布置组合", "multiscene"),
        shot("套装内容清单", "package"),
        shot("双单位规格参数图", "spec"),
        shot("安装布置步骤图", "steps"),
        shot("常见问题 FAQ 图", "faq"),
      ],
    },
    {
      key: "sale",
      name: "{sub}节日大促套图",
      desc: "节日节点引流，突出氛围与利益点",
      shots: [
        shot("节日大促主图", "sale-hero"),
        shot("活动海报", "poster"),
        shot("节日氛围场景图", "scene"),
        shot("核心卖点图", "selling"),
        shot("赠品礼遇清单", "gift"),
        shot("规格参数图", "spec"),
      ],
    },
    {
      key: "party",
      name: "{sub}派对氛围套图",
      desc: "派对与聚会场景，突出热闹氛围",
      shots: [
        shot("派对氛围主图", "scene-hero"),
        shot("真人派对互动图", "interact"),
        shot("多场景布置组合", "multiscene"),
        shot("细节工艺图", "craft"),
        shot("买家秀氛围图", "ugc"),
        shot("规格参数图", "spec"),
      ],
    },
  ],
};

function fill(template, sub) {
  return String(template || "").replaceAll("{sub}", sub);
}

const TEMPLATE_CACHE = new Map();

// 某二级品类下的模板列表；id 形如 women.3.std（一级品类.二级序号.原型）
export function listingTemplatesFor(categoryId, subIndex) {
  const category = LISTING_TEMPLATE_CATEGORIES.find(
    (item) => item.id === categoryId,
  );
  const sub = category?.subs[subIndex];
  if (!category || !sub) return [];
  const key = `${category.id}.${subIndex}`;
  if (TEMPLATE_CACHE.has(key)) return TEMPLATE_CACHE.get(key);
  const templates = (FAMILY_ARCHETYPES[category.family] || []).map(
    (archetype) => ({
      id: `${key}.${archetype.key}`,
      categoryId: category.id,
      categoryLabel: category.label,
      subLabel: sub,
      name: fill(archetype.name, sub),
      description: archetype.desc,
      shots: archetype.shots.map((item) => ({
        label: item.label,
        type: item.type,
      })),
    }),
  );
  TEMPLATE_CACHE.set(key, templates);
  return templates;
}

export function listingTemplateCount(categoryId) {
  const category = LISTING_TEMPLATE_CATEGORIES.find(
    (item) => item.id === categoryId,
  );
  if (!category) return 0;
  return (
    category.subs.length * (FAMILY_ARCHETYPES[category.family] || []).length
  );
}

export function listingTemplateById(id) {
  const [categoryId, subIndex] = String(id || "").split(".");
  return (
    listingTemplatesFor(categoryId, Number(subIndex)).find(
      (item) => item.id === id,
    ) || null
  );
}

// 按关键字在全部模板里搜索（模板名 / 二级品类 / 一级品类）
export function searchListingTemplates(query, limit = 60) {
  const text = String(query || "")
    .trim()
    .toLowerCase();
  if (!text) return [];
  const out = [];
  for (const category of LISTING_TEMPLATE_CATEGORIES) {
    for (let index = 0; index < category.subs.length; index += 1) {
      for (const template of listingTemplatesFor(category.id, index)) {
        const haystack =
          `${template.name}${template.subLabel}${template.categoryLabel}`.toLowerCase();
        if (haystack.includes(text)) out.push(template);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// ---------- 套图 blueprint ----------

function customTypeFrom(item) {
  if (!item?.id) return null;
  const label = String(item.label || "").trim() || "自定义出图方向";
  const brief = String(item.direction || "").trim();
  return {
    id: item.id,
    group: item.role === "main" ? "main" : "detail",
    role: item.role === "main" ? "main" : "detail",
    label,
    hint: "自定义方向",
    icon: "bi-pencil",
    custom: true,
    direction: brief
      ? `围绕「${label}」组织画面：${brief}。` + NO_FABRICATION
      : `围绕「${label}」组织画面。` + NO_FABRICATION,
  };
}

export function listingResolveType(id, customTypes = []) {
  const builtIn = listingTypeById(id);
  if (builtIn) return builtIn;
  return customTypeFrom((customTypes || []).find((item) => item.id === id));
}

// 把规划选择展开成「每张图一条」的基础 blueprint（未套策划文案）
export function listingBaseShots({
  planMode = "free",
  freeItems = [],
  customTypes = [],
  templateIds = [],
  smart = { main: 1, detail: 5 },
  plan = null,
} = {}) {
  const shots = [];
  if (planMode === "smart") {
    const planned = Array.isArray(plan?.items) ? plan.items : [];
    const planSmart = planned.length && planned.every((item) => item.type);
    if (planSmart) {
      for (const item of planned) {
        const type = listingTypeById(item.type);
        if (!type) continue;
        shots.push({
          id: item.id,
          typeId: type.id,
          role: item.role === "main" ? "main" : type.role,
          label: type.label,
          direction: type.direction,
        });
      }
    } else {
      const main = Math.max(
        0,
        Math.min(LISTING_SMART_MAX_MAIN, Number(smart?.main) || 0),
      );
      const detail = Math.max(
        0,
        Math.min(LISTING_SMART_MAX_DETAIL, Number(smart?.detail) || 0),
      );
      for (let index = 1; index <= main; index += 1) {
        shots.push({
          id: `main-${index}`,
          typeId: "",
          role: "main",
          label: `主图 ${index}`,
          direction: "",
          pending: true,
        });
      }
      for (let index = 1; index <= detail; index += 1) {
        shots.push({
          id: `detail-${index}`,
          typeId: "",
          role: "detail",
          label: `详情页 ${index}`,
          direction: "",
          pending: true,
        });
      }
    }
  } else if (planMode === "template") {
    for (const templateId of templateIds || []) {
      const template = listingTemplateById(templateId);
      if (!template) continue;
      template.shots.forEach((item, index) => {
        const type = listingTypeById(item.type) || listingTypeById("hero");
        shots.push({
          id: `${template.id}~${index + 1}`,
          typeId: type.id,
          role: type.role,
          label: item.label,
          templateName: template.name,
          direction: `${type.direction} 本张画面：${item.label}。`,
        });
      });
    }
  } else {
    for (const entry of freeItems || []) {
      const type = listingResolveType(entry?.id, customTypes);
      if (!type) continue;
      const count = Math.max(
        1,
        Math.min(LISTING_MAX_PER_TYPE, Number(entry.count) || 1),
      );
      for (let index = 0; index < count; index += 1) {
        shots.push({
          id: index ? `${type.id}~${index + 1}` : type.id,
          typeId: type.id,
          role: type.role,
          label: count > 1 ? `${type.label} ${index + 1}` : type.label,
          custom: Boolean(type.custom),
          direction:
            type.direction +
            (index ? " 与同类型的其他张使用明显不同的构图、角度或场景。" : ""),
        });
      }
    }
  }
  return shots.slice(0, LISTING_MAX_SHOTS);
}

// 基础 blueprint + 策划方案（含用户在「逐步确认」里的修改）+ 主图 / 详情页画幅
export function listingBlueprints(options = {}) {
  const {
    plan = null,
    mainRatio = LISTING_DEFAULT_MAIN_RATIO,
    detailRatio = LISTING_DEFAULT_DETAIL_RATIO,
  } = options;
  const items = new Map(
    (Array.isArray(plan?.items) ? plan.items : []).map((item) => [
      String(item?.id || ""),
      item,
    ]),
  );
  return listingBaseShots(options)
    .filter((shot) => !items.get(shot.id)?.removed)
    .map((shot) => {
      const planned = items.get(shot.id);
      const aspectRatio = shot.role === "main" ? mainRatio : detailRatio;
      if (!planned) return { ...shot, aspectRatio };
      const headline = String(planned.headline || "").trim();
      const subline = String(planned.subline || "").trim();
      const direction = String(planned.direction || "").trim();
      return {
        ...shot,
        aspectRatio,
        headline,
        subline,
        plannedDirection: direction,
        direction: [
          shot.direction,
          direction ? `策划方向：${direction}` : "",
          headline
            ? `画面标题文案：「${headline}」${subline ? `；副文案：「${subline}」` : ""}。文案必须准确清晰，无法可靠生成时留白。`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    });
}

// 智能组图的候选类型：全部内置类型（不含自定义），只带策划需要的简短信息
export function listingSmartCandidates() {
  return LISTING_IMAGE_TYPES.map((item) => ({
    id: item.id,
    label: item.label,
    role: item.role,
    direction: item.hint,
  }));
}
