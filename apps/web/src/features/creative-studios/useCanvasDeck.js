import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { gsap } from 'gsap'

/**
 * 画布 3D 阶梯瀑布流（参考实体卡片 feed 动画）：
 * 卡片向上层层退后成阶梯；进场时整叠从高处向下流动，
 * 最前一张摆正放大定格；翻页时前卡先向镜头「抽出」再甩出画布底部，
 * 同时从阶梯深处回流补位（两张以上无限循环）。
 *
 * 平滑：滚轮/拖拽只更新目标值，gsap.ticker 逐帧做指数阻尼跟随，
 * 停止输入后自动吸附最近一张；所有逐帧样式直接写 DOM，不走 Vue 响应式。
 */
export function useCanvasDeck({ items, enabled, reducedMotion, getContainer }) {
  const entered = ref(false)
  const dragging = ref(false)
  const frontIndex = ref(0)

  // 动画内部状态（非响应式）
  const state = { progress: 0 }
  let target = 0
  let cards = []
  let tickerOn = false
  let dragStartY = 0
  let dragStartProgress = 0
  let rafTilt = 0
  let snapTimer = 0

  const count = computed(() => items.value?.length || 0)
  const active = computed(() => Boolean(enabled.value) && count.value > 0)
  const looping = computed(() => count.value >= 2)

  // 循环环绕：把 index 相对 progress 的差值映射到 (-0.7, n-0.7]，
  // 前方留 0.7 张的行程给「抽出」动作，之后从阶梯最深处回流
  function wrapDelta(index, p, n) {
    let raw = (index - p) % n
    if (raw < 0) raw += n
    if (raw > n - 0.7) raw -= n
    return raw
  }

  function refreshCards() {
    const root = getContainer?.()
    cards = root ? Array.from(root.querySelectorAll('.ga-card')) : []
    applyStyles()
  }

  // 退出堆叠模式时清掉逐帧写入的内联样式，避免污染平面布局
  function clearStyles() {
    const root = getContainer?.()
    const targets = root ? Array.from(root.querySelectorAll('.ga-card')) : cards
    for (const el of targets) {
      if (!el) continue
      const style = el.style
      style.removeProperty('--deck-y')
      style.removeProperty('--deck-z')
      style.removeProperty('--deck-scale')
      style.removeProperty('--deck-rx')
      style.removeProperty('--deck-rz')
      style.removeProperty('--deck-dim')
      style.opacity = ''
      style.zIndex = ''
      style.filter = ''
      style.visibility = ''
    }
    cards = []
  }

  function applyStyles() {
    const p = state.progress
    const n = cards.length
    for (let index = 0; index < n; index++) {
      const el = cards[index]
      if (!el) continue
      const d = n >= 2 ? wrapDelta(index, p, n) : index - p
      const behind = Math.max(0, d)
      const ahead = Math.max(0, -d)
      // d≈0 最前（摆正、锚在中下方）；d>0 向上退后成阶梯
      // d<0 抽出：先向镜头抬起放大，再加速甩出画布底部
      const y = 44 + behind * -72 + (-70 * ahead + 620 * ahead * ahead)
      const z = behind * -58 + ahead * 240
      const scale = Math.max(0.68, 1 - behind * 0.05) + ahead * 0.1
      const rotX = Math.min(15, behind * 5) - ahead * 16
      const rotZ = ahead * -6
      // 不再用运行时 blur 做景深（GPU 开销大且低端机明显掉帧），深度感交给压暗+缩小
      const dim = Math.min(0.58, Math.max(0, behind * 0.16))
      // 抽出的卡前 0.28 张保持实体（让「抬起」动作可读），随后快速淡出；
      // 回流进阶梯深处时快速淡入
      let opacity = 1
      if (d < 0) {
        opacity = ahead < 0.34 ? 1 : Math.max(0, 1 - (ahead - 0.34) / 0.32)
      } else {
        if (behind > 3.4) opacity = Math.max(0, 1 - (behind - 3.4) * 0.55)
        if (n >= 2) {
          const backEdge = Math.max(0, (n - 0.7 - behind) / 0.28)
          opacity = Math.min(opacity, Math.min(1, backEdge))
        }
      }
      const style = el.style
      style.setProperty('--deck-y', `${y.toFixed(1)}px`)
      style.setProperty('--deck-z', `${z.toFixed(1)}px`)
      style.setProperty('--deck-scale', scale.toFixed(3))
      style.setProperty('--deck-rx', `${rotX.toFixed(2)}deg`)
      style.setProperty('--deck-rz', `${rotZ.toFixed(2)}deg`)
      style.setProperty('--deck-dim', dim.toFixed(2))
      style.opacity = opacity.toFixed(3)
      style.zIndex = String(Math.round(1000 - d * 10))
      // 完全不可见的卡直接跳过合成，省掉透明层的 GPU 开销
      style.visibility = opacity <= 0.002 ? 'hidden' : ''
    }
    const front = n ? ((Math.round(p) % n) + n) % n : 0
    if (front !== frontIndex.value) frontIndex.value = front
  }

  // —— 阻尼跟随：progress 逐帧向 target 收敛，收敛完成自动停表 ——
  function tick(_time, deltaMs) {
    const diff = target - state.progress
    if (Math.abs(diff) < 0.0006) {
      state.progress = target
      applyStyles()
      stopTicker()
      normalize()
      return
    }
    const dt = Math.min(deltaMs, 64) / 1000
    state.progress += diff * Math.min(1, 1 - Math.exp(-4.6 * dt))
    applyStyles()
  }

  function startTicker() {
    if (tickerOn) return
    tickerOn = true
    gsap.ticker.add(tick)
  }

  function stopTicker() {
    if (!tickerOn) return
    tickerOn = false
    gsap.ticker.remove(tick)
  }

  // 长时间循环滚动后把 progress/target 同步归一化，避免数值无限增长
  function normalize() {
    const n = count.value
    if (n < 2) return
    const norm = ((state.progress % n) + n) % n
    if (norm !== state.progress) {
      target += norm - state.progress
      state.progress = norm
    }
  }

  function setTarget(value, { snapDelay = 150 } = {}) {
    if (!looping.value) value = 0
    target = value
    startTicker()
    window.clearTimeout(snapTimer)
    // 输入停顿后吸附到最近一张
    snapTimer = window.setTimeout(() => {
      target = Math.round(target)
      startTicker()
    }, snapDelay)
  }

  function scrubTo(value) {
    setTarget(value, { snapDelay: 0 })
  }

  function nudge(delta) {
    if (!active.value) return
    setTarget(Math.round(target + delta), { snapDelay: 0 })
  }

  function onWheel(event) {
    if (!active.value || count.value < 2) return
    event.preventDefault()
    if (reducedMotion?.value) {
      const step = Math.sign(event.deltaY || event.deltaX)
      state.progress = target = Math.round(target + step)
      applyStyles()
      normalize()
      return
    }
    // 像素级累加：触控板细腻跟手，滚轮一格（约 120~160px）推一张
    const px = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY || event.deltaX
    setTarget(target + px / 150)
  }

  function onPointerDown(event) {
    if (!active.value || count.value < 2) return
    if (event.button !== 0) return
    if (event.target?.closest?.('button, a, input, textarea, select, .ga-card-actions')) return
    dragging.value = true
    dragStartY = event.clientY
    dragStartProgress = state.progress
    window.clearTimeout(snapTimer)
    event.currentTarget?.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event) {
    if (!active.value) return
    const targetEl = event.currentTarget
    const rect = targetEl?.getBoundingClientRect?.()
    if (rect) {
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1
      cancelAnimationFrame(rafTilt)
      rafTilt = requestAnimationFrame(() => {
        const root = getContainer?.()
        if (!root) return
        root.style.setProperty('--tilt-x', `${(Math.max(-1, Math.min(1, nx)) * 5.5).toFixed(2)}deg`)
        root.style.setProperty('--tilt-y', `${(Math.max(-1, Math.min(1, ny)) * -4).toFixed(2)}deg`)
      })
    }
    if (!dragging.value) return
    const dy = event.clientY - dragStartY
    // 拖拽期间目标即时跟手，阻尼器保证不突兀
    setTarget(dragStartProgress + dy / 150, { snapDelay: 10_000 })
  }

  function onPointerUp(event) {
    if (!dragging.value) return
    dragging.value = false
    try {
      event.currentTarget?.releasePointerCapture?.(event.pointerId)
    } catch {
      /* ignore */
    }
    setTarget(Math.round(target), { snapDelay: 0 })
  }

  function onPointerLeave() {
    if (dragging.value) return
    const root = getContainer?.()
    if (root) {
      root.style.setProperty('--tilt-x', '0deg')
      root.style.setProperty('--tilt-y', '0deg')
    }
  }

  // 激活即定格：刷新进入时若画布已有成图，直接呈现堆叠终态，不跑进场动画
  function settle() {
    if (!active.value) return
    stopTicker()
    window.clearTimeout(snapTimer)
    void nextTick(() => {
      refreshCards()
      state.progress = 0
      target = 0
      applyStyles()
      entered.value = true
    })
  }

  watch(
    () => [active.value, count.value],
    ([isActive, n], prev) => {
      if (!isActive) {
        entered.value = false
        stopTicker()
        window.clearTimeout(snapTimer)
        clearStyles()
        return
      }
      const wasActive = prev?.[0]
      const prevCount = prev?.[1] ?? 0
      if (!wasActive || (n > 0 && prevCount === 0)) {
        settle()
      } else if (n !== prevCount) {
        target = Math.round(((target % n) + n) % n)
        state.progress = target
        void nextTick(refreshCards)
      }
    },
  )

  onBeforeUnmount(() => {
    stopTicker()
    cancelAnimationFrame(rafTilt)
    window.clearTimeout(snapTimer)
  })

  return {
    active,
    entered,
    dragging,
    frontIndex,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    settle,
    nudge,
    scrubTo,
  }
}
