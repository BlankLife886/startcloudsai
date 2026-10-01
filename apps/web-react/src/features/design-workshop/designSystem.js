import { COMPONENT_STATES, SPEC_OPTIONS } from "./options.js";
import {
  buildContentConsistencyLock,
  buildDeviceAdaptationBlock,
  metricsForDeviceOption,
} from "../../legacy-modules/features/design-workshop/multiDeviceConsistency.js";

export const MOBILE_SYSTEMS = [
  ["ios", "iOS App", "Human Interface · 44pt 触控"],
  ["android", "Android App", "Material 3 · 48dp 触控"],
].map(([id, label, hint]) => ({ id, label, hint }));

export const PHONE_PROFILES = [
  {
    id: "iphone-16",
    system: "ios",
    label: "iPhone 16",
    width: 393,
    height: 852,
    statusBar: 47,
    homeIndicator: 34,
    navBar: 44,
    tabBar: 49,
    note: "Dynamic Island，逻辑点 393×852",
  },
  {
    id: "iphone-16-max",
    system: "ios",
    label: "iPhone 16 Pro Max",
    width: 430,
    height: 932,
    statusBar: 47,
    homeIndicator: 34,
    navBar: 44,
    tabBar: 49,
    note: "大屏 iPhone，逻辑点 430×932",
  },
  {
    id: "iphone-se",
    system: "ios",
    label: "iPhone SE",
    width: 375,
    height: 667,
    statusBar: 20,
    homeIndicator: 0,
    navBar: 44,
    tabBar: 49,
    note: "Home 键机型，无底部手势条",
  },
  {
    id: "android-compact",
    system: "android",
    label: "Android 紧凑 360",
    width: 360,
    height: 800,
    statusBar: 24,
    homeIndicator: 20,
    navBar: 64,
    tabBar: 80,
    note: "常见小屏 Android，360×800",
  },
  {
    id: "android-regular",
    system: "android",
    label: "Android 常规 412",
    width: 412,
    height: 915,
    statusBar: 24,
    homeIndicator: 24,
    navBar: 64,
    tabBar: 80,
    note: "Pixel 级常规屏，412×915",
  },
  {
    id: "android-large",
    system: "android",
    label: "Android 大屏 448",
    width: 448,
    height: 998,
    statusBar: 24,
    homeIndicator: 24,
    navBar: 64,
    tabBar: 80,
    note: "大屏 Android，448×998",
  },
];

const TYPOGRAPHY = {
  neutral: {
    label: "中性无衬线",
    web: "Inter / 系统 UI 无衬线",
    ios: "SF Pro Text / SF Pro Display",
    android: "Roboto / Google Sans",
    miniapp: "微信系统字体 / PingFang SC",
    tv: "系统无衬线，偏大号",
  },
  technical: {
    label: "技术理性",
    web: "IBM Plex Sans / 等宽数字",
    ios: "SF Pro + SF Mono 数字",
    android: "Roboto Flex，数字等宽",
    miniapp: "系统无衬线，数据用等宽数字",
    tv: "几何无衬线 + 大号数字",
  },
  editorial: {
    label: "编辑感",
    web: "标题衬线或高对比无衬线 + 正文无衬线",
    ios: "New York 标题 + SF Pro 正文",
    android: "Serif 标题 + Roboto 正文",
    miniapp: "标题略重，正文保持系统字体",
    tv: "高对比标题，正文更大更疏",
  },
  friendly: {
    label: "亲和圆润",
    web: "圆角无衬线，字重不要过细",
    ios: "SF Pro Rounded 倾向，避免儿童化",
    android: "圆角无衬线，保持 Material 可读性",
    miniapp: "圆润但不卡通，保持微信可读节奏",
    tv: "圆润大字，对比足够",
  },
};

