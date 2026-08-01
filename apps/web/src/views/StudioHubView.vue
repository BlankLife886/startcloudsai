<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { listTasks } from '@/services/tasksApi'
import { STUDIO_TOOLS, stashPendingPrompt } from '@/features/creator-hub/studioTools'
import { taskCoverUrl, taskOriginalUrl, taskThumbnailUrl } from '@/features/creator-hub/taskMedia'
import { taskAspectCss, useMasonryColumns } from '@/features/creator-hub/useMasonryFeed'
import { useStudioHubMotion } from '@/features/creator-hub/useStudioHubMotion'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import TypeLine from '@/features/home-commercial/components/TypeLine.vue'
import notificationService from '@/services/notification'
import '@/features/creator-hub/studio-hub.css'

const router = useRouter()
const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()

const rootRef = ref(null)
const draftPrompt = ref('')
const selectedToolId = ref('t2i')
const recentTasks = ref([])
const recentLoading = ref(false)
const failedThumbIds = ref(new Set())
let allowAutoPinTop = true
let pinTopTimers = []

useStudioHubMotion(rootRef)

const leadLines = [
  '先写下想法，再选择工具。从一句话开始，做到成品。',
  '文生图、染色、模型图、游戏资产——一条创作流。',
  '提示词可复用，进度可回看，结果可继续迭代。',
]

function clearPinTopTimers() {
  pinTopTimers.forEach((id) => window.clearTimeout(id))
  pinTopTimers = []
}

function pinTopIfNeeded() {
  if (!allowAutoPinTop || typeof window === 'undefined') return
  window.scrollTo(0, 0)
}

function schedulePinTop() {
  pinTopIfNeeded()
  if (typeof window === 'undefined') return
  requestAnimationFrame(() => pinTopIfNeeded())
  clearPinTopTimers()
  pinTopTimers = [80, 220, 480].map((delay) => window.setTimeout(() => pinTopIfNeeded(), delay))
}

function onUserScrollIntent() {
  allowAutoPinTop = false
  clearPinTopTimers()
}

function onUserKeyScrollIntent(event) {
  const key = String(event?.key || '')
  if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key)) return
  onUserScrollIntent()
}

const visibleTools = computed(() =>
  STUDIO_TOOLS.filter((tool) => {
    if (tool.feature && !runtimeConfigStore.isFeatureEnabled(tool.feature)) return false
    return runtimeConfigStore.isRouteVisible(tool.to)
  }),
)

const composerTools = computed(() => visibleTools.value.filter((tool) => tool.taskType))

/** 工具墙展示顺序：助手 + 模型并排，其余环绕 */
const TOOL_WALL_ORDER = ['assistant', 'model', 't2i', 'coloring', 'ui', 'game', 'puzzle']
const wallTools = computed(() => {
  const map = new Map(visibleTools.value.map((tool) => [tool.id, tool]))
  const ordered = TOOL_WALL_ORDER.map((id) => map.get(id)).filter(Boolean)
  const rest = visibleTools.value.filter((tool) => !TOOL_WALL_ORDER.includes(tool.id))
  return [...ordered, ...rest]
})

const selectedTool = computed(
  () =>
    composerTools.value.find((tool) => tool.id === selectedToolId.value) ||
    composerTools.value[0] ||
    null,
)

watch(
  composerTools,
  (tools) => {
    if (!tools.some((tool) => tool.id === selectedToolId.value)) {
      selectedToolId.value = tools[0]?.id || 't2i'
    }
  },
  { immediate: true },
)

function taskPrompt(task) {
  return String(
    task?.params?.userPrompt || task?.userPrompt || task?.params?.prompt || task?.prompt || '',
  ).trim()
}

function coverSrc(task) {
  const thumb = taskThumbnailUrl(task)
  const original = taskOriginalUrl(task)
  if (failedThumbIds.value.has(task.id)) return original || thumb
  return thumb || original
}

function onCoverError(task) {
  const id = String(task?.id || '')
  if (!id || failedThumbIds.value.has(id)) return
  const thumb = taskThumbnailUrl(task)
  const original = taskOriginalUrl(task)
  if (thumb && original && thumb !== original) {
    failedThumbIds.value = new Set([...failedThumbIds.value, id])
  }
}

function onToolCoverError(event, tool) {
  const img = event?.target
  if (!img || !tool?.cover) return
  const png = String(tool.cover).replace(/\.webp$/i, '.png')
  if (png !== tool.cover && img.getAttribute('src') !== png) img.src = png
}

const masonryItems = computed(() =>
  recentTasks.value.map((task, index) => ({
    key: String(task.id),
    task,
    index,
    aspect: taskAspectCss(task),
    src: coverSrc(task),
  })),
)

const { columns: masonryColumns, columnCount, measureFromEvent } = useMasonryColumns({
  items: masonryItems,
})

function imageLoadingMode(index) {
  return index < Math.max(4, columnCount.value * 2) ? 'eager' : 'lazy'
}

async function loadRecent() {
  if (!authStore.isAuthenticated) {
    recentTasks.value = []
    return
  }
  recentLoading.value = true
  try {
    const { items } = await listTasks({ limit: 12 })
    recentTasks.value = (items || []).filter(
      (task) => taskCoverUrl(task) || String(task.status || '') === 'succeeded',
    )
  } catch {
    recentTasks.value = []
  } finally {
    recentLoading.value = false
  }
}

function startCreate() {
  const tool = selectedTool.value
  if (!tool) return
  const prompt = draftPrompt.value.trim()
  if (prompt) {
    stashPendingPrompt({ prompt, taskType: tool.taskType || tool.id || 't2i' })
    notificationService.success('已带到工作台')
  }
  router.push(tool.to)
}

