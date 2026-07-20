/** 十二宫名（排盘顺序） */
export const ZW_CINE_PALACES = [
  '命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄',
  '迁移', '仆役', '官禄', '田宅', '福德', '父母',
]

/** 十四主星 */
export const ZW_CINE_MAIN_STARS = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞',
  '天府', '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
]

/** 四化 */
export const ZW_CINE_SIHUA = [
  { id: 'lu', label: '禄', cls: 'zw-cine__sihua--lu' },
  { id: 'quan', label: '权', cls: 'zw-cine__sihua--quan' },
  { id: 'ke', label: '科', cls: 'zw-cine__sihua--ke' },
  { id: 'ji', label: '忌', cls: 'zw-cine__sihua--ji' },
]

/** 排盘演算步骤（2s 内逐步展示） */
export const ZW_CINE_PAIPAN_STEPS = [
  { key: 'ming', text: '定命宫 · 安十二宫' },
  { key: 'ziwei', text: '起紫微 · 布十四主星' },
  { key: 'minor', text: '安辅弼 · 昌曲魁钺' },
  { key: 'sihua', text: '起四化 · 禄权科忌' },
  { key: 'wuxing', text: '纳甲定局 · 五行局' },
  { key: 'yun', text: '汇运限 · 大限流年' },
]

/**
 * 命盘线框格 — 与正式命盘同型（四边十二宫 + 中宫）
 * gridArea: CSS grid 1-based placement
 */
export const ZW_CINE_CHART_CELLS = [
  { id: 'si', branch: '巳', palace: '巳宫', gridArea: '1 / 1' },
  { id: 'wu', branch: '午', palace: '午宫', gridArea: '1 / 2' },
  { id: 'wei', branch: '未', palace: '未宫', gridArea: '1 / 3' },
  { id: 'shen', branch: '申', palace: '申宫', gridArea: '1 / 4' },
  { id: 'chen', branch: '辰', palace: '辰宫', gridArea: '2 / 1' },
  { id: 'you', branch: '酉', palace: '酉宫', gridArea: '2 / 4' },
  { id: 'mao', branch: '卯', palace: '卯宫', gridArea: '3 / 1' },
  { id: 'xu', branch: '戌', palace: '戌宫', gridArea: '3 / 4' },
  { id: 'yin', branch: '寅', palace: '寅宫', gridArea: '4 / 1' },
  { id: 'chou', branch: '丑', palace: '丑宫', gridArea: '4 / 2' },
  { id: 'zi', branch: '子', palace: '子宫', gridArea: '4 / 3' },
  { id: 'hai', branch: '亥', palace: '亥宫', gridArea: '4 / 4' },
]

export const ZW_CINE_GLYPHS = [
  '甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸',
  '子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥',
  ...ZW_CINE_MAIN_STARS,
  '禄存', '化禄', '化权', '化科', '化忌',
]

/** @returns {{ id: number, text: string, x: number, y: number, rot: number, size: number }[]} */
export function buildGlyphField(count = 36) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    text: ZW_CINE_GLYPHS[i % ZW_CINE_GLYPHS.length],
    x: (Math.random() - 0.5) * 92,
    y: (Math.random() - 0.5) * 78,
    rot: (Math.random() - 0.5) * 40,
    size: 0.55 + Math.random() * 0.75,
  }))
}
