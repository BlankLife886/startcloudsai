<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { listTasks } from '@/services/tasksApi'
import { STUDIO_TOOLS, stashPendingPrompt } from '@/features/creator-hub/studioTools'
import {
  ecommerceModeDefaultRatio,
  studioLaunchDefaults,
  studioLaunchFields,
  studioLaunchOption,
} from '@/features/creator-hub/studioLaunchProfiles'
import {
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from '@/features/ai-shared/modelImageCapabilities'
import { taskCoverUrl, taskOriginalUrl, taskThumbnailUrl } from '@/features/creator-hub/taskMedia'
import { taskAspectCss, useMasonryColumns } from '@/features/creator-hub/useMasonryFeed'
import { useStudioHubMotion } from '@/features/creator-hub/useStudioHubMotion'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import TypeLine from '@/features/home-commercial/components/TypeLine.vue'
import { translateClientText } from '@/i18n/clientTranslations'
import notificationService from '@/services/notification'
import { fetchAssistantConfig } from '@/services/assistantApi'
import { listPromptLibrary, recordPromptEngagement } from '@/services/promptLibrary'
import { ECOMMERCE_MODES } from '@/features/ecommerce/ecommerceTools'
import '@/features/creator-hub/studio-hub.css'

const router = useRouter()
const authStore = useAuthStore()
const localeStore = useLocaleStore()
const runtimeConfigStore = useRuntimeConfigStore()

const rootRef = ref(null)
const composerRef = ref(null)
const draftPrompt = ref('')
const selectedToolId = ref('assistant')
const activeComposerPanel = ref('')
const composerPopoverStyle = ref({})
let activeComposerTrigger = null
const launchConfigs = reactive(
  Object.fromEntries(STUDIO_TOOLS.map((tool) => [tool.id, studioLaunchDefaults(tool.id)])),
)
const assistantLaunchModels = ref({ conversation: [], image: [] })
const promptMaterialOptions = ref({})
const promptMaterialsLoading = ref({})
const voiceSupported = ref(false)
const voiceListening = ref(false)
const voiceError = ref('')
const recentTasks = ref([])
const recentLoading = ref(false)
const failedThumbIds = ref(new Set())
let allowAutoPinTop = true
let pinTopTimers = []
let voiceRecognition = null
let voiceBasePrompt = ''
const appliedMaterialPrompts = new Map()
const loadedPromptMaterialTools = new Set()

useStudioHubMotion(rootRef)

const LEAD_LINE_SOURCES = [
  '先写下想法，再选择工具。从一句话开始，做到成品。',
  '文生图、染色、模型图、游戏资产——一条创作流。',
  '提示词可复用，进度可回看，结果可继续迭代。',
]
const COMPOSER_PLACEHOLDER = '描述你想做的画面、角色、风格或界面…'

const leadLines = computed(() =>
  LEAD_LINE_SOURCES.map((line) => translateClientText(line, localeStore.locale)),
)
const composerPlaceholder = computed(() =>
  translateClientText(COMPOSER_PLACEHOLDER, localeStore.locale),
)

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
  if (key === 'Escape') {
    closeComposerPanel()
    return
  }
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
const TOOL_WALL_ORDER = [
  'assistant',
  'model',
  't2i',
  'coloring',
  'ui',
  'game',
  'puzzle',
]
const wallTools = computed(() => {
  const map = new Map(visibleTools.value.map((tool) => [tool.id, tool]))
  const ordered = TOOL_WALL_ORDER.map((id) => map.get(id)).filter(Boolean)
  const rest = visibleTools.value.filter((tool) => !TOOL_WALL_ORDER.includes(tool.id))
  return [...ordered, ...rest].filter((tool) => tool.id !== 'ecommerce')
})
const ecommerceTool = computed(() => visibleTools.value.find((tool) => tool.id === 'ecommerce'))
const ECOMMERCE_STUDIO_MODE_IDS = [
  'shoot',
  'listing',
  'detail',
  'tryon',
  'handheld',
  'background',
]
const ecommerceStudioModes = computed(() =>
  ECOMMERCE_STUDIO_MODE_IDS.map((modeId) =>
    ECOMMERCE_MODES.find((mode) => mode.id === modeId),
  ).filter(Boolean),
)

const selectedTool = computed(
  () =>
    composerTools.value.find((tool) => tool.id === selectedToolId.value) ||
    composerTools.value[0] ||
    null,
)

const selectedLaunchConfig = computed(() => {
  const toolId = selectedTool.value?.id || 't2i'
  return launchConfigs[toolId] || launchConfigs.t2i
})

function normalizeLaunchModel(item = {}) {
  const id = String(item.id || item.publicModelKey || item.model || '').trim()
  if (!id) return null
  return {
    ...item,
    ...normalizeImageModelCapabilities(item),
    id,
    label: String(item.label || item.name || id).trim(),
  }
}

function featureLaunchModels(tool) {
  if (!tool?.feature) return []
  const feature = runtimeConfigStore.getFeaturePayload(tool.feature) || {}
  return (Array.isArray(feature.publicModels) ? feature.publicModels : [])
    .map(normalizeLaunchModel)
    .filter(Boolean)
}

const launchModelOptions = computed(() => {
  const tool = selectedTool.value
  if (!tool) return []
  if (tool.id === 'assistant') {
    const group = selectedLaunchConfig.value.skill === 'image' ? 'image' : 'conversation'
    return assistantLaunchModels.value[group]
  }
  return featureLaunchModels(tool)
})

const selectedLaunchModel = computed(
  () =>
    launchModelOptions.value.find((model) => model.id === selectedLaunchConfig.value.model) ||
    launchModelOptions.value.find((model) => model.default === true) ||
    launchModelOptions.value[0] ||
    null,
)

function supportedFieldOptions(field) {
  if (selectedTool.value?.id === 'puzzle' && field.key === 'resolution') {
    return field.options
  }
  if (field.key === 'model') {
    return [
      { value: '', label: launchModelOptions.value.length ? '自动匹配' : '默认模型' },
      ...launchModelOptions.value.map((model) => ({ value: model.id, label: model.label })),
    ]
  }
  const model = selectedLaunchModel.value
  if (!model) return field.options
  if (field.key === 'resolution' && Array.isArray(model.resolutions) && model.resolutions.length) {
    const supported = new Set(model.resolutions.map((value) => String(value).toUpperCase()))
    const qualityByResolution = { '1K': 'low', '2K': 'medium', '4K': 'high' }
    const qualities = new Set(Array.isArray(model.qualities) ? model.qualities.map(String) : [])
    return field.options.filter((item) => {
      const resolution = String(item.value).toUpperCase()
      if (!supported.has(resolution)) return false
      if (selectedTool.value?.id !== 'assistant' || !qualities.size) return true
      return qualities.has(qualityByResolution[resolution])
    })
  }
  if (field.key === 'quality' && Array.isArray(model.qualities) && model.qualities.length) {
    const supported = new Set(model.qualities.map(String))
    return field.options.filter((item) => supported.has(String(item.value)))
  }
  if (field.key === 'ratio') {
    const supported = getModelAspectRatiosForResolution(
      model,
      selectedLaunchConfig.value.resolution,
    )
    if (supported.length) {
      const allowed = new Set(supported.map(String))
      const filtered = field.options.filter(
        (item) => String(item.value) === 'source' || allowed.has(String(item.value)),
      )
      if (filtered.length) return filtered
    }
  }
  return field.options
}

const composerFields = computed(() =>
  studioLaunchFields(selectedTool.value?.id, selectedLaunchConfig.value).map((field) => {
    const options = supportedFieldOptions(field)
    return {
      ...field,
      options:
        field.key === 'material'
          ? [...options, ...(promptMaterialOptions.value[selectedTool.value?.id] || [])]
          : options,
    }
  }),
)

const composerPromptItems = computed(
  () => promptMaterialOptions.value[selectedTool.value?.id] || [],
)

function selectedComposerOption(key, value) {
  return composerFields.value
    .find((field) => field.key === key)
    ?.options.find((item) => String(item.value) === String(value))
}

function composerFieldLabel(field) {
  if (selectedTool.value?.id === 't2i' && field.key === 'skill') return 'Skill'
  return selectedComposerOption(field.key, selectedLaunchConfig.value[field.key])?.label || field.label
}

function normalizeSelectedLaunchConfig() {
  for (const field of composerFields.value) {
    if (!field.options.length || field.key === 'material' || field.key === 'model') continue
    const current = selectedLaunchConfig.value[field.key]
    if (field.options.some((item) => String(item.value) === String(current))) continue
    selectedLaunchConfig.value[field.key] = field.options[0].value
  }
  if (
    selectedLaunchConfig.value.model &&
    !launchModelOptions.value.some((model) => model.id === selectedLaunchConfig.value.model)
  ) {
    selectedLaunchConfig.value.model = ''
  }
}

function applyPromptMaterial(nextValue) {
  const toolId = selectedTool.value?.id || 't2i'
  const previous = appliedMaterialPrompts.get(toolId) || ''
  const next = selectedComposerOption('material', nextValue)?.prompt || ''
  const current = draftPrompt.value
  if (previous && current.includes(previous)) {
    draftPrompt.value = current.replace(previous, next).trim()
  } else if (next && !current.trim()) {
    draftPrompt.value = next
  } else if (next && !current.includes(next)) {
    draftPrompt.value = `${current.trim()}${current.trim() ? '\n' : ''}${next}`
  }
  appliedMaterialPrompts.set(toolId, next)
}

function setLaunchFieldValue(field, raw) {
  const sample = field.options.find((item) => String(item.value) === String(raw))?.value
  selectedLaunchConfig.value[field.key] = sample ?? raw
  if (field.key === 'material') applyPromptMaterial(selectedLaunchConfig.value.material)
  if (field.key === 'skill' && selectedTool.value?.id === 'ecommerce') {
    selectedLaunchConfig.value.ratio = ecommerceModeDefaultRatio(selectedLaunchConfig.value.skill)
  }
  const gameDefaults = {
    character: '3:4',
    environment: '16:9',
    prop: '1:1',
    ui: '16:9',
    icon: '1:1',
    texture: '1:1',
  }
  if (field.key === 'skill' && selectedTool.value?.id === 'game') {
    selectedLaunchConfig.value.ratio = gameDefaults[selectedLaunchConfig.value.skill] || '1:1'
  }
  nextTick(normalizeSelectedLaunchConfig)
}

function selectLaunchFieldOption(field, value) {
  setLaunchFieldValue(field, value)
  closeComposerPanel()
}

function useComposerPrompt(item) {
  const prompt = String(item?.prompt || '').trim()
  if (!prompt) return
  draftPrompt.value = prompt
  if (item.id) void recordPromptEngagement(item.id, 'use', true).catch(() => null)
  closeComposerPanel()
}

function positionComposerPanel(panel, trigger) {
  const composer = composerRef.value
  if (!composer || !trigger) return
  const composerRect = composer.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  const panelWidth = panel === 'tools' ? 440 : panel === 'prompts' ? 420 : 680
  const boundary = 16
  const preferredLeft = triggerRect.left - composerRect.left - 1
  const maxLeft = Math.max(boundary, composerRect.width - panelWidth - boundary)
  composerPopoverStyle.value = {
    left: `${Math.min(Math.max(preferredLeft, boundary), maxLeft)}px`,
    top: `${triggerRect.bottom - composerRect.top + 4}px`,
  }
}

function toggleComposerPanel(panel, event) {
  const trigger = event?.currentTarget || null
  if (activeComposerPanel.value === panel && activeComposerTrigger === trigger) {
    closeComposerPanel()
    return
  }
  activeComposerTrigger = trigger
  activeComposerPanel.value = panel
  positionComposerPanel(panel, trigger)
  nextTick(() => {
    const popover = composerRef.value?.querySelector('.studio-composer__popover')
    if (!popover) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    popover.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  })
}

function toggleComposerField(field, event) {
  const panel = `field:${field.key}`
  const trigger = event?.currentTarget || null
  if (activeComposerPanel.value === panel && activeComposerTrigger === trigger) {
    closeComposerPanel()
    return
  }
  activeComposerTrigger = trigger
  activeComposerPanel.value = panel
}

function togglePromptLibrary(event) {
  toggleComposerPanel('prompts', event)
  if (activeComposerPanel.value === 'prompts') {
    void loadPromptMaterials(selectedTool.value?.id)
  }
}

function closeComposerPanel() {
  activeComposerPanel.value = ''
  activeComposerTrigger = null
}

function selectComposerTool(toolId) {
  selectedToolId.value = toolId
  closeComposerPanel()
}

function onComposerDocumentPointerDown(event) {
  if (!activeComposerPanel.value) return
  if (
    event.target.closest?.(
      '.studio-composer__popover, .studio-composer__field-wrap, .studio-composer__control.is-workflow, .studio-composer__control.is-library',
    )
  ) {
    return
  }
  closeComposerPanel()
}

function onComposerViewportChange() {
  if (activeComposerPanel.value !== 'tools' || !activeComposerTrigger) return
  positionComposerPanel(activeComposerPanel.value, activeComposerTrigger)
}

async function loadAssistantLaunchModels() {
  try {
    const config = await fetchAssistantConfig()
    const normalize = (items) =>
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeLaunchModel({ ...item, id: item?.model }))
        .filter(Boolean)
    assistantLaunchModels.value = {
      conversation: normalize(config?.conversationModels),
      image: normalize(config?.imageModels),
    }
  } catch {
    assistantLaunchModels.value = { conversation: [], image: [] }
  }
}

