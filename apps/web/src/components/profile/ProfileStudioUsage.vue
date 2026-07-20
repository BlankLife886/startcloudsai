<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getClientResourceSummary } from '@/services/aiWallpaper'
import { getAiUsageLedger } from '@/services/aiUsageLedger'
import {
  buildLocalStudioUsageRows,
  inferStudioFeatureFromUsageRow,
  studioFeatureLabel,
} from '@/features/ai-shared/studioUsage'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const creditBalance = ref(0)
const creditAvailable = ref(0)
const serverRows = ref([])
const creditLedgerRows = ref([])
const localRows = ref([])

const featureRows = computed(() => {
  const map = new Map()
  localRows.value.forEach((row) => {
    map.set(row.featureKey, {
      featureKey: row.featureKey,
      label: row.label,
      monthCount: row.success,
      monthCredits: row.creditCost,
    })
  })
  serverRows.value.forEach((row) => {
    const featureKey = inferStudioFeatureFromUsageRow(row)
    const current = map.get(featureKey) || {
      featureKey,
      label: studioFeatureLabel(featureKey),
      monthCount: 0,
      monthCredits: 0,
    }
    if (String(row.status || '') === 'success') current.monthCount += 1
    map.set(featureKey, current)
  })
  creditLedgerRows.value
    .filter(
      (row) => String(row.sourceType || '') === 'ai_job' && String(row.direction || '') === 'spend',
    )
    .forEach((row) => {
      const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
      const kind = String(meta.kind || '').toLowerCase()
      let featureKey = 'ai.optimize'
      if (kind.includes('wallpaper')) featureKey = 'ai.wallpaperGeneration'
      else if (kind.includes('ui-design')) featureKey = 'ai.uiDesign'
      else if (kind.includes('ultra-reference')) featureKey = 'ai.ultraModelSheet'
      else if (kind.includes('game-art')) featureKey = 'ai.gameDesign'
      else if (kind.includes('puzzle') || kind.includes('collage')) featureKey = 'ai.puzzle'
      else if (kind.includes('illustration') || kind.includes('color'))
        featureKey = 'ai.illustrationColoring'
      else if (kind.includes('3d') || kind.includes('model')) featureKey = 'ai.imageToModel'
      const current = map.get(featureKey) || {
        featureKey,
        label: studioFeatureLabel(featureKey),
        monthCount: 0,
        monthCredits: 0,
      }
      current.monthCredits += Number(row.amount || 0)
      map.set(featureKey, current)
    })
  return Array.from(map.values()).sort(
    (a, b) => b.monthCredits - a.monthCredits || b.monthCount - a.monthCount,
  )
})

const recentCreditLedger = computed(() =>
  creditLedgerRows.value.filter((row) => String(row.sourceType || '') === 'ai_job').slice(0, 12),
)

function formatCredits(value = 0) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0'
  return num >= 1000 ? Math.round(num).toLocaleString() : String(Math.round(num * 1000) / 1000)
}

