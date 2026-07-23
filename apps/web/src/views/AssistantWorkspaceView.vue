<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  classifyAssistantIntent,
  fetchAssistantConfig,
  generateAssistantImage,
  streamAssistantChat,
} from '@/services/assistantApi'
import {
  loadAssistantHistory,
  loadAssistantWorkspaceState,
  saveAssistantHistory,
  saveAssistantWorkspaceState,
} from '@/services/assistantHistory'
import notificationService from '@/services/notification'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import AssistantMarkdown from '@/components/assistant/AssistantMarkdown.vue'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const conversations = ref([])
const activeId = ref('')
const draft = ref('')
const mode = ref('chat')
const imageSize = ref('1024x1024')
const imageQuality = ref('high')
const isGenerating = ref(false)
const serviceError = ref('')
const serviceLoading = ref(true)
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const pendingDeleteId = ref('')
const selectedImage = ref(null)
const imageViewerFrame = ref(null)
const imageViewerZoom = ref(1)
const imageViewerPanX = ref(0)
const imageViewerPanY = ref(0)
const imageViewerPanning = ref(false)
const imageViewerNaturalSize = ref({ width: 0, height: 0 })
const messageScroller = ref(null)
const visibleMessageLimit = ref(24)
const isLoadingEarlierMessages = ref(false)
const promptInput = ref(null)
const composerRoot = ref(null)
const isAtConversationBottom = ref(true)
const isReturningToBottom = ref(false)
const isStopping = ref(false)
const copiedMessageId = ref('')
const activeNavigatorMessageId = ref('')
const isNavigatingByMarker = ref(false)
const expandedStatusMessageId = ref('')
const editingMessageId = ref('')
const editingMessageDraft = ref('')
const editMessageInput = ref(null)
const referenceInput = ref(null)
const hydrated = ref(false)
const creationMenuOpen = ref(false)
const preferencesOpen = ref(false)
const skillMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const qualityMenuOpen = ref(false)
const activeMessageMenuId = ref('')
const quotedMessage = ref(null)
const generationAuto = ref(true)
const generationMediaType = ref('image')
const generationRatio = ref('auto')
const generationModel = ref('gpt-image-2')
const generationResolution = ref('1K')
const generationCount = ref(2)
const customImageWidth = ref(1024)
const customImageHeight = ref(1024)
const selectedSkill = ref(null)
const creationType = ref('agent')
const skillSearch = ref('')
const referenceImages = ref([])
const assetLibraryOpen = ref(false)
const assetSearch = ref('')
const assetTab = ref('all')
const inlineMenuType = ref('')
const inlineMenuQuery = ref('')
const inlineMenuPosition = ref({ left: 116, top: 56 })
const inlineMenuIndex = ref(0)
const activeTriggerRange = ref(null)
let saveTimer = null
let activeController = null
let progressTimer = null
let returnToBottomTimer = null
let copiedMessageTimer = null
let navigatorFrame = null
let markerNavigationToken = 0
let imageViewerPanStart = null

const MESSAGE_BATCH_SIZE = 24
const IMAGE_VIEWER_MIN_ZOOM = 0.5
const IMAGE_VIEWER_MAX_ZOOM = 5
const IMAGE_VIEWER_ZOOM_STEP = 0.25

const creationTypes = [
  { id: 'agent', label: 'Agent 模式', icon: 'bi-magic' },
  { id: 'image', label: '图片生成', icon: 'bi-image' },
]
const generationRatios = [
  { id: 'auto', label: '自动', shape: 'auto' },
  { id: '1:1', label: '1:1', shape: 'square' },
  { id: '2:3', label: '2:3', shape: 'portrait' },
  { id: '3:2', label: '3:2', shape: 'wide' },
  { id: '3:4', label: '3:4', shape: 'portrait' },
  { id: '4:3', label: '4:3', shape: 'wide' },
  { id: '9:16', label: '9:16', shape: 'portrait' },
  { id: '16:9', label: '16:9', shape: 'wide' },
]
const generationModels = [
  { label: 'gpt-image-2', description: 'OpenAI 图片生成与多参考图编辑模型' },
]
const imageResolutions = [
  { id: '1K', label: '标清 1K', quality: 'low', longEdge: 1024 },
  { id: '2K', label: '高清 2K', quality: 'medium', longEdge: 2048 },
  { id: '4K', label: '超清 4K', quality: 'high', longEdge: 4096 },
]
const imageCounts = [1, 2, 3, 4]
const imagePointsPerItem = 6
const skills = [
  { name: '剧情短片', description: '帮你自动生成故事大纲、分镜脚本并产出短片' },
  { name: '电商套图', description: '生成风格统一的商品全套视觉素材，适用于各大电商平台' },
  { name: '海报设计', description: '生成更有创意的海报内容，擅长营销场景和节日热点' },
  { name: '品牌设计', description: '根据公司名称、业务与客群，生成品牌 Logo 与视觉方案' },
]
const mockAssets = [
  { id: 'ambient', label: '星空灵感背景', dataUrl: '/brand/home-starcloud-bg-v1.webp' },
  { id: 'portrait', label: '人物氛围参考', dataUrl: '/brand/auth-hero-placeholder.webp' },
  { id: 'manga', label: '漫画构图参考', dataUrl: '/brand/auth-manga-bg.png' },
  { id: 'collage', label: '拼贴风格参考', dataUrl: '/brand/auth-collage-bg.png' },
  { id: 'geometry', label: '几何视觉参考', dataUrl: '/brand/auth-triangle-bg.png' },
]
const mentionSubjects = [
  { id: 'portrait', label: '人物主体', description: '保持人物面貌与气质', icon: 'bi-person' },
  { id: 'product', label: '产品主体', description: '保持产品结构与细节', icon: 'bi-box-seam' },
  { id: 'style', label: '画面风格', description: '复用参考图的视觉语言', icon: 'bi-palette' },
]

const scope = computed(() => `user:${authStore.user?.id || 'anonymous'}`)
const activeConversation = computed(() =>
  conversations.value.find((item) => item.id === activeId.value),
)
const messages = computed(() => activeConversation.value?.messages || [])
const firstRenderedMessageIndex = computed(() =>
  Math.max(0, messages.value.length - visibleMessageLimit.value),
)
const renderedMessages = computed(() =>
  messages.value.slice(firstRenderedMessageIndex.value).map((message, offset) => ({
    message,
    originalIndex: firstRenderedMessageIndex.value + offset,
  })),
)
const hiddenMessageCount = computed(() => firstRenderedMessageIndex.value)
const isComposerCompact = computed(
  () => messages.value.length > 0 && !isAtConversationBottom.value && !isReturningToBottom.value,
)
const visibleConversations = computed(() => conversations.value)
const pendingDeleteConversation = computed(() =>
  conversations.value.find((conversation) => conversation.id === pendingDeleteId.value),
)
const lastAssistantId = computed(
  () => [...messages.value].reverse().find((message) => message.role === 'assistant')?.id || '',
)
const lastUserMessageId = computed(
  () => [...messages.value].reverse().find((message) => message.role === 'user')?.id || '',
)
const canSend = computed(
  () =>
    Boolean(draft.value.trim()) &&
    draft.value.trim().length <= 12000 &&
    !isGenerating.value &&
    !serviceError.value &&
    !serviceLoading.value,
)
const imageViewerZoomLabel = computed(() => `${Math.round(imageViewerZoom.value * 100)}%`)
const imageViewerImageStyle = computed(() => ({
  transform: `translate3d(${imageViewerPanX.value}px, ${imageViewerPanY.value}px, 0) scale(${imageViewerZoom.value})`,
}))
const imageViewerPositionLabel = computed(() => {
  const gallery = selectedImage.value?.gallery || []
  return gallery.length > 1 ? `${selectedImage.value.index + 1} / ${gallery.length}` : ''
})
const imageViewerDimensionsLabel = computed(() => {
  const width = Number(imageViewerNaturalSize.value.width || selectedImage.value?.width || 0)
  const height = Number(imageViewerNaturalSize.value.height || selectedImage.value?.height || 0)
  return width > 0 && height > 0 ? `${Math.round(width)}×${Math.round(height)}` : ''
})
const draftLength = computed(() => draft.value.trim().length)
const selectedCreation = computed(
  () => creationTypes.find((item) => item.id === creationType.value) || creationTypes[0],
)
const attachmentLabel = computed(() =>
  mode.value === 'image' ? '添加参考图' : '添加图片，支持识别、分析与编辑',
)
const composerPlaceholder = computed(() =>
  mode.value === 'image'
    ? '描述你想生成的画面，也可以上传参考图'
    : '输入问题或上传图片进行识别、分析与编辑，支持“/”使用技能，@ 添加主体',
)
const conversationNavigatorItems = computed(() =>
  messages.value
    .filter((message) => message.role === 'user')
    .map((message) => ({
      id: message.id,
      date: formatMessageDate(message.createdAt),
      time: formatTime(message.createdAt),
      preview: messagePreview(message.content),
      icon: message.referenceImages?.length ? 'bi-image' : 'bi-chat-left-text',
    })),
)
const filteredSkills = computed(() => {
  const query = skillSearch.value.trim().toLowerCase()
  if (!query) return skills
  return skills.filter((skill) => `${skill.name}${skill.description}`.toLowerCase().includes(query))
})
const imageSettingsLabel = computed(
  () =>
    `${generationRatio.value === 'auto' ? '自动' : generationRatio.value} | ${generationResolution.value} | ${generationCount.value}`,
)
const assetLibraryImages = computed(() => {
  const sourceConversations =
    assetTab.value === 'session' ? [activeConversation.value].filter(Boolean) : conversations.value
  const generated = sourceConversations.flatMap((conversation) =>
    conversation.messages.flatMap((message) =>
      [...(message.images || []), ...(message.referenceImages || [])]
        .filter((image) => image?.dataUrl)
        .map((image, index) => ({
          id: `${conversation.id}-${message.id}-${index}`,
          label: image.revisedPrompt || image.name || conversation.title || '创作资产',
          dataUrl: image.dataUrl,
        })),
    ),
  )
  const seen = new Set()
  const assets = [...generated, ...(assetTab.value === 'all' ? mockAssets : [])].filter((asset) => {
    if (seen.has(asset.dataUrl)) return false
    seen.add(asset.dataUrl)
    return true
  })
  const query = assetSearch.value.trim().toLowerCase()
  return query ? assets.filter((asset) => asset.label.toLowerCase().includes(query)) : assets
})
const inlineMenuItems = computed(() => {
  const query = inlineMenuQuery.value.trim().toLowerCase()
  const items = inlineMenuType.value === 'slash' ? skills : mentionSubjects
  if (!query) return items
  return items.filter((item) =>
    `${item.name || item.label}${item.description || ''}`.toLowerCase().includes(query),
  )
})

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function workspaceSnapshot() {
  return {
    activeId: activeId.value,
    draft: draft.value,
    mode: mode.value,
    creationType: creationType.value,
    imageSize: imageSize.value,
    imageQuality: imageQuality.value,
    generationMediaType: generationMediaType.value,
    generationRatio: generationRatio.value,
    generationModel: generationModel.value,
    generationResolution: generationResolution.value,
    generationCount: generationCount.value,
    customImageWidth: customImageWidth.value,
    customImageHeight: customImageHeight.value,
    selectedSkillName: selectedSkill.value?.name || '',
  }
}

function restoreWorkspaceState(state = {}) {
  if (typeof state.draft === 'string') draft.value = state.draft.slice(0, 12000)
  if (['chat', 'image'].includes(state.mode)) mode.value = state.mode
  if (creationTypes.some((item) => item.id === state.creationType)) {
    creationType.value = state.creationType
  }
  if (typeof state.imageSize === 'string') imageSize.value = state.imageSize
  if (['low', 'medium', 'high'].includes(state.imageQuality)) {
    imageQuality.value = state.imageQuality
  }
  if (typeof state.generationMediaType === 'string') {
    generationMediaType.value = state.generationMediaType
  }
  if (generationRatios.some((item) => item.id === state.generationRatio)) {
    generationRatio.value = state.generationRatio
  }
  if (generationModels.some((item) => item.label === state.generationModel)) {
    generationModel.value = state.generationModel
  }
  if (imageResolutions.some((item) => item.id === state.generationResolution)) {
    generationResolution.value = state.generationResolution
  }
  if (imageCounts.includes(Number(state.generationCount))) {
    generationCount.value = Number(state.generationCount)
  }
  if (Number.isFinite(Number(state.customImageWidth))) {
    customImageWidth.value = Number(state.customImageWidth)
  }
  if (Number.isFinite(Number(state.customImageHeight))) {
    customImageHeight.value = Number(state.customImageHeight)
  }
  selectedSkill.value =
    skills.find((item) => item.name === state.selectedSkillName) || selectedSkill.value
}

function restoreConversations(stored) {
  if (!Array.isArray(stored)) return []
  return stored.slice(0, 30).map((conversation) => ({
    ...conversation,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map((message) =>
          message.pending
            ? {
                ...message,
                pending: false,
                routing: false,
                progress: 0,
                content: message.content || '生成已中断，可重新生成',
              }
            : message,
        )
      : [],
  }))
}

function persistWorkspaceState() {
  if (!hydrated.value) return
  saveAssistantWorkspaceState(scope.value, workspaceSnapshot())
}

function persistHistoryNow() {
  if (!hydrated.value) return Promise.resolve()
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = null
  return saveAssistantHistory(scope.value, conversations.value).catch(() => {})
}

function newConversation() {
  const now = new Date().toISOString()
  const conversation = { id: uid(), title: '新对话', createdAt: now, updatedAt: now, messages: [] }
  conversations.value.unshift(conversation)
  visibleMessageLimit.value = MESSAGE_BATCH_SIZE
  activeId.value = conversation.id
  editingMessageId.value = ''
  editingMessageDraft.value = ''
  sidebarOpen.value = false
  draft.value = ''
  referenceImages.value = []
  closeInlineMenu()
  nextTick(() => promptInput.value?.focus())
  return conversation
}

function ensureConversation() {
  return activeConversation.value || newConversation()
}

function selectConversation(id) {
  editingMessageId.value = ''
  editingMessageDraft.value = ''
  visibleMessageLimit.value = MESSAGE_BATCH_SIZE
  activeId.value = id
  sidebarOpen.value = false
  nextTick(scrollToBottom)
}

function requestDeleteConversation(id) {
  pendingDeleteId.value = id
}

function deleteConversation(id) {
  const index = conversations.value.findIndex((item) => item.id === id)
  if (index < 0) return
  if (activeId.value === id && isGenerating.value) stopGeneration()
  conversations.value.splice(index, 1)
  if (activeId.value === id) {
    activeId.value = conversations.value[0]?.id || ''
    if (!activeId.value) newConversation()
  }
  pendingDeleteId.value = ''
  notificationService.success('对话已删除')
}

function closeComposerPanels() {
  creationMenuOpen.value = false
  preferencesOpen.value = false
  skillMenuOpen.value = false
  modelMenuOpen.value = false
  qualityMenuOpen.value = false
  activeMessageMenuId.value = ''
  closeInlineMenu()
}

function closeInlineMenu() {
  inlineMenuType.value = ''
  inlineMenuQuery.value = ''
  inlineMenuIndex.value = 0
  activeTriggerRange.value = null
}

function toggleComposerPanel(name) {
  const panel = {
    creation: creationMenuOpen,
    preferences: preferencesOpen,
    skills: skillMenuOpen,
  }[name]
  if (!panel) return
  const nextValue = !panel.value
  closeComposerPanels()
  panel.value = nextValue
}

function selectCreationType(type) {
  creationType.value = type.id
  mode.value = type.id === 'image' ? 'image' : 'chat'
  generationMediaType.value = type.id === 'video' ? 'video' : 'image'
  if (type.id === 'image') selectedSkill.value = null
  closeComposerPanels()
  nextTick(() => promptInput.value?.focus())
}

function selectGenerationModel(model) {
  generationModel.value = model.label
  modelMenuOpen.value = false
}

function toggleModelMenu() {
  modelMenuOpen.value = !modelMenuOpen.value
  qualityMenuOpen.value = false
}

function toggleQualityMenu() {
  qualityMenuOpen.value = !qualityMenuOpen.value
  modelMenuOpen.value = false
}

function toggleImageModelMenu() {
  const nextValue = !modelMenuOpen.value
  closeComposerPanels()
  modelMenuOpen.value = nextValue
}

function selectImageResolution(option) {
  generationResolution.value = option.id
  imageQuality.value = option.quality
  syncImageRequestSize()
}

function selectImageRatio(ratio) {
  generationRatio.value = ratio.id
  syncImageRequestSize()
}

function syncImageRequestSize() {
  const longEdge =
    imageResolutions.find((option) => option.id === generationResolution.value)?.longEdge || 1024
  if (generationRatio.value === 'auto') {
    customImageWidth.value = longEdge
    customImageHeight.value = longEdge
    imageSize.value = 'auto'
    return
  }
  const [ratioWidth, ratioHeight] = generationRatio.value.split(':').map((value) => Number(value))
  if (!ratioWidth || !ratioHeight || ratioWidth === ratioHeight) {
    customImageWidth.value = longEdge
    customImageHeight.value = longEdge
  } else if (ratioWidth > ratioHeight) {
    customImageWidth.value = longEdge
    customImageHeight.value = Math.round((longEdge * ratioHeight) / ratioWidth)
  } else {
    customImageWidth.value = Math.round((longEdge * ratioWidth) / ratioHeight)
    customImageHeight.value = longEdge
  }
  imageSize.value = `${customImageWidth.value}x${customImageHeight.value}`
}

function normalizedImageDimension(value) {
  const dimension = Math.round(Number(value))
  if (!Number.isFinite(dimension)) return 1024
  return Math.min(4096, Math.max(256, dimension))
}

function currentImageRequestSize() {
  const resolution = imageResolutions.find((option) => option.id === generationResolution.value)
  imageQuality.value = resolution?.quality || 'low'
  const width = normalizedImageDimension(customImageWidth.value)
  const height = normalizedImageDimension(customImageHeight.value)
  customImageWidth.value = width
  customImageHeight.value = height
  imageSize.value = generationRatio.value === 'auto' ? 'auto' : `${width}x${height}`
  return { width, height, size: imageSize.value }
}

function startImageProgress(message) {
  if (progressTimer) window.clearInterval(progressTimer)
  message.progress = 8
  progressTimer = window.setInterval(() => {
    message.progress = Math.min(92, (message.progress || 8) + 4)
  }, 900)
}

function stopImageProgress(message, completed = false) {
  if (progressTimer) window.clearInterval(progressTimer)
  progressTimer = null
  if (completed) message.progress = 100
}

function messageDateKey(message) {
  const date = new Date(message?.createdAt)
  return Number.isNaN(date.getTime()) ? '' : date.toDateString()
}

function shouldShowMessageDate(message, index) {
  if (index === 0) return formatMessageDate(message.createdAt) !== '今天'
  return messageDateKey(message) !== messageDateKey(messages.value[index - 1])
}

function formatMessageDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return '今天'
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function messagePreview(content) {
  const preview = String(content || '')
    .replace(/```[\s\S]*?```/g, '代码片段')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return preview.slice(0, 58) || '新的对话'
}

function messageTurnId(index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (messages.value[cursor]?.role === 'user') return messages.value[cursor].id
  }
  return ''
}

function messageStatus(message) {
  if (message?.error || message?.statusStage === 'failed') {
    return {
      key: 'failed',
      label: '生成失败',
      detail: message.error || '本次任务没有完成，请稍后重试。',
      tone: 'error',
      progress: 0,
    }
  }

  const stage =
    message?.statusStage ||
    (message?.pending ? (message?.kind === 'image' ? 'generating-image' : 'answering') : 'complete')
  const statuses = {
    routing: {
      label: '正在识别创作意图',
      detail: '正在判断你的请求需要直接回答还是生成图片。',
      tone: 'working',
      progress: 14,
    },
    thinking: {
      label: '正在思考',
      detail: '正在理解上下文并组织回答结构。',
      tone: 'working',
      progress: 32,
    },
    'analyzing-image': {
      label: `正在理解图片${message?.visualContextCount > 1 ? `（${message.visualContextCount} 张）` : ''}`,
      detail: '正在读取画面、文字和细节，并结合你的问题组织回答。',
      tone: 'working',
      progress: 38,
    },
    answering: {
      label: '正在生成回答',
      detail: '内容正在持续生成，你可以随时停止。',
      tone: 'working',
      progress: 62,
    },
    'preparing-image': {
      label: '正在准备图片任务',
      detail: '正在整理提示词、参考图与画面尺寸。',
      tone: 'working',
      progress: 22,
    },
    'generating-image': {
      label: `正在生成图片 ${message?.progress || 8}%`,
      detail: '图片任务已进入生成阶段，完成后会自动显示结果。',
      tone: 'working',
      progress: message?.progress || 8,
    },
    stopping: {
      label: '正在停止',
      detail: '正在结束当前生成任务并保留已生成的内容。',
      tone: 'working',
      progress: 0,
    },
    stopped: {
      label: '已停止',
      detail: '本次生成已由你手动停止。',
      tone: 'muted',
      progress: 0,
    },
  }

  if (statuses[stage]) return { key: stage, ...statuses[stage] }
  const isImage = message?.kind === 'image' || Boolean(message?.images?.length)
  return {
    key: 'complete',
    label: isImage ? '图片已生成' : '回答已完成',
    detail: isImage
      ? `已完成 ${message?.images?.length || 0} 张图片，可以预览或下载原图。`
      : '回答已经生成完成，可以复制、引用或继续追问。',
    tone: 'complete',
    progress: 100,
  }
}

function toggleMessageStatus(messageId) {
  expandedStatusMessageId.value = expandedStatusMessageId.value === messageId ? '' : messageId
}

function selectSkill(skill) {
  selectedSkill.value = skill
  skillMenuOpen.value = false
  skillSearch.value = ''
  removeActiveTrigger()
  nextTick(() => promptInput.value?.focus())
}

function removeActiveTrigger(replacement = '') {
  const range = activeTriggerRange.value
  if (!range) {
    closeInlineMenu()
    return
  }
  draft.value = `${draft.value.slice(0, range.start)}${replacement}${draft.value.slice(range.end)}`
  const nextCaret = range.start + replacement.length
  closeInlineMenu()
  nextTick(() => {
    promptInput.value?.focus()
    promptInput.value?.setSelectionRange(nextCaret, nextCaret)
    resizePromptInput()
  })
}

function selectMention(subject) {
  removeActiveTrigger(`@${subject.label} `)
}

function quoteMessage(message) {
  quotedMessage.value = {
    id: message.id,
    kind: message.images?.length ? '图片' : '回复',
    content: message.content || message.images?.[0]?.revisedPrompt || 'AI 生成内容',
  }
  activeMessageMenuId.value = ''
  nextTick(() => promptInput.value?.focus())
}

function deleteMessage(messageId) {
  const conversation = activeConversation.value
  if (!conversation) return
  const index = conversation.messages.findIndex((message) => message.id === messageId)
  if (index < 0) return
  conversation.messages.splice(index, 1)
  conversation.updatedAt = new Date().toISOString()
  activeMessageMenuId.value = ''
  if (quotedMessage.value?.id === messageId) quotedMessage.value = null
  notificationService.success('内容已删除')
}

function pointsForMessage(message) {
  return message.images?.length ? message.images.length * imagePointsPerItem : 0
}

