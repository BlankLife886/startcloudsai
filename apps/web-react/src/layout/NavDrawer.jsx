import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useLocale } from "../i18n/index.js";
import { setAppearance } from "../theme/appearance.js";
import { useAppearancePreference } from "../hooks/useAppearancePreference.js";
import "./NavDrawer.css";

// 窄屏（≤1180）主导航侧边栏：宫格放常用入口，创作工具按分组折叠，底部是外观与语言。
// 入口全部来自 NavBar 已按后台开关过滤过的 visibleNavItems，这里只决定摆放。
const APPEARANCE_OPTIONS = [
  { value: "light", label: "浅色", icon: "bi-sun" },
  { value: "dark", label: "深色", icon: "bi-moon-stars" },
  { value: "system", label: "跟随系统", icon: "bi-circle-half" },
];

const BENTO = [
  { to: "/", label: "首页", sub: "发现灵感与新作", icon: "bi-house-door-fill", kind: "wide" },
  { to: "/canvas", label: "无限画布", sub: "节点式自由编排", cover: "/sucai/covers/cover-canvas-workflow.webp", kind: "tall" },
  { to: "/studio", label: "创作台", sub: "全部创作工具", icon: "bi-grid-1x2-fill", kind: "wide" },
  { to: "/assistant", label: "AI 助手", sub: "对话式创作", cover: "/sucai/covers/cover-assistant.webp", kind: "banner" },
  { to: "/text-to-image", label: "文生图", sub: "一句话出图", cover: "/sucai/covers/cover-t2i.webp", kind: "banner" },
];
const SHORTCUTS = [
  { to: "/prompts", label: "提示词" },
  { to: "/skills", label: "技能库" },
  { to: "/share", label: "社区" },
  { to: "/history", label: "历史" },
];
const ACCOUNT = [
  { to: "/pricing", label: "创作价格", icon: "bi-credit-card-2-front" },
  { to: "/incentive-plans", label: "创作激励", icon: "bi-gift" },
];
const GROUP_LABELS = { tools: "实用工具" };
const GROUP_ICONS = { tools: "bi-tools" };
const PINNED = new Set(BENTO.map((entry) => entry.to));

