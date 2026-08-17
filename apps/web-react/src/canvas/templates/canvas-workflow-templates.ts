import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData, CanvasNodeTypeId } from "@/types/canvas";

export type CanvasWorkflowTemplateCategory = "quick-test" | "industry" | "model-poster" | "commerce-poster" | "card" | "game-model" | "icon";
export type CanvasWorkflowTemplateSize = 10 | 50 | 80 | 100;

export type CanvasWorkflowTemplate = {
    id: string;
    title: string;
    category: CanvasWorkflowTemplateCategory;
    categoryLabel: string;
    industry: string;
    summary: string;
    platforms: string[];
    deliverables: string[];
    focus: string[];
    nodeCount: CanvasWorkflowTemplateSize;
    accent: string;
    seed: number;
    stages?: Stage[];
};

type TemplateSeed = Omit<CanvasWorkflowTemplate, "categoryLabel" | "seed">;
type Stage = {
    title: string;
    mode: "image" | "text";
    purpose: string;
    inputIndexes?: number[];
    parentStageIndexes?: number[];
};
type InputDefinition = { title: string; kind: "image" | "text"; required: boolean; purpose: string };

const CATEGORY_LABELS: Record<CanvasWorkflowTemplateCategory, string> = {
    "quick-test": "快速测试",
    industry: "行业电商",
    "model-poster": "人物模特海报",
    "commerce-poster": "电商海报",
    card: "卡牌设计",
    "game-model": "人物与游戏模型",
    icon: "图标设计",
};

const seed = (value: TemplateSeed, index: number): CanvasWorkflowTemplate => ({ ...value, categoryLabel: CATEGORY_LABELS[value.category], seed: index + 17 });

const QUICK_TEST_TEMPLATES: TemplateSeed[] = [
    {
        id: "quick-test-ecommerce-main-image",
        title: "快速测试｜电商主图生产闭环",
        category: "quick-test",
        industry: "电商主图",
        summary: "用一张真实商品图和一份活动简报，完整验证透明母版、平台主图、文案与合规交付。",
        platforms: ["天猫", "京东", "抖音商城"],
        deliverables: ["透明商品母版", "方形商品主图", "文案与合规清单"],
        focus: ["商品身份保真", "平台主图转化", "事实与价格合规"],
        nodeCount: 10,
        accent: "#0f766e",
        stages: [
            { title: "商品主体透明母资产", mode: "image", purpose: "商品身份、包装文字和边缘质量", inputIndexes: [0, 1], parentStageIndexes: [] },
            { title: "平台方形商品英雄主图", mode: "image", purpose: "主体层级、真实光影和移动端安全区", inputIndexes: [1], parentStageIndexes: [0] },
            { title: "主图文案与事实合规审计", mode: "text", purpose: "卖点、价格、权益、禁用词和交付清单", inputIndexes: [1], parentStageIndexes: [0, 1] },
        ],
    },
];