const PLATFORM_CHROME = {
  web: {
    id: "web",
    label: "桌面网页",
    family: "web",
    iconSize: 20,
    tabIcon: 20,
    touch: 32,
    cardRadius: 12,
    forbidden: [
      "不要画浏览器外壳、书签栏或操作系统窗口",
      "不要使用手机底部标签栏或刘海状态栏",
      "可出现 hover / focus，不要做成触控 App 皮肤",
    ],
    chrome: [
      "画布即网页内容区，1440 逻辑宽，12 列",
      "一级导航在顶部或左侧，条目可指向、可悬停",
      "主按钮 36–40px 高，输入框同高",
    ],
  },
  ios: {
    id: "ios",
    label: "iOS App",
    family: "ios",
    iconSize: 24,
    tabIcon: 25,
    touch: 44,
    cardRadius: 12,
    forbidden: [
      "不要画 Android 导航栏、返回箭头材质或 FAB",
      "不要画微信胶囊按钮或小程序原生顶栏",
      "不要用底部手势条以外的虚拟按键",
      "触控目标不得小于 44pt，不要依赖 hover",
    ],
    chrome: [
      "必须画出 iOS 状态栏（时间、信号、电池），高度按机型",
      "导航栏 44pt，大标题可用，返回用 iOS 箭头+文案",
      "若有一级入口：底部 Tab Bar 49pt + Home Indicator",
      "列表行高至少 44pt，分组背景用 iOS 系统灰",
    ],
  },
  android: {
    id: "android",
    label: "Android App",
    family: "android",
    iconSize: 24,
    tabIcon: 24,
    touch: 48,
    cardRadius: 12,
    forbidden: [
      "不要画 iOS 药丸指示条当主导航，除非是手势导航条",
      "不要画微信胶囊或 iOS 大标题堆栈",
      "触控目标不得小于 48dp",
    ],
    chrome: [
      "必须画出 Android 状态栏，高度按机型",
      "顶部使用 Material 3 Top App Bar（常规 64dp）",
      "一级入口用 Navigation Bar 80dp 或 Navigation Rail，不要抄 iOS Tab",
      "主操作可用 FAB，形状遵循 Material 3",
    ],
  },
  miniapp: {
    id: "miniapp",
    label: "微信小程序",
    family: "miniapp",
    iconSize: 22,
    tabIcon: 28,
    touch: 44,
    cardRadius: 8,
    forbidden: [
      "不要画成独立 iOS/Android App 皮肤",
      "不要自造状态栏电池，应使用微信小程序原生顶栏节奏",
      "禁止侧边导航、禁止桌面多栏、禁止浏览器外壳",
      "不要出现微信聊天会话窗口，画面就是小程序页面",
    ],
    chrome: [
      "使用微信小程序原生导航栏：标题居中或左对齐，右侧为胶囊按钮（约 87×32，距右 7、距顶随状态栏）",
      "页面内容从导航栏下方开始，左右页边 16px（32rpx）",
      "若有 tabBar：底部原生 tab，图标约 28px，文案 10px，高度 48px + 安全区",
      "按钮主高度 48px / 次 40px，圆角偏小程序（约 8px），不要 iOS 大圆角卡片堆砌",
    ],
  },
  tablet: {
    id: "tablet",
    label: "平板",
    family: "tablet",
    iconSize: 22,
    tabIcon: 24,
    touch: 40,
    cardRadius: 12,
    forbidden: [
      "不要把手机底部栏原样放大",
      "不要塞满桌面三栏密集表",
    ],
    chrome: [
      "横屏主界面，8 列，可双栏（列表+详情）",
      "导航用顶部或窄侧栏，触控目标 ≥ 40px",
    ],
  },
  tv: {
    id: "tv",
    label: "智能电视",
    family: "tv",
    iconSize: 32,
    tabIcon: 32,
    touch: 64,
    cardRadius: 16,
    forbidden: [
      "不要手机底部标签或桌面密表",
      "不要依赖精细点击",
    ],
    chrome: [
      "10-foot UI：大字、大卡片、明确焦点框",
      "左侧或顶部焦点导航，适合遥控器",
    ],
  },
};

export const DEFAULT_DESIGN_SPEC = {
  audience: "consumer",
  goal: "conversion",
  navigation: "auto",
  density: "balanced",
  typography: "neutral",
  radius: "medium",
  responsive: "adaptive",
  mobileSystem: "ios",
  phoneProfile: "iphone-16",
};

export function getPhoneProfiles(systemId) {
  return PHONE_PROFILES.filter((item) => item.system === systemId);
}

export function getPhoneProfile(profileId, systemId = "ios") {
  return (
    PHONE_PROFILES.find((item) => item.id === profileId) ||
    getPhoneProfiles(systemId)[0] ||
    PHONE_PROFILES[0]
  );
}

