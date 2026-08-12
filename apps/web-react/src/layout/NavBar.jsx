import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { LocaleSwitcher } from "./LocaleSwitcher.jsx";
import { ThemeSwitch } from "./ThemeSwitch.jsx";
import { TrialAccessDialog } from "../components/TrialAccessDialog.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { getWallet, listNotifications } from "@react/legacy-modules/services/meApi.js";
import { logoutAccount } from "@react/legacy-modules/services/auth.js";
import { getTrialAccessCampaign } from "@react/legacy-modules/services/trialAccessApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import tryonPreview from "@react/legacy-static/assets/ecommerce/tryon-preview.webp";
import listingPreview from "@react/legacy-static/assets/ecommerce/listing-preview.webp";
import detailPreview from "@react/legacy-static/assets/ecommerce/detail-preview.webp";
import "@react/legacy-styles/generated/components/layout/NavBar.css";
import "@react/legacy-styles/generated/components/layout/NavNotificationsMenu.css";

const imageLinks = [
  {
    id: "assistant",
    to: "/assistant",
    label: "AI 助手",
    icon: "bi-chat-square-text-fill",
    cover: "/sucai/home-intro-02.png",
    bento: "hero",
  },
  {
    id: "model",
    to: "/model-sheet",
    label: "模型设计",
    icon: "bi-person-bounding-box",
    cover: "/sucai/ultra-model-sheet-board-1785420340076.png",
  },
  {
    id: "t2i",
    to: "/text-to-image",
    label: "文生图",
    icon: "bi-stars",
    cover:
      "/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.png",
  },
  {
    id: "coloring",
    to: "/ai-illustration-coloring",
    label: "插画染色",
    icon: "bi-brush-fill",
    cover: "/sucai/home-intro-03.png",
  },
  {
    id: "ui",
    to: "/design-workshop",
    label: "UI 设计稿",
    icon: "bi-bezier2",
    cover: "/sucai/ui-design-1785420316960.png",
  },
  {
    id: "game",
    to: "/game-art",
    label: "游戏设计",
    icon: "bi-controller",
    cover: "/sucai/game-character-1785420168113.png",
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

const commerceGroups = [
  {
    id: "model",
    label: "服饰模特",
    description: "服装、商品与饰品的真人展示",
    cover: tryonPreview,
    ids: ["tryon", "handheld", "accessory"],
  },
  {
    id: "create",
    label: "商品设计",
    description: "商拍、套图与详情页视觉",
    cover: listingPreview,
    ids: ["shoot", "listing", "detail"],
  },
  {
    id: "image",
    label: "图片处理",
    description: "营销图、背景、阴影与画质处理",
    cover: detailPreview,
    ids: [
      "campaign",
      "background",
      "backdrop",
      "shadow",
      "outpaint",
      "enhance",
    ],
  },
].map((group) => ({
  ...group,
  items: group.ids.map((id) => ({
    id,
    to: `/ecommerce-design?tool=${id}`,
    label: commerceModes[id][0],
    shortLabel: commerceModes[id][1],
    icon: commerceModes[id][2],
    tagline: commerceModes[id][1],
  })),
}));

const tools = [
  ["/tools/background-remove", "背景移除", "bi-person-bounding-box"],
  ["/tools/image-compress", "图片压缩", "bi-file-zip"],
  ["/tools/puzzle", "拼图", "bi-puzzle-fill"],
  ["/app-space", "关于我们", "bi-columns-gap"],
  ["/updates", "更新说明", "bi-megaphone-fill"],
  ["/feedback", "问题反馈", "bi-chat-square-text"],
].map(([to, label, icon]) => ({ to, label, icon }));

const navItems = [
  {
    type: "link",
    id: "home",
    to: "/",
    label: "首页",
    icon: "bi-house-door-fill",
  },
  { type: "link", to: "/studio", label: "创作台", icon: "bi-grid-1x2-fill" },
  {
    type: "link",
    to: "/canvas",
    label: "智能画布",
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
  { type: "link", to: "/share", label: "社区", icon: "bi-images" },
  { type: "link", to: "/history", label: "历史记录", icon: "bi-clock-history" },
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
    links: tools,
  },
];

function routePath(to) {
  return String(to || "").split("?")[0];
}

export function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const rootRef = useRef(null);
  const [activeDropdown, setActiveDropdown] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [balance, setBalance] = useState(0);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [trialCampaign, setTrialCampaign] = useState(null);
  const [trialDialogOpen, setTrialDialogOpen] = useState(false);

  const isActive = (to) =>
    location.pathname === routePath(to) ||
    (routePath(to) !== "/" &&
      location.pathname.startsWith(`${routePath(to)}/`));
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
  }, [location.pathname, location.search]);

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
    let disposed = false;
    const refresh = () =>
      getTrialAccessCampaign()
        .then((campaign) => {
          if (!disposed) setTrialCampaign(campaign?.enabled === true && campaign?.status === "active" ? campaign : null);
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
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("trial") !== "apply") return;
    params.delete("trial");
    navigate(`${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`, { replace: true });
    getTrialAccessCampaign()
      .then((campaign) => {
        if (campaign?.enabled === true && campaign?.status === "active") {
          setTrialCampaign(campaign);
          setTrialDialogOpen(true);
        } else notificationService.info("当前没有开放中的体验活动");
      })
      .catch((error) => notificationService.error(error?.message || "体验活动读取失败"));
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setNotificationUnread(0);
      return undefined;
    }
    const controller = new AbortController();
    const onUpdated = (event) => {
      if (!Number.isFinite(Number(event?.detail?.unreadCount))) return;
      setNotificationUnread(Math.max(0, Number(event.detail.unreadCount)));
    };
    window.addEventListener("starclouds:notifications-updated", onUpdated);
    listNotifications({ limit: 8, signal: controller.signal })
      .then((result) =>
        setNotificationUnread(Math.max(0, Number(result.unread) || 0)),
      )
      .catch(() => null);
    return () => {
      controller.abort();
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
  }

  async function logout() {
    await logoutAccount().catch(() => null);
    auth.setUser(null);
    closeMenu();
  }

  async function openTrialDialog() {
    closeMenu();
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

  return (
    <header
      ref={rootRef}
      className={`site-header${scrolled ? " is-scrolled" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
    >
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
                <small>StarCloudIsAI</small>
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
            {navItems.map((item) =>
              item.type === "link" ? (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-link${item.id === "home" ? " nav-home-link" : ""}${isActive(item.to) ? " active router-link-exact-active" : ""}`}
                  aria-current={isActive(item.to) ? "page" : undefined}
                  onClick={closeMenu}
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
                      {commerceGroups.map((group) => (
                        <section
                          key={group.id}
                          className={`commerce-menu-group is-${group.id}`}
                          aria-label={group.label}
                        >
                          <div
                            className="commerce-menu-group__visual"
                            aria-hidden="true"
                          >
                            <img src={group.cover} alt="" loading="lazy" />
                            <div className="commerce-menu-group__caption">
                              <strong>{group.label}</strong>
                              <small>{group.description}</small>
                            </div>
                          </div>
                          <div className="commerce-menu-grid">
                            {group.items.map((link) => (
                              <Link
                                key={link.to}
                                to={link.to}
                                className={`commerce-menu-card${isActive(link.to) ? " active" : ""}`}
                                role="menuitem"
                                onClick={closeMenu}
                              >
                                <span className="commerce-menu-card__icon">
                                  <i className={`bi ${link.icon}`} />
                                </span>
                                <span className="commerce-menu-card__copy">
                                  <strong>{link.label}</strong>
                                  <small>{link.tagline}</small>
                                </span>
                              </Link>
                            ))}
                          </div>
                        </section>
                      ))}
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
                            className={`nav-bento-card is-${link.bento || "tile"} is-${link.id}${isActive(link.to) ? " active" : ""}`}
                            role="menuitem"
                            onClick={closeMenu}
                          >
                            <span className="nav-bento-card__media">
                              <img src={link.cover} alt="" loading="lazy" />
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
                          className={`nav-dropdown-item${isActive(link.to) ? " active" : ""}`}
                          role="menuitem"
                          onClick={closeMenu}
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
              <Link
                to="/check-in"
                className="nav-checkin-btn"
                data-no-translate
                title="每日签到领积分"
                onClick={closeMenu}
              >
                <span className="nav-checkin-btn__icon" aria-hidden="true">
                  <i className="bi bi-calendar-check" />
                </span>
                <span className="nav-checkin-btn__label">签到</span>
              </Link>
              <button
                type="button"
                className="nav-redeem-btn"
                data-no-translate
                title="兑换码入账"
              >
                <span className="nav-redeem-btn__icon" aria-hidden="true">
                  <i className="bi bi-ticket-perforated" />
                </span>
                <span className="nav-redeem-btn__label">兑换</span>
              </button>
              {trialCampaign && (
                <button
                  type="button"
                  className="nav-trial-btn"
                  data-no-translate
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
                    className={`nav-notify${notificationUnread > 0 ? " has-unread" : ""}`}
                  >
                    <Link
                      to="/notifications"
                      className="nav-notify__btn"
                      aria-label="通知"
                      title="通知"
                      onClick={() => setAccountOpen(false)}
                    >
                      <i className="bi bi-bell" aria-hidden="true" />
                      {notificationUnread > 0 && (
                        <em className="nav-notify__badge">
                          {notificationUnread > 99 ? "99+" : notificationUnread}
                        </em>
                      )}
                    </Link>
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
                            ["/wallet", "bi-wallet2", "钱包"],
                            ["/account", "bi-person-gear", "账号设置"],
                            ["/materials", "bi-collection", "素材库"],
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
                            onClick={logout}
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
    </header>
  );
}
