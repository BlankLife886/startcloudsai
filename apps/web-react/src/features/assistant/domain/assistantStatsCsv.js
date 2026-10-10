// 统计卡片导出 CSV：分组列 + 指标列（有对比时再加上期），最后一行合计。
// 开头加 BOM，Excel 直接打开不会乱码。

function cell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100) : "";
}

export function statsCsv(data) {
  const metrics = Array.isArray(data?.metrics) ? data.metrics : [];
  const dimensions = Array.isArray(data?.dimensions) ? data.dimensions : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const withPrevious = Boolean(data?.previousTotals);
  const metricTitle = (metric) => (metric.unit ? `${metric.label}（${metric.unit}）` : metric.label);
  const header = [
    ...dimensions.map((dimension) => dimension.label),
    ...metrics.map(metricTitle),
    ...(withPrevious ? metrics.map((metric) => `上期${metricTitle(metric)}`) : []),
  ];
  const lines = [header];
  rows.forEach((row) => {
    lines.push([
      ...dimensions.map((dimension) => row.labels?.[dimension.id] ?? row.keys?.[dimension.id] ?? ""),
      ...metrics.map((metric) => number(row.values?.[metric.id])),
      ...(withPrevious ? metrics.map((metric) => (row.previous ? number(row.previous[metric.id]) : "")) : []),
    ]);
  });
  lines.push([
    ...(dimensions.length ? ["合计", ...dimensions.slice(1).map(() => "")] : []),
    ...metrics.map((metric) => number(data?.totals?.[metric.id])),
    ...(withPrevious ? metrics.map((metric) => number(data.previousTotals[metric.id])) : []),
  ]);
  return "﻿" + lines.map((line) => line.map(cell).join(",")).join("\n");
}

export function statsCsvFilename(data) {
  const range = data?.range;
  const span = range?.from ? `${range.from}_${range.to}` : range?.label || "统计";
  return `我的统计_${span}.csv`;
}