const INDUSTRY_TEMPLATES: TemplateSeed[] = [
    { id: "beauty-skincare-launch", title: "美妆护肤｜新品全渠道上市", category: "industry", industry: "美妆护肤", summary: "从瓶器校对、质地表达、功效合规到全渠道首发素材。", platforms: ["天猫", "小红书", "抖音商城", "Sephora"], deliverables: ["透明瓶器母版", "成分视觉", "功效信息图", "详情页", "投放素材"], focus: ["瓶器与泵头精修", "膏体质地微距", "成分证据表达", "敏感词合规", "肤感场景", "套装组合"], nodeCount: 100, accent: "#db2777" },
    { id: "fashion-apparel-season", title: "服装服饰｜季度上新与穿搭矩阵", category: "industry", industry: "服装服饰", summary: "覆盖平铺、挂拍、模特上身、面料细节、尺码与多平台投放。", platforms: ["天猫", "淘宝", "抖音商城", "Zalando"], deliverables: ["标准款式图", "模特上身", "穿搭套组", "尺码图", "Lookbook"], focus: ["版型一致性", "面料纹理", "多身型试穿", "季节穿搭", "配色扩展", "尺码说明"], nodeCount: 100, accent: "#7c3aed" },
    { id: "footwear-sneaker-drop", title: "鞋履运动｜球鞋发售视觉系统", category: "industry", industry: "鞋履运动", summary: "鞋型校准、鞋底科技、脚感场景、发售海报和渠道规格一体化。", platforms: ["京东", "得物", "抖音商城", "Amazon"], deliverables: ["鞋型母版", "多角度展示", "科技拆解", "上脚场景", "发售海报"], focus: ["鞋楦轮廓", "鞋底结构", "材质拼接", "动态上脚", "限量发售", "真假细节校验"], nodeCount: 100, accent: "#2563eb" },
    { id: "jewelry-luxury-detail", title: "珠宝腕表｜奢品细节与礼赠内容", category: "industry", industry: "珠宝腕表", summary: "面向高反光材质、宝石色泽、佩戴比例与节日礼赠的精细流程。", platforms: ["天猫奢品", "小红书", "京东", "Etsy"], deliverables: ["微距主图", "佩戴图", "工艺拆解", "礼盒组合", "礼赠海报"], focus: ["金属高光", "宝石火彩", "刻字真实性", "佩戴比例", "礼盒陈列", "奢品留白"], nodeCount: 100, accent: "#b45309" },
    { id: "consumer-electronics-launch", title: "消费电子｜新品发布与参数视觉", category: "industry", industry: "消费电子", summary: "硬件外观、接口、参数、使用场景和发布会级视觉的完整生产链。", platforms: ["京东", "天猫", "Amazon", "Best Buy"], deliverables: ["产品渲染", "接口特写", "参数对比", "场景图", "首发KV"], focus: ["结构比例", "屏幕内容", "接口准确性", "材质反射", "参数可视化", "生态组合"], nodeCount: 100, accent: "#0891b2" },
    { id: "home-appliance-detail", title: "家用电器｜功能演示与详情页", category: "industry", industry: "家用电器", summary: "从白底商品图到厨房/家居场景、功能步骤和规格安装说明。", platforms: ["京东", "苏宁易购", "天猫", "Walmart"], deliverables: ["白底主图", "功能场景", "结构爆炸图", "安装说明", "详情长图"], focus: ["体积比例", "功能部件", "操作步骤", "能效信息", "家庭场景", "清洁维护"], nodeCount: 100, accent: "#0f766e" },
    { id: "furniture-room-set", title: "家具家居｜空间套系与软装搭配", category: "industry", industry: "家具家居", summary: "单品精修、尺寸比例、空间搭配、材质细节与整屋套系输出。", platforms: ["天猫家装", "京东", "Wayfair", "IKEA Marketplace"], deliverables: ["单品白底", "空间场景", "尺寸图", "材质板", "整屋套系"], focus: ["家具尺度", "木纹织物", "空间动线", "软装搭配", "安装结构", "多户型适配"], nodeCount: 100, accent: "#4d7c0f" },
    { id: "food-snack-campaign", title: "食品零食｜口味矩阵与促销内容", category: "industry", industry: "食品零食", summary: "包装保真、食欲表现、口味区分、组合装和节点促销素材。", platforms: ["天猫超市", "京东到家", "拼多多", "Shopee"], deliverables: ["包装主图", "食材飞溅", "口味矩阵", "组合装", "促销海报"], focus: ["包装文字", "食品真实质感", "口味色彩", "规格数量", "保质期合规", "分享场景"], nodeCount: 100, accent: "#ea580c" },
    { id: "coffee-beverage-brand", title: "咖啡饮品｜品牌内容与门店电商", category: "industry", industry: "咖啡饮品", summary: "杯型与包装、冷热饮质感、菜单、订阅装和社交传播统一生产。", platforms: ["微信小店", "美团", "小红书", "Shopify"], deliverables: ["杯装主图", "风味视觉", "菜单图", "订阅礼盒", "社交海报"], focus: ["液体层次", "冰块泡沫", "咖啡豆产地", "杯身标识", "冷热双版本", "门店氛围"], nodeCount: 100, accent: "#92400e" },
    { id: "maternal-baby-trust", title: "母婴用品｜信任内容与场景说明", category: "industry", industry: "母婴用品", summary: "强调安全、尺寸、材质与真实亲子场景，兼顾平台合规。", platforms: ["天猫国际", "京东", "考拉海购", "Amazon"], deliverables: ["产品母版", "材质说明", "年龄场景", "尺寸指南", "信任详情页"], focus: ["安全结构", "柔软材质", "年龄匹配", "亲子互动", "清洗方式", "认证边界"], nodeCount: 100, accent: "#db2777" },
    { id: "pet-supplies-growth", title: "宠物用品｜多宠型场景与订阅增长", category: "industry", industry: "宠物用品", summary: "商品结构、宠物体型适配、使用步骤、订阅组合和UGC风格素材。", platforms: ["天猫", "抖音商城", "Chewy", "Amazon"], deliverables: ["商品主图", "多宠型试用", "步骤图", "订阅组合", "UGC素材"], focus: ["宠物体型", "安全使用", "材质耐用", "行为场景", "补充装", "真实UGC"], nodeCount: 100, accent: "#16a34a" },
    { id: "outdoor-sports-system", title: "户外运动｜装备系统与性能场景", category: "industry", industry: "户外运动", summary: "装备细节、环境性能、穿戴系统、套装组合与专业测评视觉。", platforms: ["京东", "天猫", "Decathlon", "Amazon"], deliverables: ["装备母版", "结构特写", "极端场景", "穿戴系统", "性能信息图"], focus: ["防水结构", "耐磨材质", "负重系统", "环境适配", "人体工学", "安全警示"], nodeCount: 100, accent: "#15803d" },
    { id: "automotive-accessories", title: "汽车用品｜车型适配与安装转化", category: "industry", industry: "汽车用品", summary: "车型适配、安装步骤、前后对比、夜间效果和参数说明。", platforms: ["京东汽车", "天猫养车", "eBay Motors", "Amazon"], deliverables: ["配件白底", "车型适配", "安装步骤", "效果对比", "参数详情"], focus: ["接口规格", "车型兼容", "安装位置", "前后对比", "夜间效果", "安全合规"], nodeCount: 100, accent: "#475569" },
    { id: "wellness-supplement-compliance", title: "营养健康｜成分教育与合规转化", category: "industry", industry: "营养健康", summary: "包装事实、成分来源、食用方式、周期内容与严格功效合规。", platforms: ["天猫国际", "京东健康", "iHerb", "Amazon"], deliverables: ["包装主图", "成分图", "食用步骤", "周期计划", "合规详情页"], focus: ["成分来源", "剂量事实", "食用方法", "人群边界", "功效禁语", "周期管理"], nodeCount: 100, accent: "#0284c7" },
    { id: "toys-collectibles-launch", title: "潮玩玩具｜系列化发售与收藏展示", category: "industry", industry: "潮玩玩具", summary: "角色设定、包装、系列矩阵、收藏陈列与全球平台发售内容。", platforms: ["天猫", "得物", "Temu", "Rakuten"], deliverables: ["角色白底", "包装展示", "系列矩阵", "收藏场景", "发售KV"], focus: ["角色比例", "涂装细节", "包装编号", "系列稀有度", "收藏陈列", "开箱体验"], nodeCount: 100, accent: "#9333ea" },
];

