<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { listPromptLibrary, recordPromptEngagement } from '@/services/promptLibrary'
import { useAppearanceStore } from '@/stores/appearance'

const appearanceStore = useAppearanceStore()

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
      <div
        v-if="show"
        class="coloring-library-backdrop"
        :class="{ 'is-light': !appearanceStore.isDark }"
        @click.self="emit('close')"
      >
        <aside
          class="coloring-library-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="染色资源"
        >
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
                  <AuthenticatedImage
                    :src="imageUrl(item)"
                    alt=""
                    loading="lazy"
                    root-margin="320px 0px"
                  />
                </span>
                <strong>{{ item.title || '插画染色' }}</strong>
                <small
                  >{{ item.outputOrientation || '原图比例' }} · {{ item.outputSize || '2K' }}</small
                >
              </button>
            </div>

            <div
              v-else-if="activeTab === 'history' && !historyItems.length"
              class="coloring-library-empty"
            >
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
.coloring-library-backdrop {
  position: fixed;
  inset: 0;
  /* 高于站点导航、移动菜单和常规弹层；仅系统级公告保留更高层级。 */
  z-index: 2147482000;
  background: rgba(4, 3, 8, 0.64);
  backdrop-filter: blur(5px);
}
.coloring-library-drawer {
  width: min(440px, 92vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #fff;
  background: rgba(15, 12, 20, 0.97);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 24px 0 70px rgba(0, 0, 0, 0.42);
}
.coloring-library-head {
  min-height: 68px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.coloring-library-head strong,
.coloring-library-head small {
  display: block;
}
.coloring-library-head strong {
  font-size: 0.95rem;
}
.coloring-library-head small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 0.7rem;
}
.coloring-library-head button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.05);
}
.coloring-library-tabs {
  padding: 10px 12px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.coloring-library-tabs button {
  min-width: 0;
  min-height: 38px;
  border: 0;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.54);
  background: transparent;
  font-size: 0.72rem;
}
.coloring-library-tabs button.active {
  color: #fff;
  background: rgba(244, 114, 182, 0.13);
}
.coloring-library-tabs em {
  margin-left: 4px;
  color: rgba(255, 255, 255, 0.42);
  font-style: normal;
  font-size: 0.64rem;
}
.coloring-library-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  overscroll-behavior: contain;
}
.coloring-library-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.coloring-library-card {
  min-width: 0;
  padding: 7px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  color: #fff;
  background: rgba(255, 255, 255, 0.035);
  text-align: left;
}
.coloring-library-card.active {
  border-color: rgba(244, 114, 182, 0.48);
  background: rgba(244, 114, 182, 0.08);
}
.coloring-library-image {
  aspect-ratio: 1;
  display: block;
  overflow: hidden;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
}
.coloring-library-image :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.coloring-library-card strong,
.coloring-library-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coloring-library-card strong {
  margin-top: 7px;
  font-size: 0.74rem;
}
.coloring-library-card small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 0.64rem;
}
.coloring-library-list,
.coloring-prompt-list {
  display: grid;
  gap: 7px;
}
.coloring-library-list > button,
.coloring-prompt-list > button {
  width: 100%;
  min-width: 0;
  padding: 8px;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  color: #fff;
  background: rgba(255, 255, 255, 0.03);
  text-align: left;
}
.coloring-library-list > button.active {
  border-color: rgba(244, 114, 182, 0.44);
  background: rgba(244, 114, 182, 0.08);
}
.coloring-library-list-thumb {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.38);
  background: rgba(255, 255, 255, 0.05);
}
.coloring-library-list-thumb :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.coloring-library-list strong,
.coloring-library-list small,
.coloring-prompt-list strong,
.coloring-prompt-list small {
  display: block;
}
.coloring-library-list strong,
.coloring-prompt-list strong {
  font-size: 0.75rem;
}
.coloring-library-list small {
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.44);
  font-size: 0.66rem;
}
.coloring-prompt-list > button {
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: start;
}
.coloring-prompt-list :deep(img) {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
}
.coloring-prompt-list small {
  margin-top: 5px;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.67rem;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.coloring-prompt-list > button:not(:has(img)) {
  grid-template-columns: minmax(0, 1fr) auto;
}
.coloring-library-empty,
.coloring-library-loading {
  min-height: 240px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.46);
  text-align: center;
}
.coloring-library-empty > i {
  font-size: 1.6rem;
  color: #f9a8d4;
}
.coloring-library-empty strong {
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.86rem;
}
.coloring-library-empty span {
  font-size: 0.7rem;
}
.coloring-library-empty button {
  margin-top: 6px;
  border: 0;
  border-radius: 8px;
  padding: 7px 10px;
  color: #fff;
  background: rgba(244, 114, 182, 0.14);
}
.coloring-library-enter-active,
.coloring-library-leave-active {
  transition: opacity 0.2s ease;
}
.coloring-library-enter-active .coloring-library-drawer,
.coloring-library-leave-active .coloring-library-drawer {
  transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.coloring-library-enter-from,
.coloring-library-leave-to {
  opacity: 0;
}
.coloring-library-enter-from .coloring-library-drawer,
.coloring-library-leave-to .coloring-library-drawer {
  transform: translateX(-100%);
}

.coloring-library-backdrop.is-light {
  background: rgba(48, 49, 62, 0.3);
}
.coloring-library-backdrop.is-light .coloring-library-drawer {
  border-color: rgba(36, 38, 52, 0.1);
  color: #242531;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 24px 0 70px rgba(55, 50, 86, 0.16);
}
.coloring-library-backdrop.is-light .coloring-library-head,
.coloring-library-backdrop.is-light .coloring-library-tabs {
  border-color: rgba(36, 38, 52, 0.09);
}
.coloring-library-backdrop.is-light .coloring-library-head small,
.coloring-library-backdrop.is-light .coloring-library-tabs button,
.coloring-library-backdrop.is-light .coloring-library-tabs em,
.coloring-library-backdrop.is-light .coloring-library-card small,
.coloring-library-backdrop.is-light .coloring-library-list small,
.coloring-library-backdrop.is-light .coloring-prompt-list small,
.coloring-library-backdrop.is-light .coloring-library-empty,
.coloring-library-backdrop.is-light .coloring-library-loading {
  color: rgba(43, 45, 60, 0.5);
}
.coloring-library-backdrop.is-light .coloring-library-head button,
.coloring-library-backdrop.is-light .coloring-library-card,
.coloring-library-backdrop.is-light .coloring-library-list > button,
.coloring-library-backdrop.is-light .coloring-prompt-list > button,
.coloring-library-backdrop.is-light .coloring-library-list-thumb {
  border-color: rgba(36, 38, 52, 0.09);
  color: #242531;
  background: rgba(39, 41, 56, 0.04);
}
.coloring-library-backdrop.is-light .coloring-library-tabs button.active,
.coloring-library-backdrop.is-light .coloring-library-card.active,
.coloring-library-backdrop.is-light .coloring-library-list > button.active {
  color: #9d346d;
  background: rgba(244, 114, 182, 0.1);
}
.coloring-library-backdrop.is-light .coloring-library-empty strong {
  color: rgba(35, 37, 50, 0.86);
}
</style>
