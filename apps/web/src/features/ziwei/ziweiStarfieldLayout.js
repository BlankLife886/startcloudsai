function starText(star) {
  if (!star?.name) return ''
  let t = star.name
  if (star.mutagen) t += star.mutagen
  if (star.brightness) t += `·${star.brightness}`
  return t
}

function measure(ctx, text, font) {
  ctx.font = font
  return ctx.measureText(text).width
}

function addTextHit(hits, node, pad = 4) {
  hits.push({
    type: node.hitType || 'star',
    palaceIndex: node.palaceIndex,
    starName: node.starName,
    group: node.group,
    metaKey: node.metaKey,
    metaLabel: node.metaLabel,
    metaValue: node.metaValue,
    centerKey: node.centerKey,
    x: node.x - (node.align === 'center' ? node.w / 2 : node.align === 'right' ? node.w : 0) - pad,
    y: node.y - node.fontSize - pad,
    w: node.w + pad * 2,
    h: node.fontSize + pad * 2,
  })
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} model
 * @param {number} w
 * @param {number} h
 */
export function buildStarfieldLayout(ctx, model, w, h) {
  const padX = w * 0.02
  const padY = h * 0.02
  const scale = Math.min(w, h) / 920
  const nodes = []
  const hits = []

  function screen(nx, ny) {
    return {
      x: padX + nx * (w - padX * 2),
      y: padY + ny * (h - padY * 2),
    }
  }

  function pushText(opts) {
    const fontSize = opts.fontSize ?? 12 * scale
    const font = `${opts.fontWeight ?? 750} ${fontSize}px PingFang SC, system-ui, sans-serif`
    const text = opts.text || ''
    const textW = measure(ctx, text, font)
    const node = {
      kind: 'text',
      text,
      x: opts.x,
      y: opts.y,
      align: opts.align || 'left',
      font,
      fontSize,
      fill: opts.fill,
      shadow: opts.shadow,
      glow: opts.glow,
      palaceIndex: opts.palaceIndex,
      starName: opts.starName,
      group: opts.group,
      hitType: opts.hitType,
      metaKey: opts.metaKey,
      metaLabel: opts.metaLabel,
      metaValue: opts.metaValue,
      centerKey: opts.centerKey,
      w: textW,
    }
    nodes.push(node)
    if (opts.hit !== false) addTextHit(hits, node, opts.hitPad ?? 5)
    return node
  }

  for (const palace of model.palaces) {
    const { x: cx, y: cy } = screen(palace.nx, palace.ny)
    const leftX = cx - 58 * scale
    const rightX = cx + 58 * scale
    let yLeft = cy - 52 * scale
    let yRight = cy - 44 * scale

    palace.majorStars.forEach((star) => {
      pushText({
        text: starText(star),
        x: leftX,
        y: yLeft,
        align: 'left',
        fontSize: 13.5 * scale,
        fontWeight: 850,
        fill: 'rgba(251, 191, 36, 0.92)',
        shadow: 'rgba(251, 191, 36, 0.5)',
        palaceIndex: palace.index,
        starName: star.name,
        group: 'major',
        hitType: 'star',
      })
      yLeft += 15.5 * scale
    })

    palace.adjectiveStars.forEach((star) => {
      pushText({
        text: starText(star),
        x: rightX,
        y: yRight,
        align: 'left',
        fontSize: 11 * scale,
        fontWeight: 720,
        fill: 'rgba(139, 152, 170, 0.82)',
        palaceIndex: palace.index,
        starName: star.name,
        group: 'adjective',
        hitType: 'star',
      })
      yRight += 13 * scale
    })

    const branchName = `${palace.stem}${palace.branch} ${palace.name}`
    pushText({
      text: branchName,
      x: cx,
      y: cy - 4 * scale,
      align: 'center',
      fontSize: 14 * scale,
      fontWeight: 900,
      fill: 'rgba(255, 255, 255, 0.88)',
      shadow: 'rgba(160, 139, 255, 0.25)',
      palaceIndex: palace.index,
      hitType: 'palace',
    })

    if (palace.decadal) {
      pushText({
        text: palace.decadal,
        x: cx,
        y: cy + 14 * scale,
        align: 'center',
        fontSize: 11.5 * scale,
        fontWeight: 850,
        fill: 'rgba(160, 139, 255, 0.78)',
        palaceIndex: palace.index,
        metaKey: 'decadal',
        metaLabel: '大限',
        metaValue: palace.decadal,
        hitType: 'meta',
      })
    }

    if (palace.minorStars.length) {
      const minorLine = palace.minorStars.map(starText).join(' ')
      pushText({
        text: minorLine,
        x: cx,
        y: cy + 30 * scale,
        align: 'center',
        fontSize: 10.5 * scale,
        fontWeight: 750,
        fill: 'rgba(180, 255, 158, 0.72)',
        palaceIndex: palace.index,
        hitType: 'meta',
        metaKey: 'minor',
        metaLabel: '辅星',
        metaValue: minorLine,
      })
    }

    const metaLine = [palace.changsheng12, palace.boshi12, palace.jiangqian12, palace.suiqian12]
      .filter(Boolean)
      .join(' · ')
    if (metaLine) {
      pushText({
        text: metaLine,
        x: cx,
        y: cy + 44 * scale,
        align: 'center',
        fontSize: 9.5 * scale,
        fontWeight: 720,
        fill: 'rgba(255, 255, 255, 0.42)',
        palaceIndex: palace.index,
        hitType: 'meta',
        metaKey: 'shensha',
        metaLabel: '神煞',
        metaValue: metaLine,
      })
    }

    if (palace.ages.length) {
      const agesText = palace.ages.join(' ')
      pushText({
        text: agesText,
        x: cx,
        y: cy + 58 * scale,
        align: 'center',
        fontSize: 9 * scale,
        fontWeight: 700,
        fill: 'rgba(119, 135, 159, 0.88)',
        palaceIndex: palace.index,
        hitType: 'meta',
        metaKey: 'ages',
        metaLabel: '小限年龄',
        metaValue: agesText,
      })
    }

    if (palace.horoscopeStars.length) {
      const horoText = palace.horoscopeStars.map(starText).join(' ')
      pushText({
        text: horoText,
        x: cx,
        y: cy + 72 * scale,
        align: 'center',
        fontSize: 10 * scale,
        fontWeight: 750,
        fill: 'rgba(139, 116, 240, 0.85)',
        palaceIndex: palace.index,
        hitType: 'meta',
        metaKey: 'horoscope',
        metaLabel: '流曜',
        metaValue: horoText,
      })
    }

    palace.badges.forEach((badge, i) => {
      pushText({
        text: badge.label,
        x: cx + (i % 2 === 0 ? -52 : 52) * scale,
        y: cy - 18 * scale + Math.floor(i / 2) * 14 * scale,
        align: 'center',
        fontSize: 9 * scale,
        fontWeight: 850,
        fill: 'rgba(139, 116, 240, 0.9)',
        palaceIndex: palace.index,
        hitType: 'meta',
        metaKey: 'badge',
        metaLabel: '运限',
        metaValue: badge.label,
      })
    })

    const marks = [palace.isBody ? '身宫' : '', palace.isOriginal ? '来因' : ''].filter(Boolean)
    marks.forEach((mark, i) => {
      pushText({
        text: mark,
        x: cx + 38 * scale,
        y: cy + 8 * scale + i * 13 * scale,
        align: 'left',
        fontSize: 9.5 * scale,
        fontWeight: 850,
        fill: 'rgba(76, 195, 138, 0.9)',
        palaceIndex: palace.index,
        hitType: 'meta',
        metaKey: mark,
        metaLabel: mark,
        metaValue: `${palace.name}${mark}`,
      })
    })

    hits.push({
      type: 'palace',
      palaceIndex: palace.index,
      x: cx - 68 * scale,
      y: cy - 58 * scale,
      w: 136 * scale,
      h: 140 * scale,
    })
  }

  const c = model.center
  const { x: ccx, y: ccy } = screen(c.nx, c.ny)
  const centerRows = [
    { key: 'wuxing', label: '五行局', value: c.wuxing, y: -36, size: 16, fill: 'rgba(160, 139, 255, 0.85)' },
    { key: 'soul', label: '命主', value: `命主 ${c.soul} · 身主 ${c.body}`, y: -14, size: 12, fill: 'rgba(255,255,255,0.55)' },
    { key: 'sizhu', label: '四柱', value: c.chineseDate, y: 8, size: 11, fill: 'rgba(255,255,255,0.45)' },
    { key: 'lunar', label: '农历', value: c.lunarDate, y: 24, size: 10.5, fill: 'rgba(255,255,255,0.38)' },
    { key: 'solar', label: '阳历', value: `${c.solarDate} ${c.time}${c.timeRange ? `(${c.timeRange})` : ''}`, y: 40, size: 10, fill: 'rgba(255,255,255,0.36)' },
    { key: 'zodiac', label: '生肖星座', value: `${c.zodiac} · ${c.sign}`, y: 56, size: 10, fill: 'rgba(255,255,255,0.36)' },
    { key: 'ming', label: '命宫身宫', value: `命宫${c.soulBranch} · 身宫${c.bodyBranch}`, y: 72, size: 10, fill: 'rgba(160, 139, 255,0.42)' },
  ]

  if (c.horoscope) {
    centerRows.push(
      { key: 'limit', label: '运限', value: `大限${c.horoscope.decadal} · 流年${c.horoscope.yearly}`, y: 92, size: 9.5, fill: 'rgba(139, 116, 240,0.72)' },
      { key: 'flow', label: '流月流日', value: `流月${c.horoscope.monthly} · 流日${c.horoscope.daily}`, y: 108, size: 9.5, fill: 'rgba(139, 116, 240,0.65)' },
    )
  }

  centerRows.forEach((row) => {
    if (!row.value) return
    pushText({
      text: row.value,
      x: ccx,
      y: ccy + row.y * scale,
      align: 'center',
      fontSize: row.size * scale,
      fontWeight: row.key === 'wuxing' ? 900 : 750,
      fill: row.fill,
      shadow: row.key === 'wuxing' ? 'rgba(160, 139, 255,0.35)' : undefined,
      centerKey: row.key,
      hitType: 'center',
      metaLabel: row.label,
      metaValue: row.value,
    })
  })

  hits.push({ type: 'center', centerKey: 'center', x: ccx - 90 * scale, y: ccy - 50 * scale, w: 180 * scale, h: 170 * scale })

  return { nodes, hits, scale, padX, padY }
}

/** @param {Array} hits @param {number} x @param {number} y */
export function pickStarfieldHit(hits, x, y) {
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const h = hits[i]
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      return h
    }
  }
  return null
}

export { starText }