export function NavDrawer({ open, onClose, isDark, items, isActive, isPending, onNavigate }) {
  const appearancePreference = useAppearancePreference();
  const { locale, option: currentLocale, options: localeOptions, setLocale } = useLocale();
  const [openGroup, setOpenGroup] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeRef = useRef(null);

  const linkByPath = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      if (item.type === "link") map.set(item.to, item);
      else item.links.forEach((link) => map.set(link.to, link));
    });
    return map;
  }, [items]);

  const groups = useMemo(
    () =>
      items
        .filter((item) => item.type !== "link")
        .map((item) => ({ ...item, links: item.links.filter((link) => !PINNED.has(link.to)) }))
        .filter((item) => item.links.length > 0),
    [items],
  );

  // 打开时展开当前页面所在的分组，并把焦点交给关闭按钮
  useEffect(() => {
    if (!open) {
      setLangOpen(false);
      return;
    }
    const current = groups.find((group) => group.links.some((link) => isActive(link.to)));
    setOpenGroup(current?.name || "");
    closeRef.current?.focus({ preventScroll: true });
    // 只在打开的那一刻定位一次，之后用户自己开合
  }, [open]);

  const entry = (to) => linkByPath.get(to);
  const navProps = (link) => ({
    to: link.to,
    "aria-current": isActive(link.to) ? "page" : undefined,
    "aria-disabled": isPending(link.to) ? "true" : undefined,
    onClick: (event) => onNavigate(event, link),
  });

  const bento = BENTO.filter((tile) => entry(tile.to));
  const shortcuts = SHORTCUTS.filter((tile) => entry(tile.to));
  const account = ACCOUNT.filter((row) => entry(row.to));

  return createPortal(
    <div className={`nav-drawer-root${open ? " is-open" : ""}${isDark ? " is-dark" : ""}`}>
      <div className="nav-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        className={`nav-drawer${scrolled ? " is-scrolled" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="主导航"
        aria-hidden={!open}
        onClick={(event) => {
          if (!event.target.closest(".nav-drawer__lang, .nav-drawer__lang-menu")) setLangOpen(false);
        }}
      >
        <div className="nav-drawer__bar">
          <button ref={closeRef} type="button" className="nav-drawer__close" aria-label="关闭主导航" onClick={onClose}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="nav-drawer__body" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 4)}>
          <div className="nav-drawer__bento">
            {bento.map((tile) => {
              const link = entry(tile.to);
              return (
                <Link
                  key={tile.to}
                  {...navProps(link)}
                  className={`nav-drawer__tile is-${tile.kind}${tile.cover ? " has-cover" : ""}${isActive(tile.to) ? " is-active" : ""}`}
                >
                  {tile.cover ? <img src={tile.cover} alt="" decoding="async" /> : null}
                  {tile.icon ? (
                    <span className="nav-drawer__tile-icon" aria-hidden="true">
                      <i className={`bi ${tile.icon}`} />
                    </span>
                  ) : null}
                  <span className="nav-drawer__tile-text">
                    <b>{tile.label}</b>
                    <small>{tile.sub}</small>
                  </span>
                </Link>
              );
            })}
          </div>
          {shortcuts.length ? (
            <div className="nav-drawer__shortcuts" style={{ "--count": shortcuts.length }}>
              {shortcuts.map((tile) => (
                <Link
                  key={tile.to}
                  {...navProps(entry(tile.to))}
                  className={`nav-drawer__shortcut${isActive(tile.to) ? " is-active" : ""}`}
                >
                  {tile.label}
                </Link>
              ))}
            </div>
          ) : null}

          {groups.length ? (
            <>
              <h3 className="nav-drawer__heading">创作工具</h3>
              <div className="nav-drawer__card">
                {groups.map((group) => {
                  const expanded = openGroup === group.name;
                  const covers = group.links.filter((link) => link.cover);
                  const panelId = `nav-drawer-group-${group.name}`;
                  return (
                    <div key={group.name} className={`nav-drawer__group${expanded ? " is-open" : ""}`}>
                      <button
                        type="button"
                        className="nav-drawer__row"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => setOpenGroup(expanded ? "" : group.name)}
                      >
                        <span className="nav-drawer__stack" aria-hidden="true">
                          {covers.length ? (
                            covers.slice(0, 3).map((link) => <img key={link.to} src={link.cover} alt="" decoding="async" />)
                          ) : (
                            <span className="nav-drawer__stack-icon">
                              <i className={`bi ${GROUP_ICONS[group.name] || group.icon}`} />
                            </span>
                          )}
                        </span>
                        <b>{GROUP_LABELS[group.name] || group.label}</b>
                        <small>{group.links.length}</small>
                        <i className="bi bi-chevron-right nav-drawer__chevron" aria-hidden="true" />
                      </button>
                      <div id={panelId} className="nav-drawer__panel">
                        <div>
                          {covers.length === group.links.length ? (
                            <div className="nav-drawer__thumbs">
                              {group.links.map((link, index) => (
                                <Link
                                  key={link.to}
                                  {...navProps(link)}
                                  tabIndex={expanded ? undefined : -1}
                                  style={{ "--i": index }}
                                  className={`nav-drawer__thumb${isActive(link.to) ? " is-active" : ""}`}
                                >
                                  <span className="nav-drawer__thumb-img">
                                    <img src={link.cover} alt="" loading="lazy" decoding="async" />
                                  </span>
                                  <span className="nav-drawer__thumb-label">{link.shortLabel || link.label}</span>
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <div className="nav-drawer__lines">
                              {group.links.map((link, index) => (
                                <Link
                                  key={link.to}
                                  {...navProps(link)}
                                  tabIndex={expanded ? undefined : -1}
                                  style={{ "--i": index }}
                                  className={`nav-drawer__line${isActive(link.to) ? " is-active" : ""}`}
                                >
                                  <i className={`bi ${link.icon}`} aria-hidden="true" />
                                  {link.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {account.length ? (
            <>
              <h3 className="nav-drawer__heading">账户</h3>
              <div className="nav-drawer__card">
                {account.map((row) => (
                  <Link
                    key={row.to}
                    {...navProps(entry(row.to))}
                    className={`nav-drawer__row${isActive(row.to) ? " is-active" : ""}`}
                  >
                    <i className={`bi ${row.icon} nav-drawer__row-icon`} aria-hidden="true" />
                    <b>{row.label}</b>
                    <i className="bi bi-chevron-right nav-drawer__chevron" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="nav-drawer__foot">
          <div className={`nav-drawer__seg is-${appearancePreference}`} role="radiogroup" aria-label="外观">
            <span className="nav-drawer__seg-thumb" aria-hidden="true" />
            {APPEARANCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={appearancePreference === option.value}
                aria-label={option.label}
                title={option.label}
                onClick={() => setAppearance(option.value)}
              >
                <i className={`bi ${option.icon}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`nav-drawer__lang${langOpen ? " is-open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={langOpen}
            onClick={() => setLangOpen((value) => !value)}
          >
            <i className="bi bi-translate" aria-hidden="true" />
            <span>{currentLocale.label}</span>
            <i className="bi bi-chevron-up" aria-hidden="true" />
          </button>
          <ul className={`nav-drawer__lang-menu${langOpen ? " is-open" : ""}`} role="listbox" aria-label="语言">
            {localeOptions.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === locale}
                  tabIndex={langOpen ? undefined : -1}
                  onClick={() => {
                    setLocale(option.value);
                    setLangOpen(false);
                  }}
                >
                  {option.label}
                  {option.value === locale ? <i className="bi bi-check2" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
