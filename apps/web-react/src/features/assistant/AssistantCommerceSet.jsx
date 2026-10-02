// 电商套图卡片：v2 助手策划的一套电商图。方案阶段在这里确认生成；生成后轮询进度，
// 出完自动触发检查；不合格的可重做；全部完成后可打包下载或去电商工作台继续调整。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  assistantCommerceSetArchiveUrl,
  generateAssistantCommerceSet,
  getAssistantCommerceSet,
  redoAssistantCommerceShots,
  reviewAssistantCommerceSet,
} from './services/assistantApi.js'
import './assistant-commerce-set.css'

const POLL_MS = 4000
const RUNNING = new Set(['queued', 'running', 'waiting_provider'])
const STATUS_TEXT = {
  planned: '待生成',
  queued: '排队中',
  running: '生成中',
  waiting_provider: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  canceled: '已取消',
  cancelled: '已取消',
}

function ratioStyle(ratio) {
  const [width, height] = String(ratio || '1:1').split(':').map(Number)
  return width > 0 && height > 0 ? { aspectRatio: `${width} / ${height}` } : { aspectRatio: '1 / 1' }
}

function points(value) {
  return `${(Number(value) || 0).toLocaleString('zh-CN')} 积分`
}

function ShotTile({ shot, busy, onRedo }) {
  const running = RUNNING.has(shot.status)
  const failedCheck = shot.reviewed && !shot.pass
  return (
    <li className={`assistant-commerce-shot${failedCheck ? ' is-flagged' : ''}`}>
      <div className="assistant-commerce-shot-frame" style={ratioStyle(shot.aspectRatio)}>
        {shot.imageUrl ? (
          <a href={shot.originalUrl || shot.imageUrl} target="_blank" rel="noreferrer">
            <img src={shot.imageUrl} alt={shot.label} loading="lazy" />
          </a>
        ) : (
          <div className="assistant-commerce-shot-placeholder">
            {running ? <span className="assistant-commerce-spinner" aria-hidden="true" /> : <i className="bi bi-image" aria-hidden="true" />}
            {shot.headline && <span>「{shot.headline}」</span>}
          </div>
        )}
      </div>
      <div className="assistant-commerce-shot-meta">
        <strong>{shot.label}</strong>
        <span className={`assistant-commerce-status is-${shot.status}`}>
          {failedCheck ? '待修正' : shot.reviewed && shot.pass ? '已检查' : STATUS_TEXT[shot.status] || shot.status}
        </span>
      </div>
      {failedCheck && shot.issues?.length > 0 && (
        <p className="assistant-commerce-issues">{shot.issues.join('；')}</p>
      )}
      {shot.canRedo && (failedCheck || shot.status === 'failed' || shot.status === 'succeeded') && (
        <button type="button" className="assistant-commerce-link" disabled={busy} onClick={() => onRedo(shot)}>
          重做{shot.priceCents ? `（${points(shot.priceCents)}）` : ''}
        </button>
      )}
    </li>
  )
}

export function AssistantCommerceSet({ initial }) {
  const [set, setSet] = useState(initial || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reviewingRef = useRef(false)
  const id = initial?.id || ''

  const refresh = useCallback(async (signal) => {
    if (!id) return
    const next = await getAssistantCommerceSet(id, { signal })
    if (next) setSet(next)
  }, [id])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal).catch(() => {})
    return () => controller.abort()
  }, [refresh])

  const generating = set?.status === 'generating'
  const anyRunning = Boolean(set?.shots?.some((shot) => RUNNING.has(shot.status)))
  useEffect(() => {
    if (!generating) return undefined
    const timer = window.setInterval(() => { refresh().catch(() => {}) }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [generating, refresh])

  // Every image of this round finished: run the quality check once.
  useEffect(() => {
    if (!set?.needsReview || anyRunning || reviewingRef.current) return
    reviewingRef.current = true
    reviewAssistantCommerceSet(id)
      .then((result) => {
        if (result?.set) setSet(result.set)
        if (result?.autoRedo?.length) setNotice(`检查发现 ${result.autoRedo.length} 张有问题，已在自动授权预算内重做。`)
        else if (result?.redoBlocked) setNotice(result.redoBlocked)
      })
      .catch(() => {})
      .finally(() => { reviewingRef.current = false })
  }, [anyRunning, id, set?.needsReview])

  const act = async (action) => {
    setBusy(true)
    setError('')
    try {
      const next = await action()
      if (next) setSet(next)
    } catch (caught) {
      setError(caught?.message || '操作失败，请重试')
      refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  if (!set) return null
  const shots = Array.isArray(set.shots) ? set.shots : []
  const planned = set.status === 'planned'
  const title = ['电商套图', set.productName, set.platform].filter(Boolean).join(' · ')
  const progress = planned ? `${shots.length} 张 · 预计 ${points(set.quotedCents)}` : `已完成 ${set.done}/${set.total} · 已用 ${points(set.approvedCents)}`

  return (
    <section className="assistant-data assistant-commerce" aria-label="电商套图">
      <header className="assistant-data-head">
        <span>{title}</span>
        <span className="assistant-data-sub">{progress}</span>
      </header>
      {set.summary && <p className="assistant-commerce-summary">视觉主线：{set.summary}</p>}
      <ul className="assistant-commerce-grid">
        {shots.map((shot) => (
          <ShotTile key={shot.id} shot={shot} busy={busy}
            onRedo={(target) => act(() => redoAssistantCommerceShots(id, { shotIds: [target.id], expectedTotalCents: target.priceCents || 0 }))} />
        ))}
      </ul>
      {planned && (
        <div className="assistant-commerce-actions">
          <button type="button" className="assistant-commerce-primary" disabled={busy}
            onClick={() => act(() => generateAssistantCommerceSet(id, set.quotedCents))}>
            {busy ? '提交中…' : `确认生成（${points(set.quotedCents)}）`}
          </button>
          {set.confirmationNote && <span className="assistant-data-note">{set.confirmationNote}</span>}
        </div>
      )}
      {set.ready && (
        <div className="assistant-commerce-actions">
          <a className="assistant-commerce-primary" href={assistantCommerceSetArchiveUrl(id)} download>下载全部</a>
          <Link className="assistant-commerce-link" to={set.workbenchLink || '/ecommerce-design'}>在电商工作台继续调整</Link>
        </div>
      )}
      {generating && !set.ready && (
        <p className="assistant-data-note">{anyRunning ? '正在逐张生成，完成后会自动检查。' : '正在检查成片…'}</p>
      )}
      {notice && <p className="assistant-data-note">{notice}</p>}
      {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
    </section>
  )
}
