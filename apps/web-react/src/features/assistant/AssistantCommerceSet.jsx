// 电商套图卡片：v2 助手策划的一套电商图。方案阶段在这里确认生成；生成后轮询进度，
// 出完自动触发检查；不合格的可重做；点图片在图片编辑器里修改，改好的版本替换套图中的那一张；
// 详情页有两屏以上时可以在手机框里预览拼起来的效果；全部完成后可打包下载，或记住这套风格供下次沿用。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  ASSISTANT_MEMORIES_CHANGED_EVENT,
  assistantCommerceSetArchiveUrl,
  cancelAssistantCommerceShot,
  generateAssistantCommerceSet,
  getAssistantCommerceSet,
  listAssistantMemories,
  redoAssistantCommerceShots,
  rememberAssistantCommerceSet,
  reviewAssistantCommerceSet,
} from './services/assistantApi.js'
import { openAssistantMemoryPanel } from './AssistantMemoryViews.jsx'
import { assistantMessageVersions } from './domain/assistantVersions.js'
import { AssistantDetailPreview, warmDetailPreview } from './AssistantDetailPreview.jsx'
import './assistant-commerce-set.css'

// 编辑器替换了套图里的图之后通知卡片刷新。
export const COMMERCE_SET_CHANGED_EVENT = 'assistant-commerce-set-changed'
// 卡片用它打开助手的图片编辑器：(item, index, gallery, meta) => void
export const AssistantImageOpenContext = createContext(null)
// 同一套图在一段对话里只显示一张可操作的完整卡片：放在最新提到它的那条消息里。
// 值是 Map<套图 id, { messageId, images, waiting }>，images 是那条消息里成片的指纹；
// waiting 表示后面有一条正在重新生成、且旧版本里出现过这套图的回复（比如重新发送了
// 下面的问题）：套图的实时状态可能来自被替换掉的回复，不能显示在这里。普通的新问题
// 和这套图无关，正在生成的卡片照常显示，不收起。
// 没有提供时每条消息照常显示。
export const CommerceSetOwnersContext = createContext(null)

// 一条消息里存的套图快照有哪些成片，用来判断较早的那一轮是不是已被换掉。
export function commerceSetSnapshotImages(set) {
  return (Array.isArray(set?.shots) ? set.shots : []).filter((shot) => shot?.imageUrl)
}

function snapshotKey(set) {
  return commerceSetSnapshotImages(set).map((shot) => shot.imageUrl).join('|')
}

export function commerceSetOwners(messages) {
  const owners = new Map()
  const list = Array.isArray(messages) ? messages : []
  list.forEach((message, index) => {
    for (const view of Array.isArray(message?.dataViews) ? message.dataViews : []) {
      if (view?.view === 'commerce_set' && view.data?.id) owners.set(view.data.id, { messageId: message.id, index, images: snapshotKey(view.data) })
    }
  })
  for (const [id, owner] of owners) {
    owner.waiting = list.slice(owner.index + 1).some((message) => regeneratingReplyTouchesSet(message, id))
  }
  return owners
}

function regeneratingReplyTouchesSet(message, setId) {
  if (message?.role !== 'assistant' || !message.pending) return false
  return assistantMessageVersions(message).some((version) => (Array.isArray(version?.metadata?.dataViews) ? version.metadata.dataViews : [])
    .some((view) => view?.view === 'commerce_set' && view.data?.id === setId))
}

