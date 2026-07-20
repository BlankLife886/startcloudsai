/**
 * 标题粒子重组 —— 把字符光栅化采样成粒子云，
 * 粒子从四周破碎散布状态沿弧线汇聚成字形。
 *
 * 渲染由外部时间轴驱动（render(t) 接收 0~1 进度），
 * 因此可以被 GSAP 快进 / 跳过而不会留下中间态。
 */

const TAU = Math.PI * 2

/** 按全局横向位置在标题渐变（白 → 淡紫 → 天蓝）上取色 */
function gradientColor(fraction) {
  const stops = [
    [255, 255, 255],
    [205, 194, 255],
    [125, 215, 255],
  ]
  const pos = Math.min(Math.max(fraction, 0), 1) * (stops.length - 1)
  const i = Math.min(Math.floor(pos), stops.length - 2)
  const mix = pos - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * mix),
    Math.round(a[1] + (b[1] - a[1]) * mix),
    Math.round(a[2] + (b[2] - a[2]) * mix),
  ]
}

/**
 * @param {HTMLElement} host 画布挂载与坐标参考容器（需 position: relative）
 * @param {HTMLElement[]} chars 已拆分的字符 span（布局稳定即可，允许 visibility: hidden）
 * @returns {{ canvas, render, destroy } | null}
 */
export function createTitleParticles(host, chars) {
  if (!host || !chars?.length || typeof document === 'undefined') return null
  const hostRect = host.getBoundingClientRect()
  if (hostRect.width < 40 || hostRect.height < 40) return null

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const width = Math.round(hostRect.width)
  const height = Math.round(hostRect.height)

  const canvas = document.createElement('canvas')
  canvas.className = 'home-title-particles'
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.setAttribute('aria-hidden', 'true')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 离屏光栅化字符，采样出字形上的目标点
  const off = document.createElement('canvas')
  off.width = canvas.width
  off.height = canvas.height
  const offCtx = off.getContext('2d', { willReadFrequently: true })
  if (!offCtx) return null
  offCtx.scale(dpr, dpr)
  offCtx.fillStyle = '#fff'
  offCtx.textBaseline = 'top'

  const charBoxes = chars.map((char) => {
    const rect = char.getBoundingClientRect()
    const style = getComputedStyle(char)
    const fontSize = parseFloat(style.fontSize) || 48
    const x = rect.left - hostRect.left
    // em 框在行盒内大致垂直居中
    const y = rect.top - hostRect.top + Math.max(0, (rect.height - fontSize) / 2)
    offCtx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
    offCtx.fillText(char.textContent, x, y)
    return { x, y, w: rect.width, h: rect.height }
  })

  const titleLeft = Math.min(...charBoxes.map((box) => box.x))
  const titleRight = Math.max(...charBoxes.map((box) => box.x + box.w))
  const titleSpan = Math.max(titleRight - titleLeft, 1)

  // 采样步长按屏幕大小自适应，控制粒子总量在 ~1200-2400
  const step = Math.max(2, Math.round(Math.sqrt((width * height) / 260000) * 3)) * dpr
  const data = offCtx.getImageData(0, 0, off.width, off.height).data
  const particles = []
  const charCount = chars.length

  charBoxes.forEach((box, charIndex) => {
    const x0 = Math.max(0, Math.floor(box.x * dpr))
    const x1 = Math.min(off.width, Math.ceil((box.x + box.w) * dpr))
    const y0 = Math.max(0, Math.floor(box.y * dpr))
    const y1 = Math.min(off.height, Math.ceil((box.y + box.h) * dpr))
    for (let py = y0; py < y1; py += step) {
      for (let px = x0; px < x1; px += step) {
        if (data[(py * off.width + px) * 4 + 3] < 140) continue
        const tx = px + (Math.random() - 0.5) * step
        const ty = py + (Math.random() - 0.5) * step
        // 破碎起点：绕目标随机方向抛出 140~560px（CSS 像素）
        const angle = Math.random() * TAU
        const radius = (140 + Math.random() * 420) * dpr
        const sx = tx + Math.cos(angle) * radius
        const sy = ty + Math.sin(angle) * radius
        // 弧线控制点：中点垂直偏移，汇聚时带旋涡感
        const midX = (sx + tx) / 2 - Math.sin(angle) * radius * (Math.random() * 0.5 - 0.25)
        const midY = (sy + ty) / 2 + Math.cos(angle) * radius * (Math.random() * 0.5 - 0.25)
        const [r, g, b] = gradientColor((tx / dpr - titleLeft) / titleSpan)
        particles.push({
          sx,
          sy,
          midX,
          midY,
          tx,
          ty,
          r,
          g,
          b,
          size: (0.9 + Math.random() * 1.5) * dpr,
          phase: Math.random() * TAU,
          // 左到右按字符错峰汇聚
          delay: (charIndex / charCount) * 0.4 + Math.random() * 0.06,
          dur: 0.46 + Math.random() * 0.08,
        })
      }
    }
  })
  if (!particles.length) return null

  function render(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const raw = (t - p.delay) / p.dur
      if (raw <= 0) continue
      // in-out 缓动：先在外围悬浮可见，中段整体扫入，末段减速落位
      const prog =
        raw >= 1 ? 1 : raw < 0.5 ? 4 * raw * raw * raw : 1 - (-2 * raw + 2) ** 3 / 2
      const inv = 1 - prog
      // 二次贝塞尔：破碎点 → 旋涡控制点 → 字形目标点
      const wobble = Math.sin(p.phase + raw * 7) * inv * 5 * dpr
      const x = inv * inv * p.sx + 2 * inv * prog * p.midX + prog * prog * p.tx + wobble
      const y =
        inv * inv * p.sy + 2 * inv * prog * p.midY + prog * prog * p.ty + wobble * 0.6
      const alpha = raw >= 1 ? 1 : Math.min(1, raw * 4) * (0.4 + prog * 0.6)
      ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha})`
      const size = p.size * (1 + inv * 1.4)
      ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
  }

  function destroy() {
    canvas.remove()
  }

  return { canvas, render, destroy }
}
