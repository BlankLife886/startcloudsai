/** Amazon A+ / 国内详情：站点、官方模块尺寸、品类知识库、PEPCF 结构。 */

export const APLUS_TIERS = [
  { id: "basic", label: "基础版", maxModules: 5, hint: "Standard A+，最多 5 个模块" },
  { id: "premium", label: "Premium", maxModules: 7, hint: "含 Banner / 热点，最多 7 个模块" },
];

export const APLUS_MARKETPLACES = [
  {
    id: "US",
    label: "Amazon US",
    site: "amazon.com",
    region: "international",
    language: "英文",
    languageCode: "en-US",
    localeName: "United States",
    units: "W / lm / K, E26, inch / lb",
    imageStyle:
      "lifestyle interior photography, natural window light, credible home or kitchen scene, product is the hero, no watermark",
    copyStyle: "benefit-first English, mobile-first, no superlatives or prices",
  },
  {
    id: "UK",
    label: "Amazon UK",
    site: "amazon.co.uk",
    region: "international",
    language: "英文",
    languageCode: "en-GB",
    localeName: "United Kingdom",
    units: "W / lm / K, BS 1363, metric",
    imageStyle:
      "British home lifestyle photography, warm natural light, product hero, no watermark",
    copyStyle: "British English, concise, no prices or unsubstantiated claims",
  },
  {
    id: "DE",
    label: "Amazon DE",
    site: "amazon.de",
    region: "international",
    language: "德文",
    languageCode: "de-DE",
    localeName: "Deutschland",
    units: "W / lm / K, E27, metric, CE",
    imageStyle:
      "clean European lifestyle photography, product hero, no watermark",
    copyStyle: "German, factual, CE-aware, no prices",
  },
  {
    id: "JP",
    label: "Amazon JP",
    site: "amazon.co.jp",
    region: "international",
    language: "日文",
    languageCode: "ja-JP",
    localeName: "日本",
    units: "W / lm / K, 100V, metric, PSE",
    imageStyle: "tidy Japanese interior product photography, no watermark",
    copyStyle: "Japanese, polite and specific, no prices",
  },
  {
    id: "CN",
    label: "国内站 / 中国详情",
    site: "amazon.cn",
    region: "domestic",
    language: "简体中文",
    languageCode: "zh-CN",
    localeName: "中国大陆",
    units: "流明 / 瓦数 / 色温，E27，GB 国标",
    imageStyle:
      "studio product photography with dimension callouts, real-shot texture, white or light grey sweep, no watermark, Chinese labels only when provided",
    copyStyle: "简体中文，参数服从国标，不写价格、不写极限词",
  },
];

export const APLUS_MODULE_TYPES = [
  {
    id: "std-header",
    amazonName: "Standard Header Image",
    pepcf: "Problem",
    width: 970,
    height: 600,
    premium: false,
    headlineMax: 160,
    bodyMax: 1000,
  },
  {
    id: "std-overlay-light",
    amazonName: "Standard Image & Light Text Overlay",
    pepcf: "Explain",
    width: 970,
    height: 300,
    premium: false,
    headlineMax: 150,
    bodyMax: 500,
  },
  {
    id: "std-four-image",
    amazonName: "Standard Four Image & Text",
    pepcf: "Explain",
    width: 970,
    height: 600,
    premium: false,
    headlineMax: 80,
    bodyMax: 400,
  },
  {
    id: "std-compare",
    amazonName: "Standard Comparison Chart",
    pepcf: "Compare",
    width: 970,
    height: 600,
    premium: false,
    headlineMax: 120,
    bodyMax: 800,
  },
  {
    id: "std-specs",
    amazonName: "Standard Technical Specifications",
    pepcf: "Proof",
    width: 970,
    height: 600,
    premium: false,
    headlineMax: 80,
    bodyMax: 900,
  },
  {
    id: "std-highlights",
    amazonName: "Standard Single Image Highlights",
    pepcf: "Proof",
    width: 970,
    height: 600,
    premium: false,
    headlineMax: 150,
    bodyMax: 600,
  },
  {
    id: "std-overlay-dark",
    amazonName: "Standard Image & Dark Text Overlay",
    pepcf: "Finish",
    width: 970,
    height: 300,
    premium: false,
    headlineMax: 150,
    bodyMax: 500,
  },
  {
    id: "premium-banner",
    amazonName: "Premium Banner",
    pepcf: "Problem",
    width: 1464,
    height: 600,
    premium: true,
    headlineMax: 160,
    bodyMax: 400,
  },
  {
    id: "premium-hotspots",
    amazonName: "Premium Hotspots",
    pepcf: "Proof",
    width: 1464,
    height: 600,
    premium: true,
    headlineMax: 120,
    bodyMax: 400,
  },
  {
    id: "premium-three",
    amazonName: "Premium Three Images & Text",
    pepcf: "Explain",
    width: 1464,
    height: 600,
    premium: true,
    headlineMax: 80,
    bodyMax: 500,
  },
];

