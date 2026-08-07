<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { TASK_TYPE_LABELS, TASK_UPDATE_EVENT, listTasks } from '@/services/tasksApi'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  compact: { type: Boolean, default: false },
})
const authStore = useAuthStore()

const open = ref(false)
const activeTasks = ref([])
const activeTasksLoading = ref(false)
let closeTimer = null
let taskPollTimer = null
let activeTasksRequest = null
const CLOSE_DELAY_MS = 120
const TASK_POLL_MS = 12_000
const rootRef = ref(null)
const ACTIVE_TASK_STATUSES = new Set(['queued', 'running'])

const previewList = computed(() => {
  return [...activeTasks.value]
    .filter((task) => ACTIVE_TASK_STATUSES.has(normalizeTaskStatus(task?.status)))
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
    .slice(0, 8)
})
const activeTaskCount = computed(() => activeTasks.value.length)
const hasActiveTasks = computed(() => activeTaskCount.value > 0)
const badgeLabel = computed(() =>
  activeTaskCount.value > 99 ? '99+' : String(activeTaskCount.value || ''),
)

function normalizeTaskStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
}

function taskTimestamp(task) {
  const value = task?.startedAt || task?.createdAt || task?.updatedAt
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function taskTypeLabel(task) {
  return TASK_TYPE_LABELS[String(task?.type || '')] || 'AI 创作'
}

function taskStatusLabel(task) {
  return normalizeTaskStatus(task?.status) === 'running' ? '正在生成' : '排队等待'
}

function taskDescription(task) {
  const prompt = String(task?.prompt || '').trim()
  if (prompt) return prompt
  const count = Math.max(1, Number(task?.count) || 1)
  return count > 1 ? `本次将生成 ${count} 张图片` : '任务已提交，结果生成后会自动同步'
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function clearCloseTimer() {
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

function openPanel() {
  clearCloseTimer()
  open.value = true
  void refreshActiveTasks()
}

function scheduleClose() {
  clearCloseTimer()
  closeTimer = window.setTimeout(() => {
    closeTimer = null
    open.value = false
  }, CLOSE_DELAY_MS)
}

function onFocusOut(event) {
  const root = rootRef.value
  const next = event.relatedTarget
  if (root instanceof Element && next instanceof Node && root.contains(next)) return
  scheduleClose()
}

function closePanel() {
  clearCloseTimer()
  open.value = false
}

function togglePanel() {
  if (open.value) closePanel()
  else openPanel()
}

function onDocumentClick(event) {
  if (!open.value) return
  const root = rootRef.value
  if (root instanceof Element && event.target instanceof Node && root.contains(event.target)) {
    return
  }
  closePanel()
}

function onEscape(event) {
  if (event.key === 'Escape' && open.value) closePanel()
}

function mergeActiveTask(task) {
  const id = String(task?.id || '').trim()
  if (!id) return
  const status = normalizeTaskStatus(task?.status)
  if (!ACTIVE_TASK_STATUSES.has(status)) {
    activeTasks.value = activeTasks.value.filter((item) => String(item?.id) !== id)
    return
  }
  const index = activeTasks.value.findIndex((item) => String(item?.id) === id)
  if (index < 0) {
    activeTasks.value = [task, ...activeTasks.value]
    return
  }
  activeTasks.value = activeTasks.value.map((item, at) =>
    at === index ? { ...item, ...task } : item,
  )
}

async function refreshActiveTasks() {
  if (!authStore.isAuthenticated) {
    activeTasks.value = []
    return []
  }
  if (activeTasksRequest) return activeTasksRequest
  activeTasksLoading.value = true
  const request = Promise.all([
    listTasks({ status: 'queued', limit: 8 }),
    listTasks({ status: 'running', limit: 8 }),
  ])
    .then(([queued, running]) => {
      if (!authStore.isAuthenticated) {
        activeTasks.value = []
        return []
      }
      const unique = new Map()
      for (const task of [...(running.items || []), ...(queued.items || [])]) {
        if (task?.id) unique.set(String(task.id), task)
      }
      activeTasks.value = [...unique.values()]
      return activeTasks.value
    })
    .catch(() => activeTasks.value)
    .finally(() => {
      activeTasksLoading.value = false
      if (activeTasksRequest === request) activeTasksRequest = null
    })
  activeTasksRequest = request
  return request
}

function pollActiveTasks() {
  if (document.visibilityState !== 'visible') return
  void refreshActiveTasks()
}

function startTaskPolling() {
  if (taskPollTimer) window.clearInterval(taskPollTimer)
  taskPollTimer = null
  if (!authStore.isAuthenticated) return
  taskPollTimer = window.setInterval(pollActiveTasks, TASK_POLL_MS)
}

function handleRealtimeTaskUpdate(event) {
  if (!event?.detail?.task) return
  mergeActiveTask(event.detail.task)
}

watch(open, (isOpen) => {
  if (isOpen) void refreshActiveTasks()
})

watch(
  () => authStore.isAuthenticated,
  () => {
    startTaskPolling()
    pollActiveTasks()
  },
)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onEscape)
  window.addEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  window.addEventListener('focus', pollActiveTasks)
  document.addEventListener('visibilitychange', pollActiveTasks)
  startTaskPolling()
  void refreshActiveTasks()
})

