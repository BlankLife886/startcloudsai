// 详情页长图预览：把套图里的详情页按顺序拼起来，放进手机框里像买家一样上下滑着看。
// 右侧是分屏目录，点一屏手机里就滚到那一屏，拖动可以调整顺序、点 × 移除某一屏（手机和长图都跟着变）；
// 全部出完后可以下载拼好的长图。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './assistant-detail-preview.css'

// 淘宝、京东详情页的通用宽度。
const LONG_IMAGE_WIDTH = 750
// 浏览器画布高度上限约 32767，留点余量。
const LONG_IMAGE_MAX_HEIGHT = 30000
// 关闭动画的时长，和 CSS 里的 adp-out 一致。
const CLOSE_MS = 180
// 磨砂状态栏的高度：内容从它下面滚过去，定位某一屏时要让开它。
const STATUS_BAR = 44

async function loadBitmap(src) {
  const response = await fetch(src, { credentials: 'include' })
  if (!response.ok) throw new Error(`有一屏图片读取失败（${response.status}），请稍后重试`)
  try {
    return await createImageBitmap(await response.blob())
  } catch {
    throw new Error('有一屏图片无法解析，请稍后重试')
  }
}

// 按顺序竖着拼成一张 750 宽的 JPG；太长时整体缩小。
export async function stitchLongImage(sources) {
  const bitmaps = await Promise.all(sources.map(loadBitmap))
  try {
    const heights = bitmaps.map((bitmap) => (bitmap.height * LONG_IMAGE_WIDTH) / bitmap.width)
    const total = heights.reduce((sum, value) => sum + value, 0)
    const scale = Math.min(1, LONG_IMAGE_MAX_HEIGHT / total)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(LONG_IMAGE_WIDTH * scale)
    canvas.height = Math.round(total * scale)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    let y = 0
    bitmaps.forEach((bitmap, index) => {
      const height = heights[index] * scale
      context.drawImage(bitmap, 0, Math.round(y), canvas.width, Math.round(height))
      y += height
    })
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('长图导出失败'))), 'image/jpeg', 0.92)
    })
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close?.())
  }
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 调好的顺序和移除的屏只记在这台设备上，下次打开同一套图还是这样；不改套图本身。
// 存的是 { order: [全部屏 id，含已移除], hidden: [已移除 id] }；旧版只存了顺序数组。
const EMPTY_LAYOUT = { order: [], hidden: [] }
function layoutKey(storageKey) {
  return storageKey ? `assistant-detail-order:${storageKey}` : ''
}
function readLayout(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey(storageKey)) || 'null')
    if (Array.isArray(saved)) return { order: saved.map(String), hidden: [] }
    if (saved && typeof saved === 'object') {
      return {
        order: Array.isArray(saved.order) ? saved.order.map(String) : [],
        hidden: Array.isArray(saved.hidden) ? saved.hidden.map(String) : [],
      }
    }
  } catch {
    // 读不到就用默认
  }
  return EMPTY_LAYOUT
}
function writeLayout(storageKey, layout) {
  try {
    if (layout) localStorage.setItem(layoutKey(storageKey), JSON.stringify(layout))
    else localStorage.removeItem(layoutKey(storageKey))
  } catch {
    // 存不了就只在这次预览里生效
  }
}

function screenId(screen, index) {
  return String(screen?.id || index)
}

// 已保存的顺序里还在的先排，新出现的屏按原顺序接在后面。
function applyOrder(screens, order) {
  const byId = new Map(screens.map((screen, index) => [screenId(screen, index), screen]))
  const out = []
  for (const id of order) if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id) }
  return [...out, ...byId.values()]
}

const DRAG_THRESHOLD = 4

// 提前把前几屏和目录缩略图下载并解码好：鼠标移到「预览详情页」上时调用，
// 点开时图片已经在内存里，打开动画不会被首次解码卡住。
const warmed = new Set()
export function warmDetailPreview(screens, count = 2) {
  for (const screen of (Array.isArray(screens) ? screens : []).slice(0, count)) {
    const src = screen?.src
    if (!src || screen.pending || warmed.has(src)) continue
    warmed.add(src)
    const image = new Image()
    image.decoding = 'async'
    image.src = src
    image.decode?.().catch(() => warmed.delete(src))
  }
}

function screenRatio(value) {
  const [w, h] = String(value || '').split(':').map(Number)
  return w > 0 && h > 0 ? `${w} / ${h}` : '3 / 4'
}

/**
 * screens: [{ id, label, headline, src, fullSrc, ratio, pending }]
 */