const MODEL_POSTER_TEMPLATES: TemplateSeed[] = [
    { id: "model-beauty-campaign", title: "人物海报｜高端美妆代言大片", category: "model-poster", industry: "美妆人像", summary: "锁定人物身份、妆容、产品互动和多比例代言海报。", platforms: ["小红书", "微博", "抖音", "天猫"], deliverables: ["人物母版", "妆容特写", "产品互动", "横竖版KV"], focus: ["身份一致性", "皮肤质感", "高级妆容", "手持产品", "品牌光影", "版权检查"], nodeCount: 80, accent: "#be185d" },
    { id: "model-fashion-editorial", title: "人物海报｜时装杂志与街拍系列", category: "model-poster", industry: "时装人像", summary: "从定妆、全身造型到杂志封面和街头大画幅。", platforms: ["小红书", "Instagram", "天猫", "Pinterest"], deliverables: ["定妆照", "全身造型", "杂志封面", "街拍海报"], focus: ["脸部一致", "服装轮廓", "姿态设计", "编辑光线", "城市背景", "版式留白"], nodeCount: 80, accent: "#6d28d9" },
    { id: "model-sports-endorsement", title: "人物海报｜运动员品牌代言", category: "model-poster", industry: "运动人像", summary: "运动姿态、装备互动、速度感与赛事节点传播。", platforms: ["微博", "抖音", "得物", "京东"], deliverables: ["运动员母版", "动作序列", "装备特写", "赛事海报"], focus: ["肌肉结构", "动作合理性", "装备保真", "速度凝结", "竞技灯光", "赛事信息"], nodeCount: 80, accent: "#1d4ed8" },
    { id: "model-travel-lifestyle", title: "人物海报｜旅行生活方式品牌", category: "model-poster", industry: "旅行生活", summary: "人物一致性、目的地氛围、行李产品和旅行故事海报。", platforms: ["小红书", "携程", "Instagram", "Shopify"], deliverables: ["旅拍母版", "目的地场景", "产品互动", "故事海报"], focus: ["人物身份", "自然姿态", "目的地识别", "旅行装备", "天气版本", "叙事连贯"], nodeCount: 80, accent: "#0e7490" },
    { id: "model-corporate-brand", title: "人物海报｜企业家与专业品牌形象", category: "model-poster", industry: "商业人像", summary: "专业肖像、办公情境、演讲场景和品牌公关物料。", platforms: ["微信", "LinkedIn", "官网", "知乎"], deliverables: ["标准肖像", "办公情境", "演讲主视觉", "公关海报"], focus: ["身份保真", "职业气质", "正式着装", "办公环境", "演讲舞台", "媒体规格"], nodeCount: 80, accent: "#334155" },
];

const COMMERCE_POSTER_TEMPLATES: TemplateSeed[] = [
    { id: "poster-618-tech", title: "电商海报｜618 数码大促全套", category: "commerce-poster", industry: "平台大促", summary: "价格层级、科技质感、会场入口和多尺寸投放素材。", platforms: ["京东", "天猫", "抖音商城"], deliverables: ["主会场KV", "单品爆款", "优惠券图", "信息流", "店铺横幅"], focus: ["价格层级", "科技舞台", "爆款聚焦", "优惠信息", "倒计时", "多尺寸裁切"], nodeCount: 80, accent: "#dc2626" },
    { id: "poster-double11-fashion", title: "电商海报｜双11时尚会场", category: "commerce-poster", industry: "时尚大促", summary: "服饰主视觉、品类分区、权益表达和直播间封面。", platforms: ["天猫", "淘宝直播", "小红书"], deliverables: ["会场KV", "品类入口", "权益海报", "直播封面", "返场图"], focus: ["时尚陈列", "品类分层", "优惠节奏", "人物搭配", "直播预热", "返场变化"], nodeCount: 80, accent: "#e11d48" },
    { id: "poster-fresh-food-festival", title: "电商海报｜生鲜节食欲营销", category: "commerce-poster", industry: "生鲜食品", summary: "鲜度表现、产地故事、套餐组合与即时零售规格。", platforms: ["美团", "京东到家", "盒马", "拼多多"], deliverables: ["鲜度KV", "产地海报", "套餐图", "秒杀图", "频道入口"], focus: ["食材真实", "鲜度水润", "产地信息", "套餐数量", "即时送达", "价格合规"], nodeCount: 80, accent: "#ea580c" },
    { id: "poster-crossborder-beauty", title: "电商海报｜跨境美妆全球购", category: "commerce-poster", industry: "跨境电商", summary: "品牌国别、正品信任、套装组合和跨境平台语言版本。", platforms: ["天猫国际", "考拉海购", "Shopee", "Lazada"], deliverables: ["全球购KV", "正品信任图", "套装图", "多语言Banner"], focus: ["品牌国别", "包装原文", "正品信任", "跨境时效", "套装权益", "语言本地化"], nodeCount: 80, accent: "#7c3aed" },
    { id: "poster-dtc-newbrand", title: "电商海报｜DTC 新品牌冷启动", category: "commerce-poster", industry: "独立站品牌", summary: "从品牌定调、首屏Hero、订阅转化到再营销广告素材。", platforms: ["Shopify", "Instagram", "TikTok Shop", "Pinterest"], deliverables: ["品牌Hero", "卖点图", "订阅弹窗图", "广告组", "再营销素材"], focus: ["品牌识别", "首屏转化", "社会证明", "订阅权益", "广告钩子", "再营销变化"], nodeCount: 80, accent: "#059669" },
];