const ARCHETYPES = {
  spec: {
    basic: ["std-header", "std-overlay-light", "std-compare", "std-specs", "std-overlay-dark"],
    premium: [
      "premium-banner",
      "std-overlay-light",
      "std-compare",
      "std-specs",
      "premium-hotspots",
      "std-highlights",
      "std-overlay-dark",
    ],
  },
  lifestyle: {
    basic: ["std-header", "std-four-image", "std-overlay-light", "std-highlights", "std-overlay-dark"],
    premium: [
      "premium-banner",
      "std-four-image",
      "premium-three",
      "std-compare",
      "premium-hotspots",
      "std-highlights",
      "std-overlay-dark",
    ],
  },
  beauty: {
    basic: ["std-header", "std-overlay-light", "std-highlights", "std-four-image", "std-overlay-dark"],
    premium: [
      "premium-banner",
      "std-overlay-light",
      "std-four-image",
      "std-compare",
      "premium-hotspots",
      "std-highlights",
      "std-overlay-dark",
    ],
  },
};

function cat(id, label, aliases, archetype, extra = {}) {
  return {
    id,
    label,
    aliases,
    archetype,
    painPoints: extra.painPoints || [],
    keywords: extra.keywords || [],
    compareAxes: extra.compareAxes || [],
    units: extra.units || {},
  };
}