export function AssistantDetailPreview({ open, dark = false, title, subtitle, screens: sourceScreens = [], storageKey = '', onClose }) {
  const [layout, setLayout] = useState(() => readLayout(storageKey))
  useEffect(() => { setLayout(readLayout(storageKey)) }, [storageKey])
  const idOf = useCallback((screen) => screenId(screen, sourceScreens.indexOf(screen)), [sourceScreens])
  // ordered：全部屏按调好的顺序；screens：去掉已移除的，手机、目录和长图都用它。
  const ordered = useMemo(() => applyOrder(sourceScreens, layout.order), [sourceScreens, layout.order])
  const hiddenIds = useMemo(() => new Set(layout.hidden), [layout.hidden])
  const screens = useMemo(() => ordered.filter((screen) => !hiddenIds.has(idOf(screen))), [ordered, hiddenIds, idOf])
  const removed = useMemo(() => ordered.filter((screen) => hiddenIds.has(idOf(screen))), [ordered, hiddenIds, idOf])
  const customized = removed.length > 0 || ordered.map(idOf).join('|') !== sourceScreens.map(screenId).join('|')
  const [drag, setDrag] = useState(null)
  // 落位那一帧关掉过渡，不然让位的行会从旧位置再滑一次
  const [settling, setSettling] = useState(false)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const scrollRef = useRef(null)
  const screenRefs = useRef([])
  const [active, setActive] = useState(0)
  const [progress, setProgress] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const closeTimer = useRef(0)

  // 先播一段淡出缩小，再真正关掉；系统要求减少动效时直接关。
  const requestClose = useCallback(() => {
    if (closeTimer.current) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) { closeRef.current?.(); return }
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = 0
      // 和关闭放在同一次更新里：组件关掉后还挂着，下次打开不能带着“正在关闭”的样式，
      // 否则第一帧会先播一遍淡出再淡入，看起来一闪。
      setClosing(false)
      closeRef.current?.()
    }, CLOSE_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  // 打开前（绘制前）把上次留下的状态清掉，第一帧就是干净的。
  useLayoutEffect(() => {
    if (!open) return
    setActive(0)
    setProgress(0)
    setError('')
    setClosing(false)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); requestClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, requestClose])

  // 当前看到哪一屏：取手机屏幕上沿往下三分之一处落在哪一屏；滑到底就是最后一屏
  // （最后一屏通常滚不到顶）。
  const onScroll = useCallback(() => {
    const box = scrollRef.current
    if (!box) return
    const max = box.scrollHeight - box.clientHeight
    setProgress(max > 0 ? box.scrollTop / max : 0)
    const probe = box.scrollTop + STATUS_BAR + (box.clientHeight - STATUS_BAR) / 3
    let index = 0
    screenRefs.current.forEach((node, i) => { if (node && node.offsetTop <= probe) index = i })
    if (max > 0 && box.scrollTop >= max - 2) index = screens.length - 1
    setActive(index)
  }, [screens.length])

  const jump = (index) => {
    const box = scrollRef.current
    const node = screenRefs.current[index]
    if (box && node) box.scrollTo({ top: node.offsetTop - STATUS_BAR, behavior: 'smooth' })
  }

  const saveLayout = (next) => {
    setLayout(next)
    writeLayout(storageKey, next)
  }
  // 只调整没移除的屏：它们按新顺序填回原来的位置，已移除的留在原位，恢复时回到原处。
  const move = (from, to) => {
    if (from === to || to < 0 || to >= screens.length) return
    const visible = screens.map(idOf)
    const [id] = visible.splice(from, 1)
    visible.splice(to, 0, id)
    let cursor = 0
    const order = ordered.map((screen) => (hiddenIds.has(idOf(screen)) ? idOf(screen) : visible[cursor++]))
    saveLayout({ order, hidden: layout.hidden })
    setActive(to)
    // 等手机里的顺序换好再滚过去
    window.requestAnimationFrame(() => jump(to))
  }
  // 至少留一屏。
  const remove = (index) => {
    if (screens.length <= 1) return
    const id = idOf(screens[index])
    saveLayout({ order: ordered.map(idOf), hidden: [...layout.hidden, id] })
    setActive((current) => Math.max(0, Math.min(current > index ? current - 1 : current, screens.length - 2)))
  }
  const restore = (id) => {
    saveLayout({ order: ordered.map(idOf), hidden: layout.hidden.filter((item) => item !== id) })
  }
  const resetLayout = () => {
    setLayout(EMPTY_LAYOUT)
    writeLayout(storageKey, null)
  }

  // 拖动排序：按住一行上下拖，其他行让出位置，松手落位。移动不到几像素算点击。
  const onRowPointerDown = (event, index) => {
    if (event.button !== 0) return
    const rows = [...event.currentTarget.closest('ol').children].map((node) => node.getBoundingClientRect())
    dragRef.current = { index, startY: event.clientY, rows, pointerId: event.pointerId, moving: false, target: index }
  }
  const onRowPointerMove = (event) => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    // 没按着键：松手发生在别处没收到，丢掉这次拖动
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      dragRef.current = null
      setDrag(null)
      return
    }
    const dy = event.clientY - state.startY
    if (!state.moving) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return
      state.moving = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    const origin = state.rows[state.index]
    const center = origin.top + origin.height / 2 + dy
    // 落点 = 中线在被拖那一行中心之上的其他行有几行
    const target = state.rows.filter((rect, i) => i !== state.index && rect.top + rect.height / 2 < center).length
    state.target = target
    setDrag({ index: state.index, target, dy, shift: origin.height + (state.rows[1] ? state.rows[1].top - state.rows[0].bottom : 0) })
  }
  const onRowPointerUp = (event) => {
    const state = dragRef.current
    dragRef.current = null
    if (!state || state.pointerId !== event.pointerId) return
    if (!state.moving) return
    suppressClickRef.current = true
    setSettling(true)
    setDrag(null)
    move(state.index, state.target)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setSettling(false)))
  }
  const rowStyle = (index) => {
    if (!drag) return undefined
    if (index === drag.index) return { transform: `translateY(${drag.dy}px)` }
    if (drag.index < index && index <= drag.target) return { transform: `translateY(${-drag.shift}px)` }
    if (drag.target <= index && index < drag.index) return { transform: `translateY(${drag.shift}px)` }
    return { transform: 'translateY(0)' }
  }
  const onRowClick = (index) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    jump(index)
  }
  const onRowKeyDown = (event, index) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && screens.length > 1) {
      event.preventDefault()
      remove(index)
      window.requestAnimationFrame(() => {
        document.querySelectorAll('.adp-row-main')[Math.min(index, screens.length - 2)]?.focus()
      })
      return
    }
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const to = index + (event.key === 'ArrowUp' ? -1 : 1)
    move(index, to)
    window.requestAnimationFrame(() => {
      document.querySelectorAll('.adp-row-main')[to]?.focus()
    })
  }

  const ready = screens.length > 0 && screens.every((screen) => !screen.pending && screen.src)
  const download = async () => {
    setSaving(true)
    setError('')
    try {
      const blob = await stitchLongImage(screens.map((screen) => screen.fullSrc || screen.src))
      saveBlob(blob, `${title || '商品'}-详情页.jpg`)
    } catch (caught) {
      setError(caught?.message || '长图导出失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  const doneCount = screens.filter((screen) => !screen.pending && screen.src).length

  return createPortal(
    <div className={`adp${dark ? ' is-dark' : ''}${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="详情页预览"
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) requestClose() }}>
      <button type="button" className="adp-close" aria-label="关闭预览" title="关闭 (Esc)" onClick={requestClose}><i className="bi bi-x-lg" /></button>

      <div className="adp-body">
        {/* 手机：钛金属中框 → 黑色屏幕边框 → 屏幕，三层圆角同心；侧边是实体按键，中框上有天线隔断条 */}
        <div className="adp-phone">
          <span className="adp-phone-key is-action" aria-hidden="true" />
          <span className="adp-phone-key is-volume-up" aria-hidden="true" />
          <span className="adp-phone-key is-volume-down" aria-hidden="true" />
          <span className="adp-phone-key is-power" aria-hidden="true" />
          {['tl', 'tr', 'bl', 'br'].map((place) => <span key={place} className={`adp-phone-band is-${place}`} aria-hidden="true" />)}
          <div className="adp-phone-bezel">
          <div className="adp-phone-screen">
            <div className="adp-phone-status" aria-hidden="true">
              <span className="adp-phone-ear is-left">9:41</span>
              <span className="adp-phone-island"><i /></span>
              <span className="adp-phone-ear is-right">
                {/* iOS 状态栏图标：信号、电池 */}
                <svg width="16" height="10" viewBox="0 0 16 10"><rect x="0" y="6.5" width="3" height="3.5" rx="0.8" /><rect x="4.3" y="4.5" width="3" height="5.5" rx="0.8" /><rect x="8.6" y="2.3" width="3" height="7.7" rx="0.8" /><rect x="12.9" y="0" width="3" height="10" rx="0.8" /></svg>
                <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20.5" height="10" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.4" /><rect x="2" y="2" width="17.5" height="7" rx="1.8" /><path d="M22.3 3.8v3.4c.7-.3 1.2-1 1.2-1.7s-.5-1.4-1.2-1.7Z" fillOpacity="0.45" /></svg>
              </span>
            </div>
            <div className="adp-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label="详情页内容，可上下滚动">
              {screens.map((screen, index) => (
                <div key={screen.id || index} ref={(node) => { screenRefs.current[index] = node }} className="adp-screen" style={{ aspectRatio: screenRatio(screen.ratio) }}>
                  {screen.src && !screen.pending
                    ? <img src={screen.src} alt={screen.label || `第 ${index + 1} 屏`} loading={index < 2 ? 'eager' : 'lazy'} decoding={index < 2 ? 'sync' : 'async'} />
                    : <div className="adp-screen-pending"><span className="adp-spinner" aria-hidden="true" />{screen.label || `第 ${index + 1} 屏`} 生成中</div>}
                </div>
              ))}
            </div>
            <span className="adp-scrollbar" aria-hidden="true"><i style={{ top: `${progress * 100}%`, transform: `translateY(-${progress * 100}%)` }} /></span>
            <span className="adp-phone-home" aria-hidden="true" />
          </div>
          </div>
        </div>

        <aside className="adp-side">
          <header>
            <span className="adp-kicker"><i className="bi bi-phone" aria-hidden="true" />详情页预览</span>
            <h2 title={title}>{title || '商品详情页'}</h2>
            <p>{[subtitle, `${screens.length} 屏`, ready ? `${LONG_IMAGE_WIDTH} 宽长图` : `已出 ${doneCount}/${screens.length}`].filter(Boolean).join(' · ')}</p>
          </header>

          <ol className={`adp-list${drag ? ' is-dragging' : ''}${settling ? ' is-settling' : ''}`}>
            {screens.map((screen, index) => {
              const name = screen.label || `第 ${index + 1} 屏`
              return (
                <li key={screen.id || index} className={`adp-row${index === active ? ' is-active' : ''}${drag?.index === index ? ' is-lifted' : ''}`} style={rowStyle(index)}>
                  <button type="button" className="adp-row-main" aria-current={index === active ? 'true' : undefined}
                    title="点击查看，拖动调整顺序（Alt + ↑↓），Delete 移除"
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => onRowClick(index)} onKeyDown={(event) => onRowKeyDown(event, index)}
                    onPointerDown={(event) => onRowPointerDown(event, index)} onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
                    <span className="adp-thumb">{screen.src && !screen.pending ? <img src={screen.src} alt="" draggable={false} decoding="sync" /> : <span className="adp-spinner" aria-hidden="true" />}</span>
                    <span className="adp-item-text">
                      <strong><em>{String(index + 1).padStart(2, '0')}</em>{name}</strong>
                      {screen.headline ? <small>{screen.headline}</small> : null}
                    </span>
                    <i className="bi bi-grip-vertical adp-grip" aria-hidden="true" />
                  </button>
                  {screens.length > 1 ? (
                    <button type="button" className="adp-row-remove" aria-label={`移除「${name}」`} title="从详情页移除，可在下方恢复" onClick={() => remove(index)}>
                      <i className="bi bi-x-lg" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ol>

          {removed.length ? (
            <div className="adp-removed">
              <span>已移除 {removed.length} 屏，不会出现在长图里</span>
              <ul>
                {removed.map((screen) => {
                  const id = idOf(screen)
                  const name = screen.label || '未命名'
                  return (
                    <li key={id}>
                      <button type="button" aria-label={`恢复「${name}」`} title="恢复到详情页" onClick={() => restore(id)}>
                        <span className="adp-removed-thumb">{screen.src ? <img src={screen.src} alt="" draggable={false} decoding="async" /> : null}</span>
                        <span className="adp-removed-name">{name}</span>
                        <i className="bi bi-arrow-counterclockwise" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <footer>
            <button type="button" className="adp-primary" disabled={!ready || saving} onClick={download}
              title={ready ? '按顺序拼成一张长图下载' : '所有详情页出完后才能拼长图'}>
              {saving ? <span className="adp-spinner" aria-hidden="true" /> : <i className="bi bi-download" aria-hidden="true" />}
              {saving ? '正在拼接…' : '下载长图'}
            </button>
            {customized ? <button type="button" className="adp-reset" onClick={resetLayout}><i className="bi bi-arrow-counterclockwise" aria-hidden="true" />{removed.length ? '恢复默认（顺序和全部屏）' : '恢复原顺序'}</button> : null}
            {error ? <p className="adp-error" role="alert">{error}</p> : null}
          </footer>
        </aside>
      </div>
    </div>,
    document.body,
  )
}
