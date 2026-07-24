<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { listPromptLibrary, recordPromptEngagement } from '@/services/promptLibrary'

const props = defineProps({
  show: { type: Boolean, default: false },
  activeTab: { type: String, default: 'assets' },
  historyItems: { type: Array, default: () => [] },
  activeHistoryId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'change-tab', 'select-history', 'apply-prompt'])

const promptItems = ref([])
const promptLoading = ref(false)
const promptLoaded = ref(false)

const tabs = [
  { id: 'assets', label: '资产库', icon: 'bi-images' },
  { id: 'history', label: '历史记录', icon: 'bi-clock-history' },
  { id: 'prompts', label: '提示词库', icon: 'bi-journal-text' },
]

const assets = computed(() =>
  props.historyItems.filter((item) => {
    const status = String(item?.status || '').toLowerCase()
    return ['completed', 'done'].includes(status) && Boolean(item?.resultUrl || item?.outputs?.[0])
  }),
)

function imageUrl(item) {
  return String(
    item?.resultThumbUrl || item?.resultUrl || item?.outputs?.[0] || item?.sourceThumbUrl || '',
  ).trim()
}

function statusLabel(item) {
  return (
    {
      queued: '排队中',
      running: '染色中',
      waiting_provider: '等待模型',
      completed: '已完成',
      done: '已完成',
      failed: '失败',
      paused: '已暂停',
      cancelled: '已取消',
      canceled: '已取消',
    }[String(item?.status || '').toLowerCase()] || '处理中'
  )
}

async function loadPrompts({ force = false } = {}) {
  if (promptLoading.value || (promptLoaded.value && !force)) return
  promptLoading.value = true
  try {
    const response = await listPromptLibrary('coloring', { pageNumber: 1, pageSize: 48 })
    promptItems.value = Array.isArray(response?.items) ? response.items : []
    promptLoaded.value = true
  } finally {
    promptLoading.value = false
  }
}

function applyPrompt(item) {
  emit('apply-prompt', item)
  if (item?.id) void recordPromptEngagement(item.id, 'use').catch(() => undefined)
}

function onKeydown(event) {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => [props.show, props.activeTab],
  ([show, tab]) => {
    if (show) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
    if (show && tab === 'prompts') void loadPrompts()
  },
  { immediate: true },
)

onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="coloring-library">
      <div v-if="show" class="coloring-library-backdrop" @click.self="emit('close')">
        <aside class="coloring-library-drawer" role="dialog" aria-modal="true" aria-label="染色资源">
          <header class="coloring-library-head">
            <div>
              <strong>染色资源</strong>
              <small>选择结果、任务或配色提示词</small>
            </div>
            <button type="button" aria-label="关闭" title="关闭" @click="emit('close')">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <nav class="coloring-library-tabs" role="tablist">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.id"
              :class="{ active: activeTab === tab.id }"
              @click="emit('change-tab', tab.id)"
            >
              <i class="bi" :class="tab.icon"></i>
              {{ tab.label }}
              <em v-if="tab.id === 'assets'">{{ assets.length }}</em>
              <em v-else-if="tab.id === 'history'">{{ historyItems.length }}</em>
            </button>
          </nav>

          <div class="coloring-library-body">
            <div v-if="activeTab === 'assets' && !assets.length" class="coloring-library-empty">
              <i class="bi bi-images"></i>
              <strong>还没有染色资产</strong>
              <span>完成的染色结果会自动保存在这里。</span>
            </div>
            <div v-else-if="activeTab === 'assets'" class="coloring-library-grid">
              <button
                v-for="item in assets"
                :key="item.id"
                type="button"
                class="coloring-library-card"
                :class="{ active: activeHistoryId === item.id }"
                @click="emit('select-history', item)"
              >
                <span class="coloring-library-image">
                  <AuthenticatedImage :src="imageUrl(item)" alt="" loading="lazy" root-margin="320px 0px" />
                </span>
                <strong>{{ item.title || '插画染色' }}</strong>
                <small>{{ item.outputOrientation || '原图比例' }} · {{ item.outputSize || '2K' }}</small>
              </button>
            </div>

            <div v-else-if="activeTab === 'history' && !historyItems.length" class="coloring-library-empty">
              <i class="bi bi-clock-history"></i>
              <strong>暂无历史记录</strong>
              <span>创建任务后可在这里查看进度和结果。</span>
            </div>
            <div v-else-if="activeTab === 'history'" class="coloring-library-list">
              <button
                v-for="item in historyItems"
                :key="item.id"
                type="button"
                :class="{ active: activeHistoryId === item.id }"
                @click="emit('select-history', item)"
              >
                <span class="coloring-library-list-thumb">
                  <AuthenticatedImage
                    v-if="imageUrl(item)"
                    :src="imageUrl(item)"
                    alt=""
                    loading="lazy"
                    root-margin="320px 0px"
                  />
                  <i v-else class="bi bi-palette2"></i>
                </span>
                <span>
                  <strong>{{ item.title || '插画染色' }}</strong>
                  <small>{{ statusLabel(item) }}</small>
                </span>
                <i class="bi bi-chevron-right"></i>
              </button>
            </div>

            <div v-else-if="promptLoading" class="coloring-library-loading">
              <i class="bi bi-arrow-repeat spin"></i>
              正在读取提示词库…
            </div>
            <div v-else-if="!promptItems.length" class="coloring-library-empty">
              <i class="bi bi-journal-text"></i>
              <strong>提示词库暂时为空</strong>
              <span>管理员添加并分配到“插画染色”后会显示在这里。</span>
              <button type="button" @click="loadPrompts({ force: true })">重新加载</button>
            </div>
            <div v-else class="coloring-prompt-list">
              <button
                v-for="item in promptItems"
                :key="item.id"
                type="button"
                @click="applyPrompt(item)"
              >
                <AuthenticatedImage
                  v-if="item.coverUrl || item.imageUrl"
                  :src="item.coverUrl || item.imageUrl"
                  alt=""
                  loading="lazy"
                  root-margin="320px 0px"
                />
                <span>
                  <strong>{{ item.title || item.label || '配色提示词' }}</strong>
                  <small>{{ item.prompt }}</small>
                </span>
                <i class="bi bi-plus-circle"></i>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.coloring-library-backdrop { position: fixed; inset: 0; z-index: 1180; background: rgba(4, 3, 8, .64); backdrop-filter: blur(5px); }
