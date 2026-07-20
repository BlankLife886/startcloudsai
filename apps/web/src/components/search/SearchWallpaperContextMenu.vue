<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  x: {
    type: Number,
    default: 0,
  },
  y: {
    type: Number,
    default: 0,
  },
  wallpaper: {
    type: Object,
    default: null,
  },
  visibleActions: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['close', 'action'])

const menuRef = ref(null)
const pos = ref({ left: 0, top: 0 })

function layout() {
  const pad = 8
  const w = 200
  const h = 220
  let left = props.x
  let top = props.y
  if (typeof window !== 'undefined') {
    left = Math.min(left, window.innerWidth - w - pad)
    top = Math.min(top, window.innerHeight - h - pad)
  }
  pos.value = { left: Math.max(pad, left), top: Math.max(pad, top) }
}

watch(
  () => [props.show, props.x, props.y],
  () => {
    if (props.show) layout()
  },
)

function onDocPointerDown(e) {
  if (!props.show) return
  const el = menuRef.value
  if (el && el.contains(e.target)) return
  emit('close')
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})

const wallId = computed(() => (props.wallpaper?.id ? String(props.wallpaper.id) : ''))
const actions = computed(() => ({
  preview: props.visibleActions.preview !== false,
  detail: props.visibleActions.detail !== false,
  similar: props.visibleActions.similar !== false,
  pending: props.visibleActions.pending !== false,
  copy: props.visibleActions.copy !== false,
  wallhaven: props.visibleActions.wallhaven !== false,
}))

function fire(action) {
  emit('action', action)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show && wallpaper"
      ref="menuRef"
      class="ctx-menu"
      role="menu"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
    >
      <button v-if="actions.preview" type="button" class="ctx-item" role="menuitem" @click="fire('preview')">
        <i class="bi bi-arrows-fullscreen me-2" />全屏预览
      </button>
      <button v-if="actions.detail" type="button" class="ctx-item" role="menuitem" @click="fire('detail')">
        <i class="bi bi-layout-sidebar-inset-reverse me-2" />半屏详情
      </button>
      <button v-if="actions.similar" type="button" class="ctx-item" role="menuitem" @click="fire('similar')">
        <i class="bi bi-shuffle me-2" />找相似
      </button>
      <button v-if="actions.pending" type="button" class="ctx-item" role="menuitem" @click="fire('pending')">
        <i class="bi bi-inbox me-2" />加入待定池
      </button>
      <button v-if="actions.copy" type="button" class="ctx-item" role="menuitem" @click="fire('copy')">
        <i class="bi bi-clipboard me-2" />复制链接
      </button>
      <a
        v-if="actions.wallhaven"
        class="ctx-item ctx-link"
        :href="`https://wallhaven.cc/w/${wallId}`"
        target="_blank"
        rel="noopener noreferrer"
        @click="emit('close')"
      >
        <i class="bi bi-box-arrow-up-right me-2" />Wallhaven 打开
      </a>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 250;
  min-width: 200px;
  padding: 6px 0;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  background: var(--card-bg-color);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 14px;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: 0.88rem;
  color: var(--text-color);
  cursor: pointer;
  text-decoration: none;
}

.ctx-item:hover {
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.ctx-link {
  color: inherit;
}
</style>
