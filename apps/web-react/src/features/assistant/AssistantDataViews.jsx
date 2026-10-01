// 统计与明细结果卡片：v2 引擎的数据工具返回结构化结果，这里按原界面风格渲染。
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import './assistant-data-views.css'

const TIME_DIMENSIONS = new Set(['day', 'week', 'month'])
const ORDERED_DIMENSIONS = new Set(['weekday', 'hour'])
const MAX_BARS = 12

export function formatMetricValue(value, unit = '') {
  const number = Number(value) || 0
  if (unit === '%') return `${number.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`
  const digits = Number.isInteger(number) ? 0 : 2
  const text = number.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
  return unit && unit !== '%' ? `${text} ${unit}` : text
}

// formatDelta compares with the previous period. It describes direction in
// words and arrows rather than colors: more spending is not "good" or "bad"
// on its own.
export function formatDelta(current, previous, unit = '') {
  const now = Number(current) || 0
  const before = Number(previous)
  if (!Number.isFinite(before)) return null
  if (unit === '%') {
    const diff = now - before
    if (Math.abs(diff) < 0.05) return { arrow: '→', text: '与上期持平' }
    return { arrow: diff > 0 ? '↑' : '↓', text: `${diff > 0 ? '上升' : '下降'} ${Math.abs(diff).toFixed(1)} 个百分点` }
  }
  if (before === 0) return now === 0 ? { arrow: '→', text: '与上期持平' } : { arrow: '↑', text: '上期为 0' }
  const ratio = (now - before) / before
  if (Math.abs(ratio) < 0.005) return { arrow: '→', text: '与上期持平' }
  return { arrow: ratio > 0 ? '↑' : '↓', text: `较上期${ratio > 0 ? '增加' : '减少'} ${Math.abs(ratio * 100).toFixed(ratio > -1 && ratio < 1 ? 1 : 0)}%` }
}

function useMeasuredWidth(fallback = 560) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const update = () => setWidth(Math.max(240, Math.floor(node.getBoundingClientRect().width)))
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function niceMax(value) {
  if (value <= 0) return 1
  const exponent = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exponent) return step * exponent
  }
  return 10 * exponent
}

function StatTiles({ metrics, totals, previousTotals }) {
  return (
    <div className="assistant-data-tiles">
      {metrics.map((metric) => {
        const delta = previousTotals ? formatDelta(totals[metric.id], previousTotals[metric.id], metric.unit) : null
        return (
          <div className="assistant-data-tile" key={metric.id}>
            <span className="assistant-data-tile-label">{metric.label}</span>
            <strong className="assistant-data-tile-value">{formatMetricValue(totals[metric.id], metric.unit)}</strong>
            {delta && <span className="assistant-data-tile-delta"><span aria-hidden="true">{delta.arrow}</span> {delta.text}</span>}
          </div>
        )
      })}
    </div>
  )
}

