/**
 * 沉浸式星宿命盘 — 三阶段流线揭示 + 活水动效
 */
import { easeInOutSine, easeOutCubic } from './ziweiStarfieldModel'
import { buildStarfieldLayout, pickStarfieldHit } from './ziweiStarfieldLayout'

const STAGE_DUR = { 1: 2.1, 2: 2.8, 3: 2.2 }
const STAGE_CAPTION = {
  1: '以身入局 · 本宫定位',
  2: '三方四正 · 气脉流转',
  3: '四正贯通 · 脉络归位',
  4: '点击宫位 · 切换三方四正',
}

export class ZwStarfieldCanvas {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.dpr = 1
    this.w = 0
    this.h = 0
    this.model = null
    this.flowPlan = null
    this.activeIndex = null
    this.hoverHit = null
    this.reveal = 0
    this.revealTarget = 1
    this.stage = 0
    this.stageProgress = 0
    this.stageElapsed = 0
    this.running = false
    this.raf = 0
    this.time = 0
    this.dust = []
    this.nebulae = []
    this.palaceParticles = []
    this.relationIndices = []
    this.flowDrops = []
    this.linkReveal = 1
    this.linkRevealTarget = 1
    this.layout = { nodes: [], hits: [] }
    this._onResize = () => this.resize()
    this._ro = null
  }

  mount() {
    this.resize()
    window.addEventListener('resize', this._onResize)
    if (typeof ResizeObserver !== 'undefined' && this.canvas?.parentElement) {
      this._ro = new ResizeObserver(() => this.resize())
      this._ro.observe(this.canvas.parentElement)
    }
    this.seedDust(880)
    this.seedNebulae()
    this.running = true
    this.tick()
  }

  destroy() {
    this.running = false
    window.removeEventListener('resize', this._onResize)
    this._ro?.disconnect()
    this._ro = null
    if (this.raf) cancelAnimationFrame(this.raf)
  }

  /** 视口缩放系数：小屏缩小流光/光晕，避免挤成一团 */
  layoutScale() {
    const min = Math.min(this.w, this.h) || 820
    return Math.max(0.48, Math.min(1, min / 820))
  }

  resize() {
    if (!this.canvas) return
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = this.canvas.parentElement?.getBoundingClientRect()
    const nextW = Math.max(1, rect?.width || window.innerWidth)
    const nextH = Math.max(1, rect?.height || window.innerHeight)
    const sizeChanged = Math.abs(nextW - this.w) > 0.5 || Math.abs(nextH - this.h) > 0.5
    this.w = nextW
    this.h = nextH
    this.canvas.width = Math.floor(this.w * this.dpr)
    this.canvas.height = Math.floor(this.h * this.dpr)
    this.canvas.style.width = `${this.w}px`
    this.canvas.style.height = `${this.h}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    if (sizeChanged) this.flowDrops = []
    this.seedDust(880)
    this.seedNebulae()
    this.rebuildLayout()
    this.syncPalaceParticles()
  }

  seedDust(n) {
    this.dust = Array.from({ length: n }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      z: Math.random(),
      drift: Math.random() * Math.PI * 2,
      speed: 0.08 + Math.random() * 0.22,
      size: 0.3 + Math.random() * 1.6,
      layer: Math.random() < 0.25 ? 2 : Math.random() < 0.5 ? 1 : 0,
    }))
  }

  seedNebulae() {
    this.nebulae = [
      { nx: 0.22, ny: 0.18, rx: 0.42, ry: 0.28, hue: [180, 160, 255], a: 0.07 },
      { nx: 0.78, ny: 0.72, rx: 0.38, ry: 0.32, hue: [139, 116, 240], a: 0.06 },
      { nx: 0.62, ny: 0.12, rx: 0.28, ry: 0.22, hue: [168, 120, 255], a: 0.045 },
      { nx: 0.5, ny: 0.5, rx: 0.55, ry: 0.45, hue: [251, 191, 36], a: 0.035 },
    ]
  }

  setModel(model, flowPlan = null) {
    this.model = model
    if (flowPlan) this.flowPlan = flowPlan
    this.rebuildLayout()
    this.syncPalaceParticles()
  }

  setFlowPlan(flowPlan, { animate = false } = {}) {
    if (!flowPlan) return
    const changed = this.flowPlan?.hubIndex !== flowPlan.hubIndex
    this.flowPlan = flowPlan
    this.flowDrops = []
    if (!changed) return
    if (this.stage >= 4) {
      this.linkReveal = 0
      this.linkRevealTarget = 1
    } else if (this.stage >= 2) {
      this.stage = 2
      this.stageProgress = 0
      this.stageElapsed = 0
    }
  }

  rebuildLayout() {
    if (!this.model) {
      this.layout = { nodes: [], hits: [] }
      return
    }
    this.layout = buildStarfieldLayout(this.ctx, this.model, this.w, this.h)
  }

  setActiveIndex(index) {
    this.activeIndex = index
  }

  setRelationIndices(indices) {
    this.relationIndices = indices || []
  }

  setHoverHit(hit) {
    this.hoverHit = hit
  }

  getStageCaption() {
    if (this.stage === 0) return '天幕星宿'
    return STAGE_CAPTION[this.stage] || STAGE_CAPTION[4]
  }

  playReveal() {
    this.stage = 1
    this.stageProgress = 0
    this.stageElapsed = 0
    this.reveal = 0
    this.revealTarget = 1
    this.flowDrops = []
    this.linkReveal = 1
    this.linkRevealTarget = 1
  }

  updateStages(dt) {
    if (this.stage < 1 || this.stage > 3) return
    this.stageElapsed += dt
    const dur = STAGE_DUR[this.stage]
    this.stageProgress = Math.min(1, this.stageElapsed / dur)
    if (this.stageProgress >= 1) {
      this.stage += 1
      this.stageElapsed = 0
      this.stageProgress = 0
    }
  }

  syncPalaceParticles() {
    if (!this.model) return
    this.palaceParticles = this.model.palaces.map((p) => ({
      palaceIndex: p.index,
      nx: p.nx,
      ny: p.ny,
      orbits: Array.from({ length: 6 + Math.floor(Math.random() * 4) }, () => ({
        angle: Math.random() * Math.PI * 2,
        radius: 6 + Math.random() * 16,
        speed: 0.004 + Math.random() * 0.012,
        size: 0.4 + Math.random() * 1,
      })),
    }))
  }

  centerPoint() {
    if (!this.model) return { x: this.w / 2, y: this.h / 2 }
    const padX = this.w * 0.02
    const padY = this.h * 0.02
    return {
      x: padX + this.model.center.nx * (this.w - padX * 2),
      y: padY + this.model.center.ny * (this.h - padY * 2),
    }
  }

  palaceAnchor(palace) {
    const padX = this.w * 0.02
    const padY = this.h * 0.02
    return {
      x: padX + palace.nx * (this.w - padX * 2),
      y: padY + palace.ny * (this.h - padY * 2),
    }
  }

  anchorForIndex(index) {
    const palace = this.model?.palaces.find((p) => p.index === index)
    return palace ? this.palaceAnchor(palace) : this.centerPoint()
  }

  clientToLocal(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  pickPalace(clientX, clientY) {
    const { x, y } = this.clientToLocal(clientX, clientY)
    const hit = pickStarfieldHit(this.layout.hits, x, y)
    if (!hit) return null
    if (hit.type === 'palace' || hit.palaceIndex != null) return hit.palaceIndex
    return null
  }

  pickHover(clientX, clientY) {
    const { x, y } = this.clientToLocal(clientX, clientY)
    return pickStarfieldHit(this.layout.hits, x, y)
  }

  palaceLit(index) {
    const plan = this.flowPlan
    const sfsz = new Set(plan?.sfszPalaceIndices || [])
    const hub = plan?.hubIndex

    if (this.stage >= 4) {
      if (index != null && sfsz.has(index)) {
        const pulse = 0.9 + Math.sin(this.time * 1.1 + index * 0.4) * 0.1
        return index === hub ? pulse * 1.05 : pulse
      }
      return 0.28
    }
    if (this.stage === 3) {
      const base = index != null && sfsz.has(index) ? 0.55 : 0.2
      return base + easeOutCubic(this.stageProgress) * (1 - base)
    }
    if (this.stage === 2) {
      if (index === hub) return 0.55 + this.stageProgress * 0.35
      if (index != null && sfsz.has(index)) {
        const link = plan.sfszLinks.find((l) => l.toIndex === index)
        if (!link) return 0.18
        const li = plan.sfszLinks.indexOf(link)
        const lp = Math.max(0, Math.min(1, (this.stageProgress * 1.15 - li * 0.28) / 0.55))
        return 0.12 + easeOutCubic(lp) * 0.82
      }
      return 0.1 + this.stageProgress * 0.06
    }
    if (this.stage === 1) {
      if (index === hub) return easeOutCubic(this.stageProgress) * 0.75
      return 0.04 + this.stageProgress * 0.1
    }
    return this.reveal * 0.85
  }

  centerLit() {
    if (this.stage >= 2) return 0.85 + Math.sin(this.time * 0.9) * 0.1
    if (this.stage === 1) return easeOutCubic(this.stageProgress)
    return this.reveal
  }

  isNodeHighlighted(node) {
    if (!node) return false
    const h = this.hoverHit
    if (h) {
      if (h.type === 'center' && node.hitType === 'center') return true
      if (h.type === 'palace' && node.hitType === 'palace' && node.palaceIndex === h.palaceIndex) return true
      if (h.palaceIndex != null && node.palaceIndex === h.palaceIndex) {
        if (h.type === 'star' && node.starName === h.starName && node.group === h.group) return true
        if (h.type === 'meta' && node.metaKey === h.metaKey) return true
        if (h.type === 'palace') return true
      }
    }
    if (this.relationIndices.includes(node.palaceIndex)) return true
    return this.activeIndex != null && node.palaceIndex === this.activeIndex
  }

  nodeAlpha(node) {
    const hi = this.isNodeHighlighted(node)
    let base = 1
    if (node.hitType === 'center') {
      base = this.centerLit()
      if (this.stage === 1) base = Math.max(base, 0.15)
    } else if (node.palaceIndex != null) {
      base = this.palaceLit(node.palaceIndex)
    } else {
      base = this.stage >= 3 ? 0.9 : 0.15
    }
    if (this.stage < 3 && node.hitType !== 'center' && node.palaceIndex != null) {
      if (!this.flowPlan?.sfszPalaceIndices.includes(node.palaceIndex) && this.stage < 2) {
        base *= 0.45
      }
    }
    return Math.min(1, base * this.reveal * (hi ? 1.08 : 0.92))
  }

  drawNebula(ctx) {
    const t = this.time
    const breathe = this.stage >= 4 ? 1 + Math.sin(t * 0.35) * 0.08 : 1
    for (const n of this.nebulae) {
      const cx = n.nx * this.w + Math.sin(t * 0.12 + n.nx * 8) * 10 * breathe
      const cy = n.ny * this.h + Math.cos(t * 0.1 + n.ny * 6) * 8 * breathe
      const rx = n.rx * this.w
      const ry = n.ry * this.h
      const [r, g, b] = n.hue
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry))
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${n.a * this.reveal * breathe})`)
      grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${n.a * 0.35 * this.reveal})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, t * 0.012, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawDust(ctx) {
    const t = this.time
    const flow = this.stage >= 4 ? 1.35 : 1
    for (const d of this.dust) {
      const layerSpeed = (1 + d.layer * 0.35) * flow
      d.drift += d.speed * 0.012 * layerSpeed
      d.x += Math.cos(d.drift + t * 0.08 * layerSpeed) * (0.08 + d.layer * 0.06)
      d.y += Math.sin(d.drift * 0.7 + t * 0.06 * layerSpeed) * (0.06 + d.layer * 0.04)
      if (d.x < 0) d.x = this.w
      if (d.x > this.w) d.x = 0
      if (d.y < 0) d.y = this.h
      if (d.y > this.h) d.y = 0
      const a = (0.06 + d.z * 0.28 + d.layer * 0.06) * this.reveal
      const rgb = d.layer === 2 ? '220, 255, 235' : d.layer === 1 ? '180, 255, 210' : '140, 200, 170'
      ctx.fillStyle = `rgba(${rgb}, ${a})`
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.size * (1 + d.layer * 0.25), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** 二次贝塞尔控制点 */
  curveForLine(x1, y1, x2, y2, waveAmp = 0) {
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    const scale = this.layoutScale()
    const wave = waveAmp * scale * Math.sin(this.time * 1.5 + len * 0.01)
    const bend = Math.min(len * 0.07, 20 * scale)
    return {
      cpx: mx + (-dy / len) * (bend + wave),
      cpy: my + (dx / len) * (bend + wave),
    }
  }

  sampleCurve(x1, y1, cpx, cpy, x2, y2, steps) {
    const len = Math.hypot(x2 - x1, y2 - y1)
    const count = steps ?? Math.max(24, Math.min(64, Math.round(len / 12)))
    const pts = []
    for (let i = 0; i <= count; i += 1) {
      const p = i / count
      const omt = 1 - p
      pts.push({
        p,
        x: omt * omt * x1 + 2 * omt * p * cpx + p * p * x2,
        y: omt * omt * y1 + 2 * omt * p * cpy + p * p * y2,
      })
    }
    return pts
  }

  pointOnCurve(pts, t) {
    const clamped = Math.max(0, Math.min(1, t))
    const idx = clamped * (pts.length - 1)
    const i = Math.floor(idx)
    const f = idx - i
    const a = pts[Math.min(i, pts.length - 1)]
    const b = pts[Math.min(i + 1, pts.length - 1)]
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, p: clamped }
  }

  /** 水流线条：光带 + 流动光珠，无虚线 */
  drawWaterStream(ctx, x1, y1, x2, y2, progress, opts = {}) {
    const {
      color = '180, 160, 255',
      width = 1.2,
      alpha = 0.55,
      flowing = false,
      runner = false,
      faintTrail = true,
      streamSpeed = 0.42,
      beadCount = 3,
    } = opts
    const waveAmp = (flowing || this.stage >= 4 ? 5 : 1.5) * this.layoutScale()
    const { cpx, cpy } = this.curveForLine(x1, y1, x2, y2, waveAmp)
    const t = easeInOutSine(Math.max(0, Math.min(1, progress)))
    if (t <= 0.001) return

    const scale = this.layoutScale()
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const sw = Math.max(0.55, width * scale)
    const pts = this.sampleCurve(x1, y1, cpx, cpy, x2, y2)
    const endIdx = Math.max(1, Math.floor(t * (pts.length - 1)))
    const visible = pts.slice(0, endIdx + 1)

    const strokePath = (subset, style, lineW) => {
      ctx.strokeStyle = style
      ctx.lineWidth = lineW
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(subset[0].x, subset[0].y)
      for (let i = 1; i < subset.length; i += 1) ctx.lineTo(subset[i].x, subset[i].y)
      ctx.stroke()
    }

    if (faintTrail) {
      strokePath(pts, `rgba(${color}, ${alpha * 0.07})`, sw * 2.1)
    }

    strokePath(visible, `rgba(${color}, ${alpha * 0.14})`, sw * 2.4)
    strokePath(visible, `rgba(${color}, ${alpha * 0.72})`, sw)
    strokePath(visible, `rgba(255, 255, 255, ${alpha * 0.18})`, Math.max(0.35, sw * 0.3))

    if (flowing && t > 0.08) {
      const beads = Math.max(1, Math.round((beadCount + (width > 1.15 ? 1 : 0)) * (0.55 + scale * 0.45)))
      for (let b = 0; b < beads; b += 1) {
        const phase = (this.time * streamSpeed + b / beads) % 1
        const bp = phase * t
        if (bp < 0.015 || bp > t - 0.008) continue
        const pt = this.pointOnCurve(pts, bp)
        const pulse = 0.5 + Math.sin(this.time * 5 + b * 1.9) * 0.5
        const r = sw * (1.1 + pulse * 0.5)
        const glowR = Math.min(r * 2.2, len * 0.12)
        const bead = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, glowR)
        bead.addColorStop(0, `rgba(255,255,255,${alpha * pulse})`)
        bead.addColorStop(0.3, `rgba(${color}, ${alpha * 0.55 * pulse})`)
        bead.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = bead
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, glowR, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (runner && t > 0.02 && t < 0.99) {
      const pt = this.pointOnCurve(pts, t)
      const glowR = Math.min(sw * 2.4, len * 0.14)
      const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, glowR)
      glow.addColorStop(0, `rgba(255,255,255,${alpha * 0.95})`)
      glow.addColorStop(0.4, `rgba(${color}, ${alpha * 0.5})`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  spawnFlowDrop(fromIndex, toIndex, color) {
    if (this.flowDrops.length > 40) return
    const scale = this.layoutScale()
    this.flowDrops.push({
      fromIndex,
      toIndex,
      t: Math.random(),
      speed: (0.005 + Math.random() * 0.01) * (0.75 + scale * 0.35),
      color,
      size: (0.9 + Math.random() * 1.2) * scale,
    })
  }

  updateFlowDrops() {
    for (const d of this.flowDrops) {
      d.t += d.speed
      if (d.t > 1) d.t -= 1
    }
    if (this.stage >= 2 && this.flowPlan && Math.random() < 0.1 * this.layoutScale()) {
      for (const link of this.flowPlan.sfszLinks) {
        const col = link.role === 'opposite' ? '251,191,36' : '180,160,255'
        this.spawnFlowDrop(link.fromIndex, link.toIndex, col)
      }
    }
  }

  drawFlowDrops(ctx) {
    if (this.stage < 2) return
    const scale = this.layoutScale()
    for (const d of this.flowDrops) {
      const from = this.anchorForIndex(d.fromIndex)
      const to = this.anchorForIndex(d.toIndex)
      const { cpx, cpy } = this.curveForLine(from.x, from.y, to.x, to.y, 3)
      const omt = 1 - d.t
      const x = omt * omt * from.x + 2 * omt * d.t * cpx + d.t * d.t * to.x
      const y = omt * omt * from.y + 2 * omt * d.t * cpy + d.t * d.t * to.y
      const fade = 0.4 + Math.sin(d.t * Math.PI) * 0.35
      const len = Math.hypot(to.x - from.x, to.y - from.y)
      const glowR = Math.min(d.size * 3.2 * scale, len * 0.1)
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR)
      glow.addColorStop(0, `rgba(255,255,255,${fade * 0.7})`)
      glow.addColorStop(0.45, `rgba(${d.color}, ${fade * 0.45})`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawFlowNetwork(ctx) {
    if (!this.model || !this.flowPlan || this.stage < 1) return

    const plan = this.flowPlan
    const hubPalace = this.model.palaces.find((p) => p.index === plan.hubIndex)
    const linkScale = this.stage >= 4 ? this.linkReveal : 1

    if (this.stage === 1 && hubPalace) {
      const hub = this.palaceAnchor(hubPalace)
      const ringR = 14 + easeOutCubic(this.stageProgress) * 26
      const pulse = 0.5 + Math.sin(this.time * 2.2) * 0.2
      for (let i = 0; i < 3; i += 1) {
        const r = ringR + i * 10
        ctx.strokeStyle = `rgba(251, 191, 36, ${(0.28 - i * 0.06) * pulse * easeOutCubic(this.stageProgress)})`
        ctx.lineWidth = 1.4 - i * 0.25
        ctx.beginPath()
        ctx.arc(hub.x, hub.y, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const drawSfszLinks = (baseProgress, { stagger = false, ringDelay = 0 } = {}) => {
      plan.sfszLinks.forEach((link, i) => {
        const from = this.anchorForIndex(link.fromIndex)
        const to = this.anchorForIndex(link.toIndex)
        let lp = baseProgress
        if (stagger) {
          lp = Math.max(0, Math.min(1, (baseProgress * 1.15 - i * 0.22) / 0.55))
        }
        lp *= linkScale
        if (lp <= 0.001) return
        const isOpp = link.role === 'opposite'
        const living = this.stage >= 4
        this.drawWaterStream(ctx, from.x, from.y, to.x, to.y, lp, {
          color: isOpp ? '251, 191, 36' : '180, 160, 255',
          width: isOpp ? 2 : 1.55,
          alpha: (0.48 + lp * 0.44) * (living ? 0.92 + Math.sin(this.time * 1.1 + i) * 0.08 : 1),
          runner: lp > 0.05 && lp < 0.98,
          flowing: living || lp > 0.45,
          beadCount: isOpp ? 4 : 3,
          streamSpeed: isOpp ? 0.48 : 0.38,
        })
      })

      ;(plan.sfszRingLinks || []).forEach((link, i) => {
        const from = this.anchorForIndex(link.fromIndex)
        const to = this.anchorForIndex(link.toIndex)
        let lp = baseProgress
        if (stagger || ringDelay > 0) {
          lp = Math.max(0, Math.min(1, (baseProgress * 1.05 - ringDelay - i * 0.18) / 0.5))
        }
        lp *= linkScale
        if (lp <= 0.001) return
        const living = this.stage >= 4
        this.drawWaterStream(ctx, from.x, from.y, to.x, to.y, lp, {
          color: '168, 120, 255',
          width: 1.05,
          alpha: (0.2 + lp * 0.32) * (living ? 0.9 + Math.sin(this.time * 0.85 + i) * 0.1 : 1),
          flowing: living || lp > 0.55,
          runner: lp > 0.08 && lp < 0.95,
          beadCount: 2,
          streamSpeed: 0.32,
          faintTrail: false,
        })
      })
    }

    if (this.stage === 2) {
      drawSfszLinks(this.stageProgress, { stagger: true, ringDelay: 0.32 })
    } else if (this.stage === 3) {
      drawSfszLinks(easeOutCubic(this.stageProgress), { ringDelay: 0.15 })
    } else if (this.stage >= 4) {
      drawSfszLinks(1)
    }
  }

  drawPalaceGlow(ctx, palace, group) {
    const lit = this.palaceLit(palace.index)
    if (lit < 0.08) return
    const { x, y } = this.palaceAnchor(palace)
    const isHub = this.flowPlan?.hubIndex === palace.index
    const speedMul = this.stage >= 4 ? 1.4 : 1
    for (const o of group.orbits) {
      o.angle += o.speed * speedMul
      const ox = x + Math.cos(o.angle) * o.radius
      const oy = y + Math.sin(o.angle) * o.radius * 0.85
      ctx.fillStyle = `rgba(180, 160, 255, ${0.14 * lit})`
      ctx.beginPath()
      ctx.arc(ox, oy, o.size, 0, Math.PI * 2)
      ctx.fill()
    }
    const coreR = (isHub ? 4 : 2.8) * (0.8 + lit * 0.35)
    const glow = ctx.createRadialGradient(x, y, 0, x, y, coreR * 4.5)
    glow.addColorStop(0, `rgba(255,255,255,${0.55 * lit})`)
    glow.addColorStop(0.4, `rgba(${isHub ? '251,191,36' : '160,139,255'}, ${(isHub ? 0.45 : 0.28) * lit})`)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, coreR * 4.5, 0, Math.PI * 2)
    ctx.fill()
  }

  drawCenterGlow(ctx) {
    if (!this.model || this.stage < 1) return
    const { x: cx, y: cy } = this.centerPoint()
    const lit = this.centerLit()
    const pulse = 0.65 + Math.sin(this.time * 1.3) * 0.28
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, (32 + pulse * 12) * (0.7 + lit * 0.5))
    hole.addColorStop(0, `rgba(0, 0, 0, ${0.88 * lit})`)
    hole.addColorStop(0.35, `rgba(251, 191, 36, ${0.28 * lit})`)
    hole.addColorStop(0.65, `rgba(160, 139, 255, ${0.12 * lit})`)
    hole.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(cx, cy, (32 + pulse * 12) * (0.85 + lit * 0.35), 0, Math.PI * 2)
    ctx.fill()

    if (this.stage === 1 && this.stageProgress > 0.2 && this.flowPlan?.hubName) {
      const hubPalace = this.model?.palaces.find((p) => p.index === this.flowPlan.hubIndex)
      if (hubPalace) {
        const hub = this.palaceAnchor(hubPalace)
        ctx.font = `800 ${13}px PingFang SC, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillStyle = `rgba(160, 139, 255, ${0.55 * easeOutCubic((this.stageProgress - 0.2) / 0.8)})`
        ctx.fillText('以身入局', hub.x, hub.y + 52)
        ctx.font = `650 ${11}px PingFang SC, system-ui, sans-serif`
        ctx.fillStyle = `rgba(251, 191, 36, ${0.45 * easeOutCubic((this.stageProgress - 0.2) / 0.8)})`
        ctx.fillText(this.flowPlan.hubName, hub.x, hub.y + 68)
      }
    }
  }

  drawNode(ctx, node) {
    const alpha = this.nodeAlpha(node)
    if (alpha < 0.03) return
    const hi = this.isNodeHighlighted(node)
    ctx.font = node.font
    ctx.textAlign = node.align
    ctx.fillStyle = node.fill
    ctx.globalAlpha = alpha
    if (node.shadow || hi) {
      ctx.shadowColor = node.shadow || 'rgba(160, 139, 255,0.45)'
      ctx.shadowBlur = hi ? 14 : 8
    }
    ctx.fillText(node.text, node.x, node.y)
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
  }

  tick = () => {
    if (!this.running) return
    const { ctx, w, h } = this
    if (w < 1 || h < 1) {
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    const dt = 0.016
    this.time += dt
    this.reveal += (this.revealTarget - this.reveal) * 0.035
    this.linkReveal += (this.linkRevealTarget - this.linkReveal) * 0.07
    this.updateStages(dt)
    this.updateFlowDrops()

    ctx.clearRect(0, 0, w, h)
    this.drawNebula(ctx)
    this.drawDust(ctx)

    if (this.model) {
      this.drawFlowNetwork(ctx)
      this.drawFlowDrops(ctx)
      this.drawCenterGlow(ctx)
      this.model.palaces.forEach((palace, i) => {
        const group = this.palaceParticles[i]
        if (group) this.drawPalaceGlow(ctx, palace, group)
      })
      for (const node of this.layout.nodes) {
        this.drawNode(ctx, node)
      }
    }

    this.raf = requestAnimationFrame(this.tick)
  }
}
