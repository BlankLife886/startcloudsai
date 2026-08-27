import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Link, useLocation, useNavigate, useNavigation } from "react-router";
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
import "@react/legacy-styles/generated/components/layout/NavBar.css";
import "@react/legacy-styles/generated/components/layout/NavNotificationsMenu.css";

gsap.registerPlugin(useGSAP);

const imageLinks = [
  {
    id: "assistant",
    to: "/assistant",
    label: "AI 助手",
    icon: "bi-chat-square-text-fill",
    cover: "/sucai/studio-cover-assistant.webp",
  },
  {
    id: "t2i",
    to: "/text-to-image",
    label: "文生图",
    icon: "bi-stars",
    cover: "/sucai/studio-cover-t2i.webp",
  },
  {
    id: "model",
    to: "/model-sheet",
    label: "模型设计",
    icon: "bi-person-bounding-box",
    cover: "/sucai/studio-cover-model.webp",
  },
  {
    id: "coloring",
    to: "/ai-illustration-coloring",
    label: "插画染色",
    icon: "bi-brush-fill",
    cover: "/sucai/studio-cover-coloring.webp",
  },
  {
    id: "ui",
    to: "/design-workshop",
    label: "UI 设计稿",
    icon: "bi-bezier2",
    cover: "/sucai/studio-cover-ui.webp",
  },
  {
    id: "game",
    to: "/game-art",
    label: "游戏设计",
    icon: "bi-controller",
    cover: "/sucai/studio-cover-game.webp",
  },
];

const commerceModes = {
  tryon: ["AI 虚拟试衣", "虚拟试衣", "bi-person-standing-dress"],
  handheld: ["手持商品图", "手持商品", "bi-hand-index-thumb-fill"],
  accessory: ["AI 饰品穿戴", "饰品穿戴", "bi-gem"],
  shoot: ["AI 创意商拍", "AI 商拍", "bi-camera-fill"],
  listing: ["商品套图", "商品套图", "bi-images"],
  detail: ["A+ / 详情页", "A+ 详情", "bi-layout-text-window-reverse"],
  campaign: ["AI 营销图", "营销图", "bi-megaphone-fill"],
  background: ["AI 背景图", "背景生成", "bi-card-image"],
  backdrop: ["背景复刻", "背景复刻", "bi-layers-fill"],
  shadow: ["AI 商品阴影", "商品阴影", "bi-circle-half"],
  outpaint: ["智能扩图", "智能扩图", "bi-arrows-angle-expand"],
  enhance: ["真实增强", "清晰增强", "bi-badge-hd-fill"],
};

const commerceGroups = COMMERCE_ENTRY_GROUPS.map((group) => ({
  ...group,
  items: group.ids.map((id) => ({
    id,
    to: `/ecommerce-design?tool=${id}`,
    label: commerceModes[id][0],
    shortLabel: commerceModes[id][1],
    icon: commerceModes[id][2],
    tagline: commerceModes[id][1],
    cover: ecomToolCover(id),
  })),
}));