function conversationPreviewImage(conversation) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    const images = [...(message?.images || []), ...(message?.referenceImages || [])]
    if (Array.isArray(images) && images.length) {
      return images[images.length - 1]?.dataUrl || ''
    }
  }
  return ''
}

function conversationTitle(prompt) {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  return compact.length > 22 ? `${compact.slice(0, 22)}…` : compact
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

const conversationBottomThreshold = 40

function clearReturnToBottomTimer() {
  if (!returnToBottomTimer) return
  window.clearTimeout(returnToBottomTimer)
  returnToBottomTimer = null
}

function isMessageScrollerAtBottom() {
  const scroller = messageScroller.value
  if (!scroller) return true
  return (
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
    conversationBottomThreshold
  )
}

function syncMessageScrollState() {
  const atBottom = isMessageScrollerAtBottom()
  if (isReturningToBottom.value && !atBottom) return

  const leftBottom = isAtConversationBottom.value && !atBottom
  isAtConversationBottom.value = atBottom
  if (atBottom) {
    isReturningToBottom.value = false
    clearReturnToBottomTimer()
  } else if (leftBottom) {
    closeComposerPanels()
  }
}

function syncMessageNavigator() {
  navigatorFrame = null
  const scroller = messageScroller.value
  if (!scroller || !conversationNavigatorItems.value.length) {
    activeNavigatorMessageId.value = ''
    return
  }

  const target = scroller.scrollTop + scroller.clientHeight * 0.28
  let activeTurnId = conversationNavigatorItems.value[0]?.id || ''
  let closestDistance = Number.POSITIVE_INFINITY

  scroller.querySelectorAll('.message[data-turn-id]').forEach((element) => {
    const distance = Math.abs(element.offsetTop - target)
    if (distance >= closestDistance) return
    closestDistance = distance
    activeTurnId = element.dataset.turnId || activeTurnId
  })
  activeNavigatorMessageId.value = activeTurnId
}

function scheduleMessageNavigatorSync() {
  if (navigatorFrame) return
  navigatorFrame = window.requestAnimationFrame(syncMessageNavigator)
}

function handleMessageScroll() {
  syncMessageScrollState()
  if (!isNavigatingByMarker.value) scheduleMessageNavigatorSync()
  const scroller = messageScroller.value
  if (
    !isNavigatingByMarker.value &&
    scroller?.scrollTop <= 36 &&
    hiddenMessageCount.value > 0
  ) {
    void loadEarlierMessages()
  }
}

async function loadEarlierMessages() {
  if (isLoadingEarlierMessages.value || hiddenMessageCount.value <= 0) return
  const scroller = messageScroller.value
  const previousHeight = scroller?.scrollHeight || 0
  const navigationToken = markerNavigationToken
  isLoadingEarlierMessages.value = true
  visibleMessageLimit.value = Math.min(
    messages.value.length,
    visibleMessageLimit.value + MESSAGE_BATCH_SIZE,
  )
  await nextTick()
  if (scroller && navigationToken === markerNavigationToken) {
    scroller.scrollTop += scroller.scrollHeight - previousHeight
  }
  isLoadingEarlierMessages.value = false
  if (!isNavigatingByMarker.value) scheduleMessageNavigatorSync()
}

async function scrollToMessage(messageId) {
  const scroller = messageScroller.value
  if (!scroller) return
  const navigationToken = ++markerNavigationToken
  isNavigatingByMarker.value = true
  if (navigatorFrame) {
    window.cancelAnimationFrame(navigatorFrame)
    navigatorFrame = null
  }
  activeNavigatorMessageId.value = messageId

  const messageIndex = messages.value.findIndex((message) => message.id === messageId)
  if (messageIndex < 0) {
    isNavigatingByMarker.value = false
    return
  }
  if (messageIndex < firstRenderedMessageIndex.value) {
    const requiredCount = messages.value.length - messageIndex
    visibleMessageLimit.value = Math.min(
      messages.value.length,
      Math.ceil(requiredCount / MESSAGE_BATCH_SIZE) * MESSAGE_BATCH_SIZE,
    )
    await nextTick()
  }
  const target = [...scroller.querySelectorAll('.message[data-message-id]')].find(
    (element) => element.dataset.messageId === messageId,
  )
  if (!target) {
    if (navigationToken === markerNavigationToken) isNavigatingByMarker.value = false
    return
  }

  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = Math.max(0, scroller.scrollTop + targetRect.top - scrollerRect.top - 76)
  isAtConversationBottom.value = false
  scroller.scrollTop = targetTop

  window.requestAnimationFrame(() => {
    if (navigationToken !== markerNavigationToken) return
    isNavigatingByMarker.value = false
    syncMessageScrollState()
    syncMessageNavigator()
  })
}

async function scrollToBottom({ behavior = 'auto' } = {}) {
  clearReturnToBottomTimer()
  isReturningToBottom.value = true
  isAtConversationBottom.value = true
  await nextTick()
  const scroller = messageScroller.value
  if (!scroller) {
    isReturningToBottom.value = false
    return
  }

  scroller.scrollTo({ top: scroller.scrollHeight, behavior })
  if (behavior === 'smooth') {
    returnToBottomTimer = window.setTimeout(() => {
      isReturningToBottom.value = false
      syncMessageScrollState()
    }, 700)
    return
  }

  window.requestAnimationFrame(() => {
    isReturningToBottom.value = false
    syncMessageScrollState()
  })
}

function followConversationBottom() {
  if (isAtConversationBottom.value || isReturningToBottom.value) void scrollToBottom()
}

function chatPayload(conversation, visualContext = []) {
  const payload = conversation.messages
    .filter((message) => message.content?.trim() && !message.pending && !message.error)
    .slice(-40)
    .map(({ role, content }) => ({ role, content }))
  const lastUserIndex = payload.findLastIndex((message) => message.role === 'user')
  const referenceImages = visualContext
    .map((image) => (typeof image === 'string' ? image : image?.dataUrl))
    .filter(Boolean)
    .slice(0, 4)
  if (lastUserIndex >= 0 && referenceImages.length) {
    payload[lastUserIndex].referenceImages = referenceImages
  }
  return payload
}

function promptNeedsRecentVisual(prompt) {
  const text = String(prompt || '').trim().toLowerCase()
  if (!text) return false
  const previousVisualCue =
    /(这张|这幅|这个图|该图|那张|上图|上一张|前一张|刚才.{0,8}(图|图片|画面)|之前.{0,8}(图|图片|画面)|图中|图片中|照片中|截图中|画面中|它|其中|上述)/i
  if (previousVisualCue.test(text)) return true

  const freshImageRequest =
    /(生成|创建|制作|绘制|画|设计|做|来|给我).{0,14}([1-4一二两三四]\s*)?(张|幅)?\s*(新)?(图|图片|图像|海报|插画|头像|壁纸|封面|logo)/i
  if (freshImageRequest.test(text)) return false

  return /(?:(识别|读取|提取|ocr|描述|分析|总结|翻译|解释|修改|编辑|重绘|替换|换成|改成|变成|风格化|美化|换背景|去背景|抠图|擦除|移除|删除|添加|修复|扩图|裁剪|上色).{0,12}(图|图片|图像|照片|截图|画面|文字|背景|人物|主体|颜色|构图|风格)|(图|图片|图像|照片|截图|画面|文字|背景|人物|主体|颜色|构图|风格).{0,12}(识别|读取|提取|ocr|描述|分析|总结|翻译|解释|修改|编辑|重绘|替换|换成|改成|变成|风格化|美化|换背景|去背景|抠图|擦除|移除|删除|添加|修复|扩图|裁剪|上色))/i.test(
    text,
  )
}

function resolveVisualContext(conversation, prompt) {
  const latestUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'user')
  const currentImages = (latestUserMessage?.referenceImages || []).filter((image) => image?.dataUrl)
  if (currentImages.length) return currentImages.slice(0, 4)
  if (!promptNeedsRecentVisual(prompt)) return []

  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (message.id === latestUserMessage?.id) continue
    const images = [...(message.images || []), ...(message.referenceImages || [])].filter(
      (image) => image?.dataUrl,
    )
    if (images.length) return images.slice(0, 4)
  }
  return []
}

function fallbackAgentIntent(prompt, { hasReferenceImage = false } = {}) {
  const text = prompt.trim().toLowerCase()
  const imageNoun =
    /(图片|图像|生图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图|image|picture|poster|illustration|wallpaper|cover)/i
  const imageQuantity = /[1-4一二两三四]\s*(?:张|幅)/i
  const imageAction =
    /(生成|画|绘制|制作|创建|设计|修改|编辑|重绘|换背景|去背景|做一张|出一张|generate|draw|create|design|edit|redraw)/i
  const imageMutation =
    /(修改|编辑|重绘|替换|换成|改成|变成|做成|转成|转换|风格化|美化|换背景|去背景|抠图|擦除|抹掉|移除|删除|添加|加上|修复|扩图|裁剪|上色|remove|replace|change|convert|transform|erase|inpaint|outpaint|crop)/i
  const imageUnderstanding =
    /(识别|读取|提取|看图|描述|分析|总结|翻译|解释|回答|是什么|有什么|写了什么|ocr|read|extract|describe|analy[sz]e|summari[sz]e|translate|explain)/i
  if (hasReferenceImage && imageMutation.test(text)) return 'image'
  if ((imageNoun.test(text) || imageQuantity.test(text)) && imageAction.test(text)) return 'image'
  if (hasReferenceImage && imageUnderstanding.test(text)) return 'chat'
  return 'chat'
}

function imageCountFromPrompt(prompt) {
  const text = String(prompt || '').trim()
  if (!text) return 0
  const chineseNumbers = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 }
  const patterns = [
    /([1-4一二两三四])\s*(?:张|幅)\s*(?:图片|图像|图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)?/i,
    /([1-4一二两三四])\s*(?:个|份)\s*(?:图片|图像|图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)/i,
    /(?:图片|图像|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)\s*([1-4一二两三四])\s*(?:张|幅|个|份)?/i,
    /\b([1-4])\s*(?:images?|pictures?|variations?)\b/i,
  ]
  for (const pattern of patterns) {
    const matched = text.match(pattern)?.[1]
    if (!matched) continue
    const count = Number(matched) || chineseNumbers[matched] || 0
    if (imageCounts.includes(count)) return count
  }
  return 0
}

function imageSkeletonRatio(message) {
  const width = Number(message?.width)
  const height = Number(message?.height)
  return width > 0 && height > 0 ? `${width} / ${height}` : '1 / 1'
}

async function generateResponse(conversation, prompt, assistantMessage, responseMode) {
  let resolvedMode = responseMode
  const visualContext = resolveVisualContext(conversation, prompt)
  const hasReferenceImage = visualContext.length > 0
  const immediateIntent =
    responseMode === 'agent'
      ? fallbackAgentIntent(prompt, { hasReferenceImage })
      : responseMode
  assistantMessage.kind = immediateIntent === 'image' ? 'image' : responseMode
  assistantMessage.pending = true
  assistantMessage.error = ''
  assistantMessage.visualContextCount = visualContext.length
  assistantMessage.routing = responseMode === 'agent'
  assistantMessage.statusStage =
    immediateIntent === 'image'
      ? 'preparing-image'
      : responseMode === 'agent'
        ? 'routing'
        : 'thinking'
  isGenerating.value = true
  activeController = new AbortController()
  await scrollToBottom()

  try {
    if (responseMode === 'agent') {
      try {
        resolvedMode = await classifyAssistantIntent(prompt, {
          signal: activeController.signal,
          hasReferenceImage,
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        resolvedMode = fallbackAgentIntent(prompt, { hasReferenceImage })
      }
      assistantMessage.kind = resolvedMode
      assistantMessage.routing = false
      assistantMessage.statusStage =
        resolvedMode === 'image'
          ? 'preparing-image'
          : visualContext.length
            ? 'analyzing-image'
            : 'thinking'
      followConversationBottom()
    }

    if (resolvedMode === 'image') {
      assistantMessage.model = generationModel.value
      assistantMessage.statusStage = 'generating-image'
      startImageProgress(assistantMessage)
      const result = await generateAssistantImage(prompt, {
        size: assistantMessage.requestSize || imageSize.value,
        quality: assistantMessage.quality || imageQuality.value,
        count: assistantMessage.count || generationCount.value,
        referenceImages: visualContext.map((image) => image?.dataUrl),
        signal: activeController.signal,
      })
      assistantMessage.images = result.images || []
      assistantMessage.content = assistantMessage.images.length ? '图片已生成' : '没有生成可用图片'
      stopImageProgress(assistantMessage, true)
    } else {
      assistantMessage.statusStage = visualContext.length ? 'analyzing-image' : 'thinking'
      const payload = chatPayload(conversation, visualContext).filter(
        (message) => message.role !== 'assistant' || message.content,
      )
      await streamAssistantChat(payload, {
        signal: activeController.signal,
        onDelta(_delta, fullText) {
          assistantMessage.statusStage = 'answering'
          assistantMessage.content = fullText
          followConversationBottom()
        },
      })
      if (!assistantMessage.content) assistantMessage.content = '没有收到模型回复，请重试。'
    }
  } catch (error) {
    if (resolvedMode === 'image') stopImageProgress(assistantMessage)
    if (error?.name === 'AbortError') {
      assistantMessage.statusStage = 'stopped'
      assistantMessage.content ||= '已停止生成'
    } else {
      assistantMessage.statusStage = 'failed'
      assistantMessage.error = error?.message || '生成失败，请稍后重试'
      assistantMessage.content ||= assistantMessage.error
    }
  } finally {
    if (!assistantMessage.error && assistantMessage.statusStage !== 'stopped') {
      assistantMessage.statusStage = 'complete'
    }
    assistantMessage.pending = false
    assistantMessage.routing = false
    conversation.updatedAt = new Date().toISOString()
    isGenerating.value = false
    isStopping.value = false
    activeController = null
    followConversationBottom()
    await persistHistoryNow()
  }
}

async function sendMessage() {
  const prompt = draft.value.trim()
  if (!canSend.value) return
  const requestedImage = currentImageRequestSize()
  const requestedImageCount = imageCountFromPrompt(prompt)

  const conversation = ensureConversation()
  if (!conversation.messages.length) conversation.title = conversationTitle(prompt)
  conversation.updatedAt = new Date().toISOString()
  conversation.messages.push({
    id: uid(),
    role: 'user',
    content: prompt,
    createdAt: conversation.updatedAt,
    quoted: quotedMessage.value ? { ...quotedMessage.value } : null,
    skill: selectedSkill.value?.name || '',
    referenceImages: referenceImages.value.map((image) => ({ ...image })),
  })
  const responseMode =
    mode.value === 'image' ? 'image' : creationType.value === 'agent' ? 'agent' : 'chat'
  const assistantMessage = {
    id: uid(),
    role: 'assistant',
    content: '',
    images: [],
    kind: responseMode,
    pending: true,
    error: '',
    feedback: '',
    createdAt: new Date().toISOString(),
    prompt,
    model: generationModel.value,
    ratio: generationRatio.value === 'auto' ? '自动' : generationRatio.value,
    resolution: generationResolution.value,
    count: responseMode === 'chat' ? 0 : requestedImageCount || generationCount.value,
    requestSize: requestedImage.size,
    width: requestedImage.width,
    height: requestedImage.height,
    quality: imageQuality.value,
    progress: 0,
  }
  conversation.messages.push(assistantMessage)
  draft.value = ''
  quotedMessage.value = null
  referenceImages.value = []
  closeInlineMenu()
  resizePromptInput()
  void persistHistoryNow()
  await generateResponse(conversation, prompt, assistantMessage, responseMode)
}

async function retryAssistant(message) {
  if (isGenerating.value || message.id !== lastAssistantId.value) return
  const conversation = activeConversation.value
  const index = conversation?.messages.findIndex((item) => item.id === message.id) ?? -1
  const prompt = conversation?.messages[index - 1]?.content?.trim()
  if (!conversation || index < 1 || !prompt) return
  const responseMode = message.kind || (message.images?.length ? 'image' : 'chat')
  message.content = ''
  message.images = []
  message.feedback = ''
  await generateResponse(conversation, prompt, message, responseMode)
}

function stopGeneration() {
  if (!isGenerating.value || isStopping.value) return
  isStopping.value = true
  const pendingMessage = [...messages.value]
    .reverse()
    .find((message) => message.role === 'assistant' && message.pending)
  if (pendingMessage) pendingMessage.statusStage = 'stopping'
  activeController?.abort()
  if (progressTimer) window.clearInterval(progressTimer)
}

function handleComposerKeydown(event) {
  if (inlineMenuType.value && inlineMenuItems.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      inlineMenuIndex.value =
        (inlineMenuIndex.value + direction + inlineMenuItems.value.length) %
        inlineMenuItems.value.length
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeInlineMenu()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      selectInlineMenuItem(inlineMenuItems.value[inlineMenuIndex.value])
      return
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    sendMessage()
  }
}

function selectInlineMenuItem(item) {
  if (!item) return
  if (inlineMenuType.value === 'slash') selectSkill(item)
  else selectMention(item)
}

function getTextareaCaretPosition(input, position) {
  const style = window.getComputedStyle(input)
  const mirror = document.createElement('div')
  const properties = [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'textAlign',
    'textTransform',
    'wordSpacing',
    'tabSize',
  ]
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-9999px',
    top: '0',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  })
  properties.forEach((property) => {
    mirror.style[property] = style[property]
  })
  mirror.textContent = input.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = input.value.slice(position) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const result = {
    left: marker.offsetLeft - input.scrollLeft,
    top: marker.offsetTop - input.scrollTop,
    lineHeight: Number.parseFloat(style.lineHeight) || 22,
  }
  mirror.remove()
  return result
}

function updateInlineMenu() {
  nextTick(() => {
    const input = promptInput.value
    const composer = composerRoot.value
    if (!input || !composer) return
    const caret = input.selectionStart ?? draft.value.length
    const beforeCaret = draft.value.slice(0, caret)
    const match = beforeCaret.match(/(?:^|\s)([/@])([^\s/@]*)$/)
    if (!match) {
      closeInlineMenu()
      return
    }
    const trigger = match[1]
    const query = match[2] || ''
    const start = caret - query.length - 1
    const coordinates = getTextareaCaretPosition(input, start)
    const inputRect = input.getBoundingClientRect()
    const composerRect = composer.getBoundingClientRect()
    const menuWidth = Math.min(340, composerRect.width - 24)
    const desiredLeft = inputRect.left - composerRect.left + coordinates.left
    const maxLeft = composerRect.width - menuWidth - 12
    const menuHeight = trigger === '/' ? 278 : 224
    const caretTop = inputRect.top - composerRect.top + coordinates.top
    const preferredTop = caretTop + coordinates.lineHeight + 7
    const top =
      composerRect.top + preferredTop + menuHeight > window.innerHeight - 12
        ? caretTop - menuHeight - 7
        : preferredTop
    inlineMenuType.value = trigger === '/' ? 'slash' : 'mention'
    inlineMenuQuery.value = query
    activeTriggerRange.value = { start, end: caret }
    inlineMenuIndex.value = 0
    inlineMenuPosition.value = {
      left: Math.max(12, Math.min(desiredLeft, maxLeft)),
      top,
    }
  })
}

function handleComposerInput() {
  resizePromptInput()
  updateInlineMenu()
}

function insertComposerTrigger(trigger) {
  const input = promptInput.value
  const start = input?.selectionStart ?? draft.value.length
  const end = input?.selectionEnd ?? start
  const prefix = start > 0 && !/\s/.test(draft.value[start - 1]) ? ' ' : ''
  draft.value = `${draft.value.slice(0, start)}${prefix}${trigger}${draft.value.slice(end)}`
  const caret = start + prefix.length + 1
  nextTick(() => {
    input?.focus()
    input?.setSelectionRange(caret, caret)
    handleComposerInput()
  })
}

function openReferencePicker() {
  if (referenceImages.value.length >= 4) {
    notificationService.info('最多添加 4 张参考图')
    return
  }
  referenceInput.value?.click()
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        id: uid(),
        name: file.name || `剪贴板图片-${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
        dataUrl: String(reader.result || ''),
      })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function appendReferenceFiles(files, { pasted = false } = {}) {
  const imageFiles = [...files].filter((file) => file?.type?.startsWith('image/'))
  const available = Math.max(0, 4 - referenceImages.value.length)
  if (!imageFiles.length) return 0
  if (!available) {
    notificationService.info('最多添加 4 张图片')
    return 0
  }
  try {
    const images = await Promise.all(imageFiles.slice(0, available).map(readImageFile))
    const existing = new Set(referenceImages.value.map((image) => image.dataUrl))
    const uniqueImages = images.filter((image) => image.dataUrl && !existing.has(image.dataUrl))
    referenceImages.value.push(...uniqueImages)
    if (imageFiles.length > available) notificationService.info('图片最多保留 4 张')
    else if (uniqueImages.length < images.length) notificationService.info('已忽略重复图片')
    if (pasted && uniqueImages.length) {
      notificationService.success(`已粘贴 ${uniqueImages.length} 张图片，可直接提问`)
    }
    return uniqueImages.length
  } catch {
    notificationService.error(pasted ? '剪贴板图片读取失败，请重试' : '图片读取失败，请重新选择')
    return 0
  }
}

async function handleReferenceFiles(event) {
  await appendReferenceFiles(event.target.files || [])
  event.target.value = ''
}

async function handleComposerPaste(event) {
  const clipboardItems = [...(event.clipboardData?.items || [])]
  const itemFiles = clipboardItems
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  const files = itemFiles.length
    ? itemFiles
    : [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'))
  if (!files.length) return

  event.preventDefault()
  closeInlineMenu()
  await appendReferenceFiles(files, { pasted: true })
}

function removeReferenceImage(id) {
  referenceImages.value = referenceImages.value.filter((image) => image.id !== id)
}

function addAssetReference(asset) {
  if (referenceImages.value.length >= 4) {
    notificationService.info('最多添加 4 张参考图')
    return
  }
  if (referenceImages.value.some((image) => image.dataUrl === asset.dataUrl)) {
    notificationService.info('这张图片已在参考图中')
    return
  }
  referenceImages.value.push({ id: uid(), name: asset.label, dataUrl: asset.dataUrl })
  notificationService.success('已添加到参考图')
}

function resizePromptInput() {
  nextTick(() => {
    const input = promptInput.value
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`
  })
}

async function copyMessage(content, messageId = '') {
  if (!content) return
  await navigator.clipboard.writeText(content)
  copiedMessageId.value = messageId
  if (copiedMessageTimer) window.clearTimeout(copiedMessageTimer)
  copiedMessageTimer = window.setTimeout(() => {
    copiedMessageId.value = ''
  }, 1600)
  notificationService.success('已复制')
}

function startEditingUserMessage(message) {
  if (
    isGenerating.value ||
    message?.role !== 'user' ||
    message.id !== lastUserMessageId.value
  ) {
    return
  }
  editingMessageId.value = message.id
  editingMessageDraft.value = message.content || ''
  nextTick(() => {
    editMessageInput.value?.focus()
    editMessageInput.value?.setSelectionRange(
      editingMessageDraft.value.length,
      editingMessageDraft.value.length,
    )
  })
}

function setEditMessageInput(element) {
  if (element) editMessageInput.value = element
}