onBeforeUnmount(() => {
  clearCloseTimer()
  if (taskPollTimer) window.clearInterval(taskPollTimer)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onEscape)
  document.removeEventListener('visibilitychange', pollActiveTasks)
  window.removeEventListener('focus', pollActiveTasks)
  window.removeEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
})
</script>

<template>
  <div
    ref="rootRef"
    class="nav-notify"
    :class="{ open, compact: props.compact, 'has-unread': hasActiveTasks }"
    @mouseenter="openPanel"
    @mouseleave="scheduleClose"
    @focusin="openPanel"
    @focusout="onFocusOut"
  >
    <button
      type="button"
      class="nav-notify__btn"
      :aria-expanded="open"
      aria-haspopup="dialog"
      aria-label="通知"
      title="通知"
      @click.stop="togglePanel"
    >
      <i class="bi bi-bell" aria-hidden="true"></i>
      <em v-if="hasActiveTasks" class="nav-notify__badge">{{ badgeLabel }}</em>
    </button>

    <Transition name="nav-notify-panel">
      <div
        v-if="open"
        class="nav-notify__panel"
        role="dialog"
        aria-label="进行中的任务"
        @click.stop
      >
        <header class="nav-notify__head">
          <div>
            <strong>进行中的任务</strong>
            <small v-if="hasActiveTasks">{{ activeTaskCount }} 个任务正在处理</small>
            <small v-else>没有正在处理的任务</small>
          </div>
          <span v-if="hasActiveTasks" class="nav-notify__live"><i></i>实时更新</span>
        </header>

        <div v-if="activeTasksLoading && !previewList.length" class="nav-notify__loading">
          正在读取任务…
        </div>

        <ul v-else-if="previewList.length" class="nav-notify__list">
          <li v-for="item in previewList" :key="item.id" class="is-unread">
            <span
              class="nav-notify__dot"
              :class="`is-${normalizeTaskStatus(item.status)}`"
              aria-hidden="true"
            ></span>
            <div>
              <div class="nav-notify__task-title">
                <strong>{{ taskTypeLabel(item) }}</strong>
                <em>{{ taskStatusLabel(item) }}</em>
              </div>
              <p>{{ taskDescription(item) }}</p>
              <div class="nav-notify__meta">
                <small>{{ formatTime(item.createdAt) }}</small>
                <small v-if="Number(item.count) > 1">{{ item.count }} 张</small>
              </div>
            </div>
          </li>
        </ul>

        <div v-else class="nav-notify__empty">
          <i class="bi bi-check2-circle" aria-hidden="true"></i>
          <p>暂无进行中的任务</p>
        </div>

        <footer class="nav-notify__foot">
          <RouterLink to="/history" @click="closePanel">查看任务历史</RouterLink>
        </footer>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.nav-notify {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 36px;
}

.nav-notify__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
  border: 1px solid rgba(21, 22, 31, 0.1);
  border-radius: 999px;
  background: #ffffff;
  color: var(--nav-accent, #5b4dff);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  line-height: 1;
}

.nav-notify__btn i {
  font-size: 1rem;
  line-height: 1;
}

