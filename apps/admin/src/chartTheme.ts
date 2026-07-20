/** echarts 统一配色（规范第 3 节）：主色序列 + 令牌化 tooltip / 轴线样式 */
import { isDark } from '@/theme'

export const CHART_COLORS = [
  '#6366f1',
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#94a3b8',
] as const

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
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
  return {
    color: [...CHART_COLORS],
    tooltip: {
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      padding: [8, 12] as [number, number],
      textStyle: { color: token('--ink'), fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 1px 2px rgb(16 24 40 / .04),0 4px 12px rgb(16 24 40 / .12);',
    },
    legendText: { color: ink2, fontSize: 12 },
    axisLabel: { color: ink3, fontSize: 11 },
    axisLine: { lineStyle: { color: border } },
    splitLine: { lineStyle: { color: border } },
  }
}
