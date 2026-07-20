/** 十二宫空间位置（与传统命盘一致，无边框） */
const SLOT_NORM = {
  si: { nx: 0.133, ny: 0.138 },
  wu: { nx: 0.378, ny: 0.138 },
  wei: { nx: 0.622, ny: 0.138 },
  shen: { nx: 0.867, ny: 0.138 },
  chen: { nx: 0.133, ny: 0.379 },
  you: { nx: 0.867, ny: 0.379 },
  mao: { nx: 0.133, ny: 0.621 },
  xu: { nx: 0.867, ny: 0.621 },
  yin: { nx: 0.133, ny: 0.862 },
  chou: { nx: 0.378, ny: 0.862 },
  zi: { nx: 0.622, ny: 0.862 },
  hai: { nx: 0.867, ny: 0.862 },
}

function mapStar(star, group) {
  return {
    name: star.name || '',
    mutagen: star.mutagen || '',
    brightness: star.brightness || '',
    type: star.type || '',
    group,
  }
}

function horoscopeStarsForPalace(horoscope, palaceIndex, includeHourly = false) {
  if (!horoscope) return []
  const items = [horoscope.decadal, horoscope.yearly, horoscope.monthly, horoscope.daily]
  if (includeHourly) items.push(horoscope.hourly)
  return items
    .flatMap((item) => item?.stars?.[palaceIndex] || [])
    .map((s) => mapStar(s, 'horoscope'))
}

function horoscopeBadgesForPalace(horoscope, palaceIndex, scopes, includeHourly) {
  if (!horoscope) return []
  return scopes
    .filter(([scope]) => scope !== 'hourly' || includeHourly)
    .map(([scope, label, color]) => {
      const item = horoscope[scope]
      return item?.index === palaceIndex
        ? { label: `${label}·${item.heavenlyStem || ''}${item.earthlyBranch || ''}`, color }
        : null
    })
    .filter(Boolean)
}

/**
 * @param {import('iztro').FunctionalAstrolabe | null} chart
 * @param {{ palaceAreas?: Record<number, string>, horoscope?: object | null, horoscopeScopes?: Array, includeHourly?: boolean }} opts
 */
export function buildStarfieldModel(chart, opts = {}) {
  if (!chart?.palaces?.length) return null

  const { palaceAreas = {}, horoscope = null, horoscopeScopes = [], includeHourly = false } = opts

  const palaces = chart.palaces.map((palace) => {
    const area = palaceAreas[palace.index] || 'si'
    const slot = SLOT_NORM[area] || SLOT_NORM.si

    return {
      index: palace.index,
      name: palace.name,
      branch: palace.earthlyBranch || '',
      stem: palace.heavenlyStem || '',
      nx: slot.nx,
      ny: slot.ny,
      majorStars: (palace.majorStars || []).map((s) => mapStar(s, 'major')),
      minorStars: (palace.minorStars || []).map((s) => mapStar(s, 'minor')),
      adjectiveStars: (palace.adjectiveStars || []).map((s) => mapStar(s, 'adjective')),
      horoscopeStars: horoscopeStarsForPalace(horoscope, palace.index, includeHourly),
      badges: horoscopeBadgesForPalace(horoscope, palace.index, horoscopeScopes, includeHourly),
      ages: palace.ages || [],
      decadal: palace.decadal?.range
        ? `${palace.decadal.range[0]} - ${palace.decadal.range[1]}`
        : '',
      changsheng12: palace.changsheng12 || '',
      boshi12: palace.boshi12 || '',
      jiangqian12: palace.jiangqian12 || '',
      suiqian12: palace.suiqian12 || '',
      isBody: palace.isBodyPalace,
      isOriginal: palace.isOriginalPalace,
      isMing: palace.name === '命宫',
    }
  })

  const h = horoscope
  return {
    center: {
      nx: 0.5,
      ny: 0.5,
      wuxing: chart.fiveElementsClass || '',
      soul: chart.soul || '',
      body: chart.body || '',
      zodiac: chart.zodiac || '',
      chineseDate: chart.chineseDate || '',
      lunarDate: chart.lunarDate || '',
      solarDate: chart.solarDate || '',
      time: chart.time || '',
      timeRange: chart.timeRange || '',
      sign: chart.sign || '',
      soulBranch: chart.earthlyBranchOfSoulPalace || '',
      bodyBranch: chart.earthlyBranchOfBodyPalace || '',
      horoscope: h
        ? {
            lunarDate: h.lunarDate || '',
            solarDate: h.solarDate || '',
            decadal: h.decadal?.name || '',
            age: h.age?.name || '',
            yearly: h.yearly?.name || '',
            monthly: h.monthly?.name || '',
            daily: h.daily?.name || '',
          }
        : null,
    },
    palaces,
  }
}

/** @param {import('iztro').FunctionalAstrolabe} chart @param {number} palaceIndex */
export function getStarfieldRelationIndices(chart, palaceIndex) {
  if (!chart?.palaces) return []
  const palace = chart.palaces.find((p) => p.index === palaceIndex)
  if (!palace) return [palaceIndex]
  try {
    const rel = chart.surroundedPalaces(palace.name)
    return [rel.target, rel.opposite, rel.wealth, rel.career]
      .filter(Boolean)
      .map((p) => p.index)
  } catch {
    return [palaceIndex]
  }
}

/** 三阶段流线：以指定宫位为 hub 的三方四正连线 */
export function buildStarfieldFlowPlan(chart, palaceIndex = null) {
  const empty = { hubIndex: null, hubName: '', sfszPalaceIndices: [], sfszLinks: [], sfszRingLinks: [], radialIndices: [] }
  if (!chart?.palaces?.length) return empty

  const hub =
    (palaceIndex != null ? chart.palaces.find((p) => p.index === palaceIndex) : null) ||
    chart.palaces.find((p) => p.name === '命宫') ||
    chart.palaces[0]
  if (!hub) return empty

  let sfszLinks = []
  let sfszRingLinks = []
  const sfszPalaceIndices = new Set([hub.index])

  try {
    const rel = chart.surroundedPalaces(hub.name)
    if (rel?.target) sfszPalaceIndices.add(rel.target.index)
    if (rel?.opposite) {
      sfszPalaceIndices.add(rel.opposite.index)
      sfszLinks.push({ role: 'opposite', fromIndex: hub.index, toIndex: rel.opposite.index })
    }
    if (rel?.wealth) {
      sfszPalaceIndices.add(rel.wealth.index)
      sfszLinks.push({ role: 'wealth', fromIndex: hub.index, toIndex: rel.wealth.index })
    }
    if (rel?.career) {
      sfszPalaceIndices.add(rel.career.index)
      sfszLinks.push({ role: 'career', fromIndex: hub.index, toIndex: rel.career.index })
    }
    // 只保留三合两宫之间的连线；不画经对宫绕行的两条边（易误连到兄弟、子女等外围宫位）
    if (rel?.wealth && rel?.career) {
      sfszRingLinks = [{ fromIndex: rel.wealth.index, toIndex: rel.career.index, role: 'trine' }]
    }
  } catch {
    /* keep hub only */
  }

  return {
    hubIndex: hub.index,
    hubName: hub.name,
    sfszPalaceIndices: [...sfszPalaceIndices],
    sfszLinks,
    sfszRingLinks,
    radialIndices: [],
  }
}

export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2
}