export const APLUS_CATEGORIES = [
  cat("led-bulb", "灯泡 / 照明", ["灯泡", "灯珠", "LED", "lamp", "bulb"], "spec", {
    painPoints: ["够亮吗", "刺眼吗", "接口兼不兼容", "寿命多久", "费电吗"],
    keywords: ["流明", "色温", "显色指数", "省电"],
    compareAxes: ["功率", "流明", "色温", "寿命", "接口"],
    units: { US: "E26, 2700–5000K, lm", CN: "E27, GB, 流明/瓦数/色温" },
  }),
  cat("electronics-3c", "3C 数码", ["3C", "数码", "电子"], "spec", {
    painPoints: ["兼容性", "续航", "发热", "接口", "真假参数"],
    keywords: ["快充", "协议", "接口"],
    compareAxes: ["功率", "接口", "协议", "体积"],
  }),
  cat("headphones", "耳机", ["耳机", "耳麦", "earbuds"], "spec", {
    painPoints: ["降噪", "延迟", "佩戴舒适", "续航", "通话"],
    keywords: ["ANC", "低延迟", "通透"],
    compareAxes: ["续航", "驱动单元", "编码", "重量"],
  }),
  cat("phone-accessories", "手机配件", ["壳", "膜", "支架"], "spec"),
  cat("laptop", "电脑 / 配件", ["笔记本", "电脑"], "spec"),
  cat("camera", "影像器材", ["相机", "镜头"], "spec"),
  cat("smart-home", "智能家居", ["智能", "WiFi", "Zigbee"], "spec", {
    painPoints: ["联网稳定", "语音助手", "安装"],
    compareAxes: ["协议", "功率", "APP"],
  }),
  cat("kitchen-appliance", "厨房小电", ["空气炸锅", "破壁机", "电饭煲"], "lifestyle", {
    painPoints: ["清洗", "噪音", "容量", "安全"],
    compareAxes: ["容量", "功率", "涂层"],
  }),
  cat("cookware", "锅具厨具", ["不粘锅", "刀具"], "lifestyle"),
  cat("home-storage", "收纳家居", ["收纳", "置物"], "lifestyle"),
  cat("furniture", "家具", ["桌", "椅", "柜"], "lifestyle", {
    painPoints: ["尺寸对不对", "承重", "安装", "气味"],
    compareAxes: ["尺寸", "材质", "承重"],
  }),
  cat("bedding", "床品", ["四件套", "枕头"], "lifestyle"),
  cat("bath", "卫浴", ["花洒", "马桶"], "lifestyle"),
  cat("lighting-decor", "灯饰", ["吊灯", "台灯"], "lifestyle"),
  cat("beauty-skincare", "美妆护肤", ["精华", "面霜", "护肤"], "beauty", {
    painPoints: ["成分刺激", "吸收", "适用肤质"],
    compareAxes: ["成分", "质地", "容量"],
  }),
  cat("haircare", "个护美发", ["洗发水", "吹风机"], "beauty"),
  cat("makeup", "彩妆", ["口红", "粉底"], "beauty"),
  cat("fashion-women", "女装", ["连衣裙", "上衣"], "lifestyle"),
  cat("fashion-men", "男装", ["衬衫", "T恤"], "lifestyle"),
  cat("shoes", "鞋靴", ["运动鞋", "皮鞋"], "lifestyle", {
    painPoints: ["尺码", "脚感", "耐磨"],
    compareAxes: ["尺码", "鞋底", "重量"],
  }),
  cat("bags", "箱包", ["双肩包", "行李箱"], "lifestyle"),
  cat("jewelry", "珠宝饰品", ["项链", "耳环"], "lifestyle"),
  cat("watch", "腕表", ["手表", "智能手表"], "spec"),
  cat("sports", "运动户外", ["冲锋衣", "登山"], "lifestyle"),
  cat("fitness", "健身器材", ["哑铃", "瑜伽"], "spec"),
  cat("baby", "母婴", ["奶瓶", "纸尿裤"], "lifestyle", {
    painPoints: ["安全认证", "材质", "适用月龄"],
    compareAxes: ["材质", "认证", "容量"],
  }),
  cat("toys", "玩具", ["积木", "益智"], "lifestyle"),
  cat("pet", "宠物", ["猫粮", "狗窝"], "lifestyle"),
  cat("auto", "汽车配件", ["行车记录仪", "车载"], "spec"),
  cat("tools", "五金工具", ["电钻", "扳手"], "spec"),
  cat("garden", "园艺", ["花盆", "浇水"], "lifestyle"),
  cat("office", "办公文具", ["笔记本", "台灯办公"], "lifestyle"),
  cat("food-supplement", "食品保健", ["维生素", "蛋白粉"], "beauty"),
  cat("medical", "医疗健康", ["血压计", "按摩"], "spec"),
  cat("outdoor-camp", "露营", ["帐篷", "睡袋"], "lifestyle"),
  cat("travel", "出行旅行", ["颈枕", "转换插头"], "lifestyle"),
  cat("cleaning", "清洁用品", ["拖把", "清洁剂"], "lifestyle"),
  cat("laundry", "洗护", ["洗衣液", "留香珠"], "beauty"),
  cat("beverage", "杯壶饮水", ["保温杯", "水杯"], "lifestyle"),
  cat("home-textile", "家纺", ["毛巾", "地毯家纺"], "lifestyle"),
  cat("wall-art", "装饰画", ["挂画"], "lifestyle"),
  cat("rug", "地毯", ["地垫"], "lifestyle"),
  cat("curtain", "窗帘", ["遮光"], "lifestyle"),
  cat("vacuum", "吸尘器", ["扫地机"], "spec"),
  cat("air-purifier", "净化器", ["空净", "HEPA"], "spec"),
  cat("humidifier", "加湿 / 除湿", ["加湿器"], "spec"),
  cat("power-bank", "移动电源", ["充电宝"], "spec"),
  cat("charger", "充电器", ["氮化镓", "GaN"], "spec"),
  cat("cable", "线材", ["数据线", "充电线"], "spec"),
  cat("keyboard-mouse", "键鼠", ["机械键盘"], "spec"),
  cat("monitor", "显示器", ["屏幕"], "spec"),
  cat("printer", "打印", ["打印机"], "spec"),
  cat("generic", "通用 / 其他", ["其他", "通用"], "lifestyle", {
    painPoints: ["是什么", "怎么用", "和竞品差在哪", "值不值得信"],
    compareAxes: ["核心功能", "材质", "规格"],
  }),
];

