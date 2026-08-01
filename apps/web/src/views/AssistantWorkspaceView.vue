<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { useRouter } from 'vue-router'
import {
  cancelAssistantRun,
  createAssistantConversation,
  createAssistantRun,
  getAssistantRun,
  deleteAssistantConversation,
  deleteAssistantMessage,
  fetchAssistantConfig,
  importAssistantConversations,
  listActiveAssistantRuns,
  listAssistantConversations,
  openAssistantRunStream,
  waitForAssistantRun,
} from '@/services/assistantApi'
import {
  clearAssistantHistory,
  loadAssistantHistory,
  loadAssistantWorkspaceState,
  saveAssistantWorkspaceState,
} from '@/services/assistantHistory'
import notificationService from '@/services/notification'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import AssistantMarkdown from '@/components/assistant/AssistantMarkdown.vue'
import AssistantImageViewer from '@/features/assistant/components/AssistantImageViewer.vue'
import ModelPointPrice from '@/features/ai-shared/ModelPointPrice.vue'
import { useAssistantAttachments } from '@/features/assistant/composables/useAssistantAttachments'
import { useAssistantTextStream } from '@/features/assistant/composables/useAssistantTextStream'
import {
  IMAGE_COUNTS,
  conversationTitle,
  createAssistantPlaceholder,
  formatMessageDate,
  formatTime,
  imageCountFromPrompt,
  messageDateKey,
  messagePreview,
  messageStatus,
  uid,
} from '@/features/assistant/domain/assistantMessages'
import { resolveVisualContext } from '@/features/assistant/domain/visualContext'
import {
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from '@/features/ai-shared/modelImageCapabilities'
import '@/features/assistant/styles/assistant-workspace.css'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const conversations = ref([])
const activeId = ref('')
const activeRunIds = ref({})
const draft = ref('')
const mode = ref('chat')
const imageSize = ref('1024x1024')
const imageQuality = ref('high')
const serviceError = ref('')
const serviceLoading = ref(true)
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const pendingDeleteId = ref('')
const selectedImage = ref(null)
const messageScroller = ref(null)
const sidebarRef = ref(null)
const mainRef = ref(null)
const visibleMessageLimit = ref(24)
const isLoadingEarlierMessages = ref(false)
const promptInput = ref(null)
const composerRoot = ref(null)
const isAtConversationBottom = ref(true)
const isReturningToBottom = ref(false)
const stoppingConversationIds = ref(new Set())
const copiedMessageId = ref('')
const settledImageMessageId = ref('')
let settledImageTimer = 0
const activeNavigatorMessageId = ref('')
const isNavigatingByMarker = ref(false)
const expandedStatusMessageId = ref('')
const editingMessageId = ref('')
const editingMessageDraft = ref('')
const editMessageInput = ref(null)
const hydrated = ref(false)
const historySyncing = ref(false)
const conversationSearch = ref('')
const creationMenuOpen = ref(false)
const preferencesOpen = ref(false)
const skillMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const qualityMenuOpen = ref(false)
const activeMessageMenuId = ref('')
const quotedMessage = ref(null)
const generationRatio = ref('auto')
const generationModel = ref('')
const conversationModel = ref('')
const imageGenerationModel = ref('')
const conversationModels = ref([])
const imageGenerationModels = ref([])
const modelSearch = ref('')
const generationResolution = ref('1K')
const generationCount = ref(2)
const customImageWidth = ref(1024)
const customImageHeight = ref(1024)
const selectedSkill = ref(null)
const creationType = ref('agent')
const skillSearch = ref('')
const assetLibraryOpen = ref(false)
const assetSearch = ref('')
const assetTab = ref('all')
const referenceDockExpanded = ref(false)
const inlineMenuType = ref('')
const inlineMenuQuery = ref('')
const inlineMenuPosition = ref({ left: 116, top: 56 })
const inlineMenuIndex = ref(0)
const activeTriggerRange = ref(null)
const runControllers = new Map()
const progressTimers = new Map()
let returnToBottomTimer = null
let copiedMessageTimer = null
let navigatorFrame = null
let markerNavigationToken = 0

const MESSAGE_BATCH_SIZE = 24
const composerExtensionsEnabled = false
const { createTextStreamRenderer } = useAssistantTextStream()

const {
  referenceImages,
  isUploadingReferences,
  uploadingReferenceCount,
  referenceInput,
  isDraggingAttachment,
  openReferencePicker,
  ensureReferenceUploaded,
  handleReferenceFiles,
  handleComposerPaste: handleAttachmentPaste,
  removeReferenceImage,
  addAssetReference,
  handleAttachmentDragEnter,
  handleAttachmentDragOver,
  handleAttachmentDragLeave,
  handleAttachmentDrop,
} = useAssistantAttachments()

const creationTypes = [
  { id: 'agent', label: 'Agent 模式', icon: 'bi-magic' },
  { id: 'image', label: '图片生成', icon: 'bi-image' },
]
const GENERATION_RATIOS = [
  { id: 'auto', label: '自动', shape: 'auto' },
  { id: '1:1', label: '1:1', shape: 'square' },
  { id: '2:3', label: '2:3', shape: 'portrait' },
  { id: '3:2', label: '3:2', shape: 'wide' },
  { id: '3:4', label: '3:4', shape: 'portrait' },
  { id: '4:3', label: '4:3', shape: 'wide' },
  { id: '4:5', label: '4:5', shape: 'portrait' },
  { id: '5:4', label: '5:4', shape: 'wide' },
  { id: '9:16', label: '9:16', shape: 'portrait' },
  { id: '16:9', label: '16:9', shape: 'wide' },
  { id: '9:21', label: '9:21', shape: 'portrait' },
  { id: '21:9', label: '21:9', shape: 'wide' },
]
const generationModels = computed(() =>
  mode.value === 'image' ? imageGenerationModels.value : conversationModels.value,
)
const filteredGenerationModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase()
  return generationModels.value
    .filter((item) => {
      if (!query) return true
      return [item.label, item.model, item.description].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(query),
      )
    })
    .sort(
      (left, right) =>
        Number(right.model === generationModel.value) -
        Number(left.model === generationModel.value),
    )
})
const selectedGenerationModel = computed(
  () =>
    generationModels.value.find((item) => item.model === generationModel.value) ||
    generationModels.value[0] ||
    null,
)
const generationModelLabel = computed(
  () => selectedGenerationModel.value?.label || generationModel.value || '默认模型',
)
const IMAGE_RESOLUTION_OPTIONS = [
  { id: '1K', label: '标清 1K', quality: 'low', longEdge: 1024 },
  { id: '2K', label: '高清 2K', quality: 'medium', longEdge: 2048 },
  { id: '4K', label: '超清 4K', quality: 'high', longEdge: 4096 },
]
const selectedImageGenerationModel = computed(
  () =>
    imageGenerationModels.value.find((item) => item.model === imageGenerationModel.value) ||
    imageGenerationModels.value[0] ||
    null,
)
const generationRatios = computed(() => {
  const supported = getModelAspectRatiosForResolution(
    selectedImageGenerationModel.value,
    generationResolution.value,
  )
  return GENERATION_RATIOS.filter((item) => supported.includes(item.id))
})
const imageResolutions = computed(() => {
  const supported = Array.isArray(selectedImageGenerationModel.value?.resolutions)
    ? selectedImageGenerationModel.value.resolutions.map((item) => String(item || '').toUpperCase())
    : []
  const qualitySet = new Set(selectedImageGenerationModel.value?.qualities || [])
  return IMAGE_RESOLUTION_OPTIONS.filter(
    (option) =>
      (!supported.length || supported.includes(option.id)) && qualitySet.has(option.quality),
  )
})
const imageCounts = IMAGE_COUNTS
const skills = [
  { name: '剧情短片', description: '帮你自动生成故事大纲、分镜脚本并产出短片' },
  { name: '电商套图', description: '生成风格统一的商品全套视觉素材，适用于各大电商平台' },
  { name: '海报设计', description: '生成更有创意的海报内容，擅长营销场景和节日热点' },
  { name: '品牌设计', description: '根据公司名称、业务与客群，生成品牌 Logo 与视觉方案' },
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
// ChatGPT 逻辑：没有任何问答的会话不进侧栏列表（活跃中的空会话也是草稿,不列出）
const listableConversations = computed(() =>
  conversations.value.filter((conversation) => (conversation.messages?.length || 0) > 0),
)
const visibleConversations = computed(() => {
  const query = conversationSearch.value.trim().toLowerCase()
  if (!query) return listableConversations.value
  return listableConversations.value.filter((conversation) =>
    `${conversation.title || ''} ${conversation.messages?.map((message) => message.content).join(' ') || ''}`
      .toLowerCase()
      .includes(query),
  )
})
const pendingDeleteConversation = computed(() =>
  conversations.value.find((conversation) => conversation.id === pendingDeleteId.value),
)
const activeRunId = computed(() => activeRunIds.value[activeId.value] || '')
const activeRunCount = computed(() => Object.keys(activeRunIds.value).length)
const isGenerating = computed(() => Boolean(activeRunId.value))
const isStopping = computed(() => stoppingConversationIds.value.has(activeId.value))
const pendingDeleteHasActiveRun = computed(() => {
  const conversation = pendingDeleteConversation.value
  if (!conversation) return false
  return (
    Boolean(activeRunIds.value[conversation.id]) ||
    conversation.messages?.some((message) => message.role === 'assistant' && message.pending)
  )
})
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
    !isUploadingReferences.value &&
    !serviceError.value &&
    !serviceLoading.value,
)
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
    : '输入问题或上传图片进行识别、分析与编辑',
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
    `${generationRatio.value === 'auto' ? 'Auto' : generationRatio.value} | ${generationResolution.value} | ${generationCount.value}`,
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
  const assets = generated.filter((asset) => {
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
function setConversationRun(conversationId, runId) {
  activeRunIds.value = { ...activeRunIds.value, [conversationId]: runId }
}

function clearConversationRun(conversationId) {
  if (!activeRunIds.value[conversationId]) return
  const next = { ...activeRunIds.value }
  delete next[conversationId]
  activeRunIds.value = next
}

function setConversationStopping(conversationId, stopping) {
  const next = new Set(stoppingConversationIds.value)
  if (stopping) next.add(conversationId)
  else next.delete(conversationId)
  stoppingConversationIds.value = next
}

function conversationHasActiveRun(conversationId) {
  return Boolean(activeRunIds.value[conversationId])
}

function workspaceSnapshot() {
  return {
    activeId: activeId.value,
    draft: draft.value,
    mode: mode.value,
    creationType: creationType.value,
    imageSize: imageSize.value,
    imageQuality: imageQuality.value,
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
  if (generationRatios.value.some((item) => item.id === state.generationRatio)) {
    generationRatio.value = state.generationRatio
  }
  if (typeof state.generationModel === 'string' && state.generationModel.trim()) {
    generationModel.value = state.generationModel.trim().slice(0, 120)
    if (mode.value === 'image') imageGenerationModel.value = generationModel.value
    else conversationModel.value = generationModel.value
  }
  if (imageResolutions.value.some((item) => item.id === state.generationResolution)) {
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
  selectedSkill.value = composerExtensionsEnabled
    ? skills.find((item) => item.name === state.selectedSkillName) || selectedSkill.value
    : null
}

function restoreConversations(stored) {
  if (!Array.isArray(stored)) return []
  return stored.slice(0, 30).map((conversation) => ({
    ...conversation,
    messages: Array.isArray(conversation.messages) ? conversation.messages : [],
  }))
}

function persistWorkspaceState() {
  if (!hydrated.value) return
  saveAssistantWorkspaceState(scope.value, workspaceSnapshot())
}

// ChatGPT 式草稿态：点“新对话”只清空工作区进入草稿,不落库、不进列表;
// 首次发送时 ensureConversation 才真正创建会话。
function newConversation() {
  visibleMessageLimit.value = MESSAGE_BATCH_SIZE
  activeId.value = ''
  editingMessageId.value = ''
  editingMessageDraft.value = ''
  sidebarOpen.value = false
  draft.value = ''
  referenceImages.value = []
  quotedMessage.value = null
  // 新对话回到 Agent，避免空态文案与底部模式不一致
  creationType.value = 'agent'
  mode.value = 'chat'
  generationModel.value =
    conversationModel.value || conversationModels.value[0]?.model || generationModel.value
  closeComposerPanels()
  closeInlineMenu()
  nextTick(() => promptInput.value?.focus())
}

async function createConversationRecord() {
  if (historySyncing.value) return activeConversation.value || null
  historySyncing.value = true
  try {
    const conversation = await createAssistantConversation('新对话')
    if (!Array.isArray(conversation.messages)) conversation.messages = []
    conversations.value.unshift(conversation)
    visibleMessageLimit.value = MESSAGE_BATCH_SIZE
    activeId.value = conversation.id
    // 必须返回响应式代理（unshift 后从数组取回）,
    // 返回原始引用会让后续 messages.push 绕过依赖追踪,列表不更新
    return conversations.value[0]
  } catch (error) {
    notificationService.error(error?.message || '新建对话失败')
    return null
  } finally {
    historySyncing.value = false
  }
}

async function ensureConversation() {
  return activeConversation.value || createConversationRecord()
}

// 收起 rail 悬停时的会话缩略预览浮窗
const conversationPeek = ref(null)

function showConversationPeek(conversation, event) {
  if (!sidebarCollapsed.value) return
  const rect = event.currentTarget.getBoundingClientRect()
  conversationPeek.value = {
    conversation,
    top: Math.max(64, Math.min(rect.top, window.innerHeight - 176)),
  }
}

function hideConversationPeek() {
  conversationPeek.value = null
}

function conversationPeekLines(conversation) {
  return (conversation.messages || []).slice(-2).map((message) => ({
    role: message.role,
    text: message.images?.length
      ? `[图片 ×${message.images.length}]`
      : messagePreview(message.content),
  }))
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

async function deleteConversation(id) {
  const index = conversations.value.findIndex((item) => item.id === id)
  if (index < 0) return
  const cancelActive = conversationHasActiveRun(id) || pendingDeleteHasActiveRun.value
  try {
    await deleteAssistantConversation(id, { cancelActive })
  } catch (error) {
    if (error?.code === 'assistant_conversation_busy') {
      try {
        const activeRuns = await listActiveAssistantRuns()
        for (const run of activeRuns) {
          if (run.conversationId === id) setConversationRun(id, run.id)
        }
      } catch {
        /* Keep the confirmation open so the user can retry explicitly. */
      }
      notificationService.warning('该对话仍在生成，确认后将先停止任务再删除')
      return
    }
    notificationService.error(error?.message || '删除对话失败')
    return
  }
  runControllers.get(id)?.abort()
  runControllers.delete(id)
  clearConversationRun(id)
  setConversationStopping(id, false)
  for (const message of conversations.value[index]?.messages || []) stopImageProgress(message)
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
  modelSearch.value = ''
  qualityMenuOpen.value = false
  activeMessageMenuId.value = ''
  closeInlineMenu()
}

function expandReferenceDock() {
  if (referenceImages.value.length) referenceDockExpanded.value = true
}

function collapseReferenceDock() {
  referenceDockExpanded.value = false
}

function openReferencePickerFromDock() {
  collapseReferenceDock()
  openReferencePicker()
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
  if (mode.value === 'image') {
    imageGenerationModel.value =
      generationModel.value || imageGenerationModels.value[0]?.model || ''
  } else conversationModel.value = generationModel.value
  creationType.value = type.id
  mode.value = type.id === 'image' ? 'image' : 'chat'
  generationModel.value =
    mode.value === 'image'
      ? imageGenerationModel.value || imageGenerationModels.value[0]?.model || ''
      : conversationModel.value || conversationModels.value[0]?.model || ''
  if (type.id === 'image') {
    selectedSkill.value = null
    ensureImageResolutionSupported()
  }
  closeComposerPanels()
  nextTick(() => promptInput.value?.focus())
}

function selectGenerationModel(model) {
  generationModel.value = model.model
  if (mode.value === 'image') imageGenerationModel.value = model.model
  else conversationModel.value = model.model
  if (mode.value === 'image') ensureImageResolutionSupported()
  modelMenuOpen.value = false
  modelSearch.value = ''
}

function ensureImageResolutionSupported() {
  if (!generationRatios.value.some((ratio) => ratio.id === generationRatio.value)) {
    generationRatio.value = generationRatios.value[0]?.id || '1:1'
  }
  const options = imageResolutions.value
  if (options.some((option) => option.id === generationResolution.value)) return
  const fallback = options[0] || IMAGE_RESOLUTION_OPTIONS[0]
  generationResolution.value = fallback.id
  if (fallback.quality) imageQuality.value = fallback.quality
  syncImageRequestSize()
}

function modelDisplayName(model) {
  const value = String(model || '').trim()
  return (
    [...conversationModels.value, ...imageGenerationModels.value].find(
      (item) => item.model === value,
    )?.label ||
    value ||
    generationModelLabel.value
  )
}

function toggleModelMenu() {
  modelMenuOpen.value = !modelMenuOpen.value
  if (modelMenuOpen.value) modelSearch.value = ''
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
  if (option.quality) imageQuality.value = option.quality
  syncImageRequestSize()
}

function selectImageRatio(ratio) {
  generationRatio.value = ratio.id
  syncImageRequestSize()
}

function syncImageRequestSize() {
  const longEdge =
    imageResolutions.value.find((option) => option.id === generationResolution.value)?.longEdge ||
    1024
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

// 纯读取：根据当前偏好组装本次请求的尺寸/质量参数，不改动任何状态
function currentImageRequestSize() {
  const resolution = imageResolutions.value.find(
    (option) => option.id === generationResolution.value,
  )
  const width = normalizedImageDimension(customImageWidth.value)
  const height = normalizedImageDimension(customImageHeight.value)
  return {
    width,
    height,
    size: generationRatio.value === 'auto' ? 'auto' : `${width}x${height}`,
    requestRatio: generationRatio.value,
    ratioLabel: generationRatio.value === 'auto' ? 'Auto' : generationRatio.value,
    quality: resolution?.quality || imageQuality.value || 'high',
  }
}

function startImageProgress(message) {
  stopImageProgress(message)
  message.progress = 8
  // 渐近逼近 97%：长任务后段仍有可见推进，避免线性 +4% 卡死在 92% 的“假死条”
  const timer = window.setInterval(() => {
    const progress = message.progress || 8
    message.progress = Math.min(97, Math.round((progress + (97 - progress) * 0.045) * 10) / 10)
  }, 500)
  progressTimers.set(message.id, timer)
}

function stopImageProgress(message, completed = false) {
  const timer = progressTimers.get(message?.id)
  if (timer) window.clearInterval(timer)
  progressTimers.delete(message?.id)
  if (completed) message.progress = 100
}

function shouldShowMessageDate(message, index) {
  if (index === 0) return true
  return messageDateKey(message) !== messageDateKey(messages.value[index - 1])
}

function messageTurnId(index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (messages.value[cursor]?.role === 'user') return messages.value[cursor].id
  }
  return ''
}

function toggleMessageStatus(messageId) {
  expandedStatusMessageId.value = expandedStatusMessageId.value === messageId ? '' : messageId
}

function selectSkill(skill) {
  if (!composerExtensionsEnabled) return
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

async function deleteMessage(messageId) {
  const conversation = activeConversation.value
  if (!conversation) return
  const index = conversation.messages.findIndex((message) => message.id === messageId)
  if (index < 0) return
  try {
    await deleteAssistantMessage(messageId)
  } catch (error) {
    notificationService.error(error?.message || '删除内容失败')
    return
  }
  conversation.messages.splice(index, 1)
  conversation.updatedAt = new Date().toISOString()
  activeMessageMenuId.value = ''
  if (quotedMessage.value?.id === messageId) quotedMessage.value = null
  notificationService.success('内容已删除')
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
  if (!isNavigatingByMarker.value && scroller?.scrollTop <= 36 && hiddenMessageCount.value > 0) {
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

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const smooth =
    !prefersReducedMotion && Math.abs(targetTop - scroller.scrollTop) <= scroller.clientHeight * 2.5
  scroller.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' })

  const finishNavigation = () => {
    if (navigationToken !== markerNavigationToken) return
    isNavigatingByMarker.value = false
    syncMessageScrollState()
    syncMessageNavigator()
  }
  if (smooth) {
    window.setTimeout(finishNavigation, 600)
  } else {
    window.requestAnimationFrame(finishNavigation)
  }
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

// 消息入场动画：显式标记“新追加”的消息，用一次性 keyframe 动画进场。
// 不用 TransitionGroup——流式更新的频繁重渲染会不断重启其过渡（实测卡在半透明）。
const newMessageIds = ref(new Set())

function markMessagesNew(...ids) {
  const next = new Set(newMessageIds.value)
  for (const id of ids) if (id) next.add(id)
  newMessageIds.value = next
  window.setTimeout(() => {
    const settled = new Set(newMessageIds.value)
    for (const id of ids) settled.delete(id)
    newMessageIds.value = settled
  }, 900)
}

function imageSkeletonRatio(message) {
  const width = Number(message?.width)
  const height = Number(message?.height)
  return width > 0 && height > 0 ? `${width} / ${height}` : '1 / 1'
}

function assistantImageAt(message, index) {
  return (message?.images || []).find(
    (image, fallbackIndex) => Number(image?.index ?? fallbackIndex) === index,
  )
}

function mergeAssistantStreamImage(message, image) {
  if (!image?.dataUrl) return
  const targetIndex = Number(image.index)
  const images = [...(message.images || [])]
  const existingIndex = images.findIndex(
    (item, fallbackIndex) => Number(item?.index ?? fallbackIndex) === targetIndex,
  )
  if (existingIndex >= 0) images.splice(existingIndex, 1, image)
  else images.push(image)
  images.sort((left, right) => Number(left?.index || 0) - Number(right?.index || 0))
  message.images = images
}

// 生成图加载状态：'' | 'loaded' | 'failed'。
// 图块固定比例 + 骨架占位，杜绝慢加载时 0 高度弹开的布局抖动。
const generatedImageStates = ref({})

function generatedImageState(messageId, index) {
  return generatedImageStates.value[`${messageId}-${index}`] || ''
}

function onGeneratedImageLoad(messageId, index) {
  generatedImageStates.value = {
    ...generatedImageStates.value,
    [`${messageId}-${index}`]: 'loaded',
  }
  if (freshlyGeneratedIds.has(messageId)) triggerImageBurst(`${messageId}-${index}`)
  followConversationBottom()
}

// 揭示粒子迸发：仅本次会话新完成的生成任务触发（浏览历史不触发）
const freshlyGeneratedIds = new Set()
const burstingImages = ref(new Set())

function triggerImageBurst(key) {
  const next = new Set(burstingImages.value)
  next.add(key)
  burstingImages.value = next
  window.setTimeout(() => {
    const settled = new Set(burstingImages.value)
    settled.delete(key)
    burstingImages.value = settled
  }, 1200)
}

// 黄金角散布的确定性粒子参数（无随机数,渲染稳定）
function burstParticleStyle(particle, imageIndex) {
  const angle = (((particle * 137.5 + imageIndex * 61) % 360) * Math.PI) / 180
  const distance = 46 + ((particle * 29 + imageIndex * 13) % 36)
  const colors = ['var(--assistant-accent)', '#5ed2d9', '#c484fc', '#ffd479']
  const size = 4 + (particle % 3) * 2
  return {
    '--bx': `${Math.round(Math.cos(angle) * distance)}px`,
    '--by': `${Math.round(Math.sin(angle) * distance)}px`,
    width: `${size}px`,
    height: `${size}px`,
    background: colors[particle % colors.length],
    animationDelay: `${(particle % 5) * 45}ms`,
  }
}

function onGeneratedImageError(messageId, index) {
  generatedImageStates.value = {
    ...generatedImageStates.value,
    [`${messageId}-${index}`]: 'failed',
  }
}

function retryGeneratedImage(messageId, index) {
  const next = { ...generatedImageStates.value }
  delete next[`${messageId}-${index}`]
  generatedImageStates.value = next
}

function applyAssistantRunUpdate(conversation, assistantMessage, data, { textStream = null } = {}) {
  const run = data?.run || {}
  const persisted = data?.assistantMessage
  const resolvedMode = run.resolvedMode || persisted?.kind || assistantMessage.kind
  const streamActive = textStream && resolvedMode !== 'image' && !textStream.isSettled()
  const localContent = String(assistantMessage.content || '')
  const localStatusStage = assistantMessage.statusStage
  if (streamActive && typeof persisted?.content === 'string') {
    textStream.push(persisted.content)
  }
  if (persisted) {
    // SSE 增量可能领先于 DB 落盘快照，运行中不让轮询把文本“倒带”
    Object.assign(assistantMessage, persisted)
    if (streamActive) {
      assistantMessage.content = localContent
    } else if (
      ['queued', 'running'].includes(run.status) &&
      String(persisted.content || '').length < localContent.length
    ) {
      assistantMessage.content = localContent
    }
  }
  if (run.id) assistantMessage.runId = run.id
  // 终结态以持久化消息的 statusStage(complete/failed)为准，
  // run.stage 是过程态快照，完成后再覆盖会让状态行停在“正在理解图片”
  const runFinished = ['succeeded', 'failed', 'canceled'].includes(run.status)
  if (run.stage && !runFinished) assistantMessage.statusStage = run.stage
  if (run.resolvedMode) assistantMessage.kind = run.resolvedMode
  // 硬闸：消息行一旦持久化为终态,pending 必为 false——
  // 即使 run 状态快照仍是 running(完成时序竞态),也不允许“已完成还转圈”
  const messageTerminal =
    persisted && ['complete', 'failed'].includes(String(persisted.status || ''))
  const successfulCompletion =
    run.status === 'succeeded' || String(persisted?.status || '') === 'complete'
  const deferredCompletion = Boolean(streamActive && successfulCompletion)
  if (deferredCompletion) textStream.finish('succeeded')
  if (streamActive && ['failed', 'canceled'].includes(run.status)) textStream.finish(run.status)
  assistantMessage.pending = deferredCompletion
    ? true
    : messageTerminal
      ? false
      : ['queued', 'running'].includes(run.status || assistantMessage.status)
  assistantMessage.routing = !messageTerminal && !streamActive && run.stage === 'routing'
  if (streamActive && textStream.hasStarted()) {
    assistantMessage.statusStage = 'answering'
  } else if (deferredCompletion) {
    assistantMessage.statusStage = localStatusStage || 'thinking'
  }
  if (
    assistantMessage.kind === 'image' &&
    assistantMessage.pending &&
    !progressTimers.has(assistantMessage.id)
  ) {
    startImageProgress(assistantMessage)
  }
  if (!assistantMessage.pending && progressTimers.has(assistantMessage.id)) {
    stopImageProgress(assistantMessage, run.status === 'succeeded')
    if (run.status === 'succeeded' && assistantMessage.kind === 'image') {
      settledImageMessageId.value = assistantMessage.id
      window.clearTimeout(settledImageTimer)
      settledImageTimer = window.setTimeout(() => {
        settledImageMessageId.value = ''
      }, 900)
      // 粒子迸发只庆祝本次会话新生成的图,浏览历史时不放烟花;
      // 30 秒窗口覆盖多图逐张加载,过期后重开会话不再触发
      freshlyGeneratedIds.add(assistantMessage.id)
      window.setTimeout(() => freshlyGeneratedIds.delete(assistantMessage.id), 30000)
    }
  }
  conversation.updatedAt = assistantMessage.updatedAt || new Date().toISOString()
  if (activeId.value === conversation.id) followConversationBottom()
}

async function monitorAssistantRun(conversation, assistantMessage, runId, controller) {
  setConversationRun(conversation.id, runId)
  let textStream = null
  const ensureTextStream = () => {
    if (!textStream || textStream.isSettled()) {
      textStream = createTextStreamRenderer(assistantMessage, {
        onProgress: followConversationBottom,
      })
    }
    return textStream
  }
  const applyMonitoredUpdate = (update) => {
    const run = update?.run || {}
    const persisted = update?.assistantMessage
    const resolvedMode = run.resolvedMode || persisted?.kind || assistantMessage.kind
    if (resolvedMode !== 'image' && typeof persisted?.content === 'string' && persisted.content) {
      ensureTextStream().push(persisted.content)
    }
    if (resolvedMode === 'image' && textStream && !textStream.isSettled()) {
      textStream.cancel()
      textStream = null
    }
    applyAssistantRunUpdate(conversation, assistantMessage, update, { textStream })
  }
  // SSE 真流式：增量文本即时呈现；轮询仍是任务状态机的权威兜底
  const stream = openAssistantRunStream(runId, {
    onEvent(event) {
      if (!assistantMessage.pending) return
      // 用户点了停止后,迟到的 SSE 增量不得把“正在停止”状态顶回“生成中”
      if (assistantMessage.statusStage === 'stopping') return
      if (event?.kind === 'image') {
        assistantMessage.kind = 'image'
        assistantMessage.routing = false
        assistantMessage.statusStage = event.stage || assistantMessage.statusStage
      } else if (event?.kind === 'chat' && assistantMessage.kind === 'agent') {
        assistantMessage.kind = 'chat'
        assistantMessage.routing = false
        assistantMessage.statusStage = event.stage || assistantMessage.statusStage
      }
      if (event?.image) {
        mergeAssistantStreamImage(assistantMessage, event.image)
        assistantMessage.kind = 'image'
        assistantMessage.routing = false
        assistantMessage.statusStage = event.stage || 'generating-image'
        if (event.imageTotal) assistantMessage.count = event.imageTotal
        freshlyGeneratedIds.add(assistantMessage.id)
        followConversationBottom()
      }
      if (
        event?.kind !== 'image' &&
        assistantMessage.kind !== 'image' &&
        typeof event?.content === 'string' &&
        event.content.length > 0
      ) {
        ensureTextStream().push(event.content)
        if (assistantMessage.kind === 'agent') assistantMessage.kind = 'chat'
        assistantMessage.routing = false
        assistantMessage.statusStage = event.stage || 'answering'
        followConversationBottom()
      }
      // 上游完成不等于界面已经展示完；队列排空后再进入“回答已完成”。
      if (event?.done && textStream && ['succeeded', 'failed', 'canceled'].includes(event.status)) {
        textStream.finish(event.status)
      }
    },
  })
  try {
    const data = await waitForAssistantRun(runId, {
      signal: controller.signal,
      onUpdate(update) {
        applyMonitoredUpdate(update)
      },
    })
    applyMonitoredUpdate(data)
    if (data?.run?.status === 'failed') {
      assistantMessage.error =
        data.run.errorMessage || assistantMessage.error || '生成失败，请稍后重试'
    }
    // 终态收敛兜底：任何竞态导致界面停在“完成但无内容/仍在转圈”,
    // 延迟重拉权威状态自我修复（最多两次）
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const settled =
        !assistantMessage.pending &&
        (assistantMessage.kind === 'image' || Boolean(assistantMessage.content))
      if (settled) break
      await new Promise((resolve) => setTimeout(resolve, 450))
      try {
        const refreshed = await getAssistantRun(runId)
        applyMonitoredUpdate(refreshed)
      } catch {
        break
      }
    }
    if (!['queued', 'running'].includes(data?.run?.status || '')) {
      if (textStream && data?.run?.status === 'succeeded') {
        textStream.finish('succeeded')
        await textStream.whenSettled()
      } else {
        assistantMessage.pending = false
      }
    }
    return data
  } finally {
    stream?.close()
    if (textStream && !textStream.isSettled()) textStream.cancel()
  }
}

async function generateResponse(
  conversation,
  prompt,
  assistantMessage,
  responseMode,
  { sourceUserMessageId = '' } = {},
) {
  const visualContext = resolveVisualContext(conversation, prompt)
  // 意图识别完全交给服务端（mode=agent），路由结果通过 run.resolvedMode 回填，
  // 避免客户端正则预猜与服务端结论不一致导致状态标签闪变。
  assistantMessage.kind = responseMode
  assistantMessage.pending = true
  assistantMessage.error = ''
  assistantMessage.visualContextCount = visualContext.length
  assistantMessage.routing = responseMode === 'agent'
  assistantMessage.statusStage =
    responseMode === 'image' ? 'preparing-image' : responseMode === 'agent' ? 'routing' : 'thinking'
  const controller = new AbortController()
  setConversationRun(conversation.id, `creating:${assistantMessage.id}`)
  runControllers.set(conversation.id, controller)
  if (activeId.value === conversation.id) await scrollToBottom()

  try {
    const uploadedReferences = (
      await Promise.all(
        visualContext
          .slice(0, selectedImageGenerationModel.value?.maxReferenceImages ?? 4)
          .map(ensureReferenceUploaded),
      )
    ).filter(Boolean)
    const currentUserMessage = conversation.messages.find(
      (message) => message.id === (sourceUserMessageId || assistantMessage.userMessageId),
    )
    const created = await createAssistantRun(
      {
        conversationId: conversation.id,
        prompt,
        mode: responseMode,
        clientUserMessageId: currentUserMessage?.id || uid(),
        clientAssistantMessageId: assistantMessage.id,
        sourceUserMessageId,
        referenceImages: uploadedReferences,
        quoted: currentUserMessage?.quoted || null,
        skill: currentUserMessage?.skill || '',
        model: assistantMessage.model || generationModel.value,
        ratio: assistantMessage.requestRatio || assistantMessage.ratio,
        resolution: assistantMessage.resolution,
        count: assistantMessage.count || generationCount.value,
        requestSize: assistantMessage.requestSize || imageSize.value,
        width: assistantMessage.width,
        height: assistantMessage.height,
        quality: assistantMessage.quality || imageQuality.value,
        serviceKey: 'assistant_image',
      },
      { signal: controller.signal },
    )
    if (created.userMessage && currentUserMessage)
      Object.assign(currentUserMessage, created.userMessage)
    applyAssistantRunUpdate(conversation, assistantMessage, created)
    await monitorAssistantRun(conversation, assistantMessage, created.run.id, controller)
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (stoppingConversationIds.value.has(conversation.id)) {
        assistantMessage.statusStage = 'stopped'
        assistantMessage.pending = false
        assistantMessage.content ||= '已停止生成'
        // 提交请求可能已在服务端落地：兜底取消该对话的孤儿任务
        void listActiveAssistantRuns()
          .then((activeRuns) => {
            const orphan = activeRuns.find((run) => run.conversationId === conversation.id)
            return orphan ? cancelAssistantRun(orphan.id) : null
          })
          .catch(() => null)
      }
    } else {
      assistantMessage.statusStage = 'failed'
      assistantMessage.pending = false
      assistantMessage.routing = false
      assistantMessage.error = error?.message || '生成失败，请稍后重试'
      assistantMessage.content ||= assistantMessage.error
    }
  } finally {
    if (runControllers.get(conversation.id) === controller) {
      runControllers.delete(conversation.id)
      clearConversationRun(conversation.id)
      setConversationStopping(conversation.id, false)
    }
    if (activeId.value === conversation.id) followConversationBottom()
  }
}

async function sendMessage() {
  const prompt = draft.value.trim()
  if (!canSend.value) return
  if (activeRunCount.value >= 4 && !conversationHasActiveRun(activeId.value)) {
    notificationService.warning('最多可同时运行 4 个对话任务，请等待其中一个完成')
    return
  }
  const requestedImage = currentImageRequestSize()
  const requestedImageCount = imageCountFromPrompt(prompt)

  const conversation = await ensureConversation()
  if (!conversation) return
  if (!conversation.messages.length) conversation.title = conversationTitle(prompt)
  conversation.updatedAt = new Date().toISOString()
  const userMessage = {
    id: uid(),
    role: 'user',
    content: prompt,
    createdAt: conversation.updatedAt,
    quoted: quotedMessage.value ? { ...quotedMessage.value } : null,
    skill: selectedSkill.value?.name || '',
    referenceImages: referenceImages.value.map((image) => ({ ...image })),
  }
  conversation.messages.push(userMessage)
  markMessagesNew(userMessage.id)
  const responseMode =
    mode.value === 'image' ? 'image' : creationType.value === 'agent' ? 'agent' : 'chat'
  const assistantMessage = createAssistantPlaceholder({
    prompt,
    responseMode,
    userMessageId: userMessage.id,
    defaults: {
      model: generationModel.value,
      ratio: requestedImage.ratioLabel,
      requestRatio: requestedImage.requestRatio,
      resolution: generationResolution.value,
      count: requestedImageCount || generationCount.value,
      requestSize: requestedImage.size,
      width: requestedImage.width,
      height: requestedImage.height,
      quality: requestedImage.quality,
    },
  })
  conversation.messages.push(assistantMessage)
  markMessagesNew(assistantMessage.id)
  draft.value = ''
  quotedMessage.value = null
  referenceImages.value = []
  closeInlineMenu()
  resizePromptInput()
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
  message.pending = true
  message.statusStage = responseMode === 'image' ? 'preparing-image' : 'thinking'
  await generateResponse(conversation, prompt, message, responseMode, {
    sourceUserMessageId: conversation.messages[index - 1].id,
  })
}

async function stopGeneration(conversationId = activeId.value) {
  // 防御：模板若不带括号直绑事件处理器,Vue 会把事件对象传进来
  if (typeof conversationId !== 'string' || !conversationId) conversationId = activeId.value
  const runId = activeRunIds.value[conversationId]
  if (!runId || stoppingConversationIds.value.has(conversationId)) return
  setConversationStopping(conversationId, true)
  const conversation = conversations.value.find((item) => item.id === conversationId)
  const pendingMessage = [...(conversation?.messages || [])]
    .reverse()
    .find((message) => message.role === 'assistant' && message.pending)
  if (pendingMessage) {
    pendingMessage.statusStage = 'stopped'
    pendingMessage.pending = false
    pendingMessage.routing = false
    pendingMessage.content ||= '已停止生成'
    stopImageProgress(pendingMessage)
  }

  // 用户操作先在本地立即生效；服务端取消请求独立完成，不能让网络或
  // Redis 队列响应时间把界面卡在“正在停止”。
  runControllers.get(conversationId)?.abort()
  clearConversationRun(conversationId)
  setConversationStopping(conversationId, false)

  try {
    if (!runId.startsWith('creating:')) {
      await cancelAssistantRun(runId)
    } else {
      // 创建请求可能已在服务端提交但响应尚未返回，短暂重试以清理孤儿任务。
      for (const delay of [0, 120, 320]) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
        const activeRuns = await listActiveAssistantRuns()
        const created = activeRuns.find((run) => run.conversationId === conversationId)
        if (created) {
          await cancelAssistantRun(created.id)
          break
        }
      }
    }
  } catch (error) {
    notificationService.error(error?.message || '停止任务失败')
    // 请求失败不代表服务端一定没收到。只有任务仍处于活动态时才恢复监控。
    try {
      const activeRuns = await listActiveAssistantRuns()
      const active = activeRuns.find((run) => run.conversationId === conversationId)
      if (active && pendingMessage) {
        pendingMessage.pending = true
        pendingMessage.statusStage = active.stage || 'thinking'
        if (pendingMessage.content === '已停止生成') pendingMessage.content = ''
        void resumeAssistantRun(active)
      }
    } catch {
      // 保留已停止界面；重新进入页面时活动任务恢复逻辑会再次对齐状态。
    }
  }
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
  if (!composerExtensionsEnabled) {
    closeInlineMenu()
    return
  }
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
    const flipped = composerRect.top + preferredTop + menuHeight > window.innerHeight - 12
    const top = flipped ? caretTop - menuHeight - 7 : preferredTop
    inlineMenuType.value = trigger === '/' ? 'slash' : 'mention'
    inlineMenuQuery.value = query
    activeTriggerRange.value = { start, end: caret }
    inlineMenuIndex.value = 0
    inlineMenuPosition.value = {
      left: Math.max(12, Math.min(desiredLeft, maxLeft)),
      top,
      flipped,
    }
  })
}

function handleComposerInput() {
  resizePromptInput()
  updateInlineMenu()
}

function handleComposerPaste(event) {
  return handleAttachmentPaste(event, { beforeAppend: closeInlineMenu })
}

const emptyStateSuggestions = [
  { icon: 'bi-image', text: '画一张星空下的雪山桌面壁纸' },
  { icon: 'bi-app', text: '设计一个极简风格的天气 App 图标' },
  { icon: 'bi-chat-dots', text: '用三句话介绍你能帮我做什么' },
  { icon: 'bi-pencil', text: '写一段科幻短篇的开头，主角是画师' },
]

function applySuggestion(text) {
  draft.value = text
  resizePromptInput()
  nextTick(() => promptInput.value?.focus())
}

function insertComposerTrigger(trigger) {
  if (!composerExtensionsEnabled) return
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

function resizePromptInput() {
  nextTick(() => {
    const input = promptInput.value
    if (!input) return
    const previous = input.offsetHeight
    input.style.height = 'auto'
    const next = Math.min(input.scrollHeight, 168)
    input.style.height = `${previous}px`
    void input.offsetHeight
    input.style.height = `${next}px`
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
  if (isGenerating.value || message?.role !== 'user' || message.id !== lastUserMessageId.value) {
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

  const assistantMessage = createAssistantPlaceholder({
    prompt,
    responseMode,
    previous: previousReply,
    defaults: {
      model: generationModel.value,
      ratio: requestedImage.ratioLabel,
      requestRatio: requestedImage.requestRatio,
      resolution: generationResolution.value,
      count: requestedImageCount || previousReply?.count || generationCount.value,
      requestSize: requestedImage.size,
      width: requestedImage.width,
      height: requestedImage.height,
      quality: requestedImage.quality,
    },
  })
  conversation.messages.push(assistantMessage)
  markMessagesNew(assistantMessage.id)
  conversation.updatedAt = assistantMessage.createdAt
  cancelUserMessageEdit()
  await generateResponse(conversation, prompt, assistantMessage, responseMode, {
    sourceUserMessageId: message.id,
  })
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

async function downloadImage(image, index = 0) {
  const source = String(image?.dataUrl || '')
  if (!source) return
  const filename = `starclouds-${Date.now()}-${Number(index) + 1}.png`
  try {
    // 经 blob 下载：/api/v1/files 需带 Cookie，跨域 presigned URL 上 download 属性会被忽略
    const response = await fetch(source, { credentials: 'include' })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  } catch {
    const link = document.createElement('a')
    link.href = source
    link.download = filename
    link.rel = 'noopener'
    link.click()
  }
}

function openImagePreview(image, index = 0, images = [image]) {
  const gallery = Array.isArray(images) && images.length ? images : [image]
  const safeIndex = Math.min(Math.max(Number(index) || 0, 0), gallery.length - 1)
  selectedImage.value = {
    ...gallery[safeIndex],
    index: safeIndex,
    gallery,
  }
}

function closeImagePreview() {
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
}

function toggleSidebar() {
  // 与 CSS 的抽屉断点保持一致（≤900px 走遮罩抽屉，>900px 走折叠）
  if (window.matchMedia('(max-width: 900px)').matches) {
    sidebarOpen.value = !sidebarOpen.value
    return
  }
  // FLIP + GSAP：布局仍瞬时切换（单次重排,不逐帧 reflow）,
  // 视觉上主区用纯 transform 从旧位置弹性滑入新位置（back.out 回弹）。
  const mainEl = mainRef.value
  const sidebarEl = sidebarRef.value
  const firstLeft = mainEl?.getBoundingClientRect().left ?? null
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    localStorage.setItem('starclouds:assistant-sidebar-collapsed', String(sidebarCollapsed.value))
  } catch {
    /* ignore */
  }
  if (
    firstLeft === null ||
    !mainEl ||
    !sidebarEl ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return
  }
  nextTick(() => {
    const delta = firstLeft - mainEl.getBoundingClientRect().left
    gsap.killTweensOf([mainEl, sidebarEl])
    if (delta) {
      gsap.fromTo(
        mainEl,
        { x: delta },
        {
          x: 0,
          duration: 0.55,
          ease: 'back.out(1.4)',
          clearProps: 'transform',
          overwrite: 'auto',
          lazy: false,
        },
      )
    }
    gsap.fromTo(
      sidebarEl,
      { opacity: 0.4, x: sidebarCollapsed.value ? 10 : -12 },
      {
        opacity: 1,
        x: 0,
        duration: 0.45,
        ease: 'back.out(1.6)',
        clearProps: 'transform,opacity',
        overwrite: 'auto',
        lazy: false,
      },
    )
  })
}

async function loadServiceConfig() {
  serviceLoading.value = true
  serviceError.value = ''
  try {
    const config = await fetchAssistantConfig()
    const options = Array.isArray(config?.conversationModels)
      ? config.conversationModels
          .map((item) => ({
            label: String(item?.label || item?.model || '').trim(),
            model: String(item?.model || '').trim(),
            source: String(item?.source || 'upstream'),
            description: String(
              item?.description ||
                item?.provider ||
                (item?.source === 'configured'
                  ? '后台配置的对话模型'
                  : item?.source === 'default'
                    ? '后台默认对话模型'
                    : '由当前 BaseURL 自动读取'),
            ),
            pricePoints: item?.pricePoints,
            standardPricePoints: item?.standardPricePoints,
            discountPricePoints: item?.discountPricePoints,
          }))
          .filter((item) => item.label && item.model)
      : []
    if (!options.length && config?.chatModel) {
      options.push({
        label: String(config.chatModel),
        model: String(config.chatModel),
        source: 'default',
        description: '后台默认对话模型',
      })
    }
    conversationModels.value = options
    imageGenerationModels.value = Array.isArray(config?.imageModels)
      ? config.imageModels
          .map((item) => ({
            label: String(item?.label || item?.model || '').trim(),
            model: String(item?.model || '').trim(),
            source: String(item?.source || 'configured'),
            description: String(item?.description || item?.provider || '后台配置的图片模型'),
            resolutions: Array.isArray(item?.resolutions)
              ? item.resolutions.map((value) => String(value || '').toUpperCase()).filter(Boolean)
              : [],
            default: item?.default === true,
            fastMode: item?.fastMode === true,
            pricePoints: item?.pricePoints,
            standardPricePoints: item?.standardPricePoints,
            discountPricePoints: item?.discountPricePoints,
            ...normalizeImageModelCapabilities(item),
          }))
          .filter((item) => item.label && item.model)
      : []
    const savedModel =
      conversationModel.value || (mode.value !== 'image' ? generationModel.value : '')
    conversationModel.value =
      options.find((item) => item.model === savedModel)?.model ||
      options.find((item) => item.model === config?.chatModel)?.model ||
      options[0]?.model ||
      String(config?.chatModel || '')
    if (mode.value !== 'image') generationModel.value = conversationModel.value
    else if (!imageGenerationModels.value.some((item) => item.model === generationModel.value)) {
      imageGenerationModel.value =
        imageGenerationModels.value.find((item) => item.model === config?.imageModel)?.model ||
        imageGenerationModels.value[0]?.model ||
        ''
      generationModel.value = imageGenerationModel.value
    }
    ensureImageResolutionSupported()
  } catch (error) {
    serviceError.value = error?.message || 'AI 服务尚未配置'
  } finally {
    serviceLoading.value = false
  }
}

function handleGlobalKeydown(event) {
  // 全屏预览打开时按键交给 AssistantImageViewer 自己的监听处理
  if (selectedImage.value) return
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

function handleGlobalClick(event) {
  if (
    event.target instanceof Element &&
    event.target.closest('.composer-popover, .nested-selection-menu, .inline-trigger-menu')
  ) {
    return
  }
  closeComposerPanels()
}

watch(
  [activeId, () => messages.value.length],
  () => {
    nextTick(scheduleMessageNavigatorSync)
  },
  { flush: 'post' },
)

watch([() => referenceImages.value.length, isUploadingReferences], ([count, uploading]) => {
  if (!count || uploading) collapseReferenceDock()
})

watch(
  [
    activeId,
    draft,
    mode,
    creationType,
    imageSize,
    imageQuality,
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
}

async function prepareLegacyAssistantHistory(stored) {
  const prepared = []
  for (const conversation of restoreConversations(stored)) {
    const messages = []
    for (const original of conversation.messages.slice(-160)) {
      const message = { ...original }
      for (const field of ['referenceImages', 'images']) {
        const migrated = []
        for (const image of Array.isArray(message[field]) ? message[field].slice(0, 4) : []) {
          try {
            const uploaded = await ensureReferenceUploaded(image)
            if (uploaded) migrated.push(uploaded)
          } catch {
            // Preserve text history even when a legacy temporary image is no longer readable.
          }
        }
        message[field] = migrated
      }
      if (message.pending) {
        message.pending = false
        message.routing = false
        message.statusStage = 'stopped'
        message.content ||= '任务已中断，可重新生成'
      }
      messages.push(message)
    }
    prepared.push({ ...conversation, messages })
  }
  return prepared
}

async function resumeAssistantRun(run) {
  const conversation = conversations.value.find((item) => item.id === run.conversationId)
  const assistantMessage = conversation?.messages.find(
    (message) => message.id === run.assistantMessageId,
  )
  if (!conversation || !assistantMessage) return
  const controller = new AbortController()
  setConversationRun(conversation.id, run.id)
  runControllers.set(conversation.id, controller)
  try {
    await monitorAssistantRun(conversation, assistantMessage, run.id, controller)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      assistantMessage.error = error?.message || '任务状态恢复失败'
    }
  } finally {
    if (runControllers.get(conversation.id) === controller) {
      runControllers.delete(conversation.id)
      clearConversationRun(conversation.id)
      setConversationStopping(conversation.id, false)
    }
  }
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
  await authStore.initAuth().catch(() => null)
  const workspaceState = loadAssistantWorkspaceState(scope.value)
  await loadServiceConfig()
  historySyncing.value = true
  try {
    let stored = await listAssistantConversations()
    if (!stored.length) {
      const legacy = await loadAssistantHistory(scope.value)
      if (legacy.length) {
        const prepared = await prepareLegacyAssistantHistory(legacy)
        await importAssistantConversations(prepared)
        await clearAssistantHistory(scope.value)
        stored = await listAssistantConversations()
        notificationService.success('旧对话已迁移到云端')
      }
    }
    conversations.value = restoreConversations(stored)
  } catch (error) {
    notificationService.error(error?.message || '对话记录加载失败')
    conversations.value = []
  } finally {
    historySyncing.value = false
  }
  restoreWorkspaceState(workspaceState)
  try {
    const { takePendingPrompt } = await import('@/features/creator-hub/studioTools')
    const pending = takePendingPrompt(['assistant', 't2i'])
    if (pending?.prompt) draft.value = pending.prompt.slice(0, 12000)
  } catch {
    // ignore
  }
  activeId.value = conversations.value.some((item) => item.id === workspaceState.activeId)
    ? workspaceState.activeId
    : listableConversations.value[0]?.id || ''
  hydrated.value = true
  resizePromptInput()
  scrollToBottom()
  // 静默回收历史遗留的空会话（草稿逻辑上线前创建的“新对话”垃圾,列表已不显示）
  void (async () => {
    const empties = conversations.value.filter(
      (item) => (item.messages?.length || 0) === 0 && item.id !== activeId.value,
    )
    for (const empty of empties) {
      try {
        await deleteAssistantConversation(empty.id)
        const index = conversations.value.findIndex((item) => item.id === empty.id)
        if (index >= 0) conversations.value.splice(index, 1)
      } catch {
        break
      }
    }
  })()
  try {
    const activeRuns = await listActiveAssistantRuns()
    for (const run of activeRuns.slice(0, 4)) void resumeAssistantRun(run)
  } catch {
    // Conversation data remains usable if a status refresh temporarily fails.
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('pagehide', handlePageHide)
  for (const controller of runControllers.values()) controller.abort()
  runControllers.clear()
  for (const timer of progressTimers.values()) window.clearInterval(timer)
  progressTimers.clear()
  if (copiedMessageTimer) window.clearTimeout(copiedMessageTimer)
  if (navigatorFrame) window.cancelAnimationFrame(navigatorFrame)
  clearReturnToBottomTimer()
  if (hydrated.value) {
    persistWorkspaceState()
  }
})
</script>

<template>
  <div
    class="assistant-workspace"
    :class="{
      'is-dark': appearanceStore.isDark,
      'is-generating': isGenerating,
      'is-sidebar-collapsed': sidebarCollapsed,
    }"
  >
    <Transition name="scrim-fade">
      <button
        v-if="sidebarOpen"
        class="assistant-scrim"
        type="button"
        aria-label="关闭侧栏"
        @click="sidebarOpen = false"
      ></button>
    </Transition>

    <aside ref="sidebarRef" class="assistant-sidebar" :class="{ 'is-open': sidebarOpen }">
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
          <span>最近</span><small>{{ listableConversations.length }}</small>
        </p>
        <label class="conversation-search">
          <i class="bi bi-search"></i>
          <input v-model="conversationSearch" type="text" placeholder="搜索对话" />
          <button
            v-if="conversationSearch"
            type="button"
            title="清空搜索"
            aria-label="清空搜索"
            @click="conversationSearch = ''"
          >
            <i class="bi bi-x"></i>
          </button>
        </label>
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
              :title="conversation.title"
              @click="selectConversation(conversation.id)"
              @mouseenter="showConversationPeek(conversation, $event)"
              @mouseleave="hideConversationPeek"
            >
              <span
                class="conversation-thumb"
                :class="{
                  'has-image': conversationPreviewImage(conversation),
                  'is-running': conversationHasActiveRun(conversation.id),
                }"
              >
                <img
                  v-if="conversationPreviewImage(conversation)"
                  :src="conversationPreviewImage(conversation)"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <i v-else class="bi bi-chat-square"></i>
                <i
                  v-if="conversationHasActiveRun(conversation.id)"
                  class="bi bi-arrow-repeat conversation-run-indicator"
                  aria-label="任务处理中"
                ></i>
              </span>
              <span class="conversation-copy">
                <span>{{ conversation.title }}</span>
                <small>
                  {{
                    conversationHasActiveRun(conversation.id)
                      ? '处理中'
                      : formatTime(conversation.updatedAt)
                  }}
                </small>
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
          <template v-if="!hydrated">
            <div v-for="n in 5" :key="`sk-${n}`" class="conversation-skeleton" aria-hidden="true">
              <i></i>
              <span><b></b><b></b></span>
            </div>
          </template>
          <p v-else-if="!visibleConversations.length" class="conversation-empty">暂无记录</p>
        </div>
      </div>
    </aside>

    <main ref="mainRef" class="assistant-main">
      <div class="assistant-ambient-stage" aria-hidden="true">
        <i class="ambient-blob is-a"></i>
        <i class="ambient-blob is-b"></i>
        <i class="ambient-blob is-c"></i>
      </div>
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
          <span
            v-if="activeConversation?.title"
            class="active-conversation-title"
            :title="activeConversation.title"
            >{{ activeConversation.title }}</span
          >
        </div>
        <div class="topbar-filters">
          <button
            type="button"
            :class="{ active: assetLibraryOpen }"
            :aria-pressed="assetLibraryOpen"
            @click.stop="assetLibraryOpen = !assetLibraryOpen"
          >
            <i class="bi bi-archive"></i><span>资产库</span>
          </button>
        </div>
      </header>

      <div ref="messageScroller" class="assistant-messages" @scroll.passive="handleMessageScroll">
        <section
          v-if="serviceLoading || !hydrated"
          class="assistant-thread-skeleton"
          aria-label="正在加载"
        >
          <div class="sk-bubble is-user"><i style="width: 46%"></i></div>
          <div class="sk-bubble"><i style="width: 82%"></i><i style="width: 64%"></i></div>
          <div class="sk-bubble is-user"><i style="width: 30%"></i></div>
          <div class="sk-bubble"><i style="width: 74%"></i><i style="width: 40%"></i></div>
        </section>
        <section v-else-if="!messages.length" class="assistant-empty-state" aria-label="空白创作区">
          <span class="empty-mark"><i class="bi bi-stars"></i></span>
          <p class="empty-mode-label">
            <i class="bi" :class="selectedCreation.icon"></i>
            <template v-if="mode === 'image'">图片生成 · 描述画面并上传参考图</template>
            <template v-else>Agent 模式 · 自动识别对话与生图</template>
          </p>
          <h1>今天想创作什么？</h1>
          <div class="suggestion-grid">
            <button
              v-for="suggestion in emptyStateSuggestions"
              :key="suggestion.text"
              type="button"
              @click="applySuggestion(suggestion.text)"
            >
              <i class="bi" :class="suggestion.icon"></i>
              <span>{{ suggestion.text }}</span>
              <i class="bi bi-arrow-up-right suggestion-arrow"></i>
            </button>
          </div>
        </section>

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
          <div class="message-turns">
            <div
              v-for="{ message, originalIndex } in renderedMessages"
              :key="message.id"
              class="message-turn"
              :class="{ 'is-new': newMessageIds.has(message.id) }"
            >
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
                    <div
                      v-if="expandedStatusMessageId === message.id"
                      class="message-status-detail"
                    >
                      <p>{{ messageStatus(message).detail }}</p>
                      <div
                        v-if="
                          message.pending &&
                          message.kind !== 'image' &&
                          messageStatus(message).progress > 0
                        "
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
                  >
                    <div class="image-generation-summary">
                      <strong>{{ message.prompt || '正在生成图片' }}</strong>
                      <span>{{ modelDisplayName(message.model || generationModel) }}</span>
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
                        'is-many': Number(message.count || 2) > 2,
                        'is-preparing': message.statusStage === 'preparing-image',
                      }"
                      :style="{
                        '--image-skeleton-ratio': imageSkeletonRatio(message),
                        '--image-slot-count': Number(message.count || 2),
                      }"
                    >
                      <div
                        v-for="slot in message.count || 2"
                        :key="slot"
                        class="image-dream-slot"
                        :class="{
                          'is-ready': assistantImageAt(message, slot - 1),
                          'is-loaded': generatedImageState(message.id, slot - 1) === 'loaded',
                        }"
                      >
                        <button
                          v-if="assistantImageAt(message, slot - 1)"
                          class="image-dream-preview"
                          type="button"
                          title="查看大图"
                          @click="
                            openImagePreview(assistantImageAt(message, slot - 1), 0, [
                              assistantImageAt(message, slot - 1),
                            ])
                          "
                        >
                          <img
                            :src="assistantImageAt(message, slot - 1).dataUrl"
                            :alt="
                              assistantImageAt(message, slot - 1).revisedPrompt || 'AI 生成图片'
                            "
                            loading="lazy"
                            decoding="async"
                            @load="onGeneratedImageLoad(message.id, slot - 1)"
                            @error="onGeneratedImageError(message.id, slot - 1)"
                          />
                        </button>
                        <i
                          v-if="generatedImageState(message.id, slot - 1) !== 'loaded'"
                          class="dream-slot-spinner"
                          aria-hidden="true"
                        ></i>
                      </div>
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
                          loading="lazy"
                          decoding="async"
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
                    <span
                      v-else-if="message.pending && messageStatus(message).tone === 'working'"
                      class="typing-indicator"
                      ><i></i><i></i><i></i
                    ></span>
                    <div
                      v-if="message.images?.length"
                      class="generated-images"
                      :class="{
                        'is-single': message.images.length === 1,
                        'is-many': message.images.length > 2,
                        'is-settling': settledImageMessageId === message.id,
                      }"
                      :style="{
                        '--generated-ratio': imageSkeletonRatio(message),
                        '--image-slot-count': message.images.length,
                      }"
                    >
                      <figure
                        v-for="(image, imageIndex) in message.images"
                        :key="`${message.id}-${imageIndex}`"
                        :class="{
                          'is-loading': !generatedImageState(message.id, imageIndex),
                          'is-failed': generatedImageState(message.id, imageIndex) === 'failed',
                        }"
                      >
                        <button
                          v-if="generatedImageState(message.id, imageIndex) !== 'failed'"
                          class="generated-image-preview"
                          type="button"
                          title="查看大图"
                          @click="openImagePreview(image, imageIndex, message.images)"
                        >
                          <img
                            :src="image.dataUrl"
                            :alt="image.revisedPrompt || 'AI 生成图片'"
                            loading="lazy"
                            decoding="async"
                            @load="onGeneratedImageLoad(message.id, imageIndex)"
                            @error="onGeneratedImageError(message.id, imageIndex)"
                          />
                          <i class="tile-sheen" aria-hidden="true"></i>
                        </button>
                        <div v-else class="generated-image-failed">
                          <i class="bi bi-image-alt"></i>
                          <span>图片加载失败</span>
                          <button
                            type="button"
                            @click="retryGeneratedImage(message.id, imageIndex)"
                          >
                            重新加载
                          </button>
                        </div>
                        <span
                          v-if="burstingImages.has(`${message.id}-${imageIndex}`)"
                          class="tile-burst"
                          aria-hidden="true"
                        >
                          <i
                            v-for="particle in 12"
                            :key="particle"
                            :style="burstParticleStyle(particle, imageIndex)"
                          ></i>
                        </span>
                        <div
                          v-if="generatedImageState(message.id, imageIndex) === 'loaded'"
                          class="generated-image-actions"
                        >
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
                  以上内容由 AI 生成
                </p>
                <div
                  v-if="message.role === 'assistant' && !message.pending"
                  class="message-actions"
                >
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
                  <button
                    type="button"
                    title="引用"
                    aria-label="引用"
                    @click="quoteMessage(message)"
                  >
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
            </div>
          </div>
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

      <div
        class="composer-zone"
        :class="{ 'is-scrolled-away': isComposerCompact, 'is-dragging-over': isDraggingAttachment }"
        @dragenter="handleAttachmentDragEnter"
        @dragover="handleAttachmentDragOver"
        @dragleave="handleAttachmentDragLeave"
        @drop="handleAttachmentDrop"
      >
        <div v-if="isDraggingAttachment" class="composer-drop-hint" aria-hidden="true">
          <i class="bi bi-images"></i>
          <span>松开鼠标，把图片作为参考图添加</span>
        </div>
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
        >
          <Transition name="composer-pop">
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
          </Transition>

          <Transition name="composer-pop">
            <section
              v-if="modelMenuOpen && !preferencesOpen"
              class="composer-popover image-model-menu"
            >
              <header class="model-menu-head">
                <p class="popover-eyebrow">
                  {{ mode === 'image' ? '选择图片模型' : '选择对话模型' }}
                </p>
                <span>{{ generationModels.length }} 个模型</span>
              </header>
              <div v-if="generationModels.length > 6" class="model-menu-search">
                <i class="bi bi-search" aria-hidden="true"></i>
                <input
                  v-model="modelSearch"
                  type="text"
                  placeholder="搜索模型名称"
                  autocomplete="off"
                />
                <button
                  v-if="modelSearch"
                  type="button"
                  aria-label="清空模型搜索"
                  title="清空"
                  @click="modelSearch = ''"
                >
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>
              <div class="model-menu-options">
                <button
                  v-for="model in filteredGenerationModels"
                  :key="`${model.source}:${model.model}`"
                  type="button"
                  :class="{ active: generationModel === model.model }"
                  :title="model.label"
                  @click="selectGenerationModel(model)"
                >
                  <span class="model-mark"><i class="bi bi-stars"></i></span>
                  <span class="model-copy">
                    <strong>{{ model.label }}</strong>
                    <ModelPointPrice :model="model" :per-image="mode === 'image'" compact />
                  </span>
                  <i v-if="generationModel === model.model" class="bi bi-check-lg menu-check"></i>
                </button>
                <p v-if="!filteredGenerationModels.length" class="skill-empty">
                  {{ modelSearch ? '没有匹配的模型' : '后台暂未提供可用模型' }}
                </p>
              </div>
            </section>
          </Transition>

          <Transition name="composer-pop">
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
              </header>
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
                  <i class="bi bi-box"></i><span>{{ generationModelLabel }}</span>
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
                <p>当前模型：{{ generationModelLabel }}</p>
                <button
                  v-for="model in generationModels"
                  :key="`${model.source}:${model.model}`"
                  type="button"
                  :class="{ active: generationModel === model.model }"
                  @click="selectGenerationModel(model)"
                >
                  <span class="model-mark"><i class="bi bi-stars"></i></span>
                  <span class="model-copy">
                    <strong>{{ model.label }}</strong>
                    <ModelPointPrice :model="model" per-image compact />
                    <small>{{ model.description }}</small>
                  </span>
                  <i v-if="generationModel === model.model" class="bi bi-check-lg menu-check"></i>
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
          </Transition>

          <Transition name="composer-pop">
            <section
              v-if="composerExtensionsEnabled && skillMenuOpen"
              class="composer-popover skill-menu"
            >
              <div class="skill-search-row">
                <i class="bi bi-search"></i>
                <input v-model="skillSearch" type="text" placeholder="搜索技能" />
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
          </Transition>

          <section
            v-if="composerExtensionsEnabled && inlineMenuType"
            class="inline-trigger-menu"
            :class="[`is-${inlineMenuType}`, { 'is-flipped': inlineMenuPosition.flipped }]"
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
              'is-uploading': isUploadingReferences,
              'is-expanded': referenceDockExpanded,
            }"
            @mouseleave="collapseReferenceDock"
          >
            <button
              v-if="!referenceImages.length && !uploadingReferenceCount"
              class="composer-attachment"
              type="button"
              :title="attachmentLabel"
              :aria-label="attachmentLabel"
              @click="openReferencePickerFromDock"
            >
              <i class="bi bi-plus-lg"></i>
            </button>
            <TransitionGroup v-else name="reference-pop" appear>
              <figure
                v-for="(image, imageIndex) in referenceImages"
                :key="image.id"
                class="reference-card"
                :style="{
                  '--reference-index': imageIndex,
                  '--reference-count': referenceImages.length,
                }"
                @mouseenter="expandReferenceDock"
                @focusin="expandReferenceDock"
              >
                <img
                  :src="image.dataUrl"
                  :alt="image.name || `参考图 ${imageIndex + 1}`"
                  loading="eager"
                  decoding="async"
                />
                <button
                  type="button"
                  title="移除参考图"
                  aria-label="移除参考图"
                  @click="removeReferenceImage(image.id)"
                >
                  <i class="bi bi-x"></i>
                </button>
              </figure>
              <span
                v-for="skeletonIndex in uploadingReferenceCount"
                :key="`reference-skeleton-${skeletonIndex}`"
                class="reference-card reference-skeleton"
                :style="{
                  '--reference-index': referenceImages.length + skeletonIndex - 1,
                  '--reference-count': referenceImages.length + uploadingReferenceCount,
                }"
                aria-hidden="true"
              ></span>
            </TransitionGroup>
            <button
              v-if="referenceImages.length && referenceImages.length < 4 && !isUploadingReferences"
              class="reference-add-more"
              type="button"
              title="继续添加参考图"
              aria-label="继续添加参考图"
              :style="{ '--reference-count': referenceImages.length }"
              @click="openReferencePickerFromDock"
            >
              <i class="bi bi-plus-lg"></i>
            </button>
          </div>
          <Transition name="chip-slide">
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
          </Transition>
          <Transition name="chip-slide">
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
          </Transition>
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
          <Transition name="counter-rise">
            <div
              v-if="draftLength > 10000"
              class="draft-counter"
              :class="{ 'is-over': draftLength > 12000 }"
            >
              {{ draftLength.toLocaleString() }} / 12,000
            </div>
          </Transition>
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
                <i class="bi bi-box"></i><span>{{ generationModelLabel }}</span
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
                class="composer-tool-button image-model-button"
                type="button"
                :class="{ active: modelMenuOpen }"
                @click.stop="toggleImageModelMenu"
              >
                <i class="bi bi-cpu"></i><span>{{ generationModelLabel }}</span>
                <i class="bi bi-chevron-down"></i>
              </button>
              <button
                v-if="mode !== 'image'"
                class="composer-tool-button"
                type="button"
                :class="{ active: skillMenuOpen || selectedSkill }"
                :disabled="!composerExtensionsEnabled"
                title="暂未开放"
                aria-label="使用技能，暂未开放"
                @click.stop="toggleComposerPanel('skills')"
              >
                <i class="bi bi-wrench-adjustable"></i><span>使用技能</span>
              </button>
              <button
                class="composer-tool-button is-mention"
                type="button"
                :disabled="!composerExtensionsEnabled"
                title="暂未开放"
                :aria-label="`${mode === 'image' ? '使用技能' : '添加主体'}，暂未开放`"
                @click="insertComposerTrigger(mode === 'image' ? '/' : '@')"
              >
                <i v-if="mode === 'image'" class="bi bi-fonts"></i>
                <span v-else>@</span>
              </button>
              <button
                v-if="mode === 'image'"
                class="composer-tool-button is-mention"
                type="button"
                :disabled="!composerExtensionsEnabled"
                title="暂未开放"
                aria-label="添加主体，暂未开放"
                @click="insertComposerTrigger('@')"
              >
                @
              </button>
            </div>
            <button
              v-if="isGenerating"
              class="send-button stop-button"
              :class="{ 'is-stopping': isStopping }"
              type="button"
              :title="isStopping ? '正在停止' : '停止生成'"
              :aria-label="isStopping ? '正在停止' : '停止生成'"
              :disabled="isStopping"
              @click="stopGeneration()"
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
            <input v-model="assetSearch" type="text" placeholder="搜索图片资产" />
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
            <img :src="asset.dataUrl" :alt="asset.label" loading="lazy" decoding="async" />
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
        <span class="dialog-icon is-danger">
          <i :class="pendingDeleteHasActiveRun ? 'bi bi-stop-circle' : 'bi bi-trash3'"></i>
        </span>
        <div>
          <h2 id="delete-dialog-title">
            {{ pendingDeleteHasActiveRun ? '停止任务并删除对话？' : '删除这个对话？' }}
          </h2>
          <p v-if="pendingDeleteHasActiveRun">
            “{{
              pendingDeleteConversation.title
            }}”仍在处理中。继续操作会先停止任务，再永久删除对话和已生成内容。
          </p>
          <p v-else>“{{ pendingDeleteConversation.title }}”及其中的消息将被永久删除。</p>
        </div>
        <div class="dialog-actions">
          <button type="button" @click="pendingDeleteId = ''">取消</button>
          <button
            type="button"
            class="is-danger"
            @click="deleteConversation(pendingDeleteConversation.id)"
          >
            {{ pendingDeleteHasActiveRun ? '停止任务并删除' : '删除' }}
          </button>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="conversationPeek"
        class="assistant-conversation-peek"
        :class="{ 'is-dark': appearanceStore.isDark }"
        :style="{ top: `${conversationPeek.top}px` }"
        aria-hidden="true"
      >
        <strong>{{ conversationPeek.conversation.title }}</strong>
        <p
          v-for="(line, index) in conversationPeekLines(conversationPeek.conversation)"
          :key="index"
        >
          <b>{{ line.role === 'user' ? '我' : 'AI' }}</b
          >{{ line.text }}
        </p>
        <small>{{ formatTime(conversationPeek.conversation.updatedAt) }}</small>
      </div>
    </Teleport>
    <AssistantImageViewer
      :image="selectedImage"
      @close="closeImagePreview"
      @step="stepImagePreview"
      @download="(image) => downloadImage(image, image.index || 0)"
    />
  </div>
</template>