function formatDate(value = '') {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function goRechargeCredits() {
  router.push({ name: 'pricing', query: { section: 'wallet' } })
}

async function loadStudioUsage() {
  loading.value = true
  error.value = ''
  try {
    localRows.value = buildLocalStudioUsageRows(getAiUsageLedger())
    const data = await getClientResourceSummary({ scope: 'studio' })
    const summary = data?.summary || {}
    const account = summary.credits?.account || {}
    creditBalance.value = Number(account.balance || 0)
    creditAvailable.value = Number(
      account.availableBalance ??
        Math.max(0, creditBalance.value - Number(account.frozenBalance || 0)),
    )
    serverRows.value = Array.isArray(summary.usage?.logs) ? summary.usage.logs : []
    creditLedgerRows.value = Array.isArray(summary.credits?.ledger) ? summary.credits.ledger : []
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'AI 功能用量读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadStudioUsage()
})
</script>

<template>
  <section class="profile-studio-usage">
    <div class="profile-studio-usage__toolbar">
      <button
        type="button"
        class="profile-studio-usage__refresh"
        :disabled="loading"
        @click="loadStudioUsage"
      >
        <i class="bi bi-arrow-clockwise" :class="{ spin: loading }"></i>
        刷新
      </button>
    </div>

    <div class="profile-studio-usage__balance">
      <div>
        <span>壁纸积分余额</span>
        <strong>{{ formatCredits(creditAvailable) }}</strong>
        <small v-if="creditBalance !== creditAvailable"
          >含冻结 {{ formatCredits(creditBalance - creditAvailable) }}</small
        >
      </div>
      <button type="button" class="profile-studio-usage__recharge" @click="goRechargeCredits">
        去兑换积分
      </button>
    </div>

    <p v-if="error" class="profile-studio-usage__error">{{ error }}</p>

    <div v-if="loading && !featureRows.length" class="profile-studio-usage__empty">加载中…</div>
    <div v-else-if="!featureRows.length" class="profile-studio-usage__empty">
      本月暂无 AI 功能消耗记录。AI 拼图为本地工具，不产生扣费。
    </div>
    <div v-else class="profile-studio-usage__grid">
      <article v-for="row in featureRows" :key="row.featureKey" class="profile-studio-usage__card">
        <strong>{{ row.label }}</strong>
        <div class="profile-studio-usage__metrics">
          <span
            >本月次数 <em>{{ row.monthCount }}</em></span
          >
          <span
            >积分消耗 <em>{{ formatCredits(row.monthCredits) }}</em></span
          >
        </div>
      </article>
    </div>

    <div v-if="recentCreditLedger.length" class="profile-studio-usage__ledger">
      <h4>最近积分扣减</h4>
      <ul>
        <li v-for="row in recentCreditLedger" :key="row.id">
          <div>
            <strong>{{ row.reason || 'AI 任务' }}</strong>
            <small>{{ formatDate(row.createdAt) }}</small>
          </div>
          <span>-{{ formatCredits(row.amount) }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.profile-studio-usage {
  --psu-card: var(--pf-card, #ffffff);
  --psu-line: var(--pf-line, rgba(21, 26, 45, 0.1));
  --psu-accent: var(--pf-accent, #6a4fe0);
  --psu-accent-soft: var(--pf-accent-soft, rgba(106, 79, 224, 0.1));
  --psu-heading: var(--pf-heading, #151a2d);
  --psu-text: var(--pf-text, #3a4258);
  --psu-muted: var(--pf-muted, #79809a);
  --psu-stamp: var(--pf-stamp, 4px 4px 0 rgba(106, 79, 224, 0.18));
  --psu-stamp-soft: var(--pf-stamp-soft, 3px 3px 0 rgba(106, 79, 224, 0.12));
  --psu-mono: var(--pf-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  --psu-on-accent: var(--pf-on-accent, #ffffff);

  display: grid;
  gap: 14px;
  color: var(--psu-text);
}

.profile-studio-usage__toolbar {
  display: flex;
  justify-content: flex-end;
}

.profile-studio-usage__refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid var(--psu-line);
  border-radius: 0;
  background: var(--psu-card);
  color: var(--psu-heading);
  font-size: 0.82rem;
  font-weight: 650;
  cursor: pointer;
  box-shadow: var(--psu-stamp-soft);
}

.profile-studio-usage__refresh:hover:not(:disabled) {
  border-color: var(--psu-accent);
  color: var(--psu-accent);
}

.profile-studio-usage__refresh:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.profile-studio-usage__balance {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--psu-line);
  border-radius: 0;
  background:
    linear-gradient(135deg, rgba(106, 79, 224, 0.1), rgba(160, 139, 255, 0.04)),
    var(--psu-card);
  box-shadow: var(--psu-stamp);
}

.profile-studio-usage__balance span {
  display: block;
  color: var(--psu-muted);
  font-size: 0.78rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.profile-studio-usage__balance strong {
  display: block;
  margin-top: 4px;
  color: var(--psu-heading);
  font-family: var(--psu-mono);
  font-size: 1.7rem;
  font-weight: 760;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.profile-studio-usage__balance small {
  display: block;
  margin-top: 4px;
  color: var(--psu-muted);
  font-family: var(--psu-mono);
  font-size: 0.76rem;
}

.profile-studio-usage__recharge {
  border: 1px solid var(--psu-accent);
  border-radius: 0;
  padding: 9px 14px;
  background: var(--psu-accent);
  color: var(--psu-on-accent);
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.28);
}

.profile-studio-usage__recharge:hover {
  filter: brightness(1.04);
}

.profile-studio-usage__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.profile-studio-usage__card {
  padding: 14px;
  border: 1px solid var(--psu-line);
  border-radius: 0;
  background: var(--psu-card);
  box-shadow: var(--psu-stamp-soft);
}

.profile-studio-usage__card > strong {
  color: var(--psu-heading);
  font-size: 0.92rem;
  font-weight: 720;
}

.profile-studio-usage__metrics {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  font-size: 0.84rem;
  color: var(--psu-muted);
}

.profile-studio-usage__metrics em {
  font-style: normal;
  margin-left: 6px;
  color: var(--psu-heading);
  font-family: var(--psu-mono);
  font-weight: 700;
}

.profile-studio-usage__ledger h4 {
  margin: 0 0 8px;
  color: var(--psu-heading);
  font-size: 0.9rem;
  font-weight: 720;
}

.profile-studio-usage__ledger ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.profile-studio-usage__ledger li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--psu-line);
  border-radius: 0;
  background: var(--psu-accent-soft);
}

.profile-studio-usage__ledger strong {
  color: var(--psu-heading);
  font-size: 0.88rem;
}

.profile-studio-usage__ledger small {
  display: block;
  margin-top: 3px;
  color: var(--psu-muted);
  font-size: 0.74rem;
}

.profile-studio-usage__ledger li > span {
  flex: 0 0 auto;
  color: var(--psu-accent);
  font-family: var(--psu-mono);
  font-size: 0.92rem;
  font-weight: 760;
}

.profile-studio-usage__empty,
.profile-studio-usage__error {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--psu-line);
  border-radius: 0;
  background: var(--psu-accent-soft);
  color: var(--psu-text);
  box-shadow: var(--psu-stamp-soft);
}

.profile-studio-usage__error {
  color: #b42318;
  border-color: rgba(180, 35, 24, 0.28);
  background: rgba(180, 35, 24, 0.08);
}

.spin {
  animation: profile-studio-spin 0.8s linear infinite;
}

@keyframes profile-studio-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