const RATIO_CANDIDATES = [
  [1, 1],
  [3, 2],
  [16, 9],
  [21, 9],
  [4, 3],
  [4, 5],
  [3, 4],
  [2, 3],
];

export function aplusMarketplaceById(id) {
  const key = String(id || "").trim();
  return (
    APLUS_MARKETPLACES.find((item) => item.id === key) ||
    APLUS_MARKETPLACES.find((item) => item.language === key) ||
    APLUS_MARKETPLACES[0]
  );
}

export function aplusCategoryById(id) {
  const key = String(id || "").trim().toLowerCase();
  return (
    APLUS_CATEGORIES.find((item) => item.id === key) ||
    APLUS_CATEGORIES.find((item) =>
      [item.label, ...(item.aliases || [])].some(
        (alias) => String(alias).toLowerCase() === key,
      ),
    ) ||
    APLUS_CATEGORIES.find((item) =>
      [item.label, ...(item.aliases || [])].some((alias) =>
        key.includes(String(alias).toLowerCase()),
      ),
    ) ||
    APLUS_CATEGORIES.find((item) => item.id === "generic")
  );
}

export function searchAplusCategories(query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return APLUS_CATEGORIES;
  return APLUS_CATEGORIES.filter((item) =>
    [item.id, item.label, ...(item.aliases || [])]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

export function aplusModuleTypeById(id) {
  return APLUS_MODULE_TYPES.find((item) => item.id === id) || APLUS_MODULE_TYPES[0];
}

export function aplusAspectRatio(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const target = w / h;
  let best = RATIO_CANDIDATES[0];
  let bestDelta = Infinity;
  for (const pair of RATIO_CANDIDATES) {
    const delta = Math.abs(pair[0] / pair[1] - target);
    if (delta < bestDelta) {
      best = pair;
      bestDelta = delta;
    }
  }
  return `${best[0]}:${best[1]}`;
}

export function aplusTierById(id) {
  return APLUS_TIERS.find((item) => item.id === id) || APLUS_TIERS[0];
}

export function inferAplusMarketplace({ platform = "", market = "", language = "" } = {}) {
  const blob = `${platform} ${market} ${language}`.toLowerCase();
  if (/中国|国内|cn|简体/.test(blob)) return aplusMarketplaceById("CN");
  if (/德国|de\b|德文/.test(blob)) return aplusMarketplaceById("DE");
  if (/英国|uk\b/.test(blob)) return aplusMarketplaceById("UK");
  if (/日本|jp\b|日文/.test(blob)) return aplusMarketplaceById("JP");
  return aplusMarketplaceById("US");
}

function moduleCopy(type, category, marketplace, index, productName) {
  const domestic = marketplace.region === "domestic";
  const name = productName || category.label;
  const pain = category.painPoints[index] || category.painPoints[0] || "核心使用问题";
  if (domestic) {
    const headlines = {
      Problem: `${name}，先解决「${pain}」`,
      Explain: "真实使用方式，一眼看懂",
      Compare: "和常见方案差在哪",
      Proof: "可核对的参数与细节",
      Finish: "包装、质保与安心购买",
    };
    return {
      headline: headlines[type.pepcf] || name,
      body: `${category.label}模块：只陈述参考图和卖点里已提供的事实，单位使用${marketplace.units}，不写价格。`,
    };
  }
  const headlines = {
    Problem: `Does it actually solve “${pain}”?`,
    Explain: "See how it works in real life",
    Compare: "How it differs from typical options",
    Proof: "Specs you can verify",
    Finish: "What you receive and how we stand behind it",
  };
  return {
    headline: headlines[type.pepcf] || name,
    body: `Category ${category.label}: only state facts from the product images and seller notes. Use ${marketplace.units}. No prices, no superlatives.`,
  };
}

export function buildDefaultAplusPlan({
  categoryId = "generic",
  marketplaceId = "US",
  tierId = "basic",
  productName = "",
  sellingPoints = "",
  asin = "",
  competitorAsin = "",
  disclosure = false,
  selectedModules = [],
} = {}) {
  const category = aplusCategoryById(categoryId);
  const marketplace = aplusMarketplaceById(marketplaceId);
  const tier = aplusTierById(tierId);
  const sequence = (ARCHETYPES[category.archetype] || ARCHETYPES.lifestyle)[tier.id];
  const modules = sequence.slice(0, tier.maxModules).map((typeId, index) => {
    const type = aplusModuleTypeById(typeId);
    const copy = moduleCopy(type, category, marketplace, index, productName);
    const imagePrompt = [
      `Create a ${type.width}x${type.height} RGB Amazon A+ module (${type.amazonName}).`,
      marketplace.imageStyle,
      `Product identity must match the reference photos. Category: ${category.label}.`,
      `PEPCF role: ${type.pepcf}. Headline to render clearly: “${copy.headline}”.`,
      sellingPoints ? `Seller notes: ${sellingPoints}` : "",
      marketplace.region === "domestic"
        ? "Domestic style: studio real-shot product, dimension/spec callouts, Simplified Chinese only if provided, GB units."
        : "International style: lifestyle scene, local language overlay only from provided copy.",
      "No watermark, no GIF, no HTML, no QR, no price, no unsubstantiated #1/best/guaranteed claims.",
      "Mobile-readable type, high contrast, product sharp and unwarped.",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: `${type.id}-${index + 1}`,
      typeId: type.id,
      amazonName: type.amazonName,
      pepcf: type.pepcf,
      width: type.width,
      height: type.height,
      outputSize: `${type.width}x${type.height}`,
      aspectRatio: aplusAspectRatio(type.width, type.height),
      headline: copy.headline,
      body: copy.body,
      imagePrompt,
      visualHints: selectedModules,
    };
  });
  return {
    asin: String(asin || "").trim().toUpperCase(),
    competitorAsin: String(competitorAsin || "").trim().toUpperCase(),
    categoryId: category.id,
    categoryLabel: category.label,
    marketplaceId: marketplace.id,
    language: marketplace.language,
    languageCode: marketplace.languageCode,
    tier: tier.id,
    disclosure: Boolean(disclosure),
    painPoints: category.painPoints.slice(0, 6),
    pepcf: modules.map((item) => item.pepcf),
    compliance: {
      languageMatched: true,
      noHtml: true,
      noGif: true,
      noPrice: true,
      disclosureRequired: true,
      disclosureAcknowledged: Boolean(disclosure),
    },
    modules,
  };
}

export function aplusShotBlueprintsFromPlan(plan) {
  return (plan?.modules || []).map((module, index) => ({
    id: module.id || `aplus-${index + 1}`,
    label: module.amazonName || `A+ 模块 ${index + 1}`,
    direction: [
      `亚马逊模块 ${module.amazonName}，精确输出 ${module.outputSize || `${module.width}x${module.height}`} RGB。`,
      `PEPCF：${module.pepcf}。标题：${module.headline || ""}。`,
      module.body || "",
      module.imagePrompt || "",
    ]
      .filter(Boolean)
      .join(" "),
    aspectRatio: module.aspectRatio || aplusAspectRatio(module.width, module.height),
    outputSize: module.outputSize || `${module.width}x${module.height}`,
    aplusSpec: module,
  }));
}

export function parseAplusAsinList(raw = "") {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[\s,;，；]+/)
        .map((item) => item.trim().toUpperCase())
        .filter((item) => /^[A-Z0-9]{8,12}$/.test(item)),
    ),
  ).slice(0, 100);
}

