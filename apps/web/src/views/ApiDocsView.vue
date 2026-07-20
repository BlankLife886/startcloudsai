<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAuthStore } from '@/stores/auth'
import { formatUsd } from '@/features/pricing/pricingMoney.js'

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['navigate-section'])

const router = useRouter()
const runtimeConfigStore = useRuntimeConfigStore()
const authStore = useAuthStore()

const rootRef = ref(null)
const sidebarRef = ref(null)
const navCardRef = ref(null)

const copiedKey = ref('')
const activeSection = ref('overview')
const activeExample = ref('curl')
const activeSdkGroup = ref('openai')
const expandedTool = ref('cc-switch')
const expandedFaq = ref(0)
const activeToolPlatform = ref('macos')
const activeToolFilter = ref('all')
const toolPlatformOptions = [
  { id: 'macos', label: 'macOS / Linux' },
  { id: 'windows', label: 'Windows' },
]
const toolFilterOptions = [
  { id: 'all', label: '全部工具' },
  { id: 'agent', label: 'Agent CLI' },
  { id: 'manager', label: '配置管理' },
  { id: 'ide', label: 'IDE / 插件' },
  { id: 'client', label: '桌面客户端' },
]
let copyTimer = null
let sectionObserver = null
let sidebarScrollTarget = null
let sidebarScrollHandler = null
let sidebarResizeHandler = null

/* ---------- 基础地址 ---------- */

const baseUrl = computed(() => {
  const raw = String(runtimeConfigStore.config?.endpoints?.openAiBaseUrl || '/v1').trim() || '/v1'
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '')
  if (typeof window === 'undefined') return raw
  return `${window.location.origin}${raw.startsWith('/') ? raw : `/${raw}`}`.replace(/\/+$/, '')
})

// Anthropic 原生协议挂在同一 origin 的 /v1/messages 下，所以这里只取 origin（不带 /v1）
const apiOrigin = computed(() => {
  try {
    return new URL(baseUrl.value).origin
  } catch {
    return baseUrl.value.replace(/\/v1\/?$/, '')
  }
})

/* ---------- 模型目录 ---------- */

const publicModels = computed(() => {
  const models = runtimeConfigStore.getAiModelCatalog()?.publicModels || []
  return models
    .filter((model) => model && model.status !== 'draft')
    .map((model) => ({
      id: modelApiId(model),
      label: model.label || model.publicModelKey || model.id || '公开模型',
      capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
      billingMode: billingModeLabel(model.billingMode),
      price: priceLabel(model),
    }))
    .filter((model) => model.id)
})

const sampleModelId = computed(() => publicModels.value[0]?.id || 'gpt-5.4')
const sampleModelLabel = computed(() => publicModels.value[0]?.label || 'GPT-5.4')

const openCodeTemplateModels = computed(() => {
  if (!publicModels.value.length) {
    return [{ id: sampleModelId.value, label: sampleModelLabel.value }]
  }
  return publicModels.value.map((model) => ({
    id: model.id,
    label: model.label || model.id,
  }))
})

const openCodeModelCount = computed(() => openCodeTemplateModels.value.length)

function isAnthropicModelId(modelId = '') {
  return /^claude/i.test(String(modelId))
}

function inferCursorPlusThinking(modelId = '') {
  const id = String(modelId).toLowerCase()
  if (/opus|sonnet|thinking|reasoning|gpt-5|o3|o4|-4-/.test(id)) {
    return { thinking: true, thinkingLevel: 'medium' }
  }
  return {}
}

function formatCursorPlusModelEntry(modelId, { anthropic = false } = {}) {
  const thinking = anthropic ? inferCursorPlusThinking(modelId) : {}
  const body = {
    id: modelId,
    apiModel: modelId,
    ...thinking,
  }
  const lines = JSON.stringify(body, null, 2).split('\n')
  return lines.map((line, index) => (index === 0 ? line : `          ${line}`)).join('\n')
}

const cursorPlusOpenAiModels = computed(() =>
  openCodeTemplateModels.value.filter((model) => !isAnthropicModelId(model.id)),
)

const cursorPlusAnthropicModels = computed(() =>
  openCodeTemplateModels.value.filter((model) => isAnthropicModelId(model.id)),
)

const cursorPlusModelCount = computed(() => openCodeTemplateModels.value.length)

const cursorPlusOpenAiModelsJson = computed(() => {
  const models = cursorPlusOpenAiModels.value
  if (!models.length) {
    return formatCursorPlusModelEntry(sampleModelId.value)
  }
  return models.map((model) => formatCursorPlusModelEntry(model.id)).join(',\n')
})

const cursorPlusAnthropicModelsJson = computed(() => {
  const models = cursorPlusAnthropicModels.value
  if (!models.length) {
    return formatCursorPlusModelEntry('claude-opus-4-8', { anthropic: true })
  }
  return models.map((model) => formatCursorPlusModelEntry(model.id, { anthropic: true })).join(',\n')
})

const cursorPlusProvidersJson = computed(() => {
  const providers = []
  if (cursorPlusOpenAiModels.value.length || !cursorPlusAnthropicModels.value.length) {
    providers.push(`    {
      "id": "walleven-openai",
      "type": "openai",
      "baseUrl": "${baseUrl.value}",
      "auth": { "kind": "apiKey", "value": "${keyExample.value}" },
      "models": [
${cursorPlusOpenAiModelsJson.value}
      ]
    }`)
  }
  if (cursorPlusAnthropicModels.value.length) {
    providers.push(`    {
      "id": "walleven-anthropic",
      "type": "anthropic",
      "baseUrl": "${apiOrigin.value}",
      "auth": { "kind": "apiKey", "value": "${keyExample.value}" },
      "models": [
${cursorPlusAnthropicModelsJson.value}
      ]
    }`)
  }
  return `{
  "providers": [
${providers.join(',\n')}
  ]
}`
})

const sampleClaudeModelId = computed(() => {
  if (cursorPlusAnthropicModels.value.length) return cursorPlusAnthropicModels.value[0].id
  const fallback = publicModels.value.find((model) => isAnthropicModelId(model.id))
  return fallback?.id || 'claude-opus-4-8'
})

const sampleClaudeModelLabel = computed(() => {
  const match = openCodeTemplateModels.value.find((model) => model.id === sampleClaudeModelId.value)
  return match?.label || sampleClaudeModelId.value
})

const claudeCodeModelCount = computed(() => cursorPlusAnthropicModels.value.length)

const claudeCodeAvailableModelsArrayJson = computed(() => {
  const ids = cursorPlusAnthropicModels.value.map((model) => model.id)
  if (!ids.length) return '["claude-opus-4-8"]'
  return JSON.stringify(ids)
})

const claudeCodeSettingsJson = computed(
  () => `{
  "env": {
    "ANTHROPIC_BASE_URL": "${apiOrigin.value}",
    "ANTHROPIC_AUTH_TOKEN": "${keyExample.value}",
    "ANTHROPIC_MODEL": "${sampleClaudeModelId.value}",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1",
    "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING": "1"
  },
  "model": "${sampleClaudeModelId.value}",
  "availableModels": ${claudeCodeAvailableModelsArrayJson.value}
}`,
)

const claudeCodeSettingsSharedJson = computed(
  () => `{
  "env": {
    "ANTHROPIC_BASE_URL": "${apiOrigin.value}",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1",
    "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING": "1"
  },
  "model": "${sampleClaudeModelId.value}",
  "availableModels": ${claudeCodeAvailableModelsArrayJson.value}
}`,
)

const claudeCodeSettingsLocalJson = computed(
  () => `{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "${keyExample.value}",
    "ANTHROPIC_MODEL": "${sampleClaudeModelId.value}"
  }
}`,
)

const codexOpenAiModels = computed(() => cursorPlusOpenAiModels.value)

const codexModelCount = computed(() => codexOpenAiModels.value.length)

const codexSampleModelId = computed(() => {
  if (codexOpenAiModels.value.length) return codexOpenAiModels.value[0].id
  if (!isAnthropicModelId(sampleModelId.value)) return sampleModelId.value
  return 'gpt-5.4'
})

