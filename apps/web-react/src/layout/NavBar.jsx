import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useLocation, useNavigate, useNavigation } from "react-router";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import { LocaleSwitcher } from "./LocaleSwitcher.jsx";
import { ThemeSwitch } from "./ThemeSwitch.jsx";
import { TrialAccessDialog } from "../components/TrialAccessDialog.jsx";
import { RedeemCodeDialog } from "../components/RedeemCodeDialog.jsx";
import { LogoutDialog } from "../components/LogoutDialog.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import {
  getWallet,
  getSubscription,
  listNotifications,
  markNotificationsRead,
} from "@react/legacy-modules/services/meApi.js";
import { logoutAccount } from "@react/legacy-modules/services/auth.js";
import { getTrialAccessCampaign } from "@react/legacy-modules/services/trialAccessApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import {
  COMMERCE_ENTRY_GROUPS,
  ecomToolCover,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { displayNotification, isAnnouncementNotification } from "../utils/notificationDisplay.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import { REFERRALS_ENABLED } from "../config/referrals.js";
import "@react/legacy-styles/generated/components/layout/NavBar.css";
import "@react/legacy-styles/generated/components/layout/NavNotificationsMenu.css";
import "./NavBar.account-menu.css";
gsap.registerPlugin(useGSAP);

const imageLinks = [
  {
    id: "assistant",
    to: "/assistant",
    label: "AI 助手",
    icon: "bi-chat-square-text-fill",
    cover: "/sucai/studio-cover-assistant.webp",
    tagline: "连续对话 · 边聊边出图",
    tag: "核心生成 · 连续对话",
    desc: "连续对话 · 边聊边出图。精准拆解你的构思，智能扩写提示词并给出专业风格推演。",
  },
  {
    id: "t2i",
    to: "/text-to-image",
    label: "文生图 Studio",
    icon: "bi-stars",
    cover: "/sucai/studio-cover-t2i.webp",
    tagline: "文字生成高清艺术图像",
    tag: "核心生成 · 图像扩散",
    desc: "文字生成高清图像。多模态扩散生成，精准理解中文意境与专业艺术画风。",
  },
  {
    id: "model",
    to: "/model-sheet",
    label: "模型设计",
    icon: "bi-person-bounding-box",
    cover: "/sucai/studio-cover-model.webp",
    tagline: "角色三视图 · 锁定一致形象",
    tag: "专业工坊 · 角色设定",
    desc: "角色三视图 · 锁定形象。高保真保持面部特征、发型与服饰细节一致性。",
  },
  {
    id: "coloring",
    to: "/ai-illustration-coloring",
    label: "插画染色",
    icon: "bi-brush-fill",
    cover: "/sucai/studio-cover-coloring.webp",
    tagline: "线稿上色 · 丰富多维风格",
    tag: "专业工坊 · 线稿上色",
    desc: "线稿上色 · 丰富风格。智能提取线稿黑白结构，一键赋予高精色彩与光影氛围。",
  },
  {
    id: "ui",
    to: "/design-workshop",
    label: "UI 设计稿",
    icon: "bi-bezier2",
    cover: "/sucai/studio-cover-ui.webp",
    tagline: "网页界面 · App 原型视觉",
    tag: "垂类工坊 · 界面原型",
    desc: "网页界面 · App 原型视觉。直接输出符合现代审美与交互规范的应用概念稿。",
  },
  {
    id: "game",
    to: "/game-art",
    label: "游戏设计",
    icon: "bi-controller",
    cover: "/sucai/studio-cover-game.webp",
    tagline: "游戏场景与道具设定原画",
    tag: "垂类工坊 · 游戏原画",
    desc: "游戏场景与道具原画。量身定制概念美术、武器道具与环境设定资产。",
  },
];

const commerceModes = {
  tryon: [
    "AI 虚拟试衣",
    "平铺服装智能上身真人秀",
    "bi-person-standing-dress",
    "服饰模特 · 核心工具",
    "上传平铺服装或模特图，3秒生成无痕自然真人试衣照，智能贴合人体身材与光影折痕。",
  ],
  handheld: [
    "手持商品图",
    "自定义肤质与自然握持姿势",
    "bi-hand-index-thumb-fill",
    "服饰模特 · 场景穿戴",
    "免去模特预约，AI 智能生成多种手型、肤色与逼真握持姿势，适用于美妆、数码、快消品。",
  ],
  accessory: [
    "AI 饰品穿戴",
    "珠宝首饰微距光泽质感还原",
    "bi-gem",
    "服饰模特 · 高精微距",
    "项链、耳饰、手表、戒指高保真穿戴，微距反射与材质折射精确拟真。",
  ],
  shoot: [
    "AI 创意商拍",
    "摄影棚与自然环境多重置景",
    "bi-camera-fill",
    "商品设计 · 棚拍置景",
    "输入单张白底图，置入上千款商业级实景摄影棚、野外自然光、现代北欧等置景风格。",
  ],
  listing: [
    "商品套图",
    "全套电商主图与细节特写",
    "bi-images",
    "商品设计 · 批量物料",
    "主图、多角度特写、使用场景图、卖点图一键成套产出，排版省时 80%。",
  ],
  detail: [
    "A+ / 详情页",
    "转化型详情页叙事模块生成",
    "bi-layout-text-window-reverse",
    "商品设计 · 转化详情",
    "电商详情页版式模块生成，匹配平台标准规格与排版动线。",
  ],
  campaign: [
    "AI 营销图",
    "大促活动与社交媒体海报",
    "bi-megaphone-fill",
    "质感精修 · 营销活动",
    "大促节点营销图生成，自动搭配吸睛文案排版与节日促销氛围。",
  ],
  background: [
    "AI 背景图",
    "纯净置景光影快速替换",
    "bi-card-image",
    "质感精修 · 纯净置景",
    "高精度商品背景生成，保留商品本体，替换环境光感与氛围。",
  ],
  backdrop: [
    "背景复刻",
    "标杆商品光影与背景风格提取",
    "bi-layers-fill",
    "质感精修 · 光影复刻",
    "提取竞品或优秀案例的光影、构图与背景质感，无缝迁移至自有商品。",
  ],
  shadow: [
    "AI 商品阴影",
    "物理接触阴影与光衰计算",
    "bi-circle-half",
    "质感精修 · 物理接触",
    "物理级接触阴影计算，让商品落地感逼真自然，彻底告别悬浮假图感。",
  ],
  outpaint: [
    "智能扩图",
    "画幅比例无缝智能延伸",
    "bi-arrows-angle-expand",
    "质感精修 · 画幅延展",
    "画幅比例智能扩展，自动补齐周边环境，适配各类电商平台尺寸规范。",
  ],
  enhance: [
    "真实增强",
    "4K超分辨率与瑕疵细节修复",
    "bi-badge-hd-fill",
    "质感精修 · 超清锐化",
    "真实质感增强与 4K 超分辨率放大，修复模糊瑕疵。",
  ],
};