function jumpToLatestCard(ownerMessageId) {
  const target = document.querySelector(`[data-message-id="${CSS.escape(ownerMessageId)}"] .assistant-commerce`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// 较早一轮的同一套图：这一轮出的图如果后来被重做或修改换掉了，原样留在这里（只读），
// 方便对照前后版本；没有自己的成片（如刚开始生成）或和最新一样时，只留一行引用。
export function CommerceSetEarlierRound({ set, owner, waiting = false }) {
  const openImage = useContext(AssistantImageOpenContext)
  const images = commerceSetSnapshotImages(set)
  if (!waiting && (!images.length || snapshotKey(set) === owner.images)) return <CommerceSetReference set={set} ownerMessageId={owner.messageId} />
  const gallery = images.map((shot) => ({
    ...shotImage(shot),
    studioMeta: { title: [set.productName, shot.label].filter(Boolean).join(' · '), prompt: shot.direction || shot.headline || shot.label, ratio: shot.aspectRatio },
  }))
  const open = (index) => {
    if (openImage) openImage(gallery[index], index, gallery, gallery[index].studioMeta)
    else window.open(images[index].originalUrl || images[index].imageUrl, '_blank', 'noopener')
  }
  return (
    <section className="assistant-commerce-earlier" aria-label="这一轮的成片">
      <header>
        <i className="bi bi-clock-history" aria-hidden="true" />
        <strong>{set.productName || '电商套图'}</strong>
        <span>这一轮的 {images.length} 张 · {waiting ? '下方正在处理新的要求' : '已被下方新版本替换'}</span>
        {waiting ? null : (
          <button type="button" onClick={() => jumpToLatestCard(owner.messageId)}>
            看最新<i className="bi bi-arrow-down" aria-hidden="true" />
          </button>
        )}
      </header>
      <ul>
        {images.map((shot, index) => (
          <li key={shot.id} style={{ '--shot-ratio': shotRatio(shot.aspectRatio) }}>
            <button type="button" aria-label={`查看这一轮的「${shot.label}」`} title={shot.label} onClick={() => open(index)}>
              <img src={shot.imageUrl} alt={shot.label} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// 较早消息里的同一套图：一行引用，点一下滚到最新那张卡片。
export function CommerceSetReference({ set, ownerMessageId }) {
  const jump = () => jumpToLatestCard(ownerMessageId)
  return (
    <button type="button" className="assistant-commerce-ref" onClick={jump}>
      <i className="bi bi-images" aria-hidden="true" />
      <strong>{set?.productName || '电商套图'}</strong>
      <span>电商套图 · 最新进度在下方</span>
      <i className="bi bi-arrow-down" aria-hidden="true" />
    </button>
  )
}

const POLL_MS = 4000

// 哪些套图已存为满意方案：以服务端的记忆列表为准。同一时刻多张卡片共用一次请求，
// 记忆有任何改动（包括在记忆面板里删除）时作废重查。
let favoriteSetIdsRequest = null
function loadFavoriteSetIds() {
  if (!favoriteSetIdsRequest) {
    favoriteSetIdsRequest = listAssistantMemories()
      .then((result) => new Set((Array.isArray(result?.items) ? result.items : []).map((item) => item.commerceSetId).filter(Boolean)))
      .catch(() => null)
  }
  return favoriteSetIdsRequest
}
if (typeof window !== 'undefined') {
  window.addEventListener(ASSISTANT_MEMORIES_CHANGED_EVENT, () => { favoriteSetIdsRequest = null })
}
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

function points(value) {
  return `${(Number(value) || 0).toLocaleString('zh-CN')} 积分`
}

function shotImage(shot) {
  return { id: `${shot.id}:${shot.attempts}`, fileKey: shot.fileKey || '', dataUrl: shot.originalUrl || shot.imageUrl, thumbUrl: shot.imageUrl, name: shot.label }
}

// 格子按这张图自己的比例显示，图片铺满格子，不留黑边。
function shotRatio(value) {
  const [w, h] = String(value || '').split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 1
}

function shotBadge(shot) {
  // 没出图的先说清楚是失败还是停止了，"待修正"只留给出了图但没通过检查的。
  if (RUNNING.has(shot.status)) return { tone: 'busy', text: STATUS_TEXT[shot.status] || '生成中' }
  if (shot.status === 'failed') return { tone: 'danger', icon: 'bi-x-circle', text: '生成失败' }
  if (shot.status === 'canceled' || shot.status === 'cancelled') return { tone: 'muted', icon: 'bi-stop-circle', text: '已停止' }
  if (shot.reviewed && !shot.pass) return { tone: 'danger', icon: 'bi-exclamation-circle', text: '待修正' }
  if (shot.edited) return { tone: 'ok', icon: 'bi-pencil', text: '已修改' }
  if (shot.reviewed && shot.pass) return { tone: 'ok', icon: 'bi-check-lg', text: '已检查', compact: true }
  return { tone: 'muted', text: STATUS_TEXT[shot.status] || shot.status }
}

function ShotTile({ shot, index, busy, stopNote, onOpen, onRedo, onStop, onKeepWaiting }) {
  const failedCheck = shot.reviewed && !shot.pass
  const badge = shotBadge(shot)
  const canRedo = shot.canRedo && (failedCheck || ['failed', 'succeeded', 'canceled', 'cancelled'].includes(shot.status))
  const canStop = Boolean(shot.taskId) && RUNNING.has(shot.status)
  return (
    <li className={`assistant-commerce-shot${failedCheck ? ' is-flagged' : ''}`} style={{ '--shot-ratio': shotRatio(shot.aspectRatio) }}>
      <div className="assistant-commerce-shot-frame">
        {shot.imageUrl ? (
          <button type="button" className="assistant-commerce-shot-open" aria-label={`查看并编辑「${shot.label}」`} onClick={() => onOpen(shot)}>
            <img src={shot.imageUrl} alt={shot.label} loading="lazy" />
          </button>
        ) : (
          <div className="assistant-commerce-shot-placeholder">
            {RUNNING.has(shot.status) ? <span className="assistant-commerce-spinner" aria-hidden="true" /> : <i className="bi bi-image" aria-hidden="true" />}
          </div>
        )}
        {/* 检查通过只用一个小对勾，不挡画面；需要处理的状态才写字 */}
        <span className={`assistant-commerce-badge is-${badge.tone}${badge.compact ? ' is-compact' : ''}`} title={badge.text}>
          {badge.tone === 'busy' ? <span className="assistant-commerce-dot" aria-hidden="true" /> : badge.icon && <i className={`bi ${badge.icon}`} aria-hidden="true" />}
          {badge.compact ? <span className="assistant-commerce-sr">{badge.text}</span> : badge.text}
        </span>
        {(canRedo || canStop) && (
          <div className="assistant-commerce-shot-tools">
            {canStop && (
              <button type="button" className="assistant-commerce-redo" disabled={busy} title="停止生成这一张"
                aria-label={`停止生成「${shot.label}」`} onClick={() => onStop(shot)}>
                <i className="bi bi-stop-circle" aria-hidden="true" />停止
              </button>
            )}
            {canRedo && (
              <button type="button" className="assistant-commerce-redo" disabled={busy} title={`按原方案重新生成这一张${shot.priceCents ? `，${points(shot.priceCents)}` : ''}`}
                aria-label={`重做${shot.priceCents ? ` · ${points(shot.priceCents)}` : ''}`} onClick={() => onRedo(shot)}>
                <i className="bi bi-arrow-repeat" aria-hidden="true" />重做
              </button>
            )}
          </div>
        )}
      </div>
      {stopNote && canStop && (
        <div className="assistant-commerce-stop-confirm" role="alertdialog" aria-label={`确认停止「${shot.label}」`}>
          <p>{stopNote}</p>
          <div>
            <button type="button" className="is-danger" disabled={busy} onClick={() => onStop(shot, true)}>仍然停止</button>
            <button type="button" disabled={busy} onClick={onKeepWaiting}>继续等待</button>
          </div>
        </div>
      )}
      <div className="assistant-commerce-shot-meta">
        <strong title={shot.label}><em>{String(index + 1).padStart(2, '0')}</em>{shot.label}</strong>
        {shot.headline && <span title={shot.headline}>{shot.headline}</span>}
      </div>
      {failedCheck && shot.imageUrl && shot.issues?.length > 0 && (
        <p className="assistant-commerce-issues">{shot.issues.join('；')}</p>
      )}
    </li>
  )
}

export function AssistantCommerceSet({ initial }) {
  const [set, setSet] = useState(initial || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [remembered, setRemembered] = useState(false)
  const [savedHint, setSavedHint] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewDark, setPreviewDark] = useState(false)
  const [stopConfirm, setStopConfirm] = useState(null)
  const cardRef = useRef(null)
  const reviewingRef = useRef(false)
  const openImage = useContext(AssistantImageOpenContext)
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

  useEffect(() => {
    const onChanged = (event) => {
      if (event.detail?.id !== id) return
      if (event.detail.set?.id) setSet(event.detail.set)
      else refresh().catch(() => {})
    }
    window.addEventListener(COMMERCE_SET_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(COMMERCE_SET_CHANGED_EVENT, onChanged)
  }, [id, refresh])

  useEffect(() => {
    if (!id) return undefined
    let alive = true
    const check = () => {
      loadFavoriteSetIds().then((ids) => { if (alive && ids) setRemembered(ids.has(id)) })
    }
    check()
    const onChanged = () => { favoriteSetIdsRequest = null; check() }
    window.addEventListener(ASSISTANT_MEMORIES_CHANGED_EVENT, onChanged)
    return () => {
      alive = false
      window.removeEventListener(ASSISTANT_MEMORIES_CHANGED_EVENT, onChanged)
    }
  }, [id])

  useEffect(() => {
    if (!savedHint) return undefined
    const timer = window.setTimeout(() => setSavedHint(false), 4000)
    return () => window.clearTimeout(timer)
  }, [savedHint])

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

  // 停止一张：还没送到上游的直接取消并退积分；已提交上游的先说明后果，确认后再停。
  const stopShot = (shot, acknowledgeUpstream = false) => act(async () => {
    setStopConfirm(null)
    try {
      await cancelAssistantCommerceShot(shot.taskId, { acknowledgeUpstream })
    } catch (caught) {
      if (caught?.code !== 'task_cancel_confirmation_required') throw caught
      setStopConfirm({ shotId: shot.id, message: caught.message })
      return null
    }
    return getAssistantCommerceSet(id)
  })

  if (!set) return null
  const shots = Array.isArray(set.shots) ? set.shots : []
  const planned = set.status === 'planned'
  const finishedShots = shots.filter((shot) => shot.imageUrl)
  const shotMeta = (shot) => ({
    title: [set.productName, shot.label].filter(Boolean).join(' · '),
    prompt: shot.direction || shot.headline || shot.label,
    ratio: shot.aspectRatio,
    requestRatio: shot.aspectRatio,
    commerceSetId: id,
    shotId: shot.id,
    shotLabel: shot.label,
  })
  const openShot = (shot) => {
    // 每张图带上自己的信息：在编辑器里切到别的图后，标题和“改好替换哪一张”跟着变。
    const gallery = finishedShots.map((entry) => ({ ...shotImage(entry), studioMeta: shotMeta(entry) }))
    const index = Math.max(0, finishedShots.findIndex((entry) => entry.id === shot.id))
    const meta = shotMeta(shot)
    if (openImage) openImage(gallery[index], index, gallery, meta)
    else window.open(shot.originalUrl || shot.imageUrl, '_blank', 'noopener')
  }
  // 整套图（主图 + 详情）按套图里的顺序拼成一页；还没出完的屏先占位。
  const canPreview = !planned && shots.length >= 2 && shots.some((shot) => shot.imageUrl)
  const previewScreens = shots.map((shot) => ({
    id: shot.id,
    label: shot.label,
    headline: shot.headline,
    src: shot.imageUrl,
    fullSrc: shot.originalUrl || shot.imageUrl,
    ratio: shot.aspectRatio,
    pending: !shot.imageUrl || RUNNING.has(shot.status),
  }))
  const openPreview = () => {
    setPreviewDark(Boolean(cardRef.current?.closest('.assistant-workspace')?.classList.contains('is-dark')))
    setPreviewOpen(true)
  }
  const previewButton = canPreview && (
    <button type="button" className="assistant-commerce-secondary" onClick={openPreview} title="把详情页按顺序拼起来，在手机框里滑着看"
      onPointerEnter={() => warmDetailPreview(previewScreens, previewScreens.length)} onFocus={() => warmDetailPreview(previewScreens, previewScreens.length)}>
      <i className="bi bi-phone" aria-hidden="true" />预览详情页
    </button>
  )
  const percent = set.total ? Math.round((set.done / set.total) * 100) : 0
  const statusText = planned ? `${shots.length} 张 · 预计 ${points(set.quotedCents)}`
    : set.ready ? `已完成 ${set.done}/${set.total}` : `生成中 ${set.done}/${set.total}`
  const spentText = planned ? '' : set.reservedCents > 0
    ? `已花 ${points(set.spentCents)} · 预留 ${points(set.reservedCents)}`
    : `已花 ${points(set.spentCents)}`

  return (
    <section className="assistant-data assistant-commerce" aria-label="电商套图" ref={cardRef}>
      <header className="assistant-commerce-head">
        <div className="assistant-commerce-title">
          <strong>{set.productName || '电商套图'}</strong>
          <span>{['电商套图', set.platform, set.language].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="assistant-commerce-progress">
          <span className={`assistant-commerce-state${set.ready ? ' is-ready' : planned ? '' : ' is-running'}`}>
            {set.ready ? <i className="bi bi-check-circle-fill" aria-hidden="true" /> : !planned && <span className="assistant-commerce-dot" aria-hidden="true" />}
            {statusText}
          </span>
          {spentText && <span className="assistant-commerce-spent">{spentText}</span>}
        </div>
      </header>
      {!planned && !set.ready && (
        <div className="assistant-commerce-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="套图进度">
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {set.summary && (
        <p className="assistant-commerce-summary" title={`视觉主线：${set.summary}`}>{set.summary}</p>
      )}
      <ul className="assistant-commerce-grid">
        {shots.map((shot, index) => (
          <ShotTile key={shot.id} shot={shot} index={index} busy={busy} onOpen={openShot}
            onRedo={(target) => act(() => redoAssistantCommerceShots(id, { shotIds: [target.id], expectedTotalCents: target.priceCents || 0 }))}
            stopNote={stopConfirm?.shotId === shot.id ? stopConfirm.message : ''}
            onStop={stopShot} onKeepWaiting={() => setStopConfirm(null)} />
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
          {set.downloadable > 0 && (
            <a className="assistant-commerce-primary" href={assistantCommerceSetArchiveUrl(id)} download>
              <i className="bi bi-download" aria-hidden="true" />
              {set.downloadable < set.total ? `下载已完成的 ${set.downloadable} 张` : '下载全部'}
            </a>
          )}
          {previewButton}
          {remembered
            ? (
              <button type="button" className="assistant-commerce-secondary is-done" title="在「记忆与提醒」里查看或删除" onClick={() => openAssistantMemoryPanel()}>
                <i className="bi bi-bookmark-check" aria-hidden="true" />已存为满意方案 · 查看
              </button>
            )
            : (
              <button type="button" className="assistant-commerce-secondary" disabled={busy}
                title="以后让我做电商套图时（包括新对话），会参考这套的视觉主线、风格和成图。可以在「记忆与提醒」里查看或删除。"
                onClick={() => act(async () => { await rememberAssistantCommerceSet(id); setRemembered(true); setSavedHint(true) })}>
                <i className="bi bi-bookmark-star" aria-hidden="true" />存为满意方案
              </button>
            )}
          {savedHint ? <span className="assistant-commerce-saved-hint" role="status">已存为满意方案，以后做电商套图会参考这一套</span> : null}
        </div>
      )}
      {!planned && !set.ready && previewButton && <div className="assistant-commerce-actions">{previewButton}</div>}
      {generating && !set.ready && (
        <p className="assistant-data-note">{anyRunning ? '正在逐张生成，完成后会自动检查。' : '正在检查成片…'}</p>
      )}
      {notice && <p className="assistant-data-note">{notice}</p>}
      {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
      <AssistantDetailPreview open={previewOpen && canPreview} dark={previewDark} title={set.productName || '商品详情页'}
        subtitle={set.platform} screens={previewScreens} storageKey={id} onClose={() => setPreviewOpen(false)} />
    </section>
  )
}
