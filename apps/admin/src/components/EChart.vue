<script setup lang="ts">
/**
 * echarts 按需包装组件：只注册折线/柱状/饼图 + 基础组件 + Canvas 渲染器，
 * 避免全量引入（`import * as echarts from 'echarts'`）导致包体膨胀。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { LineSeriesOption, BarSeriesOption, PieSeriesOption } from 'echarts/charts'
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
} from 'echarts/components'

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export type EChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
>

const props = defineProps<{
  option: EChartOption
  height?: string
}>()

const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<echarts.ECharts | null>(null)

function resize() {
  chart.value?.resize()
}

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  chart.value.setOption(props.option)
  window.addEventListener('resize', resize)
})

watch(
  () => props.option,
  (option) => {
    // notMerge：筛选切换后完整替换，避免旧 series 残留
    chart.value?.setOption(option, { notMerge: true })
  },
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <div ref="el" :style="{ height: height ?? '280px', width: '100%' }" />
</template>