const CARD_TEMPLATES: TemplateSeed[] = [
    { id: "card-fantasy-tcg", title: "卡牌｜奇幻 TCG 英雄套牌", category: "card", industry: "奇幻卡牌", summary: "角色立绘、阵营、技能、稀有度、边框与整套卡面一致性。", platforms: ["Steam", "TapTap", "实体印刷"], deliverables: ["角色立绘", "技能卡", "稀有卡", "卡背", "印刷检查"], focus: ["阵营语言", "角色轮廓", "技能图标", "稀有度特效", "卡框系统", "印刷安全区"], nodeCount: 50, accent: "#7e22ce" },
    { id: "card-scifi-tcg", title: "卡牌｜科幻机甲战术套牌", category: "card", industry: "科幻卡牌", summary: "机甲单位、武器技能、能量体系和全息稀有卡视觉。", platforms: ["Steam", "Epic", "实体印刷"], deliverables: ["机甲卡", "武器卡", "能量卡", "全息卡", "卡背"], focus: ["机甲结构", "武器模块", "能量色码", "战场背景", "全息材质", "数值层级"], nodeCount: 50, accent: "#0369a1" },
    { id: "card-oriental-myth", title: "卡牌｜东方神话角色收藏", category: "card", industry: "国风卡牌", summary: "神话人物、法器、山海异兽与国风边框体系。", platforms: ["TapTap", "微信小游戏", "实体收藏"], deliverables: ["神将卡", "异兽卡", "法器卡", "典藏卡", "卡背"], focus: ["传统纹样", "人物典故", "法器符号", "水墨空间", "鎏金边框", "文化校对"], nodeCount: 50, accent: "#b91c1c" },
    { id: "card-sports-collection", title: "卡牌｜体育球星收藏系列", category: "card", industry: "体育卡牌", summary: "球员身份、动作、赛季数据、签名版与收藏编号系统。", platforms: ["得物", "eBay", "实体收藏"], deliverables: ["基础卡", "动作卡", "数据卡", "签名卡", "限量卡"], focus: ["球员身份", "球队色彩", "动作瞬间", "赛季数据", "签名留区", "编号防伪"], nodeCount: 50, accent: "#1d4ed8" },
    { id: "card-food-brand-game", title: "卡牌｜食品品牌互动收集卡", category: "card", industry: "品牌卡牌", summary: "将产品角色化为可收集卡，兼顾促销玩法和包装联动。", platforms: ["微信小程序", "抖音", "线下包装"], deliverables: ["产品角色卡", "任务卡", "奖励卡", "隐藏卡", "包装联动"], focus: ["产品识别", "品牌角色", "促销规则", "奖励层级", "扫码区域", "包装印刷"], nodeCount: 50, accent: "#c2410c" },
];

const GAME_MODEL_TEMPLATES: TemplateSeed[] = [
    { id: "game-hero-character-sheet", title: "游戏模型｜写实英雄角色生产线", category: "game-model", industry: "写实角色", summary: "设定、三视图、装备拆分、表情、动作和引擎展示的角色全流程。", platforms: ["Steam", "PlayStation", "Xbox"], deliverables: ["角色设定", "三视图", "装备拆分", "表情表", "动作表"], focus: ["人体比例", "面部身份", "服装层级", "装备结构", "材质分区", "绑定友好"], nodeCount: 100, accent: "#475569" },
    { id: "game-stylized-character", title: "游戏模型｜风格化手游角色", category: "game-model", industry: "风格化角色", summary: "轮廓语言、头身比、服装变体、技能演出与立绘宣传统一。", platforms: ["iOS", "Android", "TapTap"], deliverables: ["角色立绘", "三视图", "服装变体", "技能关键帧", "宣传图"], focus: ["头身比例", "剪影识别", "色块层级", "服装变体", "技能色彩", "移动端可读性"], nodeCount: 100, accent: "#c026d3" },
    { id: "game-creature-boss", title: "游戏模型｜巨型生物与Boss设计", category: "game-model", industry: "怪物生物", summary: "生态逻辑、骨骼结构、攻击阶段、弱点与战斗场景设计。", platforms: ["Steam", "PlayStation", "Epic"], deliverables: ["生物设定", "结构拆解", "攻击阶段", "弱点图", "战斗KV"], focus: ["生物解剖", "体型尺度", "表皮材质", "攻击机制", "弱点识别", "阶段变化"], nodeCount: 100, accent: "#166534" },
    { id: "game-vehicle-hard-surface", title: "游戏模型｜科幻载具硬表面流程", category: "game-model", industry: "载具模型", summary: "功能布局、正交视图、模块拆分、损伤状态和驾驶舱细节。", platforms: ["Steam", "Xbox", "Epic"], deliverables: ["载具设定", "正交图", "模块拆分", "损伤版本", "驾驶舱"], focus: ["功能结构", "硬表面分件", "比例标尺", "推进系统", "损伤逻辑", "驾驶舱交互"], nodeCount: 100, accent: "#0e7490" },
    { id: "game-environment-props", title: "游戏模型｜场景建筑与道具套件", category: "game-model", industry: "场景资产", summary: "模块化建筑、道具套件、材质板、昼夜状态和关卡拼装预览。", platforms: ["Steam", "Unity Asset Store", "Unreal Marketplace"], deliverables: ["建筑套件", "道具表", "材质板", "昼夜版", "关卡预览"], focus: ["模块尺寸", "拼装规则", "道具层级", "材质复用", "昼夜照明", "性能预算"], nodeCount: 100, accent: "#854d0e" },
];

