<script setup>
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'

echarts.use([
  BarChart,
  CanvasRenderer,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  RadarChart,
  RadarComponent,
  TooltipComponent,
])

// 获取stores
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()

// 本地状态
const isLoading = ref(false)
const activeTab = ref('charts')
const categoryChartRef = ref(null)
const resolutionChartRef = ref(null)
const activityChartRef = ref(null)
const portraitChartRef = ref(null)
const chartRefs = {
  category: categoryChartRef,
  resolution: resolutionChartRef,
  activity: activityChartRef,
  portrait: portraitChartRef,
}
const chartInstances = {}

const chartPalette = ['#6a4fe0', '#8568f7', '#a08bff', '#54d6c4', '#f0c66a', '#f06b8e']

function isDarkCraftTheme() {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('color-scheme-dark')
}

function getChartTheme() {
  if (isDarkCraftTheme()) {
    return {
      text: 'rgba(244, 242, 255, 0.88)',
      muted: 'rgba(210, 205, 240, 0.68)',
      grid: 'rgba(255, 255, 255, 0.1)',
      tooltipBg: 'rgba(21, 24, 38, 0.96)',
      tooltipBorder: 'rgba(160, 139, 255, 0.28)',
      barFrom: '#a08bff',
      barTo: '#6a4fe0',
      radarFill: 'rgba(160, 139, 255, 0.18)',
      radarLine: '#a08bff',
      radarItem: '#f0c66a',
      pieBorder: '#151826',
      radarSplit: ['rgba(255,255,255,0.03)', 'rgba(255,255,255,0.06)'],
    }
  }
  return {
    text: '#3a4258',
    muted: '#79809a',
    grid: 'rgba(21, 26, 45, 0.08)',
    tooltipBg: 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: 'rgba(106, 79, 224, 0.22)',
    barFrom: '#8568f7',
    barTo: '#6a4fe0',
    radarFill: 'rgba(106, 79, 224, 0.14)',
    radarLine: '#6a4fe0',
    radarItem: '#f0c66a',
    pieBorder: '#ffffff',
    radarSplit: ['rgba(106, 79, 224, 0.03)', 'rgba(106, 79, 224, 0.07)'],
  }
}

// 计算属性 - 总体统计
const totalStats = computed(() => {
  return {
    favorites: favoritesStore.favoritesCount,
    collections: favoritesStore.collections.length,
    history: historyStore.historyCount,
  }
})

// 计算属性 - 分类统计
const categoryStats = computed(() => {
  const stats = {
    general: 0,
    anime: 0,
    people: 0,
    other: 0,
  }

  // 统计收藏的壁纸分类
  favoritesStore.favorites.forEach((item) => {
    if (item.category === 'general') {
      stats.general++
    } else if (item.category === 'anime') {
      stats.anime++
    } else if (item.category === 'people') {
      stats.people++
    } else {
      stats.other++
    }
  })

  return stats
})

const categoryChartData = computed(() =>
  [
    { name: '常规', value: categoryStats.value.general },
    { name: '动漫', value: categoryStats.value.anime },
    { name: '人物', value: categoryStats.value.people },
    { name: '其他', value: categoryStats.value.other },
  ].filter((item) => item.value > 0),
)