export function aplusExportChecklist(plan, rows = []) {
  const modules = plan?.modules || [];
  return modules.map((module, index) => {
    const row = rows[index];
    return {
      index: index + 1,
      asin: plan.asin || "",
      marketplace: plan.marketplaceId,
      amazonModule: module.amazonName,
      pepcf: module.pepcf,
      size: module.outputSize || `${module.width}x${module.height}`,
      headline: module.headline || "",
      body: module.body || "",
      imageReady: Boolean(row?.url),
      sellerCentralNote:
        "Upload this RGB image into the matching A+ module. Mark AI-generated content Disclosure in Seller Central. Do not add HTML, GIF, prices or off-Amazon links.",
    };
  });
}

export function aplusChecklistCsv(rows = []) {
  const header = [
    "index",
    "asin",
    "marketplace",
    "amazon_module",
    "pepcf",
    "size",
    "headline",
    "body",
    "seller_central_note",
  ];
  const escape = (value) => `"${String(value || "").replace(/"/g, '""')}"`;
  const valueOf = (row, key) => {
    if (key === "amazon_module") return row.amazonModule;
    if (key === "seller_central_note") return row.sellerCentralNote;
    return row[key];
  };
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => escape(valueOf(row, key))).join(",")),
  ].join("\n");
}