async function loadPromptMaterials(toolId) {
  const tool = STUDIO_TOOLS.find((item) => item.id === toolId)
  if (!tool?.taskType || loadedPromptMaterialTools.has(toolId)) return
  loadedPromptMaterialTools.add(toolId)
  promptMaterialsLoading.value = { ...promptMaterialsLoading.value, [toolId]: true }
  try {
    const response = await listPromptLibrary(tool.taskType, { pageNumber: 1, pageSize: 8 })
    promptMaterialOptions.value = {
      ...promptMaterialOptions.value,
      [toolId]: (response.items || [])
        .filter((item) => item?.prompt)
        .map((item) => ({
          id: item.id,
          value: `library:${item.id}`,
          label: item.title || item.label || '提示词素材',
          prompt: String(item.prompt || '').trim(),
        })),
    }
  } catch {
    promptMaterialOptions.value = { ...promptMaterialOptions.value, [toolId]: [] }
  } finally {
    promptMaterialsLoading.value = { ...promptMaterialsLoading.value, [toolId]: false }
  }
}

function voiceLanguage() {
  if (localeStore.locale === 'en') return 'en-US'
  if (localeStore.locale === 'zh-TW') return 'zh-TW'
  return 'zh-CN'
}

function stopVoiceInput() {
  voiceRecognition?.stop?.()
}

