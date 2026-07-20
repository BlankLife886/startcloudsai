<script setup>
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { resolveAiFeatureRuntimeConfig } from '@/config/aiFeatureSettings'
import { createServerAiJob, waitForServerAiJob } from '@/services/aiWallpaper'
import { computed, onMounted, ref } from 'vue'

const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()

const isAnalyzing = ref(false)
const errorMessage = ref('')
const rawResult = ref('')
const analysis = ref(null)
const activeResultTab = ref('insights')
const showPayloadModal = ref(false)

function normalizeBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

function resolveAiConfig() {
  const config = resolveAiFeatureRuntimeConfig(settingsStore, 'profile', {
    runtimeConfig: runtimeConfigStore.config,
    runtimeModelCatalog: runtimeConfigStore.getAiModelCatalog(),
  })
  return {
    provider: config.publicModel ? '' : config.provider,
    baseUrl: normalizeBaseUrl(config.baseUrl),
    model: config.model,
    publicModelKey: config.publicModel?.id || '',
    source: config.publicModel ? '后台 AI 中转站' : '后台服务商路由',
  }
}

const aiConfig = computed(resolveAiConfig)
const canAnalyze = computed(() =>
  Boolean(aiConfig.value.model && authStore.isAuthenticated),
)
const aiRuntimeLabel = computed(() =>
  authStore.isAuthenticated ? 'CLOUD' : 'LOGIN_REQUIRED',
)
const neuralMetrics = computed(() => {
  const favorites = favoritesStore.favorites.length
  const history = historyStore.history.length
  const collections = favoritesStore.collections.length
  const colors = favoritesStore.favorites.filter(
    (item) => Array.isArray(item.colors) && item.colors.length,
  ).length
  return [
    { label: 'FAV', value: favorites },
    { label: 'HIS', value: history },
    { label: 'COL', value: collections },
    { label: 'CLR', value: colors },
  ]
})

const resultTabs = [
  { id: 'insights', label: '洞察' },
  { id: 'recommendations', label: '建议' },
  { id: 'scores', label: '评分' },
]

const payloadStats = computed(() => {
  const payload = buildProfilePayload()
  return [
    { label: '收藏', value: payload.totals.favorites },
    { label: '浏览', value: payload.totals.history },
    { label: '收藏夹', value: payload.totals.collections },
    { label: '样本', value: payload.recentSamples.length },
  ]
})

