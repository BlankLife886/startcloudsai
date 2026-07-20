/**
 * 紫微 cinematic — 透视星轨 + 星云 + 碎裂 + 奇点隧道
 */
export class ZwParticleField {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.dpr = 1
    this.w = 0
    this.h = 0
    this.cx = 0
    this.cy = 0
    this.particles = []
    this.bursts = []
    this.shards = []
    this.nebulae = []
    this.warpSpeed = 0.018
    this.warpTarget = 0.018
    this.alpha = 1
    this.flash = 0
    this.chroma = 0
    this.suckIntensity = 0
    this.suckTarget = 0
    this.vortexActive = false
    this.vortexIntensity = 0
    this.vortexTarget = 0
    this.vortexParticles = []
    this.focalRatio = 0.46
    this.running = false
    this.raf = 0
    this._onResize = () => this.resize()
    this._filamentPhase = Array.from({ length: 12 }, () => Math.random() * Math.PI * 2)
  }

  mount(count = 1100) {
    this.resize()
    this.seed(count)
    this.seedNebulae()
    window.addEventListener('resize', this._onResize)
    this.running = true
    this.tick()
  }

  destroy() {
    this.running = false
    window.removeEventListener('resize', this._onResize)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  resize() {
    if (!this.canvas) return
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.cx = this.w / 2
    this.cy = this.h * this.focalRatio
    this.canvas.width = Math.floor(this.w * this.dpr)
    this.canvas.height = Math.floor(this.h * this.dpr)
    this.canvas.style.width = `${this.w}px`
    this.canvas.style.height = `${this.h}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.seedNebulae()
  }

  seed(count) {
    this.particles = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * this.w * 1.6,
      y: (Math.random() - 0.5) * this.h * 1.6,
      z: Math.random(),
      size: Math.random() * 2.2 + 0.25,
      tint: Math.random(),
      twinkle: Math.random() * Math.PI * 2,
    }))
  }

  seedNebulae() {
    const cy = this.cy || this.h * this.focalRatio
    this.nebulae = [
      { x: this.w * 0.28, y: cy - this.h * 0.12, r: Math.max(this.w, this.h) * 0.35, hue: 0, drift: Math.random() * Math.PI * 2 },
      { x: this.w * 0.72, y: cy + this.h * 0.1, r: Math.max(this.w, this.h) * 0.28, hue: 1, drift: Math.random() * Math.PI * 2 },
      { x: this.w * 0.5, y: cy + this.h * 0.22, r: Math.max(this.w, this.h) * 0.22, hue: 2, drift: Math.random() * Math.PI * 2 },
    ]
  }

  setSuckIntensity(t) {
    this.suckTarget = Math.max(0, Math.min(1, t))
  }

  setVortexActive(active) {
    this.vortexTarget = active ? 1 : 0
    if (active && this.vortexParticles.length < 320) {
      this.seedVortex(720)
    }
  }

  seedVortex(count) {
    this.vortexParticles = Array.from({ length: count }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.08 + Math.random() * 0.92,
      drift: 0.006 + Math.random() * 0.022,
      size: 0.45 + Math.random() * 2.4,
      tint: Math.random(),
      tw: Math.random() * Math.PI * 2,
    }))
  }

  vortexBurst(intensity = 1) {
    this.flash = Math.max(this.flash, 0.55 * intensity)
    const n = Math.floor(120 * intensity)
    for (let i = 0; i < n; i += 1) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.2
      const speed = 4 + Math.random() * 16 * intensity
      this.bursts.push({
        x: this.cx,
        y: this.cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: 1.8 + Math.random() * 3.5,
        tint: Math.random(),
      })
    }
    for (const vp of this.vortexParticles) {
      vp.radius = Math.min(1, vp.radius + 0.08 * intensity)
    }
  }

  setFocalRatio(ratio) {
    this.focalRatio = Math.max(0.32, Math.min(0.58, ratio))
    this.cy = this.h * this.focalRatio
    this.seedNebulae()
  }

  setWarpIntensity(t) {
    this.warpTarget = 0.015 + Math.max(0, Math.min(1, t)) * 4.8
  }

  setFade(alpha) {
    this.alpha = Math.max(0, Math.min(1, alpha))
  }

  setChroma(amount) {
    this.chroma = Math.max(0, Math.min(1, amount))
  }

  burst(intensity = 1) {
    this.flash = Math.max(this.flash, 0.4 * intensity)
    const n = Math.floor(56 + intensity * 100)
    for (let i = 0; i < n; i += 1) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.25
      const speed = 2.5 + Math.random() * 9 * intensity
      this.bursts.push({
        x: this.cx,
        y: this.cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: 1.4 + Math.random() * 3,
        tint: Math.random(),
      })
    }
  }

  /** 文字/罗盘区域碎裂成粒子 */
  shatter(intensity = 1) {
    this.flash = Math.max(this.flash, 0.5 * intensity)
    const n = Math.floor(90 * intensity)
    for (let i = 0; i < n; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 90
      const speed = 3 + Math.random() * 12 * intensity
      this.shards.push({
        x: this.cx + Math.cos(angle) * dist * 0.4,
        y: this.cy + Math.sin(angle) * dist * 0.35,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: 1 + Math.random() * 2.5,
        spin: (Math.random() - 0.5) * 0.3,
        rot: Math.random() * Math.PI,
        tint: Math.random(),
        suck: 0,
      })
    }
  }

  drawNebulae(time) {
    const { ctx, w, h, nebulae } = this
    const warp = this.warpSpeed

    for (const n of nebulae) {
      n.drift += 0.002
      const ox = Math.cos(n.drift + time * 0.08) * 30
      const oy = Math.sin(n.drift * 1.3 + time * 0.06) * 24
      const pulse = 0.85 + Math.sin(time * 0.5 + n.drift) * 0.15
      const r = n.r * pulse * (1 + warp * 0.15)

      const colors =
        n.hue === 0
          ? ['rgba(160, 139, 255, 0)', 'rgba(160, 139, 255, 0.07)', 'rgba(160, 139, 255, 0)']
          : n.hue === 1
            ? ['rgba(139, 116, 240, 0)', 'rgba(139, 116, 240, 0.06)', 'rgba(139, 116, 240, 0)']
            : ['rgba(168, 120, 255, 0)', 'rgba(168, 120, 255, 0.05)', 'rgba(168, 120, 255, 0)']

      const grad = ctx.createRadialGradient(n.x + ox, n.y + oy, 0, n.x + ox, n.y + oy, r)
      grad.addColorStop(0, colors[1])
      grad.addColorStop(0.45, colors[1])
      grad.addColorStop(1, colors[2])
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }
  }

  drawConstellation(ctx, cx, cy, particles, warp, time) {
    if (warp > 0.42) return
    const fade = 1 - warp / 0.42
    const sample = []
    const step = Math.max(3, Math.floor(particles.length / 55))
    for (let i = 0; i < particles.length; i += step) {
      const p = particles[i]
      if (p.z > 0.72) continue
      const scale = 1 / p.z
      sample.push({ x: cx + p.x * scale, y: cy + p.y * scale, z: p.z })
    }
    const maxDist = 88
    ctx.lineWidth = 0.6
    for (let i = 0; i < sample.length; i += 1) {
      for (let j = i + 1; j < sample.length; j += 1) {
        const a = sample[i]
        const b = sample[j]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d > maxDist) continue
        const alpha = (1 - d / maxDist) * fade * 0.22 * (1 - (a.z + b.z) * 0.5)
        ctx.strokeStyle = `rgba(180, 160, 255, ${alpha})`
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
    for (const s of sample) {
      const pulse = 0.5 + Math.sin(time * 2.2 + s.x * 0.01) * 0.5
      ctx.fillStyle = `rgba(220, 210, 255, ${fade * 0.35 * pulse})`
      ctx.beginPath()
      ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawHelix(ctx, cx, cy, warp, time, w, h) {
    if (warp < 0.28) return
    const t = Math.min(1, (warp - 0.28) / 0.72)
    const arms = 2
    const points = 56
    const maxR = Math.min(w, h) * 0.48 * t
    for (let arm = 0; arm < arms; arm += 1) {
      for (let i = 0; i < points; i += 1) {
        const prog = i / points
        const ang = prog * Math.PI * 5 + time * (1.4 + warp * 0.8) + arm * Math.PI
        const rad = 24 + prog * maxR
        const x = cx + Math.cos(ang) * rad
        const y = cy + Math.sin(ang) * rad
        const alpha = (1 - prog) * 0.55 * t
        const hue = arm === 0 ? '160, 139, 255' : '139, 116, 240'
        ctx.fillStyle = `rgba(${hue}, ${alpha})`
        ctx.beginPath()
        ctx.arc(x, y, 1 + t * 1.8, 0, Math.PI * 2)
        ctx.fill()
        if (i > 0 && i % 3 === 0) {
          const prevAng = ((i - 1) / points) * Math.PI * 5 + time * (1.4 + warp * 0.8) + arm * Math.PI
          const prevRad = 24 + ((i - 1) / points) * maxR
          ctx.strokeStyle = `rgba(${hue}, ${alpha * 0.45})`
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(prevAng) * prevRad, cy + Math.sin(prevAng) * prevRad)
          ctx.lineTo(x, y)
          ctx.stroke()
        }
      }
    }
  }

  drawFilaments(ctx, cx, cy, warp, time, w, h) {
    if (warp < 0.48) return
    const t = Math.min(1, (warp - 0.48) / 0.52)
    const count = 12
    const outer = Math.max(w, h) * 0.58
    for (let i = 0; i < count; i += 1) {
      this._filamentPhase[i] += 0.004 + warp * 0.006
      const base = (i / count) * Math.PI * 2 + time * 0.15
      const wobble = Math.sin(this._filamentPhase[i]) * 0.35
      const angle = base + wobble
      const x0 = cx + Math.cos(angle) * outer
      const y0 = cy + Math.sin(angle) * outer
      const cpx = cx + Math.cos(angle + 0.9) * outer * 0.35
      const cpy = cy + Math.sin(angle - 0.6) * outer * 0.28
      const grad = ctx.createLinearGradient(x0, y0, cx, cy)
      grad.addColorStop(0, 'rgba(139, 116, 240, 0)')
      grad.addColorStop(0.55, `rgba(160, 139, 255, ${0.14 * t})`)
      grad.addColorStop(1, `rgba(255, 255, 255, ${0.35 * t})`)
      ctx.strokeStyle = grad
      ctx.lineWidth = 0.8 + t * 1.2
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.quadraticCurveTo(cpx, cpy, cx, cy)
      ctx.stroke()
    }
  }

  drawVortexParticles(ctx, cx, cy, time) {
    const mix = Math.max(this.vortexIntensity, this.suckIntensity * 0.95, this.warpSpeed * 0.35)
    if (mix < 0.02 && !this.vortexActive) return

    const maxR = Math.min(this.w, this.h) * 0.52
    const count = this.vortexParticles.length
    if (!count) return

    for (const vp of this.vortexParticles) {
      const spin = vp.drift * (1 + mix * 4.2)
      vp.angle += spin
      vp.radius -= 0.0012 * (0.35 + mix * 2.4)
      if (vp.radius < 0.015) {
        vp.radius = 0.82 + Math.random() * 0.18
        vp.angle += Math.PI * (0.4 + Math.random() * 0.5)
      }

      const r = vp.radius * maxR
      const wobble = Math.sin(time * 2.4 + vp.tw) * 2 * mix
      const x = cx + Math.cos(vp.angle) * (r + wobble)
      const y = cy + Math.sin(vp.angle) * (r + wobble * 0.65)
      const edge = 1 - vp.radius
      const alpha = Math.min(1, edge * mix * (0.3 + Math.sin(time * 3 + vp.tw) * 0.12 + 0.32))
      if (alpha < 0.02) continue

      const pr = vp.size * (0.65 + edge * 1.5) * (0.6 + mix * 0.45)
      const g = vp.tint > 0.72 ? 255 : vp.tint > 0.42 ? 214 : 151
      const b = vp.tint > 0.72 ? 180 : vp.tint > 0.42 ? 196 : 124

      if (pr < 2.2) {
        ctx.fillStyle = `rgba(${g}, ${b}, 150, ${alpha * 0.82})`
        ctx.beginPath()
        ctx.arc(x, y, pr, 0, Math.PI * 2)
        ctx.fill()
        continue
      }

      const glow = ctx.createRadialGradient(x, y, 0, x, y, pr * 2.4)
      glow.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.85})`)
      glow.addColorStop(0.45, `rgba(${g}, ${b}, 150, ${alpha * 0.4})`)
      glow.addColorStop(1, `rgba(${g}, ${b}, 150, 0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, pr * 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawSingularity(warp) {
    const { ctx, cx, cy } = this
    const time = performance.now() * 0.001
    const t = Math.min(1, Math.max(warp, this.suckIntensity, this.vortexIntensity) / 1.2)
    if (t < 0.04) return

    const coreR = 10 + t * 28
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 4.5)
    hole.addColorStop(0, 'rgba(0, 0, 0, 1)')
    hole.addColorStop(0.22, `rgba(0, 0, 0, ${0.94 * t})`)
    hole.addColorStop(0.42, `rgba(251, 191, 36, ${0.42 * t})`)
    hole.addColorStop(0.58, `rgba(160, 139, 255, ${0.22 * t})`)
    hole.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(cx, cy, coreR * 4.5, 0, Math.PI * 2)
    ctx.fill()

    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2 + time * (0.8 + t)
      const dist = coreR * (1.8 + (i % 3) * 0.35)
      const px = cx + Math.cos(a) * dist
      const py = cy + Math.sin(a) * dist * 0.82
      const pulse = 0.45 + Math.sin(time * 4 + i) * 0.55
      ctx.fillStyle = `rgba(220, 210, 255, ${t * pulse * 0.35})`
      ctx.beginPath()
      ctx.arc(px, py, 0.8 + t * 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  tick = () => {
    if (!this.running) return
    const { ctx, w, h, cx, cy, particles, bursts, shards } = this
    const trail = this.warpSpeed > 0.26
    const time = performance.now() * 0.001

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(2, 4, 3, ${0.28 + Math.min(this.warpSpeed * 0.12, 0.5)})`
    ctx.fillRect(0, 0, w, h)

    this.drawNebulae(time)

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(200, 255, 180, ${this.flash * 0.6})`
      ctx.fillRect(0, 0, w, h)
      this.flash *= 0.86
    }

    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = this.alpha

    this.drawConstellation(ctx, cx, cy, particles, this.warpSpeed, time)

    const dt = 0.016 * (0.5 + this.warpSpeed * 2.6)

    this.suckIntensity += (this.suckTarget - this.suckIntensity) * 0.06
    this.vortexIntensity += (this.vortexTarget - this.vortexIntensity) * 0.05
    const suck = this.suckIntensity

    for (const p of particles) {
      const prevZ = p.z
      p.z -= dt * (1 + suck * 0.85)

      if (suck > 0.04) {
        const pull = suck * dt * (2.2 + (1 - p.z) * 3.5)
        const twist = suck * 0.022 * (1.1 - p.z)
        const nx = p.x * Math.cos(twist) - p.y * Math.sin(twist)
        const ny = p.x * Math.sin(twist) + p.y * Math.cos(twist)
        p.x = nx * (1 - pull)
        p.y = ny * (1 - pull)
      }

      if (p.z <= 0.012) {
        p.z = 1
        p.x = (Math.random() - 0.5) * w * 1.6
        p.y = (Math.random() - 0.5) * h * 1.6
      }

      const scale = 1 / p.z
      const sx = cx + p.x * scale
      const sy = cy + p.y * scale
      const tw = 0.6 + Math.sin(time * 3.5 + p.twinkle) * 0.4
      const r = p.size * scale * tw * (0.5 + this.warpSpeed * 0.55)

      if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue

      const glow = 0.18 + (1 - p.z) * 0.82
      const pr = p.tint > 0.82 ? 196 : p.tint > 0.45 ? 160 : 130
      const pg = p.tint > 0.82 ? 170 : p.tint > 0.45 ? 139 : 100
      const pb = p.tint > 0.82 ? 255 : p.tint > 0.45 ? 255 : 230

      if (trail && prevZ < 1) {
        const px = cx + p.x / prevZ
        const py = cy + p.y / prevZ
        const len = Math.hypot(sx - px, sy - py)
        const grad = ctx.createLinearGradient(px, py, sx, sy)
        grad.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0)`)
        grad.addColorStop(0.5, `rgba(${pr}, ${pg}, ${pb}, ${glow * 0.45})`)
        grad.addColorStop(1, `rgba(255, 255, 255, ${Math.min(1, glow * 1.1)})`)
        ctx.strokeStyle = grad
        ctx.lineWidth = Math.max(0.4, Math.min(3.5, r * 1.2 + len * 0.008))
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(sx, sy)
        ctx.stroke()
      } else {
        ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${glow})`
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const suckWarp = Math.min(1, this.warpSpeed / 1.8)
    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const s = shards[i]
      s.suck = Math.min(1, s.suck + 0.028 * (0.6 + suckWarp * 2.8 + suck * 1.5))
      const toCx = cx - s.x
      const toCy = cy - s.y
      const dist = Math.hypot(toCx, toCy) || 1
      const spiral = s.suck * 0.06
      s.vx += toCx * 0.0045 * s.suck + (-toCy / dist) * spiral
      s.vy += toCy * 0.0045 * s.suck + (toCx / dist) * spiral
      s.x += s.vx
      s.y += s.vy
      s.vx *= 0.97 - s.suck * 0.04
      s.vy *= 0.97 - s.suck * 0.04
      s.rot += s.spin
      s.life -= 0.008 + s.suck * 0.012
      if (s.life <= 0) {
        shards.splice(i, 1)
        continue
      }
      const g = s.tint > 0.55 ? 255 : 151
      const b = s.tint > 0.55 ? 220 : 124
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(s.rot)
      ctx.fillStyle = `rgba(${g}, ${b}, 150, ${s.life * 0.85})`
      ctx.fillRect(-s.size, -s.size * 0.35, s.size * 2, s.size * 0.7)
      ctx.restore()
    }

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const b = bursts[i]
      b.x += b.vx
      b.y += b.vy
      b.vx *= 0.95
      b.vy *= 0.95
      b.life -= 0.016
      if (b.life <= 0) {
        bursts.splice(i, 1)
        continue
      }
      ctx.fillStyle = `rgba(255, ${b.tint > 0.5 ? 240 : 200}, 140, ${b.life * 0.95})`
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.size * b.life, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    this.drawVortexParticles(ctx, cx, cy, time)
    this.drawHelix(ctx, cx, cy, this.warpSpeed, time, w, h)
    this.drawFilaments(ctx, cx, cy, this.warpSpeed, time, w, h)
    this.drawSingularity(this.warpSpeed)

    if (this.chroma > 0.02) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.globalAlpha = this.chroma * 0.22
      ctx.fillStyle = 'rgba(139, 116, 240, 0.35)'
      ctx.fillRect(3, 0, w, h)
      ctx.fillStyle = 'rgba(160, 139, 255, 0.28)'
      ctx.fillRect(-3, 0, w, h)
      ctx.restore()
    }

    this.warpSpeed += (this.warpTarget - this.warpSpeed) * 0.075
    this.chroma *= 0.92
    this.raf = requestAnimationFrame(this.tick)
  }
}