const ICON_TEMPLATES: TemplateSeed[] = [
    { id: "icon-saas-product", title: "图标｜SaaS 产品功能图标系统", category: "icon", industry: "软件产品", summary: "从语义映射、网格规范到浅深色和状态变体的一致图标库。", platforms: ["Web", "macOS", "Windows"], deliverables: ["线性图标", "填充图标", "状态变体", "深色版", "导出清单"], focus: ["语义映射", "24px网格", "描边统一", "圆角规则", "状态识别", "无障碍对比"], nodeCount: 50, accent: "#4f46e5" },
    { id: "icon-ecommerce-category", title: "图标｜电商品类与服务入口", category: "icon", industry: "电商导航", summary: "多品类入口、订单服务、会员权益和促销状态图标。", platforms: ["淘宝", "京东", "Shopify"], deliverables: ["品类图标", "服务图标", "会员图标", "促销图标", "深浅色版"], focus: ["品类识别", "小尺寸可读", "品牌色", "入口层级", "服务语义", "促销状态"], nodeCount: 50, accent: "#ea580c" },
    { id: "icon-game-skill", title: "图标｜游戏技能与道具套组", category: "icon", industry: "游戏UI", summary: "技能系别、冷却状态、品质等级、道具类型和边框体系。", platforms: ["PC", "主机", "移动端"], deliverables: ["技能图标", "道具图标", "品质边框", "冷却状态", "小尺寸测试"], focus: ["技能剪影", "元素色码", "品质等级", "冷却覆盖", "边框体系", "战斗可读性"], nodeCount: 50, accent: "#7e22ce" },
    { id: "icon-finance-dashboard", title: "图标｜金融数据与交易产品", category: "icon", industry: "金融科技", summary: "资产、交易、风控、数据趋势和账户状态的专业图标系统。", platforms: ["Web", "iOS", "Android"], deliverables: ["资产图标", "交易图标", "风控图标", "趋势图标", "状态图标"], focus: ["金融语义", "方向一致", "风险色彩", "数字邻接", "状态差异", "高对比模式"], nodeCount: 50, accent: "#0369a1" },
    { id: "icon-travel-map", title: "图标｜旅行地图与服务设施", category: "icon", industry: "旅行地图", summary: "交通、住宿、餐饮、景点与无障碍设施的地图标记体系。", platforms: ["Web地图", "iOS", "Android"], deliverables: ["地图标记", "交通图标", "设施图标", "路线状态", "离线版"], focus: ["地图可读", "地点类别", "交通方式", "设施语义", "缩放层级", "无障碍标记"], nodeCount: 50, accent: "#059669" },
];

export const CANVAS_WORKFLOW_TEMPLATES: CanvasWorkflowTemplate[] = [...QUICK_TEST_TEMPLATES, ...INDUSTRY_TEMPLATES, ...MODEL_POSTER_TEMPLATES, ...COMMERCE_POSTER_TEMPLATES, ...CARD_TEMPLATES, ...GAME_MODEL_TEMPLATES, ...ICON_TEMPLATES].map(seed);

export const CANVAS_WORKFLOW_TEMPLATE_CATEGORIES = (Object.keys(CATEGORY_LABELS) as CanvasWorkflowTemplateCategory[]).map((id) => ({ id, label: CATEGORY_LABELS[id], count: CANVAS_WORKFLOW_TEMPLATES.filter((item) => item.category === id).length }));

const COMMON_STAGES = [
    "资产盘点与缺口分析", "品牌视觉约束提取", "事实信息与合规边界", "主体透明母资产", "标准白底基准图", "正面结构校准", "侧面结构校准", "背面结构校准", "材质与工艺微距", "颜色与款式变体", "核心卖点视觉", "使用步骤说明", "真实场景主视觉", "人群场景适配", "规格尺寸信息图", "竞品差异化策略", "平台首图", "详情页首屏", "详情页功能分镜", "社交媒体方图", "信息流竖图", "故事竖版封面", "店铺横幅", "活动会场入口", "组合套装陈列", "赠品与包装展示", "标题与五点文案", "SEO关键词组合", "短标题与行动文案", "多语言本地化", "视觉一致性质检", "事实与文字质检", "平台规范质检", "裁切安全区检查", "交付命名与清单", "复投变体策略", "A/B测试版本", "季节版本", "节日版本", "会员版本", "新客版本", "老客复购版本", "最终交付审计", "归档母版", "下一轮迭代建议",
];

const CATEGORY_STAGES: Record<CanvasWorkflowTemplateCategory, string[]> = {
    "quick-test": ["商品主体透明母资产", "平台方形商品英雄主图", "主图文案与事实合规审计"],
    industry: ["商品身份识别", "包装文字校对", "核心结构拆解", "渠道价格区间视觉", "平台评价卖点归纳", "售后与使用说明"],
    "model-poster": ["人物身份锁定", "面部基准", "半身定妆", "全身姿态", "妆发方案", "服装方案", "手部与产品互动", "横版人物KV", "竖版人物KV", "肖像授权检查"],
    "commerce-poster": ["活动利益点排序", "主标题层级", "产品英雄构图", "价格区预留", "优惠券入口", "倒计时版本", "主会场KV", "分会场入口", "直播间封面", "返场版本"],
    card: ["世界观与阵营", "卡面信息层级", "主体立绘", "技能视觉", "属性图标", "稀有度系统", "边框与角标", "卡背设计", "套牌一致性", "印刷出血检查"],
    "game-model": ["世界观设定", "轮廓探索", "比例设定", "正交三视图", "结构拆件", "材质分区", "装备组件", "表情变化", "动作关键帧", "受击与损伤状态", "引擎展示图", "建模交接检查"],
    icon: ["语义词表", "视觉隐喻探索", "网格与安全区", "基础线性版本", "基础填充版本", "尺寸梯度", "状态变体", "浅色主题", "深色主题", "小尺寸像素检查", "导出命名规范"],
};

const CATEGORY_TRANSPARENT_STAGE: Record<CanvasWorkflowTemplateCategory, string> = {
    "quick-test": "商品主体透明母资产",
    industry: "商品主体透明母资产",
    "model-poster": "人物全身透明母资产",
    "commerce-poster": "海报商品透明母资产",
    card: "卡牌主体透明母资产",
    "game-model": "角色与模型透明母资产",
    icon: "图标透明母资产",
};

