import { useCallback, useEffect, useId, useRef, useState } from "react";
import { getModelStatus } from "../../legacy-modules/services/metaApi.js";

// Shared building blocks for the model status page variants.

// The server recomputes and caches the page hourly, so polling faster gains nothing.
export const REFRESH_MS = 60 * 60_000;

export const STATUS_META = {
  operational: { label: "正常", icon: "bi-check-circle-fill", tone: "good" },
  degraded: {
    label: "降级",
    icon: "bi-exclamation-triangle-fill",
    tone: "warning",
  },
  outage: { label: "故障", icon: "bi-x-octagon-fill", tone: "critical" },
  maintenance: { label: "维护中", icon: "bi-tools", tone: "info" },
  no_data: { label: "暂无调用", icon: "bi-dash-circle", tone: "idle" },
};
export const STATUS_ORDER = [
  "outage",
  "degraded",
  "operational",
  "maintenance",
  "no_data",
];

export const OVERALL_META = {
  operational: {
    title: "全部模型运行正常",
    tone: "good",
    icon: "bi-check-circle-fill",
  },
  degraded: {
    title: "部分模型异常",
    tone: "warning",
    icon: "bi-exclamation-triangle-fill",
  },
  outage: {
    title: "模型服务中断",
    tone: "critical",
    icon: "bi-x-octagon-fill",
  },
};

export const KIND_ORDER = ["chat", "image", "image_tool"];
export const KIND_LABEL = { chat: "对话", image: "生图", image_tool: "工具" };
export const KIND_GROUP_LABEL = {
  chat: "对话模型",
  image: "生图模型",
  image_tool: "图片工具",
};

// Availability bands for the 24-hour strip.
export const DAY_BANDS = [
  { min: 0.95, tone: "good", label: "≥ 95%" },
  { min: 0.8, tone: "warning", label: "80–95%" },
  { min: -1, tone: "critical", label: "< 80%" },
];

export function dayTone(rate) {
  if (rate == null) return "idle";
  return DAY_BANDS.find((band) => rate >= band.min).tone;
}

export function formatPercent(rate, digits = 2) {
  if (rate == null) return "—";
  const value = rate * 100;
  return `${value >= 99.995 ? "100" : value.toFixed(digits)}%`;
}

export function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${String(Math.round(seconds % 60)).padStart(2, "0")} 秒`;
}

export function formatSpeed(speed, unit) {
  if (speed == null) return "—";
  if (unit === "tokens_per_second") return `${speed.toFixed(1)} tok/s`;
  return `${speed.toFixed(speed < 10 ? 2 : 1)} 张/分`;
}

export function formatPrice(cents, unit) {
  if (cents == null) return "—";
  if (cents === 0) return "免费";
  return `${cents} 积分/${unit === "per_turn" ? "次" : "张"}`;
}

export function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatHour(value) {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:00`;
}

export function sortModels(models) {
  return [...models].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
}

export function statusCounts(models) {
  return STATUS_ORDER.map((status) => ({
    status,
    count: models.filter((m) => m.status === status).length,
  }));
}

// Tooltips near either end of a strip stay inside it instead of spilling out.
function tipStyle(ratio) {
  const shift = ratio < 0.12 ? "0%" : ratio > 0.88 ? "-100%" : "-50%";
  return { left: `${ratio * 100}%`, transform: `translateX(${shift})` };
}

function Tip({ ratio, children }) {
  return (
    <div className="msv-tip" style={tipStyle(ratio)} role="status">
      {children}
    </div>
  );
}

/** Status as a glowing dot plus label; healthy and failing states pulse softly. */
export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.no_data;
  return (
    <span className={`msv-badge is-${meta.tone}`}>
      <span className="msv-badge__dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** One cell per hour for the last 24 hours; hover shows that hour's success rate. */
export function HourStrip({ points }) {
  const [hover, setHover] = useState(null);
  const hours = points.slice(-24);
  return (
    <div className="msv-hours" onMouseLeave={() => setHover(null)}>
      {hours.map((point, index) => (
        <span
          key={point.time}
          className={`msv-hours__cell is-${dayTone(point.successRate)}`}
          onMouseEnter={() => setHover(index)}
          role="img"
          aria-label={`${formatHour(point.time)} ${point.successRate == null ? "无调用" : formatPercent(point.successRate)}`}
        />
      ))}
      {hover != null && hours[hover] ? (
        <Tip ratio={(hover + 0.5) / hours.length}>
          <span>
            {formatHour(hours[hover].time)}
            {hover === hours.length - 1 ? "（进行中）" : ""}
          </span>
          <strong>
            {hours[hover].successRate == null
              ? "该小时无调用"
              : `成功率 ${formatPercent(hours[hover].successRate, 1)}`}
          </strong>
        </Tip>
      ) : null}
    </div>
  );
}

// Smooth line through the points (Catmull-Rom as cubic Béziers), clamped to the chart box.
function smoothPath(points, height) {
  if (points.length < 3) return `M${points.map((p) => p.join(",")).join(" L")}`;
  const clamp = (v) => Math.max(1, Math.min(height - 1, v));
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [
      p1[0] + (p2[0] - p0[0]) / 6,
      clamp(p1[1] + (p2[1] - p0[1]) / 6),
    ];
    const c2 = [
      p2[0] - (p3[0] - p1[0]) / 6,
      clamp(p2[1] - (p3[1] - p1[1]) / 6),
    ];
    d += ` C${c1.join(",")} ${c2.join(",")} ${p2.join(",")}`;
  }
  return d;
}

