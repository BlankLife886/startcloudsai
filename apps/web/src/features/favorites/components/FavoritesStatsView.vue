<script setup>
import * as echarts from 'echarts/core'
import { BarChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useFavoritesStatsData } from '@/features/favorites/composables/useFavoritesStatsData'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'

echarts.use([
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

const props = defineProps({
  favoritesStore: { type: Object, required: true },
  filteredFavorites: { type: Array, default: () => [] },
  scopedFavorites: { type: Array, default: () => [] },
})

const filteredFavoritesRef = computed(() => props.filteredFavorites || [])
const scopedFavoritesRef = computed(() => props.scopedFavorites || [])

const {
  categorySeries,
  resolutionSeries,
  puritySeries,
  orientationSeries,
  uploaderSeries,
  collectionSeries,
  hasChartData,
  totalVisible,
} = useFavoritesStatsData({
  favoritesStore: props.favoritesStore,
  filteredFavorites: filteredFavoritesRef,
  scopedFavorites: scopedFavoritesRef,
})

const categoryRef = ref(null)
const resolutionRef = ref(null)
const orientationRef = ref(null)
const purityRef = ref(null)
const uploaderRef = ref(null)
const collectionRef = ref(null)

const chartInstances = new Map()
let resizeObserver = null
let themeObserver = null

const isDark = ref(
  typeof document !== 'undefined' &&
    document.documentElement.classList.contains('color-scheme-dark'),
)

const palette = computed(() =>
  isDark.value
    ? ['#b5a3ff', '#7eb6ff', '#6ee7b7', '#fbbf24', '#fb7185', '#67e8f9', '#c4b5fd', '#fda4af']
    : ['#6a4fe0', '#4f8cff', '#2bb673', '#e8a23a', '#e05d7a', '#2aa8c4', '#8b6cf0', '#d97706'],
)

const theme = computed(() => {
  const dark = isDark.value
  return {
    ink: dark ? '#eceaf7' : '#18203b',
    muted: dark ? '#9a96b0' : '#79809a',
    line: dark ? 'rgba(255,255,255,0.1)' : 'rgba(21,26,45,0.1)',
    split: dark ? 'rgba(255,255,255,0.06)' : 'rgba(21,26,45,0.06)',
    tooltipBg: dark ? 'rgba(18, 20, 32, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: dark ? 'rgba(181,163,255,0.35)' : 'rgba(106,79,224,0.28)',
    softFill: dark ? 'rgba(181,163,255,0.18)' : 'rgba(106,79,224,0.12)',
  }
})

function tooltipBase() {
  return {
    backgroundColor: theme.value.tooltipBg,
    borderColor: theme.value.tooltipBorder,
    borderWidth: 1,
    padding: [10, 12],
    textStyle: {
      color: theme.value.ink,
      fontSize: 12,
      fontWeight: 600,
    },
    extraCssText: 'box-shadow: 3px 3px 0 rgba(106,79,224,0.28); border-radius: 0;',
  }
}

function disposeAll() {
  chartInstances.forEach((chart) => {
    try {
      chart.dispose()
    } catch {
      /* ignore */
    }
  })
  chartInstances.clear()
}

function initChart(key, el, option) {
  if (!el) return
  if (!el.clientWidth || !el.clientHeight) {
    window.requestAnimationFrame(() => initChart(key, el, option))
    return
  }

  let chart = chartInstances.get(key)
  if (chart && chart.getDom() !== el) {
    chart.dispose()
    chart = null
  }
  if (!chart) {
    chart = echarts.init(el, null, { renderer: 'canvas' })
    chartInstances.set(key, chart)
  }
  chart.setOption(option, true)
}

function buildDonutOption(series, title) {
  const colors = palette.value
  const data = series.map((item, index) => ({
    name: item.name,
    value: item.count,
    itemStyle: { color: colors[index % colors.length] },
  }))

  return {
    color: colors,
    tooltip: {
      ...tooltipBase(),
      trigger: 'item',
      formatter: '{b}<br/>{c} 张 · {d}%',
    },
    legend: {
      type: 'scroll',
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 8,
      itemHeight: 8,
      icon: 'rect',
      itemGap: 10,
      textStyle: {
        color: theme.value.muted,
        fontSize: 10,
        fontWeight: 650,
      },
      pageIconColor: theme.value.ink,
      pageTextStyle: { color: theme.value.muted },
    },
    series: [
      {
        name: title,
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 0,
          borderColor: isDark.value ? '#12141f' : '#f7f7ff',
          borderWidth: 2,
        },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: {
            shadowBlur: 0,
            shadowColor: 'transparent',
          },
        },
        data,
      },
    ],
  }
}