function TrendChart({ metric, rows, dimension }) {
  const [ref, width] = useMeasuredWidth()
  const [hover, setHover] = useState(-1)
  const height = 168
  const pad = { top: 12, right: 12, bottom: 26, left: 44 }
  const points = rows.map((row) => ({ label: row.labels[dimension], value: Number(row.values[metric.id]) || 0 }))
  const max = niceMax(Math.max(0, ...points.map((point) => point.value)))
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const x = (index) => pad.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const y = (value) => pad.top + plotHeight - (value / max) * plotHeight
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')
  const area = points.length ? `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : ''
  const ticks = [0, max / 2, max]
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 72))))
  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const position = event.clientX - box.left
    if (!points.length) return
    const index = points.length <= 1 ? 0 : Math.round(((position - pad.left) / plotWidth) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, index)))
  }
  const active = hover >= 0 ? points[hover] : null
  return (
    <figure className="assistant-data-chart" ref={ref}>
      <figcaption>{metric.label}</figcaption>
      <svg width={width} height={height} role="img" aria-label={`${metric.label}趋势`}
        onMouseMove={onMove} onMouseLeave={() => setHover(-1)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="assistant-data-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="assistant-data-axis" x={pad.left - 6} y={y(tick) + 4} textAnchor="end">{formatMetricValue(tick, metric.unit === '%' ? '%' : '')}</text>
          </g>
        ))}
        {points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1) && (
          <text key={point.label} className="assistant-data-axis" x={x(index)} y={height - 6} textAnchor="middle">{String(point.label).slice(5) || point.label}</text>
        ))}
        <path className="assistant-data-area" d={area} />
        <path className="assistant-data-line" d={line} />
        {points.length > 0 && (
          <circle className="assistant-data-dot" cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r="4" />
        )}
        {active && (
          <g>
            <line className="assistant-data-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotHeight} />
            <circle className="assistant-data-dot" cx={x(hover)} cy={y(active.value)} r="4" />
          </g>
        )}
      </svg>
      {active && (
        <div className="assistant-data-tooltip" style={{ left: Math.min(width - 140, Math.max(0, x(hover) - 70)) }}>
          <span>{active.label}</span>
          <strong>{formatMetricValue(active.value, metric.unit)}</strong>
        </div>
      )}
    </figure>
  )
}

function BarChart({ metric, rows, dimension }) {
  const [ref, width] = useMeasuredWidth()
  const [hover, setHover] = useState(-1)
  const items = rows.slice(0, MAX_BARS).map((row) => ({ label: row.labels[dimension], value: Number(row.values[metric.id]) || 0 }))
  const labelWidth = Math.min(132, Math.max(64, Math.floor(width * 0.28)))
  const valueWidth = 88
  const band = 30
  const thickness = 16
  const height = items.length * band + 8
  const plot = Math.max(40, width - labelWidth - valueWidth - 16)
  const max = Math.max(...items.map((item) => item.value), 0) || 1
  return (
    <figure className="assistant-data-chart" ref={ref}>
      <figcaption>{metric.label}{rows.length > MAX_BARS ? `（前 ${MAX_BARS} 项）` : ''}</figcaption>
      <svg width={width} height={height} role="img" aria-label={`${metric.label}对比`}>
        {items.map((item, index) => {
          const top = index * band + (band - thickness) / 2
          const length = Math.max(item.value > 0 ? 2 : 0, (item.value / max) * plot)
          const x0 = labelWidth + 8
          const radius = Math.min(4, length / 2)
          // Square at the baseline, 4px rounded at the data end.
          const path = length <= 0 ? '' : `M${x0},${top} H${x0 + length - radius} Q${x0 + length},${top} ${x0 + length},${top + radius} V${top + thickness - radius} Q${x0 + length},${top + thickness} ${x0 + length - radius},${top + thickness} H${x0} Z`
          return (
            <g key={item.label} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(-1)} className={hover === index ? 'is-hover' : ''}>
              <rect className="assistant-data-hit" x="0" y={index * band} width={width} height={band} />
              <text className="assistant-data-bar-label" x={labelWidth} y={top + thickness - 3} textAnchor="end">{item.label}</text>
              <path className="assistant-data-bar" d={path} />
              <text className="assistant-data-bar-value" x={x0 + length + 6} y={top + thickness - 3}>{formatMetricValue(item.value, metric.unit)}</text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

function StatsTable({ metrics, dimensions, rows, totals, showPrevious }) {
  return (
    <div className="assistant-data-table-wrap">
      <table className="assistant-data-table">
        <thead>
          <tr>
            {dimensions.map((dimension) => <th key={dimension.id} scope="col">{dimension.label}</th>)}
            {metrics.map((metric) => <th key={metric.id} scope="col" className="is-number">{metric.label}</th>)}
            {showPrevious && metrics.map((metric) => <th key={`p-${metric.id}`} scope="col" className="is-number">上期{metric.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {dimensions.map((dimension) => <td key={dimension.id}>{row.labels[dimension.id]}</td>)}
              {metrics.map((metric) => <td key={metric.id} className="is-number">{formatMetricValue(row.values[metric.id], metric.unit)}</td>)}
              {showPrevious && metrics.map((metric) => (
                <td key={`p-${metric.id}`} className="is-number">{row.previous ? formatMetricValue(row.previous[metric.id], metric.unit) : '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {dimensions.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row" colSpan={dimensions.length}>合计</th>
              {metrics.map((metric) => <td key={metric.id} className="is-number">{formatMetricValue(totals[metric.id], metric.unit)}</td>)}
              {showPrevious && metrics.map((metric) => <td key={`p-${metric.id}`} />)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function StatsView({ data }) {
  const [showTable, setShowTable] = useState(false)
  const metrics = Array.isArray(data?.metrics) ? data.metrics : []
  const dimensions = Array.isArray(data?.dimensions) ? data.dimensions : []
  const rows = Array.isArray(data?.rows) ? data.rows : []
  const totals = data?.totals || {}
  const previousTotals = data?.previousTotals || null
  const dimension = dimensions[0]?.id || ''
  const chart = useMemo(() => {
    if (dimensions.length !== 1 || !rows.length) return null
    if (TIME_DIMENSIONS.has(dimension)) {
      return metrics.slice(0, 3).map((metric) => <TrendChart key={metric.id} metric={metric} rows={rows} dimension={dimension} />)
    }
    // Ordered categories (weekday, hour) keep their order; others are ranked.
    const ordered = ORDERED_DIMENSIONS.has(dimension) ? rows : rows
    return metrics.slice(0, 2).map((metric) => <BarChart key={metric.id} metric={metric} rows={ordered} dimension={dimension} />)
  }, [dimension, dimensions.length, metrics, rows])
  if (!metrics.length) return null
  const range = data?.range
  return (
    <section className="assistant-data" aria-label="统计结果">
      <header className="assistant-data-head">
        <span>{range?.label}{range?.from ? ` · ${range.from} 至 ${range.to}` : ''}</span>
        {data?.previousRange && <span className="assistant-data-sub">对比 {data.previousRange.from} 至 {data.previousRange.to}</span>}
      </header>
      <StatTiles metrics={metrics} totals={totals} previousTotals={previousTotals} />
      {chart}
      {dimensions.length > 1 && !showTable && <p className="assistant-data-note">分组较多，已用表格展示。</p>}
      {dimensions.length > 0 && (
        <>
          {(showTable || dimensions.length > 1) && (
            <StatsTable metrics={metrics} dimensions={dimensions} rows={rows} totals={totals} showPrevious={false} />
          )}
          {dimensions.length === 1 && (
            <button type="button" className="assistant-data-toggle" onClick={() => setShowTable((value) => !value)}>
              {showTable ? '收起表格' : '查看表格'}
            </button>
          )}
        </>
      )}
      {data?.truncated && <p className="assistant-data-note">结果较多，只展示了前 500 组。</p>}
    </section>
  )
}

function RecordsView({ data }) {
  const records = Array.isArray(data?.records) ? data.records : []
  const type = data?.type
  if (!records.length) {
    return <section className="assistant-data"><p className="assistant-data-note">这段时间没有相关记录。</p></section>
  }
  return (
    <section className="assistant-data" aria-label="明细记录">
      <header className="assistant-data-head">
        <span>{type === 'creations' ? '创作记录' : type === 'income' ? '入账明细' : '消耗明细'} · {data?.range?.label}</span>
      </header>
      <div className="assistant-data-table-wrap">
        <table className="assistant-data-table">
          <thead>
            <tr>
              <th scope="col">时间</th>
              <th scope="col">功能</th>
              {type === 'creations' ? <th scope="col">状态</th> : <th scope="col">来源</th>}
              <th scope="col" className="is-number">{type === 'creations' ? '图片' : '积分'}</th>
              <th scope="col">内容</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td className="is-nowrap">{record.time}</td>
                <td>{record.workspaceLabel}</td>
                <td>{type === 'creations' ? record.statusLabel : record.sourceLabel}</td>
                <td className="is-number">{type === 'creations' ? (record.images || 0) : formatMetricValue(record.points)}</td>
                <td className="assistant-data-record-text">
                  {record.link ? <Link to={record.link}>{record.prompt || record.note || '查看'}</Link> : (record.prompt || record.note || '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.hasMore && <p className="assistant-data-note">还有更多记录，可以让我按条件继续筛选。</p>}
    </section>
  )
}

export function AssistantDataViews({ views }) {
  if (!Array.isArray(views) || !views.length) return null
  return views.map((view, index) => <AssistantDataView key={`${view?.tool || 'view'}-${index}`} view={view} />)
}

export function AssistantDataView({ view }) {
  if (view?.view === 'stats') return <StatsView data={view.data} />
  if (view?.view === 'records') return <RecordsView data={view.data} />
  return null
}