function formatCodexProfileSlug(modelId = '') {
  return (
    String(modelId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  )
}

const codexProfilesToml = computed(() => {
  const models = codexOpenAiModels.value
  if (!models.length) {
    return `[profiles.${formatCodexProfileSlug(codexSampleModelId.value)}]
model_provider = "walleven"
model = "${codexSampleModelId.value}"`
  }
  return models
    .map(
      (model) => `[profiles.${formatCodexProfileSlug(model.id)}]
model_provider = "walleven"
model = "${model.id}"`,
    )
    .join('\n\n')
})

const codexConfigToml = computed(
  () => `model = "${codexSampleModelId.value}"
model_provider = "walleven"

[model_providers.walleven]
name = "StarCloudIsAI"
base_url = "${baseUrl.value}"
env_key = "WALLEVEN_API_KEY"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 4
stream_max_retries = 5
stream_idle_timeout_ms = 300000`,
)

const codexConfigFullToml = computed(() => `${codexConfigToml.value}

${codexProfilesToml.value}`)

const codexAuthEnvToml = computed(
  () => `# 可选：写入 ~/.codex/auth.toml（勿提交 git）
[walleven]
api_key = "${keyExample.value}"`,
)

function inferOpenCodeModelProfile(modelId = '') {
  const id = String(modelId).toLowerCase()
  if (/mini|nano|fast|haiku|flash|small/.test(id)) return 'compact'
  if (/codex|reasoning|-thinking|o3|o4|gpt-5\.[34]|gpt-5-[34]/.test(id)) return 'reasoning'
  if (/claude|gemini|gpt|vision|opus|sonnet/.test(id)) return 'vision'
  return 'chat'
}

function openCodeModelLimits(profile) {
  if (profile === 'reasoning') return { context: 400000, output: 128000 }
  if (profile === 'compact') return { context: 128000, output: 32000 }
  if (profile === 'vision') return { context: 200000, output: 64000 }
  return { context: 128000, output: 32000 }
}

function buildOpenCodeModelBody(modelId, label) {
  const profile = inferOpenCodeModelProfile(modelId)
  const body = {
    name: label,
    limit: openCodeModelLimits(profile),
    options: {
      parallel_tool_calls: true,
      store: false,
    },
    modalities: {
      input: profile === 'chat' ? ['text'] : ['text', 'image'],
      output: ['text'],
    },
  }
  if (profile === 'reasoning') body.variants = {
    xhigh: { reasoningEffort: 'xhigh', reasoningSummary: 'auto' },
    high: { reasoningEffort: 'high', reasoningSummary: 'auto' },
    medium: { reasoningEffort: 'medium', reasoningSummary: 'auto' },
    low: { reasoningEffort: 'low', reasoningSummary: 'auto' },
  }
  return body
}

function formatOpenCodeModelEntry(modelId, label) {
  const lines = JSON.stringify(buildOpenCodeModelBody(modelId, label), null, 2).split('\n')
  const inner = lines.map((line, index) => (index === 0 ? line : `        ${line}`)).join('\n')
  return `        "${modelId}": ${inner}`
}

const openCodeModelsJson = computed(() =>
  openCodeTemplateModels.value.map((model) => formatOpenCodeModelEntry(model.id, model.label)).join(',\n'),
)

const keyPrefix = computed(() => 'sk')
const keyFormatHint = computed(() => `${keyPrefix.value}_xxx`)
const keyExample = computed(() => `${keyPrefix.value}_xxxxxxxxxxxxxxxx`)

/* ---------- 目录导航 ---------- */

const navSections = [
  { id: 'overview', label: '概览', icon: 'bi-compass' },
  { id: 'quickstart', label: '快速开始', icon: 'bi-rocket-takeoff' },
  { id: 'auth', label: '鉴权', icon: 'bi-shield-lock' },
  { id: 'endpoints', label: 'API 端点', icon: 'bi-diagram-3' },
  { id: 'models', label: '可用模型', icon: 'bi-cpu' },
  { id: 'tools', label: '工具接入', icon: 'bi-terminal' },
  { id: 'sdk', label: 'SDK 与 HTTP 示例', icon: 'bi-code-slash' },
  { id: 'errors', label: '错误码', icon: 'bi-exclamation-triangle' },
  { id: 'billing', label: '计费与限额', icon: 'bi-receipt' },
  { id: 'faq', label: 'FAQ', icon: 'bi-question-circle' },
]

/* ---------- 快速开始 ---------- */

const quickSteps = computed(() => [
  {
    title: '注册并登录账号',
    body: authStore.isAuthenticated
      ? '你已登录，可以直接进入下一步创建 API Key。'
      : '中转站 API Key 与你的账号绑定，先注册或登录后才能创建 Key。',
    link: authStore.isAuthenticated ? '' : '/auth?mode=register',
    linkLabel: '去注册 / 登录',
  },
  {
    title: '创建 API Key',
    body: '在价格控制台的「API 密钥」分区创建 Key（格式如 sk_xxx，前缀可在后台配置）。创建时可设置接口范围（对话 / 图片 / 向量 / 音频）、模型白名单、IP 白名单与每日/每月预算。Key 只完整显示一次，请立即保存。',
    link: '/pricing?section=keys',
    linkLabel: '去创建 API Key',
  },
  {
    title: '选择模型',
    body: '调用 GET /models 或查看本页「可用模型」表，把表中的「调用 ID」填进请求的 model 参数即可。',
    link: '/pricing?section=models',
    linkLabel: '查看模型价格',
  },
  {
    title: '接入 AI 编程工具',
    body: 'Claude Code（Anthropic 原生）、Codex（Responses API）、OpenCode（OpenAI 兼容）均可完整 Agent。不想手改配置文件时，可用 CC Switch 一键写入并切换 Provider。',
    link: '#tools',
    linkLabel: '查看工具接入指南',
  },
  {
    title: '发起第一个请求',
    body: `OpenAI 兼容工具填 Base URL ${baseUrl.value}；Claude Code 填 origin ${apiOrigin.value}。同一 Key 通用，模型 ID 见「可用模型」表。`,
    link: '',
    linkLabel: '',
  },
])

/* ---------- 端点表 ---------- */

const openAiEndpoints = [
  { method: 'GET', path: '/models', scope: '任意有效 Key', note: '列出当前 Key 可调用的全部模型' },
  { method: 'POST', path: '/chat/completions', scope: 'ai.chat / ai.all', note: '对话补全，支持 stream 流式与工具调用' },
  { method: 'POST', path: '/responses', scope: 'ai.responses / ai.chat / ai.all', note: 'Responses 兼容层，内部转为对话调用（非完整 Responses API）' },
  { method: 'POST', path: '/images/generations', scope: 'ai.images / ai.all', note: '文生图' },
  { method: 'POST', path: '/images/edits', scope: 'ai.images / ai.all', note: '图片编辑，支持 multipart 上传' },
  { method: 'POST', path: '/embeddings', scope: 'ai.embeddings / ai.all', note: '文本向量化' },
  { method: 'POST', path: '/audio/speech', scope: 'ai.audio / ai.all', note: '文本转语音，返回音频二进制' },
  { method: 'POST', path: '/audio/transcriptions', scope: 'ai.audio / ai.all', note: '语音转文字，multipart 上传音频' },
]

const anthropicEndpoints = [
  { method: 'POST', path: '/v1/messages', scope: 'ai.chat / ai.all', note: 'Anthropic Messages 原生协议，支持流式与工具调用' },
  {
    method: 'POST',
    path: '/v1/messages/count_tokens',
    scope: 'ai.chat / ai.all',
    note: '本地字符启发式估算 token（非上游精确计数）',
  },
]

/* ---------- 编辑器与 CLI 工具卡片 ---------- */

const integrationMatrix = computed(() => [
  {
    tool: 'Claude Code',
    category: 'agent',
    protocol: 'Anthropic',
    baseUrl: apiOrigin.value,
    endpoint: '/v1/messages',
    models: 'Claude 系',
    agent: '完整 Agent',
    tier: 'full',
  },
  {
    tool: 'Codex CLI / App',
    category: 'agent',
    protocol: 'Responses',
    baseUrl: baseUrl.value,
    endpoint: '/responses',
    models: 'GPT / Gemini 等',
    agent: '完整 Agent',
    tier: 'full',
  },
  {
    tool: 'OpenCode',
    category: 'agent',
    protocol: 'OpenAI 兼容',
    baseUrl: baseUrl.value,
    endpoint: '/chat/completions',
    models: '全部公开模型',
    agent: '完整 Agent',
    tier: 'full',
  },
  {
    tool: 'CC Switch',
    category: 'manager',
    protocol: '多协议',
    baseUrl: '按目标工具',
    endpoint: '自动写入',
    models: '按 Provider 配置',
    agent: '管理配置',
    tier: 'manager',
  },
  {
    tool: 'Cursor++',
    category: 'ide',
    protocol: 'OpenAI + Anthropic',
    baseUrl: '双通道',
    endpoint: '本地拦截',
    models: 'Claude + GPT',
    agent: '部分（实验）',
    tier: 'partial',
  },
  {
    tool: 'Cline / Continue',
    category: 'ide',
    protocol: 'OpenAI 兼容',
    baseUrl: baseUrl.value,
    endpoint: '/chat/completions',
    models: 'OpenAI 兼容模型',
    agent: '完整 Agent',
    tier: 'full',
  },
])

const toolCards = computed(() => [
  {
    id: 'cc-switch',
    name: 'CC Switch',
    icon: 'bi-sliders2',
    category: 'manager',
    tier: 'manager',
    tierLabel: '配置中枢',
    featured: true,
    protocol: '多协议',
    tagline: '桌面 GUI 统一管理 Claude Code、Codex、OpenCode 等 Provider',
    usePlatformTabs: true,
    steps: [],
    blocks: [],
    note: '第三方开源工具（farion1231/cc-switch）。启用 Provider 后会原子写入各工具 live 配置。StarCloudIsAI 已有原生 /v1/messages 与 /v1/responses，一般无需开启「本地路由映射」。与手写 config 二选一为主，避免互相覆盖。',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'bi-braces-asterisk',
    category: 'agent',
    tier: 'full',
    tierLabel: '完整 Agent',
    featured: true,
    protocol: 'Anthropic 原生',
    tagline: 'Anthropic 官方终端 Agent，走 /v1/messages 原生协议',
    usePlatformTabs: true,
    steps: [],
    blocks: [],
    note: '本站已实现 Anthropic Messages 原生入口（/v1/messages），与 OpenAI 兼容入口共用计费与路由。Claude Code 仅适合 Claude 系模型；GPT 请用 Codex / OpenCode。Base URL 填 origin（不带 /v1、不带末尾斜杠）。官方网关发现只收录 ID 以 claude / anthropic 开头的模型。',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: 'bi-terminal-fill',
    category: 'agent',
    tier: 'full',
    tierLabel: '完整 Agent',
    featured: true,
    protocol: 'OpenAI Responses',
    tagline: 'OpenAI 官方终端 Agent（CLI / IDE 插件 / 桌面 App 共用 config.toml）',
    usePlatformTabs: true,
    steps: [],
    blocks: [],
    note: 'Codex 2026 年起仅支持 wire_api = "responses"。CLI、VS Code/Cursor 插件、桌面 App 共用 ~/.codex/config.toml；App/IDE 需额外写 ~/.codex/.env 存放 Key。适合 GPT / Gemini；Claude 请用 Claude Code。',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: 'bi-window-stack',
    category: 'agent',
    tier: 'full',
    tierLabel: '完整 Agent',
    featured: true,
    protocol: 'OpenAI 兼容',
    tagline: '开源终端 AI 编程助手，本地直连，全模型 Agent',
    usePlatformTabs: true,
    steps: [],
    blocks: [],
    note: '下方配置已包含本页「可用模型」全部条目；apiKey 换成你的 sk_xxx。若已有 opencode.jsonc，合并 walleven 段并确保 disabled_providers 不含 walleven。本地 8787 开发首选。',
  },
  {
    id: 'cursor-plus',
    name: 'Cursor++',
    icon: 'bi-patch-plus-fill',
    category: 'ide',
    tier: 'partial',
    tierLabel: '实验性',
    protocol: 'OpenAI + Anthropic',
    tagline: '第三方 BYOK 补丁，在 Cursor 里接中转站（非官方）',
    usePlatformTabs: true,
    steps: [],
    blocks: [],
    note: 'Cursor++（@cometix/ccursor）会 patch Cursor 并本地转发 AI 请求。Claude 走 Anthropic 通道（origin）；GPT 走 OpenAI 通道（/v1）。需 LinuxDO 登录；Network 改 HTTP/1.1。Tab 补全仍可能走 Cursor 内置模型。',
  },
  {
    id: 'cline',
    name: 'Cline / Roo Code',
    icon: 'bi-robot',
    category: 'ide',
    tier: 'full',
    tierLabel: '完整 Agent',
    protocol: 'OpenAI 兼容',
    tagline: 'VS Code 智能体插件，选 OpenAI Compatible 即可',
    steps: [
      '在 VS Code 扩展市场安装 Cline（或 Roo Code），打开插件设置。',
      'API Provider 选择 OpenAI Compatible。',
      'Base URL 填中转站地址，API Key 填 sk_xxx，Model ID 填模型调用 ID。',
      '保存后即可在对话面板使用；Roo Code 还可为不同模式分别绑定不同模型。',
    ],
    blocks: [
      {
        title: '需要填写的值',
        code: `API Provider: OpenAI Compatible
Base URL:     ${baseUrl.value}
API Key:      ${keyExample.value}
Model ID:     ${sampleModelId.value}`,
      },
    ],
    note: '走 /chat/completions，支持工具调用与流式。Claude 模型也可通过 OpenAI 兼容通道调用（由网关翻译）。',
  },
  {
    id: 'continue',
    name: 'Continue',
    icon: 'bi-fast-forward-fill',
    category: 'ide',
    tier: 'full',
    tierLabel: '完整 Agent',
    protocol: 'OpenAI 兼容',
    tagline: 'VS Code / JetBrains 开源助手，config.yaml 配置',
    steps: [
      '安装 Continue 插件后，打开配置文件（~/.continue/config.yaml）。',
      '在 models 列表里添加一个 provider 为 openai 的条目，apiBase 指向中转站。',
      '保存后在 Continue 面板的模型下拉框中选择该模型。',
    ],
    blocks: [
      {
        title: '~/.continue/config.yaml',
        code: `models:
  - name: ${sampleModelLabel.value}
    provider: openai
    model: ${sampleModelId.value}
    apiBase: ${baseUrl.value}
    apiKey: ${keyExample.value}
    roles:
      - chat
      - edit
      - apply`,
      },
    ],
    note: '',
  },
  {
    id: 'zed',
    name: 'Zed',
    icon: 'bi-lightning-charge-fill',
    category: 'ide',
    tier: 'full',
    tierLabel: '完整 Agent',
    protocol: 'OpenAI 兼容',
    tagline: '高性能编辑器，settings.json 配置 OpenAI 接口地址',
    steps: [
      '打开 Zed 的 settings.json（⌘ + , → Open Settings）。',
      '在 language_models.openai 下设置 api_url 为中转站地址，并在 available_models 列出模型。',
      '打开 Agent 面板设置，在 OpenAI 提供方处填入你的中转站 Key，然后在模型下拉框选择。',
    ],
    blocks: [
      {
        title: 'Zed settings.json',
        code: `{
  "language_models": {
    "openai": {
      "api_url": "${baseUrl.value}",
      "available_models": [
        {
          "name": "${sampleModelId.value}",
          "display_name": "${sampleModelLabel.value}",
          "max_tokens": 128000
        }
      ]
    }
  }
}`,
      },
    ],
    note: '',
  },
  {
    id: 'chatbox',
    name: 'Chatbox / Cherry Studio',
    icon: 'bi-chat-dots-fill',
    category: 'client',
    tier: 'chat',
    tierLabel: '对话客户端',
    protocol: 'OpenAI 兼容',
    tagline: '桌面聊天客户端，添加自定义提供方',
    steps: [
      'Chatbox：设置 → 模型提供方 → 添加自定义提供方，API 模式选「OpenAI API 兼容」。',
      'Cherry Studio：设置 → 模型服务 → 添加，提供商类型选 OpenAI。',
      'API 域名 / 地址填中转站 Base URL，API 密钥填 sk_xxx。',
      '在模型列表里手动添加模型调用 ID（或点击「获取模型列表」自动拉取），保存即可使用。',
    ],
    blocks: [
      {
        title: '需要填写的值',
        code: `API 类型 / 提供商: OpenAI（兼容）
API 域名:          ${baseUrl.value}
API 密钥:          ${keyExample.value}
模型:              ${sampleModelId.value}`,
      },
    ],
    note: '部分客户端会自动在域名后拼 /v1，如遇 404 可尝试只填 origin 或开启「忽略 v1 路径」选项。',
  },
])

const filteredToolCards = computed(() => {
  const filter = activeToolFilter.value
  if (filter === 'all') return toolCards.value
  return toolCards.value.filter((tool) => tool.category === filter)
})

const openCodeConfigJson = computed(
  () => `{
  "$schema": "https://opencode.ai/config.json",
  "model": "walleven/${sampleModelId.value}",
  "provider": {
    "walleven": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "StarCloudIsAI",
      "options": {
        "baseURL": "${baseUrl.value}",
        "apiKey": "${keyExample.value}"
      },
      "models": {
${openCodeModelsJson.value}
      }
    }
  }
}`,
)

const toolPlatformGuides = computed(() => ({
  'cc-switch': {
    macos: {
      configPath: 'CC Switch 写入各工具 live 配置（见下方说明）',
      openDirCode: '# 安装后从应用程序启动 CC Switch\nopen -a "CC Switch" 2>/dev/null || true',
      steps: [
        {
          text: 'CC Switch 是第三方桌面工具，统一管理 Claude Code、Codex、OpenCode、Gemini CLI 等的 Provider，切换时自动写入对应配置文件。GitHub: farion1231/cc-switch',
        },
        {
          text: '安装：从 GitHub Releases 下载 macOS 版，或使用 Homebrew（若提供 cask）。安装后打开 CC Switch。',
        },
        {
          text: 'Claude Code 标签页 → + 添加供应商 → 自定义：',
          code: `名称:     StarCloudIsAI
API Key:  ${keyExample.value}
Base URL: ${apiOrigin.value}
API 格式: Anthropic Messages
模型:     ${sampleClaudeModelId.value}
本地路由: 关闭（StarCloudIsAI 已有 /v1/messages）`,
        },
        {
          text: 'Codex 标签页 → + 添加供应商 → 自定义（wire_api 固定为 responses，UI 不可改）：',
          code: `名称:     StarCloudIsAI
API Key:  ${keyExample.value}
Base URL: ${baseUrl.value}
模型:     ${codexSampleModelId.value}
本地路由: 关闭（StarCloudIsAI 已有 /v1/responses）`,
        },
        {
          text: 'OpenCode 标签页可同样添加；或继续用手写 opencode.jsonc（二选一，避免 CC Switch 覆盖手写配置）。',
        },
        {
          text: '保存后点击「启用」。Claude Code 可热切换；Codex / OpenCode 需重启对应工具。系统托盘可快速切换 Provider。',
        },
      ],
      blocks: [
        {
          title: 'StarCloudIsAI × CC Switch 对照表',
          code: `工具          Base URL              API 格式              重启
Claude Code   ${apiOrigin.value}   Anthropic Messages   否
Codex         ${baseUrl.value}     Responses (固定)     是
OpenCode      ${baseUrl.value}     OpenAI Compatible    是`,
        },
        {
          title: '启用后 CC Switch 会写入',
          code: `Claude Code → ~/.claude/settings.json
Codex       → ~/.codex/config.toml
OpenCode    → ~/.config/opencode/opencode.jsonc`,
        },
      ],
    },
    windows: {
      configPath: 'CC Switch 写入各工具 live 配置',
      openDirCode: 'Start-Process "CC Switch" -ErrorAction SilentlyContinue',
      steps: [
        {
          text: '从 GitHub Releases 下载 Windows 安装包并安装 CC Switch。',
        },
        {
          text: 'Claude Code → 自定义 Provider：Base URL = origin，格式 Anthropic Messages，模型填 Claude 调用 ID，关闭本地路由。',
        },
        {
          text: 'Codex → 自定义 Provider：Base URL = /v1 地址，模型填 GPT 调用 ID，关闭本地路由，启用后重启 codex。',
        },
        {
          text: '启用 Provider 后检查 %USERPROFILE%\\.codex\\config.toml 与 .claude\\settings.json 是否已更新。',
        },
      ],
      blocks: [
        {
          title: 'StarCloudIsAI × CC Switch 对照表',
          code: `Claude Code: ${apiOrigin.value} + Anthropic Messages
Codex:       ${baseUrl.value} + Responses
OpenCode:    ${baseUrl.value} + OpenAI Compatible`,
        },
      ],
    },
  },
  'cursor-plus': {
    macos: {
      configPath: '~/.ccursor/providers.json',
      openDirCode: 'mkdir -p "$HOME/.ccursor" && open "$HOME/.ccursor"',
      steps: [
        {
          text: '安装 Cursor++（会安装扩展并 patch Cursor.app，需已安装 Cursor）：',
          code: `npx @cometix/ccursor@latest install

# 查看状态 / 卸载
npx @cometix/ccursor status
npx @cometix/ccursor uninstall`,
        },
        {
          text: '完全退出 Cursor 后重新打开。侧边栏或扩展面板点击「登录 Cursor++」，按提示完成 LinuxDO Connect 授权。',
        },
        {
          text: '打开 Cursor Settings → Network，将 HTTP Compatibility Mode 改为 HTTP/1.1（Cursor++ 目前主要拦截 HTTP/1.1 流量）：',
          code: 'Cursor Settings → Network → HTTP Compatibility Mode → HTTP/1.1',
        },
        {
          text: '不要开启官方 Models 里的 Override OpenAI Base URL——由 Cursor++ 接管路由。状态栏打开 BYOK Mode（开启后请求走你配置的 Provider）。',
        },
        {
          text: '方式 A：复制下方 providers.json 到 ~/.ccursor/providers.json，把 auth.value 换成你的 Key 后保存：',
        },
        {
          text: '方式 B：在 Cursor++ 侧边栏手动添加 Provider——OpenAI 通道 Base URL 填本站 /v1 地址，Anthropic 通道填 origin（不带 /v1）；Key 填 sk_xxx；再逐个添加模型调用 ID。',
        },
        {
          text: '先用 curl 验证 Key 与模型可见（与 Cursor++ 无关，但可快速排除网关问题）：',
          code: `curl -sS ${baseUrl.value}/models \\
  -H "Authorization: Bearer ${keyExample.value}" | head

curl -sS ${baseUrl.value}/chat/completions \\
  -H "Authorization: Bearer ${keyExample.value}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${sampleModelId.value}","messages":[{"role":"user","content":"ping"}]}'`,
        },
        {
          text: '在 Cursor 聊天面板选择 Cursor++ 里配置的模型，先用 Ask / Chat 测通，再试 Agent / Composer。若报 tools / MCP 相关错误，暂时关闭多余 MCP Server。',
        },
      ],
      blocks: [
        {
          title: `providers.json · OpenAI ${cursorPlusOpenAiModels.value.length} + Anthropic ${cursorPlusAnthropicModels.value.length} 模型`,
          code: cursorPlusProvidersJson.value,
        },
        {
          title: '侧边栏手动配置（等价字段）',
          code: `# OpenAI 通道（GPT / Gemini 等）
Provider type: openai
Base URL:      ${baseUrl.value}
API Key:       ${keyExample.value}
Model ID:      ${cursorPlusOpenAiModels.value[0]?.id || sampleModelId.value}

# Anthropic 通道（Claude 系列，走 /v1/messages 原生协议）
Provider type: anthropic
Base URL:      ${apiOrigin.value}
API Key:       ${keyExample.value}
Model ID:      ${cursorPlusAnthropicModels.value[0]?.id || 'claude-opus-4-8'}`,
        },
      ],
    },
    windows: {
      configPath: '%USERPROFILE%\\.ccursor\\providers.json',
      openDirCode: 'explorer (Join-Path $env:USERPROFILE ".ccursor")',
      steps: [
        {
          text: '在 PowerShell 安装 Cursor++（需已安装 Cursor）：',
          code: `npx @cometix/ccursor@latest install

npx @cometix/ccursor status
npx @cometix/ccursor uninstall`,
        },
        {
          text: '完全退出 Cursor 后重新打开。扩展面板点击「登录 Cursor++」，完成 LinuxDO Connect 授权。',
        },
        {
          text: 'Cursor Settings → Network → HTTP Compatibility Mode → HTTP/1.1。',
        },
        {
          text: '不要开启官方 Override OpenAI Base URL。状态栏开启 BYOK Mode。',
        },
        {
          text: '复制下方 providers.json 到 %USERPROFILE%\\.ccursor\\providers.json，替换 Key 后保存；或在 Cursor++ 侧边栏按字段手动添加 Provider。',
        },
        {
          text: 'PowerShell 验证网关（可选）：',
          code: `$headers = @{ Authorization = "Bearer ${keyExample.value}" }
Invoke-RestMethod -Uri "${baseUrl.value}/models" -Headers $headers | ConvertTo-Json -Depth 3`,
        },
        {
          text: '在聊天里选已配置模型，先 Ask 再 Agent。MCP 报错时先关闭非必要 MCP。',
        },
      ],
      blocks: [
        {
          title: `providers.json · 含全部 ${cursorPlusModelCount.value} 个模型`,
          code: cursorPlusProvidersJson.value,
        },
        {
          title: '侧边栏手动配置（等价字段）',
          code: `OpenAI Base URL:     ${baseUrl.value}
Anthropic Base URL:  ${apiOrigin.value}
API Key:             ${keyExample.value}
示例 OpenAI 模型:    ${cursorPlusOpenAiModels.value[0]?.id || sampleModelId.value}
示例 Anthropic 模型: ${cursorPlusAnthropicModels.value[0]?.id || 'claude-opus-4-8'}`,
        },
      ],
    },
  },
  'claude-code': {
    macos: {
      configPath: '~/.claude/settings.json',
      openDirCode: 'mkdir -p "$HOME/.claude" && open "$HOME/.claude"',
      steps: [
        {
          text: '适配说明：Claude Code 通过 ANTHROPIC_BASE_URL 把请求发到网关的 Anthropic Messages API（/v1/messages）。本站已原生支持该协议，并支持流式、工具调用与图片输入；鉴权支持 Authorization: Bearer 与 x-api-key。仅 Claude 系模型可用，GPT 不会走此通道。',
        },
        {
          text: '安装 Claude Code（任选其一）：',
          code: `curl -fsSL https://claude.ai/install.sh | sh
# 或
npm install -g @anthropic-ai/claude-code

claude --version`,
        },
        {
          text: '在价格控制台创建 API Key（需含 ai.chat 或 ai.all scope），记下 sk_xxx。Base URL 填 origin，不要带 /v1，不要末尾斜杠：',
          code: `正确: ${apiOrigin.value}
错误: ${baseUrl.value}
错误: ${apiOrigin.value}/`,
        },
        {
          text: '先用 curl 验证 Anthropic 原生入口（通过后再配 Claude Code）：',
          code: `curl -sS ${apiOrigin.value}/v1/messages \\
  -H "Authorization: Bearer ${keyExample.value}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "${sampleClaudeModelId.value}",
    "max_tokens": 64,
    "messages": [{"role": "user", "content": "ping"}]
  }'

curl -sS ${apiOrigin.value}/v1/models \\
  -H "Authorization: Bearer ${keyExample.value}" | head`,
        },
        {
          text: '推荐：复制下方 ~/.claude/settings.json（已含当前全部 Claude 模型与网关发现）。把 ANTHROPIC_AUTH_TOKEN 换成你的 Key：',
        },
        {
          text: '团队项目可把不含 Key 的共享配置写入 .claude/settings.json（可提交 git），个人 Key 放 .claude/settings.local.json（勿提交）：',
        },
        {
          text: '或写入 shell 环境变量（写入 ~/.zshrc 后 source）：',
          code: `export ANTHROPIC_BASE_URL="${apiOrigin.value}"
export ANTHROPIC_AUTH_TOKEN="${keyExample.value}"
export ANTHROPIC_MODEL="${sampleClaudeModelId.value}"
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
export CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1

claude`,
        },
        {
          text: '启动后输入 /model 切换模型。开启 GATEWAY_MODEL_DISCOVERY 后，Claude Code 会请求 GET /v1/models，仅收录 ID 以 claude / anthropic 开头的模型。若已登录 Claude 订阅且 Key 不生效，执行 unset ANTHROPIC_API_KEY 避免与订阅冲突。',
        },
      ],
      blocks: [
        {
          title: `~/.claude/settings.json · 含 ${claudeCodeModelCount.value} 个 Claude 模型`,
          code: claudeCodeSettingsJson.value,
        },
        {
          title: '.claude/settings.json（团队共享，不含 Key）',
          code: claudeCodeSettingsSharedJson.value,
        },
        {
          title: '.claude/settings.local.json（个人 Key，勿提交 git）',
          code: claudeCodeSettingsLocalJson.value,
        },
        {
          title: '关键环境变量说明',
          code: `ANTHROPIC_BASE_URL=${apiOrigin.value}
  → Claude Code 请求 ${apiOrigin.value}/v1/messages

ANTHROPIC_AUTH_TOKEN=${keyExample.value}
  → 作为 Authorization: Bearer <token> 发送（推荐）

ANTHROPIC_API_KEY=${keyExample.value}
  → 作为 x-api-key 头发送（与 AUTH_TOKEN 二选一即可）

ANTHROPIC_MODEL=${sampleClaudeModelId.value}
  → 默认模型（调用 ID，与 GET /v1/models 一致）

CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
  → 从网关 /v1/models 拉取模型列表到 /model 选择器

CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1
  → 经第三方网关时建议开启工具参数流式回传`,
        },
      ],
    },
    windows: {
      configPath: '%USERPROFILE%\\.claude\\settings.json',
      openDirCode: 'explorer (Join-Path $env:USERPROFILE ".claude")',
      steps: [
        {
          text: '适配说明：Claude Code 走 Anthropic /v1/messages 原生协议。本站已支持流式、工具调用与图片；Key 需含 ai.chat 或 ai.all。仅 Claude 模型，GPT 请用 Codex / OpenCode。',
        },
        {
          text: '安装（PowerShell，需 Node.js 18+）：',
          code: `npm install -g @anthropic-ai/claude-code
claude --version`,
        },
        {
          text: `Base URL 填 origin（${apiOrigin.value}），不要填 ${baseUrl.value}。`,
        },
        {
          text: 'PowerShell 验证网关：',
          code: `$headers = @{
  Authorization = "Bearer ${keyExample.value}"
  "anthropic-version" = "2023-06-01"
}
$body = @{
  model = "${sampleClaudeModelId.value}"
  max_tokens = 64
  messages = @(@{ role = "user"; content = "ping" })
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "${apiOrigin.value}/v1/messages" -Method Post -Headers $headers -Body $body -ContentType "application/json"`,
        },
        {
          text: '复制下方 settings.json 到 %USERPROFILE%\\.claude\\settings.json，替换 Key 后保存。',
        },
        {
          text: 'PowerShell 临时环境变量（当前会话）：',
          code: `$env:ANTHROPIC_BASE_URL = "${apiOrigin.value}"
$env:ANTHROPIC_AUTH_TOKEN = "${keyExample.value}"
$env:ANTHROPIC_MODEL = "${sampleClaudeModelId.value}"
$env:CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1"
claude`,
        },
        {
          text: '启动后 /model 选模型。模型发现只显示 claude / anthropic 前缀的 ID。',
        },
      ],
      blocks: [
        {
          title: `settings.json · 含 ${claudeCodeModelCount.value} 个 Claude 模型`,
          code: claudeCodeSettingsJson.value,
        },
        {
          title: 'settings.local.json（个人 Key）',
          code: claudeCodeSettingsLocalJson.value,
        },
        {
          title: '关键环境变量说明',
          code: `ANTHROPIC_BASE_URL     → ${apiOrigin.value}（无 /v1、无末尾斜杠）
ANTHROPIC_AUTH_TOKEN   → Bearer ${keyExample.value}
ANTHROPIC_MODEL       → ${sampleClaudeModelId.value}
GATEWAY_MODEL_DISCOVERY → 1 开启 /v1/models 发现`,
        },
      ],
    },
  },
  codex: {
    macos: {
      configPath: '~/.codex/config.toml',
      openDirCode: 'mkdir -p "$HOME/.codex" && open "$HOME/.codex"',
      steps: [
        {
          text: '适配说明：Codex CLI（2026）只向自定义网关发 OpenAI Responses API（POST /v1/responses），wire_api = "chat" 已废弃。本站 /v1/responses 为兼容层：把 Responses 请求转为内部对话调度，并支持流式与工具调用。鉴权走 Authorization: Bearer。Claude 系模型请用 Claude Code。',
        },
        {
          text: '安装 Codex CLI（包名必须是 @openai/codex，不是 codex；需 Node.js 22+）：',
          code: `curl -fsSL https://chatgpt.com/codex/install.sh | sh
# 或
npm install -g @openai/codex

codex --version`,
        },
        {
          text: '在价格控制台创建 API Key（需 ai.responses、ai.chat 或 ai.all scope），记下 sk_xxx。Base URL 填带 /v1 的完整前缀：',
          code: `正确: ${baseUrl.value}
错误: ${apiOrigin.value}
错误: ${baseUrl.value}/`,
        },
        {
          text: '先用 curl 验证 Responses 兼容层（通过后再配 Codex）：',
          code: `curl -sS ${baseUrl.value}/responses \\
  -H "Authorization: Bearer ${keyExample.value}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${codexSampleModelId.value}",
    "input": "ping",
    "max_output_tokens": 64
  }'

curl -sS ${baseUrl.value}/models \\
  -H "Authorization: Bearer ${keyExample.value}" | head`,
        },
        {
          text: '复制下方 ~/.codex/config.toml（wire_api = responses，requires_openai_auth = false 适配 sk_ 前缀 Key）。下方 profiles 已含当前全部非 Claude 模型，可用 codex --profile <名称> 切换：',
        },
        {
          text: '导出 Key 环境变量后启动（env_key 指向 WALLEVEN_API_KEY）：',
          code: `export WALLEVEN_API_KEY="${keyExample.value}"
codex

# 切换 profile 示例
codex --profile ${formatCodexProfileSlug(codexSampleModelId.value)}`,
        },
        {
          text: '项目级配置：可在仓库 .codex/config.toml 写 model / provider（勿放 Key）；个人 Key 放 ~/.codex/auth.toml 或环境变量。Codex 会忽略项目目录里覆盖 provider 的敏感项并打印警告。',
        },
      ],
      blocks: [
        {
          title: `~/.codex/config.toml · 含 ${codexModelCount.value} 个 OpenAI 兼容模型 profile`,
          code: codexConfigFullToml.value,
        },
        {
          title: '~/.codex/auth.toml（可选，个人 Key）',
          code: codexAuthEnvToml.value,
        },
        {
          title: '关键字段说明',
          code: `base_url = "${baseUrl.value}"
  → Codex 请求 ${baseUrl.value}/responses

wire_api = "responses"
  → 2026 起唯一支持值；勿写 "chat"

requires_openai_auth = false
  → 中转站 Key 为 sk_ 前缀时必须设为 false

env_key = "WALLEVEN_API_KEY"
  → 从环境变量读取 Key（Bearer 发送）

model / profiles.*.model
  → 填本站「调用 ID」，与 GET /v1/models 一致`,
        },
      ],
    },
    windows: {
      configPath: '%USERPROFILE%\\.codex\\config.toml',
      openDirCode: 'explorer (Join-Path $env:USERPROFILE ".codex")',
      steps: [
        {
          text: '适配说明：Codex 只走 /v1/responses。本站兼容层支持流式与工具调用。Claude 用 Claude Code；Codex 适合 GPT / Gemini 等。',
        },
        {
          text: '安装（PowerShell，Node.js 22+）：',
          code: `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
# 或
npm install -g @openai/codex
codex --version`,
        },
        {
          text: `Base URL: ${baseUrl.value}（带 /v1）。Key 需含 ai.responses 或 ai.chat。`,
        },
        {
          text: 'PowerShell 验证 Responses：',
          code: `$headers = @{ Authorization = "Bearer ${keyExample.value}" }
$body = @{
  model = "${codexSampleModelId.value}"
  input = "ping"
  max_output_tokens = 64
} | ConvertTo-Json
Invoke-RestMethod -Uri "${baseUrl.value}/responses" -Method Post -Headers $headers -Body $body -ContentType "application/json"`,
        },
        {
          text: '复制 config.toml 到 %USERPROFILE%\\.codex\\config.toml，设置环境变量后运行 codex。',
        },
        {
          text: 'PowerShell 环境变量：',
          code: `$env:WALLEVEN_API_KEY = "${keyExample.value}"
codex`,
        },
      ],
      blocks: [
        {
          title: `config.toml · 含 ${codexModelCount.value} 个模型 profile`,
          code: codexConfigFullToml.value,
        },
        {
          title: 'auth.toml（可选）',
          code: codexAuthEnvToml.value,
        },
        {
          title: '关键字段说明',
          code: `base_url     → ${baseUrl.value}
wire_api     → responses（勿用 chat）
requires_openai_auth → false
env_key      → WALLEVEN_API_KEY`,
        },
      ],
    },
  },
  opencode: {
    macos: {
      configPath: '~/.config/opencode/opencode.jsonc',
      openDirCode: 'open "$HOME/.config/opencode"',
      steps: [
        {
          text: '检查 OpenCode 是否已安装（能输出版本号即可）：',
          code: `opencode --version

# 若提示 command not found，安装：
# curl -fsSL https://opencode.ai/install | bash
# 或 npm install -g opencode-ai`,
        },
        {
          text: '检查配置目录与配置文件；不存在则创建，并打开所在文件夹：',
          code: `CONFIG_DIR="$HOME/.config/opencode"
mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_DIR/opencode.jsonc" ]; then
  echo "配置文件已存在: $CONFIG_DIR/opencode.jsonc"
elif [ -f "$CONFIG_DIR/opencode.json" ]; then
  echo "配置文件已存在: $CONFIG_DIR/opencode.json"
else
  echo "配置文件不存在，请新建: $CONFIG_DIR/opencode.jsonc"
fi

open "$CONFIG_DIR"`,
        },
        {
          text: `复制下方配置到 opencode.jsonc（已含当前 ${openCodeModelCount.value} 个模型），把 apiKey 换成你的 Key：`,
        },
        {
          text: '保存后启动 OpenCode，输入 /models 选择 walleven/模型：',
          code: 'opencode',
        },
      ],
      blocks: [
        {
          title: `opencode.jsonc · 含全部 ${openCodeModelCount.value} 个模型`,
          code: openCodeConfigJson.value,
        },
      ],
    },
    windows: {
      configPath: '%APPDATA%\\opencode\\opencode.jsonc',
      openDirCode: 'explorer (Join-Path $env:APPDATA "opencode")',
      steps: [
        {
          text: '检查 OpenCode 是否已安装（PowerShell）：',
          code: `opencode --version

# 若无法识别命令，安装：
# npm install -g opencode-ai`,
        },
        {
          text: '检查配置目录与配置文件；不存在则创建，并打开所在文件夹：',
          code: `$dir = Join-Path $env:APPDATA "opencode"
$file = Join-Path $dir "opencode.jsonc"

if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}

if (Test-Path $file) {
  Write-Host "配置文件已存在: $file"
} elseif (Test-Path (Join-Path $dir "opencode.json")) {
  Write-Host "配置文件已存在: $(Join-Path $dir 'opencode.json')"
} else {
  Write-Host "配置文件不存在，请新建: $file"
}

explorer $dir`,
        },
        {
          text: `复制下方配置到 opencode.jsonc（已含当前 ${openCodeModelCount.value} 个模型），把 apiKey 换成你的 Key：`,
        },
        {
          text: '保存后启动 OpenCode，输入 /models 选择 walleven/模型：',
          code: 'opencode',
        },
      ],
      blocks: [
        {
          title: `opencode.jsonc · 含全部 ${openCodeModelCount.value} 个模型`,
          code: openCodeConfigJson.value,
        },
      ],
    },
  },
}))

/* ---------- SDK 与 HTTP 示例 ---------- */

const codeExamples = computed(() => ({
  curl: {
    label: 'cURL',
    code: `curl ${baseUrl.value}/chat/completions \\
  -H "Authorization: Bearer $WALLEVEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sampleModelId.value}",
    "messages": [
      {"role": "user", "content": "你好，介绍一下你自己"}
    ]
  }'`,
  },
  python: {
    label: 'Python (openai)',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl.value}",
    api_key="YOUR_WALLEVEN_API_KEY",  # 如 sk_xxx
)

response = client.chat.completions.create(
    model="${sampleModelId.value}",
    messages=[{"role": "user", "content": "你好，介绍一下你自己"}],
)
print(response.choices[0].message.content)`,
  },
  node: {
    label: 'Node.js (openai)',
    code: `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${baseUrl.value}',
  apiKey: process.env.WALLEVEN_API_KEY,
})

const response = await client.chat.completions.create({
  model: '${sampleModelId.value}',
  messages: [{ role: 'user', content: '你好，介绍一下你自己' }],
})
console.log(response.choices[0].message.content)`,
  },
  stream: {
    label: '流式 (SSE)',
    code: `curl -N ${baseUrl.value}/chat/completions \\
  -H "Authorization: Bearer $WALLEVEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sampleModelId.value}",
    "messages": [{"role": "user", "content": "写一首关于壁纸的短诗"}],
    "stream": true
  }'