function cancelUserMessageEdit() {
  editingMessageId.value = ''
  editingMessageDraft.value = ''
}

async function submitUserMessageEdit(message) {
  const prompt = editingMessageDraft.value.trim()
  if (
    !prompt ||
    prompt.length > 12000 ||
    isGenerating.value ||
    message?.id !== lastUserMessageId.value
  ) {
    return
  }
  const conversation = activeConversation.value
  const messageIndex = conversation?.messages.findIndex((item) => item.id === message.id) ?? -1
  if (!conversation || messageIndex < 0) return

  const previousReply = conversation.messages[messageIndex + 1]
  const responseMode =
    previousReply?.kind === 'image' || previousReply?.images?.length ? 'image' : 'agent'
  const requestedImage = currentImageRequestSize()
  const requestedImageCount = imageCountFromPrompt(prompt)
  message.content = prompt
  message.editedAt = new Date().toISOString()
  if (messageIndex === 0) conversation.title = conversationTitle(prompt)
  conversation.messages.splice(messageIndex + 1)

  const assistantMessage = {
    id: uid(),
    role: 'assistant',
    content: '',
    images: [],
    kind: responseMode,
    pending: true,
    error: '',
    feedback: '',
    createdAt: new Date().toISOString(),
    prompt,
    model: previousReply?.model || generationModel.value,
    ratio:
      previousReply?.ratio || (generationRatio.value === 'auto' ? '自动' : generationRatio.value),
    resolution: previousReply?.resolution || generationResolution.value,
    count: requestedImageCount || previousReply?.count || generationCount.value,
    requestSize: previousReply?.requestSize || requestedImage.size,
    width: previousReply?.width || requestedImage.width,
    height: previousReply?.height || requestedImage.height,
    quality: previousReply?.quality || imageQuality.value,
    progress: 0,
  }
  conversation.messages.push(assistantMessage)
  conversation.updatedAt = assistantMessage.createdAt
  cancelUserMessageEdit()
  void persistHistoryNow()
  await generateResponse(conversation, prompt, assistantMessage, responseMode)
}

function handleUserMessageEditEnter(event, message) {
  if (event.isComposing) return
  event.preventDefault()
  void submitUserMessageEdit(message)
}

function downloadMarkdown(message) {
  if (!message?.content) return
  const blob = new Blob([message.content], { type: 'text/markdown;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `AI助手-${new Date(message.createdAt || Date.now()).toISOString().slice(0, 10)}.md`
  link.click()
  URL.revokeObjectURL(link.href)
  activeMessageMenuId.value = ''
  notificationService.success('Markdown 已下载')
}

function downloadImage(image, index) {
  const link = document.createElement('a')
  link.href = image.dataUrl
  link.download = `starclouds-${Date.now()}-${index + 1}.png`
  link.click()
}

function openImagePreview(image, index = 0, images = [image]) {
  const gallery = Array.isArray(images) && images.length ? images : [image]
  const safeIndex = Math.min(Math.max(Number(index) || 0, 0), gallery.length - 1)
  selectedImage.value = {
    ...gallery[safeIndex],
    index: safeIndex,
    gallery,
  }
  imageViewerNaturalSize.value = { width: 0, height: 0 }
  resetImageViewer()
}

function closeImagePreview() {
  resetImageViewer()
  selectedImage.value = null
}

function stepImagePreview(direction) {
  const gallery = selectedImage.value?.gallery || []
  if (gallery.length < 2) return
  const nextIndex = (selectedImage.value.index + direction + gallery.length) % gallery.length
  selectedImage.value = {
    ...gallery[nextIndex],
    index: nextIndex,
    gallery,
  }
  imageViewerNaturalSize.value = { width: 0, height: 0 }
  resetImageViewer()
}

function resetImageViewer() {
  imageViewerZoom.value = 1
  imageViewerPanX.value = 0
  imageViewerPanY.value = 0
  imageViewerPanning.value = false
  imageViewerPanStart = null
}

function clampImageViewerPan() {
  const frame = imageViewerFrame.value
  if (!frame || imageViewerZoom.value <= 1) {
    imageViewerPanX.value = 0
    imageViewerPanY.value = 0
    return
  }
  const rect = frame.getBoundingClientRect()
  const naturalWidth = Number(imageViewerNaturalSize.value.width || rect.width)
  const naturalHeight = Number(imageViewerNaturalSize.value.height || rect.height)
  const fitScale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const scaledWidth = naturalWidth * fitScale * imageViewerZoom.value
  const scaledHeight = naturalHeight * fitScale * imageViewerZoom.value
  const maxX = Math.max(0, (scaledWidth - rect.width) / 2)
  const maxY = Math.max(0, (scaledHeight - rect.height) / 2)
  imageViewerPanX.value = Math.min(maxX, Math.max(-maxX, imageViewerPanX.value))
  imageViewerPanY.value = Math.min(maxY, Math.max(-maxY, imageViewerPanY.value))
}

function setImageViewerZoom(value) {
  imageViewerZoom.value = Math.min(
    IMAGE_VIEWER_MAX_ZOOM,
    Math.max(IMAGE_VIEWER_MIN_ZOOM, Math.round(Number(value || 1) * 100) / 100),
  )
  nextTick(clampImageViewerPan)
}

function zoomImageViewer(delta) {
  setImageViewerZoom(imageViewerZoom.value + delta)
}

function handleImageViewerWheel(event) {
  zoomImageViewer(event.deltaY < 0 ? IMAGE_VIEWER_ZOOM_STEP : -IMAGE_VIEWER_ZOOM_STEP)
}

function toggleImageViewerZoom() {
  setImageViewerZoom(imageViewerZoom.value === 1 ? 2 : 1)
}

function handleImageViewerLoad(event) {
  imageViewerNaturalSize.value = {
    width: Number(event?.target?.naturalWidth || 0),
    height: Number(event?.target?.naturalHeight || 0),
  }
  clampImageViewerPan()
}

function startImageViewerPan(event) {
  if (event.button !== 0 || imageViewerZoom.value <= 1) return
  event.preventDefault()
  imageViewerPanning.value = true
  imageViewerPanStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: imageViewerPanX.value,
    panY: imageViewerPanY.value,
  }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function moveImageViewerPan(event) {
  if (!imageViewerPanning.value || imageViewerPanStart?.pointerId !== event.pointerId) return
  imageViewerPanX.value = imageViewerPanStart.panX + event.clientX - imageViewerPanStart.x
  imageViewerPanY.value = imageViewerPanStart.panY + event.clientY - imageViewerPanStart.y
  clampImageViewerPan()
}

function endImageViewerPan(event) {
  if (imageViewerPanStart?.pointerId !== event.pointerId) return
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  imageViewerPanning.value = false
  imageViewerPanStart = null
}

function toggleSidebar() {
  if (window.matchMedia('(max-width: 760px)').matches) {
    sidebarOpen.value = !sidebarOpen.value
    return
  }
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    localStorage.setItem('starclouds:assistant-sidebar-collapsed', String(sidebarCollapsed.value))
  } catch {
    /* ignore */
  }
}

async function loadServiceConfig() {
  serviceLoading.value = true
  serviceError.value = ''
  try {
    await fetchAssistantConfig()
  } catch (error) {
    serviceError.value = error?.message || 'AI 服务尚未配置'
  } finally {
    serviceLoading.value = false
  }
}

function handleGlobalKeydown(event) {
  if (selectedImage.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeImagePreview()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      stepImagePreview(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomImageViewer(IMAGE_VIEWER_ZOOM_STEP)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomImageViewer(-IMAGE_VIEWER_ZOOM_STEP)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      resetImageViewer()
      return
    }
  }
  if (event.key !== 'Escape') return
  if (editingMessageId.value) {
    cancelUserMessageEdit()
    return
  }
  if (
    creationMenuOpen.value ||
    preferencesOpen.value ||
    skillMenuOpen.value ||
    modelMenuOpen.value ||
    qualityMenuOpen.value ||
    activeMessageMenuId.value
  ) {
    closeComposerPanels()
  } else if (inlineMenuType.value) closeInlineMenu()
  else if (assetLibraryOpen.value) assetLibraryOpen.value = false
  else if (pendingDeleteId.value) pendingDeleteId.value = ''
  else if (sidebarOpen.value) sidebarOpen.value = false
}

function handleGlobalClick() {
  closeComposerPanels()
}

watch(
  selectedImage,
  (image) => {
    document.documentElement.classList.toggle('assistant-image-viewer-open', Boolean(image))
  },
  { flush: 'post' },
)

watch(
  conversations,
  () => {
    if (!hydrated.value) return
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void persistHistoryNow()
    }, 350)
  },
  { deep: true },
)

watch(
  [activeId, () => messages.value.length],
  () => {
    nextTick(scheduleMessageNavigatorSync)
  },
  { flush: 'post' },
)

watch(
  [
    activeId,
    draft,
    mode,
    creationType,
    imageSize,
    imageQuality,
    generationMediaType,
    generationRatio,
    generationModel,
    generationResolution,
    generationCount,
    customImageWidth,
    customImageHeight,
    selectedSkill,
  ],
  persistWorkspaceState,
  { flush: 'post' },
)

function handlePageHide() {
  persistWorkspaceState()
  void persistHistoryNow()
}

onMounted(async () => {
  try {
    sidebarCollapsed.value =
      localStorage.getItem('starclouds:assistant-sidebar-collapsed') === 'true'
  } catch {
    /* ignore */
  }
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('click', handleGlobalClick)
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('resize', clampImageViewerPan, { passive: true })
  await authStore.initAuth().catch(() => null)
  const workspaceState = loadAssistantWorkspaceState(scope.value)
  const [stored] = await Promise.all([loadAssistantHistory(scope.value), loadServiceConfig()])
  conversations.value = restoreConversations(stored)
  restoreWorkspaceState(workspaceState)
  activeId.value = conversations.value.some((item) => item.id === workspaceState.activeId)
    ? workspaceState.activeId
    : conversations.value[0]?.id || ''
  hydrated.value = true
  if (!activeId.value) newConversation()
  resizePromptInput()
  scrollToBottom()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('assistant-image-viewer-open')
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('pagehide', handlePageHide)
  window.removeEventListener('resize', clampImageViewerPan)
  activeController?.abort()
  if (progressTimer) window.clearInterval(progressTimer)
  if (saveTimer) window.clearTimeout(saveTimer)
  if (copiedMessageTimer) window.clearTimeout(copiedMessageTimer)
  if (navigatorFrame) window.cancelAnimationFrame(navigatorFrame)
  clearReturnToBottomTimer()
  if (hydrated.value) {
    persistWorkspaceState()
    void persistHistoryNow()
  }
})
</script>