const commerceGroups = COMMERCE_ENTRY_GROUPS.map((group) => ({
  ...group,
  items: group.ids.map((id) => ({
    id,
    to: `/ecommerce-design?tool=${id}`,
    label: commerceModes[id][0],
    shortLabel: commerceModes[id][0],
    tagline: commerceModes[id][1],
    icon: commerceModes[id][2],
    tag: commerceModes[id][3],
    desc: commerceModes[id][4],
    cover: ecomToolCover(id),
  })),
}));

const imageDesignGroups = [
  {
    id: "core",
    label: "核心生成",
    description: "连续对话创作与多模态扩散",
    items: [imageLinks[0], imageLinks[1]],
  },
  {
    id: "character",
    label: "角色与插画",
    description: "一致性角色设定与线稿上色",
    items: [imageLinks[2], imageLinks[3]],
  },
  {
    id: "vertical",
    label: "垂类工坊",
    description: "界面视觉原型与游戏原画",
    items: [imageLinks[4], imageLinks[5]],
  },
];

const toolGroups = [
  {
    id: "image-tools",
    label: "图像处理",
    description: "发丝级抠图与画质处理",
    items: [
      {
        id: "bg-remove",
        to: "/tools/background-remove",
        label: "背景移除",
        tagline: "发丝级智能主体与背景离析",
        icon: "bi-person-bounding-box",
        tag: "图像工具 · 智能抠图",
        desc: "毫秒级发丝与透明材质精细扣取，智能主体识别与一键更换透明背景。",
        cover: "/sucai/canvas-hero.webp",
      },
      {
        id: "compress",
        to: "/tools/image-compress",
        label: "图片压缩",
        tagline: "保持画质的高比例体积优化",
        icon: "bi-file-zip",
        tag: "图像工具 · 无损压缩",
        desc: "保持晶莹画质的高压缩率处理，体积缩减 70% 依然细节分明。",
        cover: "/sucai/community-gallery-atmosphere.webp",
      },
    ],
  },
  {
    id: "creative-tools",
    label: "创意玩法",
    description: "3D 卡牌与排版拼接",
    items: [
      {
        id: "holo",
        to: "/holo-card",
        label: "闪光收藏卡",
        tagline: "3D 镭射视差立体卡牌艺术",
        icon: "bi-stars",
        tag: "创意玩法 · 3D 渲染",
        desc: "3D 镭射视差立体卡牌艺术，让图像呈现出精美实体闪卡与浮雕折射效果。",
        cover: "/sucai/profile-hero-character.png",
      },
      {
        id: "puzzle",
        to: "/tools/puzzle",
        label: "AI 创意拼图",
        tagline: "多图色彩均衡与比例网格重构",
        icon: "bi-puzzle-fill",
        tag: "创意玩法 · 智能排版",
        desc: "多图色彩自动均衡与比例网格重构，批量将零散素材组合成规整海报。",
        cover: "/sucai/canvas-hero.webp",
      },
    ],
  },
  {
    id: "platform-info",
    label: "平台资讯",
    description: "关于星空云绘与更新说明",
    items: [
      {
        id: "about",
        to: "/app-space",
        label: "关于我们",
        tagline: "创作者工坊与云上美术馆",
        icon: "bi-columns-gap",
        tag: "星空云绘 · 创作者工坊",
        desc: "云上美术馆与全流程创作平台，连接创作者与前沿视觉生成技术。",
        cover: "/sucai/community-gallery-atmosphere.webp",
      },
      {
        id: "updates",
        to: "/updates",
        label: "更新说明",
        tagline: "引擎迭代与最新发布特性",
        icon: "bi-journal-text",
        tag: "系统演化 · 版本日志",
        desc: "定期迭代发布说明，持续提升多模态图像质量与创作者操作效率。",
        cover: "/sucai/canvas-hero.webp",
      },
    ],
  },
];

const baseTools = [
  ["/holo-card", "闪光卡", "bi-stars"],
  ["/tools/background-remove", "背景移除", "bi-person-bounding-box"],
  ["/tools/image-compress", "图片压缩", "bi-file-zip"],
  ["/tools/puzzle", "拼图", "bi-puzzle-fill"],
  ["/app-space", "关于我们", "bi-columns-gap"],
  ["/updates", "更新说明", "bi-journal-text"],
  ["/feedback", "问题反馈", "bi-chat-square-text"],
].map(([to, label, icon]) => ({ to, label, icon }));

const navItems = [
  { type: "link", id: "home", to: "/", label: "首页", icon: "bi-house-door-fill" },
  { type: "link", to: "/studio", label: "创作台", icon: "bi-grid-1x2-fill" },
  {
    type: "link",
    to: "/canvas",
    label: "无限画布",
    icon: "bi-bounding-box-circles",
  },
  {
    type: "group",
    name: "ecommerce",
    label: "AI 电商",
    icon: "bi-bag-check-fill",
    commerce: true,
    links: commerceGroups.flatMap((group) => group.items),
  },
  {
    type: "group",
    name: "image-design",
    label: "图片设计",
    icon: "bi-palette-fill",
    mega: true,
    links: imageLinks,
  },
  {
    type: "link",
    to: "/prompts",
    label: "提示词",
    icon: "bi-journal-richtext",
  },
  {
    type: "link",
    to: "/skills",
    label: "技能库",
    icon: "bi-lightning-charge-fill",
  },
  { type: "link", to: "/share", label: "社区", icon: "bi-images" },
  {
    type: "link",
    to: "/history",
    label: "历史记录",
    icon: "bi-clock-history",
    requiresAuth: true,
  },
  {
    type: "link",
    to: "/pricing",
    label: "创作价格",
    icon: "bi-credit-card-2-front-fill",
  },
  { type: "link", to: "/incentive-plans", label: "创作激励", icon: "bi-gift" },
  {
    type: "group",
    name: "tools",
    label: "工具",
    icon: "bi-columns-gap",
    links: baseTools,
  },
];

const accountMenuNavHrefs = new Set(["/incentive-plans"]);

function routePath(to) {
  return String(to || "").split("?")[0];
}

function notificationTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function navMotionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

