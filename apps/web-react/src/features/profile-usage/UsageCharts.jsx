import { useEffect, useRef, useState } from "react";
import { hourRangeLabel, niceTicks } from "./usageStats.js";

const AXIS_WIDTH = 40;
const AXIS_HEIGHT = 22;
const TOP_PAD = 10;
const MAX_BAR = 24;

function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const box = node.getBoundingClientRect();
      setSize((current) =>
        current.width === Math.floor(box.width) && current.height === Math.floor(box.height)
          ? current
          : { width: Math.floor(box.width), height: Math.floor(box.height) },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

const TWEEN_MS = 520;
const STAGGER_MS = 200;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * 柱高与纵轴上限的补间：新出现的柱子从基线依次长出，已有的柱子从当前高度过渡到新值。
 * 动画中途数据再变时从当前帧接着过渡，不会跳回。
 */
function useTweenedBars(items, top, enabled) {
  const [frame, setFrame] = useState({ values: {}, top });
  const frameRef = useRef(frame);
  const signature = `${top}|${items.map((item) => `${item.key}:${item.value}`).join(",")}`;

  useEffect(() => {
    if (!enabled) return undefined;
    const commit = (next) => {
      frameRef.current = next;
      setFrame(next);
    };
    const target = { values: Object.fromEntries(items.map((item) => [item.key, item.value])), top };
    if (prefersReducedMotion()) {
      commit(target);
      return undefined;
    }
    const from = frameRef.current;
    const fromTop = Object.keys(from.values).length ? from.top : top;
    const last = Math.max(1, items.length - 1);
    const plan = items.map((item, index) => {
      const start = from.values[item.key];
      const entering = start === undefined;
      return { key: item.key, start: entering ? 0 : start, end: item.value, delay: entering ? (index / last) * STAGGER_MS : 0 };
    });
    const startedAt = performance.now();
    let raf = 0;
    const step = (now) => {
      const elapsed = now - startedAt;
      const values = {};
      plan.forEach((bar) => {
        const progress = easeOutCubic(Math.min(1, Math.max(0, (elapsed - bar.delay) / TWEEN_MS)));
        values[bar.key] = bar.start + (bar.end - bar.start) * progress;
      });
      commit({ values, top: fromTop + (top - fromTop) * easeOutCubic(Math.min(1, elapsed / TWEEN_MS)) });
      if (elapsed < TWEEN_MS + STAGGER_MS) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [signature, enabled]);

  return frame;
}

// 顶部 4px 圆角、底部贴基线的柱子。
function barPath(x, y, width, height) {
  if (height <= 0) return "";
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * 单序列柱状图：细柱、整齐刻度、悬停提示。items: [{ key, label, title, value }]。
 * 标签过密时按间隔抽稀，完整数值见提示与屏幕阅读器表格。height="fill" 时撑满父容器高度。
 */
export function UsageBarChart({ items, height = 200, formatValue = String, caption, highlightKey, labelAnchor = "end" }) {
  const [ref, size] = useElementSize();
  const width = size.width;
  const fill = height === "fill";
  height = fill ? Math.max(96, size.height) : height;
  const [hover, setHover] = useState(-1);
  // 移出后保留最后一次悬停的柱子，让提示和高亮带淡出而不是瞬间消失。
  const [lastHover, setLastHover] = useState(-1);
  const maxValue = Math.max(0, ...items.map((item) => item.value));
  const ticks = niceTicks(maxValue);
  const top = ticks[ticks.length - 1] || 1;
  const frame = useTweenedBars(items, top, width > 0);
  const shownTop = frame.top || 1;
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const plotHeight = height - AXIS_HEIGHT - TOP_PAD;
  const band = items.length ? plotWidth / items.length : 0;
  const barWidth = Math.max(2, Math.min(MAX_BAR, band - 2, band * 0.62));
  const labelEvery = Math.max(1, Math.ceil(46 / Math.max(band, 1)));
  const y = (value) => TOP_PAD + plotHeight - (Math.min(value, shownTop) / shownTop) * plotHeight;
  const shownValue = (item) => frame.values[item.key] ?? 0;
  // 提示框始终挂载（未悬停时透明），首次悬停也能淡入。
  const focus = Math.min(Math.max(hover >= 0 ? hover : lastHover, 0), items.length - 1);
  const focused = items[focus];
  const enter = (index) => {
    setHover(index);
    setLastHover(index);
  };

  return (
    <figure className={`pp-usage-chart${fill ? " is-fill" : ""}${hover >= 0 ? " is-hovering" : ""}`} ref={ref} onMouseLeave={() => setHover(-1)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={caption}>
          {ticks.map((tick) => (
            <g key={tick} className={`pp-usage-chart__grid${tick > shownTop * 1.001 ? " is-out" : ""}`}>
              <line x1={AXIS_WIDTH} x2={width} y1={y(tick)} y2={y(tick)} />
              <text x={AXIS_WIDTH - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatValue(tick, true)}
              </text>
            </g>
          ))}
          {band > 0 && (
            <rect
              className="pp-usage-chart__band"
              x={AXIS_WIDTH}
              y={TOP_PAD}
              width={band}
              height={plotHeight}
              rx={Math.min(6, band / 4)}
              style={{ transform: `translateX(${focus * band}px)` }}
            />
          )}
          {items.map((item, index) => {
            const x = AXIS_WIDTH + index * band + (band - barWidth) / 2;
            const value = shownValue(item);
            const barHeight = Math.max(0, TOP_PAD + plotHeight - y(value));
            // 默认保证最后一根（通常是今天）有标签；时段图从 0 点开始对齐。
            const showLabel = index % labelEvery === (labelAnchor === "start" ? 0 : (items.length - 1) % labelEvery);
            return (
              <g key={item.key}>
                <path
                  className={`pp-usage-chart__bar${hover >= 0 && hover !== index ? " is-dim" : ""}${hover === index ? " is-active" : ""}${item.key === highlightKey ? " is-current" : ""}`}
                  d={barPath(x, y(value), barWidth, barHeight)}
                />
                {showLabel && (
                  <text className={`pp-usage-chart__x${hover === index ? " is-active" : ""}`} x={AXIS_WIDTH + index * band + band / 2} y={height - 6} textAnchor="middle">
                    {item.label}
                  </text>
                )}
                <rect
                  className="pp-usage-chart__hit"
                  x={AXIS_WIDTH + index * band}
                  y={TOP_PAD}
                  width={band}
                  height={plotHeight}
                  onMouseEnter={() => enter(index)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {focused && (
        <div
          className={`pp-usage-tooltip${hover >= 0 ? " is-visible" : ""}`}
          aria-hidden={hover < 0}
          style={{
            left: `${Math.min(Math.max(AXIS_WIDTH + focus * band + band / 2, 70), Math.max(70, width - 70))}px`,
            top: `${Math.max(0, y(shownValue(focused)) - 10)}px`,
          }}
        >
          <span>{focused.title}</span>
          <strong>{formatValue(focused.value)}</strong>
        </div>
      )}
      <table className="pp-usage-sr">
        <caption>{caption}</caption>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <th scope="row">{item.title}</th>
              <td>{formatValue(item.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** 星期 × 小时迷你热力图：同一色相由浅到深表示次数，悬停格子看具体次数。 */
export function UsageMiniHeatmap({ rows, max }) {
  const level = (count) => (count > 0 && max > 0 ? 0.2 + 0.8 * (count / max) : 0);
  return (
    <div className="pp-mini-heat" role="img" aria-label="一周各时段的创作次数，颜色越深次数越多">
      {rows.map((row) => (
        <div key={row.index} className="pp-mini-heat__row">
          <span>{row.label.slice(1)}</span>
          {row.hours.map((count, hour) => (
            <i
              key={hour}
              className={count ? undefined : "is-empty"}
              style={count ? { "--level": level(count), "--col": hour } : { "--col": hour }}
              title={`${row.label} ${hourRangeLabel(hour)} · ${count} 次`}
            />
          ))}
        </div>
      ))}
      <div className="pp-mini-heat__axis" aria-hidden="true">
        <span />
        <em>0</em>
        <em>6</em>
        <em>12</em>
        <em>18</em>
        <em>24</em>
      </div>
    </div>
  );
}

/** 迷你柱图：无坐标轴，末柱（今天）实色、其余半透明，悬停看数值。 */
export function UsageMiniBars({ items, formatValue = String }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="pp-mini-bars" role="img" aria-label={items.map((item) => `${item.title} ${formatValue(item.value)}`).join("，")}>
      {items.map((item, index) => (
        <i
          key={item.key}
          className={index === items.length - 1 ? "is-current" : undefined}
          style={{ "--h": item.value / max, "--i": index }}
          title={`${item.title} · ${formatValue(item.value)}`}
        />
      ))}
    </div>
  );
}