<template>
  <div
    class="assistant-workspace"
    :class="{
      'is-dark': appearanceStore.isDark,
      'is-sidebar-collapsed': sidebarCollapsed,
    }"
  >
    <button
      v-if="sidebarOpen"
      class="assistant-scrim"
      type="button"
      aria-label="关闭侧栏"
      @click="sidebarOpen = false"
    ></button>

    <aside class="assistant-sidebar" :class="{ 'is-open': sidebarOpen }">
      <div class="assistant-brand-row">
        <button class="assistant-brand" type="button" title="返回首页" @click="router.push('/')">
          <strong>开启创作</strong>
        </button>
        <button
          class="icon-button sidebar-close"
          type="button"
          :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          @click="toggleSidebar"
        >
          <i
            class="bi"
            :class="sidebarCollapsed ? 'bi-layout-sidebar' : 'bi-layout-sidebar-inset'"
          ></i>
        </button>
      </div>

      <button class="new-chat-button" type="button" title="新对话" @click="newConversation">
        <i class="bi bi-pencil-square"></i><span>新对话</span>
      </button>

      <div class="conversation-section">
        <p class="conversation-label">
          <span>最近</span>
        </p>
        <div class="conversation-list">
          <div
            v-for="conversation in visibleConversations"
            :key="conversation.id"
            class="conversation-row"
            :class="{ active: conversation.id === activeId }"
          >
            <button
              class="conversation-select"
              type="button"
              @click="selectConversation(conversation.id)"
            >
              <span
                class="conversation-thumb"
                :class="{
                  'has-image': conversationPreviewImage(conversation),
                }"
              >
                <img
                  v-if="conversationPreviewImage(conversation)"
                  :src="conversationPreviewImage(conversation)"
                  alt=""
                />
                <i v-else class="bi bi-chat-square"></i>
              </span>
              <span class="conversation-copy">
                <span>{{ conversation.title }}</span>
                <small>{{ formatTime(conversation.updatedAt) }}</small>
              </span>
            </button>
            <button
              class="conversation-delete"
              type="button"
              title="删除对话"
              aria-label="删除对话"
              @click="requestDeleteConversation(conversation.id)"
            >
              <i class="bi bi-trash3"></i>
            </button>
          </div>
          <p v-if="!visibleConversations.length" class="conversation-empty">暂无记录</p>
        </div>
      </div>
    </aside>

    <main class="assistant-main">
      <header class="assistant-topbar">
        <div class="topbar-title">
          <button
            class="icon-button mobile-sidebar-button"
            type="button"
            title="打开侧栏"
            aria-label="打开侧栏"
            @click="toggleSidebar"
          >
            <i class="bi bi-layout-sidebar"></i>
          </button>
          <h1>今天</h1>
        </div>
        <div class="topbar-filters">
          <button class="filter-search" type="button" title="搜索" aria-label="搜索">
            <i class="bi bi-search"></i>
          </button>
          <button type="button"><span>时间</span><i class="bi bi-chevron-down"></i></button>
          <button type="button"><span>生成模式</span><i class="bi bi-chevron-down"></i></button>
          <button type="button"><span>操作类型</span><i class="bi bi-chevron-down"></i></button>
          <button
            type="button"
            :class="{ active: assetLibraryOpen }"
            :aria-pressed="assetLibraryOpen"
            @click.stop="assetLibraryOpen = !assetLibraryOpen"
          >
            <i class="bi bi-archive"></i><span>资产库</span>
          </button>
          <button
            class="icon-button theme-toggle"
            type="button"
            :title="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
            :aria-label="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
            @click="appearanceStore.toggle()"
          >
            <i class="bi" :class="appearanceStore.isDark ? 'bi-sun' : 'bi-moon-stars'"></i>
          </button>
        </div>
      </header>

      <div ref="messageScroller" class="assistant-messages" @scroll.passive="handleMessageScroll">
        <section v-if="serviceLoading" class="assistant-loading-state" aria-live="polite">
          <span class="thinking-spark"><i></i><i></i></span>
          <strong>认真思考中...</strong>
        </section>
        <section
          v-else-if="!messages.length"
          class="assistant-empty-state"
          aria-label="空白创作区"
        ></section>

        <section v-else class="message-thread" aria-live="polite">
          <button
            v-if="hiddenMessageCount"
            class="load-earlier-messages"
            type="button"
            :disabled="isLoadingEarlierMessages"
            @click="loadEarlierMessages"
          >
            <i class="bi bi-clock-history"></i>
            <span>{{
              isLoadingEarlierMessages ? '加载中...' : `加载更早的对话（${hiddenMessageCount}）`
            }}</span>
          </button>
          <template v-for="{ message, originalIndex } in renderedMessages" :key="message.id">
            <h2 v-if="shouldShowMessageDate(message, originalIndex)" class="message-date-divider">
              {{ formatMessageDate(message.createdAt) }}
            </h2>
            <article
              class="message"
              :class="`message--${message.role}`"
              :data-message-id="message.id"
              :data-turn-id="messageTurnId(originalIndex)"
            >
              <div
                v-if="message.role === 'assistant'"
                class="assistant-message-label"
                :class="`is-${messageStatus(message).tone}`"
              >
                <button
                  class="message-status-toggle"
                  type="button"
                  :aria-expanded="expandedStatusMessageId === message.id"
                  @click="toggleMessageStatus(message.id)"
                >
                  <span class="message-status-indicator" aria-hidden="true"><i></i></span>
                  <strong aria-live="polite">
                    <Transition name="status-swap" mode="out-in">
                      <span :key="messageStatus(message).key">{{
                        messageStatus(message).label
                      }}</span>
                    </Transition>
                  </strong>
                  <i
                    class="bi bi-chevron-right message-status-chevron"
                    :class="{ 'is-expanded': expandedStatusMessageId === message.id }"
                  ></i>
                </button>
                <Transition name="status-detail">
                  <div v-if="expandedStatusMessageId === message.id" class="message-status-detail">
                    <p>{{ messageStatus(message).detail }}</p>
                    <div
                      v-if="message.pending && messageStatus(message).progress > 0"
                      class="message-status-progress"
                      aria-hidden="true"
                    >
                      <i :style="{ width: `${messageStatus(message).progress}%` }"></i>
                    </div>
                  </div>
                </Transition>
              </div>
              <div
                v-if="message.role === 'user' && editingMessageId !== message.id"
                class="user-message-actions"
                aria-label="用户消息操作"
              >
                <button
                  type="button"
                  :title="copiedMessageId === message.id ? '已复制' : '复制问题'"
                  :aria-label="copiedMessageId === message.id ? '已复制' : '复制问题'"
                  :class="{ 'is-copied': copiedMessageId === message.id }"
                  @click="copyMessage(message.content, message.id)"
                >
                  <i
                    class="bi"
                    :class="copiedMessageId === message.id ? 'bi-check2' : 'bi-copy'"
                  ></i>
                </button>
                <button
                  v-if="message.id === lastUserMessageId"
                  type="button"
                  title="编辑问题"
                  aria-label="编辑问题"
                  :disabled="isGenerating"
                  @click="startEditingUserMessage(message)"
                >
                  <i class="bi bi-pencil"></i>
                </button>
              </div>
              <div
                v-if="message.role === 'user' && editingMessageId === message.id"
                class="user-message-editor"
              >
                <textarea
                  :ref="setEditMessageInput"
                  v-model="editingMessageDraft"
                  rows="3"
                  maxlength="12000"
                  aria-label="编辑问题"
                  @keydown.enter.exact="handleUserMessageEditEnter($event, message)"
                ></textarea>
                <footer>
                  <span>{{ editingMessageDraft.trim().length.toLocaleString() }} / 12,000</span>
                  <button type="button" @click="cancelUserMessageEdit">取消</button>
                  <button
                    class="is-primary"
                    type="button"
                    :disabled="!editingMessageDraft.trim() || isGenerating"
                    @click="submitUserMessageEdit(message)"
                  >
                    <i class="bi bi-arrow-up"></i><span>发送</span>
                  </button>
                </footer>
              </div>
              <div v-else class="message-content" :class="{ 'has-error': message.error }">
                <div
                  v-if="message.pending && message.kind === 'image'"
                  class="image-generation-stage"
                  :style="{ '--image-progress': `${message.progress || 8}%` }"
                >
                  <div class="image-generation-summary">
                    <strong>{{ message.prompt || '正在生成图片' }}</strong>
                    <span>{{ message.model || generationModel }}</span>
                    <i></i>
                    <span>{{ message.ratio || '智能' }}</span>
                    <i></i>
                    <span>{{ message.resolution || generationResolution }}</span>
                    <button type="button" title="生成详情" aria-label="生成详情">
                      <i class="bi bi-info-circle"></i>
                    </button>
                  </div>
                  <div
                    class="image-dream-grid"
                    :class="{
                      'is-single': Number(message.count || 2) === 1,
                      'is-preparing': message.statusStage === 'preparing-image',
                    }"
                    :style="{ '--image-skeleton-ratio': imageSkeletonRatio(message) }"
                  >
                    <div v-for="slot in message.count || 2" :key="slot" class="image-dream-slot"></div>
                  </div>
                  <div class="image-generation-queue">
                    <span>{{
                      message.statusStage === 'preparing-image' ? '意图识别' : '普通队列'
                    }}</span
                    ><strong>{{
                      message.statusStage === 'preparing-image'
                        ? '正在准备图片任务'
                        : '成功进入生成阶段'
                    }}</strong>
                  </div>
                </div>
                <template v-else>
                  <div v-if="message.role === 'user' && message.quoted" class="sent-quote">
                    <i class="bi bi-quote"></i>
                    <span>[{{ message.quoted.kind }}] {{ message.quoted.content }}</span>
                  </div>
                  <div
                    v-if="message.role === 'user' && message.referenceImages?.length"
                    class="sent-reference-images"
                  >
                    <button
                      v-for="(image, imageIndex) in message.referenceImages"
                      :key="`${message.id}-reference-${imageIndex}`"
                      type="button"
                      title="查看参考图"
                      @click="openImagePreview(image, imageIndex, message.referenceImages)"
                    >
                      <img
                        :src="image.dataUrl"
                        :alt="image.name || '参考图'"
                        @load="followConversationBottom"
                      />
                    </button>
                  </div>
                  <AssistantMarkdown
                    v-if="message.role === 'assistant' && message.content"
                    :content="message.content"
                    :streaming="message.pending"
                  />
                  <p v-else-if="message.content">{{ message.content }}</p>
                  <span v-else-if="message.pending" class="typing-indicator"
                    ><i></i><i></i><i></i
                  ></span>
                  <div
                    v-if="message.images?.length"
                    class="generated-images"
                    :class="{ 'is-single': message.images.length === 1 }"
                  >
                    <figure
                      v-for="(image, imageIndex) in message.images"
                      :key="`${message.id}-${imageIndex}`"
                    >
                      <button
                        class="generated-image-preview"
                        type="button"
                        title="查看大图"
                        @click="openImagePreview(image, imageIndex, message.images)"
                      >
                        <img
                          :src="image.dataUrl"
                          :alt="image.revisedPrompt || 'AI 生成图片'"
                          @load="followConversationBottom"
                        />
                        <span class="image-preview-action"
                          ><i class="bi bi-arrows-fullscreen"></i
                        ></span>
                      </button>
                      <div class="generated-image-actions">
                        <button
                          type="button"
                          title="下载原图"
                          aria-label="下载原图"
                          @click="downloadImage(image, imageIndex)"
                        >
                          <i class="bi bi-download"></i>
                        </button>
                      </div>
                    </figure>
                  </div>
                </template>
              </div>
              <p v-if="message.role === 'assistant' && !message.pending" class="message-meta">
                以上内容由 AI 生成 <span></span> 本次消耗 {{ pointsForMessage(message) }} 积分
              </p>
              <div v-if="message.role === 'assistant' && !message.pending" class="message-actions">
                <button
                  class="regenerate-button"
                  type="button"
                  title="重新生成"
                  :disabled="isGenerating || message.id !== lastAssistantId"
                  @click="retryAssistant(message)"
                >
                  <i class="bi bi-arrow-repeat"></i><span>重新生成</span>
                </button>
                <button
                  class="copy-message-button"
                  type="button"
                  :title="copiedMessageId === message.id ? '已复制' : '复制回复'"
                  :aria-label="copiedMessageId === message.id ? '已复制' : '复制回复'"
                  :class="{ 'is-copied': copiedMessageId === message.id }"
                  @click="copyMessage(message.content, message.id)"
                >
                  <i
                    class="bi"
                    :class="copiedMessageId === message.id ? 'bi-check2' : 'bi-copy'"
                  ></i>
                </button>
                <button type="button" title="引用" aria-label="引用" @click="quoteMessage(message)">
                  <i class="bi bi-quote"></i>
                </button>
                <button
                  type="button"
                  title="更多操作"
                  aria-label="更多操作"
                  @click.stop="
                    activeMessageMenuId = activeMessageMenuId === message.id ? '' : message.id
                  "
                >
                  <i class="bi bi-three-dots"></i>
                </button>
                <div
                  v-if="activeMessageMenuId === message.id"
                  class="message-more-menu"
                  @click.stop
                >
                  <button
                    v-if="message.kind !== 'image'"
                    type="button"
                    @click="downloadMarkdown(message)"
                  >
                    <i class="bi bi-filetype-md"></i><span>下载 Markdown</span>
                  </button>
                  <button class="is-danger" type="button" @click="deleteMessage(message.id)">
                    <i class="bi bi-trash3"></i><span>删除</span>
                  </button>
                </div>
              </div>
            </article>
          </template>
        </section>
      </div>

      <nav
        v-if="conversationNavigatorItems.length"
        class="conversation-minimap"
        aria-label="对话位置导航"
      >
        <button
          v-for="item in conversationNavigatorItems"
          :key="item.id"
          type="button"
          :class="{ active: activeNavigatorMessageId === item.id }"
          :aria-label="`跳转到：${item.preview}`"
          @click="scrollToMessage(item.id)"
        >
          <i></i>
          <span class="conversation-minimap-preview">
            <small>{{ item.date }} · {{ item.time }}</small>
            <strong>{{ item.preview }}</strong>
            <em><i class="bi" :class="item.icon"></i> 对话节点</em>
          </span>
        </button>
      </nav>

      <div class="composer-zone" :class="{ 'is-scrolled-away': isComposerCompact }">
        <Transition name="return-bottom">
          <div v-if="isComposerCompact" class="return-to-bottom-row">
            <button
              class="return-to-bottom"
              type="button"
              title="回到底部"
              aria-label="回到底部"
              @click="scrollToBottom({ behavior: 'smooth' })"
            >
              <span>回到底部</span><i class="bi bi-chevron-double-down"></i>
            </button>
          </div>
        </Transition>
        <div v-if="serviceError" class="assistant-service-error">
          <i class="bi bi-exclamation-circle"></i><span>{{ serviceError }}</span>
          <button type="button" :disabled="serviceLoading" @click="loadServiceConfig">
            <i class="bi bi-arrow-clockwise"></i>重试
          </button>
        </div>
        <div
          ref="composerRoot"
          class="assistant-composer"
          :class="{ 'is-image-mode': mode === 'image' }"
          @click.stop
        >
          <section v-if="creationMenuOpen" class="composer-popover creation-type-menu">
            <p class="popover-eyebrow">创作类型</p>
            <button
              v-for="type in creationTypes"
              :key="type.id"
              type="button"
              :class="{ active: creationType === type.id }"
              @click="selectCreationType(type)"
            >
              <i class="bi" :class="type.icon"></i>
              <span>{{ type.label }}</span>
              <i v-if="creationType === type.id" class="bi bi-check-lg menu-check"></i>
            </button>
          </section>

          <section
            v-if="mode === 'image' && modelMenuOpen && !preferencesOpen"
            class="composer-popover image-model-menu"
          >
            <p class="popover-eyebrow">选择图片模型</p>
            <button
              v-for="model in generationModels"
              :key="model.label"
              type="button"
              :class="{ active: generationModel === model.label }"
              @click="selectGenerationModel(model)"
            >
              <span class="model-mark"><i class="bi bi-stars"></i></span>
              <span class="model-copy">
                <strong>{{ model.label }}</strong>
                <small>{{ model.description }}</small>
              </span>
              <i v-if="generationModel === model.label" class="bi bi-check-lg menu-check"></i>
            </button>
          </section>

          <section
            v-if="preferencesOpen && mode === 'image'"
            class="composer-popover image-mode-preferences"
          >
            <p class="preferences-label">选择比例</p>
            <div class="ratio-options">
              <button
                v-for="ratio in generationRatios"
                :key="ratio.id"
                type="button"
                :class="{ active: generationRatio === ratio.id }"
                @click="selectImageRatio(ratio)"
              >
                <i class="ratio-shape" :class="`is-${ratio.shape}`"></i>
                <span>{{ ratio.label }}</span>
              </button>
            </div>
            <p class="preferences-label">选择分辨率</p>
            <div class="image-resolution-options">
              <button
                v-for="option in imageResolutions"
                :key="option.id"
                type="button"
                :class="{ active: generationResolution === option.id }"
                @click="selectImageResolution(option)"
              >
                {{ option.label }}<i class="bi bi-stars"></i>
              </button>
            </div>
            <p class="preferences-label">选择生成数量</p>
            <div class="image-count-options">
              <button
                v-for="count in imageCounts"
                :key="count"
                type="button"
                :class="{ active: generationCount === count }"
                @click="generationCount = count"
              >
                {{ count }}
              </button>
            </div>
            <p class="preferences-label">尺寸</p>
            <div class="custom-image-size">
              <label
                ><span>W</span
                ><input v-model.number="customImageWidth" type="number" min="256" max="4096"
              /></label>
              <i class="bi bi-link-45deg"></i>
              <label
                ><span>H</span
                ><input v-model.number="customImageHeight" type="number" min="256" max="4096"
              /></label>
              <span>PX</span>
            </div>
          </section>

          <section v-else-if="preferencesOpen" class="composer-popover generation-preferences">
            <header class="preferences-header">
              <strong>生成偏好</strong>
              <label class="auto-switch">
                <span>自动</span>
                <input v-model="generationAuto" type="checkbox" />
                <i></i>
              </label>
            </header>
            <div class="media-type-tabs">
              <button
                type="button"
                :class="{ active: generationMediaType === 'image' }"
                @click="generationMediaType = 'image'"
              >
                图片
              </button>
              <button
                type="button"
                :class="{ active: generationMediaType === 'video' }"
                @click="generationMediaType = 'video'"
              >
                视频
              </button>
            </div>
            <p class="preferences-label">选择比例</p>
            <div class="ratio-options">
              <button
                v-for="ratio in generationRatios"
                :key="ratio.id"
                type="button"
                :class="{ active: generationRatio === ratio.id }"
                @click="selectImageRatio(ratio)"
              >
                <i class="ratio-shape" :class="`is-${ratio.shape}`"></i>
                <span>{{ ratio.label }}</span>
              </button>
            </div>
            <p class="preferences-label">其他设置</p>
            <div class="generation-setting-row">
              <button
                type="button"
                :class="{ active: modelMenuOpen }"
                @click.stop="toggleModelMenu"
              >
                <i class="bi bi-box"></i><span>{{ generationModel }}</span>
                <i class="bi" :class="modelMenuOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
              </button>
              <button
                type="button"
                :class="{ active: qualityMenuOpen }"
                @click.stop="toggleQualityMenu"
              >
                <span class="resolution-icon">2K</span><span>{{ generationResolution }}</span>
                <i class="bi" :class="qualityMenuOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
              </button>
            </div>

            <section v-if="modelMenuOpen" class="nested-selection-menu model-selection-menu">
              <p>当前模型：{{ generationModel }}</p>
              <button
                v-for="model in generationModels"
                :key="model.label"
                type="button"
                :class="{ active: generationModel === model.label }"
                @click="selectGenerationModel(model)"
              >
                <span class="model-mark"><i class="bi bi-stars"></i></span>
                <span class="model-copy">
                  <strong>{{ model.label }}</strong>
                  <small>{{ model.description }}</small>
                </span>
                <i v-if="generationModel === model.label" class="bi bi-check-lg menu-check"></i>
              </button>
            </section>

            <section v-if="qualityMenuOpen" class="nested-selection-menu quality-selection-menu">
              <p>选择清晰度</p>
              <button type="button" class="active" @click="qualityMenuOpen = false">
                <span class="resolution-icon">2K</span><strong>{{ generationResolution }}</strong>
                <i class="bi bi-check-lg menu-check"></i>
              </button>
            </section>
          </section>

          <section v-if="skillMenuOpen" class="composer-popover skill-menu">
            <div class="skill-search-row">
              <i class="bi bi-search"></i>
              <input v-model="skillSearch" type="search" placeholder="搜索技能" />
              <button type="button">更多技能<i class="bi bi-chevron-right"></i></button>
            </div>
            <div class="skill-list">
              <button
                v-for="skill in filteredSkills"
                :key="skill.name"
                type="button"
                @click="selectSkill(skill)"
              >
                <i class="bi bi-wrench-adjustable"></i>
                <span>
                  <strong>{{ skill.name }} <small>官方</small></strong>
                  <em>{{ skill.description }}</em>
                </span>
              </button>
              <p v-if="!filteredSkills.length" class="skill-empty">没有匹配的技能</p>
            </div>
            <div class="skill-footer">
              <button type="button"><i class="bi bi-plus-lg"></i>用 Agent 创建技能</button>
              <button type="button"><i class="bi bi-sliders2"></i>管理技能</button>
            </div>
          </section>

          <section
            v-if="inlineMenuType"
            class="inline-trigger-menu"
            :class="`is-${inlineMenuType}`"
            :style="{
              left: `${inlineMenuPosition.left}px`,
              top: `${inlineMenuPosition.top}px`,
            }"
          >
            <header>
              <span>{{ inlineMenuType === 'slash' ? '选择技能' : '添加主体' }}</span>
              <kbd>{{ inlineMenuType === 'slash' ? '/' : '@' }}</kbd>
            </header>
            <div v-if="inlineMenuItems.length" class="inline-trigger-list">
              <button
                v-for="(item, itemIndex) in inlineMenuItems"
                :key="item.name || item.id"
                type="button"
                :class="{ active: itemIndex === inlineMenuIndex }"
                @mouseenter="inlineMenuIndex = itemIndex"
                @mousedown.prevent="selectInlineMenuItem(item)"
              >
                <i
                  class="bi"
                  :class="
                    inlineMenuType === 'slash' ? 'bi-wrench-adjustable' : item.icon || 'bi-at'
                  "
                ></i>
                <span>
                  <strong>{{ item.name || item.label }}</strong>
                  <small>{{ item.description }}</small>
                </span>
                <i class="bi bi-arrow-return-left"></i>
              </button>
            </div>
            <p v-else class="inline-trigger-empty">没有匹配内容</p>
          </section>

          <input
            ref="referenceInput"
            class="reference-file-input"
            type="file"
            accept="image/*"
            multiple
            :aria-label="attachmentLabel"
            @change="handleReferenceFiles"
          />
          <div
            class="reference-dock"
            :class="{
              'has-images': referenceImages.length,
              'is-full': referenceImages.length >= 4,
            }"
          >
            <button
              v-if="!referenceImages.length"
              class="composer-attachment"
              type="button"
              :title="attachmentLabel"
              :aria-label="attachmentLabel"
              @click="openReferencePicker"
            >
              <i class="bi bi-plus-lg"></i>
            </button>
            <template v-else>
              <figure
                v-for="(image, imageIndex) in referenceImages"
                :key="image.id"
                class="reference-card"
                :style="{
                  '--reference-index': imageIndex,
                  '--reference-count': referenceImages.length,
                }"
              >
                <img :src="image.dataUrl" :alt="image.name || `参考图 ${imageIndex + 1}`" />
                <button
                  type="button"
                  title="移除参考图"
                  aria-label="移除参考图"
                  @click="removeReferenceImage(image.id)"
                >
                  <i class="bi bi-x"></i>
                </button>
              </figure>
            </template>
            <button
              v-if="referenceImages.length && referenceImages.length < 4"
              class="reference-add-more"
              type="button"
              title="继续添加参考图"
              aria-label="继续添加参考图"
              :style="{ '--reference-count': referenceImages.length }"
              @click="openReferencePicker"
            >
              <i class="bi bi-plus-lg"></i>
            </button>
            <span v-if="referenceImages.length" class="reference-count"
              >{{ referenceImages.length }}/4</span
            >
          </div>
          <div v-if="quotedMessage" class="composer-quote">
            <i class="bi bi-quote"></i>
            <span>[{{ quotedMessage.kind }}] {{ quotedMessage.content }}</span>
            <button
              type="button"
              title="移除引用"
              aria-label="移除引用"
              @click="quotedMessage = null"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <div v-if="selectedSkill" class="selected-skill">
            <i class="bi bi-wrench-adjustable"></i>
            <span>{{ selectedSkill.name }}</span>
            <button
              type="button"
              title="移除技能"
              aria-label="移除技能"
              @click="selectedSkill = null"
            >
              <i class="bi bi-x"></i>
            </button>
          </div>
          <textarea
            ref="promptInput"
            v-model="draft"
            rows="1"
            aria-label="消息输入"
            :placeholder="composerPlaceholder"
            :disabled="isGenerating || Boolean(serviceError)"
            @click="updateInlineMenu"
            @input="handleComposerInput"
            @keydown="handleComposerKeydown"
            @paste="handleComposerPaste"
            @select="updateInlineMenu"
          ></textarea>
          <div
            v-if="draftLength > 10000"
            class="draft-counter"
            :class="{ 'is-over': draftLength > 12000 }"
          >
            {{ draftLength.toLocaleString() }} / 12,000
          </div>
          <div class="composer-toolbar">
            <div class="composer-left">
              <button
                class="agent-mode-button"
                type="button"
                :class="{ active: creationMenuOpen }"
                @click.stop="toggleComposerPanel('creation')"
              >
                <i class="bi" :class="selectedCreation.icon"></i>
                <span>{{ selectedCreation.label }}</span>
                <i class="bi" :class="creationMenuOpen ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
              </button>
              <button
                v-if="mode === 'image'"
                class="composer-tool-button image-model-button"
                type="button"
                :class="{ active: modelMenuOpen }"
                @click.stop="toggleImageModelMenu"
              >
                <i class="bi bi-box"></i><span>{{ generationModel }}</span
                ><i class="bi bi-stars"></i>
              </button>
              <button
                v-if="mode === 'image'"
                class="composer-tool-button image-settings-button"
                type="button"
                :class="{ active: preferencesOpen }"
                @click.stop="toggleComposerPanel('preferences')"
              >
                <i class="ratio-shape is-square"></i><span>{{ imageSettingsLabel }}</span>
              </button>
              <button
                v-if="mode !== 'image'"
                class="composer-tool-button"
                type="button"
                :class="{ active: preferencesOpen }"
                @click.stop="toggleComposerPanel('preferences')"
              >
                <i class="bi bi-sliders2"></i><span>{{ generationAuto ? '自动' : '自定义' }}</span>
              </button>
              <button
                v-if="mode !== 'image'"
                class="composer-tool-button"
                type="button"
                :class="{ active: skillMenuOpen || selectedSkill }"
                @click.stop="toggleComposerPanel('skills')"
              >
                <i class="bi bi-wrench-adjustable"></i><span>使用技能</span>
              </button>
              <button
                class="composer-tool-button is-mention"
                type="button"
                :title="mode === 'image' ? '使用技能' : '添加主体'"
                :aria-label="mode === 'image' ? '使用技能' : '添加主体'"
                @click="insertComposerTrigger(mode === 'image' ? '/' : '@')"
              >
                <i v-if="mode === 'image'" class="bi bi-fonts"></i>
                <span v-else>@</span>
              </button>
              <button
                v-if="mode === 'image'"
                class="composer-tool-button is-mention"
                type="button"
                title="添加主体"
                aria-label="添加主体"
                @click="insertComposerTrigger('@')"
              >
                @
              </button>
            </div>
            <span v-if="mode === 'image'" class="image-point-cost"
              ><i class="bi bi-stars"></i>{{ imagePointsPerItem }}/张</span
            >
            <button
              v-if="isGenerating"
              class="send-button stop-button"
              :class="{ 'is-stopping': isStopping }"
              type="button"
              :title="isStopping ? '正在停止' : '停止生成'"
              :aria-label="isStopping ? '正在停止' : '停止生成'"
              :disabled="isStopping"
              @click="stopGeneration"
            >
              <span class="stop-glyph" aria-hidden="true"></span>
            </button>
            <button
              v-else
              class="send-button"
              type="button"
              title="发送"
              aria-label="发送"
              :disabled="!canSend"
              @click="sendMessage"
            >
              <span class="send-glyph" aria-hidden="true"><i class="bi bi-arrow-up"></i></span>
            </button>
          </div>
        </div>
      </div>
    </main>

    <Transition name="asset-panel">
      <aside v-if="assetLibraryOpen" class="asset-library-panel" aria-label="资产库" @click.stop>
        <header class="asset-library-header">
          <div class="asset-library-tabs" role="tablist" aria-label="资产范围">
            <button
              type="button"
              role="tab"
              :aria-selected="assetTab === 'session'"
              :class="{ active: assetTab === 'session' }"
              @click="assetTab = 'session'"
            >
              会话资产
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="assetTab === 'all'"
              :class="{ active: assetTab === 'all' }"
              @click="assetTab = 'all'"
            >
              全部资产
            </button>
          </div>
          <button
            class="asset-close"
            type="button"
            title="关闭资产库"
            aria-label="关闭资产库"
            @click="assetLibraryOpen = false"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>
        <div class="asset-search-row">
          <label>
            <i class="bi bi-search"></i>
            <input v-model="assetSearch" type="search" placeholder="搜索图片资产" />
          </label>
          <button type="button" title="筛选" aria-label="筛选">
            <i class="bi bi-funnel"></i>
          </button>
        </div>
        <nav class="asset-type-tabs" aria-label="资产类型">
          <button type="button" class="active">图片</button>
          <button type="button">视频</button>
          <button type="button">音频</button>
          <button type="button">文档</button>
          <button type="button">主体</button>
        </nav>
        <div class="asset-image-grid">
          <button
            v-for="asset in assetLibraryImages"
            :key="asset.id"
            type="button"
            :title="`添加 ${asset.label} 到参考图`"
            @click="addAssetReference(asset)"
          >
            <img :src="asset.dataUrl" :alt="asset.label" />
            <span><i class="bi bi-plus-lg"></i></span>
          </button>
        </div>
        <div v-if="!assetLibraryImages.length" class="asset-empty">
          <i class="bi bi-images"></i>
          <p>没有匹配的图片资产</p>
        </div>
        <footer class="asset-library-footer">
          <span>{{ assetLibraryImages.length }} 个图片资产</span>
          <small>点击图片即可添加为参考图</small>
        </footer>
      </aside>
    </Transition>

    <div v-if="pendingDeleteConversation" class="assistant-dialog-layer" role="presentation">
      <section
        class="assistant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        <span class="dialog-icon is-danger"><i class="bi bi-trash3"></i></span>
        <div>
          <h2 id="delete-dialog-title">删除这个对话？</h2>
          <p>{{ pendingDeleteConversation.title }}</p>
        </div>
        <div class="dialog-actions">
          <button type="button" @click="pendingDeleteId = ''">取消</button>
          <button
            type="button"
            class="is-danger"
            @click="deleteConversation(pendingDeleteConversation.id)"
          >
            删除
          </button>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <Transition name="image-viewer-fade">
        <div
          v-if="selectedImage"
          class="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="生成图片全屏预览"
          @click.self="closeImagePreview"
        >
          <header class="image-viewer__head">
            <div class="image-viewer__title">
              <strong>全屏预览</strong>
              <small v-if="imageViewerPositionLabel">{{ imageViewerPositionLabel }}</small>
              <small>{{
                selectedImage.revisedPrompt || selectedImage.name || 'AI 生成图片'
              }}</small>
              <small v-if="imageViewerDimensionsLabel" class="is-size">
                {{ imageViewerDimensionsLabel }}
              </small>
            </div>
          </header>

          <div class="image-viewer__actions" aria-label="预览操作" @click.stop>
            <button
              type="button"
              title="下载原图"
              aria-label="下载原图"
              @click="downloadImage(selectedImage, selectedImage.index)"
            >
              <i class="bi bi-download"></i>
            </button>
            <button type="button" title="关闭预览" aria-label="关闭预览" @click="closeImagePreview">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>

          <div class="image-viewer__stage">
            <button
              v-if="selectedImage.gallery.length > 1"
              class="image-viewer__nav is-previous"
              type="button"
              title="上一张"
              aria-label="上一张"
              @click.stop="stepImagePreview(-1)"
            >
              <i class="bi bi-chevron-left"></i>
            </button>
            <div
              ref="imageViewerFrame"
              class="image-viewer__frame"
              :class="{
                'is-zoomed': imageViewerZoom > 1,
                'is-panning': imageViewerPanning,
              }"
              @wheel.prevent="handleImageViewerWheel"
              @dblclick.prevent="toggleImageViewerZoom"
              @pointerdown="startImageViewerPan"
              @pointermove="moveImageViewerPan"
              @pointerup="endImageViewerPan"
              @pointercancel="endImageViewerPan"
            >
              <div
                :key="`${selectedImage.index}-${selectedImage.dataUrl}`"
                class="image-viewer__image-layer"
                :style="imageViewerImageStyle"
              >
                <img
                  :src="selectedImage.dataUrl"
                  :alt="selectedImage.revisedPrompt || selectedImage.name || 'AI 生成图片'"
                  draggable="false"
                  @load="handleImageViewerLoad"
                  @dragstart.prevent
                />
              </div>
            </div>
            <button
              v-if="selectedImage.gallery.length > 1"
              class="image-viewer__nav is-next"
              type="button"
              title="下一张"
              aria-label="下一张"
              @click.stop="stepImagePreview(1)"
            >
              <i class="bi bi-chevron-right"></i>
            </button>
          </div>

          <div class="image-viewer__zoom-tools" aria-label="图片缩放工具" @click.stop>
            <button
              type="button"
              :disabled="imageViewerZoom <= IMAGE_VIEWER_MIN_ZOOM"
              aria-label="缩小图片"
              @click="zoomImageViewer(-IMAGE_VIEWER_ZOOM_STEP)"
            >
              <i class="bi bi-zoom-out"></i><span>缩小</span>
            </button>
            <output>{{ imageViewerZoomLabel }}</output>
            <button
              type="button"
              :disabled="imageViewerZoom >= IMAGE_VIEWER_MAX_ZOOM"
              aria-label="放大图片"
              @click="zoomImageViewer(IMAGE_VIEWER_ZOOM_STEP)"
            >
              <i class="bi bi-zoom-in"></i><span>放大</span>
            </button>
            <button type="button" aria-label="适应屏幕" @click="resetImageViewer">
              <i class="bi bi-arrows-angle-contract"></i><span>适应屏幕</span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.assistant-workspace {
  --assistant-bg: #fdfdfc;
  --assistant-panel: #f5f5f2;
  --assistant-panel-hover: #eaeae6;
  --assistant-panel-active: #e8e6f5;
  --assistant-card: #ffffff;
  --assistant-text: #22231f;
  --assistant-text-soft: #51534e;
  --assistant-muted: #73766f;
  --assistant-border: #dedfd9;
  --assistant-border-strong: #c7c9c1;
  --assistant-accent: #6556d9;
  --assistant-accent-ink: #5143bd;
  --assistant-accent-soft: #eeecff;
  --assistant-success: #148162;
  --assistant-danger: #b43c31;
  --assistant-danger-soft: #fff0ed;
  --assistant-user-bubble: #eff0eb;
  --assistant-image-bg: #ebede7;
  --assistant-shadow: 0 12px 36px rgb(27 28 24 / 10%);
  --assistant-overlay: rgb(20 20 18 / 54%);
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-width: 0;
  color: var(--assistant-text);
  background: var(--assistant-bg);
  color-scheme: light;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.assistant-workspace.is-dark {
  --assistant-bg: #191a18;
  --assistant-panel: #121311;
  --assistant-panel-hover: #282925;
  --assistant-panel-active: #2d2a40;
  --assistant-card: #20211f;
  --assistant-text: #f2f2ed;
  --assistant-text-soft: #c6c8c0;
  --assistant-muted: #999c93;
  --assistant-border: #343630;
  --assistant-border-strong: #4a4d45;
  --assistant-accent: #9789ff;
  --assistant-accent-ink: #b8afff;
  --assistant-accent-soft: #302d49;
  --assistant-success: #4fc9a3;
  --assistant-danger: #ff8d82;
  --assistant-danger-soft: #3a211e;
  --assistant-user-bubble: #2a2b27;
  --assistant-image-bg: #141512;
  --assistant-shadow: 0 18px 48px rgb(0 0 0 / 32%);
  --assistant-overlay: rgb(0 0 0 / 68%);
  color-scheme: dark;
}

.assistant-workspace.is-sidebar-collapsed {
  grid-template-columns: 72px minmax(0, 1fr);
}

button,
textarea,
select {
  font: inherit;
  letter-spacing: 0;
}
button {
  color: inherit;
}

button:focus-visible,
textarea:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid var(--assistant-accent);
  outline-offset: 2px;
}