.nav-notify__btn:hover,
.nav-notify.open .nav-notify__btn {
  border-color: rgba(91, 77, 255, 0.28);
  color: var(--nav-accent, #5b4dff);
  filter: brightness(0.98);
}

.nav-notify__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-style: normal;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}

.nav-notify__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: min(360px, calc(100vw - 24px));
  border-radius: 18px;
  border: 1px solid rgba(28, 26, 39, 0.1);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 22px 48px rgba(28, 22, 60, 0.16);
  backdrop-filter: blur(16px);
  overflow: hidden;
  z-index: 80;
}

.nav-notify__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid rgba(28, 26, 39, 0.08);
}

.nav-notify__head strong {
  display: block;
  font-size: 0.92rem;
  font-weight: 800;
  color: #1c1a27;
}

.nav-notify__head small {
  display: block;
  margin-top: 2px;
  color: rgba(28, 26, 39, 0.55);
  font-size: 0.72rem;
}

.nav-notify__live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 8px;
  color: #167a65;
  background: rgba(22, 122, 101, 0.08);
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 750;
  white-space: nowrap;
}

.nav-notify__live i {
  width: 6px;
  height: 6px;
  background: #1aa382;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(26, 163, 130, 0.12);
  animation: nav-notify-live 1.4s ease-in-out infinite;
}

.nav-notify__mark {
  border: 0;
  background: transparent;
  color: #6b5cff;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 0;
  white-space: nowrap;
}

.nav-notify__mark:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-notify__list {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: grid;
  gap: 6px;
  max-height: min(420px, 55vh);
  overflow: auto;
}

.nav-notify__list li {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 10px;
  border-radius: 12px;
  background: transparent;
}

.nav-notify__list li.is-unread {
  background: rgba(107, 92, 255, 0.08);
}

.nav-notify__dot {
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: rgba(28, 26, 39, 0.18);
}

.nav-notify__list li.is-unread .nav-notify__dot {
  background: #6b5cff;
}

.nav-notify__dot.is-running {
  background: #19a57f !important;
  box-shadow: 0 0 0 4px rgba(25, 165, 127, 0.11);
  animation: nav-notify-live 1.4s ease-in-out infinite;
}

.nav-notify__dot.is-queued {
  background: #7a68ef !important;
  box-shadow: 0 0 0 4px rgba(122, 104, 239, 0.1);
}

.nav-notify__task-title {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.nav-notify__task-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-notify__task-title em {
  flex: 0 0 auto;
  color: #167a65;
  font-size: 0.66rem;
  font-style: normal;
  font-weight: 750;
}

.nav-notify__list strong {
  display: block;
  font-size: 0.8rem;
  font-weight: 750;
  color: #1c1a27;
  line-height: 1.35;
}

.nav-notify__list p {
  margin: 4px 0 0;
  color: rgba(28, 26, 39, 0.58);
  font-size: 0.74rem;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.nav-notify__list small {
  display: block;
  color: rgba(28, 26, 39, 0.45);
  font-size: 0.68rem;
}

.nav-notify__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 7px;
}

.nav-notify__meta button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: #167a65;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 0.69rem;
  font-weight: 750;
  cursor: pointer;
}

.nav-notify__empty,
.nav-notify__loading {
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 36px 16px;
  color: rgba(28, 26, 39, 0.5);
  font-size: 0.82rem;
  text-align: center;
}

.nav-notify__empty i {
  font-size: 1.25rem;
  color: #6b5cff;
}

.nav-notify__empty p {
  margin: 0;
}

.nav-notify__foot {
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(28, 26, 39, 0.08);
}

.nav-notify__foot a {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border-radius: 999px;
  background: rgba(107, 92, 255, 0.1);
  color: #5b4dff;
  text-decoration: none;
  font-size: 0.78rem;
  font-weight: 750;
}

.nav-notify__foot a:hover {
  background: rgba(107, 92, 255, 0.16);
}

.nav-notify-panel-enter-active,
.nav-notify-panel-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.nav-notify-panel-enter-from,
.nav-notify-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@keyframes nav-notify-live {
  0%,
  100% {
    opacity: 0.58;
    transform: scale(0.86);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav-notify__live i,
  .nav-notify__dot.is-running {
    animation: none;
  }
}

.nav-notify.compact {
  height: 32px;
}

.nav-notify.compact .nav-notify__btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
}
</style>
