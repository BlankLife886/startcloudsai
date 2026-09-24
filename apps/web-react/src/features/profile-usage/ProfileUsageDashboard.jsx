import { UsageBarChart, UsageMiniBars, UsageMiniHeatmap } from "./UsageCharts.jsx";
import {
  USAGE_METRICS,
  USAGE_RANGES,
  formatCompact,
  formatDuration,
  hourRangeLabel,
  localDateKey,
} from "./usageStats.js";
import "./profileUsage.css";

function hours(seconds) {
  const value = (Number(seconds) || 0) / 3600;
  if (!value) return "0";
  return value < 10 ? value.toFixed(1) : formatCompact(Math.round(value));
}

function recentTotal(model, key) {
  return model.daily.reduce((sum, day) => sum + (Number(day[key]) || 0), 0);
}

/** 仪表盘左侧四张入口卡的数据：累计创作数据，第三张附带钱包余额。 */
export function usageHeroLinks(usage, pointsDisplay) {
  const { model, ready } = usage;
  const value = (text) => (ready ? text : "—");
  return [
    {
      to: "/history",
      icon: "bi-images",
      tone: "assets",
      title: "累计生成",
      value: value(formatCompact(model.totals.images)),
      hint: ready ? `张 · 近 30 天 ${formatCompact(recentTotal(model, "images"))}` : "张",
    },
    {
      to: "/history",
      icon: "bi-lightning-charge",
      tone: "submissions",
      title: "累计创作",
      value: value(formatCompact(model.totals.creations)),
      hint: ready ? `次 · 近 30 天 ${formatCompact(recentTotal(model, "creations"))}` : "次",
    },
    {
      to: "/wallet",
      icon: "bi-coin",
      tone: "wallet",
      title: "累计消耗",
      value: value(formatCompact(model.totals.points)),
      hint: `积分 · 可用 ${pointsDisplay}`,
    },
    {
      to: "/history",
      icon: "bi-clock-history",
      tone: "orders",
      title: "创作时长",
      value: value(hours(model.totals.durationSeconds)),
      hint: ready ? `小时 · 近 30 天 ${hours(recentTotal(model, "durationSeconds"))}` : "小时",
    },
  ];
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="pp-usage-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={value === option.id ? "is-on" : ""}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 仪表盘右侧「创作数据」面板：用量趋势图撑满中部，底部为成功率、任务状态与类型分布。
 */
export function UsagePanel({ usage, taskStats, successRate, typeMix, typeMixMax }) {
  const { model, metric, setMetric, range, setRange, ready, error, reload } = usage;
  const metricMeta = USAGE_METRICS.find((item) => item.id === metric) || USAGE_METRICS[0];
  const rangeMeta = USAGE_RANGES.find((item) => item.id === range) || USAGE_RANGES[0];
  const series = range === "month" ? model.monthly : range === "year" ? model.yearly : model.daily;
  const items = series.map((item) => ({ ...item, value: item[metric] }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const today = localDateKey(new Date());
  const todayImages = model.daily.find((day) => day.key === today)?.images || 0;

  return (
    <aside className="pp-soft-performance pp-usage-panel">
      <header>
        <strong>创作数据</strong>
        <Segmented label="统计周期" value={range} options={USAGE_RANGES} onChange={setRange} />
      </header>
      <div className="pp-usage-panel__metric">
        <Segmented label="统计指标" value={metric} options={USAGE_METRICS} onChange={setMetric} />
        <span className="tnum">
          {rangeMeta.hint} <b>{formatCompact(total)}</b> {metricMeta.unit}
        </span>
      </div>
      <div className="pp-usage-panel__chart">
        {error ? (
          <div className="pp-usage-panel__state">
            {error}
            <button type="button" onClick={reload}>重新加载</button>
          </div>
        ) : ready ? (
          <UsageBarChart
            items={items}
            height="fill"
            highlightKey={range === "day" ? today : undefined}
            caption={`${rangeMeta.label}${metricMeta.label}`}
            formatValue={(value, axis) => (axis ? formatCompact(value) : `${formatCompact(value)} ${metricMeta.unit}`)}
          />
        ) : (
          <div className="pp-usage-panel__state is-loading" aria-busy="true" />
        )}
      </div>
      <ul className="pp-usage-panel__stats">
        <li>
          <span>成功率</span>
          <strong className="tnum">{successRate}%</strong>
        </li>
        <li>
          <span>进行中</span>
          <strong className="tnum">{taskStats.running}</strong>
        </li>
        <li className={taskStats.failed ? "is-bad" : undefined}>
          <span>失败</span>
          <strong className="tnum">{taskStats.failed}</strong>
        </li>
        <li>
          <span>今日生成</span>
          <strong className="tnum">{ready ? todayImages : "—"}</strong>
        </li>
      </ul>
      {typeMix.length ? (
        <ul className="pp-soft-types pp-usage-panel__types">
          {typeMix.slice(0, 3).map((item) => (
            <li key={item.type}>
              <span>{item.label}</span>
              <strong>{item.count}</strong>
              <b>
                <i style={{ width: `${Math.round((item.count / typeMixMax) * 100)}%` }} />
              </b>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

/** 底部卡：近 30 天每日创作时长。 */
export function UsageDurationCard({ usage }) {
  const { model, ready } = usage;
  const items = model.daily.map((day) => ({ key: day.key, title: day.title, value: Math.round(day.durationSeconds / 60) }));
  return (
    <section className="pp-soft-stat pp-dash-card">
      <header>
        <span>每日创作时长</span>
        <small className="tnum">{ready ? `近 30 天 ${formatDuration(model.recentDuration)}` : "读取中…"}</small>
      </header>
      {ready ? <UsageMiniBars items={items} formatValue={(value) => `${value} 分钟`} /> : null}
    </section>
  );
}

/** 底部卡：一周 × 24 小时创作时段热力图。 */
export function UsageRhythmCard({ usage }) {
  const { model, ready } = usage;
  return (
    <section className="pp-soft-stat pp-dash-card">
      <header>
        <span>一周创作时段</span>
        <small className="tnum">
          {!ready ? "读取中…" : model.peakHour >= 0 ? `最常 ${hourRangeLabel(model.peakHour)}` : "暂无记录"}
        </small>
      </header>
      {ready ? <UsageMiniHeatmap rows={model.heatmap} max={model.heatMax} /> : null}
    </section>
  );
}
