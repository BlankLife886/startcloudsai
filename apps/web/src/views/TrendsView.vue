<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchTrendSnapshot } from '@/services/trends'

const snapshot = ref({ items: [], sources: [], summary: {} })
const loading = ref(true)
const refreshing = ref(false)
const error = ref('')
const query = ref('')
const activeGroup = ref('')
const activeSource = ref('')
let refreshTimer = 0

const groups = [
  { id: '', label: '全域' },
  { id: 'social', label: '内容平台' },
  { id: 'commerce', label: '消费趋势' },
  { id: 'news', label: '新闻' },
  { id: 'ai', label: 'AI' },
]
const sourceMap = computed(() => new Map(snapshot.value.sources.map((item) => [item.key, item])))
const items = computed(() => snapshot.value.items || [])
const peakScore = computed(() => Math.max(1, ...items.value.map((item) => Number(item.score || 0))))

async function loadTrends({ refresh = false } = {}) {
  if (refresh) refreshing.value = true
  else loading.value = true
  error.value = ''
  try {
    snapshot.value = await fetchTrendSnapshot({
      source: activeSource.value,
      group: activeSource.value ? '' : activeGroup.value,
      query: query.value,
      refresh,
      limit: 120,
    })
  } catch (caught) {
    error.value = caught?.message || '热点读取失败'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function selectGroup(group) {
  activeGroup.value = group
  activeSource.value = ''
  loadTrends()
}

function selectSource(source) {
  activeSource.value = activeSource.value === source ? '' : source
  loadTrends()
}

function scoreWidth(item) {
  return `${Math.max(8, Math.round((Number(item.score || 0) / peakScore.value) * 100))}%`
}

function formatTime(value) {
  if (!value) return '等待数据'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

onMounted(() => {
  loadTrends()
  refreshTimer = window.setInterval(() => loadTrends(), 60_000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <main class="trend-radar">
    <header class="trend-masthead">
      <div class="trend-title">
        <span class="trend-live"><i></i> LIVE SIGNAL</span>
        <h1>时事热点雷达</h1>
        <p>十路内容、消费与 AI 信号聚合</p>
      </div>
      <div class="trend-summary">
        <div><strong>{{ snapshot.summary.totalItems || 0 }}</strong><span>热词样本</span></div>
        <div><strong>{{ snapshot.summary.connectedSources || 0 }}/10</strong><span>实时数据源</span></div>
        <div><strong>{{ formatTime(snapshot.summary.lastUpdatedAt) }}</strong><span>最近同步</span></div>
      </div>
      <button class="trend-refresh" type="button" :disabled="refreshing" title="立即同步" @click="loadTrends({ refresh: true })">
        <i class="bi bi-arrow-clockwise" :class="{ spinning: refreshing }"></i>
        <span>{{ refreshing ? '同步中' : '立即同步' }}</span>
      </button>
    </header>

    <section class="trend-command">
      <div class="trend-groups" role="tablist">
        <button v-for="group in groups" :key="group.id" type="button" :class="{ active: activeGroup === group.id && !activeSource }" @click="selectGroup(group.id)">{{ group.label }}</button>
      </div>
      <label class="trend-search">
        <i class="bi bi-search"></i>
        <input v-model="query" type="search" placeholder="搜索热点、作者或摘要" @keyup.enter="loadTrends()" />
        <button type="button" title="搜索" @click="loadTrends()"><i class="bi bi-arrow-right"></i></button>
      </label>
    </section>

    <section class="trend-sources" aria-label="数据源状态">
      <button v-for="source in snapshot.sources" :key="source.key" type="button" :class="['source-cell', { active: activeSource === source.key }]" :style="{ '--source-accent': source.accent }" @click="selectSource(source.key)">
        <span class="source-index">{{ String(snapshot.sources.indexOf(source) + 1).padStart(2, '0') }}</span>
        <strong>{{ source.label }}</strong>
        <small>{{ source.status === 'ok' ? `${source.itemCount} 条${source.coverage === 'public_signal' ? ' · 公开信号' : ''}` : source.status === 'needs_config' ? '待配置' : '异常' }}</small>
        <i :class="source.status"></i>
      </button>
    </section>

    <div v-if="error" class="trend-message error"><i class="bi bi-exclamation-triangle"></i>{{ error }}</div>
    <div v-else-if="loading" class="trend-message"><i class="bi bi-radar"></i>正在扫描实时信号...</div>
    <section v-else class="trend-feed">
      <article v-for="(item, index) in items" :key="item.id" class="trend-row">
        <div class="trend-rank">{{ String(index + 1).padStart(2, '0') }}</div>
        <div class="trend-body">
          <div class="trend-row-meta">
            <span :style="{ color: sourceMap.get(item.sourceKey)?.accent }">{{ sourceMap.get(item.sourceKey)?.label || item.sourceKey }}</span>
            <time>{{ formatTime(item.publishedAt || item.updatedAt) }}</time>
            <span v-if="item.category">{{ item.category }}</span>
          </div>
          <h2><a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a><span v-else>{{ item.title }}</span></h2>
          <p v-if="item.summary">{{ item.summary }}</p>
          <div class="trend-heat"><i :style="{ width: scoreWidth(item), background: sourceMap.get(item.sourceKey)?.accent }"></i></div>
        </div>
        <img v-if="item.imageUrl" :src="item.imageUrl" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <a v-if="item.url" class="trend-open" :href="item.url" target="_blank" rel="noopener noreferrer" title="打开来源"><i class="bi bi-arrow-up-right"></i></a>
      </article>
      <div v-if="!items.length" class="trend-empty">
        <i class="bi bi-broadcast-pin"></i>
        <strong>暂时没有可展示的信号</strong>
        <span>公开信号暂时不可用，请稍后同步或配置授权 JSON / RSS / Atom 数据源。</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.trend-radar{min-height:calc(100vh - var(--app-header-offset,64px));background:#0b0b0b;color:#f4f1ea;padding:28px clamp(18px,4vw,64px) 80px;font-family:Inter,"PingFang SC",sans-serif;letter-spacing:0}.trend-masthead{display:grid;grid-template-columns:minmax(240px,1.2fr) minmax(360px,1fr) auto;gap:32px;align-items:end;padding:22px 0 30px;border-bottom:1px solid #383838}.trend-live{font:700 11px/1 monospace;color:#fb5b45;display:flex;align-items:center;gap:8px}.trend-live i{width:7px;height:7px;background:#fb5b45;border-radius:50%;box-shadow:0 0 0 5px #fb5b4522}.trend-title h1{font-size:clamp(34px,5vw,68px);line-height:.95;margin:14px 0 10px;font-weight:750}.trend-title p{margin:0;color:#aaa}.trend-summary{display:grid;grid-template-columns:repeat(3,1fr);border-left:1px solid #383838}.trend-summary div{padding:5px 18px;border-right:1px solid #383838}.trend-summary strong,.trend-summary span{display:block}.trend-summary strong{font-size:19px}.trend-summary span{font-size:11px;color:#777;margin-top:7px}.trend-refresh{border:1px solid #f4f1ea;background:#f4f1ea;color:#111;height:44px;padding:0 17px;display:flex;align-items:center;gap:9px;font-weight:700}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.trend-command{display:flex;justify-content:space-between;gap:20px;padding:20px 0}.trend-groups{display:flex;gap:3px;flex-wrap:wrap}.trend-groups button{height:38px;padding:0 16px;background:#171717;color:#aaa;border:1px solid #292929}.trend-groups button.active{background:#f4f1ea;color:#111;border-color:#f4f1ea}.trend-search{width:min(390px,100%);height:40px;border-bottom:1px solid #555;display:flex;align-items:center;gap:10px}.trend-search input{flex:1;background:transparent;border:0;outline:0;color:#fff;min-width:0}.trend-search button{border:0;background:transparent;color:#fff}.trend-sources{display:grid;grid-template-columns:repeat(10,minmax(90px,1fr));border:1px solid #303030;margin-bottom:28px;overflow:auto}.source-cell{position:relative;min-height:84px;padding:13px;text-align:left;background:#111;color:#eee;border:0;border-right:1px solid #303030}.source-cell:last-child{border-right:0}.source-cell.active{background:#1d1d1d;box-shadow:inset 0 -3px var(--source-accent)}.source-cell strong,.source-cell small{display:block}.source-cell strong{margin-top:8px}.source-cell small,.source-index{font-size:10px;color:#737373}.source-cell>i{position:absolute;right:11px;top:11px;width:7px;height:7px;border-radius:50%;background:#666}.source-cell>i.ok{background:#55d187}.source-cell>i.error,.source-cell>i.invalid_config{background:#ff5d5d}.trend-feed{border-top:1px solid #383838}.trend-row{display:grid;grid-template-columns:56px minmax(0,1fr) 120px 34px;gap:22px;align-items:center;min-height:136px;padding:19px 0;border-bottom:1px solid #292929}.trend-rank{font:400 25px/1 monospace;color:#555}.trend-row-meta{display:flex;gap:13px;align-items:center;font:600 10px/1.2 monospace;text-transform:uppercase;color:#777}.trend-body h2{font-size:21px;line-height:1.35;margin:9px 0 6px}.trend-body h2 a{color:inherit;text-decoration:none}.trend-body p{margin:0;color:#8d8d8d;font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trend-row img{width:120px;height:82px;object-fit:cover;filter:saturate(.85)}.trend-open{color:#eee;font-size:20px}.trend-heat{height:2px;background:#242424;margin-top:14px}.trend-heat i{display:block;height:100%;opacity:.85}.trend-message,.trend-empty{min-height:260px;display:grid;place-items:center;align-content:center;gap:12px;color:#888}.trend-message i,.trend-empty i{font-size:38px}.trend-message.error{color:#ff8585}.trend-empty strong{color:#ddd}.trend-empty span{font-size:13px}.trend-refresh,.trend-groups button,.source-cell{border-radius:0}@media(max-width:900px){.trend-masthead{grid-template-columns:1fr}.trend-summary{border-left:0}.trend-refresh{width:max-content}.trend-command{flex-direction:column}.trend-search{width:100%}.trend-sources{grid-template-columns:repeat(10,110px)}.trend-row{grid-template-columns:42px minmax(0,1fr) 28px}.trend-row img{display:none}.trend-body h2{font-size:17px}.trend-radar{padding-inline:16px}}
</style>