function toggleVoiceInput() {
  if (!voiceSupported.value) {
    notificationService.warning('当前浏览器暂不支持语音输入')
    return
  }
  if (voiceListening.value) {
    stopVoiceInput()
    return
  }
  voiceError.value = ''
  voiceBasePrompt = draftPrompt.value.trim()
  voiceRecognition.lang = voiceLanguage()
  try {
    voiceRecognition.start()
  } catch {
    voiceError.value = '语音输入启动失败'
  }
}

function setupVoiceInput() {
  if (typeof window === 'undefined') return
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Recognition) return
  voiceSupported.value = true
  voiceRecognition = new Recognition()
  voiceRecognition.continuous = true
  voiceRecognition.interimResults = true
  voiceRecognition.onstart = () => {
    voiceListening.value = true
  }
  voiceRecognition.onend = () => {
    voiceListening.value = false
  }
  voiceRecognition.onerror = (event) => {
    voiceListening.value = false
    const code = String(event?.error || '')
    voiceError.value =
      code === 'not-allowed' || code === 'service-not-allowed'
        ? '请允许浏览器使用麦克风'
        : code === 'no-speech'
          ? '没有识别到语音'
          : '语音识别暂时不可用'
    notificationService.warning(voiceError.value)
  }
  voiceRecognition.onresult = (event) => {
    let transcript = ''
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index]?.[0]?.transcript || ''
    }
    draftPrompt.value = `${voiceBasePrompt}${voiceBasePrompt && transcript ? '\n' : ''}${transcript}`
  }
}