# 按 SSE 的 data: 行解析增量内容，data: [DONE] 表示结束
# 流式响应末尾自动附带 usage 统计，token 计费按实际用量结算`,
  },
  responsesCurl: {
    label: 'Responses (Codex)',
    code: `curl -sS ${baseUrl.value}/responses \\
  -H "Authorization: Bearer $WALLEVEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${codexSampleModelId.value}",
    "input": "ping",
    "max_output_tokens": 64
  }'`,
  },
  anthropicCurl: {
    label: 'Anthropic cURL',
    code: `curl ${apiOrigin.value}/v1/messages \\
  -H "x-api-key: $WALLEVEN_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sampleClaudeModelId.value}",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "你好，介绍一下你自己"}
    ]
  }'`,
  },
  anthropicPython: {
    label: 'Anthropic Python',
    code: `import anthropic

client = anthropic.Anthropic(
    base_url="${apiOrigin.value}",  # 注意：origin，不带 /v1
    api_key="YOUR_WALLEVEN_API_KEY",  # 如 sk_xxx
)

message = client.messages.create(
    model="${sampleClaudeModelId.value}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好，介绍一下你自己"}],
)
print(message.content[0].text)`,
  },
}))

const sdkExampleGroups = [
  { id: 'openai', label: 'OpenAI 兼容', icon: 'bi-braces' },
  { id: 'anthropic', label: 'Anthropic 原生', icon: 'bi-asterisk' },
]