.coloring-library-drawer { width: min(440px, 92vw); height: 100%; display: flex; flex-direction: column; color: #fff; background: rgba(15, 12, 20, .97); border-right: 1px solid rgba(255,255,255,.1); box-shadow: 24px 0 70px rgba(0,0,0,.42); }
.coloring-library-head { min-height: 68px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(255,255,255,.07); }
.coloring-library-head strong,.coloring-library-head small { display: block; }
.coloring-library-head strong { font-size: .95rem; }
.coloring-library-head small { margin-top: 3px; color: rgba(255,255,255,.46); font-size: .7rem; }
.coloring-library-head button { width: 34px; height: 34px; border: 0; border-radius: 9px; color: rgba(255,255,255,.7); background: rgba(255,255,255,.05); }
.coloring-library-tabs { padding: 10px 12px; display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; border-bottom: 1px solid rgba(255,255,255,.06); }
.coloring-library-tabs button { min-width: 0; min-height: 38px; border: 0; border-radius: 9px; color: rgba(255,255,255,.54); background: transparent; font-size: .72rem; }
.coloring-library-tabs button.active { color: #fff; background: rgba(244,114,182,.13); }
.coloring-library-tabs em { margin-left: 4px; color: rgba(255,255,255,.42); font-style: normal; font-size: .64rem; }
.coloring-library-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; overscroll-behavior: contain; }
.coloring-library-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
.coloring-library-card { min-width: 0; padding: 7px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; color: #fff; background: rgba(255,255,255,.035); text-align: left; }
.coloring-library-card.active { border-color: rgba(244,114,182,.48); background: rgba(244,114,182,.08); }
.coloring-library-image { aspect-ratio: 1; display: block; overflow: hidden; border-radius: 7px; background: rgba(255,255,255,.04); }
.coloring-library-image :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.coloring-library-card strong,.coloring-library-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coloring-library-card strong { margin-top: 7px; font-size: .74rem; }
.coloring-library-card small { margin-top: 3px; color: rgba(255,255,255,.42); font-size: .64rem; }
.coloring-library-list,.coloring-prompt-list { display: grid; gap: 7px; }
.coloring-library-list > button,.coloring-prompt-list > button { width: 100%; min-width: 0; padding: 8px; display: grid; grid-template-columns: 48px minmax(0,1fr) auto; align-items: center; gap: 10px; border: 1px solid rgba(255,255,255,.06); border-radius: 10px; color: #fff; background: rgba(255,255,255,.03); text-align: left; }
.coloring-library-list > button.active { border-color: rgba(244,114,182,.44); background: rgba(244,114,182,.08); }
.coloring-library-list-thumb { width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden; border-radius: 8px; color: rgba(255,255,255,.38); background: rgba(255,255,255,.05); }
.coloring-library-list-thumb :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.coloring-library-list strong,.coloring-library-list small,.coloring-prompt-list strong,.coloring-prompt-list small { display: block; }
.coloring-library-list strong,.coloring-prompt-list strong { font-size: .75rem; }
.coloring-library-list small { margin-top: 4px; color: rgba(255,255,255,.44); font-size: .66rem; }
.coloring-prompt-list > button { grid-template-columns: 64px minmax(0,1fr) auto; align-items: start; }
.coloring-prompt-list :deep(img) { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
.coloring-prompt-list small { margin-top: 5px; color: rgba(255,255,255,.52); font-size: .67rem; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.coloring-prompt-list > button:not(:has(img)) { grid-template-columns: minmax(0,1fr) auto; }
.coloring-library-empty,.coloring-library-loading { min-height: 240px; display: grid; place-items: center; align-content: center; gap: 8px; color: rgba(255,255,255,.46); text-align: center; }
.coloring-library-empty > i { font-size: 1.6rem; color: #f9a8d4; }
.coloring-library-empty strong { color: rgba(255,255,255,.82); font-size: .86rem; }
.coloring-library-empty span { font-size: .7rem; }
.coloring-library-empty button { margin-top: 6px; border: 0; border-radius: 8px; padding: 7px 10px; color: #fff; background: rgba(244,114,182,.14); }
.coloring-library-enter-active,.coloring-library-leave-active { transition: opacity .2s ease; }
.coloring-library-enter-active .coloring-library-drawer,.coloring-library-leave-active .coloring-library-drawer { transition: transform .26s cubic-bezier(.22,1,.36,1); }
.coloring-library-enter-from,.coloring-library-leave-to { opacity: 0; }
.coloring-library-enter-from .coloring-library-drawer,.coloring-library-leave-to .coloring-library-drawer { transform: translateX(-100%); }
</style>
