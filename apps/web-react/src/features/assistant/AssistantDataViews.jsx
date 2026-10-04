// 统计与明细结果卡片：v2 引擎的数据工具返回结构化结果，这里按原界面风格渲染。
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AssistantAssetActionView, AssistantAssetsView } from './AssistantAssetViews.jsx'
import { AssistantMemoryChangeView } from './AssistantMemoryViews.jsx'
import { AssistantCommerceSet, CommerceSetOwnersContext, CommerceSetReference } from './AssistantCommerceSet.jsx'
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

function TrendChart({ metric, rows, dimension, caption = true }) {
  const [ref, width] = useMeasuredWidth()
  const [hover, setHover] = useState(-1)
  const height = 120
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
      {caption ? <figcaption>{metric.label}</figcaption> : null}
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

const SHARE_MAX_ITEMS = 6

// 分类占比：一条分段条 + 图例，项目少时最省地方；项目多时换成细的排行条。
function CategoryChart({ metric, rows, dimension }) {
  const items = rows.slice(0, MAX_BARS).map((row) => ({ label: row.labels[dimension], value: Math.max(0, Number(row.values[metric.id]) || 0) }))
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const max = Math.max(...items.map((item) => item.value), 0) || 1
  const share = (value) => (total > 0 ? value / total : 0)
  const percent = (value) => `${(share(value) * 100).toFixed(share(value) < 0.1 ? 1 : 0)}%`
  if (!ORDERED_DIMENSIONS.has(dimension) && items.length <= SHARE_MAX_ITEMS && metric.unit !== '%' && total > 0) {
    return (
      <figure className="assistant-stats-share" role="img" aria-label={`${metric.label}对比`}>
        <div className="assistant-stats-share-bar" aria-hidden="true">
          {items.map((item, index) => item.value > 0 ? <i key={item.label} className={`is-c${index}`} style={{ flexGrow: item.value }} /> : null)}
        </div>
        <ul className="assistant-stats-legend">
          {items.map((item, index) => (
            <li key={item.label}><i className={`is-c${index}`} aria-hidden="true" /><span>{item.label}</span><b>{formatMetricValue(item.value, metric.unit)}</b><small>{percent(item.value)}</small></li>
          ))}
        </ul>
      </figure>
    )
  }
  return (
    <figure className="assistant-stats-rank" role="img" aria-label={`${metric.label}对比`}>
      {rows.length > MAX_BARS ? <figcaption>前 {MAX_BARS} 项</figcaption> : null}
      <ol>
        {items.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <span className="assistant-stats-rank-track" aria-hidden="true"><i style={{ width: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%` }} /></span>
            <b>{formatMetricValue(item.value, metric.unit)}</b>
          </li>
        ))}
      </ol>
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

function shortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  return match ? `${Number(match[2])}月${Number(match[3])}日` : String(value || '')
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
    if (dimensions.length !== 1 || !rows.length || !metrics.length) return null
    if (TIME_DIMENSIONS.has(dimension)) {
      return metrics.slice(0, 2).map((metric) => <TrendChart key={metric.id} metric={metric} rows={rows} dimension={dimension} caption={metrics.length > 1} />)
    }
    return <CategoryChart metric={metrics[0]} rows={rows} dimension={dimension} />
  }, [dimension, dimensions.length, metrics, rows])
  if (!metrics.length) return null
  const range = data?.range
  const previous = data?.previousRange
  const rangeText = [
    range?.label,
    range?.from ? `${shortDate(range.from)}–${shortDate(range.to)}` : '',
    previous?.from ? `对比 ${shortDate(previous.from)}–${shortDate(previous.to)}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <section className="assistant-data is-stats" aria-label="统计结果">
      <header className="assistant-stats-head">
        <div className="assistant-stats-metrics">
          {metrics.map((metric) => {
            const delta = previousTotals ? formatDelta(totals[metric.id], previousTotals[metric.id], metric.unit) : null
            return (
              <div className="assistant-stats-metric" key={metric.id}>
                <span>{metric.label}</span>
                <strong>{formatMetricValue(totals[metric.id], metric.unit)}</strong>
                {delta ? <em className={delta.arrow === '↑' ? 'is-up' : delta.arrow === '↓' ? 'is-down' : ''}><span aria-hidden="true">{delta.arrow}</span> {delta.text}</em> : null}
              </div>
            )
          })}
        </div>
        {dimensions.length === 1 && rows.length > 0 ? (
          <button type="button" className="assistant-data-toggle" aria-expanded={showTable} onClick={() => setShowTable((value) => !value)}>
            <i className={`bi ${showTable ? 'bi-bar-chart' : 'bi-table'}`} aria-hidden="true" />{showTable ? '收起表格' : '查看表格'}
          </button>
        ) : null}
      </header>
      {rangeText ? <p className="assistant-stats-range">{rangeText}</p> : null}
      {chart}
      {dimensions.length > 1 && <p className="assistant-data-note">分组较多，已用表格展示。</p>}
      {(showTable || dimensions.length > 1) && dimensions.length > 0 ? (
        <StatsTable metrics={metrics} dimensions={dimensions} rows={rows} totals={totals} showPrevious={false} />
      ) : null}
      {data?.truncated && <p className="assistant-data-note">结果较多，只展示了前 500 组。</p>}
    </section>
  )
}

const RECORD_TITLES = { creations: '创作记录', income: '入账明细', spend: '消耗明细', api_calls: 'API 调用记录' }

// “2026-10-02 09:00” → “10月2日 09:00”；今年以外的日期保留年份。
function shortDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(value || ''))
  if (!match) return String(value || '')
  const year = Number(match[1]) !== new Date().getFullYear() ? `${match[1]}年` : ''
  return `${year}${Number(match[2])}月${Number(match[3])}日${match[4] ? ` ${match[4]}` : ''}`
}

function statusTone(record) {
  const status = String(record.status || '').toLowerCase()
  if (/fail|error|cancel/.test(status) || /失败|取消/.test(record.statusLabel || '')) return 'is-bad'
  if (/run|pend|queue/.test(status) || /中$/.test(record.statusLabel || '')) return 'is-wait'
  return 'is-ok'
}

function signedPoints(value, sign) {
  const number = Math.abs(Number(value) || 0)
  return `${sign}${formatMetricValue(number)}`
}

function RecordsView({ data }) {
  const records = Array.isArray(data?.records) ? data.records : []
  const type = data?.type
  if (!records.length) {
    return <section className="assistant-data is-compact"><p className="assistant-data-note">这段时间没有相关记录。</p></section>
  }
  const byStatus = type === 'creations' || type === 'api_calls'
  const title = [RECORD_TITLES[type] || '消耗明细', data?.range?.label].filter(Boolean).join(' · ')
  return (
    <section className="assistant-data is-compact" aria-label="明细记录">
      <header className="assistant-data-head"><span>{title}</span><small className="assistant-data-sub">{records.length} 条</small></header>
      <ul className="assistant-data-list">
        {records.map((record) => {
          const label = type === 'api_calls' ? (record.model || '未记录模型') : record.workspaceLabel
          const text = record.prompt || record.note || ''
          const tone = byStatus ? statusTone(record) : type === 'income' ? 'is-ok' : ''
          const value = type === 'creations'
            ? (tone === 'is-ok' ? `${record.images || 0} 张` : record.statusLabel)
            : type === 'income' ? `${signedPoints(record.points, '+')} 积分` : type === 'spend' ? `${signedPoints(record.points, '−')} 积分` : `${formatMetricValue(record.points)} 积分`
          return (
            <li key={record.id} className={tone}>
              {byStatus ? <i className="assistant-data-dot" aria-hidden="true" /> : null}
              <div>
                <strong>{text ? (record.link ? <Link to={record.link}>{text}</Link> : text) : label}</strong>
                <small>{[text ? label : '', byStatus ? '' : record.sourceLabel, shortDateTime(record.time)].filter(Boolean).join(' · ')}</small>
              </div>
              <b className={tone === 'is-bad' ? 'is-bad' : ''}>{value}</b>
            </li>
          )
        })}
      </ul>
      {data?.hasMore && <p className="assistant-data-note">还有更多记录，可以让我按条件继续筛选。</p>}
    </section>
  )
}

function AccountView({ data }) {
  const balance = data?.balance || {}
  const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : []
  const orders = data?.orders || {}
  const waiting = (Number(orders.pending) || 0) + (Number(orders.confirming) || 0)
  return (
    <section className="assistant-data is-compact" aria-label="账户概况">
      <div className="assistant-data-hero">
        <span>可用积分</span>
        <strong>{formatMetricValue(balance.availablePoints)}</strong>
        {Number(balance.frozenPoints) > 0 ? <em>冻结中 {formatMetricValue(balance.frozenPoints)}</em> : null}
        {Number(balance.subscriptionPoints) > 0 ? <small>其中订阅积分 {formatMetricValue(balance.subscriptionPoints)}</small> : null}
      </div>
      {subscriptions.length > 0 ? (
        <ul className="assistant-data-list">
          {subscriptions.map((item, index) => (
            <li key={`${item.planName}-${index}`} className={item.status === 'active' ? 'is-ok' : 'is-wait'}>
              <i className="assistant-data-dot" aria-hidden="true" />
              <div>
                <strong>{item.planName || '订阅套餐'}</strong>
                <small>{[item.endsAt ? `${shortDateTime(item.endsAt).replace(/ \d{2}:\d{2}$/, '')}到期` : '', item.dailyPoints ? `每日发放 ${formatMetricValue(item.dailyPoints)}` : '', item.nextGrantAt ? `下次 ${shortDateTime(item.nextGrantAt)}` : ''].filter(Boolean).join(' · ')}</small>
              </div>
              <b>{item.statusLabel}{item.daysLeft ? ` · 剩 ${item.daysLeft} 天` : ''}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="assistant-data-note">最近 90 天没有订阅。<Link to="/pricing">查看套餐</Link></p>
      )}
      {waiting > 0 && <p className="assistant-data-note">有 {waiting} 笔订单待支付或确认中，<Link to="/orders">查看订单</Link>。</p>}
    </section>
  )
}

function OrdersView({ data }) {
  const orders = Array.isArray(data?.orders) ? data.orders : []
  if (!orders.length) {
    return <section className="assistant-data is-compact"><p className="assistant-data-note">没有符合条件的订单。</p></section>
  }
  return (
    <section className="assistant-data is-compact" aria-label="订单">
      <header className="assistant-data-head"><span>订单</span><Link className="assistant-data-sub" to="/orders">全部订单</Link></header>
      <ul className="assistant-data-list">
        {orders.map((order) => {
          const statusText = String(order.statusLabel || '')
          const shortStatus = statusText.split(/[，,]/)[0]
          const tone = /失败|关闭|取消|退款/.test(statusText) ? 'is-bad' : /待|中/.test(shortStatus) ? 'is-wait' : 'is-ok'
          const points = (Number(order.points) || 0) + (Number(order.bonusPoints) || 0)
          return (
            <li key={order.orderNo} className={tone}>
              <i className="assistant-data-dot" aria-hidden="true" />
              <div>
                <strong>{order.planName || order.planKind || '订单'}</strong>
                <small title={statusText}>{[shortStatus, shortDateTime(order.createdAt)].filter(Boolean).join(' · ')}</small>
              </div>
              <b>¥{formatMetricValue(order.amountYuan)}<small>{points ? `+${formatMetricValue(points)} 积分` : ''}</small></b>
            </li>
          )
        })}
      </ul>
      {data?.hasMore && <p className="assistant-data-note">还有更早的订单，可以在订单页查看。</p>}
    </section>
  )
}

const CHARGE_SIGNS = { spend: '−', release: '+', refund: '+' }

function ChargeView({ data }) {
  if (!data?.found) {
    return data?.message ? <section className="assistant-data is-compact"><p className="assistant-data-note">{data.message}</p></section> : null
  }
  const source = data.source || {}
  const entries = Array.isArray(data.entries) ? data.entries : []
  const totals = data.totals || {}
  const pending = Number(totals.pendingPoints) > 0
  const title = [source.typeLabel, source.workspaceLabel !== source.typeLabel ? source.workspaceLabel : '', shortDateTime(source.time)].filter(Boolean).join(' · ')
  return (
    <section className="assistant-data is-compact" aria-label="扣费说明">
      <header className="assistant-data-head">
        <span>{title}</span>
        {source.link && <Link className="assistant-data-sub" to={source.link}>查看原记录</Link>}
      </header>
      <div className="assistant-data-hero">
        <span>{pending ? '预留中' : '实际花费'}</span>
        <strong>{formatMetricValue(pending ? totals.pendingPoints : totals.netPoints, '积分')}</strong>
        {source.statusLabel ? <em>{source.statusLabel}{source.model ? ` · ${source.model}` : ''}</em> : null}
      </div>
      {entries.length > 0 && (
        <table className="assistant-data-flow">
          <caption className="assistant-visually-hidden">积分变动</caption>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={`${entry.time}-${index}`} className={`is-${entry.kind || 'other'}`}>
                <td><i aria-hidden="true" /></td>
                <th scope="row">{entry.label}</th>
                <td>{shortDateTime(entry.time).replace(/^.*日 /, '')}</td>
                <td>{CHARGE_SIGNS[entry.kind] || ''}{formatMetricValue(Math.abs(Number(entry.points) || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// Planning and then generating one e-commerce set yields two cards for the same
// set (older answers stored both); show only the latest one.
function latestCommerceSetViews(views) {
  const lastIndex = new Map()
  views.forEach((view, index) => {
    if (view?.view === 'commerce_set' && view.data?.id) lastIndex.set(view.data.id, index)
  })
  return views.filter((view, index) => view?.view !== 'commerce_set' || !view.data?.id || lastIndex.get(view.data.id) === index)
}

export function AssistantDataViews({ views, messageId = '' }) {
  if (!Array.isArray(views) || !views.length) return null
  return latestCommerceSetViews(views).map((view, index) => <AssistantDataView key={`${view?.tool || 'view'}-${index}`} view={view} messageId={messageId} />)
}

export function AssistantDataView({ view, messageId = '' }) {
  const owners = useContext(CommerceSetOwnersContext)
  if (view?.view === 'commerce_set' && messageId && owners) {
    const owner = owners.get(view.data?.id)
    if (owner && owner !== messageId) return <CommerceSetReference set={view.data} ownerMessageId={owner} />
  }
  if (view?.view === 'stats') return <StatsView data={view.data} />
  if (view?.view === 'records') return <RecordsView data={view.data} />
  if (view?.view === 'account') return <AccountView data={view.data} />
  if (view?.view === 'orders') return <OrdersView data={view.data} />
  if (view?.view === 'charge') return <ChargeView data={view.data} />
  if (view?.view === 'commerce_set') return <AssistantCommerceSet initial={view.data} />
  if (view?.view === 'assets') return <AssistantAssetsView data={view.data} />
  if (view?.view === 'asset_action') return <AssistantAssetActionView data={view.data} />
  if (view?.view === 'memory_change') return <AssistantMemoryChangeView data={view.data} />
  return null
}