const sdkExamplesByGroup = computed(() => ({
  openai: ['curl', 'responsesCurl', 'python', 'node', 'stream'],
  anthropic: ['anthropicCurl', 'anthropicPython'],
}))

const heroStats = computed(() => [
  {
    label: '公开模型',
    value: publicModels.value.length ? String(publicModels.value.length) : '—',
    icon: 'bi-cpu-fill',
  },
  {
    label: '接入协议',
    value: '2 套',
    icon: 'bi-diagram-3-fill',
    hint: 'OpenAI + Anthropic',
  },
  {
    label: '工具指南',
    value: `${toolCards.value.length} 款`,
    icon: 'bi-terminal-fill',
  },
])

/* ---------- 错误码 ---------- */

const errorRows = [
  {
    status: 401,
    code: 'invalid_api_key',
    note: 'API Key 缺失、无效或已停用',
    advice: `检查 Authorization 头格式是否为 Bearer ${keyFormatHint.value}；确认 Key 未被删除或停用，必要时去价格页重新创建。`,
  },
  {
    status: 403,
    code: 'forbidden',
    note: '当前 Key 未开通该接口所需的 scope',
    advice: '在价格页编辑 Key，勾选对应接口范围（如 ai.images、ai.audio）后重试。',
  },
  {
    status: 403,
    code: 'forbidden_ip',
    note: '请求来源 IP 不在 Key 的白名单内',
    advice: '将服务器出口 IP 加入 Key 的 IP 白名单，或清空白名单以允许任意来源。',
  },
  {
    status: 403,
    code: 'model_not_allowed',
    note: '当前 Key 未授权调用该模型',
    advice: '改用 Key 模型白名单内的模型，或编辑 Key 放开该模型。',
  },
  {
    status: 400,
    code: 'model_ambiguous',
    note: '模型名同时匹配多个公开模型',
    advice: '使用「可用模型」表中的唯一调用 ID 作为 model 参数，避免使用模糊的简称。',
  },
  {
    status: 404,
    code: 'model_not_found',
    note: '模型不存在或已下架',
    advice: '调用 GET /models 获取当前可用列表，以返回结果为准更新配置。',
  },
  {
    status: 400,
    code: 'gateway_error',
    note: 'Key 日/月预算或次数额度不足，或网关业务校验失败',
    advice: '查看 error.message 中的「今日预算不足」等提示；到价格页调高 Key 限额或充值后重试。',
  },
  {
    status: 429,
    code: 'rate_limit',
    note: '上游服务商限流（通常不是 Key 预算触顶）',
    advice: '降低请求频率并指数退避重试；持续出现可换模型或联系管理员。',
  },
  {
    status: 501,
    code: 'provider_not_supported',
    note: '该模型当前路由的上游暂不支持此调用方式',
    advice: '换用支持该能力的模型（参考能力标签），或改用对应协议的端点。',
  },
  {
    status: 502,
    code: 'gateway_upstream_failed',
    note: '上游服务商调用失败，系统已自动重试多条路由仍未成功',
    advice: '通常为上游瞬时故障，稍后重试即可；持续失败请联系管理员。',
  },
  {
    status: 502,
    code: 'provider_charged_but_response_lost',
    note: '上游可能已扣费但连接中断，响应丢失',
    advice: '系统会按预估用量结算避免重复扣费；请勿立即原样重试大请求，先确认账单明细。',
  },
  {
    status: 503,
    code: 'gateway_no_available_route',
    note: '该模型暂无任何可用上游路由',
    advice: '稍后重试或临时切换到其他模型；长时间不可用请联系管理员检查路由配置。',
  },
]

/* ---------- FAQ ---------- */

const faqItems = computed(() => [
  {
    q: '为什么返回 model_ambiguous？',
    a: '你传入的模型名（例如某个简称）同时命中了多个公开模型。请使用「可用模型」表中的唯一调用 ID 作为 model 参数，或调用 GET /models 查看当前 Key 可见的精确模型 ID。',
  },
  {
    q: '流式响应没有 usage 统计？',
    a: '网关会向上游请求 stream_options.include_usage=true，并在上游返回 usage 块时透传。若上游不支持或未返回 usage，流末尾可能没有统计——请完整消费 SSE 流后再断开。',
  },
  {
    q: '如何在一个工具里同时使用多个模型？',
    a: '所有模型共用同一个 Base URL 和 Key，只需在工具里把每个模型的调用 ID 都添加进去即可。例如 Cursor++ 在 providers.json 的 models 数组里列多个条目、OpenCode 在 models 映射里列多个条目、Continue 在 models 列表加多条记录，使用时自由切换。',
  },
  {
    q: 'API Key 泄露了怎么办？',
    a: '立即到价格控制台的「API 密钥」分区停用或删除该 Key，再创建一个新 Key 替换。建议日常就为 Key 设置最小 scope、模型白名单、IP 白名单与每日预算，把泄露损失控制在限额内。',
  },
  {
    q: 'OpenCode 配置要注意什么？',
    a: 'apiKey 直接写 sk_xxx；disabled_providers 不能含 walleven；模型 ID 与 GET /models 一致（Claude 用横线 claude-opus-4-8）。文档里的配置已含本页全部可用模型，合并进 opencode.jsonc 即可。',
  },
  {
    q: 'OpenCode 选了 StarCloudIsAI 仍报「缺少 API Key」？',
    a: '说明请求到了网关但没带上 Key。请像 rawchat 一样把 Key 直接写在 opencode.jsonc 的 options.apiKey（"apiKey": "sk_xxx"），不要写成 {env:sk_xxx}。保存后完全退出并重启 OpenCode。也可用 curl -H "Authorization: Bearer sk_xxx" 你的BaseURL/models 验证 Key 是否有效。',
  },
  {
    q: 'OpenCode 里看不到 StarCloudIsAI provider？',
    a: '打开 ~/.config/opencode/opencode.jsonc，检查 disabled_providers 是否包含 "walleven"——有的话必须删掉。合并 walleven 配置段后保存，重启 OpenCode，在 TUI 输入 /models 选择 walleven/模型。',
  },
  {
    q: 'Cursor++ 安装后没有生效？',
    a: '确认已完全退出并重启 Cursor；状态栏 BYOK Mode 为开启；Network 已改为 HTTP/1.1。不要同时开启官方 Models 里的 Override OpenAI Base URL。运行 npx @cometix/ccursor status 检查 patch 状态；升级 Cursor 后可能需要重新 install。',
  },
  {
    q: 'Cursor++ 选 Claude 报 404，GPT 正常？',
    a: `Anthropic 通道的 baseUrl 必须填 origin（${apiOrigin.value}），不能填 ${baseUrl.value}。Claude Code 同理——它会自己拼 /v1/messages。GPT 类模型走 OpenAI 通道，baseUrl 填 ${baseUrl.value}。`,
  },
  {
    q: 'Cursor++ Agent 报 tools / MCP 错误？',
    a: '先关闭名称不规范或冲突的 MCP Server，只用 Ask / Chat 验证模型连通。Cursor++ 的 WebFetch / WebSearch 目前为占位实现；需要联网搜索请自行接 MCP。Agent 工具调用格式若与网关不兼容，可先用 Ask 模式或改用 OpenCode。',
  },
  {
    q: 'Claude Code 配置后报 404 / 连接失败？',
    a: `最常见原因是 ANTHROPIC_BASE_URL 填了带 /v1 或末尾斜杠的地址。Claude Code 会自己拼 /v1/messages，应填 origin：${apiOrigin.value}。用 curl 测 ${apiOrigin.value}/v1/messages 确认网关可达后再启动 claude。`,
  },
  {
    q: 'Claude Code /model 里看不到 StarCloudIsAI 的模型？',
    a: '需设置 CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1，且 Claude Code ≥ v2.1.129。官方只把 ID 以 claude 或 anthropic 开头的模型加入选择器；GPT 类模型不会出现。也可在 settings.json 的 availableModels 里手动列出调用 ID，或用 ANTHROPIC_MODEL 指定默认模型。',
  },
  {
    q: 'Claude Code 能用 GPT 吗？',
    a: '不能。Claude Code 经 ANTHROPIC_BASE_URL 只走 Anthropic Messages 协议，本站在此通道下仅路由 Claude 系上游。要用 GPT 请配置 Codex CLI、OpenCode 或 OpenAI 兼容客户端，Base URL 填 /v1 地址。',
  },
  {
    q: 'Claude Code 报 401 / 缺少 API Key？',
    a: '确认 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY 已写入 settings.json 的 env 块（或已 export）。Key 需有效且含 ai.chat scope。若同时登录了 Claude 订阅，执行 unset ANTHROPIC_API_KEY，优先用 AUTH_TOKEN 指向中转站 Key。',
  },
  {
    q: 'Codex CLI 报 wire_api / chat/completions 相关错误？',
    a: 'Codex 2026 起已移除 chat/completions 支持，config.toml 必须使用 wire_api = "responses"（或省略，默认即为 responses）。旧教程里的 wire_api = "chat" 会导致硬错误。确认 base_url 指向本站 /v1 地址，且网关暴露 /v1/responses。',
  },
  {
    q: 'Codex CLI 报 403 Responses 权限或连不上？',
    a: 'Key 需开通 ai.responses、ai.chat 或 ai.all。用 curl 测 POST /v1/responses 确认网关可达。requires_openai_auth 须为 false（sk_ 前缀 Key）。环境变量 WALLEVEN_API_KEY 需在启动 codex 前 export。',
  },
  {
    q: 'Codex 能用 Claude 模型吗？',
    a: '不推荐。Codex 走 OpenAI Responses 协议，本站在此通道下主要路由 GPT / Gemini 等 OpenAI 兼容上游。Claude 请用 Claude Code（Anthropic /v1/messages）；要在同一套 Key 下用 Claude，可用 OpenCode。',
  },
  {
    q: 'CC Switch 和手写 config 能一起用吗？',
    a: '可以安装 CC Switch，但启用某个 Provider 时会覆盖 Claude Code / Codex / OpenCode 的 live 配置。建议以 CC Switch 或手写 config 为主，不要两边同时改。StarCloudIsAI 直连时关闭「本地路由映射」。',
  },
  {
    q: 'CC Switch 里 Codex 要不要开本地路由？',
    a: `一般不要。StarCloudIsAI 已提供 /v1/responses 兼容层，Codex 可直接指向 ${baseUrl.value}。本地路由仅在上游只有 Chat Completions、没有 Responses 时才需要。`,
  },
  {
    q: '该选哪个工具接 StarCloudIsAI？',
    a: 'Claude 模型 → Claude Code；GPT 模型 → Codex 或 OpenCode；要多家中转切换 → CC Switch；本地 8787 开发 → OpenCode；必须在 Cursor 里用 → Cursor++（实验）。',
  },
  {
    q: '支持哪些支付方式？余额在哪里看？',
    a: '充值方式、套餐与实时余额都在价格控制台。用量明细与账单见「用量」分区，可按 Key 和模型筛选每一笔调用的扣费记录。',
  },
])

/* ---------- 生命周期 ---------- */

function readHeaderOffset() {
  if (typeof window === 'undefined') return 82
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-offset').trim()
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 82
}

function findScrollContainer(startEl) {
  let node = startEl?.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY)
    if (scrollableY && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  return window
}

function resetSidebarPosition() {
  const card = navCardRef.value
  const sidebar = sidebarRef.value
  if (!card || !sidebar) return
  card.style.position = ''
  card.style.top = ''
  card.style.left = ''
  card.style.width = ''
  card.style.bottom = ''
  sidebar.style.minHeight = ''
}

function syncSidebarPosition() {
  const card = navCardRef.value
  const sidebar = sidebarRef.value
  const layout = rootRef.value?.querySelector('.docs__layout')
  if (!card || !sidebar || !layout) return

  const useFixedSidebar = window.innerWidth > 1024
  if (!useFixedSidebar) {
    resetSidebarPosition()
    return
  }

  const stickTop = props.embedded ? 8 : readHeaderOffset() + 12
  const layoutRect = layout.getBoundingClientRect()
  const sidebarRect = sidebar.getBoundingClientRect()
  const cardHeight = card.offsetHeight

  if (layoutRect.bottom <= stickTop + cardHeight) {
    card.style.position = 'absolute'
    card.style.top = 'auto'
    card.style.bottom = '0'
    card.style.left = '0'
    card.style.width = '100%'
    sidebar.style.minHeight = `${cardHeight}px`
    return
  }

  if (layoutRect.top <= stickTop) {
    card.style.position = 'fixed'
    card.style.top = `${stickTop}px`
    card.style.left = `${sidebarRect.left}px`
    card.style.width = `${sidebarRect.width}px`
    card.style.bottom = 'auto'
    sidebar.style.minHeight = `${cardHeight}px`
    return
  }

  resetSidebarPosition()
}

function bindSidebarStickiness() {
  resetSidebarPosition()
  // 侧栏吸顶统一由 CSS position: sticky 处理（含价格页内嵌 .pc-main 滚动容器）
}

function unbindSidebarStickiness() {
  if (sidebarScrollHandler) {
    const target = sidebarScrollTarget || window
    if (target === window) {
      window.removeEventListener('scroll', sidebarScrollHandler)
    } else {
      target.removeEventListener('scroll', sidebarScrollHandler)
    }
  }
  if (sidebarResizeHandler) {
    window.removeEventListener('resize', sidebarResizeHandler)
  }
  sidebarScrollTarget = null
  sidebarScrollHandler = null
  sidebarResizeHandler = null
  resetSidebarPosition()
}

onMounted(() => {
  runtimeConfigStore.loadRuntimeConfig().catch(() => null)

  if (!props.embedded) {
    document.documentElement.classList.add('docs-page-active')
  }

  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target.id) {
          activeSection.value = entry.target.id
        }
      }
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
  )
  const root = rootRef.value
  if (!root) return
  root.querySelectorAll('.docs__section[id]').forEach((element) => sectionObserver.observe(element))

  requestAnimationFrame(() => bindSidebarStickiness())
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('docs-page-active')
  unbindSidebarStickiness()
  if (sectionObserver) sectionObserver.disconnect()
  if (copyTimer) clearTimeout(copyTimer)
})

/* ---------- 工具函数 ---------- */