function buildBarOption(series, { horizontal = true } = {}) {
  const colors = palette.value
  const labels = series.map((item) => item.name)
  const values = series.map((item) => item.count)
  const max = Math.max(...values, 1)

  if (horizontal) {
    return {
      color: colors,
      tooltip: {
        ...tooltipBase(),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter(params = []) {
          const item = params[0]
          if (!item) return ''
          return `${item.name}<br/><strong>${item.value}</strong> 张`
        },
      },
      grid: { left: 10, right: 28, top: 12, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        max: Math.ceil(max * 1.15),
        axisLabel: { color: theme.value.muted, fontSize: 10, fontWeight: 650 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.value.split, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: labels.slice().reverse(),
        axisLabel: {
          color: theme.value.ink,
          fontSize: 10,
          fontWeight: 700,
          width: 72,
          overflow: 'truncate',
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: values.slice().reverse().map((value, index) => ({
            value,
            itemStyle: {
              color: colors[(values.length - 1 - index) % colors.length],
              borderRadius: 0,
            },
          })),
          barWidth: 14,
          label: {
            show: true,
            position: 'right',
            color: theme.value.muted,
            fontSize: 11,
            fontWeight: 700,
          },
        },
      ],
    }
  }

  return {
    color: colors,
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: { left: 8, right: 8, top: 18, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: theme.value.muted,
        fontSize: 10,
        fontWeight: 650,
        interval: 0,
        rotate: labels.some((label) => String(label).length > 6) ? 28 : 0,
      },
      axisLine: { lineStyle: { color: theme.value.line } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.value.muted, fontSize: 10, fontWeight: 650 },
      splitLine: { lineStyle: { color: theme.value.split, type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: values.map((value, index) => ({
          value,
          itemStyle: {
            color: colors[index % colors.length],
            borderRadius: 0,
          },
        })),
        barMaxWidth: 36,
      },
    ],
  }
}

function renderCharts() {
  if (!hasChartData.value) {
    disposeAll()
    return
  }

  initChart('category', categoryRef.value, buildDonutOption(categorySeries.value, '分类'))
  initChart('resolution', resolutionRef.value, buildBarOption(resolutionSeries.value, { horizontal: true }))
  initChart('orientation', orientationRef.value, buildDonutOption(orientationSeries.value, '构图'))
  initChart('purity', purityRef.value, buildDonutOption(puritySeries.value, '纯净度'))
  initChart('uploader', uploaderRef.value, buildBarOption(uploaderSeries.value, { horizontal: true }))
  initChart(
    'collection',
    collectionRef.value,
    buildBarOption(collectionSeries.value, { horizontal: false }),
  )
}

function resizeCharts() {
  chartInstances.forEach((chart) => {
    try {
      chart.resize()
    } catch {
      /* ignore */
    }
  })
}

function syncTheme() {
  isDark.value = document.documentElement.classList.contains('color-scheme-dark')
}

function observeCanvases() {
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => resizeCharts())
  ;[
    categoryRef.value,
    resolutionRef.value,
    orientationRef.value,
    purityRef.value,
    uploaderRef.value,
    collectionRef.value,
  ].forEach((el) => {
    if (el) resizeObserver.observe(el)
  })
}

onMounted(async () => {
  syncTheme()
  await nextTick()
  renderCharts()
  observeCanvases()

  themeObserver = new MutationObserver(() => {
    syncTheme()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  disposeAll()
})

watch(
  [
    hasChartData,
    categorySeries,
    resolutionSeries,
    puritySeries,
    orientationSeries,
    uploaderSeries,
    collectionSeries,
    isDark,
  ],
  async () => {
    await nextTick()
    renderCharts()
    observeCanvases()
  },
  { deep: true },
)
</script>

<template>
  <div class="favorites-stats" data-fav-motion>
    <div v-if="!hasChartData" class="stats-empty-board">
      <i class="bi bi-bar-chart"></i>
      <h3>还没有可统计的收藏</h3>
      <p>先收藏一些壁纸，这里会用图表展示分类、分辨率和作者分布。</p>
    </div>

    <div v-else class="stats-chart-board">
      <section class="stats-chart-card">
        <header class="stats-chart-head">
          <div>
            <h3><i class="bi bi-pie-chart"></i>分类分布</h3>
            <p>当前筛选下的主题结构</p>
          </div>
          <span>{{ totalVisible }} 张</span>
        </header>
        <div ref="categoryRef" class="stats-chart-canvas" role="img" aria-label="分类分布图"></div>
      </section>

      <section class="stats-chart-card">
        <header class="stats-chart-head">
          <div>
            <h3><i class="bi bi-aspect-ratio"></i>分辨率排行</h3>
            <p>最常见的尺寸偏好</p>
          </div>
          <span>{{ resolutionSeries.length }} 类</span>
        </header>
        <div
          ref="resolutionRef"
          class="stats-chart-canvas"
          role="img"
          aria-label="分辨率排行图"
        ></div>
      </section>

      <section class="stats-chart-card">
        <header class="stats-chart-head">
          <div>
            <h3><i class="bi bi-phone-landscape"></i>构图比例</h3>
            <p>横图 / 竖图 / 方形</p>
          </div>
          <span>{{ orientationSeries.length }} 项</span>
        </header>
        <div
          ref="orientationRef"
          class="stats-chart-canvas is-compact"
          role="img"
          aria-label="构图比例图"
        ></div>
      </section>

      <section class="stats-chart-card">
        <header class="stats-chart-head">
          <div>
            <h3><i class="bi bi-shield-check"></i>纯净度</h3>
            <p>安全等级分布</p>
          </div>
          <span>{{ puritySeries.length }} 项</span>
        </header>
        <div
          ref="purityRef"
          class="stats-chart-canvas is-compact"
          role="img"
          aria-label="纯净度分布图"
        ></div>
      </section>

      <section class="stats-chart-card">
        <header class="stats-chart-head">
          <div>
            <h3><i class="bi bi-person"></i>作者 Top</h3>
            <p>收藏最多的上传者</p>
          </div>
          <span>{{ uploaderSeries.length }} 人</span>
        </header>
        <div ref="uploaderRef" class="stats-chart-canvas" role="img" aria-label="作者排行图"></div>
      </section>

      <section class="stats-chart-card">
        <header class="stats-chart-head">
          <div>
            <h3><i class="bi bi-folder2-open"></i>合集分布</h3>
            <p>整理到各合集的数量</p>
          </div>
          <span>{{ collectionSeries.length }} 组</span>
        </header>
        <div
          ref="collectionRef"
          class="stats-chart-canvas"
          role="img"
          aria-label="合集分布图"
        ></div>
      </section>
    </div>
  </div>
</template>

<style src="../styles/favorites-stats.css"></style>