watch(
  composerTools,
  (tools) => {
    if (!tools.length) return
    if (!tools.some((tool) => tool.id === selectedToolId.value)) {
      selectedToolId.value = tools[0].id
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

const {
  columns: masonryColumns,
  columnCount,
  measureFromEvent,
} = useMasonryColumns({
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
  const config = { ...selectedLaunchConfig.value }
  const skillPrompt = studioLaunchOption(tool.id, 'skill', config.skill)?.prompt || ''
  if (skillPrompt) config.skillPrompt = skillPrompt
  const materialPrompt = selectedComposerOption('material', config.material)?.prompt || ''
  if (materialPrompt) config.materialPrompt = materialPrompt
  if (prompt || Object.keys(config).length) {
    stashPendingPrompt({ prompt, taskType: tool.taskType || tool.id || 't2i', config })
    notificationService.success('已带到工作台')
  }
  router.push(
    tool.id === 'ecommerce'
      ? { path: tool.to, query: { tool: config.skill || 'detail' } }
      : tool.to,
  )
}

watch(
  () => authStore.isAuthenticated,
  async () => {
    await loadRecent()
    await nextTick()
    schedulePinTop()
  },
)

watch(
  selectedToolId,
  async (toolId) => {
    void loadPromptMaterials(toolId)
    await nextTick()
    normalizeSelectedLaunchConfig()
  },
  { immediate: true },
)

onMounted(async () => {
  setupVoiceInput()
  try {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  } catch {
    // ignore
  }
  window.scrollTo(0, 0)
  window.addEventListener('wheel', onUserScrollIntent, { passive: true })
  window.addEventListener('touchmove', onUserScrollIntent, { passive: true })
  window.addEventListener('keydown', onUserKeyScrollIntent, { passive: true })
  window.addEventListener('pointerdown', onComposerDocumentPointerDown)
  window.addEventListener('resize', onComposerViewportChange)

  await Promise.all([
    runtimeConfigStore.loadRuntimeConfig().catch(() => null),
    loadAssistantLaunchModels(),
  ])
  normalizeSelectedLaunchConfig()
  await nextTick()
  schedulePinTop()
  await loadRecent()
  await nextTick()
  schedulePinTop()
})

onBeforeUnmount(() => {
  voiceRecognition?.abort?.()
  voiceRecognition = null
  clearPinTopTimers()
  window.removeEventListener('wheel', onUserScrollIntent)
  window.removeEventListener('touchmove', onUserScrollIntent)
  window.removeEventListener('keydown', onUserKeyScrollIntent)
  window.removeEventListener('pointerdown', onComposerDocumentPointerDown)
  window.removeEventListener('resize', onComposerViewportChange)
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

        <form
          ref="composerRef"
          class="studio-composer"
          :class="{ 'has-open-panel': activeComposerPanel }"
          data-studio-enter
          @submit.prevent="startCreate"
        >
          <div class="studio-composer__prompt">
            <textarea
              v-model="draftPrompt"
              class="studio-composer__input"
              rows="4"
              maxlength="2000"
              :placeholder="composerPlaceholder"
              aria-label="创作描述"
            />

            <div class="studio-composer__dock">
              <div class="studio-composer__controls">
                <button
                  type="button"
                  class="studio-composer__control is-workflow"
                  :aria-expanded="activeComposerPanel === 'tools'"
                  @click="toggleComposerPanel('tools', $event)"
                >
                  <i class="bi" :class="selectedTool?.icon || 'bi-stars'" aria-hidden="true"></i>
                  <span>{{ selectedTool?.label }}</span>
                  <i class="bi bi-chevron-down" aria-hidden="true"></i>
                </button>

                <div
                  v-for="field in composerFields"
                  :key="`inline-${selectedToolId}-${field.key}`"
                  class="studio-composer__field-wrap"
                >
                  <button
                    type="button"
                    class="studio-composer__control studio-composer__inline-field"
                    :class="`is-${field.key}`"
                    :title="field.label"
                    :aria-label="field.label"
                    :aria-expanded="activeComposerPanel === `field:${field.key}`"
                    aria-haspopup="listbox"
                    @click="toggleComposerField(field, $event)"
                  >
                    <i class="bi" :class="field.icon" aria-hidden="true"></i>
                    <span>{{ composerFieldLabel(field) }}</span>
                    <i
                      class="bi"
                      :class="activeComposerPanel === `field:${field.key}` ? 'bi-chevron-up' : 'bi-chevron-down'"
                      aria-hidden="true"
                    ></i>
                  </button>

                  <Transition name="studio-field-menu">
                    <div
                      v-if="activeComposerPanel === `field:${field.key}`"
                      class="studio-composer__field-menu"
                      role="listbox"
                      :aria-label="field.label"
                    >
                      <button
                        v-for="item in field.options"
                        :key="String(item.value)"
                        type="button"
                        role="option"
                        :aria-selected="String(item.value) === String(selectedLaunchConfig[field.key])"
                        :class="{
                          'is-selected': String(item.value) === String(selectedLaunchConfig[field.key]),
                        }"
                        @click="selectLaunchFieldOption(field, item.value)"
                      >
                        <span>{{ item.label }}</span>
                        <i
                          v-if="String(item.value) === String(selectedLaunchConfig[field.key])"
                          class="bi bi-check2"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </Transition>
                </div>

                <button
                  type="button"
                  class="studio-composer__control is-icon is-library"
                  title="提示词库"
                  aria-label="提示词库"
                  :aria-expanded="activeComposerPanel === 'prompts'"
                  @click="togglePromptLibrary($event)"
                >
                  <i class="bi bi-journal-text" aria-hidden="true"></i>
                </button>

              </div>

              <div class="studio-composer__commit">
                <span v-if="voiceListening" class="studio-composer__voice-status">正在聆听</span>
                <span class="studio-composer__count" :class="{ 'is-visible': draftPrompt.length }">
                  {{ draftPrompt.length }} / 2000
                </span>
                <button
                  type="button"
                  class="studio-composer__control is-icon studio-composer__voice"
                  :class="{ 'is-listening': voiceListening }"
                  :disabled="!voiceSupported"
                  :title="voiceSupported ? (voiceListening ? '停止语音输入' : '语音输入') : '当前浏览器不支持语音输入'"
                  :aria-label="voiceListening ? '停止语音输入' : '语音输入'"
                  :aria-pressed="voiceListening"
                  @click="toggleVoiceInput"
                >
                  <i class="bi" :class="voiceListening ? 'bi-stop-fill' : 'bi-mic-fill'" aria-hidden="true"></i>
                </button>
                <button
                  type="submit"
                  class="studio-composer__submit"
                  :disabled="!selectedTool"
                  title="开始创作"
                  aria-label="开始创作"
                >
                  <i class="bi bi-arrow-up" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>

          <Transition name="studio-composer-pop">
            <div
              v-if="activeComposerPanel === 'tools'"
              class="studio-composer__popover studio-composer__popover--tools"
              :style="composerPopoverStyle"
              role="menu"
              aria-label="选择创作工具"
              @pointerdown.stop
            >
              <div class="studio-composer__popover-head">
                <span>选择创作工具</span>
                <button type="button" title="关闭" aria-label="关闭" @click="closeComposerPanel">
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>
              <div class="studio-composer__tool-menu">
                <button
                  v-for="tool in composerTools"
                  :key="tool.id"
                  type="button"
                  :class="{ 'is-active': selectedToolId === tool.id }"
                  role="menuitem"
                  @click="selectComposerTool(tool.id)"
                >
                  <i class="bi" :class="tool.icon" aria-hidden="true"></i>
                  <span>
                    <strong>{{ tool.label }}</strong>
                    <small>{{ tool.tagline }}</small>
                  </span>
                  <i v-if="selectedToolId === tool.id" class="bi bi-check2" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </Transition>

          <Transition name="studio-composer-pop">
            <div
              v-if="activeComposerPanel === 'prompts'"
              class="studio-composer__popover studio-composer__popover--prompts"
              :style="composerPopoverStyle"
              role="dialog"
              aria-label="提示词库"
              @pointerdown.stop
            >
              <div class="studio-composer__popover-head">
                <span>{{ selectedTool?.label }}提示词</span>
                <button type="button" title="关闭" aria-label="关闭" @click="closeComposerPanel">
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>

              <div
                v-if="promptMaterialsLoading[selectedToolId]"
                class="studio-composer__prompt-empty"
              >
                正在加载提示词…
              </div>
              <div v-else-if="composerPromptItems.length" class="studio-composer__prompt-menu">
                <button
                  v-for="item in composerPromptItems"
                  :key="item.value"
                  type="button"
                  @click="useComposerPrompt(item)"
                >
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.prompt }}</span>
                </button>
              </div>
              <div v-else class="studio-composer__prompt-empty">当前工具暂无可用提示词</div>
            </div>
          </Transition>

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
              v-if="tool.cover"
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
            </div>
          </router-link>
        </div>
      </section>

      <section
        v-if="ecommerceTool"
        class="studio-section studio-section--commerce"
        aria-label="AI 电商设计"
        data-studio-reveal
      >
        <div class="studio-section__head">
          <div>
            <h2>AI 电商设计</h2>
            <p>商品、人物与营销视觉独立工作流</p>
          </div>
          <router-link :to="ecommerceTool.to">进入电商工作台 →</router-link>
        </div>

        <div class="studio-commerce-module">
          <router-link
            :to="{ path: ecommerceTool.to, query: { tool: 'detail' } }"
            class="studio-commerce-module__hero"
            data-studio-tool
          >
            <img
              :src="ecommerceTool.cover"
              :alt="ecommerceTool.label"
              loading="lazy"
              decoding="async"
              @error="onToolCoverError($event, ecommerceTool)"
            />
            <span class="studio-commerce-module__badge">{{ ecommerceTool.badge }}</span>
            <span class="studio-commerce-module__hero-copy">
              <small>COMMERCE STUDIO</small>
              <strong>{{ ecommerceTool.tagline }}</strong>
              <span>进入完整电商工作台 <i class="bi bi-arrow-up-right"></i></span>
            </span>
          </router-link>

          <div class="studio-commerce-module__modes" aria-label="电商工具快捷入口">
            <router-link
              v-for="mode in ecommerceStudioModes"
              :key="mode.id"
              :to="{ path: ecommerceTool.to, query: { tool: mode.id } }"
              class="studio-commerce-mode"
              data-studio-tool
            >
              <span class="studio-commerce-mode__icon">
                <i class="bi" :class="mode.icon" aria-hidden="true"></i>
              </span>
              <span class="studio-commerce-mode__copy">
                <strong>{{ mode.shortLabel || mode.label }}</strong>
                <small>{{ mode.tagline }}</small>
              </span>
              <i class="bi bi-chevron-right studio-commerce-mode__arrow" aria-hidden="true"></i>
            </router-link>
          </div>
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