function scrollToSection(id) {
  const root = rootRef.value
  const element = root?.querySelector(`#${CSS.escape(id)}`) || document.getElementById(id)
  if (!element) return
  activeSection.value = id
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openPricingSection(sectionId = '') {
  const id = String(sectionId || '').trim()
  if (!id) return
  if (props.embedded) {
    emit('navigate-section', id)
    return
  }
  router.push({ path: '/pricing', query: { section: id } })
}

function openPricingHome() {
  if (props.embedded) {
    emit('navigate-section', 'overview')
    return
  }
  router.push({ path: '/pricing' })
}

function openExternalLink(link = '') {
  const target = String(link || '').trim()
  if (!target) return
  if (target.startsWith('#')) {
    scrollToSection(target.slice(1))
    return
  }
  if (target.startsWith('/pricing')) {
    const url = new URL(target, window.location.origin)
    const section = url.searchParams.get('section')
    if (section) {
      openPricingSection(section)
      return
    }
    openPricingHome()
    return
  }
  router.push(target)
}

function toggleTool(id) {
  if (expandedTool.value !== id) {
    activeToolPlatform.value = detectToolPlatform()
  }
  expandedTool.value = expandedTool.value === id ? '' : id
}

function detectToolPlatform() {
  if (typeof navigator === 'undefined') return 'macos'
  const platform = String(navigator.platform || '')
  const ua = String(navigator.userAgent || '')
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows'
  return 'macos'
}

function normalizeToolSteps(steps = []) {
  return steps.map((step, index) => {
    if (typeof step === 'string') {
      return { id: index, text: step, code: '' }
    }
    return {
      id: index,
      text: String(step.text || ''),
      code: String(step.code || ''),
    }
  })
}

function resolveToolGuide(tool) {
  const platformGuides = toolPlatformGuides.value[tool.id]
  if (tool.usePlatformTabs && platformGuides) {
    const guide = platformGuides[activeToolPlatform.value] || platformGuides.macos
    return {
      ...guide,
      steps: normalizeToolSteps(guide.steps),
    }
  }
  return {
    steps: normalizeToolSteps(tool.steps || []),
    blocks: tool.blocks || [],
    oneClick: null,
    configPath: '',
    openDirCode: '',
  }
}

function setToolPlatform(platformId) {
  activeToolPlatform.value = platformId
}

function setToolFilter(filterId) {
  activeToolFilter.value = filterId
}

function resolveToolProtocolClass(protocol = '') {
  const value = String(protocol)
  if (value === 'Anthropic 原生') return 'is-anthropic'
  if (value === 'OpenAI Responses') return 'is-responses'
  if (value.includes('+') || value === '多协议') return 'is-multi'
  return 'is-openai'
}

function resolveToolTierClass(tier = '') {
  if (tier === 'full') return 'is-full'
  if (tier === 'partial') return 'is-partial'
  if (tier === 'manager') return 'is-manager'
  if (tier === 'chat') return 'is-chat'
  return 'is-default'
}

function setSdkGroup(groupId) {
  activeSdkGroup.value = groupId
  const keys = sdkExamplesByGroup.value[groupId] || []
  if (!keys.includes(activeExample.value)) {
    activeExample.value = keys[0] || 'curl'
  }
}

function scrollToTool(toolId) {
  activeSection.value = 'tools'
  expandedTool.value = toolId
  activeToolPlatform.value = detectToolPlatform()
  const root = rootRef.value
  const element = root?.querySelector(`#tool-${CSS.escape(toolId)}`)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  scrollToSection('tools')
}

function toggleFaq(index) {
  expandedFaq.value = expandedFaq.value === index ? -1 : index
}

function modelApiId(model) {
  return String(
    model?.apiModelId ||
      model?.externalModelId ||
      model?.modelId ||
      model?.publicModelKey ||
      model?.id ||
      '',
  ).trim()
}

function billingModeLabel(mode) {
  const value = String(mode || 'request')
  if (value === 'token') return '按 token'
  if (value === 'credit') return '按次（美元）'
  return '按次'
}

function priceLabel(model) {
  const price = Number(model?.userPriceUsd || 0)
  if (price > 0) return formatUsd(price)
  const pricing = model?.publicModelPricing || model?.metadata?.pricing || {}
  const inputPerM = Number(
    pricing.inputUsdPerMillionTokens || pricing.inputUsdPerMToken || 0,
  )
  const outputPerM = Number(
    pricing.outputUsdPerMillionTokens || pricing.outputUsdPerMToken || 0,
  )
  if (inputPerM > 0 || outputPerM > 0) {
    const parts = []
    if (inputPerM > 0) parts.push(`输入 $${inputPerM}/1M`)
    if (outputPerM > 0) parts.push(`输出 $${outputPerM}/1M`)
    return parts.join(' · ')
  }
  return '以账单为准'
}

function capabilityLabel(capability) {
  const labels = {
    'text.chat': '对话',
    'text.analysis': '分析',
    'image.understand': '图片理解',
    'image.generate': '文生图',
    'image.edit': '图片编辑',
    embedding: '向量',
    'audio.speech': '语音合成',
    'audio.transcription': '语音转写',
    'web.search': '联网',
    'tool.calling': '工具调用',
  }
  return labels[capability] || capability
}

async function copyText(text, key) {
  try {
    await navigator.clipboard.writeText(String(text || ''))
    copiedKey.value = key
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedKey.value = ''
    }, 1600)
  } catch {
    copiedKey.value = ''
  }
}
</script>

<template>
  <div ref="rootRef" class="docs" :class="{ 'docs--embedded': embedded }" :role="embedded ? undefined : 'main'">
    <div class="docs__layout">
      <aside ref="sidebarRef" class="docs__sidebar">
        <div ref="navCardRef" class="docs__nav-card">
          <p class="docs__nav-title">文档目录</p>
          <nav class="docs__nav" aria-label="文档目录">
            <button
              v-for="section in navSections"
              :key="section.id"
              type="button"
              class="docs__nav-link"
              :class="{ 'is-active': activeSection === section.id }"
              @click="scrollToSection(section.id)"
            >
              <i class="bi" :class="section.icon"></i>
              <span class="docs__nav-label">{{ section.label }}</span>
            </button>
          </nav>
        </div>
      </aside>

      <div class="docs__main">
        <header v-if="!embedded" class="docs__hero">
      <div class="docs__hero-inner">
        <div class="docs__hero-main">
          <span class="docs__badge"><i class="bi bi-plug-fill"></i> API DOCS</span>
          <h1>中转站接入文档</h1>
          <p>
            一个 Key 调用全球顶尖模型。OpenAI 兼容 + Anthropic 原生双协议，Claude Code、Codex、OpenCode、CC
            Switch 等主流 Agent 均可接入。
          </p>
          <div class="docs__hero-actions">
            <button type="button" class="docs__btn docs__btn--primary" @click="openPricingSection('keys')">
              <i class="bi bi-key-fill"></i> 创建 API Key
            </button>
            <button type="button" class="docs__btn" @click="scrollToSection('tools')">
              <i class="bi bi-terminal"></i> 工具接入
            </button>
            <button type="button" class="docs__btn" @click="openPricingSection('models')">
              <i class="bi bi-currency-dollar"></i> 模型价格
            </button>
          </div>
        </div>
        <aside class="docs__hero-aside">
          <div class="docs__hero-aside-title">快速接入</div>
          <div class="docs__hero-url-row">
            <span class="docs__hero-url-tag is-openai">OpenAI</span>
            <code>{{ baseUrl }}</code>
            <button type="button" class="docs__copy docs__copy--mini" @click="copyText(baseUrl, 'hero-base-url')">
              <i :class="copiedKey === 'hero-base-url' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
            </button>
          </div>
          <div class="docs__hero-url-row">
            <span class="docs__hero-url-tag is-anthropic">Anthropic</span>
            <code>{{ apiOrigin }}</code>
            <button type="button" class="docs__copy docs__copy--mini" @click="copyText(apiOrigin, 'hero-api-origin')">
              <i :class="copiedKey === 'hero-api-origin' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
            </button>
          </div>
          <div class="docs__hero-stats">
            <div v-for="stat in heroStats" :key="stat.label" class="docs__hero-stat">
              <i class="bi" :class="stat.icon"></i>
              <div>
                <strong>{{ stat.value }}</strong>
                <span>{{ stat.label }}</span>
                <small v-if="stat.hint">{{ stat.hint }}</small>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </header>
    <div v-else class="docs__embedded-bar">
      <button type="button" class="docs__embedded-action is-primary" @click="openPricingSection('keys')">
        <i class="bi bi-key-fill"></i>
        创建 API Key
      </button>
      <button type="button" class="docs__embedded-action" @click="scrollToSection('tools')">
        <i class="bi bi-terminal"></i>
        工具接入
      </button>
      <button type="button" class="docs__embedded-action" @click="openPricingSection('models')">
        <i class="bi bi-cpu"></i>
        模型价格
      </button>
    </div>

        <div class="docs__content">
        <!-- 1. 概览 -->
        <section id="overview" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-compass"></i></div>
            <div>
              <h2>概览</h2>
              <p>站点能力、双协议入口与推荐接入路径</p>
            </div>
          </header>
          <p class="docs__text">
            本站是一个 AI Token 中转站（relay
            station）：你只需要一个 Key，即可调用全球顶尖模型。每个公开模型背后可能有多条上游路由，请求失败时自动切换容灾，按实际用量计费，用多少付多少。
          </p>
          <div class="docs__features">
            <div class="docs__feature">
              <i class="bi bi-key"></i>
              <h3>一个 Key 调全部模型</h3>
              <p>无需分别注册各家服务商，一个 {{ keyFormatHint }} Key 覆盖对话、图像、向量与语音。</p>
            </div>
            <div class="docs__feature">
              <i class="bi bi-shuffle"></i>
              <h3>自动容灾路由</h3>
              <p>上游故障时自动重试与切换路由，你的代码无需做任何处理。</p>
            </div>
            <div class="docs__feature">
              <i class="bi bi-cash-coin"></i>
              <h3>按量计费</h3>
              <p>预扣 + 实际用量结算，失败自动退款，账单逐笔可查。</p>
            </div>
          </div>
          <div class="docs__endpoint">
            <div class="docs__endpoint-main">
              <span class="docs__endpoint-label">OpenAI Base URL</span>
              <code>{{ baseUrl }}</code>
            </div>
            <button type="button" class="docs__copy" @click="copyText(baseUrl, 'base-url')">
              <i :class="copiedKey === 'base-url' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
              {{ copiedKey === 'base-url' ? '已复制' : '复制' }}
            </button>
          </div>
          <div class="docs__endpoint docs__endpoint--secondary">
            <div class="docs__endpoint-main">
              <span class="docs__endpoint-label">Anthropic Origin</span>
              <code>{{ apiOrigin }}</code>
            </div>
            <button type="button" class="docs__copy" @click="copyText(apiOrigin, 'api-origin')">
              <i :class="copiedKey === 'api-origin' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
              {{ copiedKey === 'api-origin' ? '已复制' : '复制' }}
            </button>
          </div>
          <p class="docs__hint">
            Codex / OpenCode / Cline 等用 <strong>OpenAI Base URL</strong>；Claude Code 用
            <strong>Anthropic Origin</strong>（它会自己拼 <code>/v1/messages</code>）。
          </p>
          <div class="docs__protocols">
            <span class="docs__protocol docs__protocol--openai">
              <i class="bi bi-check-circle-fill"></i> OpenAI 兼容
              <small>/chat/completions · /responses（Codex）· /images · /audio</small>
            </span>
            <span class="docs__protocol docs__protocol--anthropic">
              <i class="bi bi-check-circle-fill"></i> Anthropic 原生
              <small>{{ apiOrigin }}/v1/messages（Claude Code）</small>
            </span>
          </div>
          <div class="docs__pick-grid">
            <article class="docs__pick-card">
              <span class="docs__pick-label">Claude 模型</span>
              <strong>Claude Code</strong>
              <p>Anthropic 原生 Agent，完整工具调用</p>
              <button type="button" class="docs__pick-link" @click="scrollToTool('claude-code')">
                查看配置 <i class="bi bi-arrow-right"></i>
              </button>
            </article>
            <article class="docs__pick-card">
              <span class="docs__pick-label">GPT 模型</span>
              <strong>Codex CLI / App</strong>
              <p>Responses API，CLI 与桌面 App 共用配置</p>
              <button type="button" class="docs__pick-link" @click="scrollToTool('codex')">
                查看配置 <i class="bi bi-arrow-right"></i>
              </button>
            </article>
            <article class="docs__pick-card">
              <span class="docs__pick-label">全模型 / 本地</span>
              <strong>OpenCode</strong>
              <p>开源 Agent，本地 8787 直连首选</p>
              <button type="button" class="docs__pick-link" @click="scrollToTool('opencode')">
                查看配置 <i class="bi bi-arrow-right"></i>
              </button>
            </article>
            <article class="docs__pick-card docs__pick-card--accent">
              <span class="docs__pick-label">不想手改配置</span>
              <strong>CC Switch</strong>
              <p>GUI 管理多工具 Provider，一键切换</p>
              <button type="button" class="docs__pick-link" @click="scrollToTool('cc-switch')">
                查看配置 <i class="bi bi-arrow-right"></i>
              </button>
            </article>
          </div>
        </section>

        <!-- 2. 快速开始 -->
        <section id="quickstart" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-rocket-takeoff"></i></div>
            <div>
              <h2>快速开始</h2>
              <p>从注册到第一次 API 调用</p>
            </div>
          </header>
          <ol class="docs__steps">
            <li v-for="(step, index) in quickSteps" :key="step.title" class="docs__step">
              <span class="docs__step-index">{{ index + 1 }}</span>
              <div class="docs__step-body">
                <h3>{{ step.title }}</h3>
                <p>{{ step.body }}</p>
                <button
                  v-if="step.link"
                  type="button"
                  class="docs__step-link"
                  @click="openExternalLink(step.link)"
                >
                  {{ step.linkLabel }} <i class="bi bi-arrow-right"></i>
                </button>
              </div>
            </li>
          </ol>
        </section>

        <!-- 3. 鉴权 -->
        <section id="auth" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-shield-lock"></i></div>
            <div>
              <h2>鉴权</h2>
              <p>API Key 格式与请求头写法</p>
            </div>
          </header>
          <p class="docs__text">
            所有请求通过 HTTP Header 携带你的中转站 API Key（格式
            <code>{{ keyFormatHint }}</code>）。OpenAI 兼容端点使用标准 Bearer 鉴权（也支持
            <code>x-api-key</code> 头）：
          </p>
          <div class="docs__code-card">
            <div class="docs__code-head">
              <span>OpenAI 兼容端点</span>
              <button
                type="button"
                class="docs__copy docs__copy--ghost"
                @click="copyText(`Authorization: Bearer ${keyExample}`, 'auth-bearer')"
              >
                <i :class="copiedKey === 'auth-bearer' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
                {{ copiedKey === 'auth-bearer' ? '已复制' : '复制' }}
              </button>
            </div>
            <pre class="docs__code">Authorization: Bearer {{ keyExample }}</pre>
          </div>
          <p class="docs__text">
            Anthropic 原生端点（<code>/v1/messages</code>）同时接受 Bearer 与 Anthropic 官方 SDK
            默认使用的 <code>x-api-key</code> 头，两种写法任选其一：
          </p>
          <div class="docs__code-card">
            <div class="docs__code-head">
              <span>Anthropic 原生端点（二选一）</span>
              <button
                type="button"
                class="docs__copy docs__copy--ghost"
                @click="copyText(`x-api-key: ${keyExample}`, 'auth-xapikey')"
              >
                <i :class="copiedKey === 'auth-xapikey' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
                {{ copiedKey === 'auth-xapikey' ? '已复制' : '复制' }}
              </button>
            </div>
            <pre class="docs__code">Authorization: Bearer {{ keyExample }}
