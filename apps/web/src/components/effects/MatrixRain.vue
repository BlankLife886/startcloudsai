<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

// 定义props
const props = defineProps({
  enabled: {
    type: Boolean,
    default: true,
  },
})

// 本地状态
const canvas = ref(null)
const ctx = ref(null)
const animationId = ref(null)
const columns = ref([])
const fontSize = ref(14)
const drops = ref([])

// 初始化画布
function initCanvas() {
  if (!canvas.value) return

  // 获取上下文
  ctx.value = canvas.value.getContext('2d')

  // 设置画布大小
  resizeCanvas()

  // 初始化列
  initColumns()
}

// 调整画布大小
function resizeCanvas() {
  if (!canvas.value) return

  // 设置画布大小为窗口大小
  canvas.value.width = window.innerWidth
  canvas.value.height = window.innerHeight

  // 重新初始化列
  initColumns()
}

// 初始化列
function initColumns() {
  if (!canvas.value) return

  // 计算列数
  const columnCount = Math.floor(canvas.value.width / fontSize.value)

  // 初始化列
  columns.value = []
  drops.value = []

  // 为每列生成随机字符
  for (let i = 0; i < columnCount; i++) {
    columns.value[i] = getRandomChar()
    // 随机设置每列的起始位置
    drops.value[i] = Math.floor((Math.random() * canvas.value.height) / fontSize.value)
  }
}

// 获取随机字符
function getRandomChar() {
  // 矩阵数字雨使用的字符集
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return chars.charAt(Math.floor(Math.random() * chars.length))
}

// 绘制数字雨
function draw() {
  if (!ctx.value || !canvas.value) return

  // 设置半透明背景，形成拖尾效果
  ctx.value.fillStyle = 'rgba(0, 0, 0, 0.05)'
  ctx.value.fillRect(0, 0, canvas.value.width, canvas.value.height)

  // 设置字体
  ctx.value.font = `${fontSize.value}px 'Share Tech Mono', monospace`

  // 绘制每列
  for (let i = 0; i < columns.value.length; i++) {
    // 随机设置字符颜色
    const randomOpacity = Math.random() * 0.5 + 0.5
    const y = drops.value[i] * fontSize.value

    // 设置渐变颜色
    const gradient = ctx.value.createLinearGradient(0, y - fontSize.value * 5, 0, y)
    gradient.addColorStop(0, 'rgba(0, 255, 0, 0)')
    gradient.addColorStop(0.8, `rgba(0, 255, 0, ${randomOpacity})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 1)')

    ctx.value.fillStyle = gradient

    // 绘制字符
    ctx.value.fillText(columns.value[i], i * fontSize.value, y)

    // 随机更换字符
    if (Math.random() > 0.98) {
      columns.value[i] = getRandomChar()
    }

    // 移动字符位置
    drops.value[i]++

    // 如果字符超出屏幕底部，重置到顶部
    if (y > canvas.value.height && Math.random() > 0.99) {
      drops.value[i] = 0
    }
  }

  // 请求下一帧动画
  if (props.enabled) {
    animationId.value = requestAnimationFrame(draw)
  }
}

// 启动动画
function startAnimation() {
  if (animationId.value) {
    cancelAnimationFrame(animationId.value)
  }

  if (props.enabled) {
    animationId.value = requestAnimationFrame(draw)
  }
}

// 停止动画
function stopAnimation() {
  if (animationId.value) {
    cancelAnimationFrame(animationId.value)
    animationId.value = null
  }
}

// 组件挂载时初始化
onMounted(() => {
  // 初始化画布
  initCanvas()

  // 监听窗口大小变化
  window.addEventListener('resize', resizeCanvas)

  // 启动动画
  if (props.enabled) {
    startAnimation()
  }
})

// 组件卸载时清理
onUnmounted(() => {
  // 停止动画
  stopAnimation()

  // 移除事件监听
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<template>
  <canvas ref="canvas" class="matrix-rain" v-show="props.enabled"></canvas>
</template>

<style scoped>
.matrix-rain {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
}
</style>