export function platformIdForDevice(deviceId, spec = {}) {
  const id = String(deviceId || "web");
  if (id === "miniapp") return "miniapp";
  if (id === "tablet") return "tablet";
  if (id === "tv") return "tv";
  if (id === "phone") return spec.mobileSystem === "android" ? "android" : "ios";
  return "web";
}

function radiusPx(radiusId) {
  return { sharp: 4, medium: 8, soft: 12 }[radiusId] || 8;
}

function targetRatioForViewport(viewport, generationRatio = "") {
  const width = Math.max(1, Number(viewport?.width || 1));
  const height = Math.max(1, Number(viewport?.height || 1));
  const [ratioWidth, ratioHeight] = String(generationRatio || "")
    .split(":")
    .map(Number);
  if (
    ratioWidth > 0 &&
    ratioHeight > 0 &&
    Math.abs(ratioWidth / ratioHeight - width / height) < 0.005
  ) {
    return generationRatio;
  }
  return `${width}:${height}`;
}

function densitySpacing(densityId) {
  return (
    {
      compact: { space: "4 / 8 / 12", stack: 12 },
      balanced: { space: "8 / 12 / 16", stack: 16 },
      comfortable: { space: "12 / 16 / 24", stack: 24 },
    }[densityId] || { space: "8 / 12 / 16", stack: 16 }
  );
}

function typeRoles(platformId, typographyId) {
  const face = TYPOGRAPHY[typographyId] || TYPOGRAPHY.neutral;
  const family = face[platformId] || face.web;
  if (platformId === "ios") {
    return {
      family,
      scale: "17 正文 / 15 次级 / 13 脚注 / 22–34 标题",
      navTitle: 17,
      body: 17,
      caption: 13,
    };
  }
  if (platformId === "android") {
    return {
      family,
      scale: "16 Body / 14 Label / 12 Hint / 22–32 Title",
      navTitle: 22,
      body: 16,
      caption: 12,
    };
  }
  if (platformId === "miniapp") {
    return {
      family,
      scale: "17 正文 / 14 辅助 / 12 说明 / 20 标题（rpx 按 2 倍理解）",
      navTitle: 16,
      body: 17,
      caption: 12,
    };
  }
  if (platformId === "tv") {
    return {
      family,
      scale: "24 正文 / 32 标题 / 40–56 主标题",
      navTitle: 32,
      body: 24,
      caption: 18,
    };
  }
  return {
    family,
    scale: "14 正文 / 12 辅助 / 16–24 标题 / 32 主标题",
    navTitle: 16,
    body: 14,
    caption: 12,
  };
}

