import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { displayNotification, notificationKind } from "../utils/notificationDisplay.js";

const GROUP_LABELS = {
  task: "创作任务",
  wallet: "账户与订单",
  review: "投稿审核",
  trial: "体验资格",
  assistant: "AI 助手",
  other: "系统通知",
};

function groupKeyOf(item) {
  const kind = notificationKind(item);
  if (kind.scope !== "other") return kind.scope;
  return kind.label === "AI 助手" ? "assistant" : "other";
}

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 0.7, 0.2)";

function motionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function flipTops(list) {
  const tops = new Map();
  for (const node of list?.querySelectorAll("[data-flip]") || []) {
    tops.set(node.dataset.flip, node.getBoundingClientRect().top);
  }
  return tops;
}

// 铃铛弹窗：同类通知叠成一摞（通知中心式），点一摞展开该类
export function NavNotificationStack({ items, linkOf, onOpen, formatTime }) {
  const [expanded, setExpanded] = useState("");
  const listRef = useRef(null);
  const flipRef = useRef(null);
  const busyRef = useRef(false);

  // FLIP：展开时新出现的卡片从那一摞的位置散开，其余元素从旧位置滑到新位置
  useLayoutEffect(() => {
    const flip = flipRef.current;
    flipRef.current = null;
    if (!flip || motionDisabled()) return;
    const origin = flip.tops.get(`card:${flip.originId}`);
    let spread = 0;
    for (const node of listRef.current?.querySelectorAll("[data-flip]") || []) {
      const top = node.getBoundingClientRect().top;
      const before = flip.tops.get(node.dataset.flip);
      if (before !== undefined) {
        if (Math.abs(before - top) > 0.5) {
          node.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
            duration: 360,
            easing: EASE_OUT,
          });
        }
        continue;
      }
      if (origin === undefined) continue;
      if (node.classList.contains("nav-notify__group-head")) {
        node.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], {
          duration: 240,
          delay: 80,
          easing: EASE_OUT,
          fill: "backwards",
        });
        continue;
      }
      spread += 1;
      const depth = Math.min(spread, 2);
      node.animate(
        [
          {
            transform: `translateY(${origin - top + depth * 7}px) scale(${1 - depth * 0.045})`,
            opacity: spread > 2 ? 0 : 1,
          },
          { transform: "none", opacity: 1 },
        ],
        { duration: 420, delay: spread * 35, easing: EASE_OUT, fill: "backwards" },
      );
    }
  }, [expanded]);

  function expandGroup(key, originId) {
    if (busyRef.current) return;
    flipRef.current = { tops: flipTops(listRef.current), originId };
    setExpanded(key);
  }

  // 收起：先把下面的卡片收回第一张后面，再切换状态让后面的分组滑上来
  function collapse(group) {
    if (busyRef.current) return;
    const list = listRef.current;
    const cards = [...(list?.querySelectorAll(`[data-group-cards="${group.key}"] > .nav-notify__card`) || [])];
    const done = () => {
      busyRef.current = false;
      flipRef.current = { tops: flipTops(list), originId: "" };
      setExpanded("");
    };
    if (motionDisabled() || cards.length < 2) return done();
    busyRef.current = true;
    const firstTop = cards[0].getBoundingClientRect().top;
    const runs = cards.slice(1).map((node, index) => {
      const depth = Math.min(index + 1, 2);
      return node.animate(
        [
          { transform: "none", opacity: 1 },
          {
            transform: `translateY(${firstTop - node.getBoundingClientRect().top + depth * 7}px) scale(${1 - depth * 0.045})`,
            opacity: index > 1 ? 0 : 0.6,
          },
        ],
        { duration: 240, easing: EASE_IN, fill: "forwards" },
      ).finished;
    });
    Promise.all(runs).then(done, done);
  }
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const item of items) {
      const key = groupKeyOf(item);
      if (!byKey.has(key)) byKey.set(key, { key, label: GROUP_LABELS[key], items: [] });
      byKey.get(key).items.push(item);
    }
    return [...byKey.values()];
  }, [items]);

  // expand 存在时（收起的一摞）：整张卡片点了先展开，不跳转
  function renderCard(item, head, expand) {
    const { title, body } = displayNotification(item);
    const time = <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>;
    return (
      <div className={`nav-notify__card${item.readAt ? "" : " is-unread"}`} key={item.id} data-flip={`card:${item.id}`}>
        {head ? (
          <div className="nav-notify__card-head">
            {head}
            {time}
          </div>
        ) : null}
        {expand ? (
          // 点击冒泡到外层 li 统一展开（露出的纸片也要能点）
          <button type="button" className="nav-notify__card-link" aria-label={expand.label}>
            <strong>{title}</strong>
            {!item.readAt && <i className="nav-notify__dot" aria-hidden="true" />}
          </button>
        ) : (
          <Link className="nav-notify__card-link" to={linkOf(item)} onClick={() => onOpen(item)}>
            <strong>{title}</strong>
            {head ? null : time}
            {!item.readAt && <i className="nav-notify__dot" aria-label="未读" />}
          </Link>
        )}
        {body ? <p>{body}</p> : null}
      </div>
    );
  }

  return (
    <ol className="nav-notify__list" ref={listRef}>
      {groups.map((group) => {
        const count = group.items.length;
        const open = expanded === group.key && count > 1;
        const unread = group.items.filter((item) => !item.readAt).length;
        const label = (
          <span className="nav-notify__cat" data-group={group.key}>
            {group.label}
          </span>
        );
        if (open) {
          return (
            <li key={group.key} className="nav-notify__group is-open" data-group-cards={group.key}>
              <div className="nav-notify__group-head" data-flip={`head:${group.key}`}>
                {label}
                <button type="button" className="nav-notify__more" onClick={() => collapse(group)}>
                  收起
                </button>
              </div>
              {group.items.map((item) => renderCard(item, null))}
            </li>
          );
        }
        const stacked = count > 1 ? (count > 2 ? " is-stacked is-stacked-deep" : " is-stacked") : "";
        const expand =
          count > 1
            ? { label: `展开${group.label}的 ${count} 条通知`, onClick: () => expandGroup(group.key, group.items[0].id) }
            : null;
        return (
          <li key={group.key} className={`nav-notify__group${stacked}`} onClick={expand?.onClick}>
            {renderCard(
              group.items[0],
              <>
                {label}
                {expand && (
                  <span className="nav-notify__more" aria-hidden="true">
                    {unread > 1 ? `${unread} 条未读` : `共 ${count} 条`}
                  </span>
                )}
              </>,
              expand,
            )}
          </li>
        );
      })}
    </ol>
  );
}
