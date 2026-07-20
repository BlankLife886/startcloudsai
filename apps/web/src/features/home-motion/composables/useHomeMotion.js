/**
 * 首页动效中枢：GSAP(ScrollTrigger) + anime.js + three.js 星幕联动。
 *
 * 职责划分：
 * - GSAP：序厅 pin 滚动解体、滚动显现（ScrollTrigger.batch）、展厅视差（scrub）、
 *   滚动速度倾斜 + 星幕曲速、跑马灯、指针视差 / 聚光灯 / 卡片 3D tilt（quickTo）。
 * - anime.js：数字滚动、随机种子字符翻牌、按钮回弹等微交互。
 * - three.js：星幕画布通过 setPointer / setScroll / setWarp 接收输入。
 *
 * 所有动画只触碰 transform / opacity / CSS 变量，尊重 prefers-reduced-motion
 * 与站内「关闭动画」设置。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { animate as animeAnimate } from '@/lib/anime'
import { createTitleParticles } from '../scene/particleText'

gsap.registerPlugin(ScrollTrigger)

const REVEAL_SELECTOR = '[data-home-reveal]:not(.home-hero__copy):not(.home-hero__wall)'

// 每个展厅的主题色：滚到哪个厅，全页环境光就变成哪种颜色
const HALL_ACCENTS = {
  '01': '#a894ff', // 序厅 · 星紫
  '02': '#7de1ff', // 工坊 · 电青
  '03': '#ff9be8', // 画廊 · 霓粉
  '04': '#8fb5ff', // 竖屏 · 晨蓝
  '05': '#7fe8cf', // 横屏 · 极光绿
  '06': '#ffd794', // 随机 · 星金
  '07': '#f0edff', // 落款 · 月白
}

export function shouldReduceMotion() {
  return (
    typeof window === 'undefined' ||
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function headerOffsetPx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-offset')
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 82
}

export function useHomeMotion(rootRef, celestialRef) {
  let ctx = null
  let motionMedia = null
  let activeHall = null
  let skewTargets = []
  let skewSetter = null
  const skewProxy = { value: 0 }
  const warpProxy = { value: 0 }
  const marqueeProxy = { value: 1 }
  let removePointerHandlers = null

  function root() {
    return rootRef.value
  }

  function scene() {
    return celestialRef?.value || null
  }

  /* ———— 滚动显现 ———— */

  function animateRevealBatch(nodes) {
    const list = Array.isArray(nodes) ? nodes : [nodes]
    const fresh = list.filter((node) => node && !node.classList.contains('is-revealed'))
    if (!fresh.length) return
    fresh.forEach((node) => node.classList.add('is-revealed'))

    gsap.fromTo(
      fresh,
      { autoAlpha: 0, y: 38, scale: 0.985 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.68,
        ease: 'power3.out',
        stagger: 0.06,
        clearProps: 'transform,visibility',
        overwrite: 'auto',
      },
    )

    for (const node of fresh) {
      node.closest('[data-home-hall]')?.classList.add('is-active-hall')

      if (node.classList.contains('home-hall-head')) {
        // h2 不在此列：大标题由滚动驱动的逐字动画独占（attachDepthLayers）
        const parts = node.querySelectorAll(
          '.home-hall-head__label, .home-hall-head p, .home-hall-head__action',
        )
        gsap.fromTo(
          parts,
          { autoAlpha: 0, y: 24, rotationX: -20, transformPerspective: 700 },
          {
            autoAlpha: 1,
            y: 0,
            rotationX: 0,
            duration: 0.62,
            ease: 'power3.out',
            stagger: 0.06,
            clearProps: 'transform,visibility',
          },
        )
      }

      // 注意：不动 y，y 轴交给深度视差（attachDepthLayers）独占，避免互相打架
      const accents = node.querySelectorAll(
        '.home-studio-card, .home-community-card, .home-community__rank li',
      )
      if (accents.length) {
        gsap.fromTo(
          accents,
          { autoAlpha: 0, scale: 0.94, rotationX: -8, transformPerspective: 800 },
          {
            autoAlpha: 1,
            scale: 1,
            rotationX: 0,
            duration: 0.6,
            ease: 'back.out(1.25)',
            stagger: { each: 0.055, from: 'start' },
            clearProps: 'visibility',
          },
        )
      }
    }
  }

  function observeNewReveals() {
    const el = root()
    if (!el) return
    const nodes = [...el.querySelectorAll(REVEAL_SELECTOR)].filter(
      (node) => node.dataset.motionTracked !== 'true',
    )
    if (!nodes.length) return
    nodes.forEach((node) => {
      node.dataset.motionTracked = 'true'
    })

    if (shouldReduceMotion() || !ctx) {
      nodes.forEach((node) => node.classList.add('is-revealed'))
      gsap.set(nodes, { autoAlpha: 1, y: 0, clearProps: 'transform,visibility' })
      return
    }

    ctx.add(() => {
      gsap.set(nodes, { autoAlpha: 0, y: 38 })
      ScrollTrigger.batch(nodes, {
        start: 'top 97%',
        once: true,
        interval: 0.06,
        onEnter: (batch) => animateRevealBatch(batch),
      })
    })
    updateSkewTargets()
    attachDepthLayers()
    requestAnimationFrame(() => ScrollTrigger.refresh())
  }

  /* ———— 序厅离场：不 pin，滚动即时响应的分层视差 ————
     文案先走、拼贴墙慢半拍、印章旋出，序厅自然让位给创作工坊，
     避免 pin 造成的“页面卡住 + 离场后空白”断层。 */

  function setupHeroExit(el, introTl) {
    const hero = el.querySelector('.home-hero')
    if (!hero) return
    const heroBody = hero.querySelector('.home-hero__body')
    const titleLines = hero.querySelectorAll('.home-title-line > span')
    const wall = hero.querySelector('.home-hero__wall')
    const seal = hero.querySelector('.home-seal')
    const masthead = hero.querySelector('.home-hero__masthead')

    // 离场全部用显式 fromTo（from = 入场终态）+ immediateRender:false：
    // 起始值不依赖运行时采集，往返滚动不会把元素卡在中间态。
    const tl = gsap.timeline({
      defaults: { ease: 'none', immediateRender: false },
      paused: true,
    })

    // 入场没播完就开始滚动时，直接快进到终态，避免两条时间线抢同一属性
    let settled = false
    const settleIntro = () => {
      if (settled) return
      settled = true
      if (introTl && introTl.progress() < 1) introTl.progress(1).kill()
    }

    ScrollTrigger.create({
      animation: tl,
      trigger: hero,
      start: () => `top ${headerOffsetPx()}px`,
      end: 'bottom 22%',
      scrub: true,
      onUpdate(self) {
        if (self.progress > 0.001) settleIntro()
      },
    })

    if (masthead) {
      tl.fromTo(masthead, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -22 }, 0)
    }
    if (titleLines.length) {
      tl.fromTo(
        titleLines,
        { yPercent: 0, autoAlpha: 1 },
        { yPercent: -34, autoAlpha: 0.24, stagger: 0.05 },
        0,
      )
    }
    if (seal) {
      tl.fromTo(
        seal,
        { rotation: -8, scale: 1, autoAlpha: 1 },
        { rotation: -30, scale: 0.74, autoAlpha: 0.2 },
        0,
      )
    }
    if (heroBody) {
      tl.fromTo(heroBody, { y: 0, autoAlpha: 1 }, { y: -70, autoAlpha: 0.3 }, 0)
    }
    if (wall) {
      // 用 yPercent，避免与指针视差的 y(quickTo) 冲突；墙走得慢，形成纵深
      tl.fromTo(
        wall,
        { yPercent: 0, scale: 1, rotationX: 0, autoAlpha: 1 },
        {
          yPercent: -7,
          scale: 0.985,
          rotationX: 5,
          autoAlpha: 0.42,
          transformPerspective: 1100,
          transformOrigin: 'center 18%',
        },
        0,
      )
    }
  }

  /* ———— 展厅视差 + 页面进度 ———— */

  function setupScrollScene(el) {
    const progressSetter = gsap.quickSetter(el, '--home-progress')
    const journeyNumber = el.querySelector('.home-journey__number')
    const journeyName = el.querySelector('.home-journey__name')
    const halls = [...el.querySelectorAll('[data-home-hall]')]

    ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate(self) {
        progressSetter(self.progress.toFixed(4))
        scene()?.setScroll(self.progress)

        const focusLine = window.innerHeight * 0.42
        const current =
          halls.find((hall) => {
            const rect = hall.getBoundingClientRect()
            return rect.top <= focusLine && rect.bottom > focusLine
          }) ||
          halls.find((hall) => hall.getBoundingClientRect().top > focusLine) ||
          halls.at(-1)
        if (!current || current === activeHall) return
        activeHall?.classList.remove('is-current-hall')
        activeHall = current
        activeHall.classList.add('is-current-hall')
        const hallNumber = current.dataset.homeHall || '01'
        if (journeyNumber) journeyNumber.textContent = hallNumber
        if (journeyName) journeyName.textContent = current.dataset.homeHallName || 'Prologue'
        // 环境光随展厅变色：聚光灯、巨号数字、巡馆指示统一渐变到该厅主题色
        gsap.to(el, {
          '--home-accent': HALL_ACCENTS[hallNumber] || HALL_ACCENTS['01'],
          duration: 1.2,
          ease: 'power2.out',
          overwrite: 'auto',
        })
      },
    })

    // 每个展厅：巨号背景数字与头部按不同速率漂移，形成纵深
    halls.forEach((hall) => {
      if (!hall.classList.contains('home-hall')) return
      gsap.fromTo(
        hall,
        { '--hall-parallax': -1 },
        {
          '--hall-parallax': 1,
          ease: 'none',
          scrollTrigger: { trigger: hall, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
        },
      )
    })
  }

  /* ———— 跑马灯（随滚动加速 / 反向倒转） ———— */

  let marqueeTweens = []

  function setupMarquees(el) {
    marqueeTweens = []
    const tracks = el.querySelectorAll('.home-marquee__track')
    tracks.forEach((track, index) => {
      const reverse = track.closest('.home-marquee')?.dataset.reverse === 'true'
      marqueeTweens.push(
        gsap.fromTo(
          track,
          { xPercent: reverse ? -50 : 0 },
          {
            xPercent: reverse ? 0 : -50,
            ease: 'none',
            duration: 30 + index * 6,
            repeat: -1,
          },
        ),
      )
    })
  }

  /* ———— 深度视差 + 每厅专属滚动编排 ————
     内容随数据到达动态渲染，此函数幂等，可反复补挂。
     y 轴由这里独占（入场动画只动 opacity/scale/rotationX）。 */

  // 把标题拆成单字 span，用于滚动驱动的逐字升起
  function splitChars(node) {
    if (!node || node.dataset.splitDone === 'true') return []
    node.dataset.splitDone = 'true'
    node.classList.add('is-split')
    const text = node.textContent
    node.setAttribute('aria-label', text)
    node.textContent = ''
    return [...text].map((char) => {
      const span = document.createElement('span')
      span.className = 'home-char'
      span.textContent = char
      span.setAttribute('aria-hidden', 'true')
      node.appendChild(span)
      return span
    })
  }

  function attachDepthLayers() {
    const el = root()
    if (!el || !ctx || shouldReduceMotion()) return

    const track = (node, key = 'depthTracked') => {
      if (!node || node.dataset[key] === 'true') return false
      node.dataset[key] = 'true'
      return true
    }

    ctx.add(() => {
      // 展厅大标题：滚动驱动逐字升起（往回滚会倒放）
      el.querySelectorAll('.home-hall-head h2, .home-outro h2').forEach((heading) => {
        const hall = heading.closest('[data-home-hall]')
        const chars = splitChars(heading)
        if (!chars.length || !hall) return
        // 馆末落款贴近页底，滚动余量不足，提前完成以免逐字动画卡在半程
        const isOutro = hall.classList.contains('home-outro')
        gsap.fromTo(
          chars,
          { yPercent: 120, rotationX: -50, autoAlpha: 0, transformPerspective: 500 },
          {
            yPercent: 0,
            rotationX: 0,
            autoAlpha: 1,
            ease: 'none',
            stagger: 0.09,
            scrollTrigger: {
              trigger: hall,
              start: 'top 96%',
              end: isOutro ? 'top 76%' : 'top 52%',
              scrub: 0.35,
            },
          },
        )
      })

      // 每厅专属入场编排：滚动驱动，各厅语言不同
      el.querySelectorAll('.home-hall').forEach((hall) => {
        const id = hall.dataset.hall
        const enterTrigger = { trigger: hall, start: 'top 97%', end: 'top 38%', scrub: 0.45 }

        if (id === '02') {
          // 工坊：整面卡片墙从仰角翻起
          const grid = hall.querySelector('.home-studios__grid')
          if (grid && track(grid, 'sceneTracked')) {
            gsap.fromTo(
              grid,
              { rotationX: 16, transformPerspective: 1200, transformOrigin: 'center top' },
              { rotationX: 0, ease: 'none', scrollTrigger: enterTrigger },
            )
          }
        }

        if (id === '04') {
          // 竖屏星轨:展墙从地平线仰视升起
          const grid = hall.querySelector('.home-virtual-grid')
          if (grid && track(grid, 'sceneTracked')) {
            gsap.fromTo(
              grid,
              {
                y: 130,
                rotationX: 11,
                scale: 0.965,
                transformPerspective: 1300,
                transformOrigin: 'center top',
              },
              { y: 0, rotationX: 0, scale: 1, ease: 'none', scrollTrigger: enterTrigger },
            )
          }
          const tags = hall.querySelector('.home-wall__tags')
          if (tags && track(tags, 'sceneTracked')) {
            gsap.fromTo(tags, { x: -80 }, { x: 0, ease: 'none', scrollTrigger: enterTrigger })
          }
        }

        if (id === '05') {
          // 横屏星野：整面展墙从右侧横移滑入
          const grid = hall.querySelector('.home-virtual-grid')
          if (grid && track(grid, 'sceneTracked')) {
            gsap.fromTo(
              grid,
              { x: 150, rotationY: -7, transformPerspective: 1400, transformOrigin: 'left center' },
              { x: 0, rotationY: 0, ease: 'none', scrollTrigger: enterTrigger },
            )
          }
          const tabs = hall.querySelector('.home-wall__tabs')
          if (tabs && track(tabs, 'sceneTracked')) {
            gsap.fromTo(tabs, { x: 90 }, { x: 0, ease: 'none', scrollTrigger: enterTrigger })
          }
        }

        if (id === '06') {
          // 随机星尘：像一张牌被旋转着放到桌面
          const grid = hall.querySelector('.home-virtual-grid')
          if (grid && track(grid, 'sceneTracked')) {
            gsap.fromTo(
              grid,
              { y: 100, rotation: 2.2, scale: 0.94, transformOrigin: 'center top' },
              { y: 0, rotation: 0, scale: 1, ease: 'none', scrollTrigger: enterTrigger },
            )
          }
          const seed = hall.querySelector('.home-random__seed')
          if (seed && track(seed, 'sceneTracked')) {
            gsap.fromTo(seed, { x: 60 }, { x: 0, ease: 'none', scrollTrigger: enterTrigger })
          }
        }
      })
      // 序厅拼贴：离场时五格按不同速率散开，产生“穿过展墙”的纵深
      const heroCells = [...el.querySelectorAll('.home-hero__cell')].filter(track)
      if (heroCells.length) {
        gsap.fromTo(
          heroCells,
          { y: 0 },
          {
            y: (index) => -(26 + (index % 3) * 34 + index * 9),
            ease: 'none',
            immediateRender: false,
            scrollTrigger: {
              trigger: '.home-hero',
              start: () => `top ${headerOffsetPx()}px`,
              end: 'bottom 10%',
              scrub: 0.35,
            },
          },
        )
      }

      // 工坊卡片：三列三种速率，滚动穿越时相互错开
      const studioCards = [...el.querySelectorAll('.home-studio-card')].filter(track)
      if (studioCards.length) {
        gsap.fromTo(
          studioCards,
          { y: (index) => 30 + (index % 3) * 22 },
          {
            y: (index) => -(14 + (index % 3) * 20),
            ease: 'none',
            scrollTrigger: {
              trigger: '.home-studios',
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.35,
            },
          },
        )
      }

      // 云端画廊：精选卡从左右两侧对开滑入，随后奇偶交错漂移
      const communityCards = [
        ...el.querySelectorAll('.home-community__featured .home-community-card'),
      ].filter((node) => track(node))
      if (communityCards.length) {
        gsap.fromTo(
          communityCards,
          { y: (index) => 44 + (index % 2) * 52 },
          {
            y: (index) => -(26 + (index % 2) * 56),
            ease: 'none',
            scrollTrigger: {
              trigger: '.home-community',
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.35,
            },
          },
        )
        gsap.fromTo(
          communityCards,
          {
            x: (index) => (index % 2 ? 130 : -130),
            rotationY: (index) => (index % 2 ? -9 : 9),
            transformPerspective: 1100,
          },
          {
            x: 0,
            rotationY: 0,
            ease: 'none',
            scrollTrigger: {
              trigger: '.home-community',
              start: 'top 97%',
              end: 'top 34%',
              scrub: 0.45,
            },
          },
        )
      }
      const communityRank = el.querySelector('.home-community__rank')
      if (communityRank && track(communityRank, 'sceneTracked')) {
        gsap.fromTo(communityRank, { x: 130 }, {
          x: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: '.home-community',
            start: 'top 97%',
            end: 'top 34%',
            scrub: 0.5,
          },
        })
      }
      // 精选卡片框内视差：图片放大后在画框内反向滑动
      // 目标是 ShareProgressiveImage 的外层 span（一直存在），img 可能延迟挂载
      const communityMedia = [
        ...el.querySelectorAll('.home-community__featured .home-community-card__media'),
      ].filter((media) => media.querySelector('.share-progressive-image') && track(media))
      communityMedia.forEach((media) => {
        gsap.fromTo(
          media.querySelector('.share-progressive-image'),
          { yPercent: -6, scale: 1.15 },
          {
            yPercent: 6,
            scale: 1.15,
            ease: 'none',
            scrollTrigger: { trigger: media, start: 'top bottom', end: 'bottom top', scrub: 0.4 },
          },
        )
      })

      // 馆末落款：标题与动作层错速上浮
      const outroTitle = el.querySelector('.home-outro h2')
      if (outroTitle && track(outroTitle)) {
        gsap.fromTo(outroTitle, { y: 90, scale: 0.94 }, {
          y: -26,
          scale: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: '.home-outro',
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.35,
          },
        })
      }
      const outroActions = el.querySelector('.home-outro__actions')
      if (outroActions && track(outroActions)) {
        gsap.fromTo(outroActions, { y: 130 }, {
          y: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: '.home-outro',
            start: 'top bottom',
            end: 'center 55%',
            scrub: 0.35,
          },
        })
      }
    })
  }

  /* ———— 滚动速度：展墙倾斜 + 星幕曲速 ———— */

  function updateSkewTargets() {
    const el = root()
    if (!el) return
    skewTargets = [...el.querySelectorAll('.home-virtual-grid, .home-community__layout')]
    skewSetter = skewTargets.length ? gsap.quickSetter(skewTargets, 'skewY', 'deg') : null
  }

  function setupVelocity() {
    ScrollTrigger.create({
      onUpdate(self) {
        const velocity = gsap.utils.clamp(-2400, 2400, self.getVelocity())

        const skewTarget = gsap.utils.clamp(-2, 2, velocity / -520)
        if (skewSetter && Math.abs(skewTarget) > Math.abs(skewProxy.value)) {
          skewProxy.value = skewTarget
          gsap.to(skewProxy, {
            value: 0,
            duration: 0.85,
            ease: 'power3.out',
            overwrite: true,
            onUpdate: () => skewSetter?.(skewProxy.value),
          })
        }

        // 跑马灯吃滚动速度：越滚越快，向上滚会倒转，松手缓落回巡航速度
        const marqueeBoost = gsap.utils.clamp(-4, 4, velocity / 620)
        if (Math.abs(marqueeBoost) > Math.abs(marqueeProxy.value - 1)) {
          marqueeProxy.value = 1 + marqueeBoost
          gsap.to(marqueeProxy, {
            value: 1,
            duration: 1.3,
            ease: 'power2.out',
            overwrite: true,
            onUpdate: () => {
              marqueeTweens.forEach((tween) => tween.timeScale(marqueeProxy.value))
            },
          })
          marqueeTweens.forEach((tween) => tween.timeScale(marqueeProxy.value))
        }

        const warpTarget = Math.min(1, Math.abs(velocity) / 2000)
        if (warpTarget > warpProxy.value) {
          warpProxy.value = warpTarget
          scene()?.setWarp(warpTarget)
          gsap.to(warpProxy, {
            value: 0,
            duration: 1.1,
            ease: 'power2.out',
            overwrite: 'auto',
            onUpdate: () => scene()?.setWarp(warpProxy.value),
          })
        }
      },
    })
  }

  /* ———— 序厅入场 ———— */

  function animateNewHeroCells(timeline = null, position = 0) {
    const el = root()
    if (!el || shouldReduceMotion()) return
    const cells = [...el.querySelectorAll('.home-hero__cell')].filter(
      (cell) => cell.dataset.homeMotionReady !== 'true',
    )
    if (!cells.length) return
    cells.forEach((cell) => {
      cell.dataset.homeMotionReady = 'true'
    })
    const fromVars = {
      autoAlpha: 0,
      scale: 0.55,
      y: 60,
      rotationY: (index) => (index % 2 ? 38 : -38),
      rotation: (index) => (index % 2 ? 4 : -4),
      transformPerspective: 900,
      clipPath: (index) => (index % 2 ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)'),
    }
    const toVars = {
      autoAlpha: 1,
      scale: 1,
      y: 0,
      rotationY: 0,
      rotation: 0,
      duration: 1.05,
      ease: 'expo.out',
      stagger: { each: 0.085, from: 'center' },
      clipPath: 'inset(0% 0% 0% 0%)',
      clearProps: 'transform,visibility,clipPath',
    }
    const run = () => {
      if (timeline) timeline.fromTo(cells, fromVars, toVars, position)
      else gsap.fromTo(cells, fromVars, toVars)
    }
    if (ctx) ctx.add(run)
    else run()
    attachDepthLayers()
  }

  function setupIntro(el) {
    const heroCopy = el.querySelector('.home-hero__copy')
    const heroWall = el.querySelector('.home-hero__wall')
    const heroCopyParts = el.querySelectorAll(
      '.home-hero__copy .home-eyebrow, .home-hero__lede, .home-search, .home-quick, .home-stats',
    )
    const heroTitleLines = el.querySelectorAll('.home-title-line > span')
    const heroSeal = el.querySelector('.home-seal')
    const heroNote = el.querySelector('.home-hero__wall-note')
    const heroOrnaments = el.querySelectorAll('.home-hero__masthead > *, .home-hero__footer > *')
    const constellationLines = el.querySelectorAll('.home-constellation__line')
    const constellationNodes = el.querySelectorAll('.home-constellation__node')
    const godrays = el.querySelectorAll('.home-godray')

    const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })

    // 开场曲速冲刺：星星拉出光轨、镜头前冲，随后减速泊入序厅
    const warpBurst = { value: 1.4 }
    intro.to(
      warpBurst,
      {
        value: 0,
        duration: 2.4,
        ease: 'power3.out',
        onUpdate: () => scene()?.setWarp(Math.min(1, warpBurst.value)),
      },
      0,
    )

    if (godrays.length) {
      intro.fromTo(
        godrays,
        { autoAlpha: 0, scaleY: 0.35, transformOrigin: 'top center' },
        { autoAlpha: 1, scaleY: 1, duration: 1.8, ease: 'power2.out', stagger: 0.2 },
        0,
      )
    }

    if (heroCopy) {
      heroCopy.classList.add('is-revealed')
      intro.to(heroCopy, { autoAlpha: 1, y: 0, duration: 0.72 }, 0.08)
      intro.fromTo(
        heroCopyParts,
        { autoAlpha: 0, y: 34, rotationX: -16, transformPerspective: 700 },
        { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.7, stagger: 0.09 },
        0.3,
      )
      // 大标题：破碎粒子重组成字（失败时退回逐字翻入）
      const titleChars = [...heroTitleLines].flatMap((line) => splitChars(line))
      let sealAt = 1.02
      let particles = null
      if (titleChars.length) {
        // 测量前钉死 heroCopy 终态（干掉 reveal 的 16px 位移过渡），
        // 否则粒子会汇聚到偏移后的假位置
        heroCopy.style.transition = 'none'
        gsap.set(heroCopy, { autoAlpha: 1, y: 0 })
        gsap.set(titleChars, { autoAlpha: 0 })
        try {
          particles = createTitleParticles(el.querySelector('.home-hero'), titleChars)
        } catch {
          particles = null
        }
      }
      if (particles) {
        el.querySelector('.home-hero')?.appendChild(particles.canvas)
        sealAt = 2.3
        // 粒子汇聚由时间轴驱动：快进 / 跳过时 render(1) 即终态
        const driver = { t: 0 }
        intro.to(
          driver,
          { t: 1, duration: 2, ease: 'none', onUpdate: () => particles.render(driver.t) },
          0.2,
        )
        // 每个字的粒子落定时，真字接力亮出（左到右追赶粒子波）
        intro.fromTo(
          titleChars,
          { autoAlpha: 0, scale: 1.14 },
          { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'power2.out', stagger: 0.125 },
          1.06,
        )
        intro.to(particles.canvas, { autoAlpha: 0, duration: 0.5, ease: 'power2.out' }, 2.2)
        intro.call(() => particles.destroy(), null, 2.75)
      } else if (titleChars.length) {
        intro.fromTo(
          titleChars,
          {
            autoAlpha: 0,
            yPercent: 130,
            rotationX: -75,
            scale: 1.28,
            transformOrigin: '50% 100%',
            transformPerspective: 600,
          },
          {
            autoAlpha: 1,
            yPercent: 0,
            rotationX: 0,
            scale: 1,
            duration: 0.92,
            ease: 'back.out(1.5)',
            stagger: 0.085,
          },
          0.22,
        )
      } else if (heroTitleLines.length) {
        intro.fromTo(
          heroTitleLines,
          { yPercent: 122, rotation: 4 },
          { yPercent: 0, rotation: 0, duration: 1.05, ease: 'power4.out', stagger: 0.14 },
          0.16,
        )
      }
      // 印章轻盖落款（标题聚齐后收尾）
      if (heroSeal) {
        intro.fromTo(
          heroSeal,
          { autoAlpha: 0, scale: 1.4, rotation: -20 },
          { autoAlpha: 1, scale: 1, rotation: -8, duration: 0.55, ease: 'back.out(1.8)' },
          sealAt,
        )
      }
    }

    if (heroWall) {
      heroWall.classList.add('is-revealed')
      intro.fromTo(
        heroWall,
        { autoAlpha: 0, x: 70, rotationY: -12, transformPerspective: 1200 },
        { autoAlpha: 1, x: 0, rotationY: 0, duration: 1.15, ease: 'power4.out' },
        0.12,
      )
      animateNewHeroCells(intro, 0.32)
      if (heroNote) {
        intro.fromTo(
          heroNote,
          { autoAlpha: 0, x: -18 },
          { autoAlpha: 1, x: 0, duration: 0.55 },
          0.85,
        )
      }
      if (constellationLines.length) {
        intro.fromTo(
          constellationLines,
          { strokeDashoffset: 100 },
          { strokeDashoffset: 0, duration: 1.3, ease: 'power2.inOut', stagger: 0.1 },
          0.55,
        )
      }
      if (constellationNodes.length) {
        intro.fromTo(
          constellationNodes,
          { autoAlpha: 0, scale: 0, transformOrigin: 'center' },
          {
            autoAlpha: 1,
            scale: 1,
            duration: 0.5,
            ease: 'back.out(2.4)',
            stagger: { each: 0.07, from: 'random' },
          },
          0.85,
        )
      }
    }

    if (heroOrnaments.length) {
      intro.fromTo(
        heroOrnaments,
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 },
        0.75,
      )
    }

    return intro
  }

  /* ———— 氛围常驻动画 ———— */

  function setupAmbient(el) {
    const atmosphere = el.querySelector('.home-atmosphere')
    const orbitOne = el.querySelector('.home-orbit__ring.is-one')
    const orbitTwo = el.querySelector('.home-orbit__ring.is-two')
    const sparks = el.querySelectorAll('.home-spark')
    const godrays = el.querySelectorAll('.home-godray')

    if (atmosphere) {
      gsap.to(atmosphere, {
        scale: 1.07,
        rotation: 1.4,
        transformOrigin: '55% 30%',
        duration: 7,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      })
    }
    if (orbitOne) gsap.to(orbitOne, { rotation: 360, duration: 42, ease: 'none', repeat: -1 })
    if (orbitTwo) gsap.to(orbitTwo, { rotation: -360, duration: 58, ease: 'none', repeat: -1 })
    if (sparks.length) {
      gsap.to(sparks, {
        autoAlpha: 1,
        scale: 1.7,
        duration: 1.7,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.22, from: 'random' },
      })
    }
    godrays.forEach((ray, index) => {
      gsap.to(ray, {
        rotation: index % 2 ? 3.6 : -3,
        xPercent: index % 2 ? 5 : -4,
        transformOrigin: 'top center',
        duration: 10 + index * 3.5,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      })
    })
  }

  /* ———— 指针：视差 / 聚光灯 / 卡片 3D tilt / 星幕联动 ———— */

  function setupPointer(el) {
    motionMedia = gsap.matchMedia()
    motionMedia.add(
      {
        isDesktop: '(min-width: 900px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        if (
          !context.conditions.isDesktop ||
          context.conditions.reduceMotion ||
          shouldReduceMotion()
        )
          return undefined
        const wall = el.querySelector('.home-hero__wall')
        const atmosphere = el.querySelector('.home-atmosphere')
        const cursor = el.querySelector('.home-cursor')
        if (!atmosphere || !cursor) return undefined

        const wallX = wall ? gsap.quickTo(wall, 'x', { duration: 0.7, ease: 'power3.out' }) : null
        const wallY = wall ? gsap.quickTo(wall, 'y', { duration: 0.7, ease: 'power3.out' }) : null
        const skyX = gsap.quickTo(atmosphere, 'x', { duration: 1.2, ease: 'power2.out' })
        const skyY = gsap.quickTo(atmosphere, 'y', { duration: 1.2, ease: 'power2.out' })
        const cursorX = gsap.quickTo(cursor, 'x', { duration: 0.46, ease: 'power3.out' })
        const cursorY = gsap.quickTo(cursor, 'y', { duration: 0.46, ease: 'power3.out' })
        const cursorAlpha = gsap.quickTo(cursor, 'autoAlpha', {
          duration: 0.28,
          ease: 'power2.out',
        })
        const cursorScale = gsap.quickTo(cursor, 'scale', { duration: 0.35, ease: 'power3.out' })
        const spotX = gsap.quickTo(el, '--spot-x', {
          duration: 0.55,
          ease: 'power2.out',
          unit: 'px',
        })
        const spotY = gsap.quickTo(el, '--spot-y', {
          duration: 0.55,
          ease: 'power2.out',
          unit: 'px',
        })

        let auraCard = null
        let auraX = null
        let auraY = null
        let tiltX = null
        let tiltY = null

        const releaseCard = () => {
          if (!auraCard) return
          auraCard.classList.remove('is-pointer-lit')
          gsap.to(auraCard, {
            rotationX: 0,
            rotationY: 0,
            duration: 0.5,
            ease: 'power2.out',
            overwrite: 'auto',
          })
          auraCard = null
          auraX = null
          auraY = null
          tiltX = null
          tiltY = null
        }

        const move = (event) => {
          const nx = event.clientX / window.innerWidth - 0.5
          const ny = event.clientY / window.innerHeight - 0.5
          wallX?.(nx * 14)
          wallY?.(ny * 10)
          skyX(nx * -20)
          skyY(ny * -13)
          cursorX(event.clientX)
          cursorY(event.clientY)
          cursorAlpha(1)
          cursorScale(1)
          spotX(event.clientX)
          spotY(event.clientY)
          scene()?.setPointer(nx * 2, ny * 2)

          const nextCard = event.target.closest(
            '.home-studio-card, .home-community-card, .home-work-card, .home-hero__cell',
          )
          if (nextCard && el.contains(nextCard)) {
            if (nextCard !== auraCard) {
              releaseCard()
              auraCard = nextCard
              auraCard.classList.add('is-pointer-lit')
              gsap.set(auraCard, { transformPerspective: 760 })
              auraX = gsap.quickTo(auraCard, '--card-x', { duration: 0.32, ease: 'power2.out' })
              auraY = gsap.quickTo(auraCard, '--card-y', { duration: 0.32, ease: 'power2.out' })
              tiltX = gsap.quickTo(auraCard, 'rotationX', { duration: 0.5, ease: 'power2.out' })
              tiltY = gsap.quickTo(auraCard, 'rotationY', { duration: 0.5, ease: 'power2.out' })
            }
            const rect = auraCard.getBoundingClientRect()
            const px = (event.clientX - rect.left) / rect.width
            const py = (event.clientY - rect.top) / rect.height
            auraX(px * 100)
            auraY(py * 100)
            const strength = auraCard.classList.contains('home-studio-card') ? 7 : 5
            tiltX((0.5 - py) * strength)
            tiltY((px - 0.5) * strength)
          } else if (auraCard) {
            releaseCard()
          }
        }

        const leave = () => {
          wallX?.(0)
          wallY?.(0)
          skyX(0)
          skyY(0)
          cursorAlpha(0)
          cursorScale(0.7)
          scene()?.setPointer(0, 0)
          releaseCard()
        }

        el.addEventListener('pointermove', move, { passive: true })
        el.addEventListener('pointerleave', leave, { passive: true })
        removePointerHandlers = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerleave', leave)
        }
        return () => {
          removePointerHandlers?.()
          removePointerHandlers = null
        }
      },
      el,
    )
  }

  /* ———— anime.js 微交互 ———— */

  function countUpStats() {
    const el = root()
    if (!el) return
    const items = el.querySelectorAll('.home-stats dd')
    items.forEach((node) => {
      if (node.dataset.counted === 'true') return
      const finalText = node.textContent.trim()
      const match = finalText.match(/^(\d+(?:\.\d+)?)(.*)$/)
      if (!match) return
      node.dataset.counted = 'true'
      if (shouldReduceMotion()) return
      const target = Number.parseFloat(match[1])
      const suffix = match[2] || ''
      const decimals = (match[1].split('.')[1] || '').length
      const proxy = { value: 0 }
      animeAnimate(proxy, {
        value: target,
        duration: 1500,
        ease: 'outQuart',
        onUpdate: () => {
          node.textContent = `${proxy.value.toFixed(decimals)}${suffix}`
        },
        onComplete: () => {
          node.textContent = finalText
        },
      })
    })
  }

  function scrambleSeed() {
    const el = root()
    if (!el || shouldReduceMotion()) return
    const node = el.querySelector('.home-random__seed')
    if (!node) return
    const finalText = node.textContent
    const glyphs = 'abcdef0123456789'
    const proxy = { t: 0 }
    animeAnimate(proxy, {
      t: 1,
      duration: 700,
      ease: 'outCubic',
      onUpdate: () => {
        const keep = Math.floor(finalText.length * proxy.t)
        let out = finalText.slice(0, keep)
        for (let i = keep; i < finalText.length; i += 1) {
          const char = finalText[i]
          out += /[a-z0-9]/i.test(char) ? glyphs[Math.floor(Math.random() * glyphs.length)] : char
        }
        node.textContent = out
      },
      onComplete: () => {
        node.textContent = finalText
      },
    })
  }

  function popButton(target) {
    if (!target || shouldReduceMotion()) return
    animeAnimate(target, {
      scale: [
        { to: 0.93, duration: 110, ease: 'inQuad' },
        { to: 1.04, duration: 160, ease: 'outQuad' },
        { to: 1, duration: 160, ease: 'outQuad' },
      ],
    })
  }

  /* ———— 网格刷新动画 ———— */

  function animateGridRefresh(selector) {
    const el = root()
    if (!el || shouldReduceMotion()) return
    const cards = el.querySelectorAll(`${selector} .home-work-card`)
    if (!cards.length) return
    gsap.fromTo(
      cards,
      { autoAlpha: 0, y: 28, scale: 0.93 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.65,
        ease: 'back.out(1.2)',
        stagger: { amount: Math.min(0.42, cards.length * 0.045), from: 'random' },
        clearProps: 'transform,visibility',
        overwrite: 'auto',
      },
    )
  }

  function refreshTriggers() {
    requestAnimationFrame(() => ScrollTrigger.refresh())
  }

  /* ———— 生命周期 ———— */

  function setup() {
    const el = root()
    if (!el) return

    if (shouldReduceMotion()) {
      const nodes = el.querySelectorAll('[data-home-reveal]')
      nodes.forEach((node) => {
        node.dataset.motionTracked = 'true'
        node.classList.add('is-revealed')
      })
      gsap.set(nodes, { autoAlpha: 1, y: 0, clearProps: 'transform,visibility' })
      return
    }

    ctx = gsap.context(() => {
      const introTl = setupIntro(el)
      setupAmbient(el)
      setupHeroExit(el, introTl)
      setupScrollScene(el)
      setupMarquees(el)
      setupVelocity()
    }, el)

    observeNewReveals()
    attachDepthLayers()
    setupPointer(el)
  }

  onMounted(() => {
    requestAnimationFrame(() => setup())
  })

  onBeforeUnmount(() => {
    motionMedia?.revert()
    motionMedia = null
    ctx?.revert()
    ctx = null
    removePointerHandlers?.()
    removePointerHandlers = null
    activeHall = null
    skewTargets = []
    skewSetter = null
    marqueeTweens = []
  })

  return {
    observeNewReveals,
    animateNewHeroCells,
    animateGridRefresh,
    refreshTriggers,
    countUpStats,
    scrambleSeed,
    popButton,
  }
}
