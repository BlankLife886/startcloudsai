import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import "./mention-menu.css";

export function MentionMenu({
  open,
  kind = "skill",
  query = "",
  items = [],
  activeIndex = 0,
  loading = false,
  placement = "above",
  style,
  onSelect,
  onHover,
}) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open || typeof document === "undefined" || !style?.left) return null;

  const emptyLabel =
    kind === "skill" ? (
      <>
        没有匹配的技能，
        <a href="/skills">去技能库新建</a>
      </>
    ) : (
      "没有匹配的提示词"
    );

  return createPortal(
    <div
      data-mention-menu
      className={`mention-menu is-floating mention-menu--${placement}`}
      style={style}
      role="listbox"
      aria-label={kind === "skill" ? "选择技能" : "选择提示词"}
      aria-busy={loading || undefined}
    >
      <div className="mention-menu__head">
        {kind === "skill" ? "技能" : "提示词"}
        <em>{kind === "skill" ? "@" : "/"}{query}</em>
      </div>
      <div className="mention-menu__list">
        {items.length ? (
          items.map((item, index) => {
            const selected = index === activeIndex;
            return (
              <button
                key={item.id}
                ref={selected ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                className={`mention-menu__item${selected ? " is-active" : ""}`}
                onMouseEnter={() => onHover?.(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect?.(item);
                }}
              >
                <span className="mention-menu__copy">
                  <span className="mention-menu__title">{item.title}</span>
                  {item.description ? <span className="mention-menu__desc">{item.description}</span> : null}
                </span>
                {item.badge ? <span className="mention-menu__badge">{item.badge}</span> : null}
              </button>
            );
          })
        ) : (
          <div className="mention-menu__empty">
            {loading ? "加载中…" : emptyLabel}
            {!loading && query ? <small>「{query}」</small> : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
