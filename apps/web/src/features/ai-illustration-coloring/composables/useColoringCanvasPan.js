import { onUnmounted, ref, shallowRef } from 'vue'
import { gsap } from 'gsap'

const MIN_ZOOM = 1
const MAX_ZOOM = 4

/**
 * 插画染色画布平移 — 拖动期间直接改 DOM transform，避免 Vue 每帧重渲染掉帧。
 */
export function useColoringCanvasPan({ getNaturalSize, canPan, syncFrames = () => false }) {
  const pans = shallowRef({
    source: { x: 0, y: 0 },
    result: { x: 0, y: 0 },
  })
  const isPanning = ref(false)
  const activeFrame = ref('')
  const zoom = ref(1)
  /** @type {Map<string, HTMLElement>} */
  const transformEls = new Map()
  /** @type {Map<string, HTMLElement>} */
  const bodyEls = new Map()
  let panStart = null
  let panFrame = 0
  let pendingPan = null
  const observers = new Map()
  const transformObservers = new Map()
  const loadHandlers = new Map()
  const transformTweens = new Map()
  const boundsCache = new Map()

  function invalidateBounds(frameKey = '') {
    if (!frameKey) {
      boundsCache.clear()
      return
    }
    Array.from(boundsCache.keys()).forEach((key) => {
      if (key.startsWith(`${frameKey}:`)) boundsCache.delete(key)
    })
  }

  function getPan(frameKey) {
    return pans.value[frameKey] || { x: 0, y: 0 }
  }

  function getTransformTarget(frameKey) {
    const root = transformEls.get(frameKey)
    return root?.matches?.('img') ? root : root?.querySelector?.('img') || null
  }

  function sizeTransformTarget(frameKey) {
    const target = getTransformTarget(frameKey)
    const body = bodyEls.get(frameKey)
    if (!target || !body) return

    // 完整显示：交给 CSS max-width/max-height + object-fit:contain，保留自然比例。
    // 铺满：撑满视口，由 object-fit:cover 裁切。
    // 切勿在 contain 时写死像素宽高——视口未稳定或 meta 不准时会算错并被 overflow 裁切。
    if (canPan()) {
      target.style.width = '100%'
      target.style.height = '100%'
      target.style.maxWidth = 'none'
      target.style.maxHeight = 'none'
      target.style.objectFit = 'cover'
    } else {
      target.style.width = 'auto'
      target.style.height = 'auto'
      target.style.maxWidth = '100%'
      target.style.maxHeight = '100%'
      target.style.objectFit = 'contain'
    }
    target.style.display = 'block'
    target.style.transformOrigin = 'center center'
    invalidateBounds(frameKey)
    if (target.complete && target.naturalWidth > 0) {
      const current = getPan(frameKey)
      applyDomTransform(frameKey, current.x, current.y)
    }
  }

  function refreshLayout() {
    ;['source', 'result'].forEach((frameKey) => {
      sizeTransformTarget(frameKey)
      const body = bodyEls.get(frameKey)
      const current = getPan(frameKey)
      const clamped = clampPan(current.x, current.y, body, frameKey)
      setPan(frameKey, clamped, { syncVue: true })
    })
  }

  function shouldReduceMotion() {
    return (
      typeof window === 'undefined' ||
      document.documentElement.classList.contains('settings-no-animations') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  function killTransformTween(frameKey) {
    transformTweens.get(frameKey)?.kill()
    transformTweens.delete(frameKey)
  }

  function applyDomTransform(frameKey, x, y, { animate = false, duration = 0.22 } = {}) {
    const el = getTransformTarget(frameKey)
    if (!el) return
    killTransformTween(frameKey)
    if (!animate || shouldReduceMotion()) {
      // 拖动路径只写合成层，避免每帧创建 GSAP tween 和触发额外调度。
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom.value})`
      return
    }
    const vars = { x, y, scale: zoom.value, force3D: true }
    const tween = gsap.to(el, {
      ...vars,
      duration,
      ease: 'power2.out',
      overwrite: 'auto',
      onComplete: () => transformTweens.delete(frameKey),
    })
    transformTweens.set(frameKey, tween)
  }

  function setPan(frameKey, next, { syncVue = true, animate = false, duration } = {}) {
    applyDomTransform(frameKey, next.x, next.y, { animate, duration })
    if (!syncVue) return
    if (!pans.value[frameKey]) return
    pans.value = {
      ...pans.value,
      [frameKey]: { x: next.x, y: next.y },
    }
  }

  function resetPan(frameKey = '', { animate = false } = {}) {
    if (frameKey) {
      setPan(frameKey, { x: 0, y: 0 }, { animate })
      return
    }
    pans.value = {
      source: { x: 0, y: 0 },
      result: { x: 0, y: 0 },
    }
    applyDomTransform('source', 0, 0, { animate })
    applyDomTransform('result', 0, 0, { animate })
    isPanning.value = false
    panStart = null
    pendingPan = null
    if (panFrame) {
      cancelAnimationFrame(panFrame)
      panFrame = 0
    }
  }

  function getPanBounds(containerEl, frameKey = activeFrame.value, zoomLevel = zoom.value) {
    if (!containerEl || (!canPan() && zoomLevel <= 1)) return { maxX: 0, maxY: 0 }
    const fallback = getNaturalSize(frameKey)
    const target = getTransformTarget(frameKey)
    const naturalW = Math.max(1, Number(target?.naturalWidth || fallback.width || 1))
    const naturalH = Math.max(1, Number(target?.naturalHeight || fallback.height || 1))
    const cacheKey = `${frameKey}:${zoomLevel}:${Math.round(containerEl.clientWidth)}x${Math.round(containerEl.clientHeight)}:${naturalW}x${naturalH}:${canPan() ? 'cover' : 'contain'}`
    const cached = boundsCache.get(cacheKey)
    if (cached) return cached
    const rect = containerEl.getBoundingClientRect()
    const containerW = Math.max(1, rect.width)
    const containerH = Math.max(1, rect.height)
    const baseScale = canPan()
      ? Math.max(containerW / naturalW, containerH / naturalH)
      : Math.min(containerW / naturalW, containerH / naturalH)
    const displayW = naturalW * baseScale * zoomLevel
    const displayH = naturalH * baseScale * zoomLevel
    const bounds = {
      maxX: Math.max(0, (displayW - containerW) / 2),
      maxY: Math.max(0, (displayH - containerH) / 2),
    }
    boundsCache.set(cacheKey, bounds)
    return bounds
  }

  function clampPan(
    nextX,
    nextY,
    containerEl,
    frameKey = activeFrame.value,
    zoomLevel = zoom.value,
  ) {
    const { maxX, maxY } = getPanBounds(containerEl, frameKey, zoomLevel)
    return {
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    }
  }

  function flushPan() {
    panFrame = 0
    if (!pendingPan || !activeFrame.value) return
    const frameKey = activeFrame.value
    const next = pendingPan
    pendingPan = null
    // 拖动中只改 DOM，结束时再同步 Vue，避免每帧触发组件重渲染
    Object.entries(next).forEach(([key, value]) => applyDomTransform(key, value.x, value.y))
    if (panStart?.frameKey === frameKey) panStart.latestMap = next
  }

  function registerTransformEl(frameKey, el) {
    if (!frameKey) return
    const previousRoot = transformEls.get(frameKey)
    const previousHandler = loadHandlers.get(frameKey)
    if (previousRoot && previousHandler) previousRoot.removeEventListener('load', previousHandler, true)
    loadHandlers.delete(frameKey)
    transformObservers.get(frameKey)?.disconnect()
    transformObservers.delete(frameKey)
    if (el) {
      transformEls.set(frameKey, el)
      invalidateBounds(frameKey)
      const handleLoad = () => {
        sizeTransformTarget(frameKey)
        const current = getPan(frameKey)
        applyDomTransform(frameKey, current.x, current.y)
      }
      el.addEventListener('load', handleLoad, true)
      loadHandlers.set(frameKey, handleLoad)
      sizeTransformTarget(frameKey)
      const current = getPan(frameKey)
      applyDomTransform(frameKey, current.x, current.y)
      if (!el.matches?.('img') && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
          sizeTransformTarget(frameKey)
          applyDomTransform(frameKey, getPan(frameKey).x, getPan(frameKey).y)
        })
        observer.observe(el, { childList: true, subtree: true })
        transformObservers.set(frameKey, observer)
      }
    } else {
      killTransformTween(frameKey)
      transformEls.delete(frameKey)
    }
  }

  function registerBodyEl(frameKey, el) {
    if (!frameKey) return
    invalidateBounds(frameKey)
    if (el) bodyEls.set(frameKey, el)
    else bodyEls.delete(frameKey)
  }

  function onPanStart(event, frameKey) {
    if (!canPan() && zoom.value <= 1) return
    if (event.button != null && event.button !== 0) return
    activeFrame.value = frameKey
    isPanning.value = true
    killTransformTween(frameKey)
    const current = getPan(frameKey)
    panStart = {
      x: event.clientX,
      y: event.clientY,
      originX: current.x,
      originY: current.y,
      target: event.currentTarget,
      frameKey,
      latest: current,
      latestMap: { [frameKey]: current },
    }
    event.currentTarget?.setPointerCapture?.(event.pointerId)
  }

  function onPanMove(event) {
    if (!isPanning.value || !panStart) return
    // 阻止浏览器默认手势，减少合成层抖动
    if (event.cancelable) event.preventDefault()
    const frameKey = panStart.frameKey
    const next = clampPan(
      panStart.originX + (event.clientX - panStart.x),
      panStart.originY + (event.clientY - panStart.y),
      panStart.target,
      panStart.frameKey,
    )
    if (syncFrames()) {
      const otherKey = frameKey === 'source' ? 'result' : 'source'
      const otherBody = bodyEls.get(otherKey)
      const activeBounds = getPanBounds(panStart.target, frameKey)
      const otherBounds = getPanBounds(otherBody, otherKey)
      const normalizedX = activeBounds.maxX > 0 ? next.x / activeBounds.maxX : 0
      const normalizedY = activeBounds.maxY > 0 ? next.y / activeBounds.maxY : 0
      const otherNext = {
        x: normalizedX * otherBounds.maxX,
        y: normalizedY * otherBounds.maxY,
      }
      pendingPan = { [frameKey]: next, [otherKey]: otherNext }
    } else {
      pendingPan = { [frameKey]: next }
    }
    if (panFrame) return
    panFrame = requestAnimationFrame(flushPan)
  }

  function onPanEnd(event) {
    if (!isPanning.value) return
    if (panFrame) {
      cancelAnimationFrame(panFrame)
      panFrame = 0
    }
    if (pendingPan && activeFrame.value) {
      Object.entries(pendingPan).forEach(([key, value]) => setPan(key, value, { syncVue: true }))
      pendingPan = null
    } else if (activeFrame.value && panStart?.latestMap) {
      Object.entries(panStart.latestMap).forEach(([key, value]) =>
        setPan(key, value, { syncVue: true }),
      )
    }
    isPanning.value = false
    panStart = null
    activeFrame.value = ''
    try {
      event.currentTarget?.releasePointerCapture?.(event.pointerId)
    } catch {
      // ignore
    }
  }

  function bindFrameResize(el, frameKey) {
    const existing = observers.get(frameKey)
    existing?.disconnect()
    observers.delete(frameKey)
    registerBodyEl(frameKey, el || null)
    if (!el || typeof ResizeObserver === 'undefined') return () => {}
    const observer = new ResizeObserver(() => {
      sizeTransformTarget(frameKey)
      if (!canPan() && zoom.value <= 1) return
      const current = getPan(frameKey)
      const clamped = clampPan(current.x, current.y, el, frameKey)
      if (clamped.x !== current.x || clamped.y !== current.y) {
        setPan(frameKey, clamped, { syncVue: true })
      }
    })
    observer.observe(el)
    observers.set(frameKey, observer)
    return () => {
      observer.disconnect()
      observers.delete(frameKey)
      registerBodyEl(frameKey, null)
    }
  }

  /** 兼容旧调用：拖动中不再通过 style 绑定，返回空对象 */
  function mediaTransformStyle() {
    return {}
  }

  function setZoom(
    value,
    {
      frameKey: focusFrameKey = '',
      clientX = null,
      clientY = null,
      animate = true,
      duration = 0.2,
    } = {},
  ) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value) || MIN_ZOOM))
    if (next === zoom.value) return
    const previous = zoom.value
    zoom.value = next
    invalidateBounds()

    const shouldSync = Boolean(typeof syncFrames === 'function' ? syncFrames() : syncFrames)
    /** @type {{ frameKey: string, pan: { x: number, y: number } } | null} */
    let focusPan = null

    // 先算焦点画框「缩放到点击点」后的平移，再按归一化位置同步另一侧
    if (
      focusFrameKey &&
      Number.isFinite(clientX) &&
      Number.isFinite(clientY)
    ) {
      const body = bodyEls.get(focusFrameKey)
      if (body) {
        const current = getPan(focusFrameKey)
        const rect = body.getBoundingClientRect()
        const pointX = clientX - (rect.left + rect.width / 2)
        const pointY = clientY - (rect.top + rect.height / 2)
        const ratio = next / Math.max(previous, 0.0001)
        focusPan = {
          frameKey: focusFrameKey,
          pan: clampPan(
            pointX - (pointX - current.x) * ratio,
            pointY - (pointY - current.y) * ratio,
            body,
            focusFrameKey,
            next,
          ),
        }
      }
    }

    ;['source', 'result'].forEach((frameKey) => {
      const body = bodyEls.get(frameKey)
      const current = getPan(frameKey)
      let target = current

      if (focusPan) {
        if (frameKey === focusPan.frameKey) {
          target = focusPan.pan
        } else if (shouldSync) {
          const focusBody = bodyEls.get(focusPan.frameKey)
          const focusBounds = getPanBounds(focusBody, focusPan.frameKey, next)
          const otherBounds = getPanBounds(body, frameKey, next)
          const normalizedX = focusBounds.maxX > 0 ? focusPan.pan.x / focusBounds.maxX : 0
          const normalizedY = focusBounds.maxY > 0 ? focusPan.pan.y / focusBounds.maxY : 0
          target = {
            x: normalizedX * otherBounds.maxX,
            y: normalizedY * otherBounds.maxY,
          }
        }
      }

      const clamped = clampPan(target.x, target.y, body, frameKey, next)
      setPan(frameKey, clamped, { syncVue: true, animate, duration })
    })
  }

  function zoomBy(delta, options = {}) {
    setZoom(Math.round((zoom.value + Number(delta || 0)) * 100) / 100, options)
  }

  function onZoomWheel(event, frameKey) {
    if (!event?.currentTarget) return
    if (event.cancelable) event.preventDefault()
    const next = Math.round(zoom.value * Math.exp(-Number(event.deltaY || 0) * 0.0016) * 100) / 100
    setZoom(next, {
      frameKey,
      clientX: event.clientX,
      clientY: event.clientY,
      animate: true,
      duration: 0.14,
    })
  }

  function onZoomDoubleClick(event, frameKey) {
    if (event?.cancelable) event.preventDefault()
    if (zoom.value > MIN_ZOOM) {
      resetView()
      return
    }
    setZoom(2, {
      frameKey,
      clientX: event?.clientX,
      clientY: event?.clientY,
    })
  }

  function resetView() {
    zoom.value = 1
    resetPan('', { animate: true })
  }

  onUnmounted(() => {
    resetPan()
    observers.forEach((observer) => observer.disconnect())
    observers.clear()
    transformObservers.forEach((observer) => observer.disconnect())
    transformObservers.clear()
    loadHandlers.forEach((handler, frameKey) => {
      transformEls.get(frameKey)?.removeEventListener('load', handler, true)
    })
    loadHandlers.clear()
    transformTweens.forEach((tween) => tween.kill())
    transformTweens.clear()
    transformEls.clear()
    bodyEls.clear()
  })

  return {
    pans,
    isPanning,
    activeFrame,
    zoom,
    zoomBy,
    onZoomWheel,
    onZoomDoubleClick,
    resetView,
    resetPan,
    bindFrameResize,
    registerTransformEl,
    refreshLayout,
    mediaTransformStyle,
    onPanStart,
    onPanMove,
    onPanEnd,
  }
}