watch(
  () => authStore.isAuthenticated,
  async () => {
    await loadRecent()
    await nextTick()
    schedulePinTop()
  },
)

onMounted(async () => {
  try {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  } catch {
    // ignore
  }
  window.scrollTo(0, 0)
  window.addEventListener('wheel', onUserScrollIntent, { passive: true })
  window.addEventListener('touchmove', onUserScrollIntent, { passive: true })
  window.addEventListener('keydown', onUserKeyScrollIntent, { passive: true })

  await nextTick()
  schedulePinTop()
  await loadRecent()
  await nextTick()
  schedulePinTop()
})

onBeforeUnmount(() => {
  clearPinTopTimers()
  window.removeEventListener('wheel', onUserScrollIntent)
  window.removeEventListener('touchmove', onUserScrollIntent)
  window.removeEventListener('keydown', onUserKeyScrollIntent)
})
</script>

<template>
  <main ref="rootRef" class="studio-hub">
    <div class="studio-hub__atmosphere" aria-hidden="true">
      <div class="studio-hub__aurora"></div>
      <div class="studio-hub__blinds"></div>
      <span class="studio-hub__orb is-a" data-studio-orb></span>
      <span class="studio-hub__orb is-b" data-studio-orb></span>
    </div>

    <div class="studio-hub__shell">
      <header class="studio-hero">
        <h1 class="studio-hero__brand" data-studio-enter>星空云绘</h1>
        <div class="studio-hero__lead" data-studio-enter>
          <TypeLine :texts="leadLines" :typing-speed="42" :pause-duration="2200" />
        </div>

        <form class="studio-composer" data-studio-enter @submit.prevent="startCreate">
          <textarea
            v-model="draftPrompt"
            class="studio-composer__input"
            rows="3"
            maxlength="2000"
            placeholder="描述你想做的画面、角色、风格或界面…"
          />
          <div class="studio-composer__bar">
            <div class="studio-composer__tools" role="tablist" aria-label="创作工具">
              <button
                v-for="tool in composerTools"
                :key="tool.id"
                type="button"
                class="studio-composer__tool"
                :class="{ 'is-active': selectedToolId === tool.id }"
                role="tab"
                :aria-selected="selectedToolId === tool.id"
                @click="selectedToolId = tool.id"
              >
                {{ tool.label }}
              </button>
            </div>
            <button type="submit" class="studio-composer__submit" :disabled="!selectedTool">
              <i class="bi bi-stars" aria-hidden="true"></i>
              开始创作
            </button>
          </div>
        </form>
      </header>

      <section class="studio-section" aria-label="创作工具" data-studio-reveal>
        <div class="studio-section__head">
          <div>
            <h2>创作工具</h2>
          </div>
          <router-link to="/prompts">去提示词库 →</router-link>
        </div>

        <div v-if="wallTools.length" class="studio-bento">
          <router-link
            v-for="tool in wallTools"
            :key="`bento-${tool.id}`"
            :to="tool.to"
            class="studio-bento__item"
            :class="`is-${tool.id}`"
            data-studio-tool
          >
            <img
              :src="tool.cover"
              :alt="tool.label"
              loading="lazy"
              decoding="async"
              @error="onToolCoverError($event, tool)"
            />
            <div class="studio-bento__copy">
              <strong>
                <i class="bi" :class="tool.icon" aria-hidden="true"></i>
                {{ tool.label }}
              </strong>
              <span>{{ tool.tagline }}</span>
            </div>
          </router-link>
        </div>
      </section>

      <section
        class="studio-section studio-section--recent"
        aria-label="最近创作"
        data-studio-reveal
      >
        <div class="studio-section__head">
          <div>
            <h2>最近创作</h2>
          </div>
          <router-link to="/history">查看全部 →</router-link>
        </div>

        <div v-if="!authStore.isAuthenticated" class="studio-recent-login">
          <strong>登录后查看最近作品</strong>
          <span>同步云端任务进度与历史记录</span>
          <router-link class="ch-btn is-primary" :to="{ name: 'auth', query: { mode: 'login' } }">
            去登录
          </router-link>
        </div>

        <div v-else-if="recentLoading" class="studio-recent-loading">正在读取最近创作…</div>

        <div v-else-if="!recentTasks.length" class="studio-recent-empty">
          <strong>还没有作品</strong>
          <span>在上方输入想法，或从工具墙开始第一次创作</span>
        </div>

        <div v-else class="ch-masonry" :style="{ '--ch-masonry-cols': columnCount }">
          <div
            v-for="(column, columnIndex) in masonryColumns"
            :key="`recent-col-${columnIndex}`"
            class="ch-masonry__col"
          >
            <router-link
              v-for="item in column"
              :key="item.key"
              class="ch-card"
              to="/history"
              :title="taskPrompt(item.task) || '查看历史'"
            >
              <div class="ch-card__media" :style="{ aspectRatio: item.aspect }">
                <AuthenticatedImage
                  v-if="item.src"
                  :key="`${item.key}:${failedThumbIds.has(item.key) ? 'orig' : 'thumb'}`"
                  :src="item.src"
                  :alt="taskPrompt(item.task) || 'AI 作品'"
                  :loading="imageLoadingMode(item.index)"
                  root-margin="240px 0px"
                  :retry-count="2"
                  :max-dimension="failedThumbIds.has(item.key) ? 0 : 720"
                  @load="measureFromEvent(item.key, $event)"
                  @error="onCoverError(item.task)"
                />
                <div v-else class="ch-card__placeholder">
                  <i class="bi bi-image" aria-hidden="true"></i>
                </div>
              </div>
            </router-link>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