/** 24-hour median latency line; empty hours break the line rather than drop to zero. */
export function Spark({ points, height = 28, zoomed = false }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const gradientId = useId();
  const width = 200;
  const values = points.map((point) => point.latencyP50Ms);
  const max = Math.max(0, ...values.filter((value) => value != null));
  if (max === 0)
    return (
      <div
        className="msv-spark is-empty"
        style={{ height }}
        role="img"
        aria-label="近 24 小时暂无成功调用"
      />
    );

  const step = points.length > 1 ? width / (points.length - 1) : width;
  const x = (index) => index * step;
  // zoomed: start the axis just below the lowest hour so the shape of the day shows, not just its level.
  const present = values.filter((value) => value != null);
  const floor = zoomed && present.length > 1 ? Math.min(...present) * 0.85 : 0;
  const top = max * (zoomed ? 1.08 : 1);
  const y = (value) => 3 + (1 - (value - floor) / (top - floor)) * (height - 6);
  const segments = [];
  let current = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push([x(index), y(value)]);
  });
  if (current.length) segments.push(current);

  const onMove = (event) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(
      Math.max(
        0,
        Math.min(points.length - 1, Math.round(ratio * (points.length - 1))),
      ),
    );
  };
  const point = hover != null ? points[hover] : null;

  return (
    <div className="msv-spark" style={{ height }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`近 24 小时耗时，峰值 ${formatDuration(max)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="msv-spark__stop-top" />
            <stop offset="100%" className="msv-spark__stop-bottom" />
          </linearGradient>
        </defs>
        {segments.map((segment, index) => {
          if (segment.length === 1) {
            return (
              <circle
                key={index}
                className="msv-spark__dot"
                cx={segment[0][0]}
                cy={segment[0][1]}
                r="2.2"
              />
            );
          }
          const line = smoothPath(segment, height);
          const first = segment[0][0];
          const last = segment[segment.length - 1][0];
          return (
            <g key={index}>
              <path
                d={`${line} L${last},${height} L${first},${height} Z`}
                fill={`url(#${gradientId})`}
                stroke="none"
              />
              <path className="msv-spark__line" d={line} />
            </g>
          );
        })}
        {point ? (
          <line
            className="msv-spark__cross"
            x1={x(hover)}
            x2={x(hover)}
            y1="0"
            y2={height}
          />
        ) : null}
      </svg>
      {point ? (
        <Tip ratio={hover / Math.max(points.length - 1, 1)}>
          <span>{formatHour(point.time)}</span>
          <strong>
            {point.latencyP50Ms == null
              ? "该小时无成功调用"
              : `耗时 ${formatDuration(point.latencyP50Ms)}`}
          </strong>
          {point.successRate != null ? (
            <span>成功率 {formatPercent(point.successRate, 1)}</span>
          ) : null}
          {point.ttftP50Ms != null ? (
            <span>首字 {formatDuration(point.ttftP50Ms)}</span>
          ) : null}
        </Tip>
      ) : null}
    </div>
  );
}

export function BandLegend() {
  return (
    <span className="msv-legend">
      {DAY_BANDS.map((band) => (
        <span key={band.tone}>
          <i className={`is-${band.tone}`} />
          {band.label}
        </span>
      ))}
      <span>
        <i className="is-idle" />
        无调用
      </span>
    </span>
  );
}

export function StatusCountChips({ models }) {
  return (
    <span className="msv-counts">
      {statusCounts(models).map(({ status, count }) => {
        const meta = STATUS_META[status];
        return (
          <span
            key={status}
            className={`msv-count is-${meta.tone}${count ? "" : " is-zero"}`}
          >
            <i className={`bi ${meta.icon}`} aria-hidden="true" />
            {meta.label}
            <b>{count}</b>
          </span>
        );
      })}
    </span>
  );
}

export function useModelStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const next = await getModelStatus({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setData(next);
      setError("");
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err?.message || "模型状态读取失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [load]);

  return { data, loading, error, refresh: load };
}

/**
 * 30-day unit price, one bar per China day. Bars start at zero so equal
 * prices read as equal heights; today's bar is highlighted. Days before the
 * first recorded call show as a faint stub.
 */
export function PriceBars({ price, height = 36 }) {
  const [hover, setHover] = useState(null);
  const days = price?.days || [];
  if (!days.length)
    return <div className="msv-spark is-empty" style={{ height }} />;
  const max = Math.max(1, ...days.map((day) => day.cents ?? 0));
  const day = hover != null ? days[hover] : null;
  return (
    <div
      className="msv-bars"
      style={{ height }}
      onMouseLeave={() => setHover(null)}
    >
      {days.map((item, index) => (
        <span
          key={item.date}
          className={`msv-bars__bar${item.cents == null ? " is-empty" : ""}${index === days.length - 1 ? " is-today" : ""}`}
          style={
            item.cents == null
              ? undefined
              : { height: `${Math.max(8, (item.cents / max) * 100)}%` }
          }
          onMouseEnter={() => setHover(index)}
          role="img"
          aria-label={`${item.date} ${item.cents == null ? "无记录" : formatPrice(item.cents, price.unit)}`}
        />
      ))}
      {day ? (
        <Tip ratio={(hover + 0.5) / days.length}>
          <span>
            {day.date.slice(5).replace("-", "/")}
            {hover === days.length - 1 ? "（今天）" : ""}
          </span>
          <strong>
            {day.cents == null
              ? "此前无调用记录"
              : formatPrice(day.cents, price.unit)}
          </strong>
        </Tip>
      ) : null}
    </div>
  );
}