export function resolveDesignSystem(device, spec = {}) {
  const next = { ...DEFAULT_DESIGN_SPEC, ...spec };
  const deviceId = device?.id || "web";
  const platformId = platformIdForDevice(deviceId, next);
  const chrome = PLATFORM_CHROME[platformId] || PLATFORM_CHROME.web;
  const profile =
    deviceId === "phone" ? getPhoneProfile(next.phoneProfile, next.mobileSystem) : null;
  const metrics = metricsForDeviceOption(device, {
    densityId: next.density,
    radiusLabel: SPEC_OPTIONS.radius.find(([id]) => id === next.radius)?.[1] || "",
  });
  const radius = radiusPx(next.radius);
  const spacing = densitySpacing(next.density);
  const type = typeRoles(platformId, next.typography);
  const viewport = profile
    ? { width: profile.width, height: profile.height }
    : device?.viewport || { width: 1440, height: 810 };
  const generationRatio = device?.ratio || "";
  const states = Array.isArray(next.states) && next.states.length
    ? next.states
    : ["interaction", "empty", "error"];
  const stateLabels = states
    .map((id) => COMPONENT_STATES.find((item) => item.id === id)?.label || id)
    .join("、");

  const tokens = {
    color: {
      brand: next.brandColor || "",
      scheme: next.colorScheme === "dark" ? "dark" : "light",
    },
    space: {
      scale: spacing.space,
      stack: spacing.stack,
      margin: metrics.margin,
      gutter: metrics.gutter,
    },
    type,
    radius: {
      control: radius,
      card: chrome.cardRadius,
    },
    control: {
      height: metrics.controlHeight,
      touch: chrome.touch,
      icon: chrome.iconSize,
      tabIcon: chrome.tabIcon,
    },
    layout: {
      columns: metrics.columns,
      navigation: next.navigation,
    },
  };

  const chromeLines = profile
    ? [
        `机型：${profile.label}（${profile.width}×${profile.height}）${profile.note ? `，${profile.note}` : ""}`,
        `状态栏 ${profile.statusBar}px · 导航栏 ${profile.navBar}px · 标签栏 ${profile.tabBar}px · 底部安全区 ${profile.homeIndicator}px`,
        ...chrome.chrome,
      ]
    : chrome.chrome;

  return {
    deviceId,
    deviceLabel: device?.label || "",
    ratio: targetRatioForViewport(viewport, generationRatio),
    generationRatio,
    platformId,
    platformLabel: chrome.label,
    profile,
    viewport,
    tokens,
    chrome: profile
      ? {
          statusBar: profile.statusBar,
          navBar: profile.navBar,
          tabBar: profile.tabBar,
          homeIndicator: profile.homeIndicator,
        }
      : null,
    states,
    stateLabels,
    audience:
      SPEC_OPTIONS.audience.find(([id]) => id === next.audience)?.[1] || next.audience,
    goal: SPEC_OPTIONS.goal.find(([id]) => id === next.goal)?.[1] || next.goal,
    navigation:
      SPEC_OPTIONS.navigation.find(([id]) => id === next.navigation)?.[1] ||
      next.navigation,
    density:
      SPEC_OPTIONS.density.find(([id]) => id === next.density)?.[1] || next.density,
    typography: type.family,
    typographyLabel:
      SPEC_OPTIONS.typography.find(([id]) => id === next.typography)?.[1] ||
      next.typography,
    radiusLabel:
      SPEC_OPTIONS.radius.find(([id]) => id === next.radius)?.[1] || `${radius}px`,
    responsive:
      SPEC_OPTIONS.responsive.find(([id]) => id === next.responsive)?.[1] ||
      next.responsive,
    chromeLines,
    forbidden: chrome.forbidden,
    metrics,
  };
}

export function buildDesignSystemPromptBlock(system) {
  const generationRatioNote =
    system.generationRatio && system.generationRatio !== system.ratio
      ? `；模型请求采用最接近的 ${system.generationRatio}，关键内容必须留在目标画板安全区内`
      : "";
  return [
    `设计系统（必须遵守，不要只当装饰）：${system.platformLabel}${system.profile ? ` · ${system.profile.label}` : ""}。`,
    `画板：${system.viewport.width}×${system.viewport.height}，目标比例 ${system.ratio}${generationRatioNote}，${system.tokens.layout.columns} 列，边距 ${system.tokens.space.margin}px，列距 ${system.tokens.space.gutter}px。`,
    `字体：${system.typography}。字号阶梯：${system.tokens.type.scale}。`,
    `间距阶梯：${system.tokens.space.scale}，模块堆叠约 ${system.tokens.space.stack}px。`,
    `控件：高 ${system.tokens.control.height}px，最小点击 ${system.tokens.control.touch}px，图标 ${system.tokens.control.icon}px，导航图标 ${system.tokens.control.tabIcon}px，控件圆角 ${system.tokens.radius.control}px，卡片圆角 ${system.tokens.radius.card}px。`,
    `导航：${system.navigation}。目标用户：${system.audience}。页面目标：${system.goal}。响应：${system.responsive}。`,
    `必须定义的组件状态：${system.stateLabels}。主画面只呈现当前流程合理的状态，空、错误、加载等互斥状态不要同时堆进一张界面。`,
    `平台壳层：${system.chromeLines.join("；")}。`,
    `禁止：${system.forbidden.join("；")}。`,
  ].join("\n");
}

