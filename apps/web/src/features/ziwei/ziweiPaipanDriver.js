import {
  ZW_CINE_CHART_CELLS,
  ZW_CINE_MAIN_STARS,
  ZW_CINE_PALACES,
  ZW_CINE_SIHUA,
} from './ziweiCinematicData'

export const BRANCH_TO_CELL = {
  巳: 'si',
  午: 'wu',
  未: 'wei',
  申: 'shen',
  辰: 'chen',
  酉: 'you',
  卯: 'mao',
  戌: 'xu',
  寅: 'yin',
  丑: 'chou',
  子: 'zi',
  亥: 'hai',
}

const MINOR_GROUPS = [
  { stars: ['左辅', '右弼'], label: '辅弼' },
  { stars: ['文昌', '文曲'], label: '昌曲' },
  { stars: ['天魁', '天钺'], label: '魁钺' },
  { stars: ['禄存', '天马'], label: '禄马' },
  { stars: ['擎羊', '陀罗'], label: '羊陀' },
  { stars: ['火星', '铃星'], label: '火铃' },
]

export function cellIdToIndex(cellId) {
  return ZW_CINE_CHART_CELLS.findIndex((cell) => cell.id === cellId)
}

export function sortPalacesByName(palaces) {
  return [...palaces].sort((a, b) => {
    const ai = ZW_CINE_PALACES.indexOf(a.name)
    const bi = ZW_CINE_PALACES.indexOf(b.name)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function findStarPalace(palaces, starName) {
  return palaces.find((palace) =>
    [...(palace.majorStars || []), ...(palace.minorStars || []), ...(palace.adjectiveStars || [])].some(
      (star) => star.name === starName,
    ),
  )
}

function collectMutagenSteps(palaces) {
  const steps = []
  palaces.forEach((palace) => {
    ;[...(palace.majorStars || []), ...(palace.minorStars || [])].forEach((star) => {
      if (!star.mutagen) return
      steps.push({
        phase: 'sihua',
        cellId: BRANCH_TO_CELL[palace.earthlyBranch],
        text: `${star.name}化${star.mutagen}`,
        sub: `${palace.name}${palace.heavenlyStem || ''}${palace.earthlyBranch || ''}`,
        mutagen: star.mutagen,
        starName: star.name,
        palaceName: palace.name,
      })
    })
  })
  return steps
}

/** @param {import('iztro').FunctionalAstrolabe | null} chart */
export function buildPaipanMicroSteps(chart) {
  const steps = []
  const palaces = chart?.palaces ? sortPalacesByName(chart.palaces) : null

  if (palaces) {
    palaces.forEach((palace, i) => {
      const branch = `${palace.heavenlyStem || ''}${palace.earthlyBranch || ''}`
      steps.push({
        phase: 'palace',
        cellId: BRANCH_TO_CELL[palace.earthlyBranch],
        palaceIndex: i,
        text: `安${palace.name}`,
        sub: `${branch} · ${i + 1}/12 宫`,
        palaceName: palace.name,
        branch,
        isMing: palace.name === '命宫',
        isBody: palace.isBodyPalace,
        isOriginal: palace.isOriginalPalace,
      })
    })
  } else {
    ZW_CINE_PALACES.forEach((name, i) => {
      steps.push({
        phase: 'palace',
        cellId: ZW_CINE_CHART_CELLS[i]?.id,
        palaceIndex: i,
        text: `安${name}`,
        sub: `布宫 ${i + 1}/12`,
        palaceName: name,
        isMing: name === '命宫',
      })
    })
  }

  if (palaces) {
    palaces.forEach((palace) => {
      ;(palace.majorStars || []).forEach((star) => {
        steps.push({
          phase: 'major',
          cellId: BRANCH_TO_CELL[palace.earthlyBranch],
          text: `${star.name}入${palace.name}`,
          sub: star.brightness ? `${star.brightness}地` : '主星',
          starName: star.name,
          palaceName: palace.name,
          brightness: star.brightness,
        })
      })
    })
  } else {
    ZW_CINE_MAIN_STARS.forEach((star, i) => {
      steps.push({
        phase: 'major',
        cellId: ZW_CINE_CHART_CELLS[i % 12].id,
        text: `布${star}`,
        sub: `主星 ${i + 1}/14`,
        starName: star,
      })
    })
  }

  MINOR_GROUPS.forEach((group) => {
    steps.push({ phase: 'minor-batch', text: `安${group.label}`, sub: group.stars.join(' · ') })
    if (palaces) {
      group.stars.forEach((starName) => {
        const palace = findStarPalace(palaces, starName)
        if (!palace) return
        steps.push({
          phase: 'minor',
          cellId: BRANCH_TO_CELL[palace.earthlyBranch],
          text: `${starName} → ${palace.name}`,
          sub: group.label,
          starName,
          palaceName: palace.name,
        })
      })
    }
  })

  if (palaces) {
    steps.push(...collectMutagenSteps(palaces))
  } else {
    ZW_CINE_SIHUA.forEach((item) => {
      steps.push({
        phase: 'sihua',
        text: `起化${item.label}`,
        sub: '四化飞星',
        mutagen: item.label,
      })
    })
  }

  if (chart) {
    ;[
      { key: 'wuxing', label: '五行局', value: chart.fiveElementsClass },
      { key: 'soul', label: '命主', value: chart.soul },
      { key: 'body', label: '身主', value: chart.body },
      { key: 'zodiac', label: '生肖', value: chart.zodiac },
      { key: 'date', label: '生辰', value: chart.chineseDate || chart.solarDate },
      { key: 'time', label: '时辰', value: chart.time ? `${chart.time}（${chart.timeRange || ''}）` : '' },
    ]
      .filter((field) => field.value)
      .forEach((field) => {
        steps.push({
          phase: 'center',
          field: field.key,
          text: field.label,
          sub: String(field.value),
          value: String(field.value),
        })
      })
  } else {
    steps.push({ phase: 'center', field: 'wuxing', text: '纳甲定局', sub: '五行局' })
  }

  if (palaces) {
    palaces.forEach((palace) => {
      if (!palace.decadal?.range) return
      steps.push({
        phase: 'decadal',
        cellId: BRANCH_TO_CELL[palace.earthlyBranch],
        text: `${palace.name}大限`,
        sub: `${palace.decadal.range[0]}-${palace.decadal.range[1]}岁`,
        palaceName: palace.name,
      })
    })
  }

  steps.push({ phase: 'finish', text: '命盘汇整', sub: '十二宫星曜齐备' })
  return steps
}

const PHASE_WEIGHT = {
  palace: 1.15,
  major: 0.72,
  minor: 0.48,
  'minor-batch': 0.55,
  sihua: 0.85,
  center: 0.95,
  decadal: 0.42,
  finish: 1.1,
}

/** 按权重分配 2s 内每一步的触发时刻 */
export function schedulePaipanSteps(steps, durationMs = 2000) {
  if (!steps.length) return []
  const weights = steps.map((step) => PHASE_WEIGHT[step.phase] || 0.5)
  const total = weights.reduce((sum, w) => sum + w, 0)
  let acc = 0
  return steps.map((step, index) => {
    const at = (acc / total) * durationMs
    acc += weights[index]
    return { ...step, at, index, total: steps.length }
  })
}

export function summarizeCellStars(palace) {
  if (!palace) return { major: '', minor: '' }
  const major = (palace.majorStars || []).map((s) => s.name).join(' ')
  const minor = (palace.minorStars || [])
    .slice(0, 4)
    .map((s) => s.name)
    .join(' ')
  return { major, minor }
}