const TEXT_STAGE_WORDS = ["分析", "策略", "约束", "事实", "文案", "SEO", "关键词", "质检", "检查", "审计", "清单", "建议", "规范", "授权", "设定", "词表", "命名", "归档"];

function stageMode(title: string, index: number): Stage["mode"] {
    if (title.includes("透明母资产")) return "image";
    return TEXT_STAGE_WORDS.some((word) => title.includes(word)) || index % 11 === 0 ? "text" : "image";
}

function stagePlan(template: CanvasWorkflowTemplate, count: number): Stage[] {
    if (template.stages?.length) return template.stages.slice(0, count);
    const platformStages = template.platforms.flatMap((platform) => [`${platform}首图适配`, `${platform}详情与投放规格`]);
    const focusStages = template.focus.flatMap((focus) => [`${focus}基准`, `${focus}扩展版本`]);
    const deliverableStages = template.deliverables.map((item) => `${item}交付版本`);
    const pool = [...CATEGORY_STAGES[template.category], ...focusStages, ...platformStages, ...deliverableStages, ...COMMON_STAGES];
    const offset = template.seed % pool.length;
    const ordered = [...pool.slice(offset), ...pool.slice(0, offset)];
    const unique: string[] = [CATEGORY_TRANSPARENT_STAGE[template.category]];
    ordered.forEach((title) => {
        if (!unique.includes(title)) unique.push(title);
    });
    while (unique.length < count) unique.push(`${template.industry}专项变体 ${String(unique.length + 1).padStart(2, "0")}`);
    return unique.slice(0, count).map((title, index) => ({ title, mode: stageMode(title, index), purpose: template.focus[index % template.focus.length] }));
}

function isImageInput(index: number) {
    return index === 0 || index === 2 || index === 4 || index === 6;
}

function inputDefinitions(template: CanvasWorkflowTemplate, count: number): InputDefinition[] {
    const categoryInputs: Record<CanvasWorkflowTemplateCategory, Array<[string, string]>> = {
        "quick-test": [
            ["商品主图", "上传无遮挡、主体完整、包装文字清晰、无水印的真实商品正面图"],
            ["商品与活动生产简报", "填写品牌、商品名、SKU、规格、真实卖点、价格权益、目标平台、主色、禁用词和不可虚构项"],
        ],
        industry: [
            ["商品主图", "上传无遮挡、主体完整、分辨率清晰的商品正面图；包装文字和 Logo 应可辨认"],
            ["品牌与视觉规范", "填写品牌名、定位、主辅色、字体倾向、语气和必须保留的品牌元素"],
            ["包装/细节参考图", "上传背面、侧面、配件、标签、材质或包装展开图，用于恢复真实细节"],
            ["商品事实与规格", "填写商品名称、型号、尺寸、材质、容量、真实卖点、使用方法和售后信息"],
            ["竞品与渠道参考", "上传竞品陈列或目标店铺截图，只用于判断构图和信息密度，不复制品牌资产"],
            ["目标人群与场景", "填写年龄、需求、使用时机、消费动机和希望覆盖的真实生活场景"],
            ["活动权益参考", "上传活动会场、优惠券或价格层级参考；最终价格和权益仍以文字事实为准"],
            ["禁用内容与合规要求", "填写禁用词、不可虚构的认证/功效/销量、平台限制和版权边界"],
        ],
        "model-poster": [
            ["人物身份参考图", "上传同一人物的清晰正脸或半身照，五官无遮挡、无重度滤镜，身份必须获得授权"],
            ["品牌与海报简报", "填写品牌、活动主题、海报目的、视觉语气、主辅色和目标渠道"],
            ["产品/服装参考图", "上传需要准确呈现的产品、服装、鞋履或配饰参考，避免只用文字猜测"],
            ["人物授权与禁用项", "填写肖像授权范围、不可改变的身份特征、禁用姿态和敏感表达"],
            ["妆发参考", "上传妆容、发型、肤感和细节风格参考，说明哪些元素必须保留"],
            ["姿态与镜头", "填写半身/全身、动作强度、镜头焦段、视角和人物在画面中的占比"],
            ["场景与灯光参考", "上传场景、布光、材质或色彩氛围参考，不得包含无授权人物"],
            ["渠道文案信息", "填写主标题、副标题、日期、产品名、行动文案和各渠道安全区要求"],
        ],
        "commerce-poster": [
            ["商品主图", "上传主体完整、包装文字清晰、无水印的商品图；多商品活动优先提供组合陈列图"],
            ["活动主题与权益", "填写活动名、时间、折扣、到手价、赠品、门槛和权益适用条件"],
            ["品牌视觉规范", "上传品牌色、Logo 使用、字体、会场视觉或历史活动参考"],
            ["商品事实与价格", "填写 SKU、规格、原价/活动价、核心卖点和所有需要展示的法定信息"],
            ["会场参考图", "上传目标会场或频道入口参考，用于匹配信息密度、节奏和裁切方式"],
            ["目标人群与钩子", "填写受众、消费场景、首屏钩子、购买阻力和主行动目标"],
            ["平台尺寸参考", "上传或填写主图、横幅、信息流、直播封面和移动端安全区规格"],
            ["禁用内容", "填写禁止使用的价格表达、未经授权 Logo、人物、认证和绝对化宣传语"],
        ],
        card: [
            ["主体角色/商品参考", "上传角色、人物、机甲、球员或品牌商品的身份参考，主体特征需清晰完整"],
            ["世界观与玩法规则", "填写世界观、阵营、资源体系、回合规则和卡牌在玩法中的职责"],
            ["视觉风格参考", "上传画风、材质、边框或印刷效果参考，标明借鉴范围和版权限制"],
            ["卡牌数据与文案", "填写卡名、类型、费用、属性、技能、稀有度、编号和风味文字"],
            ["阵营与色彩参考", "上传阵营纹样、徽记和色彩样板，确保不同阵营可快速区分"],
            ["印刷规格", "填写成品尺寸、出血、安全区、圆角、色彩模式、纸张和特殊工艺"],
            ["版权禁用项", "上传或列出不可出现的商标、人物、IP 造型和未授权艺术风格"],
            ["套牌清单", "填写卡牌数量、类别分布、稀有度比例、编号区间和交付文件清单"],
        ],
        "game-model": [
            ["主体概念参考图", "上传角色、生物、载具或场景资产的主要概念图，轮廓和结构应可辨认"],
            ["世界观与角色简报", "填写时代、阵营、职业、性格、功能定位、叙事背景和设计关键词"],
            ["服装/装备参考", "上传服装层级、武器、道具、机械模块或建筑构件的结构参考"],
            ["比例与技术规格", "填写身高/尺度、头身比、正交视图要求、目标面数、贴图规格和骨骼限制"],
            ["材质参考", "上传皮肤、织物、金属、木石、磨损和表面处理参考，并说明材质分区"],
            ["动作与姿态", "填写待机、移动、攻击、受击和展示姿态，以及绑定和碰撞需求"],
            ["引擎与预算参考", "上传目标游戏画面或性能基准，填写引擎、平台、LOD 和性能预算"],
            ["版权禁用项", "填写不可使用的 IP、演员肖像、品牌标记、敏感符号和艺术风格边界"],
        ],
        icon: [
            ["品牌视觉参考", "上传 Logo、现有界面、品牌色或图形语言参考，用于统一图标气质"],
            ["图标语义清单", "逐行填写图标名称、功能、用户动作、使用页面和容易混淆的相邻语义"],
            ["风格参考图", "上传线性、填充、双色或拟物参考，标明只借鉴几何规则而非复制图形"],
            ["网格与尺寸规格", "填写基准画板、描边、圆角、光学对齐、安全区和最小显示尺寸"],
            ["色彩与状态参考", "上传默认、悬停、选中、禁用、成功、警告和错误状态颜色"],
            ["目标平台", "填写 Web、iOS、Android、桌面端或游戏 UI，以及导出倍率和格式"],
            ["无障碍参考", "上传高对比或深色主题参考，填写对比度、色盲和非颜色识别要求"],
            ["导出命名规则", "填写文件前缀、语义命名、尺寸后缀、目录结构和 SVG/PNG 交付要求"],
        ],
    };
    return categoryInputs[template.category].slice(0, count).map(([title, purpose], index) => ({ title, purpose, kind: isImageInput(index) ? "image" : "text", required: index === 0 || index === 1 || index === 3 }));
}