export function buildDesignSystemPrompt({
  device,
  spec,
  brief,
  pageType,
  pageTypeId,
  customPageType,
  visualStyle,
  brandColor,
  colorScheme,
  references = [],
  isIteration = false,
  iterationBrief = "",
  selectedDeviceLabels = [],
  isAnchor = false,
} = {}) {
  if (isIteration) {
    const system = resolveDesignSystem(device, spec);
    return [
      "任务类型：基于参考图的受控 UI 迭代，不是重新设计整张页面。",
      `本次唯一修改：${String(iterationBrief || "").trim() || "保持当前设计，仅提升文字和边缘清晰度"}。`,
      "锁定规则：除上述修改外，原图的画布比例、页面结构、组件位置与尺寸、间距、圆角、颜色、图标、平台壳层和装饰必须保持不变，不要新增、删除或移动任何元素。",
      `输出要求：${device?.label || ""} 目标画板 ${system.viewport.width}×${system.viewport.height}（${system.ratio}），正视图，整张图就是设计稿本身，不要样机、透视、倾斜、拼贴或设计软件界面。`,
    ].join("\n");
  }

  const nextSpec = {
    ...DEFAULT_DESIGN_SPEC,
    ...spec,
    brandColor,
    colorScheme,
  };
  const system = resolveDesignSystem(device, nextSpec);
  const pagePrompt =
    pageTypeId === "custom"
      ? String(customPageType || "").trim()
      : pageType?.prompt;
  const multiDevice = selectedDeviceLabels.length > 1;
  const lines = [
    references.length
      ? `基于提供的 ${references.length} 张参考界面进行重新设计：${String(brief || "").trim() || "在保持信息结构与视觉系统的前提下提升视觉质量"}。`
      : `为「${String(brief || "").trim() || "一款现代数字产品"}」设计一张高保真 UI 设计稿。`,
    buildDeviceAdaptationBlock(device, {
      navigationId: nextSpec.navigation,
      pageTypeId,
      pagePrompt,
      multiDevice,
      isAnchor,
    }),
    `视觉风格：${visualStyle?.prompt || visualStyle?.label || ""}。`,
    `配色规范：品牌主色 ${brandColor}，${colorScheme === "dark" ? "深色" : "浅色"}模式。品牌色用于主按钮、关键链接和选中态，不要整页铺满。`,
    buildDesignSystemPromptBlock(system),
  ];
  if (multiDevice) {
    lines.push(
      buildContentConsistencyLock({
        brief,
        pageTypeLabel: pageType?.label,
        deviceLabels: selectedDeviceLabels,
        brandColor,
      }),
    );
  }
  lines.push(
    "整张图就是该端设计稿本身，铺满画布；不要设备木质/塑料样机外壳、透视、多页拼贴、设计软件窗口或水印。",
  );
  return lines.join("\n");
}

export function buildCodexHandoff({
  brief,
  pageType,
  visualStyle,
  system,
  prompt,
  imageUrl = "",
  sourceSize,
  elements = [],
} = {}) {
  const normalizeSourceDimension = (value) => {
    const dimension = Number(value);
    return Number.isFinite(dimension) && dimension > 0
      ? Math.round(dimension)
      : 0;
  };
  const source = {
    width: normalizeSourceDimension(sourceSize?.width),
    height: normalizeSourceDimension(sourceSize?.height),
  };
  const usedElementFiles = new Map();
  const normalizedElements = elements.map((node) => {
    const base = slugFileName(node.name || node.type || node.id);
    const count = (usedElementFiles.get(base) || 0) + 1;
    usedElementFiles.set(base, count);
    return {
      id: node.id,
      name: node.name || node.type,
      type: node.type,
      text: node.text || "",
      x: Math.round(node.x),
      y: Math.round(node.y),
      width: Math.round(node.width),
      height: Math.round(node.height),
      file: `elements/${base}${count > 1 ? `-${count}` : ""}.png`,
    };
  });
  return {
    kind: "starclouds-ui-design-system",
    version: 2,
    product: String(brief || "").trim(),
    page: {
      type: pageType?.id || "",
      label: pageType?.label || "",
    },
    style: {
      id: visualStyle?.id || "",
      label: visualStyle?.label || "",
    },
    platform: {
      id: system.platformId,
      label: system.platformLabel,
      deviceId: system.deviceId,
      deviceLabel: system.deviceLabel,
      profile: system.profile
        ? {
            id: system.profile.id,
            label: system.profile.label,
            note: system.profile.note,
          }
        : null,
    },
    viewport: system.viewport,
    coordinateSpace: "source-image-pixels",
    source,
    ratio: system.ratio,
    generationRatio: system.generationRatio,
    chrome: system.chrome,
    tokens: system.tokens,
    audience: system.audience,
    goal: system.goal,
    navigation: system.navigation,
    density: system.density,
    typography: system.typography,
    radius: system.radiusLabel,
    responsive: system.responsive,
    states: system.states,
    constraints: system.forbidden,
    chromeLines: system.chromeLines,
    imageUrl,
    files: {
      manifest: "design-system.json",
      artboard: "design.png",
      tokens: "tokens.css",
      instructions: "README.md",
    },
    elements: normalizedElements,
    prompt,
  };
}