x-api-key: {{ keyExample }}</pre>
          </div>
          <div class="docs__callout">
            <i class="bi bi-shield-exclamation"></i>
            <div>
              <strong>Key 安全建议</strong>
              <ul class="docs__notes">
                <li>Key 创建后仅完整显示一次，请立即保存；泄露可在价格页停用并重建。</li>
                <li>按最小权限原则设置接口范围（scope）：只勾选实际需要的能力。</li>
                <li>服务器端调用建议配置 IP 白名单，非白名单 IP 的请求会返回 403。</li>
                <li>为每个 Key 设置日/月预算与模型白名单，把意外消耗控制在限额内。</li>
                <li>不要把 Key 写进前端代码或公开仓库，统一通过环境变量注入。</li>
              </ul>
            </div>
          </div>
        </section>

        <!-- 4. API 端点 -->
        <section id="endpoints" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-diagram-3"></i></div>
            <div>
              <h2>API 端点</h2>
              <p>OpenAI 兼容与 Anthropic 原生路由</p>
            </div>
          </header>
          <h3 class="docs__subheading">
            OpenAI 兼容端点
            <small>以下路径相对于 Base URL：<code>{{ baseUrl }}</code></small>
          </h3>
          <div class="docs__table-wrap">
            <table class="docs__table">
              <thead>
                <tr>
                  <th>方法</th>
                  <th>路径</th>
                  <th>所需 scope</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in openAiEndpoints" :key="row.path">
                  <td>
                    <span class="docs__method" :class="`is-${row.method.toLowerCase()}`">{{ row.method }}</span>
                  </td>
                  <td><code>{{ row.path }}</code></td>
                  <td><code>{{ row.scope }}</code></td>
                  <td>{{ row.note }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3 class="docs__subheading">
            Anthropic 原生端点
            <small>以下路径相对于站点 origin：<code>{{ apiOrigin }}</code>（不带 /v1 前缀）</small>
          </h3>
          <div class="docs__table-wrap">
            <table class="docs__table">
              <thead>
                <tr>
                  <th>方法</th>
                  <th>路径</th>
                  <th>所需 scope</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in anthropicEndpoints" :key="row.path">
                  <td>
                    <span class="docs__method" :class="`is-${row.method.toLowerCase()}`">{{ row.method }}</span>
                  </td>
                  <td><code>{{ row.path }}</code></td>
                  <td><code>{{ row.scope }}</code></td>
                  <td>{{ row.note }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 5. 可用模型 -->
        <section id="models" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-cpu"></i></div>
            <div>
              <h2>可用模型</h2>
              <p>调用 ID、能力与计费方式</p>
            </div>
          </header>
          <p class="docs__text">
            模型由平台统一调度，你无需关心背后的服务商。请求中的
            <code>model</code> 参数使用下表「调用 ID」（点击可复制）。
          </p>
          <div v-if="publicModels.length" class="docs__table-wrap">
            <table class="docs__table">
              <thead>
                <tr>
                  <th>调用 ID</th>
                  <th>名称</th>
                  <th>能力</th>
                  <th>计费</th>
                  <th>价格</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in publicModels" :key="model.id">
                  <td>
                    <button
                      type="button"
                      class="docs__model-id"
                      :title="copiedKey === `model-${model.id}` ? '已复制' : '点击复制'"
                      @click="copyText(model.id, `model-${model.id}`)"
                    >
                      <code>{{ model.id }}</code>
                      <i :class="copiedKey === `model-${model.id}` ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
                    </button>
                  </td>
                  <td>{{ model.label }}</td>
                  <td>
                    <span v-for="capability in model.capabilities" :key="capability" class="docs__tag">
                      {{ capabilityLabel(capability) }}
                    </span>
                  </td>
                  <td>{{ model.billingMode }}</td>
                  <td>{{ model.price }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="docs__empty">
            模型目录加载中，或当前未公开任何模型。拿到 Key 后也可以调用
            <code>GET {{ baseUrl }}/models</code> 获取实时列表。
          </p>
        </section>

        <!-- 6. 工具接入 -->
        <section id="tools" class="docs__section docs__section--tools">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-terminal"></i></div>
            <div>
              <h2>工具接入指南</h2>
              <p>Claude Code · Codex · OpenCode · CC Switch · Cursor++</p>
            </div>
          </header>
          <p class="docs__text">
            以下配置已自动填入本站地址与示例模型。推荐从
            <strong>CC Switch</strong>（GUI 管理）或
            <strong>Claude Code / Codex / OpenCode</strong>（手写配置）开始；点击卡片展开分步教程与可复制配置。
          </p>

          <div class="docs__matrix-wrap">
            <h3 class="docs__subheading">接入对照表</h3>
            <div class="docs__table-wrap">
              <table class="docs__table docs__table--matrix">
                <thead>
                  <tr>
                    <th>工具</th>
                    <th>协议</th>
                    <th>Base URL</th>
                    <th>端点</th>
                    <th>适用模型</th>
                    <th>Agent</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in integrationMatrix" :key="row.tool">
                    <td><strong>{{ row.tool }}</strong></td>
                    <td><span class="docs__matrix-protocol">{{ row.protocol }}</span></td>
                    <td><code>{{ row.baseUrl }}</code></td>
                    <td><code>{{ row.endpoint }}</code></td>
                    <td>{{ row.models }}</td>
                    <td>
                      <span class="docs__tier-badge" :class="resolveToolTierClass(row.tier)">
                        {{ row.agent }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="docs__url-cards">
            <article class="docs__url-card">
              <span class="docs__url-card-label is-openai">OpenAI 通道</span>
              <code>{{ baseUrl }}</code>
              <p>Codex · OpenCode · Cline · Continue · Zed</p>
              <button type="button" class="docs__copy docs__copy--ghost" @click="copyText(baseUrl, 'tools-openai-url')">
                <i :class="copiedKey === 'tools-openai-url' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
                复制
              </button>
            </article>
            <article class="docs__url-card">
              <span class="docs__url-card-label is-anthropic">Anthropic 通道</span>
              <code>{{ apiOrigin }}</code>
              <p>Claude Code · Cursor++（Claude Provider）</p>
              <button
                type="button"
                class="docs__copy docs__copy--ghost"
                @click="copyText(apiOrigin, 'tools-anthropic-url')"
              >
                <i :class="copiedKey === 'tools-anthropic-url' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
                复制
              </button>
            </article>
          </div>

          <div class="docs__tool-filters">
            <button
              v-for="filter in toolFilterOptions"
              :key="filter.id"
              type="button"
              class="docs__tool-filter"
              :class="{ 'is-active': activeToolFilter === filter.id }"
              @click="setToolFilter(filter.id)"
            >
              {{ filter.label }}
            </button>
          </div>

          <div class="docs__tools">
            <article
              v-for="tool in filteredToolCards"
              :key="tool.id"
              :id="`tool-${tool.id}`"
              class="docs__tool"
              :class="{ 'is-open': expandedTool === tool.id, 'is-featured': tool.featured }"
            >
              <button type="button" class="docs__tool-head" @click="toggleTool(tool.id)">
                <i class="bi docs__tool-icon" :class="tool.icon"></i>
                <span class="docs__tool-title">
                  <strong>
                    {{ tool.name }}
                    <span v-if="tool.featured" class="docs__tool-featured">推荐</span>
                  </strong>
                  <small>{{ tool.tagline }}</small>
                </span>
                <span v-if="tool.tierLabel" class="docs__tier-badge" :class="resolveToolTierClass(tool.tier)">
                  {{ tool.tierLabel }}
                </span>
                <span class="docs__tool-protocol" :class="resolveToolProtocolClass(tool.protocol)">
                  {{ tool.protocol }}
                </span>
                <i class="bi bi-chevron-down docs__tool-chevron"></i>
              </button>
              <div v-if="expandedTool === tool.id" class="docs__tool-body">
                <div v-if="tool.usePlatformTabs" class="docs__platform-tabs">
                  <button
                    v-for="platform in toolPlatformOptions"
                    :key="platform.id"
                    type="button"
                    class="docs__tab"
                    :class="{ 'is-active': activeToolPlatform === platform.id }"
                    @click="setToolPlatform(platform.id)"
                  >
                    {{ platform.label }}
                  </button>
                </div>
                <div v-if="tool.usePlatformTabs && resolveToolGuide(tool).configPath" class="docs__tool-path">
                  <div class="docs__tool-path__head">
                    <i class="bi bi-folder2-open"></i>
                    <span>
                      配置文件路径：
                      <code>{{ resolveToolGuide(tool).configPath }}</code>
                    </span>
                  </div>
                  <div v-if="resolveToolGuide(tool).openDirCode" class="docs__tool-step-code">
                    <pre class="docs__code docs__code--step">{{ resolveToolGuide(tool).openDirCode }}</pre>
                    <button
                      type="button"
                      class="docs__copy docs__copy--ghost docs__copy--step"
                      @click="
                        copyText(
                          resolveToolGuide(tool).openDirCode,
                          `tool-${tool.id}-${activeToolPlatform}-opendir`,
                        )
                      "
                    >
                      <i
                        :class="
                          copiedKey === `tool-${tool.id}-${activeToolPlatform}-opendir`
                            ? 'bi bi-check-lg'
                            : 'bi bi-clipboard'
                        "
                      ></i>
                      {{
                        copiedKey === `tool-${tool.id}-${activeToolPlatform}-opendir`
                          ? '已复制'
                          : '复制打开命令'
                      }}
                    </button>
                  </div>
                </div>
                <ol v-if="resolveToolGuide(tool).steps.length" class="docs__tool-steps">
                  <li
                    v-for="step in resolveToolGuide(tool).steps"
                    :key="`${tool.id}-${activeToolPlatform}-${step.id}`"
                    class="docs__tool-step"
                  >
                    <span>{{ step.text }}</span>
                    <div v-if="step.code" class="docs__tool-step-code">
                      <pre class="docs__code docs__code--step">{{ step.code }}</pre>
                      <button
                        type="button"
                        class="docs__copy docs__copy--ghost docs__copy--step"
                        @click="
                          copyText(
                            step.code,
                            `tool-${tool.id}-${activeToolPlatform}-step-${step.id}`,
                          )
                        "
                      >
                        <i
                          :class="
                            copiedKey === `tool-${tool.id}-${activeToolPlatform}-step-${step.id}`
                              ? 'bi bi-check-lg'
                              : 'bi bi-clipboard'
                          "
                        ></i>
                        {{
                          copiedKey === `tool-${tool.id}-${activeToolPlatform}-step-${step.id}`
                            ? '已复制'
                            : '复制命令'
                        }}
                      </button>
                    </div>
                  </li>
                </ol>
                <div
                  v-if="resolveToolGuide(tool).oneClick"
                  class="docs__code-card docs__code-card--primary"
                >
                  <div class="docs__code-head">
                    <span>{{ resolveToolGuide(tool).oneClick.title }}</span>
                    <button
                      type="button"
                      class="docs__copy docs__copy--ghost"
                      @click="
                        copyText(
                          resolveToolGuide(tool).oneClick.code,
                          `tool-${tool.id}-${activeToolPlatform}-oneclick`,
                        )
                      "
                    >
                      <i
                        :class="
                          copiedKey === `tool-${tool.id}-${activeToolPlatform}-oneclick`
                            ? 'bi bi-check-lg'
                            : 'bi bi-clipboard'
                        "
                      ></i>
                      {{
                        copiedKey === `tool-${tool.id}-${activeToolPlatform}-oneclick`
                          ? '已复制'
                          : '复制一键命令'
                      }}
                    </button>
                  </div>
                  <pre class="docs__code">{{ resolveToolGuide(tool).oneClick.code }}</pre>
                </div>
                <div
                  v-for="block in resolveToolGuide(tool).blocks"
                  :key="`${activeToolPlatform}-${block.title}`"
                  class="docs__code-card"
                >
                  <div class="docs__code-head">
                    <span>{{ block.title }}</span>
                    <button
                      type="button"
                      class="docs__copy docs__copy--ghost"
                      @click="
                        copyText(
                          block.code,
                          `tool-${tool.id}-${activeToolPlatform}-${block.title}`,
                        )
                      "
                    >
                      <i
                        :class="
                          copiedKey === `tool-${tool.id}-${activeToolPlatform}-${block.title}`
                            ? 'bi bi-check-lg'
                            : 'bi bi-clipboard'
                        "
                      ></i>
                      {{
                        copiedKey === `tool-${tool.id}-${activeToolPlatform}-${block.title}`
                          ? '已复制'
                          : '复制'
                      }}
                    </button>
                  </div>
                  <pre class="docs__code">{{ block.code }}</pre>
                </div>
                <p v-if="tool.note" class="docs__tool-note">
                  <i class="bi bi-info-circle"></i> {{ tool.note }}
                </p>
              </div>
            </article>
          </div>
        </section>

        <!-- 7. SDK 与 HTTP 示例 -->
        <section id="sdk" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-code-slash"></i></div>
            <div>
              <h2>SDK 与 HTTP 示例</h2>
              <p>按协议分组，复制即可调试</p>
            </div>
          </header>
          <p class="docs__text">
            shell 示例统一使用 <code>WALLEVEN_API_KEY</code> 环境变量：
            <code>export WALLEVEN_API_KEY="{{ keyExample }}"</code>。
          </p>
          <div class="docs__sdk-groups">
            <button
              v-for="group in sdkExampleGroups"
              :key="group.id"
              type="button"
              class="docs__sdk-group"
              :class="{ 'is-active': activeSdkGroup === group.id }"
              @click="setSdkGroup(group.id)"
            >
              <i class="bi" :class="group.icon"></i>
              {{ group.label }}
            </button>
          </div>
          <div class="docs__tabs docs__tabs--sdk">
            <button
              v-for="key in sdkExamplesByGroup[activeSdkGroup]"
              :key="key"
              type="button"
              class="docs__tab"
              :class="{ 'is-active': activeExample === key }"
              @click="activeExample = key"
            >
              {{ codeExamples[key].label }}
            </button>
          </div>
          <div class="docs__code-card docs__code-card--terminal">
            <div class="docs__code-head">
              <span class="docs__code-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span>{{ codeExamples[activeExample].label }}</span>
              <button
                type="button"
                class="docs__copy docs__copy--ghost"
                @click="copyText(codeExamples[activeExample].code, 'example')"
              >
                <i :class="copiedKey === 'example' ? 'bi bi-check-lg' : 'bi bi-clipboard'"></i>
                {{ copiedKey === 'example' ? '已复制' : '复制代码' }}
              </button>
            </div>
            <pre class="docs__code docs__code--block">{{ codeExamples[activeExample].code }}</pre>
          </div>
        </section>

        <!-- 8. 错误码 -->
        <section id="errors" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-exclamation-triangle"></i></div>
            <div>
              <h2>错误码</h2>
              <p>常见 HTTP 状态与处理建议</p>
            </div>
          </header>
          <p class="docs__text">
            错误响应为 JSON 格式，<code>error.code</code> 字段对应下表错误码：
          </p>
          <div class="docs__table-wrap">
            <table class="docs__table">
              <thead>
                <tr>
                  <th>HTTP</th>
                  <th>错误码</th>
                  <th>说明</th>
                  <th>处理建议</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in errorRows" :key="`${row.status}-${row.code}`">
                  <td>
                    <span
                      class="docs__status"
                      :class="row.status < 500 ? 'is-client' : 'is-server'"
                    >{{ row.status }}</span>
                  </td>
                  <td><code>{{ row.code }}</code></td>
                  <td>{{ row.note }}</td>
                  <td>{{ row.advice }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 9. 计费与限额 -->
        <section id="billing" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-receipt"></i></div>
            <div>
              <h2>计费与限额</h2>
              <p>预扣、结算、退款与 Key 限额</p>
            </div>
          </header>
          <div class="docs__billing-flow">
            <div class="docs__billing-step">
              <i class="bi bi-wallet2"></i>
              <strong>预扣</strong>
              <p>请求发起时按预估用量冻结余额</p>
            </div>
            <i class="bi bi-arrow-right docs__billing-arrow"></i>
            <div class="docs__billing-step">
              <i class="bi bi-calculator"></i>
              <strong>结算</strong>
              <p>成功后按实际 token / 次数结算</p>
            </div>
            <i class="bi bi-arrow-right docs__billing-arrow"></i>
            <div class="docs__billing-step">
              <i class="bi bi-arrow-counterclockwise"></i>
              <strong>退款</strong>
              <p>失败自动全额退回预扣金额</p>
            </div>
          </div>
          <ul class="docs__notes">
            <li>
              按 token 计费的模型，<strong>流式响应同样按实际 usage 结算</strong>——流末尾会附带 usage
              统计，多退少补。
            </li>
            <li>
              每个 Key 可独立设置<strong>每日 / 每月预算</strong>，触顶后返回
              <code>400 gateway_error</code>（message 含预算不足说明），不影响其他 Key。
            </li>
            <li>
              Key 还支持<strong>模型白名单</strong>：白名单外的模型返回
              <code>403 model_not_allowed</code>，适合给团队或第三方应用分发受限 Key。
            </li>
            <li>
              极少数情况下上游已扣费但连接中断（<code>provider_charged_but_response_lost</code>），按预估用量结算，避免重复扣费。
            </li>
            <li>
              余额、逐笔用量明细与账单随时可在
              <button type="button" class="docs__inline-link" @click="openPricingSection('usage')">
                价格控制台 → 用量
              </button>
              查看。
            </li>
          </ul>
        </section>

        <!-- 10. FAQ -->
        <section id="faq" class="docs__section">
          <header class="docs__section-head">
            <div class="docs__section-icon"><i class="bi bi-question-circle"></i></div>
            <div>
              <h2>FAQ</h2>
              <p>接入与排错常见问题</p>
            </div>
          </header>
          <div class="docs__faqs">
            <article
              v-for="(item, index) in faqItems"
              :key="item.q"
              class="docs__faq"
              :class="{ 'is-open': expandedFaq === index }"
            >
              <button type="button" class="docs__faq-head" @click="toggleFaq(index)">
                <span>{{ item.q }}</span>
                <i class="bi bi-chevron-down"></i>
              </button>
              <p v-if="expandedFaq === index" class="docs__faq-body">{{ item.a }}</p>
            </article>
          </div>
          <p class="docs__text docs__text--muted">
            没有找到答案？先检查
            <a href="#errors" @click.prevent="scrollToSection('errors')">错误码</a>
            一节，或前往
            <button type="button" class="docs__inline-link" @click="openPricingHome()">价格控制台</button>
            查看 Key 与账单状态。
          </p>
        </section>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docs {
  --color-background: #ffffff;
  --color-background-soft: #f4f6fb;
  --color-background-mute: #eef1f8;
  --color-border: rgba(15, 23, 42, 0.1);
  --color-border-hover: rgba(15, 23, 42, 0.22);
  --color-heading: #0f172a;
  --color-text: #475569;
  --docs-accent: #4f7cff;
  --docs-accent-soft: rgba(79, 124, 255, 0.1);
  --docs-surface: #ffffff;
  --docs-surface-elevated: #ffffff;
  --docs-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.06);
  --docs-shadow-lg: 0 4px 6px rgba(15, 23, 42, 0.04), 0 20px 48px rgba(15, 23, 42, 0.08);
  --docs-terminal-bg: #0d1117;
  --docs-terminal-head: #161b22;
  --docs-terminal-text: #e6edf3;
  --docs-terminal-muted: #8b949e;
  --docs-radius: 16px;
  --docs-radius-sm: 10px;

  min-height: calc(100svh - var(--app-header-offset, 0px));
  padding: 0 max(24px, calc((100% - 1280px) / 2)) 96px;
  color: var(--color-text);
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(79, 124, 255, 0.12), transparent),
    radial-gradient(circle at 100% 0%, rgba(217, 119, 87, 0.06), transparent 40%),
    #f8fafc;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    Roboto,
    'Helvetica Neue',
    sans-serif;
  font-size: 14px;
  line-height: 1.65;
}

@media (prefers-color-scheme: dark) {
  .docs {
    --color-background: #0b0f17;
    --color-background-soft: #121826;
    --color-background-mute: #1a2234;
    --color-border: rgba(148, 163, 184, 0.16);
    --color-border-hover: rgba(148, 163, 184, 0.32);
    --color-heading: #f1f5f9;
    --color-text: #94a3b8;
    --docs-accent-soft: rgba(79, 124, 255, 0.16);
    --docs-surface: #121826;
    --docs-surface-elevated: #161d2e;
    --docs-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.25);
    --docs-shadow-lg: 0 4px 6px rgba(0, 0, 0, 0.2), 0 24px 56px rgba(0, 0, 0, 0.35);
    background:
      radial-gradient(ellipse 80% 50% at 50% -20%, rgba(79, 124, 255, 0.18), transparent),
      radial-gradient(circle at 100% 0%, rgba(217, 119, 87, 0.08), transparent 40%),
      #0b0f17;
  }
}

/* 重置 Bootstrap 默认外边距，统一由布局 gap 控制节奏 */
.docs :is(h1, h2, h3, p, ul, ol, pre) {
  margin: 0;
}

/* Bootstrap 全局把 code 染成粉色，这里统一为主题内的代码胶囊样式 */
.docs code {
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--color-heading);
  background: var(--color-background-mute);
  font-size: 0.88em;
}

/* ---------- Hero ---------- */

.docs__hero {
  margin: 0 0 24px;
  padding: 36px 32px;
  border-radius: var(--docs-radius);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(135deg, rgba(79, 124, 255, 0.08) 0%, transparent 50%),
    linear-gradient(225deg, rgba(217, 119, 87, 0.06) 0%, transparent 45%),
    var(--docs-surface);
  box-shadow: var(--docs-shadow);
}

.docs__hero-inner {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 32px;
  align-items: start;
  max-width: none;
  margin: 0;
}

.docs__hero-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.docs__badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid rgba(79, 124, 255, 0.25);
  background: var(--docs-accent-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--docs-accent);
}