// 计算属性 - 分辨率统计
const resolutionStats = computed(() => {
  const stats = {}

  // 统计收藏的壁纸分辨率
  favoritesStore.favorites.forEach((item) => {
    if (item.resolution) {
      if (!stats[item.resolution]) {
        stats[item.resolution] = 0
      }
      stats[item.resolution]++
    }
  })

  // 转换为数组并排序
  return Object.entries(stats)
    .map(([resolution, count]) => ({ resolution, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5) // 只取前5个
})

function parseResolution(resolution) {
  const match = String(resolution || '').match(/(\d+)\s*x\s*(\d+)/i)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!width || !height) return null
  return { width, height, pixels: width * height, ratio: width / height }
}

function getImageDimensions(item) {
  const width = Number(item?.dimension_x)
  const height = Number(item?.dimension_y)
  if (width > 0 && height > 0) {
    return { width, height, pixels: width * height, ratio: width / height }
  }
  return parseResolution(item?.resolution)
}

function normalizeFileType(type) {
  const raw = String(type || '').toLowerCase()
  if (raw.includes('png')) return 'PNG'
  if (raw.includes('webp')) return 'WEBP'
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'JPG'
  return raw ? raw.replace('image/', '').toUpperCase() : '未知'
}

function getTagLabel(tag) {
  if (typeof tag === 'string') return tag
  return tag?.name || tag?.alias || tag?.id || ''
}

function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '未知'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(size / 1024)} KB`
}

const imagePortrait = computed(() => {
  const favorites = favoritesStore.favorites
  const total = favorites.length || 1
  let landscape = 0
  let portrait = 0
  let square = 0
  let ultraWide = 0
  let highRes = 0
  let colorRich = 0

  favorites.forEach((item) => {
    const parsed = getImageDimensions(item)
    if (parsed) {
      if (parsed.ratio > 2) ultraWide += 1
      if (parsed.ratio > 1.15) landscape += 1
      else if (parsed.ratio < 0.87) portrait += 1
      else square += 1
      if (parsed.pixels >= 3840 * 2160) highRes += 1
    }
    if (Array.isArray(item.colors) && item.colors.length >= 4) {
      colorRich += 1
    }
  })

  return {
    landscape,
    portrait,
    square,
    ultraWide,
    highRes,
    colorRich,
    total,
    landscapeRatio: Math.round((landscape / total) * 100),
    highResRatio: Math.round((highRes / total) * 100),
    colorRichRatio: Math.round((colorRich / total) * 100),
  }
})

// 计算属性 - 颜色统计
const colorStats = computed(() => {
  const stats = {}

  // 统计收藏的壁纸颜色
  favoritesStore.favorites.forEach((item) => {
    if (item.colors && Array.isArray(item.colors)) {
      item.colors.forEach((color) => {
        if (!stats[color]) {
          stats[color] = 0
        }
        stats[color]++
      })
    }
  })

  // 转换为数组并排序
  return Object.entries(stats)
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10) // 只取前10个
})

const activityTrendData = computed(() => {
  const dayMs = 24 * 60 * 60 * 1000
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today.getTime() - (13 - index) * dayMs)
    return {
      key: date.toISOString().slice(0, 10),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      favorite: 0,
      view: 0,
    }
  })
  const dayMap = new Map(days.map((day) => [day.key, day]))

  favoritesStore.favorites.forEach((item) => {
    const date = new Date(item.favorited_at || item.created_at || 0)
    if (Number.isNaN(date.getTime())) return
    date.setHours(0, 0, 0, 0)
    const day = dayMap.get(date.toISOString().slice(0, 10))
    if (day) day.favorite += 1
  })

  historyStore.history.forEach((item) => {
    const date = new Date(item.viewed_at || 0)
    if (Number.isNaN(date.getTime())) return
    date.setHours(0, 0, 0, 0)
    const day = dayMap.get(date.toISOString().slice(0, 10))
    if (day) day.view += 1
  })

  return days
})

const metadataProfile = computed(() => {
  const items = favoritesStore.favorites
  const total = items.length || 1
  const fileTypes = {}
  const purity = {}
  const uploadYears = {}
  const tagCounts = {}
  const uploaders = new Set()
  let dimensionKnown = 0
  let colorsKnown = 0
  let fileSizeKnown = 0
  let fileTypeKnown = 0
  let heatKnown = 0
  let totalFileSize = 0
  let totalViews = 0
  let totalPublicFavorites = 0
  let totalTags = 0
  let taggedItems = 0

  items.forEach((item) => {
    if (getImageDimensions(item)) dimensionKnown += 1
    if (Array.isArray(item.colors) && item.colors.length) colorsKnown += 1

    const fileSize = Number(item.file_size)
    if (fileSize > 0) {
      fileSizeKnown += 1
      totalFileSize += fileSize
    }

    if (item.file_type) {
      fileTypeKnown += 1
      const type = normalizeFileType(item.file_type)
      fileTypes[type] = (fileTypes[type] || 0) + 1
    }

    if (item.purity) {
      purity[item.purity] = (purity[item.purity] || 0) + 1
    }

    const views = Number(item.views)
    const publicFavorites = Number(item.favorites)
    if (Number.isFinite(views) || Number.isFinite(publicFavorites)) {
      heatKnown += 1
      totalViews += Number.isFinite(views) ? views : 0
      totalPublicFavorites += Number.isFinite(publicFavorites) ? publicFavorites : 0
    }

    const createdAt = item.created_at || item.upload_time
    const year = createdAt ? new Date(createdAt).getFullYear() : null
    if (year && !Number.isNaN(year)) {
      uploadYears[year] = (uploadYears[year] || 0) + 1
    }

    if (item.uploader) uploaders.add(String(item.uploader))

    if (Array.isArray(item.tags) && item.tags.length) {
      taggedItems += 1
      totalTags += item.tags.length
      item.tags
        .map(getTagLabel)
        .filter(Boolean)
        .slice(0, 8)
        .forEach((tag) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1
        })
    }
  })

  const coverageFields = [dimensionKnown, colorsKnown, fileSizeKnown, fileTypeKnown, heatKnown]
  const coverageAverage =
    coverageFields.reduce((sum, count) => sum + Math.round((count / total) * 100), 0) /
    coverageFields.length

  return {
    total: items.length,
    fileTypes,
    purity,
    uploadYears,
    tagCounts,
    uploaderCount: uploaders.size,
    dimensionCoverage: Math.round((dimensionKnown / total) * 100),
    colorCoverage: Math.round((colorsKnown / total) * 100),
    fileCoverage: Math.round((fileSizeKnown / total) * 100),
    fileTypeCoverage: Math.round((fileTypeKnown / total) * 100),
    heatCoverage: Math.round((heatKnown / total) * 100),
    metadataCoverage: Math.round(coverageAverage),
    averageFileSize: fileSizeKnown ? Math.round(totalFileSize / fileSizeKnown) : 0,
    averageViews: heatKnown ? Math.round(totalViews / heatKnown) : 0,
    publicFavorites: totalPublicFavorites,
    averageTags: taggedItems ? Number((totalTags / taggedItems).toFixed(1)) : 0,
  }
})

const portraitRadarData = computed(() => {
  const portrait = imagePortrait.value
  const profile = metadataProfile.value
  const popularityIndex = Math.min(Math.round(Math.log10(profile.averageViews + 1) * 25), 100)
  const tagDepth = Math.min(Math.round(profile.averageTags * 20), 100)

  return [
    portrait.landscapeRatio,
    portrait.highResRatio,
    profile.colorCoverage,
    profile.fileCoverage,
    popularityIndex,
    tagDepth,
  ]
})

const chartSummaries = computed(() => [
  {
    label: '横图占比',
    value: `${imagePortrait.value.landscapeRatio}%`,
  },
  {
    label: '元数据覆盖',
    value: `${metadataProfile.value.metadataCoverage}%`,
  },
  {
    label: '平均文件',
    value: formatFileSize(metadataProfile.value.averageFileSize),
  },
])

function topEntry(record, fallback = '暂无数据') {
  const [key, value] = Object.entries(record || {}).sort((a, b) => b[1] - a[1])[0] || [fallback, 0]
  return { key, value }
}

const topFileType = computed(() => topEntry(metadataProfile.value.fileTypes))
const topPurity = computed(() => {
  const labels = {
    sfw: '安全',
    sketchy: '轻微敏感',
    nsfw: '敏感',
  }
  const top = topEntry(metadataProfile.value.purity)
  return { ...top, label: labels[top.key] || top.key }
})

const imageFieldCards = computed(() => [
  {
    label: '尺寸字段',
    value: `${metadataProfile.value.dimensionCoverage}%`,
    meta: 'dimension_x / dimension_y',
  },
  {
    label: '色板字段',
    value: `${metadataProfile.value.colorCoverage}%`,
    meta: 'colors 主色数组',
  },
  {
    label: '热度字段',
    value: `${metadataProfile.value.heatCoverage}%`,
    meta: `${metadataProfile.value.averageViews} 平均浏览`,
  },
  {
    label: '标签深度',
    value: metadataProfile.value.averageTags || '0',
    meta: '详情 tags 均值',
  },
])

const topTags = computed(() => {
  return Object.entries(metadataProfile.value.tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
})

const favoriteConversion = computed(() => {
  if (!historyStore.historyCount) return favoritesStore.favoritesCount ? 100 : 0
  return Math.min(
    Math.round((favoritesStore.favoritesCount / historyStore.historyCount) * 100),
    100,
  )
})

const leadingCategory = computed(() => {
  return categoryChartData.value[0]?.name || '待形成'
})

const leadingResolution = computed(() => {
  return resolutionStats.value[0]?.resolution || '暂无数据'
})

const trendPeak = computed(() => {
  return activityTrendData.value.reduce(
    (peak, day) => {
      const total = day.favorite + day.view
      return total > peak.total ? { ...day, total } : peak
    },
    { label: '暂无', favorite: 0, view: 0, total: 0 },
  )
})

const statBriefs = computed(() => [
  {
    label: '主分类',
    value: leadingCategory.value,
    meta: `${categoryChartData.value.length || 0} 个分类参与`,
    tone: 'violet',
  },
  {
    label: '文件类型',
    value: topFileType.value.key,
    meta: `${topFileType.value.value} 张匹配`,
    tone: 'lilac',
  },
  {
    label: '公开热度',
    value: metadataProfile.value.averageViews,
    meta: `${metadataProfile.value.publicFavorites} 次公开收藏`,
    tone: 'gold',
  },
  {
    label: '收藏转化',
    value: `${favoriteConversion.value}%`,
    meta: `${totalStats.value.favorites} 收藏 / ${totalStats.value.history} 浏览`,
    tone: 'rose',
  },
])

const frameStats = computed(() => {
  const portrait = imagePortrait.value
  return [
    { label: '横图', value: portrait.landscape },
    { label: '竖图', value: portrait.portrait },
    { label: '方图', value: portrait.square },
    { label: '超宽', value: portrait.ultraWide },
  ]
})

const portraitInsights = computed(() => {
  const portrait = imagePortrait.value
  const collectRate = favoriteConversion.value
  return [
    {
      label: '清晰度偏好',
      value: portrait.highResRatio >= 50 ? '高分辨率优先' : '混合清晰度',
      meta: `${portrait.highRes} 张 4K+`,
    },
    {
      label: '画幅方向',
      value: portrait.landscapeRatio >= 60 ? '桌面横屏主导' : '多画幅收藏',
      meta: `${portrait.landscapeRatio}% 横图`,
    },
    {
      label: '筛选转化',
      value: collectRate >= 35 ? '收藏决策积极' : '浏览探索更多',
      meta: `${collectRate}% 转化`,
    },
  ]
})

// 设置活动标签
function setActiveTab(tab) {
  activeTab.value = tab
}

function getChartBaseOption() {
  const theme = getChartTheme()
  return {
    backgroundColor: 'transparent',
    textStyle: {
      color: theme.text,
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: {
        color: theme.text,
      },
    },
  }
}

function getCategoryChartOption() {
  const theme = getChartTheme()
  const data = categoryChartData.value.length
    ? categoryChartData.value
    : [{ name: '暂无数据', value: 1, itemStyle: { color: 'rgba(106, 79, 224, 0.18)' } }]

  return {
    ...getChartBaseOption(),
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: theme.muted },
    },
    series: [
      {
        name: '分类占比',
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { color: theme.text },
        labelLine: { lineStyle: { color: theme.grid } },
        itemStyle: { borderRadius: 0, borderColor: theme.pieBorder, borderWidth: 2 },
        color: chartPalette,
        data,
      },
    ],
  }
}

function getResolutionChartOption() {
  const theme = getChartTheme()
  const data = resolutionStats.value.length
    ? resolutionStats.value
    : [{ resolution: '暂无数据', count: 0 }]
  return {
    ...getChartBaseOption(),
    tooltip: { ...getChartBaseOption().tooltip, trigger: 'axis' },
    grid: { top: 20, right: 16, bottom: 34, left: 42 },
    xAxis: {
      type: 'category',
      data: data.map((item) => item.resolution),
      axisLabel: { color: theme.muted, rotate: data.length > 4 ? 18 : 0 },
      axisLine: { lineStyle: { color: theme.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.muted },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        name: '收藏数量',
        type: 'bar',
        data: data.map((item) => item.count),
        barMaxWidth: 34,
        itemStyle: {
          borderRadius: 0,
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: theme.barFrom },
              { offset: 1, color: theme.barTo },
            ],
          },
        },
      },
    ],
  }
}

function getActivityChartOption() {
  const theme = getChartTheme()
  const days = activityTrendData.value
  return {
    ...getChartBaseOption(),
    tooltip: { ...getChartBaseOption().tooltip, trigger: 'axis' },
    legend: {
      top: 0,
      right: 8,
      textStyle: { color: theme.muted },
    },
    grid: { top: 36, right: 16, bottom: 28, left: 36 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: days.map((item) => item.label),
      axisLabel: { color: theme.muted },
      axisLine: { lineStyle: { color: theme.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.muted },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        name: '收藏',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: days.map((item) => item.favorite),
        lineStyle: { width: 3, color: '#f06b8e' },
        itemStyle: { color: '#f06b8e' },
        areaStyle: { color: 'rgba(240, 107, 142, 0.12)' },
      },
      {
        name: '浏览',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: days.map((item) => item.view),
        lineStyle: { width: 3, color: '#8568f7' },
        itemStyle: { color: '#8568f7' },
        areaStyle: { color: 'rgba(133, 104, 247, 0.12)' },
      },
    ],
  }
}

function getPortraitChartOption() {
  const theme = getChartTheme()
  return {
    ...getChartBaseOption(),
    radar: {
      radius: '66%',
      center: ['50%', '52%'],
      splitNumber: 4,
      axisName: { color: theme.text },
      splitArea: {
        areaStyle: {
          color: theme.radarSplit,
        },
      },
      axisLine: { lineStyle: { color: theme.grid } },
      splitLine: { lineStyle: { color: theme.grid } },
      indicator: [
        { name: '横图', max: 100 },
        { name: '4K+', max: 100 },
        { name: '色板', max: 100 },
        { name: '文件', max: 100 },
        { name: '热度', max: 100 },
        { name: '标签', max: 100 },
      ],
    },
    series: [
      {
        name: '图片画像',
        type: 'radar',
        data: [
          {
            value: portraitRadarData.value,
            name: '画像指数',
            areaStyle: { color: theme.radarFill },
            lineStyle: { color: theme.radarLine, width: 3 },
            itemStyle: { color: theme.radarItem },
          },
        ],
      },
    ],
  }
}

function initChart(key, optionFactory) {
  const el = chartRefs[key].value
  if (!el) return
  if (chartInstances[key] && chartInstances[key].getDom() !== el) {
    chartInstances[key].dispose()
    chartInstances[key] = null
  }
  if (!chartInstances[key]) {
    chartInstances[key] = echarts.init(el, null, { renderer: 'canvas' })
  }
  chartInstances[key].setOption(optionFactory(), true)
}

function renderCharts() {
  nextTick(() => {
    initChart('category', getCategoryChartOption)
    initChart('resolution', getResolutionChartOption)
    initChart('activity', getActivityChartOption)
    initChart('portrait', getPortraitChartOption)
  })
}

function resizeCharts() {
  Object.values(chartInstances).forEach((chart) => chart?.resize())
}

// 组件挂载时初始化
onMounted(() => {
  const needsInit = favoritesStore.favoritesCount === 0 && historyStore.historyCount === 0
  if (needsInit) {
    isLoading.value = true
    Promise.allSettled([favoritesStore.initFavorites(), historyStore.initHistory()]).finally(() => {
      isLoading.value = false
      renderCharts()
    })
  } else {
    renderCharts()
  }
  window.addEventListener('resize', resizeCharts)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts)
  Object.values(chartInstances).forEach((chart) => chart?.dispose())
})

watch(
  [activeTab, categoryChartData, resolutionStats, activityTrendData, portraitRadarData],
  () => {
    if (!isLoading.value) renderCharts()
  },
  { deep: true },
)
</script>

<template>
  <div class="stats-analytics">
    <div class="stats-shell">
      <div class="stats-shell__head">
        <div class="stats-tabs">
          <button
            type="button"
            class="stats-tab"
            :class="{ 'is-active': activeTab === 'charts' }"
            @click="setActiveTab('charts')"
          >
            数据视图
          </button>
          <button
            type="button"
            class="stats-tab"
            :class="{ 'is-active': activeTab === 'portrait' }"
            @click="setActiveTab('portrait')"
          >
            图片画像
          </button>
        </div>
      </div>

      <div class="stats-shell__body">
        <div v-if="isLoading" class="stats-loading">
          <div class="stats-loading__spinner" role="status" aria-label="加载中"></div>
          <p>加载统计数据...</p>
        </div>

        <div v-else-if="activeTab === 'charts'" class="echart-dashboard">
          <div class="stats-brief-grid">
            <div
              v-for="item in statBriefs"
              :key="item.label"
              class="stats-brief"
              :class="`tone-${item.tone}`"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <em>{{ item.meta }}</em>
            </div>
          </div>

          <div class="echart-grid">
            <section class="echart-card category-card">
              <div class="chart-header">
                <div>
                  <h6>收藏分类占比</h6>
                  <p>分析收藏内容的主题结构。</p>
                </div>
                <span>{{ totalStats.favorites }} 张</span>
              </div>
              <div ref="categoryChartRef" class="echart-canvas"></div>
            </section>

            <section class="echart-card resolution-card">
              <div class="chart-header">
                <div>
                  <h6>分辨率排行</h6>
                  <p>来自 resolution 与 dimension_x/y，观察真实尺寸偏好。</p>
                </div>
                <span>{{ resolutionStats.length }} 类</span>
              </div>
              <div ref="resolutionChartRef" class="echart-canvas"></div>
            </section>

            <section class="echart-card trend-card">
              <div class="chart-header">
                <div>
                  <h6>14 天收藏 / 浏览趋势</h6>
                  <p>判断近期是探索、筛选，还是沉淀灵感。</p>
                </div>
                <span>峰值 {{ trendPeak.label }}</span>
              </div>
              <div ref="activityChartRef" class="echart-canvas trend"></div>
            </section>

            <section class="echart-card portrait-card">
              <div class="chart-header">
                <div>
                  <h6>图片分析画像</h6>
                  <p>综合尺寸、色板、文件、热度和标签字段。</p>
                </div>
                <span>Radar</span>
              </div>
              <div ref="portraitChartRef" class="echart-canvas"></div>
            </section>
          </div>
        </div>

        <div v-else-if="activeTab === 'portrait'" class="echart-dashboard">
          <div class="echart-grid portrait-only">
            <section class="echart-card portrait-hero-card">
              <div class="chart-header">
                <div>
                  <h6>图片画像摘要</h6>
                  <p>基于 Wallhaven 图片返回字段，而不是静态假设。</p>
                </div>
                <span>{{ metadataProfile.metadataCoverage }}% 覆盖</span>
              </div>
              <div class="portrait-summary">
                <div v-for="item in chartSummaries" :key="item.label">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
              <div class="portrait-color-strip" v-if="colorStats.length">
                <span
                  v-for="item in colorStats.slice(0, 8)"
                  :key="item.color"
                  :style="{ backgroundColor: item.color }"
                  :title="`${item.color}: ${item.count}`"
                ></span>
              </div>
              <div class="portrait-copy">
                <p>
                  当前收藏中，横图占比 <strong>{{ imagePortrait.landscapeRatio }}%</strong>，
                  主文件类型为 <strong>{{ topFileType.key }}</strong
                  >。
                </p>
                <p>
                  公开平均浏览为 <strong>{{ metadataProfile.averageViews }}</strong
                  >， 纯净度主要为 <strong>{{ topPurity.label }}</strong
                  >。
                </p>
              </div>
            </section>

            <section class="echart-card portrait-detail-card">
              <div class="chart-header">
                <div>
                  <h6>画幅结构</h6>
                  <p>用 dimension_x/y 与 resolution 拆解适配设备。</p>
                </div>
                <span>{{ imagePortrait.total }} 张</span>
              </div>
              <div class="frame-grid">
                <div v-for="item in frameStats" :key="item.label" class="frame-cell">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </section>

            <section class="echart-card portrait-detail-card">
              <div class="chart-header">
                <div>
                  <h6>画像判断</h6>
                  <p>根据文件、热度、标签和收藏行为生成结论。</p>
                </div>
                <span>Insight</span>
              </div>
              <div class="portrait-insights">
                <div v-for="item in portraitInsights" :key="item.label">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                  <em>{{ item.meta }}</em>
                </div>
              </div>
            </section>

            <section class="echart-card metadata-card">
              <div class="chart-header">
                <div>
                  <h6>返回字段覆盖</h6>
                  <p>检查图片数据里哪些字段足够支撑画像分析。</p>
                </div>
                <span>Fields</span>
              </div>
              <div class="field-grid">
                <div v-for="item in imageFieldCards" :key="item.label">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                  <em>{{ item.meta }}</em>
                </div>
              </div>
            </section>

            <section class="echart-card tags-card">
              <div class="chart-header">
                <div>
                  <h6>标签画像</h6>
                  <p>详情接口返回 tags 时，用高频标签补足内容画像。</p>
                </div>
                <span>{{ metadataProfile.uploaderCount }} 上传者</span>
              </div>
              <div v-if="topTags.length" class="tag-cloud">
                <span v-for="item in topTags" :key="item.tag">
                  {{ item.tag }}
                  <em>{{ item.count }}</em>
                </span>
              </div>
              <div v-else class="empty-tag-state">当前收藏多来自列表数据，详情标签暂未沉淀。</div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-analytics {
  --sa-card: var(--pf-card, #ffffff);
  --sa-line: var(--pf-line, rgba(21, 26, 45, 0.1));
  --sa-accent: var(--pf-accent, #6a4fe0);
  --sa-accent-soft: var(--pf-accent-soft, rgba(106, 79, 224, 0.1));
  --sa-heading: var(--pf-heading, #151a2d);
  --sa-text: var(--pf-text, #3a4258);
  --sa-muted: var(--pf-muted, #79809a);
  --sa-stamp: var(--pf-stamp-soft, 3px 3px 0 rgba(106, 79, 224, 0.12));
  --sa-mono: var(--pf-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  --sa-on-accent: var(--pf-on-accent, #ffffff);
  color: var(--sa-text);
}

.stats-shell {
  border: 1px solid var(--sa-line);
  border-radius: 0;
  background: var(--sa-card);
  box-shadow: var(--sa-stamp);
  overflow: hidden;
}

.stats-shell__head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sa-line);
  background: var(--sa-accent-soft);
}

.stats-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stats-tab {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  background: var(--sa-card);
  color: var(--sa-muted);
  font-size: 0.78rem;
  font-weight: 760;
  cursor: pointer;
}

.stats-tab:hover {
  color: var(--sa-heading);
  border-color: var(--sa-accent);
}

.stats-tab.is-active {
  color: var(--sa-on-accent);
  background: var(--sa-accent);
  border-color: var(--sa-accent);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.24);
}

.stats-shell__body {
  padding: 12px 14px 14px;
}

.stats-loading {
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 36px 12px;
  color: var(--sa-muted);
}

.stats-loading__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(106, 79, 224, 0.18);
  border-top-color: var(--sa-accent);
  border-radius: 0;
  animation: stats-spin 0.7s linear infinite;
}

.stats-loading p {
  margin: 0;
  font-size: 0.86rem;
}

.echart-dashboard {
  min-width: 0;
}

.stats-brief-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.stats-brief {
  position: relative;
  min-width: 0;
  padding: 10px 11px 10px 14px;
  overflow: hidden;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  background: var(--sa-accent-soft);
}

.stats-brief::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--brief-color, var(--sa-accent));
}

.stats-brief span,
.stats-brief em {
  display: block;
  color: var(--sa-muted);
  font-size: 0.72rem;
  font-style: normal;
  line-height: 1.2;
}

.stats-brief strong {
  display: block;
  margin: 5px 0 4px;
  overflow: hidden;
  color: var(--sa-heading);
  font-family: var(--sa-mono);
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.08;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-brief.tone-violet {
  --brief-color: #6a4fe0;
}

.stats-brief.tone-lilac {
  --brief-color: #8568f7;
}

.stats-brief.tone-gold {
  --brief-color: #f0c66a;
}

.stats-brief.tone-rose {
  --brief-color: #f06b8e;
}

.echart-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 12px;
  align-items: stretch;
}

.echart-grid.portrait-only {
  grid-template-columns: minmax(0, 1.14fr) minmax(0, 0.86fr);
}

.echart-card {
  position: relative;
  min-width: 0;
  min-height: 286px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  background: var(--sa-card);
  box-shadow: var(--sa-stamp);
}

.trend-card {
  grid-column: 1 / -1;
  min-height: 318px;
}

.portrait-card {
  min-height: 318px;
}

.portrait-detail-card {
  min-height: 188px;
}

.portrait-hero-card {
  grid-row: span 2;
  min-height: 396px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.chart-header h6 {
  margin: 0 0 4px;
  color: var(--sa-heading);
  font-size: 0.92rem;
  font-weight: 760;
}

.chart-header p {
  margin: 0;
  color: var(--sa-muted);
  font-size: 0.78rem;
  line-height: 1.35;
}

.chart-header span {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 4px 8px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  color: var(--sa-accent);
  background: var(--sa-accent-soft);
  font-family: var(--sa-mono);
  font-size: 0.72rem;
  font-weight: 760;
}

.echart-canvas {
  width: 100%;
  height: 224px;
}

.echart-canvas.trend {
  height: 252px;
}

.portrait-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 10px 0 12px;
}

.portrait-summary div {
  padding: 11px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  background: var(--sa-accent-soft);
}

.portrait-summary span {
  display: block;
  color: var(--sa-muted);
  font-size: 0.76rem;
}

.portrait-summary strong {
  display: block;
  margin-top: 4px;
  color: var(--sa-heading);
  font-family: var(--sa-mono);
  font-size: 1.22rem;
  line-height: 1;
}

.portrait-color-strip {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.portrait-color-strip span {
  height: 28px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
}

.portrait-copy {
  display: grid;
  gap: 8px;
}

.portrait-copy p {
  margin: 0;
  padding: 10px 11px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  color: var(--sa-text);
  background: var(--sa-accent-soft);
  font-size: 0.82rem;
  line-height: 1.48;
}

.portrait-copy strong {
  color: var(--sa-accent);
}

.frame-grid,
.portrait-insights,
.field-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.portrait-insights,
.field-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.frame-cell,
.portrait-insights div,
.field-grid div {
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  background: var(--sa-accent-soft);
}

.frame-cell span,
.portrait-insights span,
.field-grid span {
  display: block;
  color: var(--sa-muted);
  font-size: 0.76rem;
}

.frame-cell strong,
.portrait-insights strong,
.field-grid strong {
  display: block;
  margin-top: 5px;
  color: var(--sa-heading);
  font-family: var(--sa-mono);
  font-size: 1.2rem;
  line-height: 1.15;
}

.portrait-insights strong,
.field-grid strong {
  font-size: 0.98rem;
}

.portrait-insights em,
.field-grid em {
  display: block;
  margin-top: 6px;
  color: var(--sa-muted);
  font-size: 0.74rem;
  font-style: normal;
}

.metadata-card,
.tags-card {
  min-height: 188px;
}

.field-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-cloud span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid var(--sa-line);
  border-radius: 0;
  color: var(--sa-text);
  background: var(--sa-card);
  font-size: 0.78rem;
}

.tag-cloud em {
  color: var(--sa-accent);
  font-family: var(--sa-mono);
  font-size: 0.72rem;
  font-style: normal;
  font-weight: 760;
}

.empty-tag-state {
  padding: 14px;
  border: 1px dashed var(--sa-line);
  border-radius: 0;
  color: var(--sa-muted);
  background: var(--sa-accent-soft);
  font-size: 0.82rem;
  line-height: 1.5;
}

@keyframes stats-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 992px) {
  .stats-brief-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .echart-grid {
    grid-template-columns: 1fr;
  }

  .trend-card,
  .portrait-hero-card {
    grid-column: auto;
    grid-row: auto;
  }

  .portrait-insights,
  .field-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .stats-shell__head,
  .stats-shell__body {
    padding-inline: 10px;
  }

  .chart-header {
    align-items: flex-start;
  }

  .stats-brief-grid,
  .portrait-summary,
  .frame-grid,
  .field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .portrait-color-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .echart-card {
    min-height: 280px;
  }

  .echart-canvas,
  .echart-canvas.trend {
    height: 220px;
  }
}
</style>