export function buildDesignTokensCss(system) {
  const token = system?.tokens || {};
  const type = token.type || {};
  const space = token.space || {};
  const radius = token.radius || {};
  const control = token.control || {};
  const layout = token.layout || {};
  const lines = [
    ":root {",
    `  --color-brand: ${token.color?.brand || "#2563eb"};`,
    `  --space-page-margin: ${Number(space.margin || 0)}px;`,
    `  --space-grid-gutter: ${Number(space.gutter || 0)}px;`,
    `  --space-section: ${Number(space.stack || 0)}px;`,
    `  --radius-control: ${Number(radius.control || 0)}px;`,
    `  --radius-card: ${Number(radius.card || 0)}px;`,
    `  --control-height: ${Number(control.height || 0)}px;`,
    `  --touch-target: ${Number(control.touch || 0)}px;`,
    `  --icon-size: ${Number(control.icon || 0)}px;`,
    `  --font-body: ${Number(type.body || 14)}px;`,
    `  --font-caption: ${Number(type.caption || 12)}px;`,
    `  --layout-columns: ${Number(layout.columns || 1)};`,
    "}",
  ];
  return lines.join("\n");
}

export function buildDesignHandoffMarkdown(handoff = {}) {
  const platform = handoff.platform?.label || "目标平台";
  const viewport = handoff.viewport || {};
  const source = handoff.source || {};
  return [
    "# UI design handoff",
    "",
    `- Platform: ${platform}`,
    `- Viewport: ${viewport.width || 0} x ${viewport.height || 0}`,
    `- Target ratio: ${handoff.ratio || "unknown"}`,
    `- Generation request ratio: ${handoff.generationRatio || handoff.ratio || "unknown"}`,
    `- Source image: ${source.width || 0} x ${source.height || 0} px`,
    `- Element coordinates: ${handoff.coordinateSpace || "source-image-pixels"} (origin: top-left)`,
    `- Manifest: ${handoff.files?.manifest || "design-system.json"}`,
    `- Artboard: ${handoff.files?.artboard || "design.png"}`,
    `- Tokens: ${handoff.files?.tokens || "tokens.css"}`,
    `- Elements: ${handoff.elements?.length || 0}`,
    "",
    "Use design-system.json as the machine-readable source of truth. Element x, y, width, and height values are measured in source-image pixels against design.png, not in logical viewport units. Match the artboard, platform chrome, tokens, states, and element bounds before adding implementation-specific behavior.",
  ].join("\n");
}

export function slugFileName(value) {
  const text = String(value || "element")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return text || "element";
}

export function cropElementFromImage(image, node, sourceSize) {
  const basisWidth = Math.max(1, Number(sourceSize?.width || image.naturalWidth || 1));
  const basisHeight = Math.max(1, Number(sourceSize?.height || image.naturalHeight || 1));
  const scaleX = image.naturalWidth / basisWidth;
  const scaleY = image.naturalHeight / basisHeight;
  const x = Math.max(0, Math.round(Number(node.x || 0) * scaleX));
  const y = Math.max(0, Math.round(Number(node.y || 0) * scaleY));
  const width = Math.max(1, Math.round(Number(node.width || 0) * scaleX));
  const height = Math.max(1, Math.round(Number(node.height || 0) * scaleY));
  const maxW = image.naturalWidth - x;
  const maxH = image.naturalHeight - y;
  const cropW = Math.max(1, Math.min(width, maxW));
  const cropH = Math.max(1, Math.min(height, maxH));
  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法裁切元素");
  context.drawImage(image, x, y, cropW, cropH, 0, 0, cropW, cropH);
  return canvas;
}

export function downloadBlobFile(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

export function summarizeDesignSystem(system) {
  if (system.profile?.label) return system.profile.label;
  return system.platformLabel;
}
