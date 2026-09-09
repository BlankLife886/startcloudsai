/** echarts 统一配色：霓虹绿主序列 + 令牌化 tooltip / 轴线样式 */
import { isDark } from '@/theme'

export const CHART_COLORS = [
  '#b6ff00',
  '#fb923c',
  '#38bdf8',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#94a3b8',
] as const

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** #rrggbb → rgba(...)，非法值原样兜底为主色 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return `rgba(182, 255, 0, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`
}

/**
 * 图表基础样式。内部读取 isDark，使调用方的 computed 在主题切换时自动重算。
 */
export function chartBase() {
  void isDark.value
  const border = token('--border')
  const ink2 = token('--ink-2')
  const ink3 = token('--ink-3')
  const surface = token('--surface')
  const accent = token('--accent') || CHART_COLORS[0]
  return {
    color: [accent, ...CHART_COLORS.slice(1)],
    /** 折线图面积填充：主题色低透明度（跟随明暗主题的 --accent） */
    areaStyle: {
      color: {
        type: 'linear' as const,
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: withAlpha(accent, isDark.value ? 0.28 : 0.22) },
          { offset: 1, color: withAlpha(accent, 0.02) },
        ],
      },
    },
    lineStyle: { width: 2.5 },
    tooltip: {
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      padding: [10, 14] as [number, number],
      textStyle: { color: token('--ink'), fontSize: 12 },
      extraCssText:
        'border-radius:16px;box-shadow:0 4px 16px rgb(0 0 0 / .28);backdrop-filter:blur(8px);',
    },
    legendText: { color: ink2, fontSize: 12 },
    axisLabel: { color: ink3, fontSize: 11 },
    axisLine: { lineStyle: { color: border } },
    splitLine: {
      lineStyle: {
        color: isDark.value ? 'rgb(255 255 255 / 0.06)' : border,
        type: 'dashed' as const,
      },
    },
  }
}