export function buildAplusTaskPrompt({
  plan,
  marketplace,
  category,
  productName,
  sellingPoints,
  tone,
} = {}) {
  const market = marketplace || aplusMarketplaceById(plan?.marketplaceId);
  const catItem = category || aplusCategoryById(plan?.categoryId);
  return [
    "任务：亚马逊 A+ / 详情模块出图。每个模块是一张独立 RGB 图，不是整页长图截图，不是编辑器界面。",
    `目标站：${market.label}（${market.site}）。语言必须是${market.language}。单位：${market.units}。`,
    `品类：${catItem.label}。画面风格：${market.imageStyle}。`,
    productName ? `商品名称：${productName}。` : "",
    sellingPoints ? `已确认卖点：${sellingPoints}。` : "",
    plan?.asin ? `本商品 ASIN：${plan.asin}。` : "",
    plan?.competitorAsin
      ? `竞品 ASIN ${plan.competitorAsin} 只用于模块顺序与卖点结构参考，禁止复制其品牌、商标或原文案。`
      : "",
    tone ? `视觉风格：${tone}。` : "",
    "合规：无水印、无 GIF、无 HTML、无外链、无价格、无未证实的极限词；文字无法可靠生成时留白。",
    "2026 Disclosure：画面不要自行加 AI 标记；卖家须在 Seller Central 手动勾选 AI 图 Disclosure。",
    "严格保持参考商品造型、颜色、比例、Logo 与包装文字。不得虚构认证、参数或效果。",
  ]
    .filter(Boolean)
    .join("\n");
}