.docs__badge i {
  font-size: 12px;
}

.docs__hero-main h1 {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--color-heading);
}

.docs__hero-main > p {
  max-width: 560px;
  font-size: 15px;
  color: var(--color-text);
}

.docs__hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.docs__hero-aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
  border-radius: var(--docs-radius);
  border: 1px solid var(--color-border);
  background: var(--docs-surface);
  box-shadow: var(--docs-shadow-lg);
}

.docs__hero-aside-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text);
  opacity: 0.85;
}

.docs__hero-url-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.docs__hero-url-row code {
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-heading);
  background: transparent;
  word-break: break-all;
}

.docs__hero-url-tag {
  flex: none;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.docs__hero-url-tag.is-openai {
  background: rgba(34, 197, 94, 0.14);
  color: #16a34a;
}

.docs__hero-url-tag.is-anthropic {
  background: rgba(217, 119, 87, 0.16);
  color: #d97757;
}

.docs__hero-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}

.docs__hero-stat {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.docs__hero-stat > i {
  flex: none;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--docs-accent-soft);
  color: var(--docs-accent);
  font-size: 14px;
}

.docs__hero-stat strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.2;
}

.docs__hero-stat span {
  display: block;
  font-size: 11px;
  color: var(--color-text);
  margin-top: 1px;
}

.docs__hero-stat small {
  display: block;
  font-size: 10px;
  color: var(--color-text);
  opacity: 0.75;
  margin-top: 2px;
}

.docs__btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--docs-surface);
  color: var(--color-heading);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--docs-shadow);
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.docs__btn:hover {
  border-color: var(--color-border-hover);
  color: var(--color-heading);
  background: var(--color-background-soft);
  transform: translateY(-1px);
}

.docs__btn--primary {
  background: var(--docs-accent);
  border-color: var(--docs-accent);
  color: #fff;
  box-shadow: 0 4px 14px rgba(79, 124, 255, 0.35);
}

.docs__btn--primary:hover {
  color: #fff;
  background: #3e68e8;
  border-color: #3e68e8;
}

/* ---------- 布局：粘性目录 + 内容 ---------- */

.docs__layout {
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  max-width: 1280px;
  margin: 0 auto;
  padding-top: 32px;
}

.docs__main {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  width: 100%;
}

.docs__sidebar {
  align-self: start;
  width: max-content;
  max-width: 200px;
  min-width: 0;
  height: fit-content;
}

@media (min-width: 1025px) {
  .docs__sidebar {
    position: sticky;
    top: calc(var(--app-header-offset, 82px) + 12px);
    z-index: 30;
  }

  .docs.docs--embedded .docs__sidebar {
    top: 0;
    z-index: 6;
  }
}

.docs__nav-card {
  width: 100%;
  min-width: 148px;
  padding: 16px 12px;
  border-radius: var(--docs-radius);
  border: 1px solid var(--color-border);
  background: var(--docs-surface);
  box-shadow: var(--docs-shadow);
  z-index: 30;
  max-height: calc(100svh - var(--app-header-offset, 82px) - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.docs__nav-title {
  margin: 0 0 10px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text);
  opacity: 0.7;
}

.docs__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.docs__nav-link {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: var(--docs-radius-sm);
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.docs__nav-link i {
  font-size: 13px;
  opacity: 0.7;
}

.docs__nav-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.docs__nav-link:hover {
  color: var(--color-heading);
  background: var(--color-background-soft);
}

.docs__nav-link.is-active {
  color: var(--docs-accent);
  background: var(--docs-accent-soft);
  font-weight: 600;
}

.docs__content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.docs__section {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px 32px;
  border-radius: var(--docs-radius);
  border: 1px solid var(--color-border);
  background: var(--docs-surface);
  box-shadow: var(--docs-shadow);
  scroll-margin-top: calc(var(--app-header-offset, 72px) + 24px);
}

.docs__section--tools {
  padding-bottom: 32px;
}

.docs__section-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 18px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--color-border);
}

.docs__section-icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--docs-accent-soft);
  color: var(--docs-accent);
  font-size: 18px;
}

.docs__section-head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-heading);
  line-height: 1.25;
}

.docs__section-head p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text);
}

.docs__subheading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-heading);
}

.docs__subheading small {
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text);
}

.docs__text {
  color: var(--color-text);
}

.docs__text--muted {
  font-size: 14px;
}

.docs__text a {
  color: #4f7cff;
  text-decoration: none;
}

.docs__text a:hover,
.docs__notes a:hover,
.docs__step-link:hover {
  color: #3e68e8;
  text-decoration: underline;
}

/* ---------- 概览 ---------- */

.docs__features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.docs__feature {
  padding: 20px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.docs__feature:hover {
  border-color: rgba(79, 124, 255, 0.25);
  box-shadow: 0 4px 16px rgba(79, 124, 255, 0.06);
}

.docs__feature i {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--docs-accent-soft);
  font-size: 16px;
  color: var(--docs-accent);
}

.docs__feature h3 {
  margin-top: 12px;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-heading);
}

.docs__feature p {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.55;
}

.docs__endpoint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 18px 22px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid rgba(79, 124, 255, 0.28);
  background: linear-gradient(135deg, rgba(79, 124, 255, 0.08), rgba(79, 124, 255, 0.02));
}

.docs__endpoint-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.docs__endpoint-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: 0.1em;
}

.docs__endpoint code {
  padding: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--color-heading);
  background: transparent;
  word-break: break-all;
}

.docs__protocols {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.docs__protocol {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-heading);
}

.docs__protocol small {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text);
  word-break: break-all;
}

.docs__protocol--openai i {
  color: #22c55e;
}

.docs__protocol--anthropic i {
  color: #d97757;
}

/* ---------- 快速开始 ---------- */

.docs__steps {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.docs__step {
  display: flex;
  gap: 16px;
  padding: 18px 20px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  transition: border-color 0.15s ease;
}

.docs__step:hover {
  border-color: rgba(79, 124, 255, 0.22);
}

.docs__step-index {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--docs-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(79, 124, 255, 0.35);
}

.docs__step-body h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 4px;
}

.docs__step-body p {
  font-size: 14px;
  color: var(--color-text);
}

.docs__step-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 13px;
  color: #4f7cff;
  text-decoration: none;
  cursor: pointer;
}

/* ---------- 代码块（终端风格） ---------- */

.docs__code-card {
  border-radius: var(--docs-radius-sm);
  border: 1px solid rgba(15, 23, 42, 0.12);
  overflow: hidden;
  background: var(--docs-terminal-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.docs__code-card--terminal {
  border-color: rgba(15, 23, 42, 0.2);
}

.docs__code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--docs-terminal-head);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  font-weight: 600;
  color: var(--docs-terminal-muted);
}

.docs__code-dots {
  display: inline-flex;
  gap: 6px;
  margin-right: 4px;
}

.docs__code-dots i {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff5f57;
}

.docs__code-dots i:nth-child(2) {
  background: #febc2e;
}

.docs__code-dots i:nth-child(3) {
  background: #28c840;
}

.docs__code {
  margin: 0;
  padding: 18px 20px;
  background: var(--docs-terminal-bg);
  color: var(--docs-terminal-text);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  overflow-x: auto;
  white-space: pre;
}

.docs__code--block {
  min-height: 160px;
}

.docs__copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--docs-surface);
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.docs__copy:hover {
  border-color: var(--color-border-hover);
  color: var(--color-heading);
}

.docs__copy--ghost {
  padding: 4px 10px;
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--docs-terminal-muted);
}

.docs__copy--ghost:hover {
  border-color: rgba(255, 255, 255, 0.22);
  color: var(--docs-terminal-text);
  background: rgba(255, 255, 255, 0.1);
}

.docs__copy--mini {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text);
}

.docs__copy--mini:hover {
  color: var(--docs-accent);
  background: var(--docs-accent-soft);
}

/* ---------- 提示框 ---------- */

.docs__callout {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid rgba(79, 124, 255, 0.35);
  background: rgba(79, 124, 255, 0.06);
}

.docs__callout > i {
  flex: none;
  font-size: 18px;
  color: #4f7cff;
}

.docs__callout strong {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--color-heading);
}

.docs__notes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 20px;
  color: var(--color-text);
  font-size: 14px;
}

.docs__notes a {
  color: #4f7cff;
  text-decoration: none;
}

/* ---------- 表格 ---------- */

.docs__table-wrap {
  overflow-x: auto;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.docs__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.docs__table th,
.docs__table td {
  padding: 11px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  vertical-align: top;
}

.docs__table thead th {
  background: color-mix(in srgb, var(--docs-accent) 6%, var(--color-background-soft));
  color: var(--color-heading);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.docs__table tbody tr:last-child td {
  border-bottom: none;
}

.docs__method {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.docs__method.is-get {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.docs__method.is-post {
  background: rgba(79, 124, 255, 0.15);
  color: #4f7cff;
}

.docs__status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}

.docs__status.is-client {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}

.docs__status.is-server {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.docs__model-id {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  font-size: inherit;
}

.docs__model-id i {
  font-size: 12px;
  opacity: 0.6;
}

.docs__tag {
  display: inline-block;
  margin: 0 6px 4px 0;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  font-size: 11px;
  color: var(--color-text);
}

.docs__empty {
  padding: 24px;
  border-radius: 12px;
  border: 1px dashed var(--color-border);
  color: var(--color-text);
  font-size: 14px;
  text-align: center;
}

.docs__endpoint--secondary {
  margin-top: 10px;
}

.docs__hint {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.6;
}

.docs__hint strong {
  color: var(--color-heading);
  font-weight: 600;
}

.docs__pick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.docs__pick-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.docs__pick-card--accent {
  border-color: rgba(79, 124, 255, 0.45);
  background: rgba(79, 124, 255, 0.06);
}

.docs__pick-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text);
  opacity: 0.75;
}

.docs__pick-card strong {
  font-size: 15px;
  color: var(--color-heading);
}

.docs__pick-card p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text);
  line-height: 1.5;
  flex: 1;
}

.docs__pick-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: #4f7cff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.docs__matrix-wrap {
  margin-bottom: 18px;
}

.docs__table--matrix code {
  font-size: 11px;
  word-break: break-all;
}

.docs__matrix-protocol {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  font-size: 11px;
  white-space: nowrap;
}

.docs__url-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.docs__url-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 38px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.docs__url-card code {
  font-size: 13px;
  word-break: break-all;
  color: var(--color-heading);
}

.docs__url-card p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text);
}

.docs__url-card .docs__copy {
  position: absolute;
  right: 12px;
  bottom: 10px;
}

