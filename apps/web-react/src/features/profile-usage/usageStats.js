// 个人中心「创作数据」的纯数据函数：服务端只返回有记录的日期，这里补齐空白区间并按月、年汇总。

export const USAGE_METRICS = [
  { id: 'images', label: '生成张数', unit: '张' },
  { id: 'creations', label: '创作次数', unit: '次' },
  { id: 'points', label: '消耗积分', unit: '积分' },
]

export const USAGE_RANGES = [
  { id: 'day', label: '每日', hint: '近 30 天' },
  { id: 'month', label: '每月', hint: '近 12 个月' },
  { id: 'year', label: '每年', hint: '全部年份' },
]

// 周一开头，index 对应服务端 weekdayHour 的下标（0 = 周日）。
export const WEEKDAYS = [
  { index: 1, label: '周一' },
  { index: 2, label: '周二' },
  { index: 3, label: '周三' },
  { index: 4, label: '周四' },
  { index: 5, label: '周五' },
  { index: 6, label: '周六' },
  { index: 0, label: '周日' },
]

const EMPTY = Object.freeze({ creations: 0, images: 0, points: 0, durationSeconds: 0 })

const pad = (value) => String(value).padStart(2, '0')

export function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addTotals(target, day) {
  target.creations += Number(day.creations) || 0
  target.images += Number(day.images) || 0
  target.points += Number(day.points) || 0
  target.durationSeconds += Number(day.durationSeconds) || 0
  return target
}

function bucket(map, key) {
  if (!map.has(key)) map.set(key, { ...EMPTY })
  return map.get(key)
}

/** 把接口返回整理成图表需要的各个序列。today 仅用于测试注入。 */
export function buildUsageModel(stats, today = new Date()) {
  const days = Array.isArray(stats?.days) ? stats.days : []
  const byDate = new Map(days.map((day) => [String(day.date), day]))
  const totals = days.reduce((sum, day) => addTotals(sum, day), { ...EMPTY })

  const daily = []
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    const key = localDateKey(date)
    daily.push({
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      title: `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`,
      ...EMPTY,
      ...(byDate.get(key) || {}),
    })
  }

  const monthTotals = new Map()
  const yearTotals = new Map()
  for (const day of days) {
    const [year, month] = String(day.date).split('-')
    if (!year || !month) continue
    addTotals(bucket(monthTotals, `${year}-${month}`), day)
    addTotals(bucket(yearTotals, year), day)
  }

  const monthly = []
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - offset, 1)
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    monthly.push({
      key,
      label: date.getMonth() === 0 || offset === 11 ? `${date.getFullYear() % 100}/${date.getMonth() + 1}月` : `${date.getMonth() + 1}月`,
      title: `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`,
      ...EMPTY,
      ...(monthTotals.get(key) || {}),
    })
  }

  const years = [...yearTotals.keys()].map(Number).filter(Number.isFinite)
  const currentYear = today.getFullYear()
  const firstYear = Math.min(currentYear, ...(years.length ? years : [currentYear]))
  const yearly = []
  for (let year = firstYear; year <= currentYear; year += 1) {
    yearly.push({ key: String(year), label: `${year}`, title: `${year} 年`, ...EMPTY, ...(yearTotals.get(String(year)) || {}) })
  }

  const matrix = Array.isArray(stats?.weekdayHour) ? stats.weekdayHour : []
  const cell = (weekday, hour) => Number(matrix?.[weekday]?.[hour]) || 0
  const hourly = Array.from({ length: 24 }, (_, hour) =>
    WEEKDAYS.reduce((sum, weekday) => sum + cell(weekday.index, hour), 0),
  )
  const heatmap = WEEKDAYS.map((weekday) => ({
    ...weekday,
    hours: Array.from({ length: 24 }, (_, hour) => cell(weekday.index, hour)),
  }))
  const heatMax = Math.max(0, ...heatmap.flatMap((row) => row.hours))
  const peakCount = Math.max(0, ...hourly)
  const peakHour = peakCount > 0 ? hourly.indexOf(peakCount) : -1

  const recentDuration = daily.reduce((sum, day) => sum + day.durationSeconds, 0)
  const activeDays = daily.filter((day) => day.durationSeconds > 0).length

  return {
    totals,
    daily,
    monthly,
    yearly,
    hourly,
    heatmap,
    heatMax,
    peakHour,
    recentDuration,
    averageDuration: activeDays ? recentDuration / activeDays : 0,
    hasActivity: totals.creations > 0 || totals.points > 0,
  }
}

export function formatCompact(value) {
  const number = Number(value) || 0
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`
  return number.toLocaleString('zh-CN')
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (total < 60) return `${total} 秒`
  const minutes = Math.round(total / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

export function hourRangeLabel(hour) {
  return `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`
}

/** 纵轴刻度：取 1/2/5 × 10^n 的整齐步长，返回 [0, step, …, max]。 */
export function niceTicks(maxValue, count = 4) {
  const max = Math.max(0, Number(maxValue) || 0)
  if (max === 0) return [0, 1]
  const rough = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  // 张数、次数、积分都是整数，步长不小于 1，避免出现 0.5 这样的刻度。
  const step = Math.max(1, [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) || rough)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 1000) / 1000)
  return ticks
}