.assistant-sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 10px;
  background: var(--assistant-panel);
  border-right: 1px solid var(--assistant-border);
}

.assistant-brand-row,
.assistant-brand,
.assistant-account,
.assistant-topbar,
.composer-toolbar,
.composer-left,
.assistant-message-label,
.message-actions,
.generated-images figcaption {
  display: flex;
  align-items: center;
}

.assistant-brand-row {
  justify-content: space-between;
  padding: 2px 2px 12px;
}
.assistant-brand {
  gap: 9px;
  border: 0;
  background: transparent;
  padding: 7px;
  cursor: pointer;
}
.assistant-brand strong {
  font-size: 16px;
}
.assistant-brand-mark,
.empty-mark,
.assistant-message-label span {
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--assistant-text);
}
.is-dark .assistant-brand-mark,
.is-dark .empty-mark,
.is-dark .assistant-message-label span {
  color: #171816;
  background: var(--assistant-accent);
}
.assistant-brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}

.icon-button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.icon-button:hover {
  background: var(--assistant-panel-hover);
}

.new-chat-button,
.sidebar-shortcuts button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 11px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.new-chat-button {
  padding: 10px 11px;
  font-weight: 600;
}
.new-chat-button:hover,
.sidebar-shortcuts button:hover,
.sidebar-shortcuts button.active {
  background: var(--assistant-panel-hover);
}
.new-chat-button {
  color: var(--assistant-text-soft);
}
.new-chat-button i {
  color: var(--assistant-accent-ink);
}
.sidebar-shortcuts button.active {
  color: var(--assistant-accent-ink);
  background: var(--assistant-accent-soft);
}
.sidebar-shortcuts {
  display: grid;
  gap: 2px;
  padding: 6px 0 12px;
  border-bottom: 1px solid var(--assistant-border);
}
.sidebar-shortcuts button {
  padding: 9px 11px;
  font-size: 14px;
}
.sidebar-shortcuts i {
  font-size: 16px;
}

.conversation-section {
  min-height: 0;
  flex: 1;
  padding-top: 12px;
  overflow: hidden;
}
.conversation-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 9px 7px;
  color: var(--assistant-muted);
  font-size: 12px;
  font-weight: 600;
}
.conversation-label small {
  font-size: 10px;
  font-weight: 500;
}
.conversation-search {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--assistant-muted);
  background: var(--assistant-card);
}
.conversation-search:focus-within {
  border-color: var(--assistant-border-strong);
}
.conversation-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--assistant-text);
  background: transparent;
  font-size: 12px;
}
.conversation-search input::placeholder {
  color: var(--assistant-muted);
}
.conversation-search button {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}
.conversation-search button:hover {
  background: var(--assistant-panel-hover);
}
.conversation-list {
  height: calc(100% - 79px);
  overflow: auto;
  scrollbar-width: thin;
}
.conversation-row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 7px;
}
.conversation-row:hover,
.conversation-row.active {
  background: var(--assistant-panel-hover);
}
.conversation-row.active {
  color: var(--assistant-accent-ink);
  background: var(--assistant-panel-active);
}
.conversation-select {
  min-width: 0;
  flex: 1;
  padding: 9px 34px 9px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.conversation-select span {
  display: block;
  overflow: hidden;
  font-size: 13.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-select small {
  display: block;
  margin-top: 2px;
  color: var(--assistant-muted);
  font-size: 10px;
}
.conversation-delete {
  position: absolute;
  right: 5px;
  display: none;
  width: 27px;
  height: 27px;
  border: 0;
  border-radius: 6px;
  color: var(--assistant-muted);
  background: var(--assistant-panel-hover);
  cursor: pointer;
}
.conversation-row:hover .conversation-delete,
.conversation-row.active .conversation-delete {
  display: grid;
  place-items: center;
}
.conversation-delete:hover {
  color: var(--assistant-danger);
  background: var(--assistant-danger-soft);
}
.conversation-empty {
  padding: 18px 8px;
  color: var(--assistant-muted);
  font-size: 12px;
  text-align: center;
}

.assistant-account {
  gap: 9px;
  padding: 9px 6px 4px;
  border-top: 1px solid var(--assistant-border);
}
.account-avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #b6523f;
  font-size: 13px;
  font-weight: 700;
}
.account-meta {
  min-width: 0;
  flex: 1;
}
.account-meta strong,
.account-meta small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-meta strong {
  font-size: 13px;
}
.account-meta small {
  color: var(--assistant-muted);
  font-size: 10px;
}

.assistant-main {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 52px minmax(0, 1fr);
  background: var(--assistant-bg);
}
.assistant-topbar {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, auto) minmax(0, 1fr);
  align-items: center;
  padding: 7px 15px;
  border-bottom: 1px solid color-mix(in srgb, var(--assistant-border) 72%, transparent);
  background: color-mix(in srgb, var(--assistant-bg) 88%, transparent);
  backdrop-filter: blur(14px);
}
.topbar-context {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-status {
  display: inline-flex;
  max-width: 210px;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  border: 1px solid var(--assistant-border);
  border-radius: 7px;
  color: var(--assistant-text-soft);
  background: var(--assistant-card);
  font-size: 12px;
  font-weight: 600;
}
.model-status span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-status__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--assistant-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--assistant-success) 16%, transparent);
}
.active-conversation-title {
  overflow: hidden;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 650;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  justify-content: flex-end;
}
.share-button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.share-button:hover:not(:disabled) {
  background: var(--assistant-panel-hover);
}
.share-button:disabled {
  opacity: 0.4;
}
.mobile-sidebar-button {
  display: none;
}
.theme-toggle i {
  color: var(--assistant-accent-ink);
}

.assistant-messages {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--assistant-border-strong) transparent;
}
.assistant-loading-state,
.assistant-empty-state {
  display: grid;
  min-height: calc(100vh - 240px);
  place-content: center;
  justify-items: center;
  padding: 32px 20px 180px;
}
.assistant-loading-state {
  align-content: center;
  gap: 14px;
  color: var(--assistant-muted);
  font-size: 13px;
}
.loading-orbit {
  position: relative;
  width: 38px;
  height: 38px;
  border: 1px solid var(--assistant-border);
  border-radius: 50%;
}
.loading-orbit i {
  position: absolute;
  top: -3px;
  left: 15px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--assistant-accent);
  transform-origin: 4px 22px;
  animation: assistant-orbit 1s linear infinite;
}
@keyframes assistant-orbit {
  to {
    transform: rotate(360deg);
  }
}
.empty-mark {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  font-size: 21px;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--assistant-text) 15%, transparent);
}
.empty-mode-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 0;
  color: var(--assistant-accent-ink);
  font-size: 11px;
  font-weight: 700;
}
.assistant-empty-state h1 {
  margin: 7px 0 26px;
  font-size: clamp(25px, 3vw, 32px);
  font-weight: 600;
  letter-spacing: 0;
}
.suggestion-grid {
  display: grid;
  width: min(680px, 100%);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.suggestion-grid button {
  display: flex;
  min-height: 48px;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  background: var(--assistant-card);
  color: var(--assistant-text-soft);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    transform 150ms ease;
}
.suggestion-grid button:hover {
  border-color: var(--assistant-border-strong);
  background: var(--assistant-panel);
  transform: translateY(-1px);
}
.suggestion-grid i {
  color: var(--assistant-accent-ink);
}
.suggestion-grid span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-grid .suggestion-arrow {
  color: var(--assistant-muted);
  font-size: 11px;
}

.message-thread {
  width: min(820px, calc(100% - 32px));
  margin: 0 auto;
  padding: 26px 0 220px;
}
.message {
  margin: 0 0 32px;
}
.message--user {
  display: flex;
  justify-content: flex-end;
}
.message--user .message-content {
  max-width: min(72%, 620px);
  padding: 10px 16px;
  border-radius: 18px;
  background: var(--assistant-user-bubble);
}
.message--assistant .message-content {
  padding: 4px 0 0 42px;
}
.message-content p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.message-content.has-error {
  color: var(--assistant-danger);
}
.assistant-message-label {
  gap: 10px;
}
.assistant-message-label span {
  width: 30px;
  height: 30px;
  border-radius: 7px;
}
.assistant-message-label strong {
  font-size: 14px;
}
.message-actions {
  gap: 3px;
  padding: 8px 0 0 38px;
}
.message-actions button,
.generated-images figcaption button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--assistant-muted);
  cursor: pointer;
}
.message-actions button:hover,
.generated-images figcaption button:hover {
  background: var(--assistant-panel-hover);
  color: var(--assistant-text);
}
.message-actions button.active {
  color: var(--assistant-accent-ink);
  background: var(--assistant-accent-soft);
}
.message-actions button:disabled {
  opacity: 0.42;
  cursor: default;
}
.typing-indicator {
  display: inline-flex;
  gap: 4px;
  padding: 8px 0;
}
.typing-indicator i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--assistant-muted);
  animation: assistant-pulse 1.2s infinite ease-in-out;
}
.typing-indicator i:nth-child(2) {
  animation-delay: 0.16s;
}
.typing-indicator i:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes assistant-pulse {
  0%,
  70%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.generated-images {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
.generated-images figure {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  background: var(--assistant-panel);
}
.generated-image-preview {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: var(--assistant-image-bg);
  cursor: zoom-in;
}
.generated-image-preview img {
  display: block;
  width: 100%;
  max-height: 560px;
  object-fit: contain;
  background: var(--assistant-image-bg);
  transition: transform 180ms ease;
}
.generated-image-preview:hover img {
  transform: scale(1.01);
}
.generated-image-preview > span {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 7px;
  color: #fff;
  background: rgb(18 19 17 / 72%);
  opacity: 0;
  transition: opacity 150ms ease;
}
.generated-image-preview:hover > span,
.generated-image-preview:focus-visible > span {
  opacity: 1;
}
.generated-images figcaption {
  gap: 10px;
  min-height: 42px;
  padding: 5px 7px 5px 12px;
  background: var(--assistant-card);
}
.generated-images figcaption span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--assistant-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-zone {
  position: absolute;
  z-index: 4;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 20px 18px 10px;
  background: color-mix(in srgb, var(--assistant-bg) 94%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--assistant-border) 70%, transparent);
  backdrop-filter: blur(14px);
}
.assistant-composer {
  position: relative;
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 10px 10px 8px 16px;
  border: 1px solid var(--assistant-border-strong);
  border-radius: 20px;
  background: var(--assistant-card);
  box-shadow: var(--assistant-shadow);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}
.assistant-composer:focus-within {
  border-color: var(--assistant-accent);
  box-shadow:
    var(--assistant-shadow),
    0 0 0 3px color-mix(in srgb, var(--assistant-accent) 11%, transparent);
}
.assistant-composer.is-image-mode {
  border-color: color-mix(in srgb, #b6523f 52%, var(--assistant-border));
}
.assistant-composer textarea {
  display: block;
  width: 100%;
  min-height: 30px;
  max-height: 160px;
  padding: 3px 2px 8px;
  resize: none;
  overflow-y: auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--assistant-text);
  font-size: 16px;
  line-height: 1.45;
}
.assistant-composer textarea::placeholder {
  color: var(--assistant-muted);
}
.draft-counter {
  position: absolute;
  top: 9px;
  right: 14px;
  color: var(--assistant-muted);
  font-size: 10px;
}
.draft-counter.is-over {
  color: var(--assistant-danger);
}
.composer-toolbar {
  min-height: 34px;
  justify-content: space-between;
  gap: 8px;
}
.composer-left {
  min-width: 0;
  gap: 7px;
}
.mode-switch {
  display: flex;
  padding: 2px;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  background: var(--assistant-panel);
}
.mode-switch button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--assistant-muted);
  font-size: 12px;
  cursor: pointer;
}
.mode-switch button.active {
  color: var(--assistant-accent-ink);
  background: var(--assistant-card);
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}
.compact-select {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 7px;
  border: 1px solid var(--assistant-border);
  border-radius: 7px;
  color: var(--assistant-text-soft);
  background: var(--assistant-card);
}
.compact-select select {
  max-width: 76px;
  border: 0;
  outline: 0;
  color: inherit;
  background: transparent;
  font-size: 12px;
}
.send-button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: var(--assistant-text);
  cursor: pointer;
}
.send-button:disabled {
  color: var(--assistant-muted);
  background: var(--assistant-panel-hover);
  cursor: default;
}
.stop-button {
  background: var(--assistant-danger);
}
.composer-note {
  margin: 7px 0 0;
  color: var(--assistant-muted);
  font-size: 10px;
  text-align: center;
}
.assistant-service-error {
  display: flex;
  width: min(820px, 100%);
  align-items: center;
  gap: 8px;
  margin: 0 auto 8px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--assistant-danger) 32%, var(--assistant-border));
  border-radius: 8px;
  color: var(--assistant-danger);
  background: var(--assistant-danger-soft);
  font-size: 13px;
}
.assistant-service-error span {
  min-width: 0;
  flex: 1;
}
.assistant-service-error button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid currentcolor;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.is-sidebar-collapsed .assistant-sidebar {
  align-items: center;
  padding-inline: 8px;
}
.is-sidebar-collapsed .assistant-brand-row {
  flex-direction: column;
  gap: 7px;
}
.is-sidebar-collapsed .assistant-brand {
  padding: 3px;
}
.is-sidebar-collapsed .assistant-brand strong,
.is-sidebar-collapsed .new-chat-button span,
.is-sidebar-collapsed .sidebar-shortcuts span,
.is-sidebar-collapsed .conversation-section,
.is-sidebar-collapsed .account-meta,
.is-sidebar-collapsed .assistant-account > .icon-button {
  display: none;
}
.is-sidebar-collapsed .new-chat-button,
.is-sidebar-collapsed .sidebar-shortcuts button {
  width: 42px;
  height: 40px;
  justify-content: center;
  padding: 0;
}
.is-sidebar-collapsed .sidebar-shortcuts {
  gap: 5px;
  padding-block: 8px 12px;
}
.is-sidebar-collapsed .assistant-account {
  justify-content: center;
  padding-inline: 0;
}