const baseTools = [
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
    type: "link",
    to: "/assets",
    label: "我的资产",
    icon: "bi-collection",
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
  const [activeDropdown, setActiveDropdown] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [balance, setBalance] = useState(0);
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
          return isEntryVisible(item.to) ? [item] : [];
        }
        const links = item.links.filter((link) => isEntryVisible(link.to));
        return links.length ? [{ ...item, links }] : [];
      }),
    [isEntryVisible, resolvedNavItems],
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
      if (!rootRef.current?.contains(event.target)) {
        setActiveDropdown("");
        setMobileOpen(false);
        setNotificationOpen(false);
      }
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
    setAccountOpen(false);
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
    return () => {
      controller.abort();
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
    };
  }, [auth.isAuthenticated]);

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
      if (!Number.isFinite(Number(event?.detail?.unreadCount))) return;
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
      window.removeEventListener("starclouds:notifications-updated", onUpdated);
    };
  }, [auth.isAuthenticated]);

  function toggleDropdown(name) {
    setActiveDropdown((current) => (current === name ? "" : name));
  }

  function closeMenu() {
    setActiveDropdown("");
    setMobileOpen(false);
    setAccountOpen(false);
    setNotificationOpen(false);
  }

  function showNotifications() {
    window.clearTimeout(notificationCloseTimerRef.current);
    setAccountOpen(false);
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
    setAccountOpen(false);
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

  return (
    <header
      ref={rootRef}
      className={`site-header${isDark ? " is-dark" : ""}${isCanvas ? " is-canvas" : ""}${scrolled ? " is-scrolled" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
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
                              <strong>
                                <i
                                  className={`bi ${link.icon}`}
                                  aria-hidden="true"
                                />
                                {link.label}
                              </strong>
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
              {checkinVisible && (
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
              {trialVisible && trialCampaign && (
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
                  <div
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
                        setAccountOpen(false);
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
                                    to="/notifications"
                                    onClick={closeMenu}
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
                  </div>
                  <div className={`account-menu${accountOpen ? " open" : ""}`}>
                    <button
                      type="button"
                      className={`account-cluster${accountOpen || isActive("/profile") ? " active" : ""}`}
                      aria-expanded={accountOpen}
                      aria-haspopup="menu"
                      title="个人中心"
                      onClick={(event) => {
                        event.stopPropagation();
                        setAccountOpen((open) => !open);
                        setNotificationOpen(false);
                        setActiveDropdown("");
                      }}
                    >
                      <span className="account-cluster__credits">
                        <span
                          className="account-cluster__icon"
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M9.15 1.08 3.42 8.55c-.22.29 0 .72.36.72h3.35l-1.2 5.55c-.12.54.53.9.84.46l5.73-7.47c.22-.29 0-.72-.36-.72H8.79l1.2-5.55c.12-.54-.53-.9-.84-.46Z" />
                          </svg>
                        </span>
                        <span className="account-cluster__value">
                          {Math.round(balance).toLocaleString("zh-CN")}
                        </span>
                      </span>
                      <span
                        className="account-cluster__divider"
                        aria-hidden="true"
                      />
                      <span className="account-chip" aria-hidden="true">
                        <img
                          className="account-chip__avatar"
                          src={
                            auth.user?.avatarUrl ||
                            "/brand/avatar-placeholder.svg"
                          }
                          alt=""
                        />
                      </span>
                    </button>
                    {accountOpen && (
                      <div
                        className="account-menu__panel"
                        role="menu"
                        aria-label="个人中心菜单"
                      >
                        <div className="account-menu__head">
                          <img
                            className="account-menu__avatar"
                            src={
                              auth.user?.avatarUrl ||
                              "/brand/avatar-placeholder.svg"
                            }
                            alt=""
                          />
                          <div className="account-menu__copy">
                            <strong>
                              {auth.user?.username ||
                                auth.user?.email ||
                                "创作者"}
                            </strong>
                            <small>
                              {Math.round(balance).toLocaleString("zh-CN")} 积分
                            </small>
                          </div>
                        </div>
                        <div className="account-menu__list">
                          {[
                            ["/profile", "bi-person-circle", "个人中心"],
                            ["/submissions", "bi-send-check", "我的投稿"],
                            ["/wallet", "bi-wallet2", "我的钱包"],
                            ["/account", "bi-person-gear", "账号设置"],
                          ].map(([to, icon, label]) => (
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
                          <button
                            type="button"
                            className="account-menu__item is-danger"
                            role="menuitem"
                            onClick={requestLogout}
                          >
                            <i
                              className="bi bi-box-arrow-right"
                              aria-hidden="true"
                            />
                            <span>退出登录</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <Link
                  to={`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}&mode=login`}
                  className="account-login"
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