function nodeId(template: CanvasWorkflowTemplate, suffix: string) {
    return `${template.id}-${suffix}`;
}

function createInputNode(template: CanvasWorkflowTemplate, input: InputDefinition, index: number): CanvasNodeData {
    const image = input.kind === "image";
    const requirement = input.required ? "必填" : "选填";
    return {
        id: nodeId(template, `input-${index + 1}`),
        type: image ? "image" : "text",
        title: `输入 ${String(index + 1).padStart(2, "0")}｜【${requirement}】${input.title}`,
        position: { x: -1280, y: -280 + index * 500 },
        width: image ? 360 : 420,
        height: image ? 420 : 360,
        metadata: image
            ? { content: "", status: "idle", freeResize: false, prompt: `上传要求（${requirement}）：${input.purpose}` }
            : {
                  content: `【填写模板｜${requirement}】\n用途：${input.purpose}\n\n项目名称：\n品牌/主体：\n本次真实信息：\n必须保留：\n允许调整：\n禁止出现：\n补充说明：\n\n请直接替换以上字段。不得虚构品牌、参数、价格、认证、人物身份、版权或平台权益。`,
                  status: "success",
                  fontSize: 14,
              },
    };
}

function parentIndexes(template: CanvasWorkflowTemplate, stageIndex: number) {
    if (stageIndex === 0) return [];
    const parents = new Set<number>();
    const span = Math.min(stageIndex, 7);
    parents.add(Math.max(0, stageIndex - 1 - ((template.seed + stageIndex * 3) % span)));
    if ((stageIndex + template.seed) % 3 === 0) parents.add(stageIndex - 1);
    if (stageIndex > 5 && (stageIndex * template.seed) % 5 < 2) parents.add((template.seed * 7 + stageIndex * 5) % stageIndex);
    return [...parents].sort((a, b) => a - b);
}

function createGuideNodes(template: CanvasWorkflowTemplate, executableCount: number, inputs: InputDefinition[]): CanvasNodeData[] {
    const inputChecklist = inputs.map((input, index) => `${String(index + 1).padStart(2, "0")}｜${input.required ? "【必填】" : "【选填】"}${input.kind === "image" ? "图片" : "文字"} · ${input.title}\n${input.purpose}`).join("\n\n");
    return [
        {
            id: nodeId(template, "guide"), type: "text", title: `开始这里｜${template.title}输入清单`, position: { x: -1280, y: -1280 }, width: 720, height: 620,
            metadata: { status: "success", fontSize: 14, content: `${template.summary}\n\n输入清单\n\n${inputChecklist}\n\n运行前：替换全部必填输入；按项目情况补充选填输入；逐个检查模型、比例、透明背景、生成数量和积分费用。空白选填图片不会替代真实商品或人物信息。` },
        },
        {
            id: nodeId(template, "manifest"), type: "text", title: "生产地图｜阶段与交付物", position: { x: -500, y: -1280 }, width: 840, height: 500,
            metadata: { status: "success", fontSize: 14, content: `工作流规模：${template.nodeCount} 个节点 · ${executableCount} 个可执行配置节点\n目标平台：${template.platforms.join(" / ")}\n\n输入与约束\n↓\n透明母资产与身份校准\n↓\n专项视觉与文案并行生产\n↓\n平台比例、语言和活动版本适配\n↓\n事实、版权、裁切与质量审计\n↓\n固定输出槽与交付归档\n\n专项重点：${template.focus.join(" · ")}\n目标交付：${template.deliverables.join(" · ")}` },
        },
    ];
}

