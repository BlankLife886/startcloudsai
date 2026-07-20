import { gsap } from 'gsap'

const FOCAL_Y_RATIO = 0.46
export const ZW_CINE_SUCK_DURATION = 1.75
import { ZwParticleField } from './ziweiParticleField'
import { ZW_CINE_PALACES } from './ziweiCinematicData'
import {
  BRANCH_TO_CELL,
  buildPaipanMicroSteps,
  schedulePaipanSteps,
  sortPalacesByName,
  summarizeCellStars,
} from './ziweiPaipanDriver'

export function canPlayZwCinematic() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (document.documentElement.classList.contains('settings-no-animations')) return false
  return true
}

/**
 * @param {HTMLElement} root `.zw-cine` overlay root
 */
export function createZwCinematicController(root) {
  if (!root) return null

  const canvas = root.querySelector('.zw-cine__canvas')
  const introEl = root.querySelector('.zw-cine__intro')
  const focalHubEl = root.querySelector('.zw-cine__focal-hub')
  const introCoreEl = root.querySelector('.zw-cine__intro-core')
  const intakeEl = root.querySelector('.zw-cine__intake')
  const ringEl = root.querySelector('.zw-cine__ring')
  const ringGlowEl = root.querySelector('.zw-cine__ring-glow')
  const ringImg = root.querySelector('.zw-cine__ring img')
  const titleEl = root.querySelector('.zw-cine__title')
  const subtitleEl = root.querySelector('.zw-cine__subtitle')
  const hintEl = root.querySelector('.zw-cine__hint')
  const flashEl = root.querySelector('.zw-cine__flash')
  const chromaticEl = root.querySelector('.zw-cine__chromatic')
  const vignetteEl = root.querySelector('.zw-cine__vignette')
  const speedlinesEl = root.querySelector('.zw-cine__speedlines')
  const speedlineEls = [...root.querySelectorAll('.zw-cine__speedline')]
  const nebulaEls = [...root.querySelectorAll('.zw-cine__nebula')]
  const tunnelRingEls = [...root.querySelectorAll('.zw-cine__tunnel-ring')]
  const fieldEls = [...root.querySelectorAll('.zw-cine__field')]
  const submitEl = root.querySelector('.zw-cine__submit')
  const intakeInnerEl = root.querySelector('.zw-cine__intake-inner')
  const intakeBloomEl = root.querySelector('.zw-cine__intake-bloom')
  const skipEl = root.querySelector('.zw-cine__skip')
  const auroraEl = root.querySelector('.zw-cine__aurora')
  const orbitEl = root.querySelector('.zw-cine__orbit')
  const orbitTrackEl = root.querySelector('.zw-cine__orbit-track')
  const orbitNodeEls = [...root.querySelectorAll('.zw-cine__orbit-node')]
  const glyphEls = [...root.querySelectorAll('.zw-cine__glyph')]
  const shockwaveEls = [...root.querySelectorAll('.zw-cine__shockwave')]
  const flareEl = root.querySelector('.zw-cine__flare')
  const grainEl = root.querySelector('.zw-cine__grain')
  const titleGhostEls = [...root.querySelectorAll('.zw-cine__title-ghost')]
  const titleMainEl = root.querySelector('.zw-cine__title-main')
  const chartSkelEl = root.querySelector('.zw-cine__chart-skel')
  const chartCellEls = [...root.querySelectorAll('.zw-cine__chart-cell')]
  const chartCenterEl = root.querySelector('.zw-cine__chart-center')
  const sfszLineEls = [...root.querySelectorAll('.zw-cine__chart-sfsz-line')]
  const paipanEl = root.querySelector('.zw-cine__paipan')
  const paipanStepEl = root.querySelector('.zw-cine__paipan-step')
  const paipanSubEl = root.querySelector('.zw-cine__paipan-sub')
  const paipanSihuaEls = [...root.querySelectorAll('.zw-cine__paipan-sihua-item')]
  const centerFieldEls = [...root.querySelectorAll('.zw-cine__center-field')]
  const starstreamEls = [...root.querySelectorAll('.zw-cine__starstream-item')]
  const starstreamEl = root.querySelector('.zw-cine__starstream')

  const particles = canvas ? new ZwParticleField(canvas) : null
  if (particles) {
    particles.setFocalRatio(FOCAL_Y_RATIO)
    particles.mount(1100)
  }

  const warp = { value: 0.02 }

  let introTl = null
  let idleTl = null
  let waitTimer = null
  let introActive = false
  let waitResolve = null
  let paipanTl = null
  let paipanTimers = []

  function tweenWarp(to, duration, ease = 'power2.out') {
    return gsap.to(warp, {
      value: to,
      duration,
      ease,
      onUpdate: () => particles?.setWarpIntensity(warp.value),
    })
  }

  function killAll() {
    introTl?.kill()
    idleTl?.kill()
    paipanTl?.kill()
    paipanTl = null
    stopAmbientLoops()
    if (waitTimer) {
      waitTimer.kill()
      waitTimer = null
    }
    if (waitResolve) {
      waitResolve()
      waitResolve = null
    }
  }

  function setPhaseVisible(phase) {
    if (focalHubEl) focalHubEl.hidden = phase !== 'intro'
    if (introEl) introEl.hidden = phase !== 'intro'
    if (intakeEl) intakeEl.hidden = phase !== 'intake'
  }

  function getFocalPoint() {
    return {
      x: window.innerWidth / 2,
      y: window.innerHeight * FOCAL_Y_RATIO,
    }
  }

  function suckElementsToSingularity(els, duration = ZW_CINE_SUCK_DURATION * 0.92, stagger = 0.018) {
    const focal = getFocalPoint()
    const targets = els.filter(Boolean)
    targets.forEach((el, i) => {
      const rect = el.getBoundingClientRect()
      const dx = focal.x - (rect.left + rect.width / 2)
      const dy = focal.y - (rect.top + rect.height / 2)
      gsap.killTweensOf(el)
      gsap.to(el, {
        x: `+=${dx}`,
        y: `+=${dy}`,
        scale: 0,
        opacity: 0,
        rotation: `+=${180 + Math.random() * 360}`,
        filter: 'blur(10px) brightness(1.8)',
        duration: duration + Math.random() * 0.12,
        delay: stagger > 0 ? i * stagger : 0,
        ease: 'power4.in',
        overwrite: true,
      })
    })
  }

  function getChartCellEl(cellId) {
    if (!cellId) return null
    return root.querySelector(`[data-cell="${cellId}"]`)
  }

  function getPalaceByCellId(chart, cellId) {
    if (!chart?.palaces || !cellId) return null
    const branch = Object.entries(BRANCH_TO_CELL).find(([, id]) => id === cellId)?.[0]
    return chart.palaces.find((palace) => palace.earthlyBranch === branch) || null
  }

  function setCellContent(cellEl, { palaceName, major, minor, decadal, badge }) {
    if (!cellEl) return
    const palaceLabel = cellEl.querySelector('[data-palace-label]')
    const majorLabel = cellEl.querySelector('[data-major-label]')
    const minorLabel = cellEl.querySelector('[data-minor-label]')
    const decadalLabel = cellEl.querySelector('[data-decadal-label]')
    const badgeEl = cellEl.querySelector('[data-palace-badge]')
    if (palaceName !== undefined && palaceLabel) palaceLabel.textContent = palaceName
    if (major !== undefined && majorLabel) majorLabel.textContent = major
    if (minor !== undefined && minorLabel) minorLabel.textContent = minor
    if (decadal !== undefined && decadalLabel) decadalLabel.textContent = decadal
    if (badge !== undefined && badgeEl) badgeEl.textContent = badge
  }

  function pulseCell(cellEl, color = '160,139,255') {
    if (!cellEl) return
    const glowTargets = [
      cellEl.querySelector('.zw-cine__chart-branch'),
      cellEl.querySelector('.zw-cine__chart-palace'),
      cellEl.querySelector('.zw-cine__chart-star'),
    ].filter(Boolean)
    gsap.fromTo(
      glowTargets,
      { filter: `drop-shadow(0 0 0 rgba(${color},0))` },
      {
        filter: `drop-shadow(0 0 16px rgba(${color},0.72))`,
        duration: 0.34,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
      },
    )
  }

  function updatePaipanProgress(step) {
    if (paipanStepEl) paipanStepEl.textContent = step.text
    if (paipanSubEl) paipanSubEl.textContent = step.sub || ''
    gsap.fromTo(
      [paipanStepEl, paipanSubEl].filter(Boolean),
      { opacity: 0.35, y: 6, filter: 'blur(4px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.22, ease: 'power2.out' },
    )
  }

  function resetPaipanVisuals() {
    paipanSihuaEls.forEach((el) => el.classList.remove('is-lit'))
  }

  function resetCenterFields() {
    centerFieldEls.forEach((field) => {
      field.classList.remove('is-lit')
      const valueEl = field.querySelector('[data-center-value]')
      if (valueEl) valueEl.textContent = '—'
    })
  }

  function initChartPalaceLabels(chart = null) {
    if (chart?.palaces) {
      chart.palaces.forEach((palace) => {
        const cellEl = getChartCellEl(BRANCH_TO_CELL[palace.earthlyBranch])
        setCellContent(cellEl, { palaceName: palace.name })
      })
      return
    }
    chartCellEls.forEach((cell, i) => {
      setCellContent(cell, { palaceName: ZW_CINE_PALACES[i] || '' })
    })
  }

  function igniteChartCell(cellId, options = {}) {
    const cell = typeof cellId === 'number' ? chartCellEls[cellId] : getChartCellEl(cellId)
    if (!cell) return
    const { starName, palaceName, badge, major, minor, decadal, isMing, isBody } = options

    cell.classList.add('is-lit')
    if (isMing || cell.classList.contains('is-ming')) cell.classList.add('is-ming')
    if (isBody) cell.classList.add('is-body')

    setCellContent(cell, {
      palaceName,
      major,
      minor,
      decadal,
      badge,
    })

    const starEl = cell.querySelector('.zw-cine__chart-star')
    if (starEl && starName) starEl.textContent = starName

    pulseCell(cell, isMing ? '251,191,36' : '160,139,255')
  }

  function resetChartCells() {
    chartCellEls.forEach((cell) => {
      cell.classList.remove('is-lit', 'is-ming', 'is-body', 'is-sihua')
      setCellContent(cell, { palaceName: '', major: '', minor: '', decadal: '', badge: '' })
      const star = cell.querySelector('.zw-cine__chart-star')
      if (star) star.textContent = ''
      gsap.set(cell, { clearProps: 'boxShadow,filter' })
    })
  }

  function executeMicroStep(step, chart) {
    updatePaipanProgress(step)

    if (step.phase === 'palace') {
      const badges = [step.isBody ? '身' : '', step.isOriginal ? '因' : ''].filter(Boolean).join('')
      igniteChartCell(step.cellId, {
        palaceName: step.palaceName,
        branch: step.branch,
        badge: badges,
        isMing: step.isMing,
        isBody: step.isBody,
      })
      if (step.isMing) particles?.burst(0.35)
      return
    }

    if (step.phase === 'major') {
      const cellEl = getChartCellEl(step.cellId)
      const palace = getPalaceByCellId(chart, step.cellId)
      const majorText = palace
        ? (palace.majorStars || []).map((s) => s.name).join(' ')
        : step.starName
      igniteChartCell(step.cellId, {
        palaceName: step.palaceName || palace?.name,
        major: majorText,
        starName: step.starName,
      })
      return
    }

    if (step.phase === 'minor-batch') {
      particles?.setChroma(0.25)
      return
    }

    if (step.phase === 'minor') {
      const cellEl = getChartCellEl(step.cellId)
      const palace = getPalaceByCellId(chart, step.cellId)
      const { minor } = summarizeCellStars(palace)
      igniteChartCell(step.cellId, {
        palaceName: step.palaceName || palace?.name,
        minor: minor || step.starName,
        starName: step.starName,
      })
      return
    }

    if (step.phase === 'sihua') {
      const sihuaEl = paipanSihuaEls.find((el) => el.dataset.sihua === step.mutagen)
      if (sihuaEl) {
        sihuaEl.classList.add('is-lit')
        gsap.fromTo(sihuaEl, { scale: 0.7 }, { scale: 1.12, duration: 0.28, yoyo: true, repeat: 1, ease: 'power2.out' })
      }
      const cellEl = getChartCellEl(step.cellId)
      if (cellEl) cellEl.classList.add('is-sihua')
      igniteChartCell(step.cellId, { starName: step.mutagen, palaceName: step.palaceName })
      particles?.burst(0.22)
      return
    }

    if (step.phase === 'center') {
      const fieldEl = centerFieldEls.find((el) => el.dataset.centerField === step.field)
      if (fieldEl) {
        fieldEl.classList.add('is-lit')
        const valueEl = fieldEl.querySelector('[data-center-value]')
        if (valueEl) valueEl.textContent = step.value || step.sub || '—'
        gsap.fromTo(fieldEl, { opacity: 0.35, y: 6 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' })
      }
      gsap.to(chartCenterEl, { scale: 1.04, duration: 0.25, yoyo: true, repeat: 1, ease: 'sine.inOut' })
      return
    }

    if (step.phase === 'decadal') {
      igniteChartCell(step.cellId, {
        palaceName: step.palaceName,
        decadal: step.sub,
      })
      return
    }

    if (step.phase === 'finish') {
      sortPalacesByName(chart?.palaces || []).forEach((palace) => {
        const { major, minor } = summarizeCellStars(palace)
        const badges = [palace.isBodyPalace ? '身' : '', palace.isOriginalPalace ? '因' : ''].filter(Boolean).join('')
        const decadal = palace.decadal?.range
          ? `${palace.decadal.range[0]}-${palace.decadal.range[1]}`
          : ''
        igniteChartCell(BRANCH_TO_CELL[palace.earthlyBranch], {
          palaceName: palace.name,
          major,
          minor,
          decadal,
          badge: badges,
          isMing: palace.name === '命宫',
          isBody: palace.isBodyPalace,
        })
      })
      fireShockwaves(0.07, 4.2)
      particles?.burst(0.65)
    }
  }

  function drivePaipanWithChart(chart, durationMs = 2000) {
    stopPaipanSequence()
    showPaipanOverlay()
    initChartPalaceLabels(chart)
    startGeneratingIdle()

    const steps = schedulePaipanSteps(buildPaipanMicroSteps(chart), durationMs)
    if (!steps.length) return Promise.resolve()

    return new Promise((resolve) => {
      paipanTimers = steps.map((step) =>
        gsap.delayedCall(step.at / 1000, () => executeMicroStep(step, chart)),
      )
      paipanTimers.push(gsap.delayedCall(durationMs / 1000 + 0.12, resolve))
    })
  }

  function revealChartSkeleton(delay = 0) {
    initChartPalaceLabels()
    gsap.set(chartSkelEl, { opacity: 0, scale: 0.88 })
    gsap.set(chartCellEls, { opacity: 0, scale: 0.92 })
    gsap.set(chartCenterEl, { opacity: 0, scale: 0.85 })
    sfszLineEls.forEach((line) => {
      const len = line.getTotalLength?.() || 100
      line.style.strokeDasharray = `${len}`
      line.style.strokeDashoffset = `${len}`
    })

    return gsap.timeline({ delay })
      .to(chartSkelEl, { opacity: 0.38, scale: 1, duration: 1.1, ease: 'power3.out' })
      .to(chartCellEls, { opacity: 1, scale: 1, duration: 0.65, stagger: 0.04, ease: 'power2.out' }, 0.15)
      .to(chartCenterEl, { opacity: 1, scale: 1, duration: 0.75, ease: 'power2.out' }, 0.35)
      .to(sfszLineEls, {
        strokeDashoffset: 0,
        opacity: 0.7,
        duration: 0.55,
        stagger: 0.08,
        ease: 'power2.out',
        onStart: () => gsap.set(sfszLineEls, { opacity: 0.35 }),
      }, 0.55)
  }

  function collapseChartIntoCenter() {
    gsap.to(chartSkelEl, {
      scale: 0.12,
      opacity: 0,
      duration: 0.75,
      ease: 'power4.in',
    })
    gsap.to(chartCellEls, {
      opacity: 0,
      scale: 0.5,
      duration: 0.55,
      stagger: { each: 0.02, from: 'center' },
      ease: 'power3.in',
    })
  }

  function showPaipanOverlay() {
    gsap.set(paipanEl, { opacity: 0, pointerEvents: 'none' })
    gsap.set(paipanSihuaEls, { opacity: 0.35, scale: 1, y: 0 })
    gsap.set(starstreamEl, { opacity: 0 })
    resetChartCells()
    resetCenterFields()
    resetPaipanVisuals()
    gsap.set(chartSkelEl, { opacity: 0.42, scale: 1, clearProps: 'filter' })
    gsap.set(chartCellEls, { opacity: 1, scale: 1 })

    gsap.to(paipanEl, { opacity: 1, duration: 0.45, ease: 'power2.out' })
    gsap.to(chartSkelEl, { opacity: 0.58, duration: 0.55, ease: 'power2.out' }, 0)
    gsap.to(paipanSihuaEls, { opacity: 1, duration: 0.4, stagger: 0.05 }, 0.1)
  }

  function stopPaipanSequence() {
    paipanTimers.forEach((timer) => timer.kill())
    paipanTimers = []
    paipanTl?.kill()
    paipanTl = null
    gsap.killTweensOf([
      ...starstreamEls,
      ...paipanSihuaEls,
      paipanStepEl,
      paipanSubEl,
      chartCenterEl,
      ...centerFieldEls,
    ])
    gsap.to(paipanEl, { opacity: 0, duration: 0.3 })
    gsap.to(starstreamEl, { opacity: 0, duration: 0.25 })
    gsap.to(chartSkelEl, { opacity: 0, scale: 1.08, duration: 0.45, ease: 'power2.in' })
  }

  function setSkipLabel(text) {
    if (skipEl) skipEl.textContent = text
  }

  function glyphOffset(el) {
    const gx = el.style.getPropertyValue('--gx').trim() || '0vw'
    const gy = el.style.getPropertyValue('--gy').trim() || '0vh'
    return {
      x: (parseFloat(gx) / 100) * window.innerWidth,
      y: (parseFloat(gy) / 100) * window.innerHeight,
      scale: parseFloat(el.style.getPropertyValue('--gs')) || 1,
    }
  }

  function layoutGlyphs() {
    glyphEls.forEach((el) => {
      const { x, y, scale } = glyphOffset(el)
      gsap.set(el, { x, y, scale, opacity: 0, rotation: parseFloat(el.style.getPropertyValue('--gr')) || 0 })
    })
  }

  function fireShockwaves(stagger = 0.13, peakScale = 4.6) {
    shockwaveEls.forEach((el, i) => {
      gsap.fromTo(
        el,
        { scale: 0.1, opacity: 0.75 },
        {
          scale: peakScale,
          opacity: 0,
          duration: 1.05,
          delay: stagger * i,
          ease: 'power2.out',
          overwrite: true,
        },
      )
    })
  }

  function driftGlyphsIn(intensity = 1) {
    glyphEls.forEach((el, i) => {
      const { x, y, scale } = glyphOffset(el)
      const dist = Math.hypot(x, y) || 1
      const startAngle = Math.atan2(y, x)
      const proxy = { angle: startAngle, radius: dist }
      gsap.set(el, { x, y, scale, opacity: 0, rotation: parseFloat(el.style.getPropertyValue('--gr')) || 0 })
      gsap.to(el, { opacity: 0.2 * intensity, duration: 1, delay: 0.03 * i, ease: 'power2.out' })
      gsap.to(proxy, {
        angle: startAngle + Math.PI * 2,
        radius: dist * 0.55,
        duration: 10 + i * 0.35,
        repeat: -1,
        ease: 'none',
        onUpdate: () => {
          gsap.set(el, {
            x: Math.cos(proxy.angle) * proxy.radius,
            y: Math.sin(proxy.angle) * proxy.radius,
          })
        },
      })
    })
  }

  function suckGlyphsToSingularity() {
    gsap.killTweensOf(glyphEls)
    suckElementsToSingularity(glyphEls, ZW_CINE_SUCK_DURATION * 0.95, 0.012)
  }

  function suckSceneToSingularity() {
    const bits = [introCoreEl, ringEl, ringGlowEl, titleEl, subtitleEl, hintEl].filter(Boolean)
    suckElementsToSingularity(bits, ZW_CINE_SUCK_DURATION * 0.88, 0.022)
    suckElementsToSingularity(orbitNodeEls, ZW_CINE_SUCK_DURATION * 0.96, 0.008)
    suckElementsToSingularity(chartCellEls, ZW_CINE_SUCK_DURATION, 0.006)
    if (orbitEl) {
      gsap.to(orbitEl, { scale: 0.02, opacity: 0, duration: ZW_CINE_SUCK_DURATION * 0.85, ease: 'power4.in' })
    }
    if (chartCenterEl) {
      gsap.to(chartCenterEl, { scale: 0, opacity: 0, duration: ZW_CINE_SUCK_DURATION * 0.75, ease: 'power4.in' })
    }
    particles?.setVortexActive(true)
    particles?.setSuckIntensity(0.15)
    gsap.to({}, {
      duration: ZW_CINE_SUCK_DURATION * 0.5,
      ease: 'power2.in',
      onUpdate() {
        const p = this.progress()
        particles?.setSuckIntensity(0.15 + p * 0.72)
      },
    })
    gsap.to({}, {
      duration: ZW_CINE_SUCK_DURATION * 0.22,
      delay: ZW_CINE_SUCK_DURATION * 0.52,
      ease: 'power2.out',
      onUpdate() {
        const p = this.progress()
        particles?.setSuckIntensity(0.87 * (1 - p))
      },
    })
  }

  function glitchTitle() {
    if (!titleMainEl || !titleGhostEls.length) return
    gsap.fromTo(
      titleGhostEls[0],
      { x: -5, y: 0, opacity: 0.65, skewX: -8 },
      { x: 8, opacity: 0, duration: 0.35, ease: 'power2.in' },
    )
    gsap.fromTo(
      titleGhostEls[1],
      { x: 6, y: 2, opacity: 0.55, skewX: 10 },
      { x: -10, opacity: 0, duration: 0.38, ease: 'power2.in' },
    )
    gsap.to(titleMainEl, {
      x: '+=3',
      yoyo: true,
      repeat: 3,
      duration: 0.04,
      ease: 'none',
      onComplete: () => gsap.set(titleMainEl, { x: 0 }),
    })
  }

  function stopAmbientLoops() {
    gsap.killTweensOf([orbitTrackEl, ringImg, ...tunnelRingEls])
  }

  function startIntroAmbientLoops() {
    stopAmbientLoops()
    if (orbitTrackEl) {
      gsap.to(orbitTrackEl, { rotate: '+=360', duration: 48, ease: 'none', repeat: -1 })
    }
    if (ringImg) {
      gsap.to(ringImg, { rotate: '+=360', duration: 16, ease: 'none', repeat: -1 })
    }
    if (tunnelRingEls.length) {
      gsap.set(tunnelRingEls, { opacity: 0, scale: 0.4 })
    }
  }

  function startIntakeAmbientLoops() {
    gsap.killTweensOf(tunnelRingEls)
    if (!tunnelRingEls.length) return
    gsap.set(tunnelRingEls, { opacity: 0.08, scale: 0.85 })
    gsap.to(tunnelRingEls, {
      opacity: 0.12,
      scale: 1.15,
      duration: 2.4,
      stagger: 0.08,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
  }

  function timelineDone(tl) {
    return new Promise((resolve) => {
      tl.eventCallback('onComplete', resolve)
    })
  }

  function waitSeconds(seconds) {
    return new Promise((resolve) => {
      waitResolve = resolve
      waitTimer = gsap.delayedCall(seconds, () => {
        if (waitResolve === resolve) {
          waitResolve = null
          waitTimer = null
          resolve()
        }
      })
    })
  }

  function startIdleBreath() {
    idleTl?.kill()
    idleTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } })
    idleTl
      .to(ringGlowEl, { scale: 1.15, opacity: 0.85, duration: 2.2 }, 0)
      .to(ringEl, { scale: 1.04, duration: 2.2 }, 0)
      .to(titleEl, { textShadow: '0 0 40px rgba(160, 139, 255,0.55)', duration: 2.2 }, 0)
      .to(auroraEl, { opacity: 0.55, duration: 2.2 }, 0)
      .add(tweenWarp(0.14, 2.2, 'sine.inOut'), 0)
  }

  function stopIdleBreath() {
    idleTl?.kill()
    idleTl = null
    stopAmbientLoops()
  }

  /** 共享：粒子漩涡吸入（第一、二阶段一致） */
  function runSuckTunnel(options = {}) {
    const {
      prepareSuck,
      fadeIntake = false,
      collapseChart = true,
      endPhase = null,
    } = options
    const dur = ZW_CINE_SUCK_DURATION

    stopIdleBreath()
    root.dataset.phase = 'suck'

    const tl = gsap.timeline()

    tl.call(() => {
      prepareSuck?.()
      particles?.shatter(0.65)
      particles?.burst(0.35)
      particles?.setChroma(0.18)
    }, null, 0)

    if (collapseChart) {
      tl.call(() => collapseChartIntoCenter(), null, dur * 0.05)
    }

    tl
      .to(chromaticEl, { opacity: 0.18, duration: dur * 0.07, ease: 'power2.in' }, 0.02)
      .add(tweenWarp(0.82, dur * 0.68, 'power3.in'), 0)
      .to(titleEl, { letterSpacing: '0.65em', opacity: 0, duration: dur * 0.24, ease: 'power3.in' }, dur * 0.03)
      .to(speedlinesEl, { opacity: 0.38, duration: dur * 0.05 }, dur * 0.04)
      .to(
        speedlineEls,
        {
          scaleY: 5.5,
          opacity: 0,
          duration: dur * 0.24,
          stagger: { each: 0.02, from: 'random' },
          ease: 'power3.in',
          onStart: () => gsap.set(speedlineEls, { opacity: 0.3, scaleY: 0.1 }),
        },
        dur * 0.05,
      )
      .to(speedlinesEl, { opacity: 0, duration: dur * 0.1 }, dur * 0.32)
      .to(
        tunnelRingEls,
        {
          scale: 2.6,
          opacity: 0.22,
          duration: dur * 0.38,
          stagger: 0.05,
          ease: 'power2.in',
          onStart: () => gsap.set(tunnelRingEls, { opacity: 0.2, scale: 0.3 }),
        },
        dur * 0.07,
      )
      .to(nebulaEls, { scale: 1.35, opacity: 0, duration: dur * 0.28, ease: 'power2.in' }, dur * 0.12)
      .to(auroraEl, { opacity: 0.22, duration: dur * 0.18 }, dur * 0.38)
      .to(vignetteEl, { opacity: 0.42, duration: dur * 0.22 }, dur * 0.3)
      .to(chromaticEl, { opacity: 0, duration: dur * 0.16 }, dur * 0.38)
      .to(tunnelRingEls, { opacity: 0, duration: dur * 0.14 }, dur * 0.42)
      .to(focalHubEl, { opacity: 0, duration: dur * 0.12, ease: 'power2.in' }, dur * 0.58)

    if (fadeIntake) {
      tl.to(
        [intakeEl, intakeInnerEl],
        {
          opacity: 0,
          scale: 0.94,
          filter: 'blur(6px)',
          duration: dur * 0.24,
          ease: 'power3.in',
        },
        dur * 0.04,
      )
      tl.set([intakeEl, intakeInnerEl], { pointerEvents: 'none' }, dur)
    }

    tl
      .call(() => {
        particles?.setChroma(0)
        gsap.set([chromaticEl, speedlinesEl, ...tunnelRingEls], { opacity: 0 })
        gsap.killTweensOf(tunnelRingEls)
      }, null, dur * 0.52)
      .add(tweenWarp(0.1, dur * 0.28, 'power2.out'), dur * 0.58)
      .call(() => {
        particles?.setVortexActive(false)
        particles?.setSuckIntensity(0)
        if (fadeIntake) {
          gsap.set([intakeEl, intakeInnerEl], { visibility: 'hidden' })
        }
        if (endPhase) root.dataset.phase = endPhase
      }, null, dur)

    return tl
  }

  /** 第一阶段：intro 消散 → 吸入 → 表单 */
  function playDissolveAndTunnel() {
    return timelineDone(
      runSuckTunnel({
        prepareSuck: () => {
          gsap.killTweensOf(ringImg)
          gsap.to(ringImg, { rotate: 720, duration: ZW_CINE_SUCK_DURATION * 0.78, ease: 'power3.in' })
          gsap.to(ringEl, { rotate: 120, scale: 0.02, duration: ZW_CINE_SUCK_DURATION * 0.75, ease: 'power4.in' }, 0)
          fireShockwaves(0.16, 2.8)
          suckSceneToSingularity()
          if (subtitleEl) subtitleEl.textContent = '起盘演星 · 入宫安宿'
        },
      }),
    )
  }

  async function playIntro() {
    killAll()
    setPhaseVisible('intro')
    root.dataset.phase = 'intro'
    introActive = true
    setSkipLabel('Enter 起盘 · Esc 跳过')
    particles?.setWarpIntensity(0.08)
    warp.value = 0.08
    particles?.setFade(1)
    layoutGlyphs()

    gsap.set(
      [
        introEl,
        introCoreEl,
        ringEl,
        ringGlowEl,
        titleEl,
        subtitleEl,
        hintEl,
        flashEl,
        chromaticEl,
        speedlinesEl,
        intakeBloomEl,
        auroraEl,
        orbitEl,
        flareEl,
        grainEl,
        titleMainEl,
        ...titleGhostEls,
        ...tunnelRingEls,
        ...nebulaEls,
        ...shockwaveEls,
        chartSkelEl,
        chartCenterEl,
        paipanEl,
        starstreamEl,
        ...chartCellEls,
        ...sfszLineEls,
      ].filter(Boolean),
      { clearProps: 'opacity,transform,filter,letterSpacing,textShadow,scaleY' },
    )
    gsap.set(shockwaveEls, { scale: 0.1, opacity: 0 })
    gsap.set(flareEl, { opacity: 0, scale: 0.6 })
    gsap.set(auroraEl, { opacity: 0 })
    gsap.set(orbitEl, { opacity: 0, scale: 0.85 })
    gsap.set(grainEl, { opacity: 0.35 })
    gsap.set(titleGhostEls, { opacity: 0 })
    gsap.set(introEl, { opacity: 1 })
    gsap.set(introCoreEl, { opacity: 0, scale: 0.65, filter: 'blur(16px)' })
    gsap.set(ringEl, { scale: 0.15, rotate: -120 })
    gsap.set(ringGlowEl, { opacity: 0, scale: 0.5 })
    gsap.set(tunnelRingEls, { opacity: 0, scale: 0.4 })
    gsap.set(speedlinesEl, { opacity: 0 })
    gsap.set(chromaticEl, { opacity: 0 })
    gsap.set(nebulaEls, { opacity: 0, scale: 0.8 })
    gsap.set(intakeEl, { opacity: 0, pointerEvents: 'none' })
    if (focalHubEl) gsap.set(focalHubEl, { opacity: 1 })
    gsap.set(intakeInnerEl, { opacity: 0, y: 80, scale: 0.85 })
    gsap.set(intakeBloomEl, { opacity: 0, scale: 0.5 })
    gsap.set(fieldEls, { opacity: 0, y: 50, scale: 0.9 })
    gsap.set(submitEl, { opacity: 0, y: 28 })
    gsap.set(paipanEl, { opacity: 0 })
    gsap.set(starstreamEl, { opacity: 0 })
    resetChartCells()

    introTl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    introTl
      .fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.55 })
      .add(revealChartSkeleton(0.2), 0.25)
      .fromTo(flashEl, { opacity: 0.85 }, { opacity: 0, duration: 0.7, ease: 'power2.out' }, 0)
      .to(auroraEl, { opacity: 0.45, duration: 1.8, ease: 'power2.out' }, 0.15)
      .to(orbitEl, { opacity: 1, scale: 1, duration: 1.4, ease: 'power3.out' }, 0.35)
      .call(() => driftGlyphsIn(1), null, 0.55)
      .to(nebulaEls, { opacity: 1, scale: 1, duration: 1.4, stagger: 0.15 }, 0.1)
      .to(introCoreEl, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1.15, ease: 'power4.out' }, 0.18)
      .to(ringGlowEl, { opacity: 0.7, scale: 1, duration: 1, ease: 'power2.out' }, 0.28)
      .to(ringEl, { scale: 1, rotate: 0, duration: 1.2, ease: 'power4.out' }, 0.22)
      .fromTo(
        titleEl,
        { opacity: 0, y: 32, letterSpacing: '0.55em' },
        { opacity: 1, y: 0, letterSpacing: '0.28em', duration: 0.9 },
        0.48,
      )
      .fromTo(subtitleEl, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.75 }, 0.65)
      .fromTo(hintEl, { opacity: 0 }, { opacity: 0.5, duration: 0.55 }, 0.82)

    await timelineDone(introTl)
    startIntroAmbientLoops()
    startIdleBreath()
    await waitSeconds(3)
    await playDissolveAndTunnel()
    introActive = false
  }

  async function skipIntroEarly() {
    if (!introActive) return

    stopIdleBreath()
    if (waitTimer) {
      waitTimer.kill()
      waitTimer = null
    }
    if (waitResolve) {
      waitResolve()
      waitResolve = null
    }

    introTl?.kill()
    stopAmbientLoops()
    await playDissolveAndTunnel()
    introActive = false
  }

  function playIntakeEnter() {
    killAll()
    setPhaseVisible('intake')
    root.dataset.phase = 'intake'
    setSkipLabel('跳过 · Esc')
    particles?.setSuckIntensity(0)
    particles?.setWarpIntensity(0.18)
    warp.value = 0.18
    gsap.set(chartSkelEl, { opacity: 0 })

    const whisperEl = root.querySelector('.zw-cine__intake-whisper')

    return timelineDone(
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .set(intakeEl, { opacity: 1, pointerEvents: 'auto' })
        .add(tweenWarp(0.1, 1.4, 'power4.out'), 0)
        .fromTo(
          intakeBloomEl,
          { opacity: 0, scale: 0.55 },
          { opacity: 0.5, scale: 2.6, duration: 1.05, ease: 'power2.out' },
          0.05,
        )
        .to(intakeBloomEl, { opacity: 0, scale: 3.4, duration: 0.85, ease: 'power2.in' }, 0.6)
        .fromTo(
          whisperEl,
          { opacity: 0, y: 14, filter: 'blur(8px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.85, ease: 'power3.out' },
          0.22,
        )
        .fromTo(
          intakeInnerEl,
          { opacity: 0, y: 52, filter: 'blur(14px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.05, ease: 'power4.out' },
          0.12,
        )
        .fromTo(
          fieldEls,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.62, stagger: 0.08, ease: 'power3.out' },
          0.32,
        )
        .fromTo(
          submitEl,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' },
          0.68,
        )
        .to(chromaticEl, { opacity: 0, duration: 0.4 }, 0)
        .call(() => startIntakeAmbientLoops(), null, 0.85),
    )
  }

  function stopGeneratingIdle() {
    idleTl?.kill()
    idleTl = null
    gsap.killTweensOf(chromaticEl)
  }

  /** 第二阶段：表单 → 与第一阶段相同的吸入 → 排盘 */
  function playWarpToGenerating() {
    stopGeneratingIdle()
    gsap.killTweensOf([chromaticEl, ...tunnelRingEls])
    gsap.set(root, { opacity: 1 })

    if (skipEl) {
      gsap.to(skipEl, { opacity: 0, duration: 0.25, pointerEvents: 'none' })
    }

    return timelineDone(
      runSuckTunnel({
        fadeIntake: true,
        endPhase: 'generating',
        prepareSuck: () => {
          fireShockwaves(0.16, 2.8)
          suckGlyphsToSingularity()
          suckSceneToSingularity()
          const intakeBits = [intakeInnerEl, submitEl, ...fieldEls].filter(Boolean)
          suckElementsToSingularity(intakeBits, ZW_CINE_SUCK_DURATION * 0.88, 0.015)
        },
      }).call(() => {
        startGeneratingIdle()
      }, null, ZW_CINE_SUCK_DURATION),
    )
  }

  function startGeneratingIdle() {
    stopGeneratingIdle()
    idleTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } })
    idleTl
      .add(tweenWarp(0.72, 0.95, 1.4, 'sine.inOut'), 0)
      .to(chromaticEl, { opacity: 0.18, duration: 1.4 }, 0)

    gsap.timeline({ repeat: -1 })
      .call(() => particles?.burst(0.18), null, 2.2)
      .call(() => particles?.setChroma(0.22), null, 0)
  }

  /** 命盘就绪：overlay 消散，露出全屏星宿命盘（非控制台） */
  function playArriveAtStarfield() {
    stopGeneratingIdle()
    stopPaipanSequence()
    particles?.setVortexActive(true)
    particles?.vortexBurst(0.65)

    const dur = 0.85

    return timelineDone(
      gsap.timeline()
        .call(() => fireShockwaves(0.1, 4.8), null, 0)
        .add(tweenWarp(0.7, dur * 0.45, 'power3.in'), 0)
        .to(chromaticEl, { opacity: 0.25, duration: 0.15, ease: 'power2.in' }, 0)
        .to(root, { opacity: 0, duration: 0.55, ease: 'power2.in' }, dur * 0.38)
        .call(() => {
          particles?.setVortexActive(false)
          particles?.setSuckIntensity(0)
          tweenWarp(0.02, 0.35, 'power2.out')
        }, null, dur)
        .to(chromaticEl, { opacity: 0, duration: 0.25 }, dur * 0.5),
    )
  }

  function playWarpToConsole() {
    killAll()
    root.dataset.phase = 'warp'
    particles?.shatter(0.8)
    particles?.burst(1.1)
    particles?.setChroma(0.9)
    particles?.setWarpIntensity(1)
    warp.value = 1

    return timelineDone(
      gsap.timeline()
        .to(chromaticEl, { opacity: 0.8, duration: 0.2, ease: 'power2.in' }, 0)
        .add(tweenWarp(1, 1.35, 'power4.in'), 0)
        .to(speedlinesEl, { opacity: 1, duration: 0.2 }, 0.05)
        .to(
          speedlineEls,
          {
            scaleY: 10,
            opacity: 0,
            duration: 0.85,
            stagger: 0.015,
            ease: 'power3.in',
            onStart: () => gsap.set(speedlineEls, { opacity: 0.8, scaleY: 0.15 }),
          },
          0.08,
        )
        .to(
          [intakeEl, intakeInnerEl],
          { opacity: 0, scale: 1.2, filter: 'blur(20px) brightness(1.5)', duration: 0.8, ease: 'power3.in' },
          0.1,
        )
        .to(flashEl, { opacity: 0.6, duration: 0.08, yoyo: true, repeat: 1 }, 0.15)
        .to(root, { opacity: 0, duration: 0.65, ease: 'power2.in' }, 0.9)
        .add(tweenWarp(0.02, 0.75, 'power2.out'), 1.0)
        .to(chromaticEl, { opacity: 0, duration: 0.4 }, 0.95),
    )
  }

  function pulseGenerating(active) {
    if (root.dataset.phase === 'generating') return
    tweenWarp(active ? 0.98 : 0.1, active ? 0.55 : 0.6, 'sine.inOut')
    if (active) {
      particles?.burst(0.55)
      particles?.setChroma(0.5)
      gsap.to(chromaticEl, { opacity: 0.35, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' })
    } else {
      gsap.killTweensOf(chromaticEl)
      gsap.to(chromaticEl, { opacity: 0, duration: 0.4 })
      particles?.setChroma(0)
    }
  }

  function destroy() {
    killAll()
    stopGeneratingIdle()
    stopPaipanSequence()
    gsap.killTweensOf([
      chromaticEl, ringImg, skipEl, orbitTrackEl,
      ...glyphEls, ...shockwaveEls, flareEl,
      ...chartCellEls, chartSkelEl, chartCenterEl, paipanEl, ...starstreamEls,
    ])
    introActive = false
    particles?.destroy()
  }

  return {
    playIntro,
    skipIntroEarly,
    playIntakeEnter,
    playWarpToGenerating,
    drivePaipanWithChart,
    playArriveAtStarfield,
    playWarpToConsole,
    pulseGenerating,
    destroy,
  }
}