function countBy(items, getter, fallback = '未知') {
  return items.reduce((acc, item) => {
    const key = getter(item) || fallback
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function topEntries(record, limit = 8) {
  return Object.entries(record || {})
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

function parseResolution(item) {
  const width = Number(item?.dimension_x)
  const height = Number(item?.dimension_y)
  if (width > 0 && height > 0) return { width, height, ratio: width / height }
  const match = String(item?.resolution || '').match(/(\d+)\s*x\s*(\d+)/i)
  if (!match) return null
  const parsedWidth = Number(match[1])
  const parsedHeight = Number(match[2])
  if (!parsedWidth || !parsedHeight) return null
  return { width: parsedWidth, height: parsedHeight, ratio: parsedWidth / parsedHeight }
}

function buildProfilePayload() {
  const favorites = favoritesStore.favorites
  const history = historyStore.history
  const collections = favoritesStore.collections
  const colors = {}
  let landscape = 0
  let portrait = 0
  let square = 0
  let highRes = 0
  let publicViews = 0
  let publicFavorites = 0
  let heatCount = 0

  favorites.forEach((item) => {
    const parsed = parseResolution(item)
    if (parsed) {
      if (parsed.ratio > 1.15) landscape += 1
      else if (parsed.ratio < 0.87) portrait += 1
      else square += 1
      if (parsed.width * parsed.height >= 3840 * 2160) highRes += 1
    }
    if (Array.isArray(item.colors)) {
      item.colors.slice(0, 6).forEach((color) => {
        colors[color] = (colors[color] || 0) + 1
      })
    }
    if (Number.isFinite(Number(item.views)) || Number.isFinite(Number(item.favorites))) {
      publicViews += Number(item.views) || 0
      publicFavorites += Number(item.favorites) || 0
      heatCount += 1
    }
  })

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentFavorites = favorites.filter((item) => {
    return new Date(item.favorited_at || item.created_at || 0).getTime() >= weekAgo
  }).length
  const recentViews = history.filter((item) => {
    return new Date(item.viewed_at || 0).getTime() >= weekAgo
  }).length

  return {
    totals: {
      favorites: favorites.length,
      collections: collections.length,
      history: history.length,
      recentFavorites,
      recentViews,
    },
    imagePortrait: {
      landscape,
      portrait,
      square,
      highRes,
      averagePublicViews: heatCount ? Math.round(publicViews / heatCount) : 0,
      publicFavorites,
    },
    distributions: {
      categories: topEntries(
        countBy(favorites, (item) => item.category),
        6,
      ),
      purity: topEntries(
        countBy(favorites, (item) => item.purity),
        6,
      ),
      resolutions: topEntries(
        countBy(favorites, (item) => item.resolution),
        8,
      ),
      colors: topEntries(colors, 8),
      sources: topEntries(
        countBy(history, (item) => item.source),
        6,
      ),
    },
    collections: collections
      .map((item) => ({
        name: item.name,
        count: item.count || 0,
        empty: !item.count,
        updated_at: item.updated_at,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    recentSamples: [...favorites, ...history]
      .filter((item) => item?.id)
      .slice(0, 16)
      .map((item) => ({
        id: item.id,
        category: item.category,
        purity: item.purity,
        resolution: item.resolution,
        colors: Array.isArray(item.colors) ? item.colors.slice(0, 4) : [],
      })),
  }
}

const aiPayloadSnapshot = computed(() => {
  const payload = buildProfilePayload()
  return {
    system:
      '你是顶级视觉数据分析师和产品体验顾问。请基于用户个人中心的收藏、浏览、图片元数据做严谨分析，只使用提供的数据，不编造事实。输出必须是 JSON。',
    user: {
      task: '分析 Wallhaven 个人中心数据，返回 JSON：summary:string, persona:string, scores:[{label,value,reason}], insights:[{title,detail,priority}], recommendations:[{title,detail,action}], risks:[string]。中文输出，适合渲染到 UI。',
      data: payload,
    },
  }
})

function buildMessages(payload) {
  return [
    {
      role: 'system',
      content:
        '你是顶级视觉数据分析师和产品体验顾问。请基于用户个人中心的收藏、浏览、图片元数据做严谨分析，只使用提供的数据，不编造事实。输出必须是 JSON。',
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: '分析 Wallhaven 个人中心数据，返回 JSON：summary:string, persona:string, scores:[{label,value,reason}], insights:[{title,detail,priority}], recommendations:[{title,detail,action}], risks:[string]。中文输出，适合渲染到 UI。',
        data: payload,
      }),
    },
  ]
}

function extractJson(text) {
  const value = String(text || '').trim()
  try {
    return JSON.parse(value)
  } catch {
    const match = value.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('AI 未返回可解析 JSON')
    return JSON.parse(match[0])
  }
}

async function requestAiAnalysis() {
  await authStore.initAuth().catch(() => null)
  const config = aiConfig.value
  if (!authStore.isAuthenticated) {
    errorMessage.value = '使用云端 AI 分析需要先登录账号。'
    return
  }
  if (!config.model) {
    errorMessage.value = '个人中心 AI 分析暂不可用。'
    return
  }

  isAnalyzing.value = true
  errorMessage.value = ''
  rawResult.value = ''

  try {
    const payload = buildProfilePayload()
    const content = await requestServerAiAnalysis(config, payload)
    rawResult.value = content
    analysis.value = extractJson(content)
    activeResultTab.value = 'insights'
  } catch (error) {
    console.error('AI 分析失败:', error)
    errorMessage.value = error?.message || 'AI 分析失败'
  } finally {
    isAnalyzing.value = false
  }
}

async function requestServerAiAnalysis(config, payload) {
  const response = await createServerAiJob({
    kind: 'profile-analysis',
    prompt: '分析 Wallhaven 个人中心数据并返回 JSON',
    input: {
      payload,
    },
    params: {
      providerHint: config.publicModelKey ? '' : config.provider,
      modelHint: config.model,
      publicModelKey: config.publicModelKey,
      payload,
      executionMode: 'server',
    },
    units: 1,
  })
  const jobId = response.job?.id
  if (!jobId) throw new Error('云端 AI 分析任务创建后未返回 ID')
  const { result } = await waitForServerAiJob(jobId, {
    maxPolls: 80,
    intervalMs: 2500,
  })
  return String(result?.output?.output || result?.output || result?.result || '').trim()
}

onMounted(() => {
  runtimeConfigStore.loadRuntimeConfig().catch(() => null)
  authStore.initAuth().catch(() => null)
})

function openPayloadModal() {
  showPayloadModal.value = true
}

function closePayloadModal() {
  showPayloadModal.value = false
}
</script>

<template>
  <section class="ai-analysis" :class="{ scanning: isAnalyzing, resolved: analysis }">
    <header class="ai-command-bar">
      <div class="ai-brand">
        <span class="ai-sigil"><i class="bi bi-stars"></i></span>
        <div>
          <strong>AI 审美分析</strong>
          <small>{{ authStore.isAuthenticated ? '云端就绪' : '需要登录' }}</small>
        </div>
      </div>

      <div class="ai-status-stack">
        <span :class="{ online: canAnalyze }">{{ canAnalyze ? '可用' : '登录后可用' }}</span>
        <em>{{ aiConfig.source || '云端路由' }}</em>
      </div>

      <div class="ai-actions">
        <button class="ai-input-btn" type="button" @click="openPayloadModal">
          <i class="bi bi-code-slash"></i>
          <span>查看输入</span>
        </button>

        <button
          class="ai-runner"
          type="button"
          :disabled="isAnalyzing || !canAnalyze"
          @click="requestAiAnalysis"
        >
          <i class="bi" :class="isAnalyzing ? 'bi-arrow-repeat' : 'bi-cpu-fill'"></i>
          <span>{{ isAnalyzing ? '分析中' : '开始分析' }}</span>
        </button>
      </div>
    </header>

    <div class="ai-stage">
      <aside class="ai-core">
        <div class="core-ring">
          <div class="core-pulse"></div>
          <strong>{{ analysis?.persona || '等待分析' }}</strong>
        </div>

        <div class="metric-rails">
          <div v-for="metric in neuralMetrics" :key="metric.label">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </div>
        </div>

        <div class="signal-stack">
          <span>云端 AI</span>
          <span>{{ aiRuntimeLabel }}</span>
          <span>{{ isAnalyzing ? '同步中' : analysis ? '完成' : '待命' }}</span>
        </div>
      </aside>

      <main class="ai-viewport">
        <div v-if="errorMessage" class="ai-alert">
          <i class="bi bi-exclamation-triangle"></i>
          <span>{{ errorMessage }}</span>
        </div>

        <div v-else-if="isAnalyzing" class="scan-console">
          <div class="scan-line"></div>
          <strong>正在分析个人审美画像</strong>
          <span>采集数据 · 建模偏好 · 生成洞察</span>
          <div class="scan-dots"><i></i><i></i><i></i><i></i><i></i></div>
        </div>

        <div v-else-if="analysis" class="ai-result">
          <section class="ai-hero-result">
            <span>分析结果</span>
            <h5>{{ analysis.persona || '视觉偏好画像' }}</h5>
            <p>{{ analysis.summary }}</p>
          </section>

          <div class="result-tabs">
            <button
              v-for="tab in resultTabs"
              :key="tab.id"
              type="button"
              :class="{ active: activeResultTab === tab.id }"
              @click="activeResultTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div v-if="activeResultTab === 'insights'" class="neural-feed">
            <article v-for="item in (analysis.insights || []).slice(0, 5)" :key="item.title">
              <em>{{ item.priority || 'P' }}</em>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.detail }}</p>
              </div>
            </article>
          </div>

          <div v-else-if="activeResultTab === 'recommendations'" class="directive-grid">
            <article v-for="item in (analysis.recommendations || []).slice(0, 4)" :key="item.title">
              <span>{{ item.action || '建议' }}</span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </article>
          </div>

          <div v-else class="score-matrix">
            <article v-for="score in (analysis.scores || []).slice(0, 6)" :key="score.label">
              <span>{{ score.label }}</span>
              <strong>{{ score.value }}</strong>
              <p>{{ score.reason }}</p>
            </article>
          </div>
        </div>

        <div v-else class="idle-console">
          <div class="idle-code">
            <span>01</span><span>数据已就绪</span>
            <span>02</span><span>画像字段已锁定</span>
            <span>03</span><span>等待开始分析</span>
          </div>
          <button type="button" :disabled="!canAnalyze" @click="requestAiAnalysis">
            开始 AI 分析
          </button>
        </div>
      </main>
    </div>

    <teleport to="body">
      <transition name="ai-modal-fade">
        <div v-if="showPayloadModal" class="ai-modal-backdrop" @click.self="closePayloadModal">
          <section
            class="ai-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-input-title"
          >
            <header class="ai-modal-header">
              <div>
                <span>输入预览</span>
                <h4 id="ai-input-title">本次分析输入</h4>
              </div>
              <button type="button" class="ai-modal-close" @click="closePayloadModal">
                <i class="bi bi-x-lg"></i>
              </button>
            </header>

            <div class="ai-modal-body">
              <div class="payload-metrics">
                <div v-for="item in payloadStats" :key="item.label">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>

              <section class="payload-panel payload-system">
                <h5>System Prompt</h5>
                <pre>{{ aiPayloadSnapshot.system }}</pre>
              </section>

              <section class="payload-panel payload-task">
                <h5>User Task</h5>
                <pre>{{ aiPayloadSnapshot.user.task }}</pre>
              </section>

              <section class="payload-panel payload-json">
                <h5>Payload JSON</h5>
                <pre>{{ JSON.stringify(aiPayloadSnapshot.user.data, null, 2) }}</pre>
              </section>
            </div>
          </section>
        </div>
      </transition>
    </teleport>
  </section>
</template>

<style scoped>
.ai-analysis {
  --ai-card: var(--pf-card, #ffffff);
  --ai-line: var(--pf-line, rgba(21, 26, 45, 0.1));
  --ai-accent: var(--pf-accent, #6a4fe0);
  --ai-accent-bright: var(--pf-accent-bright, #8568f7);
  --ai-accent-soft: var(--pf-accent-soft, rgba(106, 79, 224, 0.1));
  --ai-heading: var(--pf-heading, #151a2d);
  --ai-text: var(--pf-text, #3a4258);
  --ai-muted: var(--pf-muted, #79809a);
  --ai-stamp: var(--pf-stamp, 4px 4px 0 rgba(106, 79, 224, 0.18));
  --ai-stamp-soft: var(--pf-stamp-soft, 3px 3px 0 rgba(106, 79, 224, 0.12));
  --ai-mono: var(--pf-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  --ai-song: var(--pf-song, 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif);
  --ai-on-accent: var(--pf-on-accent, #ffffff);

  position: relative;
  display: grid;
  gap: 14px;
  padding: 14px;
  overflow: hidden;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  color: var(--ai-text);
  background:
    linear-gradient(135deg, rgba(106, 79, 224, 0.08), transparent 42%),
    var(--ai-card);
  box-shadow: var(--ai-stamp);
  isolation: isolate;
}

.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.ai-command-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 58px;
  padding: 10px;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background: var(--ai-accent-soft);
}

.ai-brand {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.ai-sigil {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  color: var(--ai-accent);
  background: var(--ai-card);
  box-shadow: var(--ai-stamp-soft);
}

.ai-brand strong,
.ai-brand small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-brand strong {
  color: var(--ai-heading);
  font-family: var(--ai-song);
  font-size: 1rem;
  font-weight: 760;
}

.ai-brand small {
  margin-top: 2px;
  color: var(--ai-muted);
  font-size: 0.72rem;
}

.ai-status-stack {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
}

.ai-status-stack span,
.ai-status-stack em {
  padding: 4px 8px;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  color: var(--ai-muted);
  background: var(--ai-card);
  font-size: 0.7rem;
  font-style: normal;
  font-weight: 760;
}

.ai-status-stack span.online {
  color: var(--ai-accent);
  border-color: rgba(106, 79, 224, 0.35);
}

.ai-input-btn,
.ai-runner {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--ai-accent);
  border-radius: 0;
  color: var(--ai-on-accent);
  background: var(--ai-accent);
  font-weight: 760;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.24);
  cursor: pointer;
}

.ai-input-btn {
  color: var(--ai-accent);
  background: var(--ai-card);
  box-shadow: var(--ai-stamp-soft);
}

.ai-runner:disabled {
  cursor: not-allowed;
  filter: grayscale(0.4);
  opacity: 0.58;
}

.ai-stage {
  display: grid;
  grid-template-columns: minmax(220px, 0.34fr) minmax(0, 0.66fr);
  gap: 14px;
  align-items: stretch;
}

.ai-core,
.ai-viewport {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background: var(--ai-card);
}

.ai-core {
  gap: 12px;
  padding: 14px;
  position: relative;
  overflow: hidden;
  box-shadow: var(--ai-stamp-soft);
}

.core-ring {
  position: relative;
  display: grid;
  min-height: 180px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background:
    radial-gradient(circle at 50% 42%, rgba(106, 79, 224, 0.16), transparent 58%),
    var(--ai-accent-soft);
}

.core-pulse {
  position: absolute;
  width: 42px;
  height: 42px;
  border-radius: 0;
  background: var(--ai-accent);
  opacity: 0.28;
  animation: corePulse 1.8s ease-in-out infinite;
}

.core-ring strong {
  z-index: 1;
  max-width: 82%;
  color: var(--ai-heading);
  font-family: var(--ai-song);
  font-size: 0.92rem;
  text-align: center;
}

.metric-rails {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-rails div,
.signal-stack span {
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background: var(--ai-accent-soft);
}

.metric-rails div {
  padding: 9px;
}

.metric-rails span {
  color: var(--ai-muted);
  font-size: 0.7rem;
  font-weight: 760;
}

.metric-rails strong {
  display: block;
  margin-top: 3px;
  color: var(--ai-heading);
  font-family: var(--ai-mono);
  font-size: 1.1rem;
  line-height: 1;
}

.signal-stack {
  display: grid;
  gap: 7px;
  margin-top: auto;
}

.signal-stack span {
  padding: 7px 9px;
  color: var(--ai-accent);
  font-family: var(--ai-mono);
  font-size: 0.75rem;
}

.ai-viewport {
  position: relative;
  min-height: 420px;
  padding: 14px;
  overflow: hidden;
  box-shadow: var(--ai-stamp-soft);
}

.ai-alert,
.idle-console,
.scan-console {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 12px;
  padding: 18px;
  border-radius: 0;
}

.ai-alert {
  color: #b42318;
  border: 1px solid rgba(180, 35, 24, 0.24);
  background: rgba(180, 35, 24, 0.08);
}

.idle-console,
.scan-console {
  flex-direction: column;
  align-items: flex-start;
  border: 1px dashed var(--ai-line);
  background: var(--ai-accent-soft);
}

.idle-code {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
  color: var(--ai-text);
  font-family: var(--ai-mono);
  font-size: 0.82rem;
}

.idle-code span:nth-child(odd) {
  color: var(--ai-accent);
}

.idle-console button {
  margin-top: 10px;
  min-height: 38px;
  padding: 8px 13px;
  border: 1px solid var(--ai-accent);
  border-radius: 0;
  color: var(--ai-on-accent);
  background: var(--ai-accent);
  font-weight: 760;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.24);
  cursor: pointer;
}

.idle-console button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.scan-console {
  position: relative;
  overflow: hidden;
}

.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--ai-accent);
  box-shadow: 0 0 18px rgba(106, 79, 224, 0.45);
  animation: scanLine 1.4s linear infinite;
}

.scan-console strong {
  color: var(--ai-heading);
  font-family: var(--ai-song);
  margin-top: 18px;
}

.scan-console span {
  color: var(--ai-muted);
  font-size: 0.78rem;
}

.scan-dots {
  display: flex;
  gap: 8px;
}

.scan-dots i {
  width: 8px;
  height: 8px;
  border-radius: 0;
  background: var(--ai-accent);
  animation: dotPulse 1s ease-in-out infinite;
}

.scan-dots i:nth-child(2) {
  animation-delay: 0.12s;
}
.scan-dots i:nth-child(3) {
  animation-delay: 0.24s;
}
.scan-dots i:nth-child(4) {
  animation-delay: 0.36s;
}
.scan-dots i:nth-child(5) {
  animation-delay: 0.48s;
}

.ai-result {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 12px;
  min-height: 0;
  position: relative;
  z-index: 1;
}

.ai-hero-result {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background:
    linear-gradient(135deg, rgba(106, 79, 224, 0.12), rgba(160, 139, 255, 0.06)),
    var(--ai-card);
  box-shadow: var(--ai-stamp-soft);
}

.ai-hero-result span,
.result-tabs button,
.neural-feed em,
.directive-grid span,
.score-matrix span {
  font-family: var(--ai-mono);
}

.ai-hero-result span {
  color: var(--ai-accent);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ai-hero-result h5 {
  margin: 0;
  color: var(--ai-heading);
  font-family: var(--ai-song);
  font-size: 1.12rem;
  font-weight: 760;
}

.ai-hero-result p,
.neural-feed p,
.directive-grid p,
.score-matrix p {
  margin: 0;
  color: var(--ai-text);
  line-height: 1.5;
}

.result-tabs {
  display: flex;
  gap: 8px;
  padding: 2px;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background: var(--ai-accent-soft);
}

.result-tabs button {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 0;
  color: var(--ai-muted);
  background: transparent;
  cursor: pointer;
}

.result-tabs button.active {
  color: var(--ai-on-accent);
  background: var(--ai-accent);
}

.neural-feed {
  display: grid;
  gap: 8px;
}

.neural-feed article {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background: var(--ai-card);
}

.neural-feed em {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 0;
  color: var(--ai-accent);
  background: var(--ai-accent-soft);
  font-style: normal;
  font-weight: 760;
}

.neural-feed strong,
.directive-grid strong,
.score-matrix strong {
  display: block;
  margin-bottom: 4px;
  color: var(--ai-heading);
}

.directive-grid,
.score-matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.directive-grid article,
.score-matrix article {
  padding: 10px;
  border: 1px solid var(--ai-line);
  border-radius: 0;
  background: var(--ai-accent-soft);
}

.directive-grid span,
.score-matrix span {
  display: inline-block;
  margin-bottom: 6px;
  color: var(--ai-accent);
  font-size: 0.68rem;
}

.score-matrix strong {
  font-family: var(--ai-mono);
}

.scanning .ai-runner i {
  animation: spin 1s linear infinite;
}

.ai-modal-fade-enter-active,
.ai-modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.ai-modal-fade-enter-from,
.ai-modal-fade-leave-to {
  opacity: 0;
}

.ai-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(21, 26, 45, 0.56);
  backdrop-filter: blur(10px);
}

.ai-modal-panel {
  width: min(1080px, calc(100vw - 36px));
  max-height: min(72vh, 680px);
  overflow: hidden;
  border: 1px solid rgba(106, 79, 224, 0.28);
  border-radius: 0;
  background:
    linear-gradient(135deg, rgba(106, 79, 224, 0.1), transparent 40%),
    #ffffff;
  color: #3a4258;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.18), 0 24px 72px rgba(58, 51, 112, 0.18);
}

html.color-scheme-dark .ai-modal-panel {
  background:
    linear-gradient(135deg, rgba(160, 139, 255, 0.12), transparent 40%),
    #151826;
  color: rgba(244, 242, 255, 0.88);
  border-color: rgba(160, 139, 255, 0.32);
}

.ai-modal-backdrop,
.ai-modal-panel {
  overscroll-behavior: contain;
}

.ai-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px 10px;
  border-bottom: 1px solid rgba(21, 26, 45, 0.1);
}

html.color-scheme-dark .ai-modal-header {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

.ai-modal-header span,
.ai-modal-body h5 {
  color: #6a4fe0;
  font-family: var(--ai-mono);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

html.color-scheme-dark .ai-modal-header span,
html.color-scheme-dark .ai-modal-body h5 {
  color: #a08bff;
}

.ai-modal-header h4 {
  margin: 4px 0 0;
  color: #151a2d;
  font-family: var(--ai-song);
  font-size: 1.05rem;
}

html.color-scheme-dark .ai-modal-header h4 {
  color: #f4f2ff;
}

.ai-modal-close {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(21, 26, 45, 0.1);
  border-radius: 0;
  color: #3a4258;
  background: rgba(106, 79, 224, 0.08);
  cursor: pointer;
}

html.color-scheme-dark .ai-modal-close {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(244, 242, 255, 0.88);
  background: rgba(160, 139, 255, 0.1);
}

.ai-modal-body {
  display: grid;
  gap: 10px;
  max-height: calc(72vh - 64px);
  padding: 16px 18px 18px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(106, 79, 224, 0.45) rgba(106, 79, 224, 0.08);
}

.payload-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.payload-metrics div {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid rgba(21, 26, 45, 0.1);
  border-radius: 0;
  background: rgba(106, 79, 224, 0.06);
}

html.color-scheme-dark .payload-metrics div,
html.color-scheme-dark .payload-panel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(160, 139, 255, 0.08);
}

.payload-metrics span {
  color: #6a4fe0;
  font-family: var(--ai-mono);
  font-size: 0.7rem;
}

html.color-scheme-dark .payload-metrics span {
  color: #a08bff;
}

.payload-metrics strong {
  color: #151a2d;
  font-family: var(--ai-mono);
  font-size: 1rem;
}

html.color-scheme-dark .payload-metrics strong {
  color: #f4f2ff;
}

.payload-panel {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid rgba(21, 26, 45, 0.1);
  border-radius: 0;
  background: rgba(106, 79, 224, 0.04);
}

.payload-panel h5 {
  margin: 0;
}

.payload-panel pre {
  margin: 0;
  padding: 0;
  overflow: visible;
  border: none;
  border-radius: 0;
  color: inherit;
  background: transparent;
  font-family: var(--ai-mono);
  font-size: 0.78rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.payload-json pre {
  min-height: 140px;
}

@media (max-width: 768px) {
  .ai-stage {
    grid-template-columns: 1fr;
  }

  .ai-actions {
    width: 100%;
    justify-content: stretch;
  }

  .ai-actions button {
    flex: 1 1 0;
    justify-content: center;
  }

  .payload-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ai-modal-panel {
    width: calc(100vw - 20px);
    max-height: calc(78vh);
  }

  .ai-command-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .ai-runner {
    width: 100%;
    justify-content: center;
  }

  .directive-grid,
  .score-matrix {
    grid-template-columns: 1fr;
  }
}

@keyframes corePulse {
  0%,
  100% {
    transform: scale(0.86);
    opacity: 0.35;
  }
  50% {
    transform: scale(1);
    opacity: 0.55;
  }
}

@keyframes scanLine {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(392px);
  }
}

@keyframes dotPulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
