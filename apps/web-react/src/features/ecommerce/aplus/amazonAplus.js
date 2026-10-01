/**
 * Amazon A+ 知识库：站点、档位、官方模块尺寸、品类关键词。
 * 详情页出图链路（方向 → 策划 → blueprint）见 detailPage.js。
 */

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