.assistant-dialog-layer {
  position: absolute;
  z-index: 40;
  inset: 0;
  background: var(--assistant-overlay);
  backdrop-filter: blur(5px);
}
.assistant-dialog-layer {
  display: grid;
  place-items: center;
  padding: 20px;
}
.assistant-dialog {
  display: grid;
  width: min(390px, 100%);
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 13px;
  padding: 20px;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  background: var(--assistant-card);
  box-shadow: 0 24px 70px rgb(0 0 0 / 24%);
}
.dialog-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 8px;
  font-size: 17px;
}
.dialog-icon.is-danger {
  color: var(--assistant-danger);
  background: var(--assistant-danger-soft);
}
.assistant-dialog h2,
.assistant-dialog p {
  margin: 0;
}
.assistant-dialog h2 {
  font-size: 16px;
}
.assistant-dialog p {
  overflow: hidden;
  margin-top: 5px;
  color: var(--assistant-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dialog-actions {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.dialog-actions button {
  padding: 7px 13px;
  border: 1px solid var(--assistant-border);
  border-radius: 7px;
  background: var(--assistant-card);
  font-size: 13px;
  cursor: pointer;
}
.dialog-actions button:hover {
  background: var(--assistant-panel-hover);
}
.dialog-actions button.is-danger {
  border-color: var(--assistant-danger);
  color: #fff;
  background: var(--assistant-danger);
}

.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: block;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  color: #fff;
  background: radial-gradient(circle at 50% 0%, rgb(109 92 255 / 18%), transparent 42%), #040408;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.image-viewer__head {
  position: absolute;
  z-index: 5;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 16px;
  display: flex;
  max-width: calc(100vw - 150px);
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 16px;
  color: rgb(255 255 255 / 92%);
  background: rgb(14 14 22 / 72%);
  box-shadow: 0 12px 32px rgb(0 0 0 / 42%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.image-viewer__title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 12px;
}

.image-viewer__title strong {
  flex: 0 0 auto;
  font-size: 0.98rem;
  font-weight: 650;
  white-space: nowrap;
}

.image-viewer__title small {
  overflow: hidden;
  max-width: min(48vw, 420px);
  color: rgb(255 255 255 / 52%);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer__title small.is-size {
  color: rgb(255 255 255 / 82%);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.image-viewer__actions {
  position: absolute;
  z-index: 6;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 999px;
  background: rgb(14 14 22 / 76%);
  box-shadow: 0 10px 28px rgb(0 0 0 / 42%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.image-viewer__actions button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: transparent;
  cursor: pointer;
  transition: background-color 160ms ease;
}

.image-viewer__actions button:hover {
  background: rgb(255 255 255 / 16%);
}

.image-viewer__stage {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.image-viewer__frame {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  cursor: zoom-in;
  touch-action: none;
  user-select: none;
}

.image-viewer__frame.is-zoomed {
  cursor: grab;
}

.image-viewer__frame.is-panning {
  cursor: grabbing;
}

.image-viewer__image-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transform-origin: center;
  transition: transform 180ms ease-out;
  will-change: transform;
}

.image-viewer__frame.is-panning .image-viewer__image-layer {
  transition: none;
}

.image-viewer__image-layer img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: center;
  background: transparent;
  pointer-events: none;
  user-select: none;
}

.image-viewer__nav {
  position: absolute;
  z-index: 4;
  top: 50%;
  display: inline-flex;
  width: 44px;
  min-width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 999px;
  color: #fff;
  background: rgb(255 255 255 / 8%);
  font-size: 1.2rem;
  cursor: pointer;
  transform: translateY(-50%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.image-viewer__nav:hover {
  background: rgb(255 255 255 / 16%);
}

.image-viewer__nav.is-previous {
  left: 16px;
}

.image-viewer__nav.is-next {
  right: 16px;
}

.image-viewer__zoom-tools {
  position: absolute;
  z-index: 5;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  display: flex;
  max-width: calc(100vw - 24px);
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 16px;
  background: rgb(14 14 22 / 72%);
  box-shadow: 0 12px 32px rgb(0 0 0 / 42%);
  transform: translateX(-50%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.image-viewer__zoom-tools button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  color: #fff;
  background: rgb(255 255 255 / 8%);
  cursor: pointer;
}

.image-viewer__zoom-tools button:hover:not(:disabled) {
  background: rgb(255 255 255 / 16%);
}

.image-viewer__zoom-tools button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.image-viewer__zoom-tools output {
  min-width: 58px;
  color: rgb(255 255 255 / 82%);
  font-size: 0.82rem;
  text-align: center;
}
.assistant-scrim {
  display: none;
}

@media (max-width: 760px) {
  .assistant-workspace {
    grid-template-columns: 1fr;
  }
  .assistant-workspace.is-sidebar-collapsed {
    grid-template-columns: 1fr;
  }
  .assistant-sidebar {
    position: absolute;
    z-index: 20;
    inset: 0 auto 0 0;
    width: min(86vw, 310px);
    transform: translateX(-102%);
    transition: transform 0.2s ease;
  }
  .is-sidebar-collapsed .assistant-sidebar {
    align-items: stretch;
    padding: 10px;
  }
  .is-sidebar-collapsed .assistant-brand-row {
    flex-direction: row;
  }
  .is-sidebar-collapsed .assistant-brand {
    padding: 7px;
  }
  .is-sidebar-collapsed .assistant-brand strong,
  .is-sidebar-collapsed .new-chat-button span,
  .is-sidebar-collapsed .sidebar-shortcuts span,
  .is-sidebar-collapsed .account-meta {
    display: block;
  }
  .is-sidebar-collapsed .conversation-section {
    display: block;
  }
  .is-sidebar-collapsed .assistant-account > .icon-button {
    display: grid;
  }
  .is-sidebar-collapsed .new-chat-button,
  .is-sidebar-collapsed .sidebar-shortcuts button {
    width: 100%;
    height: auto;
    justify-content: flex-start;
  }
  .is-sidebar-collapsed .new-chat-button {
    padding: 10px 11px;
  }
  .is-sidebar-collapsed .sidebar-shortcuts button {
    padding: 9px 11px;
  }
  .is-sidebar-collapsed .assistant-account {
    justify-content: flex-start;
    padding: 9px 6px 4px;
  }
  .assistant-sidebar.is-open {
    transform: translateX(0);
  }
  .assistant-scrim {
    position: absolute;
    z-index: 19;
    inset: 0;
    display: block;
    border: 0;
    background: rgb(0 0 0 / 32%);
  }
  .mobile-sidebar-button {
    display: grid;
  }
  .assistant-topbar {
    padding-inline: 10px;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .active-conversation-title {
    display: none;
  }
  .topbar-context {
    min-width: 0;
  }
  .model-status {
    max-width: min(44vw, 180px);
  }
  .share-button span {
    display: none;
  }
  .assistant-empty-state {
    min-height: calc(100vh - 210px);
    padding-bottom: 160px;
  }
  .suggestion-grid {
    width: min(420px, 100%);
    grid-template-columns: 1fr;
  }
  .message-thread {
    width: calc(100% - 24px);
    padding-top: 18px;
  }
  .message--user .message-content {
    max-width: 88%;
  }
  .message--assistant .message-content {
    padding-left: 40px;
  }
  .composer-zone {
    padding: 12px 10px 7px;
  }
  .assistant-composer {
    padding-left: 13px;
    border-radius: 20px;
  }
  .composer-left {
    max-width: calc(100vw - 78px);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .mode-switch,
  .compact-select {
    flex: 0 0 auto;
  }
  .composer-note {
    margin-top: 5px;
  }
  .image-viewer__head {
    top: calc(10px + env(safe-area-inset-top, 0px));
    left: 10px;
    max-width: calc(100vw - 112px);
    padding: 8px 12px;
  }
  .image-viewer__title small:not(.is-size) {
    display: none;
  }
  .image-viewer__actions {
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: 10px;
    padding: 4px;
  }
  .image-viewer__actions button {
    width: 34px;
    height: 34px;
  }
  .image-viewer__nav {
    width: 40px;
    min-width: 40px;
    height: 40px;
  }
  .image-viewer__nav.is-previous {
    left: 10px;
  }
  .image-viewer__nav.is-next {
    right: 10px;
  }
  .image-viewer__zoom-tools {
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
  .image-viewer__zoom-tools button span {
    display: none;
  }
  .image-viewer__zoom-tools button:last-child span {
    display: inline;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-sidebar,
  .typing-indicator i,
  .loading-orbit i,
  .suggestion-grid button,
  .generated-image-preview img {
    transition: none;
    animation: none;
  }
}

/* Creation workbench layout */
.assistant-workspace {
  --assistant-bg: #f6f7f9;
  --assistant-panel: #ffffff;
  --assistant-panel-hover: #f3f3f2;
  --assistant-panel-active: #efefee;
  --assistant-card: #ffffff;
  --assistant-text: #20211f;
  --assistant-text-soft: #4e514d;
  --assistant-muted: #969b9f;
  --assistant-border: #e8e9ea;
  --assistant-border-strong: #dfe1e2;
  --assistant-accent: #18b6cf;
  --assistant-accent-ink: #10a4be;
  --assistant-accent-soft: #e9f9fc;
  --assistant-ambient:
    linear-gradient(128deg, rgb(77 204 218 / 9%) 0%, transparent 34%),
    linear-gradient(214deg, rgb(184 133 210 / 10%) 0%, transparent 38%),
    linear-gradient(160deg, #f8fafc 0%, #f5f9fa 48%, #faf7fc 100%);
  grid-template-columns: 270px minmax(0, 1fr);
  background: var(--assistant-ambient);
}

.assistant-workspace.is-dark {
  --assistant-bg: #171918;
  --assistant-panel: #101210;
  --assistant-panel-hover: #232623;
  --assistant-panel-active: #2b2e2b;
  --assistant-card: #202320;
  --assistant-text: #f1f2ef;
  --assistant-text-soft: #c6cac5;
  --assistant-muted: #8f9690;
  --assistant-border: #2c302c;
  --assistant-border-strong: #3c413c;
  --assistant-accent: #42c7dc;
  --assistant-accent-ink: #62d2e4;
  --assistant-accent-soft: #173439;
  --assistant-ambient:
    linear-gradient(128deg, rgb(44 180 193 / 9%) 0%, transparent 38%),
    linear-gradient(216deg, rgb(132 94 167 / 11%) 0%, transparent 42%),
    linear-gradient(158deg, #121616 0%, #15181b 48%, #1a171e 100%);
}

.assistant-workspace.is-sidebar-collapsed {
  grid-template-columns: 68px minmax(0, 1fr);
}

.assistant-sidebar {
  padding: 18px 16px 12px;
  border-right: 1px solid var(--assistant-border);
  background: var(--assistant-panel);
}

.assistant-brand-row {
  min-height: 34px;
  padding: 0 2px 13px;
}

.assistant-brand {
  padding: 3px 2px;
}

.assistant-brand strong {
  font-size: 15px;
  font-weight: 650;
}

.sidebar-close {
  width: 30px;
  height: 30px;
  flex-basis: 30px;
}

.new-chat-button {
  min-height: 42px;
  gap: 12px;
  margin-bottom: 5px;
  padding: 9px 10px;
  border: 1px solid var(--assistant-border);
  background: var(--assistant-card);
  font-size: 13px;
  font-weight: 600;
}

.new-chat-button:hover {
  border-color: var(--assistant-border-strong);
  background: var(--assistant-panel-hover);
}

.conversation-section {
  padding-top: 14px;
}

.conversation-label {
  margin: 0 6px 7px;
  color: var(--assistant-muted);
  font-size: 11px;
  font-weight: 600;
}

.conversation-list {
  height: calc(100% - 26px);
}

.conversation-row {
  min-height: 43px;
  margin-bottom: 2px;
  border-radius: 7px;
}

.conversation-row:hover,
.conversation-row.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.conversation-select {
  display: grid;
  min-height: 43px;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 5px 34px 5px 5px;
}

.conversation-thumb {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--assistant-border);
  border-radius: 6px;
  color: var(--assistant-text-soft);
  background: var(--assistant-card);
}

.conversation-thumb.has-image {
  color: #f3e5c6;
  background: #596f69;
}

.conversation-copy {
  display: block;
  min-width: 0;
}

.conversation-copy > span {
  display: block;
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-copy small {
  display: none;
}

.conversation-delete {
  background: transparent;
}

.assistant-main {
  grid-template-rows: 72px minmax(0, 1fr);
  background: var(--assistant-ambient);
}

.assistant-topbar {
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding: 10px 28px;
  border: 0;
  background: transparent;
  backdrop-filter: none;
}

.topbar-title {
  display: flex;
  min-width: 0;
  align-items: center;
  padding-left: clamp(30px, 17vw, 330px);
}

.topbar-title h1 {
  margin: 0;
  font-size: 25px;
  font-weight: 650;
}

.topbar-filters {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 4px;
  border: 1px solid var(--assistant-border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--assistant-card) 94%, transparent);
  box-shadow: 0 3px 16px rgb(32 33 31 / 3%);
}

.topbar-filters > button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 0;
  border-radius: 6px;
  color: var(--assistant-text-soft);
  background: transparent;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.topbar-filters > button:hover {
  background: var(--assistant-panel-hover);
}

.topbar-filters > button i {
  font-size: 11px;
}

.topbar-filters .filter-search,
.topbar-filters .theme-toggle {
  width: 32px;
  min-width: 32px;
  padding: 0;
  justify-content: center;
}

.assistant-messages {
  position: relative;
}

.assistant-empty-state {
  min-height: 100%;
  padding: 0;
}

.assistant-loading-state {
  position: absolute;
  top: 190px;
  left: clamp(80px, 18vw, 350px);
  min-height: 0;
  grid-auto-flow: column;
  align-items: center;
  gap: 10px;
  padding: 0;
  color: var(--assistant-text-soft);
  font-size: 12px;
}

.thinking-spark {
  position: relative;
  width: 14px;
  height: 20px;
}

.thinking-spark i {
  position: absolute;
  left: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--assistant-accent);
  animation: thinking-spark 1.1s ease-in-out infinite;
}

.thinking-spark i:first-child {
  top: 3px;
}

.thinking-spark i:last-child {
  bottom: 3px;
  animation-delay: 0.3s;
}

@keyframes thinking-spark {
  0%,
  100% {
    opacity: 0.25;
    transform: translateX(0);
  }
  50% {
    opacity: 1;
    transform: translateX(4px);
  }
}

.message-thread {
  width: min(1120px, calc(100% - 64px));
  padding: 34px 0 250px;
}

.message {
  margin-bottom: 34px;
}

.message--user .message-content {
  max-width: min(56%, 620px);
  padding: 14px 18px;
  border-radius: 18px;
  background: var(--assistant-panel-active);
}

.message--assistant {
  max-width: 72%;
}

.assistant-message-label span {
  color: var(--assistant-accent-ink);
  background: var(--assistant-accent-soft);
}

.composer-zone {
  position: absolute;
  right: 0;
  bottom: 12px;
  left: 0;
  padding: 0 28px;
  border: 0;
  background: transparent;
  backdrop-filter: none;
}

.assistant-service-error {
  width: min(1120px, 100%);
  margin-bottom: 8px;
}

.assistant-composer {
  position: relative;
  width: min(1120px, 100%);
  min-height: 190px;
  padding: 22px 18px 14px 104px;
  border: 1px solid var(--assistant-border-strong);
  border-radius: 22px;
  background: var(--assistant-card);
  box-shadow: 0 10px 34px rgb(30 32 30 / 7%);
}

.assistant-composer:focus-within {
  border-color: color-mix(in srgb, var(--assistant-accent) 58%, var(--assistant-border-strong));
  box-shadow:
    0 12px 38px rgb(30 32 30 / 9%),
    0 0 0 3px color-mix(in srgb, var(--assistant-accent) 9%, transparent);
}

.composer-attachment {
  position: absolute;
  top: 27px;
  left: 28px;
  display: grid;
  width: 58px;
  height: 72px;
  place-items: center;
  border: 0;
  border-radius: 2px;
  color: #a4aaae;
  background: #f0f1f2;
  font-size: 18px;
  transform: rotate(-8deg);
  cursor: pointer;
}

.is-dark .composer-attachment {
  background: #2a2d2a;
}

.assistant-composer textarea {
  min-height: 102px;
  max-height: 122px;
  padding: 3px 10px 12px 0;
  font-size: 14px;
}

.assistant-composer textarea::placeholder {
  color: #a2a7aa;
}

.composer-toolbar {
  min-height: 38px;
}

.composer-left {
  gap: 6px;
}

.agent-mode-button,
.composer-tool-button,
.voice-button {
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  color: var(--assistant-text-soft);
  background: var(--assistant-card);
  font-size: 12px;
  cursor: pointer;
}

.agent-mode-button {
  color: var(--assistant-accent-ink);
  white-space: nowrap;
}

.agent-mode-button:hover,
.composer-tool-button:hover,
.voice-button:hover {
  background: var(--assistant-panel-hover);
}

.composer-tool-button.is-mention {
  width: 34px;
  padding: 0;
  color: var(--assistant-accent-ink);
  font-size: 17px;
  font-weight: 700;
}

.voice-button {
  width: 34px;
  margin-left: auto;
  padding: 0;
  border-color: transparent;
  color: var(--assistant-muted);
}

.send-button {
  width: 42px;
  height: 42px;
  flex-basis: 42px;
  margin-left: 4px;
  color: #fff;
  background: #111311;
}

.is-dark .send-button {
  color: #151715;
  background: #f2f4f1;
}

.send-button:disabled {
  color: #9ca19d;
  background: #eceeec;
}

.is-dark .send-button:disabled {
  background: #343834;
}

.draft-counter {
  top: 20px;
}

@media (max-width: 900px) {
  .assistant-workspace,
  .assistant-workspace.is-sidebar-collapsed {
    grid-template-columns: 1fr;
  }

  .assistant-sidebar {
    width: min(84vw, 300px);
  }

  .assistant-topbar {
    min-width: 0;
    padding: 8px 12px;
  }

  .topbar-title {
    padding-left: 0;
  }

  .topbar-title h1 {
    margin-left: 8px;
    font-size: 19px;
  }

  .topbar-filters {
    max-width: 64vw;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .topbar-filters > button:nth-child(2),
  .topbar-filters > button:nth-child(4) {
    display: none;
  }

  .assistant-loading-state {
    top: 160px;
    left: 34px;
  }

  .composer-zone {
    bottom: 8px;
    padding-inline: 10px;
  }

  .assistant-composer {
    min-height: 154px;
    padding: 16px 12px 10px 66px;
    border-radius: 18px;
  }

  .composer-attachment {
    top: 20px;
    left: 17px;
    width: 38px;
    height: 50px;
  }

  .assistant-composer textarea {
    min-height: 78px;
    max-height: 86px;
    font-size: 13px;
  }

  .composer-left {
    max-width: calc(100vw - 145px);
  }

  .composer-tool-button span {
    display: none;
  }

  .message-thread {
    width: calc(100% - 24px);
    padding-bottom: 210px;
  }

  .message--user .message-content {
    max-width: 84%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-spark i {
    animation: none;
  }
}

/* Detailed creation states */
.message--assistant {
  max-width: 100%;
}

.assistant-message-label {
  gap: 5px;
  color: var(--assistant-text-soft);
}

.assistant-message-label strong {
  font-size: 13px;
  font-weight: 600;
}

.assistant-message-label > i {
  color: var(--assistant-muted);
  font-size: 10px;
}

.message--assistant .message-content {
  padding: 11px 0 0;
}

.message-content p {
  font-size: 14px;
  line-height: 1.75;
}

.sent-quote {
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--assistant-border);
  color: var(--assistant-muted);
  font-size: 12px;
}

.sent-quote span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.generated-images {
  width: min(560px, 100%);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.generated-images figure {
  position: relative;
  overflow: hidden;
  border: 0;
  border-radius: 3px;
  background: var(--assistant-image-bg);
}

.generated-image-preview img {
  width: 100%;
  height: auto;
  max-height: none;
  aspect-ratio: auto;
  object-fit: contain;
}

.generated-images.is-single {
  width: min(180px, 100%);
  grid-template-columns: minmax(0, 1fr);
}

.generated-images.is-single .generated-image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
}

.generated-images.is-single .generated-image-preview img {
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: min(220px, 32vh);
  object-fit: contain;
}

.generated-images.is-single .generated-image-preview:hover img {
  transform: none;
}

.generated-image-actions {
  position: absolute;
  right: 9px;
  bottom: 9px;
  opacity: 0;
  transition: opacity 150ms ease;
}

.generated-images figure:hover .generated-image-actions,
.generated-images figure:focus-within .generated-image-actions {
  opacity: 1;
}

.generated-image-actions button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: #fff;
  background: rgb(15 17 16 / 72%);
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 12px 0 0;
  color: var(--assistant-muted);
  font-size: 12px;
}

.message-meta span {
  width: 1px;
  height: 11px;
  background: var(--assistant-border-strong);
}

.message-actions {
  position: relative;
  gap: 5px;
  padding: 10px 0 0;
}

.message-actions > button {
  width: 40px;
  height: 40px;
  border: 1px solid color-mix(in srgb, var(--assistant-border) 70%, transparent);
  border-radius: 8px;
  color: var(--assistant-text-soft);
  background: var(--assistant-panel-active);
  font-size: 14px;
}

.message-actions > button:hover:not(:disabled) {
  color: var(--assistant-text);
  background: var(--assistant-panel-hover);
}

.message-actions .regenerate-button {
  display: inline-flex;
  width: auto;
  min-width: 96px;
  gap: 7px;
  padding: 0 13px;
}

.message-actions .regenerate-button:disabled {
  opacity: 0.52;
}

.message-more-menu {
  position: absolute;
  z-index: 12;
  top: 9px;
  left: 190px;
  display: grid;
  width: 170px;
  gap: 3px;
  padding: 7px;
  border: 1px solid var(--assistant-border);
  border-radius: 10px;
  background: var(--assistant-card);
  box-shadow: 0 16px 46px rgb(0 0 0 / 18%);
}

.message-more-menu button {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  color: var(--assistant-text);
  background: transparent;
  cursor: pointer;
}

.message-more-menu button:hover {
  background: var(--assistant-panel-hover);
}

.message-more-menu button.is-danger {
  color: var(--assistant-danger);
}

.assistant-composer {
  overflow: visible;
}

.composer-popover,
.nested-selection-menu {
  color: var(--assistant-text);
  background: var(--assistant-card);
  box-shadow: 0 20px 56px rgb(0 0 0 / 20%);
}

.composer-popover {
  position: absolute;
  z-index: 20;
  bottom: 52px;
  left: 18px;
  border: 1px solid var(--assistant-border);
  border-radius: 16px;
}

.popover-eyebrow,
.preferences-label,
.nested-selection-menu > p {
  margin: 0;
  color: var(--assistant-muted);
  font-size: 12px;
}

.creation-type-menu {
  display: grid;
  width: 260px;
  gap: 3px;
  padding: 12px;
}

.creation-type-menu .popover-eyebrow {
  padding: 2px 10px 7px;
}

.creation-type-menu > button {
  display: grid;
  min-height: 44px;
  grid-template-columns: 24px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.creation-type-menu > button:hover,
.creation-type-menu > button.active {
  background: var(--assistant-panel-active);
}

.creation-type-menu > button > i:first-child {
  font-size: 17px;
}

.menu-check {
  margin-left: auto;
  color: var(--assistant-text);
}

.generation-preferences {
  left: 104px;
  width: min(710px, calc(100% - 122px));
  padding: 22px;
}

.preferences-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.preferences-header strong {
  font-size: 19px;
  font-weight: 650;
}

.auto-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--assistant-muted);
  cursor: pointer;
}

.auto-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.auto-switch i {
  position: relative;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--assistant-border-strong);
  transition: background 150ms ease;
}

.auto-switch i::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  content: '';
  box-shadow: 0 1px 4px rgb(0 0 0 / 22%);
  transition: transform 150ms ease;
}

.auto-switch input:checked + i {
  background: var(--assistant-accent);
}

.auto-switch input:checked + i::after {
  transform: translateX(18px);
}

.media-type-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 3px;
  border-radius: 12px;
  background: var(--assistant-panel-hover);
}

.media-type-tabs button {
  height: 48px;
  border: 0;
  border-radius: 10px;
  color: var(--assistant-muted);
  background: transparent;
  cursor: pointer;
}

.media-type-tabs button.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
  box-shadow: 0 1px 3px rgb(0 0 0 / 5%);
}

.preferences-label {
  margin: 20px 0 10px;
}

.ratio-options {
  display: grid;
  grid-template-columns: repeat(9, minmax(48px, 1fr));
  gap: 2px;
  padding: 3px;
  border-radius: 12px;
  background: var(--assistant-panel-hover);
}

.ratio-options button {
  display: flex;
  min-width: 0;
  height: 72px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 2px;
  border: 0;
  border-radius: 9px;
  color: var(--assistant-muted);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.ratio-options button.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.ratio-shape {
  display: block;
  width: 20px;
  height: 12px;
  border: 2px solid currentcolor;
  border-radius: 3px;
}

.ratio-shape.is-auto {
  width: 18px;
  height: 18px;
  border-style: dashed;
}

.ratio-shape.is-square {
  width: 16px;
  height: 16px;
}

.ratio-shape.is-portrait {
  width: 12px;
  height: 20px;
}

.generation-setting-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.generation-setting-row > button {
  display: flex;
  height: 48px;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  color: var(--assistant-text-soft);
  background: var(--assistant-panel-hover);
  cursor: pointer;
}

.generation-setting-row > button.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.generation-setting-row > button span:not(.resolution-icon) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resolution-icon {
  display: inline-grid;
  min-width: 24px;
  height: 18px;
  place-items: center;
  border: 1px solid currentcolor;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
}

.nested-selection-menu {
  position: absolute;
  z-index: 24;
  right: 22px;
  bottom: 76px;
  left: 22px;
  overflow-y: auto;
  max-height: min(540px, calc(100vh - 160px));
  padding: 12px;
  border: 1px solid var(--assistant-border);
  border-radius: 14px;
}

.nested-selection-menu > p {
  padding: 3px 8px 11px;
}

.model-selection-menu > button {
  display: grid;
  width: 100%;
  min-height: 76px;
  grid-template-columns: 52px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border: 0;
  border-radius: 11px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.model-selection-menu > button:hover,
.model-selection-menu > button.active,
.quality-selection-menu > button.active {
  background: var(--assistant-panel-active);
}

.model-mark {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid var(--assistant-border-strong);
  border-radius: 10px;
  font-size: 20px;
}

.model-copy,
.model-copy strong,
.model-copy small {
  display: block;
  min-width: 0;
}

.model-copy strong {
  font-size: 15px;
}

.model-copy small {
  overflow: hidden;
  margin-top: 5px;
  color: var(--assistant-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quality-selection-menu {
  right: 22px;
  bottom: 74px;
  left: auto;
  width: min(300px, calc(100% - 44px));
}

.quality-selection-menu > button {
  display: grid;
  width: 100%;
  height: 54px;
  grid-template-columns: 28px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.skill-menu {
  left: 104px;
  width: min(570px, calc(100% - 122px));
  overflow: hidden;
}

.skill-search-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin: 0 14px;
  border-bottom: 1px solid var(--assistant-border);
  color: var(--assistant-muted);
}

.skill-search-row input {
  min-width: 0;
  height: 48px;
  border: 0;
  outline: 0;
  color: var(--assistant-text);
  background: transparent;
}

.skill-search-row input::placeholder {
  color: var(--assistant-muted);
}

.skill-search-row button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  color: var(--assistant-muted);
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}

.skill-list {
  max-height: min(360px, calc(100vh - 300px));
  overflow-y: auto;
  padding: 8px 12px;
}

.skill-list > button {
  display: grid;
  width: 100%;
  min-height: 64px;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.skill-list > button:hover {
  background: var(--assistant-panel-hover);
}

.skill-list > button > i {
  margin-top: 2px;
  font-size: 18px;
}

.skill-list span,
.skill-list strong,
.skill-list em {
  display: block;
  min-width: 0;
}

.skill-list strong {
  font-size: 14px;
}

.skill-list strong small {
  margin-left: 5px;
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--assistant-muted);
  background: var(--assistant-panel-active);
  font-size: 10px;
  font-weight: 500;
}

.skill-list em {
  overflow: hidden;
  margin-top: 5px;
  color: var(--assistant-muted);
  font-size: 12px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-empty {
  padding: 28px;
  color: var(--assistant-muted);
  text-align: center;
}

.skill-footer {
  display: grid;
  gap: 2px;
  padding: 8px 12px;
  border-top: 1px solid var(--assistant-border);
}

.skill-footer button {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.skill-footer button:hover {
  background: var(--assistant-panel-hover);
}

.slash-hint {
  position: absolute;
  z-index: 18;
  bottom: 58px;
  left: 292px;
  padding: 10px 13px;
  border: 1px solid var(--assistant-border);
  border-radius: 9px;
  color: var(--assistant-text-soft);
  background: var(--assistant-card);
  box-shadow: 0 10px 30px rgb(0 0 0 / 16%);
  font-size: 12px;
  cursor: pointer;
}

.composer-quote {
  display: flex;
  min-width: 0;
  height: 34px;
  align-items: center;
  gap: 8px;
  margin: -2px 0 8px;
  padding: 0 9px;
  border-radius: 8px;
  color: var(--assistant-muted);
  background: var(--assistant-panel-hover);
  font-size: 12px;
}

.composer-quote > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-quote > button,
.selected-skill button {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--assistant-muted);
  background: transparent;
  cursor: pointer;
}

.composer-quote > button:hover,
.selected-skill button:hover {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.selected-skill {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  margin: -1px 0 6px;
  color: var(--assistant-text-soft);
  font-size: 13px;
}

.agent-mode-button.active,
.composer-tool-button.active {
  border-color: var(--assistant-border-strong);
  background: var(--assistant-panel-active);
}

@media (max-width: 900px) {
  .composer-popover {
    right: 8px;
    bottom: 48px;
    left: 8px;
    width: auto;
    max-height: calc(100vh - 150px);
  }

  .creation-type-menu {
    right: auto;
    width: min(270px, calc(100% - 16px));
  }

  .generation-preferences {
    overflow-y: auto;
    padding: 16px;
  }

  .ratio-options {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .ratio-options button {
    min-width: 56px;
  }

  .skill-list {
    max-height: min(300px, calc(100vh - 300px));
  }

  .nested-selection-menu {
    right: 12px;
    bottom: 68px;
    left: 12px;
  }

  .quality-selection-menu {
    left: auto;
  }

  .slash-hint {
    bottom: 54px;
    left: 178px;
  }

  .message-meta {
    flex-wrap: wrap;
  }
}

@media (max-width: 560px) {
  .generated-images.is-single {
    width: min(160px, 100%);
  }

  .generated-images.is-single .generated-image-preview img {
    max-height: min(200px, 34vh);
  }

  .generation-setting-row {
    grid-template-columns: 1fr;
  }

  .preferences-header strong {
    font-size: 17px;
  }

  .media-type-tabs button {
    height: 42px;
  }

  .message-more-menu {
    right: 0;
    left: auto;
  }

  .composer-quote {
    margin-right: -2px;
  }

  .selected-skill {
    max-width: calc(100% - 8px);
  }
}

/* Image generation mode */
.message-date-divider {
  margin: 14px 0 30px;
  color: var(--assistant-text);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: 0;
}

.image-generation-stage {
  width: min(560px, 100%);
  padding-top: 2px;
}

.image-generation-summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--assistant-muted);
  font-size: 12px;
}

.image-generation-summary strong {
  overflow: hidden;
  max-width: 260px;
  color: var(--assistant-text-soft);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-generation-summary > i {
  width: 1px;
  height: 11px;
  background: var(--assistant-border-strong);
}

.image-generation-summary button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--assistant-muted);
  background: transparent;
  cursor: pointer;
}

.image-dream-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--assistant-border);
}

.image-dream-grid.is-single {
  width: min(180px, 100%);
  grid-template-columns: minmax(0, 1fr);
}

.image-dream-slot {
  position: relative;
  min-width: 0;
  aspect-ratio: var(--image-skeleton-ratio, 1 / 1);
  overflow: hidden;
  background:
    linear-gradient(135deg, rgb(221 126 138 / 54%), transparent 46%),
    linear-gradient(225deg, rgb(55 113 210 / 72%), transparent 58%),
    linear-gradient(45deg, #412d63, #0a5b7e 45%, #151522);
  isolation: isolate;
}

.image-dream-grid.is-preparing {
  gap: 8px;
  overflow: visible;
  background: transparent;
}

.image-dream-grid.is-preparing .image-dream-slot {
  border: 1px solid color-mix(in srgb, var(--assistant-border-strong) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--assistant-card) 42%, transparent);
}

.image-dream-grid.is-preparing .image-dream-slot::before {
  inset: 0;
  background: linear-gradient(
    105deg,
    transparent 24%,
    color-mix(in srgb, var(--assistant-text) 7%, transparent) 42%,
    transparent 60%
  );
  filter: none;
  transform: translateX(-100%);
  animation: image-skeleton-sweep 1.55s ease-in-out infinite;
}

.image-dream-grid.is-preparing .image-dream-slot::after {
  display: none;
}

@keyframes image-skeleton-sweep {
  0% {
    transform: translateX(-100%);
  }
  65%,
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .image-dream-grid.is-preparing .image-dream-slot::before {
    animation: none;
    transform: none;
  }
}

.image-dream-slot:nth-child(even) {
  background:
    linear-gradient(145deg, rgb(186 113 180 / 58%), transparent 48%),
    linear-gradient(240deg, rgb(62 155 180 / 62%), transparent 60%),
    linear-gradient(55deg, #23345a, #5b496e 48%, #141823);
}

.image-dream-slot::before {
  position: absolute;
  z-index: 1;
  inset: -35%;
  background: conic-gradient(
    from 20deg,
    transparent,
    rgb(96 222 237 / 48%),
    transparent 32%,
    rgb(234 139 194 / 42%),
    transparent 68%
  );
  content: '';
  filter: blur(22px);
  animation: image-dream-rotate 6s linear infinite;
}

.image-dream-slot::after {
  position: absolute;
  z-index: 4;
  width: var(--image-progress, 8%);
  bottom: 0;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, #48dce9, #9d87ff, #f19ac7);
  content: '';
  transition: width 500ms ease;
}

@keyframes image-dream-rotate {
  to {
    transform: rotate(360deg);
  }
}

.image-generation-queue {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 10px;
  color: var(--assistant-muted);
  font-size: 12px;
}

.image-generation-queue span {
  padding: 4px 7px;
  border-radius: 5px;
  background: var(--assistant-panel-active);
}

.image-generation-queue strong {
  font-weight: 500;
}

.image-mode-preferences {
  left: 104px;
  width: min(760px, calc(100% - 122px));
  padding: 22px;
}

.image-mode-preferences > .preferences-label:first-child {
  margin-top: 0;
}

.image-resolution-options,
.image-count-options {
  display: grid;
  padding: 3px;
  border-radius: 11px;
  background: var(--assistant-panel-hover);
}

.image-resolution-options {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.image-count-options {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.image-resolution-options button,
.image-count-options button {
  height: 50px;
  border: 0;
  border-radius: 9px;
  color: var(--assistant-text-soft);
  background: transparent;
  cursor: pointer;
}

.image-resolution-options button.active,
.image-count-options button.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.image-resolution-options button i {
  margin-left: 5px;
  color: var(--assistant-accent-ink);
  font-size: 11px;
}

.custom-image-size {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 9px;
}

.custom-image-size label {
  display: grid;
  height: 50px;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-radius: 10px;
  color: var(--assistant-muted);
  background: var(--assistant-panel-hover);
}

.custom-image-size input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  color: var(--assistant-text);
  background: transparent;
  text-align: right;
}

.custom-image-size > i,
.custom-image-size > span {
  color: var(--assistant-muted);
  text-align: center;
}

.custom-image-size > i {
  font-size: 22px;
}

.image-model-menu {
  left: 104px;
  display: grid;
  width: min(560px, calc(100% - 122px));
  gap: 3px;
  padding: 12px;
}

.image-model-menu .popover-eyebrow {
  padding: 4px 9px 9px;
}

.image-model-menu > button {
  display: grid;
  min-height: 68px;
  grid-template-columns: 48px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.image-model-menu > button:hover,
.image-model-menu > button.active {
  background: var(--assistant-panel-active);
}

.image-model-button > i:last-child,
.image-settings-button > i + span + i {
  color: var(--assistant-accent-ink);
}

.image-settings-button .ratio-shape {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.image-point-cost {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: var(--assistant-muted);
  font-size: 11px;
}

.image-point-cost i {
  color: var(--assistant-accent-ink);
}

.is-image-mode .voice-button {
  margin-left: 0;
}

@media (max-width: 900px) {
  .image-mode-preferences,
  .image-model-menu {
    right: 8px;
    left: 8px;
    width: auto;
  }

  .image-mode-preferences {
    overflow-y: auto;
  }

  .image-generation-stage {
    width: 100%;
  }

  .image-dream-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .image-point-cost {
    display: none;
  }
}

@media (max-width: 560px) {
  .message-date-divider {
    margin-bottom: 22px;
    font-size: 20px;
  }

  .image-generation-summary {
    flex-wrap: wrap;
  }

  .image-generation-summary strong {
    width: 100%;
    max-width: none;
  }

  .image-dream-grid.is-single {
    width: min(160px, 100%);
  }

  .image-mode-preferences {
    padding: 15px;
  }

  .custom-image-size {
    grid-template-columns: 1fr 28px 1fr;
  }

  .custom-image-size > span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .image-dream-slot::before {
    animation: none;
  }
}

/* Reference images, inline commands and asset library */
.conversation-thumb {
  overflow: hidden;
}

.conversation-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.topbar-filters > button.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.reference-file-input {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.reference-dock {
  position: absolute;
  z-index: 14;
  top: 22px;
  left: 22px;
  width: 68px;
  height: 82px;
  transition: width 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.reference-dock.has-images:hover,
.reference-dock.has-images:focus-within {
  width: min(310px, calc(100% - 44px));
}

.reference-dock .composer-attachment {
  top: 4px;
  left: 6px;
  width: 56px;
  height: 68px;
  border: 1px solid color-mix(in srgb, var(--assistant-border) 62%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--assistant-panel-hover) 92%, transparent);
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 180ms ease,
    background 180ms ease;
}

.reference-dock .composer-attachment:hover {
  border-color: var(--assistant-border-strong);
  background: var(--assistant-panel-active);
  transform: rotate(-4deg) translateY(-2px);
}

.reference-card {
  position: absolute;
  top: 4px;
  left: calc(var(--reference-index) * 5px);
  width: 54px;
  height: 68px;
  overflow: visible;
  margin: 0;
  border: 2px solid color-mix(in srgb, var(--assistant-card) 92%, var(--assistant-border));
  border-radius: 4px;
  background: var(--assistant-panel-hover);
  box-shadow: 0 5px 16px rgb(0 0 0 / 18%);
  transform: rotate(calc((var(--reference-index) - 1.5) * 4deg));
  transform-origin: 50% 85%;
  transition:
    left 260ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 180ms ease;
}

.reference-card img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  object-fit: cover;
}

.reference-card > button {
  position: absolute;
  z-index: 3;
  top: -9px;
  right: -9px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 50%;
  color: #fff;
  background: rgb(18 20 19 / 88%);
  opacity: 0;
  transform: scale(0.7);
  cursor: pointer;
  transition:
    opacity 160ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.reference-dock:hover .reference-card,
.reference-dock:focus-within .reference-card {
  left: calc(var(--reference-index) * 58px);
  box-shadow: 0 8px 22px rgb(0 0 0 / 20%);
  transform: rotate(calc((var(--reference-index) - 1.5) * 1.2deg)) translateY(-2px);
}

.reference-dock:hover .reference-card > button,
.reference-dock:focus-within .reference-card > button {
  opacity: 1;
  transform: scale(1);
}

.reference-add-more {
  position: absolute;
  z-index: 12;
  top: 42px;
  left: 39px;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--assistant-border-strong) 76%, transparent);
  border-radius: 50%;
  color: var(--assistant-text-soft);
  background: color-mix(in srgb, var(--assistant-panel-active) 92%, var(--assistant-card));
  box-shadow: 0 4px 12px rgb(0 0 0 / 14%);
  cursor: pointer;
  transition:
    top 260ms cubic-bezier(0.22, 1, 0.36, 1),
    left 260ms cubic-bezier(0.22, 1, 0.36, 1),
    width 260ms cubic-bezier(0.22, 1, 0.36, 1),
    height 260ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 260ms ease,
    transform 180ms ease;
}

.reference-dock:hover .reference-add-more,
.reference-dock:focus-within .reference-add-more {
  top: 2px;
  left: calc(var(--reference-count) * 58px);
  width: 54px;
  height: 70px;
  border-radius: 4px;
  transform: rotate(5deg);
}

.reference-add-more:hover {
  color: var(--assistant-text);
  background: var(--assistant-panel-hover);
}

.reference-count {
  position: absolute;
  top: 74px;
  left: 5px;
  color: var(--assistant-muted);
  font-size: 10px;
  opacity: 0;
  transform: translateY(3px);
  transition:
    opacity 160ms ease,
    transform 180ms ease;
}

.reference-dock:hover .reference-count,
.reference-dock:focus-within .reference-count {
  opacity: 1;
  transform: translateY(0);
}

.inline-trigger-menu {
  position: absolute;
  z-index: 32;
  width: min(340px, calc(100% - 24px));
  overflow: hidden;
  border: 1px solid var(--assistant-border);
  border-radius: 12px;
  color: var(--assistant-text);
  background: color-mix(in srgb, var(--assistant-card) 96%, transparent);
  box-shadow: 0 18px 48px rgb(0 0 0 / 20%);
  backdrop-filter: blur(18px);
  animation: inline-menu-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes inline-menu-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.inline-trigger-menu > header {
  display: flex;
  height: 40px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--assistant-border);
  color: var(--assistant-muted);
  font-size: 11px;
}

.inline-trigger-menu kbd {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid var(--assistant-border);
  border-radius: 5px;
  color: var(--assistant-text-soft);
  background: var(--assistant-panel-hover);
  font-family: inherit;
}

.inline-trigger-list {
  display: grid;
  max-height: 250px;
  gap: 2px;
  overflow-y: auto;
  padding: 6px;
}

.inline-trigger-list > button {
  display: grid;
  width: 100%;
  min-height: 52px;
  grid-template-columns: 30px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 0;
  border-radius: 8px;
  color: var(--assistant-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 140ms ease,
    transform 160ms ease;
}

.inline-trigger-list > button.active {
  background: var(--assistant-panel-active);
  transform: translateX(2px);
}

.inline-trigger-list > button > i:first-child {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  color: var(--assistant-accent-ink);
  background: var(--assistant-accent-soft);
}

.inline-trigger-list > button > i:last-child {
  color: var(--assistant-muted);
  font-size: 11px;
  opacity: 0;
}

.inline-trigger-list > button.active > i:last-child {
  opacity: 1;
}

.inline-trigger-list span,
.inline-trigger-list strong,
.inline-trigger-list small {
  display: block;
  min-width: 0;
}

.inline-trigger-list strong {
  font-size: 13px;
  font-weight: 620;
}

.inline-trigger-list small {
  overflow: hidden;
  margin-top: 2px;
  color: var(--assistant-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-trigger-empty {
  margin: 0;
  padding: 24px 14px;
  color: var(--assistant-muted);
  font-size: 12px;
  text-align: center;
}

.sent-reference-images {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.sent-reference-images button {
  width: 52px;
  height: 52px;
  overflow: hidden;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--assistant-border-strong) 75%, transparent);
  border-radius: 7px;
  background: var(--assistant-panel-hover);
  cursor: zoom-in;
}

.sent-reference-images img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 180ms ease;
}

.sent-reference-images button:hover img {
  transform: scale(1.06);
}

.asset-library-panel {
  position: absolute;
  z-index: 40;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  width: min(348px, 92vw);
  min-height: 0;
  flex-direction: column;
  padding: 18px 16px 14px;
  border-left: 1px solid var(--assistant-border);
  color: var(--assistant-text);
  background: color-mix(in srgb, var(--assistant-card) 97%, transparent);
  box-shadow: -18px 0 48px rgb(0 0 0 / 13%);
  backdrop-filter: blur(22px);
}

.asset-panel-enter-active,
.asset-panel-leave-active {
  transition:
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 200ms ease;
}

.asset-panel-enter-from,
.asset-panel-leave-to {
  opacity: 0;
  transform: translateX(32px);
}

.asset-library-header {
  display: flex;
  min-height: 38px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.asset-library-tabs {
  display: inline-flex;
  gap: 4px;
}

.asset-library-tabs button,
.asset-close,
.asset-search-row > button,
.asset-type-tabs button {
  border: 0;
  color: var(--assistant-muted);
  background: transparent;
  cursor: pointer;
}

.asset-library-tabs button {
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 12px;
}

.asset-library-tabs button.active {
  color: var(--assistant-text);
  background: var(--assistant-panel-active);
}

.asset-close,
.asset-search-row > button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border-radius: 8px;
}

.asset-close:hover,
.asset-search-row > button:hover {
  color: var(--assistant-text);
  background: var(--assistant-panel-hover);
}

.asset-search-row {
  display: flex;
  gap: 7px;
  margin-top: 12px;
}

.asset-search-row label {
  display: grid;
  height: 38px;
  min-width: 0;
  flex: 1;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  color: var(--assistant-muted);
  background: var(--assistant-panel-hover);
}

.asset-search-row input {
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--assistant-text);
  background: transparent;
  font-size: 12px;
}

.asset-search-row input::placeholder {
  color: var(--assistant-muted);
}

.asset-search-row > button {
  height: 38px;
  border: 1px solid var(--assistant-border);
}

.asset-type-tabs {
  display: flex;
  gap: 2px;
  margin: 12px 0 10px;
  border-bottom: 1px solid var(--assistant-border);
}

.asset-type-tabs button {
  position: relative;
  height: 34px;
  padding: 0 9px;
  font-size: 12px;
}

.asset-type-tabs button.active {
  color: var(--assistant-text);
}

.asset-type-tabs button.active::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  border-radius: 999px;
  background: var(--assistant-text);
  content: '';
}

.asset-image-grid {
  display: grid;
  min-height: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 5px;
  overflow-y: auto;
  padding-right: 2px;
}

.asset-image-grid > button {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--assistant-panel-hover);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 180ms ease;
}

.asset-image-grid > button:hover {
  z-index: 2;
  border-color: color-mix(in srgb, var(--assistant-accent) 64%, transparent);
  box-shadow: 0 8px 22px rgb(0 0 0 / 18%);
  transform: translateY(-2px) scale(1.02);
}

.asset-image-grid img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 220ms ease;
}

.asset-image-grid > button:hover img {
  transform: scale(1.05);
}

.asset-image-grid span {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: rgb(20 22 21 / 76%);
  opacity: 0;
  transform: translateY(4px) scale(0.82);
  transition:
    opacity 160ms ease,
    transform 180ms ease;
}

.asset-image-grid > button:hover span,
.asset-image-grid > button:focus-visible span {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.asset-empty {
  display: grid;
  flex: 1;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--assistant-muted);
  font-size: 12px;
}

.asset-empty i {
  font-size: 24px;
}

.asset-empty p {
  margin: 0;
}

.asset-library-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
  color: var(--assistant-muted);
  font-size: 11px;
}

.asset-library-footer small {
  font-size: 10px;
}

.agent-mode-button,
.composer-tool-button,
.send-button,
.topbar-filters > button {
  transition:
    color 160ms ease,
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 180ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-mode-button:hover,
.composer-tool-button:hover,
.topbar-filters > button:hover {
  transform: translateY(-1px);
}

.agent-mode-button:active,
.composer-tool-button:active,
.topbar-filters > button:active,
.send-button:active:not(:disabled) {
  transform: scale(0.96);
}

.send-button:not(:disabled):hover {
  box-shadow: 0 6px 18px rgb(0 0 0 / 22%);
  transform: translateY(-2px) scale(1.03);
}

@media (max-width: 900px) {
  .reference-dock {
    top: 15px;
    left: 10px;
    transform: scale(0.82);
    transform-origin: top left;
  }

  .inline-trigger-menu {
    max-width: calc(100% - 16px);
  }

  .asset-library-panel {
    width: min(340px, 94vw);
  }
}

@media (max-width: 560px) {
  .asset-image-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .asset-library-footer small {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reference-dock,
  .reference-card,
  .reference-add-more,
  .inline-trigger-menu,
  .asset-library-panel,
  .asset-image-grid > button,
  .agent-mode-button,
  .composer-tool-button,
  .send-button {
    transition: none;
    animation: none;
  }
}

/* Full composer: generous canvas with an independent bottom tool row. */
.composer-zone:not(.is-scrolled-away) .assistant-composer {
  min-height: 206px;
  padding: 24px 20px 16px 108px;
  border-color: color-mix(in srgb, var(--assistant-border-strong) 72%, transparent);
  border-radius: 28px;
  background: color-mix(in srgb, var(--assistant-card) 98%, var(--assistant-panel));
  box-shadow: 0 14px 38px rgb(22 24 23 / 8%);
}

.is-dark .composer-zone:not(.is-scrolled-away) .assistant-composer {
  border-color: #26292f;
  background: #1b1d21;
  box-shadow: 0 16px 42px rgb(0 0 0 / 20%);
}

.composer-zone:not(.is-scrolled-away) .assistant-composer:focus-within {
  border-color: color-mix(in srgb, var(--assistant-accent) 45%, var(--assistant-border-strong));
  box-shadow:
    0 16px 42px rgb(22 24 23 / 11%),
    0 0 0 3px color-mix(in srgb, var(--assistant-accent) 8%, transparent);
}

.composer-zone:not(.is-scrolled-away) .assistant-composer.is-image-mode {
  border-color: color-mix(in srgb, #b6523f 45%, var(--assistant-border));
}

.composer-zone:not(.is-scrolled-away) .assistant-composer textarea {
  min-height: 112px;
  max-height: 132px;
  padding: 4px 12px 12px 0;
  font-size: 15px;
}

.composer-zone:not(.is-scrolled-away) .assistant-composer textarea::placeholder {
  color: color-mix(in srgb, var(--assistant-muted) 82%, transparent);
}

.composer-zone:not(.is-scrolled-away) .composer-toolbar {
  min-height: 42px;
  margin-left: -72px;
}

.composer-zone:not(.is-scrolled-away) .composer-left {
  gap: 8px;
}

.composer-zone:not(.is-scrolled-away) .agent-mode-button,
.composer-zone:not(.is-scrolled-away) .composer-tool-button {
  height: 36px;
  padding-inline: 13px;
  border-radius: 10px;
}

.composer-zone:not(.is-scrolled-away) .composer-tool-button.is-mention {
  width: 38px;
  padding: 0;
}

.composer-zone:not(.is-scrolled-away) .send-button {
  width: 44px;
  height: 44px;
  flex-basis: 44px;
}

.is-dark .composer-zone:not(.is-scrolled-away) .agent-mode-button,
.is-dark .composer-zone:not(.is-scrolled-away) .composer-tool-button {
  border-color: #2c3037;
  background: #1b1d21;
}

.is-dark .composer-zone:not(.is-scrolled-away) .reference-dock .composer-attachment {
  border-color: #30343b;
  background: #292c32;
}

/* Scroll-aware composer: keep the conversation readable while browsing history. */
.return-to-bottom-row {
  display: flex;
  width: min(1120px, 100%);
  justify-content: flex-end;
  margin: 0 auto 10px;
  pointer-events: none;
}

.return-to-bottom {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 7px;
  padding: 0 17px;
  border: 1px solid color-mix(in srgb, var(--assistant-border) 74%, transparent);
  border-radius: 999px;
  color: var(--assistant-text-soft);
  background: color-mix(in srgb, var(--assistant-card) 94%, transparent);
  box-shadow: 0 8px 24px rgb(22 24 23 / 8%);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  backdrop-filter: blur(16px);
  transition:
    color 160ms ease,
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 180ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.return-to-bottom:hover {
  color: var(--assistant-text);
  border-color: var(--assistant-border-strong);
  background: var(--assistant-card);
  box-shadow: 0 10px 28px rgb(22 24 23 / 13%);
  transform: translateY(-2px);
}

.return-to-bottom:active {
  transform: scale(0.97);
}

.return-to-bottom i {
  font-size: 13px;
}

.return-bottom-enter-active,
.return-bottom-leave-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.return-bottom-enter-from,
.return-bottom-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.assistant-composer {
  transition:
    min-height 260ms cubic-bezier(0.22, 1, 0.36, 1),
    padding 260ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 260ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 160ms ease,
    box-shadow 180ms ease;
}

.assistant-composer textarea {
  transition:
    min-height 260ms cubic-bezier(0.22, 1, 0.36, 1),
    height 260ms cubic-bezier(0.22, 1, 0.36, 1),
    max-height 260ms cubic-bezier(0.22, 1, 0.36, 1),
    padding 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.reference-dock {
  transition:
    width 260ms cubic-bezier(0.22, 1, 0.36, 1),
    top 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.composer-zone.is-scrolled-away .assistant-composer {
  min-height: 116px;
  padding: 18px 76px 16px 104px;
  border-radius: 22px;
}

.composer-zone.is-scrolled-away .assistant-composer textarea {
  height: 78px !important;
  min-height: 78px;
  max-height: 78px;
  overflow-y: auto;
  padding: 10px 8px 8px 0;
}

.composer-zone.is-scrolled-away .composer-toolbar {
  position: absolute;
  top: 50%;
  right: 18px;
  min-height: 42px;
  transform: translateY(-50%);
}

.composer-zone.is-scrolled-away .composer-left,
.composer-zone.is-scrolled-away .image-point-cost {
  display: none;
}

.composer-zone.is-scrolled-away .reference-dock {
  top: 17px;
}

.composer-zone.is-scrolled-away .draft-counter {
  top: 9px;
  right: 76px;
}

@media (max-width: 900px) {
  .composer-zone:not(.is-scrolled-away) .assistant-composer {
    min-height: 154px;
    padding: 16px 12px 10px 66px;
    border-radius: 20px;
  }

  .composer-zone:not(.is-scrolled-away) .assistant-composer textarea {
    min-height: 78px;
    max-height: 86px;
    padding: 3px 8px 8px 0;
    font-size: 13px;
  }

  .composer-zone:not(.is-scrolled-away) .composer-toolbar {
    min-height: 38px;
    margin-left: -50px;
  }

  .composer-zone:not(.is-scrolled-away) .agent-mode-button,
  .composer-zone:not(.is-scrolled-away) .composer-tool-button {
    height: 34px;
    padding-inline: 10px;
    border-radius: 8px;
  }

  .composer-zone:not(.is-scrolled-away) .send-button {
    width: 42px;
    height: 42px;
    flex-basis: 42px;
  }

  .return-to-bottom-row {
    margin-bottom: 8px;
  }

  .return-to-bottom {
    min-height: 38px;
    padding-inline: 14px;
    font-size: 12px;
  }

  .composer-zone.is-scrolled-away .assistant-composer {
    min-height: 94px;
    padding: 12px 60px 12px 66px;
  }

  .composer-zone.is-scrolled-away .assistant-composer textarea {
    height: 68px !important;
    min-height: 68px;
    max-height: 68px;
    padding-top: 9px;
  }

  .composer-zone.is-scrolled-away .composer-toolbar {
    right: 10px;
  }

  .composer-zone.is-scrolled-away .reference-dock {
    top: 12px;
  }

  .composer-zone.is-scrolled-away .draft-counter {
    right: 60px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .return-to-bottom,
  .return-bottom-enter-active,
  .return-bottom-leave-active,
  .assistant-composer,
  .assistant-composer textarea,
  .reference-dock,
  .composer-toolbar {
    transition: none;
  }
}

/* Single-layer glass sidebar. Child controls stay blur-free to limit GPU compositing. */
.assistant-sidebar {
  position: relative;
  isolation: isolate;
  border-right-color: color-mix(in srgb, var(--assistant-border-strong) 28%, transparent);
  background: color-mix(in srgb, var(--assistant-card) 66%, transparent);
  box-shadow: 10px 0 24px rgb(34 45 47 / 2.5%);
  backdrop-filter: blur(14px) saturate(1.14);
  -webkit-backdrop-filter: blur(14px) saturate(1.14);
  contain: paint;
}

.is-dark .assistant-sidebar {
  border-right-color: rgb(255 255 255 / 4%);
  background: rgb(13 16 17 / 66%);
  box-shadow: none;
}

.assistant-sidebar .new-chat-button {
  border-color: color-mix(in srgb, var(--assistant-border-strong) 56%, transparent);
  background: color-mix(in srgb, var(--assistant-card) 46%, transparent);
  box-shadow: inset 0 1px rgb(255 255 255 / 28%);
}

.is-dark .assistant-sidebar .new-chat-button {
  border-color: rgb(255 255 255 / 9%);
  background: rgb(255 255 255 / 4.5%);
  box-shadow: inset 0 1px rgb(255 255 255 / 5%);
}

.assistant-sidebar .new-chat-button:hover {
  border-color: color-mix(in srgb, var(--assistant-accent) 26%, var(--assistant-border));
  background: color-mix(in srgb, var(--assistant-card) 70%, transparent);
}

.is-dark .assistant-sidebar .new-chat-button:hover {
  background: rgb(255 255 255 / 7%);
}

.assistant-sidebar .conversation-row:hover {
  background: color-mix(in srgb, var(--assistant-card) 48%, transparent);
}

.assistant-sidebar .conversation-row.active {
  border: 1px solid color-mix(in srgb, var(--assistant-accent) 18%, transparent);
  background: color-mix(in srgb, var(--assistant-accent-soft) 58%, transparent);
  box-shadow: inset 0 1px rgb(255 255 255 / 22%);
}

.is-dark .assistant-sidebar .conversation-row:hover {
  background: rgb(255 255 255 / 5%);
}

.is-dark .assistant-sidebar .conversation-row.active {
  border-color: rgb(93 211 226 / 13%);
  background: rgb(69 159 170 / 11%);
  box-shadow: inset 0 1px rgb(255 255 255 / 4%);
}

.assistant-sidebar .conversation-thumb {
  border-color: color-mix(in srgb, var(--assistant-border-strong) 48%, transparent);
  background: color-mix(in srgb, var(--assistant-card) 58%, transparent);
}

.is-dark .assistant-sidebar .conversation-thumb {
  border-color: rgb(255 255 255 / 8%);
  background: rgb(255 255 255 / 5%);
}

:global(html.settings-no-blur) .assistant-sidebar {
  background: color-mix(in srgb, var(--assistant-panel) 96%, var(--assistant-bg));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

@supports not (backdrop-filter: blur(1px)) {
  .assistant-sidebar {
    background: color-mix(in srgb, var(--assistant-panel) 94%, var(--assistant-bg));
    -webkit-backdrop-filter: none;
  }
}

@media (max-width: 900px) {
  .assistant-sidebar {
    background: color-mix(in srgb, var(--assistant-card) 78%, transparent);
    backdrop-filter: blur(10px) saturate(1.08);
    -webkit-backdrop-filter: blur(10px) saturate(1.08);
  }

  .is-dark .assistant-sidebar {
    background: rgb(13 16 17 / 78%);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .assistant-sidebar,
  .is-dark .assistant-sidebar {
    background: var(--assistant-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* Compact long conversations without altering spacing inside fenced code blocks. */
.message-thread {
  padding-top: 24px;
}

.message {
  margin-bottom: 22px;
}

.message-date-divider {
  margin: 8px 0 20px;
}

.message--assistant .message-content {
  padding-top: 8px;
}

.message-content p {
  line-height: 1.62;
}

.message-meta {
  margin-top: 9px;
}

.message-actions {
  padding-top: 8px;
}

@media (max-width: 900px) {
  .message-thread {
    padding-top: 18px;
  }

  .message {
    margin-bottom: 18px;
  }
}

/* Conversation navigator: exactly one marker for each user prompt. */
.conversation-minimap {
  position: absolute;
  z-index: 8;
  top: 50%;
  bottom: auto;
  left: 12px;
  display: flex;
  width: 28px;
  min-height: 160px;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1px;
  padding: 3px 0;
  transform: translateY(-50%);
  pointer-events: none;
}

.conversation-minimap > button {
  position: relative;
  z-index: 1;
  display: flex;
  width: 28px;
  min-height: 8px;
  flex: 0 0 8px;
  align-items: center;
  padding: 0;
  border: 0;
  color: var(--assistant-muted);
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}

.conversation-minimap > button > i {
  display: block;
  width: 8px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transition:
    width 180ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms ease,
    opacity 160ms ease;
}

.conversation-minimap > button:hover,
.conversation-minimap > button:focus-visible,
.conversation-minimap > button.active {
  color: var(--assistant-text-soft);
}

.conversation-minimap > button:hover > i,
.conversation-minimap > button:focus-visible > i,
.conversation-minimap > button.active > i {
  width: 24px;
}

.conversation-minimap > button.active > i {
  color: var(--assistant-accent);
}

.conversation-minimap-preview {
  position: absolute;
  top: 50%;
  left: 34px;
  display: grid;
  width: 238px;
  gap: 5px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--assistant-border-strong) 72%, transparent);
  border-radius: 8px;
  color: var(--assistant-text);
  background: color-mix(in srgb, var(--assistant-card) 94%, transparent);
  box-shadow: 0 12px 30px rgb(0 0 0 / 14%);
  opacity: 0;
  visibility: hidden;
  transform: translate3d(-4px, -50%, 0);
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 140ms ease;
  pointer-events: none;
}

.conversation-minimap > button:hover .conversation-minimap-preview,
.conversation-minimap > button:focus-visible .conversation-minimap-preview {
  opacity: 1;
  visibility: visible;
  transform: translate3d(0, -50%, 0);
}

.conversation-minimap-preview small,
.conversation-minimap-preview strong,
.conversation-minimap-preview em {
  display: block;
  min-width: 0;
}

.conversation-minimap-preview small {
  color: var(--assistant-muted);
  font-size: 10px;
  font-weight: 500;
}

.conversation-minimap-preview strong {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  font-weight: 620;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.conversation-minimap-preview em {
  color: var(--assistant-muted);
  font-size: 10px;
  font-style: normal;
}

.conversation-minimap-preview em i {
  margin-right: 4px;
}

.copy-message-button.is-copied {
  color: var(--assistant-success);
  border-color: color-mix(in srgb, var(--assistant-success) 24%, transparent);
  background: color-mix(in srgb, var(--assistant-success) 9%, transparent);
}

/* Send and stop share one stable hit target, so state changes never shift the toolbar. */
.send-button {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--assistant-text) 82%, transparent);
  box-shadow: 0 5px 14px rgb(0 0 0 / 14%);
}

.send-button::before {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid currentColor;
  border-radius: 50%;
  opacity: 0;
  transform: scale(0.7);
  transition:
    opacity 160ms ease,
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.send-button:not(:disabled):hover::before {
  opacity: 0.16;
  transform: scale(1);
}

.send-glyph {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.send-glyph i {
  font-size: 19px;
  line-height: 1;
}

.send-button:not(:disabled):hover .send-glyph {
  transform: translateY(-2px);
}

.stop-button,
.is-dark .stop-button {
  color: var(--assistant-card);
  background: var(--assistant-text);
}

.stop-glyph {
  position: relative;
  z-index: 1;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  background: currentColor;
  transition:
    border-radius 160ms ease,
    transform 160ms ease;
}

.stop-button:not(:disabled):hover .stop-glyph {
  border-radius: 2px;
  transform: scale(0.88);
}

.stop-button:disabled {
  color: var(--assistant-card);
  background: var(--assistant-text);
  opacity: 0.62;
}

.stop-button.is-stopping .stop-glyph {
  border-radius: 50%;
  transform: scale(0.72);
}

@media (max-width: 1180px) {
  .conversation-minimap {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .conversation-minimap > button > i,
  .conversation-minimap-preview,
  .send-button::before,
  .send-glyph,
  .stop-glyph {
    transition: none;
  }
}

/* Live task status: reflects the real request stage and expands while work is running. */
.assistant-message-label {
  display: block;
  color: var(--assistant-text-soft);
}

.message-status-toggle {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 7px;
  padding: 2px 4px 2px 0;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.message-status-toggle:hover {
  color: var(--assistant-text);
}

.message-status-toggle strong {
  min-width: 0;
  font-size: 13px;
  font-weight: 620;
  letter-spacing: 0;
}

.message-status-indicator {
  position: relative;
  display: grid;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  place-items: center;
  border: 1px solid color-mix(in srgb, currentColor 38%, transparent);
  border-radius: 50%;
}

.assistant-message-label span.message-status-indicator {
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  border-radius: 50%;
  color: inherit;
  background: transparent;
}

.assistant-message-label .message-status-toggle strong > span {
  display: inline;
  width: auto;
  height: auto;
  border-radius: 0;
  color: inherit;
  background: transparent;
}

.message-status-indicator i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.assistant-message-label.is-working {
  color: var(--assistant-accent-ink);
}

.assistant-message-label.is-working .message-status-indicator::after {
  content: '';
  position: absolute;
  inset: -4px;
  border: 1px solid currentColor;
  border-radius: 50%;
  opacity: 0;
  animation: message-status-pulse 1.6s ease-out infinite;
}

.assistant-message-label.is-complete .message-status-indicator {
  color: var(--assistant-success);
}

.assistant-message-label.is-error {
  color: var(--assistant-danger);
}

.assistant-message-label.is-muted {
  color: var(--assistant-muted);
}

.message-status-chevron {
  color: var(--assistant-muted);
  font-size: 10px;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.message-status-chevron.is-expanded {
  transform: rotate(90deg);
}

.message-status-detail {
  width: min(420px, 100%);
  padding: 1px 0 7px 21px;
  color: var(--assistant-muted);
}

.message-status-detail p {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
}

.message-status-progress {
  width: min(280px, 74vw);
  height: 2px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--assistant-border-strong) 55%, transparent);
}

.message-status-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--assistant-accent);
  transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.status-swap-enter-active,
.status-swap-leave-active,
.status-detail-enter-active,
.status-detail-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.status-swap-enter-from,
.status-swap-leave-to {
  opacity: 0;
  transform: translateY(3px);
}

.status-detail-enter-from,
.status-detail-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes message-status-pulse {
  0% {
    opacity: 0.48;
    transform: scale(0.72);
  }
  75%,
  100% {
    opacity: 0;
    transform: scale(1.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-message-label.is-working .message-status-indicator::after {
    animation: none;
  }

  .message-status-chevron,
  .message-status-progress i,
  .status-swap-enter-active,
  .status-swap-leave-active,
  .status-detail-enter-active,
  .status-detail-leave-active {
    transition: none;
  }
}

.load-earlier-messages {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0 auto 18px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--assistant-border) 72%, transparent);
  border-radius: 8px;
  color: var(--assistant-muted);
  background: color-mix(in srgb, var(--assistant-card) 72%, transparent);
  font-size: 11px;
  cursor: pointer;
}

.load-earlier-messages:hover:not(:disabled) {
  color: var(--assistant-text);
  border-color: var(--assistant-border-strong);
  background: var(--assistant-panel-hover);
}

.load-earlier-messages:disabled {
  cursor: wait;
  opacity: 0.62;
}

:global(html.assistant-image-viewer-open),
:global(html.assistant-image-viewer-open body) {
  overflow: hidden;
}

.image-viewer-fade-enter-active,
.image-viewer-fade-leave-active {
  transition: opacity 200ms ease;
}

.image-viewer-fade-enter-from,
.image-viewer-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .image-viewer-fade-enter-active,
  .image-viewer-fade-leave-active,
  .image-viewer__image-layer {
    transition: none;
  }
}

.message--user {
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.message--user .message-content,
.message--user .user-message-editor {
  order: 1;
}

.user-message-actions {
  order: 2;
  display: inline-flex;
  flex: 0 0 auto;
  align-self: flex-end;
  gap: 2px;
  margin-right: 3px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.message--user:hover .user-message-actions,
.message--user:focus-within .user-message-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.user-message-actions button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--assistant-muted);
  background: transparent;
  cursor: pointer;
}

.user-message-actions button:hover:not(:disabled) {
  color: var(--assistant-text);
  background: var(--assistant-panel-hover);
}

.user-message-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.user-message-actions button.is-copied {
  color: var(--assistant-success);
}

.user-message-editor {
  width: min(72%, 620px);
  margin-left: auto;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--assistant-accent) 32%, var(--assistant-border));
  border-radius: 16px;
  background: var(--assistant-panel-active);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--assistant-accent) 7%, transparent);
}

.user-message-editor textarea {
  display: block;
  width: 100%;
  min-height: 86px;
  max-height: 260px;
  padding: 2px 3px 8px;
  resize: vertical;
  border: 0;
  outline: 0;
  color: var(--assistant-text);
  background: transparent;
  font-size: 14px;
  line-height: 1.6;
}

.user-message-editor footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding-top: 8px;
}

.user-message-editor footer > span {
  margin-right: auto;
  color: var(--assistant-muted);
  font-size: 10px;
}

.user-message-editor footer button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
  border: 1px solid var(--assistant-border);
  border-radius: 8px;
  color: var(--assistant-text-soft);
  background: var(--assistant-card);
  font-size: 12px;
  cursor: pointer;
}

.user-message-editor footer button:hover:not(:disabled) {
  border-color: var(--assistant-border-strong);
  color: var(--assistant-text);
}

.user-message-editor footer button.is-primary {
  border-color: var(--assistant-text);
  color: var(--assistant-card);
  background: var(--assistant-text);
}

.user-message-editor footer button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (max-width: 760px) {
  .user-message-editor {
    width: min(90%, 620px);
  }
}

@media (hover: none) {
  .user-message-actions {
    opacity: 0.72;
    pointer-events: auto;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .user-message-actions {
    transition: none;
  }
}

/* Composer surface: restrained depth, clear hierarchy and stable controls. */
.assistant-composer {
  --composer-focus-color: var(--assistant-accent);
  border-color: color-mix(in srgb, var(--assistant-border-strong) 72%, transparent);
  background: color-mix(in srgb, var(--assistant-card) 94%, var(--assistant-panel));
  box-shadow:
    0 1px 2px rgb(23 27 25 / 5%),
    0 14px 38px rgb(23 27 25 / 9%),
    inset 0 1px rgb(255 255 255 / 76%),
    inset 0 -1px color-mix(in srgb, var(--assistant-border) 58%, transparent);
}

.assistant-composer::after {
  position: absolute;
  right: 22px;
  bottom: -1px;
  left: 22px;
  height: 2px;
  border-radius: 999px;
  background: var(--composer-focus-color);
  content: '';
  opacity: 0;
  pointer-events: none;
  transform: scaleX(0.72);
  transition:
    opacity 170ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.assistant-composer:focus-within::after {
  opacity: 0.72;
  transform: scaleX(1);
}

.assistant-composer.is-image-mode {
  --composer-focus-color: #b6523f;
}

.is-dark .assistant-composer {
  border-color: rgb(255 255 255 / 10%);
  background: color-mix(in srgb, var(--assistant-card) 92%, #121411);
  box-shadow:
    0 1px 0 rgb(255 255 255 / 3%),
    0 18px 44px rgb(0 0 0 / 28%),
    inset 0 1px rgb(255 255 255 / 5%),
    inset 0 -1px rgb(0 0 0 / 28%);
}

.composer-zone:not(.is-scrolled-away) .assistant-composer {
  min-height: 176px;
  padding: 18px 16px 12px 88px;
  border-radius: 24px;
}

.composer-zone:not(.is-scrolled-away) .assistant-composer:focus-within {
  border-color: color-mix(
    in srgb,
    var(--composer-focus-color) 42%,
    var(--assistant-border-strong)
  );
  background: var(--assistant-card);
  box-shadow:
    0 2px 5px rgb(23 27 25 / 6%),
    0 20px 48px rgb(23 27 25 / 12%),
    0 0 0 3px color-mix(in srgb, var(--composer-focus-color) 8%, transparent),
    inset 0 1px rgb(255 255 255 / 82%);
}

.is-dark .composer-zone:not(.is-scrolled-away) .assistant-composer:focus-within {
  background: color-mix(in srgb, var(--assistant-card) 97%, #161815);
  box-shadow:
    0 22px 52px rgb(0 0 0 / 34%),
    0 0 0 3px color-mix(in srgb, var(--composer-focus-color) 10%, transparent),
    inset 0 1px rgb(255 255 255 / 7%);
}

.composer-zone:not(.is-scrolled-away) .assistant-composer textarea {
  min-height: 88px;
  max-height: 116px;
  padding: 6px 10px 12px 2px;
  color: var(--assistant-text);
  caret-color: var(--composer-focus-color);
  font-size: 15px;
  line-height: 1.6;
}

.composer-zone:not(.is-scrolled-away) .assistant-composer textarea::placeholder {
  color: color-mix(in srgb, var(--assistant-muted) 76%, transparent);
}

.composer-zone:not(.is-scrolled-away) .composer-toolbar {
  min-height: 42px;
  margin-left: -60px;
  padding-top: 9px;
  border-top: 1px solid color-mix(in srgb, var(--assistant-border) 66%, transparent);
}

.composer-zone:not(.is-scrolled-away) .composer-left {
  gap: 6px;
}

.composer-zone:not(.is-scrolled-away) .agent-mode-button,
.composer-zone:not(.is-scrolled-away) .composer-tool-button {
  height: 34px;
  padding-inline: 11px;
  border-color: transparent;
  border-radius: 9px;
  background: color-mix(in srgb, var(--assistant-panel-hover) 64%, transparent);
  box-shadow: inset 0 1px color-mix(in srgb, var(--assistant-card) 76%, transparent);
}

.composer-zone:not(.is-scrolled-away) .agent-mode-button:hover,
.composer-zone:not(.is-scrolled-away) .composer-tool-button:hover {
  border-color: color-mix(in srgb, var(--assistant-border-strong) 72%, transparent);
  background: var(--assistant-card);
  box-shadow:
    0 4px 12px rgb(23 27 25 / 8%),
    inset 0 1px rgb(255 255 255 / 66%);
}

.composer-zone:not(.is-scrolled-away) .agent-mode-button.active,
.composer-zone:not(.is-scrolled-away) .composer-tool-button.active {
  border-color: color-mix(in srgb, var(--composer-focus-color) 28%, transparent);
  color: var(--assistant-accent-ink);
  background: color-mix(in srgb, var(--assistant-accent-soft) 78%, var(--assistant-card));
  box-shadow: inset 0 1px color-mix(in srgb, var(--assistant-card) 72%, transparent);
}

.is-dark .composer-zone:not(.is-scrolled-away) .agent-mode-button,
.is-dark .composer-zone:not(.is-scrolled-away) .composer-tool-button {
  border-color: transparent;
  background: rgb(255 255 255 / 5%);
  box-shadow: inset 0 1px rgb(255 255 255 / 3%);
}

.is-dark .composer-zone:not(.is-scrolled-away) .agent-mode-button:hover,
.is-dark .composer-zone:not(.is-scrolled-away) .composer-tool-button:hover {
  border-color: rgb(255 255 255 / 10%);
  background: rgb(255 255 255 / 8%);
  box-shadow: 0 5px 14px rgb(0 0 0 / 18%);
}

.composer-zone:not(.is-scrolled-away) .composer-tool-button.is-mention {
  width: 34px;
  padding: 0;
}

.reference-dock {
  top: 16px;
  left: 15px;
  height: 72px;
}

.reference-dock .composer-attachment {
  top: 4px;
  left: 4px;
  width: 56px;
  height: 60px;
  border-color: color-mix(in srgb, var(--assistant-border-strong) 58%, transparent);
  border-radius: 13px;
  color: var(--assistant-accent-ink);
  background: color-mix(in srgb, var(--assistant-accent-soft) 54%, var(--assistant-card));
  box-shadow:
    0 4px 12px rgb(23 27 25 / 7%),
    inset 0 1px color-mix(in srgb, var(--assistant-card) 82%, transparent);
  transform: none;
}

.reference-dock .composer-attachment:hover {
  border-color: color-mix(in srgb, var(--assistant-accent) 34%, var(--assistant-border-strong));
  background: color-mix(in srgb, var(--assistant-accent-soft) 78%, var(--assistant-card));
  box-shadow:
    0 7px 18px rgb(23 27 25 / 10%),
    inset 0 1px color-mix(in srgb, var(--assistant-card) 86%, transparent);
  transform: translateY(-2px);
}

.composer-zone:not(.is-scrolled-away) .send-button {
  width: 42px;
  height: 42px;
  flex-basis: 42px;
  border-color: color-mix(in srgb, var(--assistant-text) 76%, transparent);
  box-shadow:
    0 7px 18px rgb(15 17 16 / 18%),
    inset 0 1px rgb(255 255 255 / 14%);
}

.composer-zone:not(.is-scrolled-away) .send-button:disabled {
  border-color: transparent;
  box-shadow: inset 0 1px rgb(255 255 255 / 22%);
}

@media (max-width: 900px) {
  .composer-zone:not(.is-scrolled-away) .assistant-composer {
    min-height: 148px;
    padding: 15px 11px 10px 66px;
    border-radius: 20px;
  }

  .composer-zone:not(.is-scrolled-away) .assistant-composer textarea {
    min-height: 74px;
    max-height: 82px;
    padding: 4px 7px 9px 0;
    font-size: 13px;
  }

  .composer-zone:not(.is-scrolled-away) .composer-toolbar {
    min-height: 38px;
    margin-left: -50px;
    padding-top: 7px;
  }

  .reference-dock {
    top: 12px;
    left: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-composer::after {
    transition: none;
  }
}
</style>