export function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const { isEntryVisible } = usePageControls();
  const isCanvas =
    location.pathname === "/canvas" || location.pathname.startsWith("/canvas/");
  const rootRef = useRef(null);
  const notificationCloseTimerRef = useRef(0);
  const accountCloseTimerRef = useRef(0);
  const accountOpenRef = useRef(false);
  const accountPinnedRef = useRef(false);
  const [activeDropdown, setActiveDropdown] = useState("");
  const dropdownCloseTimerRef = useRef(0);
  const [ecomPreviewItem, setEcomPreviewItem] = useState(null);
  const [designPreviewItem, setDesignPreviewItem] = useState(null);
  const [toolsPreviewItem, setToolsPreviewItem] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const homeOverlay = location.pathname === "/" && !scrolled;
  const studioOverlay = location.pathname === "/tools/puzzle" && isDark;
  const [balance, setBalance] = useState(0);
  const [subscription, setSubscription] = useState(null);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationMarking, setNotificationMarking] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [trialCampaign, setTrialCampaign] = useState(null);
  const [trialDialogOpen, setTrialDialogOpen] = useState(false);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mediaTools, setMediaTools] = useState([]);
  const checkinVisible = isEntryVisible("activity.checkin");
  const trialVisible = isEntryVisible("activity.trial");
  useEffect(() => {
    let active = true;
    const loadMediaTools = () => {
      fetchRuntimeConfig({ force: true }).then((config) => {
        if (!active) return;
        const configured = config?.features?.["ai.mediaTools"]?.config?.tools;
        setMediaTools((Array.isArray(configured) ? configured : []).map((tool) => ({
          to: `/tools/${encodeURIComponent(tool.id)}`,
          label: String(tool.name || tool.label || "媒体工具"),
          icon: tool.modality === "video" ? "bi-camera-video" : tool.modality === "audio" ? "bi-soundwave" : "bi-image",
        })));
      }).catch(() => active && setMediaTools([]));
    };
    const refreshVisibleTools = () => {
      if (document.visibilityState === "visible") loadMediaTools();
    };
    loadMediaTools();
    window.addEventListener("focus", loadMediaTools);
    document.addEventListener("visibilitychange", refreshVisibleTools);
    return () => {
      active = false;
      window.removeEventListener("focus", loadMediaTools);
      document.removeEventListener("visibilitychange", refreshVisibleTools);
    };
  }, []);
  const resolvedNavItems = useMemo(
    () => navItems.map((item) => item.type === "group" && item.name === "tools"
      ? { ...item, links: [...mediaTools, ...item.links] }
      : item),
    [mediaTools],
  );
  const visibleNavItems = useMemo(
    () =>
      resolvedNavItems.flatMap((item) => {
        if (item.type === "link") {
          if (auth.isAuthenticated && accountMenuNavHrefs.has(item.to)) return [];
          return isEntryVisible(item.to) ? [item] : [];
        }
        const links = item.links.filter((link) => isEntryVisible(link.to));
        return links.length ? [{ ...item, links }] : [];
      }),
    [auth.isAuthenticated, isEntryVisible, resolvedNavItems],
  );

  const isActive = (to) => {
    const targetPath = routePath(to);
    const pathMatches =
      location.pathname === targetPath ||
      (targetPath !== "/" && location.pathname.startsWith(`${targetPath}/`));
    if (!pathMatches) return false;

    const targetSearch = String(to || "").split("?")[1];
    if (!targetSearch) return true;
    const currentParams = new URLSearchParams(location.search);
    return [...new URLSearchParams(targetSearch)].every(
      ([key, value]) => currentParams.get(key) === value,
    );
  };
  const isPending = (to) => {
    if (navigation.state === "idle" || !navigation.location) return false;
    const target = new URL(String(to || "/"), window.location.origin);
    return (
      target.pathname === navigation.location.pathname &&
      target.search === (navigation.location.search || "")
    );
  };
  const groupLabel = (item) => {
    if (!item.mega) return item.label;
    return item.links.find((link) => isActive(link.to))?.label || item.label;
  };
  const accountInitial = String(
    auth.user?.username || auth.user?.email || "创",
  )
    .trim()
    .slice(0, 1)
    .toUpperCase();
  const subscriptionLabel = subscription?.active ? "已订阅" : subscription?.blockingPurchase ? "退订处理中" : "未订阅";

  useLayoutEffect(() => {
    const publish = () => {
      const height = Math.ceil(
        rootRef.current?.getBoundingClientRect().height || 62,
      );
      document.documentElement.style.setProperty(
        "--app-header-offset",
        `${height}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    const onPointerDown = (event) => {
      const target = event.target;
      const root = rootRef.current;
      if (!root?.contains(target)) {
        setActiveDropdown("");
        setMobileOpen(false);
        setNotificationOpen(false);
        closeAccountMenu();
        return;
      }
      if (!target.closest(".account-menu")) closeAccountMenu();
      if (!target.closest(".nav-notify")) setNotificationOpen(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    setActiveDropdown("");
    setMobileOpen(false);
    closeAccountMenu();
    setNotificationOpen(false);
  }, [location.pathname, location.search]);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return undefined;

      const mobileLayout = window.matchMedia?.("(max-width: 1400px)").matches;
      const reduced = navMotionDisabled();
      const animatedTargets = [];

      const reveal = (panel, itemSelector, options = {}) => {
        if (!(panel instanceof HTMLElement)) return;
        const items = Array.from(panel.querySelectorAll(itemSelector)).filter(
          (item) =>
            item instanceof HTMLElement &&
            getComputedStyle(item).display !== "none",
        );
        animatedTargets.push(panel, ...items);
        panel.dataset.navMotionState = reduced ? "entered" : "entering";

        if (reduced) {
          gsap.set([panel, ...items], {
            clearProps: "opacity,visibility,transform,transform-origin",
          });
          return;
        }

        gsap
          .timeline({
            defaults: { overwrite: "auto" },
            onComplete: () => {
              if (!panel.isConnected) return;
              panel.dataset.navMotionState = "entered";
            },
          })
          .fromTo(
            panel,
            {
              autoAlpha: 0,
              y: options.y ?? -8,
              scale: options.scale ?? 0.985,
              transformOrigin: options.transformOrigin || "50% 0%",
            },
            {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: options.duration ?? 0.3,
              ease: "power3.out",
              clearProps: "opacity,visibility,transform,transform-origin",
            },
            0,
          )
          .fromTo(
            items,
            { autoAlpha: 0, y: options.itemY ?? 7 },
            {
              autoAlpha: 1,
              y: 0,
              duration: options.itemDuration ?? 0.24,
              stagger:
                items.length > 1
                  ? { amount: Math.min(0.18, items.length * 0.014) }
                  : 0,
              ease: "power2.out",
              clearProps: "opacity,visibility,transform",
            },
            options.itemStart ?? 0.07,
          );
      };

      if (mobileLayout && mobileOpen) {
        reveal(
          root.querySelector("#primary-navigation"),
          ":scope > .nav-link, .commerce-menu-card, .nav-bento-card, .nav-dropdown-item",
          { y: -10, scale: 0.99, duration: 0.34, itemY: 6, itemStart: 0.09 },
        );
      } else if (!mobileLayout && activeDropdown) {
        const panel = root.querySelector(
          `[data-dropdown-menu="${activeDropdown}"]`,
        );
        const heavyMenu =
          panel instanceof HTMLElement &&
          (panel.classList.contains("nav-mega-menu") ||
            panel.classList.contains("commerce-mega-menu"));
        if (heavyMenu) {
          panel.dataset.navMotionState = "entered";
        } else {
          reveal(panel, '[role="menuitem"]', {
            y: -6,
            scale: 0.995,
            duration: 0.2,
            itemY: 4,
            itemStart: 0.04,
          });
        }
      }

      if (accountOpen) {
        reveal(
          root.querySelector(".account-menu__panel"),
          '.account-menu__head, [role="menuitem"]',
          {
            y: -6,
            scale: 0.985,
            duration: 0.26,
            itemY: 5,
            itemStart: 0.05,
          },
        );
      }

      if (notificationOpen) {
        reveal(
          root.querySelector(".nav-notify__panel"),
          ".nav-notify__head, .nav-notify__list > li, .nav-notify__empty, .nav-notify__foot",
          {
            y: -6,
            scale: 0.99,
            duration: 0.24,
            itemY: 4,
            itemStart: 0.045,
          },
        );
      }

      return () => {
        gsap.killTweensOf(animatedTargets);
      };
    },
    {
      dependencies: [activeDropdown, accountOpen, mobileOpen, notificationOpen],
      scope: rootRef,
      revertOnUpdate: true,
    },
  );

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setBalance(0);
      setSubscription(null);
      return undefined;
    }
    const controller = new AbortController();
    const onWalletUpdated = (event) => {
      const wallet = event?.detail;
      if (!wallet) return;
      setBalance(
        Math.max(
          0,
          Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0),
        ),
      );
      getSubscription({ signal: controller.signal }).then(next => { if (!controller.signal.aborted) setSubscription(next); }).catch(() => null);
    };
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    getWallet({ signal: controller.signal })
      .then((wallet) =>
        setBalance(
          Math.max(
            0,
            Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0),
          ),
        ),
      )
      .catch(() => null);
    getSubscription({ signal: controller.signal })
      .then((next) => setSubscription(next && typeof next === "object" ? next : null))
      .catch(() => setSubscription(null));
    return () => {
      controller.abort();
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
    };
  }, [auth.isAuthenticated,auth.user?.id]);

  useEffect(() => {
    if (!trialVisible) {
      setTrialCampaign(null);
      return undefined;
    }
    let disposed = false;
    const refresh = () =>
      getTrialAccessCampaign()
        .then((campaign) => {
          if (!disposed)
            setTrialCampaign(
              campaign?.enabled === true && campaign?.status === "active"
                ? campaign
                : null,
            );
          return campaign;
        })
        .catch(() => {
          if (!disposed) setTrialCampaign(null);
          return null;
        });
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
    };
  }, [trialVisible]);

  useEffect(() => {
    if (!trialVisible) return;
    const params = new URLSearchParams(location.search);
    if (params.get("trial") !== "apply") return;
    params.delete("trial");
    navigate(
      `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`,
      { replace: true },
    );
    getTrialAccessCampaign()
      .then((campaign) => {
        if (campaign?.enabled === true && campaign?.status === "active") {
          setTrialCampaign(campaign);
          setTrialDialogOpen(true);
        } else notificationService.info("当前没有开放中的体验活动");
      })
      .catch((error) =>
        notificationService.error(error?.message || "体验活动读取失败"),
      );
  }, [location.hash, location.pathname, location.search, navigate, trialVisible]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setNotificationUnread(0);
      setNotificationItems([]);
      setNotificationOpen(false);
      return undefined;
    }
    const controller = new AbortController();
    setNotificationLoading(true);
    let lastUnread = -1;
    const refreshPreview = () =>
      listNotifications({ limit: 8, signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          if (Number(result.unread) !== lastUnread && result.items.some(item => String(item.sourceType || "").startsWith("subscription_"))) {
            getWallet({ signal: controller.signal }).then(wallet => {
              if (!controller.signal.aborted) window.dispatchEvent(new CustomEvent("starclouds:wallet-updated", { detail: wallet }));
            }).catch(() => null);
          }
          lastUnread = Math.max(0, Number(result.unread) || 0);
          setNotificationUnread(lastUnread);
          setNotificationItems(
            result.items
              .filter((item) => !isAnnouncementNotification(item))
              .slice(0, 8),
          );
        })
        .catch(() => null);
    const onUpdated = (event) => {
      if (!Number.isFinite(Number(event?.detail?.unreadCount))) { if (event?.detail?.source === "subscription-change") void refreshPreview(); return; }
      const nextUnread = Math.max(0, Number(event.detail.unreadCount));
      setNotificationUnread(nextUnread);
      if (event?.detail?.source === "clear-all") {
        lastUnread = 0;
        setNotificationItems([]);
        return;
      }
      if (event?.detail?.source === "mark-all") {
        lastUnread = 0;
        const readAt = new Date().toISOString();
        setNotificationItems((items) =>
          items.map((item) => ({ ...item, readAt: item.readAt || readAt })),
        );
        return;
      }
      if (Array.isArray(event?.detail?.previewItems)) {
        lastUnread = nextUnread;
        setNotificationItems(event.detail.previewItems.slice(0, 8));
        return;
      }
      // SSE 只推未读数：数量变化时再拉一次预览列表保持一致。
      const fromStream =
        event?.detail?.source === "sse" ||
        event?.detail?.source === "sse-fallback";
      if (fromStream && nextUnread !== lastUnread) void refreshPreview();
      lastUnread = nextUnread;
    };
    window.addEventListener("starclouds:notifications-updated", onUpdated);
    refreshPreview().finally(
      () => !controller.signal.aborted && setNotificationLoading(false),
    );
    return () => {
      controller.abort();
      window.clearTimeout(notificationCloseTimerRef.current);
      window.clearTimeout(accountCloseTimerRef.current);
      window.clearTimeout(dropdownCloseTimerRef.current);
      window.removeEventListener("starclouds:notifications-updated", onUpdated);
    };
  }, [auth.isAuthenticated, auth.user?.id]);

  function showMegaDropdown(name) {
    window.clearTimeout(dropdownCloseTimerRef.current);
    closeAccountMenu();
    setNotificationOpen(false);
    setActiveDropdown(name);
  }

  function scheduleMegaDropdownClose() {
    window.clearTimeout(dropdownCloseTimerRef.current);
    dropdownCloseTimerRef.current = window.setTimeout(() => {
      setActiveDropdown("");
    }, 120);
  }

  function cancelMegaDropdownClose() {
    window.clearTimeout(dropdownCloseTimerRef.current);
  }

  function toggleDropdown(name) {
    window.clearTimeout(dropdownCloseTimerRef.current);
    setActiveDropdown((current) => (current === name ? "" : name));
  }

  function closeAccountMenu() {
    accountPinnedRef.current = false;
    accountOpenRef.current = false;
    window.clearTimeout(accountCloseTimerRef.current);
    setAccountOpen(false);
  }

  function showAccountMenu() {
    window.clearTimeout(accountCloseTimerRef.current);
    window.clearTimeout(dropdownCloseTimerRef.current);
    setNotificationOpen(false);
    setActiveDropdown("");
    accountOpenRef.current = true;
    setAccountOpen(true);
  }

  function scheduleAccountClose() {
    if (accountPinnedRef.current) return;
    window.clearTimeout(accountCloseTimerRef.current);
    accountCloseTimerRef.current = window.setTimeout(closeAccountMenu, 160);
  }

  function toggleAccountMenu(event) {
    event.stopPropagation();
    window.clearTimeout(accountCloseTimerRef.current);
    window.clearTimeout(dropdownCloseTimerRef.current);
    setNotificationOpen(false);
    setActiveDropdown("");
    if (accountOpenRef.current && accountPinnedRef.current) {
      closeAccountMenu();
      return;
    }
    accountPinnedRef.current = true;
    accountOpenRef.current = true;
    setAccountOpen(true);
  }

  function closeMenu() {
    window.clearTimeout(dropdownCloseTimerRef.current);
    setActiveDropdown("");
    setMobileOpen(false);
    closeAccountMenu();
    setNotificationOpen(false);
  }

  function showNotifications() {
    window.clearTimeout(notificationCloseTimerRef.current);
    closeAccountMenu();
    setNotificationOpen(true);
  }

  function scheduleNotificationClose() {
    window.clearTimeout(notificationCloseTimerRef.current);
    notificationCloseTimerRef.current = window.setTimeout(
      () => setNotificationOpen(false),
      160,
    );
  }

  async function markAllNotificationsRead() {
    if (notificationMarking || notificationUnread <= 0) return;
    setNotificationMarking(true);
    try {
      await markNotificationsRead();
      const readAt = new Date().toISOString();
      setNotificationUnread(0);
      setNotificationItems((items) =>
        items.map((item) => ({ ...item, readAt: item.readAt || readAt })),
      );
      window.dispatchEvent(
        new CustomEvent("starclouds:notifications-updated", {
          detail: { unreadCount: 0, source: "mark-all" },
        }),
      );
      notificationService.success("已全部标记为已读");
    } catch (error) {
      notificationService.error(error?.message || "操作失败");
    } finally {
      setNotificationMarking(false);
    }
  }

  function requestLogout() {
    closeAccountMenu();
    setLogoutOpen(true);
  }

  async function confirmLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAccount().catch(() => null);
      auth.setUser(null);
      closeMenu();
      setLogoutOpen(false);
    } finally {
      setLoggingOut(false);
    }
  }

  async function openTrialDialog() {
    closeMenu();
    if (requestAuth({ featureLabel: "申请体验" })) return;
    try {
      const campaign = await getTrialAccessCampaign();
      if (campaign?.enabled !== true || campaign?.status !== "active") {
        setTrialCampaign(null);
        notificationService.info("当前没有开放中的体验活动");
        return;
      }
      setTrialCampaign(campaign);
      setTrialDialogOpen(true);
    } catch (error) {
      notificationService.error(error?.message || "体验活动读取失败");
    }
  }

  function openRedeemDialog() {
    closeMenu();
    if (requestAuth({ featureLabel: "兑换积分" })) return;
    setRedeemDialogOpen(true);
  }

  function openCheckin(event) {
    closeMenu();
    if (!auth.isAuthenticated) {
      event.preventDefault();
      requestAuth({ featureLabel: "每日签到" });
    }
  }

  function openNavLink(event, item) {
    if (isPending(item.to)) {
      event.preventDefault();
      return;
    }
    closeMenu();
    if (item.requiresAuth && !auth.isAuthenticated) {
      event.preventDefault();
      requestAuth({ featureLabel: item.label });
    }
  }

  const isMegaOpen = Boolean(
    activeDropdown &&
      (activeDropdown === "ecommerce" ||
        activeDropdown === "image-design" ||
        activeDropdown === "tools"),
  );

  return (
    <header
      ref={rootRef}
      className={`site-header${isDark || homeOverlay || studioOverlay ? " is-dark" : ""}${homeOverlay ? " is-home-overlay" : ""}${studioOverlay ? " is-studio-overlay" : ""}${isCanvas ? " is-canvas" : ""}${scrolled ? " is-scrolled" : ""}${mobileOpen ? " is-mobile-open" : ""}${isMegaOpen ? " is-mega-open" : ""}`}
    >
      <div id="site-announcement-slot" />
      <div className="header-shell">
        <div className="header-row">
          <div className="brand-cluster">
            <Link
              className="brand-mark"
              to="/"
              aria-label="星空云绘首页"
              onClick={closeMenu}
            >
              <span className="brand-icon">
                <img src="/brand/starcloud-logo.svg" alt="" />
              </span>
              <span className="brand-copy">
                <strong>星空云绘</strong>
              </span>
            </Link>
          </div>

          <button
            type="button"
            className="nav-mobile-toggle"
            aria-expanded={mobileOpen}
            aria-controls="primary-navigation"
            aria-label={mobileOpen ? "关闭主导航" : "打开主导航"}
            onClick={(event) => {
              event.stopPropagation();
              setMobileOpen((value) => !value);
            }}
          >
            <i
              className={`bi ${mobileOpen ? "bi-x-lg" : "bi-list"}`}
              aria-hidden="true"
            />
          </button>

          <nav id="primary-navigation" className="main-nav" aria-label="主导航">
            {visibleNavItems.map((item) =>
              item.type === "link" ? (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-link${item.id === "home" ? " nav-home-link" : ""}${isActive(item.to) ? " active router-link-exact-active" : ""}${isPending(item.to) ? " is-pending" : ""}`}
                  aria-current={isActive(item.to) ? "page" : undefined}
                  aria-disabled={isPending(item.to) ? "true" : undefined}
                  onClick={(event) => openNavLink(event, item)}
                >
                  <i className={`bi ${item.icon}`} />
                  <span>{item.label}</span>
                </Link>
              ) : (
                <div
                  key={item.name}
                  className={`nav-dropdown${activeDropdown === item.name ? " open" : ""}${item.links.some((link) => isActive(link.to)) ? " active" : ""}${item.mega ? " nav-dropdown--mega" : ""}${item.commerce ? " nav-dropdown--commerce" : ""}`}
                  onMouseEnter={() => showMegaDropdown(item.name)}
                  onMouseLeave={scheduleMegaDropdownClose}
                >
                  <div className="nav-link nav-dropdown-trigger">
                    <button
                      type="button"
                      className="nav-dropdown-label"
                      aria-controls={`nav-dropdown-${item.name}`}
                      aria-expanded={activeDropdown === item.name}
                      aria-haspopup="menu"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDropdown(item.name);
                      }}
                    >
                      <i className={`bi ${item.icon}`} />
                      <span>{groupLabel(item)}</span>
                      <i
                        className={`bi bi-chevron-down nav-caret${activeDropdown === item.name ? " is-open" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="nav-dropdown-chevron-btn"
                      aria-expanded={activeDropdown === item.name}
                      aria-label="展开子菜单"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDropdown(item.name);
                      }}
                    >
                      <i
                        className={`bi bi-chevron-down dropdown-chevron${activeDropdown === item.name ? " is-open" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {item.commerce ? (
                    <div
                      id={`nav-dropdown-${item.name}`}
                      className="nav-dropdown-menu commerce-mega-menu"
                      role="menu"
                      data-dropdown-menu={item.name}
                    >
                      <div className="commerce-menu-grid" role="none">
                        {item.links.map((link) => (
                            <Link
                              key={link.to}
                              to={link.to}
                              className={`commerce-menu-card${isActive(link.to) ? " active" : ""}${isPending(link.to) ? " is-pending" : ""}`}
                              role="menuitem"
                              aria-disabled={isPending(link.to) ? "true" : undefined}
                              onClick={(event) => openNavLink(event, link)}
                            >
                              <span className="commerce-menu-card__media">
                                <img
                                  src={link.cover}
                                  alt=""
                                  decoding="async"
                                />
                              </span>
                              <span className="commerce-menu-card__copy">
                                <strong>{link.shortLabel}</strong>
                              </span>
                            </Link>
                          ))}
                      </div>
                    </div>
                  ) : item.mega ? (
                    <div
                      id={`nav-dropdown-${item.name}`}
                      className="nav-dropdown-menu nav-mega-menu"
                      role="menu"
                      data-dropdown-menu={item.name}
                    >
                      <div className="nav-bento" role="none">
                        {item.links.map((link) => (
                          <Link
                            key={link.to}
                            to={link.to}
                            className={`nav-bento-card is-${link.bento || "tile"} is-${link.id}${isActive(link.to) ? " active" : ""}${isPending(link.to) ? " is-pending" : ""}`}
                            role="menuitem"
                            aria-disabled={isPending(link.to) ? "true" : undefined}
                            onClick={(event) => openNavLink(event, link)}
                          >
                            <span className="nav-bento-card__media">
                              <img src={link.cover} alt="" decoding="async" />
                            </span>
                            <span className="nav-bento-card__copy">
                              <strong>{link.label}</strong>
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      id={`nav-dropdown-${item.name}`}
                      className="nav-dropdown-menu"
                      role="menu"
                      data-dropdown-menu={item.name}
                    >
                      {item.links.map((link) => (
                        <Link
                          key={link.to}
                          to={link.to}
                          className={`nav-dropdown-item${isActive(link.to) ? " active" : ""}${isPending(link.to) ? " is-pending" : ""}`}
                          role="menuitem"
                          aria-disabled={isPending(link.to) ? "true" : undefined}
                          onClick={(event) => openNavLink(event, link)}
                        >
                          <i className={`bi ${link.icon}`} />
                          <span>{link.label}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
          </nav>

          <div className="header-tools">
            <div className="tool-actions">
              {!auth.isAuthenticated && checkinVisible && (
                <Link
                  to="/check-in"
                  className="nav-checkin-btn"
                  title="每日签到领积分"
                  onClick={openCheckin}
                >
                  <span className="nav-checkin-btn__icon" aria-hidden="true">
                    <i className="bi bi-calendar-check" />
                  </span>
                  <span className="nav-checkin-btn__label">签到</span>
                </Link>
              )}
              <button
                type="button"
                className="nav-redeem-btn"
                title="兑换码入账"
                onClick={openRedeemDialog}
              >
                <span className="nav-redeem-btn__icon" aria-hidden="true">
                  <i className="bi bi-ticket-perforated" />
                </span>
                <span className="nav-redeem-btn__label">兑换</span>
              </button>
              {!auth.isAuthenticated && trialVisible && trialCampaign && (
                <button
                  type="button"
                  className="nav-trial-btn"
                  title="申请体验"
                  onClick={openTrialDialog}
                >
                  <i className="bi bi-stars" aria-hidden="true" />
                  <span>申请体验</span>
                </button>
              )}
              <ThemeSwitch />
              <LocaleSwitcher />
              {auth.isAuthenticated ? (
                <>
                  {isEntryVisible("/notifications") && <div
                    className={`nav-notify${notificationUnread > 0 ? " has-unread" : ""}${notificationOpen ? " open" : ""}`}
                    onMouseEnter={showNotifications}
                    onMouseLeave={scheduleNotificationClose}
                    onFocusCapture={showNotifications}
                    onBlurCapture={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        scheduleNotificationClose();
                    }}
                  >
                    <Link
                      to="/notifications"
                      className="nav-notify__btn"
                      aria-label="通知"
                      title="通知"
                      aria-expanded={notificationOpen}
                      aria-haspopup="dialog"
                      onClick={() => {
                        setNotificationOpen(false);
                        closeAccountMenu();
                      }}
                    >
                      <i className="bi bi-bell" aria-hidden="true" />
                      {notificationUnread > 0 && (
                        <em className="nav-notify__badge">
                          {notificationUnread > 99 ? "99+" : notificationUnread}
                        </em>
                      )}
                    </Link>
                    {notificationOpen && (
                      <aside
                        className="nav-notify__panel"
                        role="dialog"
                        aria-label="最近通知"
                      >
                        <header className="nav-notify__head">
                          <div>
                            <strong>最近通知</strong>
                            <small>
                              {notificationUnread
                                ? `${notificationUnread} 条未读`
                                : "消息已全部读完"}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="nav-notify__read-all"
                            disabled={
                              notificationLoading ||
                              notificationMarking ||
                              notificationUnread <= 0
                            }
                            onClick={markAllNotificationsRead}
                          >
                            <i
                              className={`bi ${notificationMarking ? "bi-arrow-repeat spin" : "bi-check2-all"}`}
                              aria-hidden="true"
                            />
                            <span>{notificationMarking ? "处理中" : "全部已读"}</span>
                          </button>
                        </header>
                        {notificationLoading ? (
                          <div className="nav-notify__loading">
                            <i className="bi bi-arrow-repeat spin" />
                            <span>正在读取通知…</span>
                          </div>
                        ) : notificationItems.filter(
                            (item) => !isAnnouncementNotification(item),
                          ).length ? (
                          <ol className="nav-notify__list">
                            {notificationItems
                              .filter((item) => !isAnnouncementNotification(item))
                              .map((item) => {
                              const { title, body } = displayNotification(item);
                              return (
                                <li
                                  key={item.id}
                                  className={item.readAt ? "" : "is-unread"}
                                >
                                  <Link
                                    className="nav-notify__item"
                                    to={String(item.targetPath || "").startsWith("/subscriptions?") && isEntryVisible(item.targetPath) ? item.targetPath : "/notifications"}
                                    onClick={() => {
                                      closeMenu();
                                      if (!item.readAt && String(item.targetPath || "").startsWith("/subscriptions?")) {
                                        markNotificationsRead([item.id]).then(() => window.dispatchEvent(new CustomEvent("starclouds:notifications-updated", { detail: { source: "subscription-change" } }))).catch(() => null);
                                      }
                                    }}
                                  >
                                    <span className="nav-notify__copy">
                                      <strong>{title}</strong>
                                      {body ? <p>{body}</p> : null}
                                    </span>
                                    <span className="nav-notify__meta">
                                      <small>
                                        {notificationTime(item.createdAt)}
                                      </small>
                                      {!item.readAt && (
                                        <i
                                          className="nav-notify__dot"
                                          aria-label="未读"
                                        />
                                      )}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ol>
                        ) : (
                          <div className="nav-notify__empty">
                            <i className="bi bi-bell-slash" />
                            <span>暂无通知</span>
                          </div>
                        )}
                        <footer className="nav-notify__foot">
                          <Link to="/notifications" onClick={closeMenu}>
                            查看全部通知 <i className="bi bi-arrow-right" />
                          </Link>
                          <Link to="/notifications?tab=announce" onClick={closeMenu}>
                            公告
                          </Link>
                        </footer>
                      </aside>
                    )}
                  </div>}
                  <div
                    className={`account-menu${accountOpen ? " open" : ""}`}
                    onMouseEnter={showAccountMenu}
                    onMouseLeave={scheduleAccountClose}
                    onFocusCapture={showAccountMenu}
                    onBlurCapture={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        scheduleAccountClose();
                    }}
                  >
                    <button
                      type="button"
                      className={`account-cluster${accountOpen || isActive("/profile") ? " active" : ""}`}
                      data-guide-dock
                      aria-expanded={accountOpen}
                      aria-haspopup="menu"
                      title="个人中心"
                      onClick={toggleAccountMenu}
                    >
                      <span
                        className={`account-chip${auth.user?.avatarUrl ? "" : " is-initial"}`}
                        aria-hidden="true"
                      >
                        {auth.user?.avatarUrl ? (
                          <img
                            className="account-chip__avatar"
                            src={auth.user.avatarUrl}
                            alt=""
                          />
                        ) : (
                          <span className="account-chip__mark">{accountInitial}</span>
                        )}
                      </span>
                      <span className="account-cluster__meta">
                        <span className="account-cluster__credits">
                          <span className="account-cluster__value">
                            {Math.round(balance).toLocaleString("zh-CN")}
                          </span>
                        </span>
                        <span
                          className={`account-cluster__plan${subscription?.active ? " is-active" : ""}`}
                        >
                          {subscriptionLabel}
                        </span>
                      </span>
                    </button>
                    {accountOpen && (
                      <>
                        <span className="account-menu__bridge" aria-hidden="true" />
                        <div
                          className="account-menu__panel"
                          role="menu"
                          aria-label="个人中心菜单"
                        >
                          <Link
                            className="account-menu__head"
                            to="/profile"
                            role="menuitem"
                            onClick={closeMenu}
                          >
                            <span className="account-menu__avatar-wrap">
                              <img
                                className="account-menu__avatar"
                                src={
                                  auth.user?.avatarUrl ||
                                  "/brand/avatar-placeholder.svg"
                                }
                                alt=""
                              />
                            </span>
                            <div className="account-menu__copy">
                              <strong>
                                {auth.user?.username ||
                                  auth.user?.email ||
                                  "创作者"}
                              </strong>
                              <small className="account-menu__points">
                                {Math.round(balance).toLocaleString("zh-CN")} 积分
                              </small>
                            </div>
                            <i className="bi bi-chevron-right" aria-hidden="true" />
                          </Link>
                          <div className="account-menu__list">
                            {[
                              ["/assets", "bi-collection", "我的资产"],
                              ["/submissions", "bi-send-check", "我的投稿"],
                              ["/wallet", "bi-wallet2", "我的钱包"],
                              ["/subscriptions", "bi-calendar-check", "我的订阅"],
                              ["/orders", "bi-receipt", "我的订单"],
                              ["/account", "bi-person-gear", "账号设置"],
                              ["/developer-api", "bi-code-square", "开发者 API"],
                              ...(REFERRALS_ENABLED ? [["/invite", "bi-person-plus", "邀请好友"]] : []),
                            ]
                              .filter(([to]) => isEntryVisible(to))
                              .map(([to, icon, label]) => (
                                <Link
                                  key={to}
                                  className="account-menu__item"
                                  role="menuitem"
                                  to={to}
                                  onClick={closeMenu}
                                >
                                  <i className={`bi ${icon}`} aria-hidden="true" />
                                  <span>{label}</span>
                                </Link>
                              ))}
                          </div>
                          {isEntryVisible("/incentive-plans") ? (
                            <div className="account-menu__list is-secondary">
                              <Link
                                className="account-menu__item"
                                role="menuitem"
                                to="/incentive-plans"
                                onClick={closeMenu}
                              >
                                <i className="bi bi-gift" aria-hidden="true" />
                                <span>创作激励</span>
                              </Link>
                            </div>
                          ) : null}
                          {checkinVisible || (trialVisible && trialCampaign) ? (
                            <div className="account-menu__modules">
                              {checkinVisible ? (
                                <Link
                                  className="account-menu__module is-checkin"
                                  role="menuitem"
                                  to="/check-in"
                                  onClick={openCheckin}
                                >
                                  <i className="bi bi-calendar-check" aria-hidden="true" />
                                  <span>签到</span>
                                </Link>
                              ) : null}
                              {trialVisible && trialCampaign ? (
                                <button
                                  type="button"
                                  className="account-menu__module is-trial"
                                  role="menuitem"
                                  onClick={openTrialDialog}
                                >
                                  <i className="bi bi-stars" aria-hidden="true" />
                                  <span>申请体验</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="account-menu__item is-danger"
                            role="menuitem"
                            onClick={requestLogout}
                          >
                            <span>退出登录</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <Link
                  to={`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}&mode=login`}
                  className="account-login"
                  data-guide-dock
                  onClick={closeMenu}
                >
                  <i className="bi bi-box-arrow-in-right" aria-hidden="true" />
                  <span>登录</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 桌面端全景悬停大抽屉 */}
      <div
        className={`nav-mega-drawer${activeDropdown && (activeDropdown === "ecommerce" || activeDropdown === "image-design" || activeDropdown === "tools") ? " is-open" : ""}`}
        onMouseEnter={cancelMegaDropdownClose}
        onMouseLeave={scheduleMegaDropdownClose}
      >
        <div className="nav-mega-drawer__shell">
          {/* 1. AI 电商面板 */}
          <div className={`nav-mega-panel${activeDropdown === "ecommerce" ? "" : " is-hidden"}`}>
            <div className="nav-mega-grid-left">
              {commerceGroups.map((group) => (
                <div key={group.id} className="nav-mega-col">
                  <div className="nav-mega-col-header">
                    <div className="nav-mega-col-title">{group.label}</div>
                    <div className="nav-mega-col-desc">{group.description}</div>
                  </div>
                  <div className="nav-mega-item-list">
                    {group.items.map((item) => {
                      const isSelected = (ecomPreviewItem?.id || commerceGroups[0].items[0].id) === item.id;
                      return (
                        <Link
                          key={item.id}
                          to={item.to}
                          className={`nav-mega-item-row${isSelected ? " is-active" : ""}`}
                          onMouseEnter={() => setEcomPreviewItem(item)}
                          onClick={(event) => openNavLink(event, item)}
                        >
                          <img src={item.cover} alt="" className="nav-mega-item-thumb" decoding="async" />
                          <div className="nav-mega-item-copy">
                            <div className="nav-mega-item-title">{item.label}</div>
                            <div className="nav-mega-item-tagline">{item.tagline}</div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* AI 电商专属右侧展签舞台 */}
            {(() => {
              const selected = ecomPreviewItem || commerceGroups[0].items[0];
              return (
                <div className="nav-mega-preview-stage">
                  <div className="nav-mega-preview-top">
                    <div className="nav-mega-preview-meta">
                      <span className="nav-mega-preview-tag">{selected.tag || "服饰模特 · 核心工具"}</span>
                      <span className="nav-mega-preview-badge">PREVIEW</span>
                    </div>
                    <div className="nav-mega-preview-img-box">
                      <img key={selected.id || selected.to} src={selected.cover} alt="" decoding="async" />
                    </div>
                    <div key={selected.id || selected.to} className="nav-mega-preview-copy">
                      <div className="nav-mega-preview-heading">{selected.label}</div>
                      <div className="nav-mega-preview-desc">{selected.desc || selected.tagline}</div>
                    </div>
                  </div>
                  <Link
                    to={selected.to}
                    className="nav-mega-preview-action"
                    onClick={(event) => openNavLink(event, selected)}
                  >
                    <span>进入工作台</span>
                    <i className="bi bi-arrow-right" />
                  </Link>
                </div>
              );
            })()}
          </div>

          {/* 2. 图片设计面板 */}
          <div className={`nav-mega-panel${activeDropdown === "image-design" ? "" : " is-hidden"}`}>
            <div className="nav-mega-grid-left">
              {imageDesignGroups.map((group) => (
                <div key={group.id} className="nav-mega-col">
                  <div className="nav-mega-col-header">
                    <div className="nav-mega-col-title">{group.label}</div>
                    <div className="nav-mega-col-desc">{group.description}</div>
                  </div>
                  <div className="nav-mega-item-list">
                    {group.items.map((item) => {
                      const isSelected = (designPreviewItem?.id || imageDesignGroups[0].items[0].id) === item.id;
                      return (
                        <Link
                          key={item.id}
                          to={item.to}
                          className={`nav-mega-item-row${isSelected ? " is-active" : ""}`}
                          onMouseEnter={() => setDesignPreviewItem(item)}
                          onClick={(event) => openNavLink(event, item)}
                        >
                          <img src={item.cover} alt="" className="nav-mega-item-thumb" decoding="async" />
                          <div className="nav-mega-item-copy">
                            <div className="nav-mega-item-title">{item.label}</div>
                            <div className="nav-mega-item-tagline">{item.tagline}</div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 图片设计专属右侧展签舞台 */}
            {(() => {
              const selected = designPreviewItem || imageDesignGroups[0].items[0];
              return (
                <div className="nav-mega-preview-stage">
                  <div className="nav-mega-preview-top">
                    <div className="nav-mega-preview-meta">
                      <span className="nav-mega-preview-tag">{selected.tag || "核心生成 · 连续对话"}</span>
                      <span className="nav-mega-preview-badge">STUDIO</span>
                    </div>
                    <div className="nav-mega-preview-img-box">
                      <img key={selected.id || selected.to} src={selected.cover} alt="" decoding="async" />
                    </div>
                    <div key={selected.id || selected.to} className="nav-mega-preview-copy">
                      <div className="nav-mega-preview-heading">{selected.label}</div>
                      <div className="nav-mega-preview-desc">{selected.desc || selected.tagline}</div>
                    </div>
                  </div>
                  <Link
                    to={selected.to}
                    className="nav-mega-preview-action"
                    onClick={(event) => openNavLink(event, selected)}
                  >
                    <span>进入创作</span>
                    <i className="bi bi-arrow-right" />
                  </Link>
                </div>
              );
            })()}
          </div>

          {/* 3. 工具面板 */}
          <div className={`nav-mega-panel${activeDropdown === "tools" ? "" : " is-hidden"}`}>
            <div className="nav-mega-grid-left">
              {toolGroups.map((group) => (
                <div key={group.id} className="nav-mega-col">
                  <div className="nav-mega-col-header">
                    <div className="nav-mega-col-title">{group.label}</div>
                    <div className="nav-mega-col-desc">{group.description}</div>
                  </div>
                  <div className="nav-mega-item-list">
                    {group.items.map((item) => {
                      const isSelected = (toolsPreviewItem?.id || toolGroups[0].items[0].id) === item.id;
                      return (
                        <Link
                          key={item.id}
                          to={item.to}
                          className={`nav-mega-item-row${isSelected ? " is-active" : ""}`}
                          onMouseEnter={() => setToolsPreviewItem(item)}
                          onClick={(event) => openNavLink(event, item)}
                        >
                          <div className="nav-mega-item-icon-box">
                            <i className={`bi ${item.icon}`} />
                          </div>
                          <div className="nav-mega-item-copy">
                            <div className="nav-mega-item-title">{item.label}</div>
                            <div className="nav-mega-item-tagline">{item.tagline}</div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 工具专属右侧展签舞台 */}
            {(() => {
              const selected = toolsPreviewItem || toolGroups[0].items[0];
              return (
                <div className="nav-mega-preview-stage">
                  <div className="nav-mega-preview-top">
                    <div className="nav-mega-preview-meta">
                      <span className="nav-mega-preview-tag">{selected.tag || "图像工具 · 智能抠图"}</span>
                      <span className="nav-mega-preview-badge">UTILITY</span>
                    </div>
                    <div className="nav-mega-preview-img-box">
                      <img key={selected.id || selected.to} src={selected.cover} alt="" decoding="async" />
                    </div>
                    <div key={selected.id || selected.to} className="nav-mega-preview-copy">
                      <div className="nav-mega-preview-heading">{selected.label}</div>
                      <div className="nav-mega-preview-desc">{selected.desc || selected.tagline}</div>
                    </div>
                  </div>
                  <Link
                    to={selected.to}
                    className="nav-mega-preview-action"
                    onClick={(event) => openNavLink(event, selected)}
                  >
                    <span>立即使用</span>
                    <i className="bi bi-arrow-right" />
                  </Link>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* 桌面端全景背景蒙层 */}
      <div
        className={`nav-backdrop${activeDropdown && (activeDropdown === "ecommerce" || activeDropdown === "image-design" || activeDropdown === "tools") ? " is-active" : ""}`}
        onClick={closeMenu}
      />
      <TrialAccessDialog
        open={trialDialogOpen}
        initialCampaign={trialCampaign}
        onClose={() => setTrialDialogOpen(false)}
      />
      <RedeemCodeDialog
        open={redeemDialogOpen}
        isDark={isDark}
        onClose={() => setRedeemDialogOpen(false)}
      />
      <LogoutDialog
        open={logoutOpen}
        busy={loggingOut}
        isDark={isDark}
        onClose={() => !loggingOut && setLogoutOpen(false)}
        onConfirm={confirmLogout}
      />
    </header>
  );
}