.docs__url-card-label {
  display: inline-flex;
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.docs__url-card-label.is-openai {
  background: rgba(34, 197, 94, 0.14);
  color: #16a34a;
}

.docs__url-card-label.is-anthropic {
  background: rgba(217, 119, 87, 0.16);
  color: #d97757;
}

.docs__tool-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.docs__tool-filter {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.docs__tool-filter.is-active {
  border-color: rgba(79, 124, 255, 0.55);
  background: rgba(79, 124, 255, 0.12);
  color: #4f7cff;
  font-weight: 600;
}

.docs__tier-badge {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.docs__tier-badge.is-full {
  background: rgba(34, 197, 94, 0.14);
  color: #16a34a;
}

.docs__tier-badge.is-partial {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.docs__tier-badge.is-manager {
  background: rgba(79, 124, 255, 0.14);
  color: #4f7cff;
}

.docs__tier-badge.is-chat {
  background: rgba(148, 163, 184, 0.18);
  color: #64748b;
}

.docs__tool.is-featured {
  border-color: rgba(79, 124, 255, 0.35);
}

.docs__tool-featured {
  display: inline-flex;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(79, 124, 255, 0.16);
  color: #4f7cff;
  font-size: 10px;
  font-weight: 700;
  vertical-align: middle;
}

.docs__tool-protocol.is-responses {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}

.docs__tool-protocol.is-multi {
  background: rgba(14, 165, 233, 0.14);
  color: #0284c7;
}

/* ---------- 工具卡片 ---------- */

.docs__tools {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.docs__tool {
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.docs__tool:hover {
  border-color: rgba(79, 124, 255, 0.2);
}

.docs__tool.is-open {
  border-color: rgba(79, 124, 255, 0.45);
  box-shadow: 0 8px 24px rgba(79, 124, 255, 0.08);
}

.docs__tool-head {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.docs__tool-icon {
  flex: none;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(79, 124, 255, 0.12);
  color: #4f7cff;
  font-size: 16px;
}

.docs__tool-title {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.docs__tool-title strong {
  font-size: 15px;
  color: var(--color-heading);
}

.docs__tool-title small {
  font-size: 12px;
  color: var(--color-text);
}

.docs__tool-protocol {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.docs__tool-protocol.is-openai {
  background: rgba(34, 197, 94, 0.14);
  color: #16a34a;
}

.docs__tool-protocol.is-anthropic {
  background: rgba(217, 119, 87, 0.16);
  color: #d97757;
}

.docs__tool-chevron {
  flex: none;
  font-size: 14px;
  color: var(--color-text);
  transition: transform 0.2s ease;
}

.docs__tool.is-open .docs__tool-chevron {
  transform: rotate(180deg);
}

.docs__tool-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 18px 18px;
  border-top: 1px solid var(--color-border);
  padding-top: 14px;
  background: var(--color-background);
}

.docs__platform-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.docs__tool-path {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 13px;
}

.docs__tool-path__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.docs__tool-path__head i {
  color: #4f7cff;
}

.docs__code-card--primary {
  border-color: rgba(79, 124, 255, 0.35);
  box-shadow: 0 0 0 1px rgba(79, 124, 255, 0.08) inset;
}

.docs__code-card--primary .docs__code-head span {
  color: #4f7cff;
  font-weight: 700;
}

.docs__tool-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 20px;
  color: var(--color-text);
  font-size: 14px;
}

.docs__tool-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.docs__tool-step-code {
  position: relative;
  margin-left: -4px;
}

.docs__code--step {
  margin: 0;
  padding: 12px 14px;
  padding-right: 88px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: var(--docs-terminal-bg);
  color: var(--docs-terminal-text);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.docs__copy--step {
  position: absolute;
  top: 8px;
  right: 8px;
}

.docs__tool-note {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: var(--color-text);
  font-size: 13px;
}

.docs__tool-note i {
  flex: none;
  color: #d97706;
}

/* ---------- SDK 分组 ---------- */

.docs__sdk-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.docs__sdk-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.docs__sdk-group i {
  font-size: 14px;
  opacity: 0.8;
}

.docs__sdk-group:hover {
  border-color: rgba(79, 124, 255, 0.3);
  color: var(--color-heading);
}

.docs__sdk-group.is-active {
  border-color: var(--docs-accent);
  background: var(--docs-accent-soft);
  color: var(--docs-accent);
}

.docs__tabs--sdk {
  margin-bottom: 4px;
}

/* ---------- 选项卡 ---------- */

.docs__tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.docs__tab {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.docs__tab:hover {
  border-color: var(--color-border-hover);
}

.docs__tab.is-active {
  background: #4f7cff;
  border-color: #4f7cff;
  color: #fff;
}

/* ---------- 计费 ---------- */

.docs__billing-flow {
  display: flex;
  align-items: stretch;
  gap: 12px;
  flex-wrap: wrap;
}

.docs__billing-step {
  flex: 1;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.docs__billing-step:hover {
  border-color: rgba(79, 124, 255, 0.25);
  transform: translateY(-2px);
}

.docs__billing-step i {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--docs-accent-soft);
  font-size: 16px;
  color: var(--docs-accent);
}

.docs__billing-step strong {
  font-size: 14px;
  color: var(--color-heading);
}

.docs__billing-step p {
  font-size: 13px;
  color: var(--color-text);
}

.docs__billing-arrow {
  align-self: center;
  color: var(--color-text);
  opacity: 0.5;
}

/* ---------- FAQ ---------- */

.docs__faqs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.docs__faq {
  border-radius: var(--docs-radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.docs__faq.is-open {
  border-color: rgba(79, 124, 255, 0.4);
  box-shadow: 0 4px 16px rgba(79, 124, 255, 0.08);
}

.docs__faq-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 16px 20px;
  border: none;
  background: transparent;
  color: var(--color-heading);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.docs__faq-head:hover {
  background: rgba(79, 124, 255, 0.04);
}

.docs__faq-head i {
  flex: none;
  font-size: 13px;
  color: var(--color-text);
  transition: transform 0.2s ease;
}

.docs__faq.is-open .docs__faq-head i {
  transform: rotate(180deg);
}

.docs__faq-body {
  padding: 0 18px 14px;
  font-size: 14px;
  color: var(--color-text);
}

.docs__inline-link {
  padding: 0;
  border: none;
  color: var(--pc-primary, #4f7cff);
  background: transparent;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.docs__inline-link:hover {
  opacity: 0.82;
}

/* ---------- 控制台内嵌 ---------- */

.docs.docs--embedded {
  --docs-surface: var(--pc-card, var(--docs-surface));
  --docs-surface-elevated: var(--pc-card, var(--docs-surface-elevated));
  --docs-accent: var(--pc-primary, var(--docs-accent));
  --docs-accent-soft: var(--pc-primary-soft, var(--docs-accent-soft));
  --color-heading: var(--pc-heading, var(--color-heading));
  --color-text: var(--pc-text, var(--color-text));
  --color-background-soft: var(--pc-card-soft, var(--color-background-soft));
  --color-background-mute: var(--pc-card-mute, var(--color-background-mute));
  --color-border: var(--pc-line, var(--color-border));
  width: 100%;
  min-height: 0;
  padding: 0;
  background: transparent;
  color: var(--pc-text, var(--color-text));
  font-size: 13px;
}

.docs.docs--embedded .docs__embedded-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.docs.docs--embedded .docs__embedded-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--pc-line, var(--color-border));
  border-radius: 999px;
  color: var(--pc-heading, var(--color-heading));
  background: transparent;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease;
}

.docs.docs--embedded .docs__embedded-action:hover {
  border-color: color-mix(in srgb, var(--pc-primary, #4f7cff) 34%, var(--pc-line, var(--color-border)));
  background: color-mix(in srgb, var(--pc-primary, #4f7cff) 6%, transparent);
}

.docs.docs--embedded .docs__embedded-action.is-primary {
  color: var(--pc-on-accent, #0e1210);
  background: linear-gradient(180deg, var(--pc-primary-strong, #7ee787) 0%, var(--pc-primary, #97ff7c) 100%);
  border-color: rgb(151 255 124 / 35%);
  box-shadow:
    0 3px 10px rgb(0 0 0 / 32%),
    inset 0 1px 0 rgb(255 255 255 / 28%);
}

.docs.docs--embedded .docs__embedded-action.is-primary:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

.docs.docs--embedded .docs__layout {
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  gap: 12px;
  width: 100%;
  max-width: none;
  margin: 0;
  align-items: start;
  padding-top: 0;
}

.docs.docs--embedded .docs__sidebar {
  align-self: start;
  max-width: 176px;
}

.docs.docs--embedded .docs__nav-card {
  z-index: 6;
  min-width: 136px;
  max-height: calc(100svh - var(--app-header-offset, 82px) - 36px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--pc-card, var(--docs-surface));
  border-color: var(--pc-line, var(--color-border));
}

.docs.docs--embedded .docs__nav {
  position: static;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

.docs.docs--embedded .docs__nav-link {
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  white-space: normal;
  text-align: left;
}

.docs.docs--embedded .docs__nav-link.is-active {
  color: var(--pc-primary, #4f7cff);
  background: color-mix(in srgb, var(--pc-primary, #4f7cff) 10%, transparent);
}

.docs.docs--embedded .docs__content {
  gap: 28px;
  min-width: 0;
}

.docs.docs--embedded .docs__section {
  gap: 12px;
  padding: 18px 20px;
  scroll-margin-top: 12px;
  border: none;
  border-radius: 14px;
  background: var(--pc-surface-bg-raised, var(--pc-card, var(--docs-surface)));
  box-shadow: var(--pc-surface-shadow, var(--docs-shadow));
}

.docs.docs--embedded .docs__section-head {
  padding-bottom: 12px;
}

.docs.docs--embedded .docs__section-head h2 {
  font-size: 18px;
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__section-head p,
.docs.docs--embedded .docs__text,
.docs.docs--embedded .docs__hint,
.docs.docs--embedded .docs__step-body p,
.docs.docs--embedded .docs__feature p {
  color: var(--pc-text, var(--color-text));
}

.docs.docs--embedded .docs__feature h3,
.docs.docs--embedded .docs__step-body h3,
.docs.docs--embedded .docs__subheading {
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__section-icon {
  width: 36px;
  height: 36px;
  font-size: 15px;
}

.docs.docs--embedded .docs__section h2 {
  font-size: 18px;
  padding-bottom: 8px;
  border-bottom-color: var(--pc-line, var(--color-border));
}

.docs.docs--embedded .docs__features {
  gap: 10px;
}

.docs.docs--embedded .docs__feature,
.docs.docs--embedded .docs__faq,
.docs.docs--embedded .docs__tool,
.docs.docs--embedded .docs__step,
.docs.docs--embedded .docs__billing-step,
.docs.docs--embedded .docs__tool-body {
  background: var(--pc-card-soft, var(--color-background-soft));
  border-color: var(--pc-line, var(--color-border));
}

.docs.docs--embedded .docs__copy {
  border: none;
  background: linear-gradient(180deg, rgb(0 0 0 / 18%), rgb(255 255 255 / 4%) 100%);
  box-shadow: var(--pc-panel-sunken, inset 0 2px 5px rgb(0 0 0 / 38%));
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__copy:hover {
  color: var(--pc-heading, var(--color-heading));
  background: linear-gradient(180deg, rgb(151 255 124 / 10%), rgb(151 255 124 / 4%) 100%);
}

.docs.docs--embedded .docs__table thead th {
  background: color-mix(in srgb, var(--pc-line, var(--color-border)) 10%, transparent);
}

.docs.docs--embedded .docs__code-card,
.docs.docs--embedded .docs__table-wrap,
.docs.docs--embedded .docs__endpoint {
  border-color: var(--pc-line, var(--color-border));
  background: color-mix(in srgb, var(--pc-line, var(--color-border)) 8%, transparent);
}

.docs.docs--embedded .docs__endpoint {
  background: color-mix(in srgb, var(--pc-primary, #4f7cff) 6%, transparent);
  border-color: color-mix(in srgb, var(--pc-primary, #4f7cff) 24%, var(--pc-line, var(--color-border)));
}

.docs.docs--embedded .docs__code-head {
  background: color-mix(in srgb, var(--pc-line, var(--color-border)) 12%, transparent);
}

.docs.docs--embedded .docs__callout {
  background: color-mix(in srgb, var(--pc-primary, #4f7cff) 6%, transparent);
  border-color: color-mix(in srgb, var(--pc-primary, #4f7cff) 22%, var(--pc-line, var(--color-border)));
}

.docs.docs--embedded .docs__tabs {
  border-color: var(--pc-line, var(--color-border));
  background: transparent;
}

.docs.docs--embedded .docs__tab.is-active {
  background: color-mix(in srgb, var(--pc-primary, #4f7cff) 12%, transparent);
}

.docs.docs--embedded .docs__nav-title {
  color: var(--pc-muted, var(--color-text));
}

.docs.docs--embedded .docs__nav-link {
  color: var(--pc-text, var(--color-text));
}

.docs.docs--embedded .docs__endpoint {
  background: color-mix(in srgb, var(--pc-primary, #4f7cff) 8%, var(--pc-card-soft, transparent));
  border-color: color-mix(in srgb, var(--pc-primary, #4f7cff) 24%, var(--pc-line, var(--color-border)));
}

.docs.docs--embedded .docs__endpoint code {
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__endpoint-label {
  color: var(--pc-muted, var(--color-text));
}

.docs.docs--embedded .docs__protocol {
  background: var(--pc-card-soft, var(--color-background-soft));
  border-color: var(--pc-line, var(--color-border));
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__pick-card {
  background: var(--pc-card-soft, var(--color-background-soft));
  border-color: var(--pc-line, var(--color-border));
}

.docs.docs--embedded .docs__pick-card strong,
.docs.docs--embedded .docs__pick-label {
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__pick-card p {
  color: var(--pc-text, var(--color-text));
}

.docs.docs--embedded .docs__pick-link,
.docs.docs--embedded .docs__inline-link,
.docs.docs--embedded .docs__step-link {
  color: var(--pc-primary, var(--docs-accent));
}

.docs.docs--embedded .docs__text a {
  color: var(--pc-primary, var(--docs-accent));
}

.docs.docs--embedded code {
  color: var(--pc-heading, var(--color-heading));
  background: var(--pc-card-mute, var(--color-background-mute));
}

.docs.docs--embedded .docs__table td,
.docs.docs--embedded .docs__table th {
  color: var(--pc-text, var(--color-text));
  border-color: var(--pc-line, var(--color-border));
}

.docs.docs--embedded .docs__faq-head {
  color: var(--pc-heading, var(--color-heading));
}

.docs.docs--embedded .docs__faq-body {
  color: var(--pc-text, var(--color-text));
}

/* ---------- 响应式 ---------- */

@media (max-width: 1024px) {
  .docs__hero-inner {
    grid-template-columns: 1fr;
  }

  .docs__hero-aside {
    max-width: 480px;
  }

  .docs__layout {
    grid-template-columns: 1fr;
    gap: 0;
    padding-top: 24px;
  }

  .docs__sidebar {
    position: sticky;
    top: var(--app-header-offset, 82px);
    z-index: 30;
    margin: 0 0 16px;
    padding: 0;
    background: color-mix(in srgb, var(--docs-surface) 92%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--color-border);
  }

  .docs__nav-card {
    padding: 8px 0;
    border: none;
    box-shadow: none;
    background: transparent;
    max-height: none;
    overflow: visible;
  }

  .docs__nav-title {
    display: none;
  }

  .docs__nav {
    flex-direction: row;
    overflow-x: auto;
    gap: 6px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .docs__nav::-webkit-scrollbar {
    display: none;
  }

  .docs__nav-link {
    grid-template-columns: auto auto;
    flex: none;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--docs-surface);
    white-space: nowrap;
  }

  .docs__nav-link.is-active {
    border-color: var(--docs-accent);
  }
}

@media (max-width: 900px) {
  .docs.docs--embedded .docs__layout {
    display: block;
  }

  .docs.docs--embedded .docs__nav {
    position: sticky;
    top: 0;
    z-index: 5;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    margin: 0 0 12px;
    padding: 4px;
    border: 1px solid var(--pc-line, var(--color-border));
    background: transparent;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }

  .docs.docs--embedded .docs__nav-link {
    flex: none;
    border-left: none;
    border-radius: 999px;
    white-space: nowrap;
  }

  .docs.docs--embedded .docs__nav-link.is-active {
    background: color-mix(in srgb, var(--pc-primary, #4f7cff) 12%, transparent);
  }

  .docs__nav {
    position: sticky;
    top: var(--app-header-offset, 72px);
    z-index: 20;
    flex-direction: row;
    overflow-x: auto;
    gap: 4px;
    margin: 0;
    padding: 0;
    background: transparent;
    border-bottom: none;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .docs__nav::-webkit-scrollbar {
    display: none;
  }

  .docs__nav-link {
    flex: none;
    border-radius: 999px;
    padding: 7px 12px;
    white-space: nowrap;
  }

  .docs__nav-link.is-active {
    background: var(--docs-accent-soft);
  }

  .docs__features {
    grid-template-columns: 1fr;
  }

  .docs__pick-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .docs__url-cards {
    grid-template-columns: 1fr;
  }

  .docs__billing-arrow {
    display: none;
  }
}

@media (max-width: 640px) {
  .docs {
    padding: 0 16px 64px;
  }

  .docs__hero {
    margin: 0 -16px 32px;
    padding: 40px 16px 32px;
  }

  .docs__hero-main h1 {
    font-size: 26px;
  }

  .docs__hero-stats {
    grid-template-columns: 1fr;
  }

  .docs__sidebar {
    margin: 0 0 12px;
    padding: 0;
  }

  .docs__section {
    padding: 20px 18px;
  }

  .docs__section-head {
    gap: 12px;
  }

  .docs__section-icon {
    width: 38px;
    height: 38px;
    font-size: 16px;
  }

  .docs__content {
    gap: 16px;
  }

  .docs__tool-head {
    flex-wrap: wrap;
  }

  .docs__pick-grid {
    grid-template-columns: 1fr;
  }

  .docs__tier-badge {
    order: 2;
  }

  .docs__tool-protocol {
    order: 3;
  }
}
</style>

<style>
/* 解除全局 overflow-x 对 sticky 侧栏的干扰（仅 /docs 独立页） */
html.docs-page-active,
html.docs-page-active #app,
html.docs-page-active .app-container,
html.docs-page-active .main-content {
  overflow-x: visible;
}
</style>