function createStageNodes(template: CanvasWorkflowTemplate, stage: Stage, index: number, inputIds: string[]) {
    const configId = nodeId(template, `config-${index + 1}`);
    const outputId = nodeId(template, `output-${index + 1}`);
    const column = Math.floor(index / 5);
    const row = index % 5;
    const x = -500 + column * 940;
    const y = -420 + row * 540;
    const selectedInputIndexes = stage.inputIndexes || [(index + template.seed) % inputIds.length];
    const selectedParentIndexes = stage.parentStageIndexes || parentIndexes(template, index);
    const refs = [...new Set([
        ...selectedInputIndexes.map((inputIndex) => inputIds[inputIndex]).filter(Boolean),
        ...selectedParentIndexes.map((parent) => nodeId(template, `output-${parent + 1}`)),
    ])];
    const referenceText = refs.map((id) => `@[node:${id}]`).join("、");
    const transparent = stage.mode === "image" && /透明|母资产|图标|贴纸|卡背/.test(stage.title);
    const config: CanvasNodeData = {
        id: configId,
        type: "config",
        title: `${String(index + 1).padStart(2, "0")}｜${stage.title}`,
        position: { x, y },
        width: 360,
        height: 414,
        metadata: {
            status: "idle",
            generationMode: stage.mode,
            model: stage.mode === "image" ? "gpt-image-2" : "gpt-5.4",
            ...(stage.mode === "image" ? { quality: "low", size: index % 6 === 1 ? "1024x1536" : index % 6 === 4 ? "1536x1024" : "1024x1024", resolution: "1K", count: 1, ...(transparent ? { background: "transparent" } : {}) } : { reasoningEffort: "medium", count: 1 }),
            composerContent: stage.mode === "image"
                ? `为“${template.title}”执行【${stage.title}】。使用 ${referenceText} 作为上游依据，重点解决“${stage.purpose}”。保持主体身份、结构、品牌、包装、人物、材质和事实一致；按 ${template.platforms.join("、")} 的商业发布标准输出专业可用的${template.industry}视觉。保留安全裁切区，不添加未经提供的文字、Logo、认证、价格、人物或版权元素。${transparent ? "输出干净透明背景 PNG，边缘无白边和污染。" : "画面需具备明确视觉层级、真实光影和可用于排版的空间。"}`
                : `为“${template.title}”完成【${stage.title}】。读取 ${referenceText}，围绕“${stage.purpose}”输出结构化中文生产结论。必须区分已验证事实、合理建议和禁止虚构项，并给出面向 ${template.platforms.join("、")} 的具体交付标准、检查项和下一节点可直接使用的内容。`,
            workflowOutputNodeIds: [outputId],
        },
    };
    const outputType: CanvasNodeTypeId = stage.mode === "image" ? "image" : "text";
    const output: CanvasNodeData = {
        id: outputId,
        type: outputType,
        title: `输出 ${String(index + 1).padStart(2, "0")}｜${stage.title}`,
        position: { x: x + 430, y },
        width: stage.mode === "image" ? 360 : 420,
        height: stage.mode === "image" ? 420 : 320,
        metadata: { content: "", status: "idle", ...(stage.mode === "image" ? { freeResize: false } : { fontSize: 14 }), workflowProducerNodeId: configId },
    };
    return { config, output, refs };
}

export function createCanvasProjectFromTemplate(templateOrId: CanvasWorkflowTemplate | string): CanvasProject {
    const template = typeof templateOrId === "string" ? CANVAS_WORKFLOW_TEMPLATES.find((item) => item.id === templateOrId) : templateOrId;
    if (!template) throw new Error(`Unknown canvas workflow template: ${templateOrId}`);
    const inputCount = template.nodeCount === 10 ? 2 : template.nodeCount === 50 ? 4 : template.nodeCount === 80 ? 6 : 8;
    const stageCount = (template.nodeCount - inputCount - 2) / 2;
    const definitions = inputDefinitions(template, inputCount);
    const inputs = definitions.map((input, index) => createInputNode(template, input, index));
    const guides = createGuideNodes(template, stageCount, definitions);
    const stages = stagePlan(template, stageCount).map((stage, index) => createStageNodes(template, stage, index, inputs.map((node) => node.id)));
    const connections: CanvasConnection[] = [];
    stages.forEach(({ config, output, refs }, index) => {
        refs.forEach((fromNodeId, refIndex) => connections.push({ id: nodeId(template, `edge-${index + 1}-${refIndex + 1}`), fromNodeId, toNodeId: config.id }));
        connections.push({ id: nodeId(template, `edge-${index + 1}-output`), fromNodeId: config.id, toNodeId: output.id });
    });
    const now = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        title: `模板｜${template.title}`,
        createdAt: now,
        updatedAt: now,
        nodes: [...guides, ...inputs, ...stages.flatMap(({ config, output }) => [config, output])],
        connections,
        chatSessions: [],
        activeChatId: null,
        backgroundMode: template.seed % 2 ? "lines" : "dots",
        showImageInfo: true,
        viewport: { x: 520, y: 340, k: template.nodeCount === 10 ? 0.24 : template.nodeCount === 100 ? 0.075 : template.nodeCount === 80 ? 0.09 : 0.12 },
    };
}
