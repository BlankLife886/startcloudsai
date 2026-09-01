<script setup lang="ts">
import { computed, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { formatTime } from '@/utils'
import {
  formatDurationMs,
  formatProfileMoney,
  lifecycleLabels,
  profileTagLabels,
  workspaceLabels,
  type UserProfileBreakdown,
  type UserProfileDetail,
} from '@/userProfile'

const props = defineProps<{
  profile: UserProfileDetail
  refreshing?: boolean
}>()

defineEmits<{ refresh: [] }>()

const metrics = computed(() => props.profile.metrics)
const historyExpanded = ref(false)
const visibleHistory = computed(() => {
  const history = props.profile.history || []
  return historyExpanded.value ? history : history.slice(0, 5)
})
const trendMax = computed(() =>
  Math.max(1, ...props.profile.dailyTrend.map((item) => item.succeeded + item.failed)),
)

function rate(item: UserProfileBreakdown) {
  const terminal = item.succeeded + item.failed
  return terminal > 0 ? Math.round((item.succeeded / terminal) * 100) : 0
}

function activityHeight(value: number) {
  return `${Math.max(value > 0 ? 10 : 2, Math.round((value / trendMax.value) * 100))}%`
}

function tagClass(tag: string) {
  if (tag === 'frequent_failure' || tag === 'loss_making') return 'is-danger'
  if (tag === 'churn_risk') return 'is-warning'
  if (tag === 'high_value') return 'is-value'
  return 'is-neutral'
}

function bps(value: number) {
  return `${(Math.max(0, Number(value) || 0) / 100).toFixed(1)}%`
}

function submissionsPerOpen() {
  const funnel = props.profile.funnel
  if (!funnel?.opens) return '等待采集进入数据'
  return `平均每次进入提交 ${(funnel.submissions / funnel.opens).toFixed(1)} 次`
}

function riskLabel(value: string) {
  if (value === 'high') return '高风险'
  if (value === 'medium') return '需关注'
  return '状态正常'
}

const funnelFeatures = computed(() =>
  (props.profile.funnel?.features || [])
    .filter((item) => item.opens > 0 || item.submissions > 0)
    .slice(0, 6),
)
</script>

<template>
  <div class="profile-panel">
    <header class="profile-head">
      <div>
        <div class="profile-head__line">
          <strong>{{ lifecycleLabels[metrics.lifecycle] || metrics.lifecycle }}</strong>
          <span class="risk-dot" :class="`is-${metrics.riskLevel}`">
            {{ metrics.riskLevel === 'high' ? '高风险' : metrics.riskLevel === 'medium' ? '需关注' : '状态正常' }}
          </span>
        </div>
        <small>
          最近活跃 {{ formatTime(metrics.lastActivityAt) }} · 画像更新 {{ formatTime(metrics.calculatedAt) }}
        </small>
      </div>
      <el-tooltip content="重新读取该用户最新数据并计算画像" placement="top">
        <el-button circle :icon="Refresh" :loading="refreshing" aria-label="重新计算画像" @click="$emit('refresh')" />
      </el-tooltip>
    </header>

    <div class="profile-stats">
      <div>
        <small>30日成功率</small>
        <strong>{{ (metrics.successRateBps30 / 100).toFixed(1) }}%</strong>
        <span>{{ metrics.successfulRuns30 }} 成功 / {{ metrics.failedRuns30 }} 失败</span>
      </div>
      <div>
        <small>30日实收</small>
        <strong>{{ formatProfileMoney(metrics.revenueCents30) }}</strong>
        <span>实际扣除积分折算</span>
      </div>
      <div>
        <small>30日毛利</small>
        <strong :class="{ 'is-negative': metrics.grossProfitCents30 < 0 }">
          {{ formatProfileMoney(metrics.grossProfitCents30) }}
        </strong>
        <span>成本 {{ formatProfileMoney(metrics.upstreamCostCents30) }}</span>
      </div>
      <div>
        <small>30日活跃</small>
        <strong>{{ metrics.activeDays30 }} 天</strong>
        <span>近7日 {{ metrics.activeDays7 }} 天</span>
      </div>
      <div>
        <small>平均生成耗时</small>
        <strong>{{ formatDurationMs(metrics.averageDurationMs30) }}</strong>
        <span>P95 {{ formatDurationMs(metrics.p95DurationMs30) }}</span>
      </div>
      <div>
        <small>主要业务</small>
        <strong>{{ workspaceLabels[metrics.primaryWorkspace] || metrics.primaryWorkspace || '暂无' }}</strong>
        <span>使用 {{ metrics.featureDiversity30 }} 类功能</span>
      </div>
    </div>

    <section class="profile-section">
      <header>画像依据</header>
      <div v-if="metrics.tags.length" class="profile-tags">
        <el-tooltip
          v-for="tag in metrics.tags"
          :key="tag"
          :content="metrics.tagReasons[tag] || '根据最近30日真实数据计算'"
          placement="top"
          :show-after="200"
        >
          <span class="profile-tag" :class="tagClass(tag)">{{ profileTagLabels[tag] || tag }}</span>
        </el-tooltip>
      </div>
      <p v-else class="profile-empty">当前没有需要特别标记的行为</p>
    </section>

    <section class="profile-section profile-history-section">
      <header class="section-heading">
        <span>画像变化</span>
        <small>每天首次计算或关键状态变化时记录</small>
      </header>
      <div v-if="visibleHistory.length" class="profile-history-list">
        <div v-for="item in visibleHistory" :key="`${item.calculatedAt}-${item.lifecycle}-${item.riskLevel}`" class="profile-history-row">
          <time>{{ formatTime(item.calculatedAt) }}</time>
          <span class="history-state">
            <strong>{{ lifecycleLabels[item.lifecycle] || item.lifecycle }}</strong>
            <small :class="`is-${item.riskLevel}`">{{ riskLabel(item.riskLevel) }}</small>
          </span>
          <span class="history-workspace">
            <small>主要业务</small>
            <strong>{{ workspaceLabels[item.primaryWorkspace] || item.primaryWorkspace || '暂无' }}</strong>
          </span>
          <span>
            <small>30日成功率</small>
            <strong>{{ (item.successRateBps30 / 100).toFixed(1) }}%</strong>
          </span>
          <span>
            <small>30日毛利</small>
            <strong :class="{ 'is-negative': item.grossProfitCents30 < 0 }">{{ formatProfileMoney(item.grossProfitCents30) }}</strong>
          </span>
        </div>
      </div>
      <p v-else class="profile-empty">首次画像计算后会开始记录变化</p>
      <el-button
        v-if="(profile.history?.length || 0) > 5"
        text
        class="history-toggle"
        @click="historyExpanded = !historyExpanded"
      >
        {{ historyExpanded ? '收起' : `查看全部 ${profile.history.length} 条` }}
      </el-button>
    </section>

    <section class="profile-section funnel-section">
      <header class="section-heading">
        <span>近30日使用路径</span>
        <small>
          {{ profile.funnel?.trackingSince ? `自 ${formatTime(profile.funnel.trackingSince)} 开始采集` : '等待用户产生新操作' }}
        </small>
      </header>
      <div class="funnel-flow">
        <div>
          <small>进入功能</small>
          <strong>{{ profile.funnel?.opens || 0 }}</strong>
          <span>页面进入次数</span>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <small>提交任务</small>
          <strong>{{ profile.funnel?.submissions || 0 }}</strong>
          <span>{{ submissionsPerOpen() }}</span>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <small>生成成功</small>
          <strong>{{ profile.funnel?.succeeded || 0 }}</strong>
          <span>提交后成功 {{ bps(profile.funnel?.successRateBps || 0) }}</span>
        </div>
      </div>
      <p class="funnel-privacy">只记录操作结果，不记录提示词、图片、文件名或图片地址</p>
      <div class="funnel-secondary">
        <span><small>参考图上传</small><strong>{{ profile.funnel?.referenceUploadsCompleted || 0 }}</strong></span>
        <span><small>上传失败</small><strong :class="{ 'is-danger': profile.funnel?.referenceUploadsFailed }">{{ profile.funnel?.referenceUploadsFailed || 0 }}</strong></span>
        <span><small>取消任务</small><strong>{{ profile.funnel?.canceled || 0 }}</strong></span>
        <span><small>使用过的提示词</small><strong>{{ profile.funnel?.promptTemplatesUsed || 0 }}</strong></span>
      </div>
      <div v-if="funnelFeatures.length" class="funnel-features">
        <div v-for="item in funnelFeatures" :key="item.feature">
          <strong>{{ workspaceLabels[item.feature] || item.feature }}</strong>
          <span>进入 {{ item.opens }} · 提交 {{ item.submissions }} · 成功 {{ item.succeeded }}</span>
        </div>
      </div>
      <p v-else class="profile-empty">行为采集刚启用，用户产生新操作后会自动显示</p>
    </section>

    <section class="profile-section">
      <header class="section-heading">
        <span>近30日活跃趋势</span>
        <small>绿色成功 · 红色失败</small>
      </header>
      <div class="activity-chart" aria-label="近30日成功和失败任务趋势">
        <el-tooltip
          v-for="point in profile.dailyTrend"
          :key="point.date"
          :content="`${point.date} · 成功 ${point.succeeded} · 失败 ${point.failed} · 毛利 ${formatProfileMoney(point.grossProfitCents)}`"
          placement="top"
          :show-after="120"
        >
          <span class="activity-column">
            <i class="activity-total" :style="{ height: activityHeight(point.succeeded + point.failed) }">
              <b
                v-if="point.failed"
                class="is-failed"
                :style="{ height: `${Math.max(12, (point.failed / Math.max(1, point.succeeded + point.failed)) * 100)}%` }"
              />
            </i>
          </span>
        </el-tooltip>
      </div>
    </section>

    <div class="profile-columns">
      <section class="profile-section">
        <header>业务偏好</header>
        <div v-if="profile.workspaces.length" class="breakdown-list">
          <div v-for="item in profile.workspaces" :key="item.key" class="breakdown-row">
            <span>
              <strong>{{ workspaceLabels[item.label] || item.label }}</strong>
              <small>{{ item.runs }} 次 · {{ rate(item) }}% 成功</small>
            </span>
            <el-progress :percentage="rate(item)" :show-text="false" :stroke-width="5" />
          </div>
        </div>
        <p v-else class="profile-empty">近30日没有业务记录</p>
      </section>

      <section class="profile-section">
        <header>常用模型</header>
        <div v-if="profile.models.length" class="breakdown-list">
          <div v-for="item in profile.models" :key="item.key" class="model-row">
            <span :title="item.label">{{ item.label }}</span>
            <strong>{{ item.runs }} 次</strong>
            <small>{{ rate(item) }}%</small>
          </div>
        </div>
        <p v-else class="profile-empty">近30日没有模型记录</p>
      </section>
    </div>

    <section class="profile-section">
      <header>失败原因</header>
      <div v-if="profile.failures.length" class="failure-list">
        <div v-for="item in profile.failures" :key="item.code">
          <strong>{{ item.count }} 次</strong>
          <span>{{ item.message }}</span>
          <code>{{ item.code }}</code>
        </div>
      </div>
      <p v-else class="profile-empty">近30日没有失败任务</p>
    </section>
  </div>
</template>

<style scoped>
.profile-panel {
  display: grid;
  gap: 20px;
}

.profile-head,
.profile-head__line,
.section-heading,
.model-row,
.failure-list > div {
  display: flex;
  align-items: center;
}

.profile-head {
  justify-content: space-between;
  gap: 16px;
}

.profile-head__line {
  gap: 9px;
}

.profile-head strong {
  color: var(--ink);
  font-size: 20px;
}

.profile-head small,
.section-heading small,
.profile-stats span,
.breakdown-row small,
.model-row small,
.profile-empty {
  color: var(--ink-3);
  font-size: 12px;
}

.risk-dot {
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.risk-dot.is-low {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
}

.risk-dot.is-medium {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.risk-dot.is-high {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.profile-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-block: 1px solid var(--border);
}

.profile-stats > div {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 16px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.profile-stats > div:nth-child(3n) {
  border-right: 0;
}

.profile-stats > div:nth-last-child(-n + 3) {
  border-bottom: 0;
}

.profile-stats small {
  color: var(--ink-3);
  font-size: 11px;
}

.profile-stats strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-stats strong.is-negative {
  color: var(--danger);
}

.profile-section {
  display: grid;
  gap: 12px;
}

.funnel-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr) 24px minmax(0, 1fr);
  align-items: center;
  padding-block: 12px;
  border-block: 1px solid var(--border);
}

.funnel-flow > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.funnel-flow > i {
  color: var(--ink-3);
  font-style: normal;
  text-align: center;
}

.funnel-flow small,
.funnel-flow span,
.funnel-secondary small,
.funnel-features span {
  color: var(--ink-3);
  font-size: 11px;
}

.funnel-flow strong {
  color: var(--ink);
  font-size: 22px;
}

.funnel-secondary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  background: var(--border);
}

.funnel-privacy {
  margin: -3px 0 0;
  color: var(--ink-3);
  font-size: 11px;
}

.funnel-secondary > span {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  background: var(--surface-2);
}

.funnel-secondary strong {
  color: var(--ink-2);
  font-size: 14px;
}

.funnel-secondary strong.is-danger {
  color: var(--danger);
}

.funnel-features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 20px;
}

.funnel-features > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--border);
}

.funnel-features strong {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.funnel-features span {
  flex: none;
}

.profile-section > header {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.section-heading {
  justify-content: space-between;
}

.profile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.profile-tag {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--ink-2);
  font-size: 12px;
  background: var(--surface-2);
}

.profile-tag.is-danger {
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
  color: var(--danger);
}

.profile-tag.is-warning {
  border-color: color-mix(in srgb, var(--warning) 30%, var(--border));
  color: var(--warning);
}

.profile-tag.is-value {
  border-color: color-mix(in srgb, #16a085 35%, var(--border));
  color: #137a68;
}

.profile-history-list {
  display: grid;
  border-top: 1px solid var(--border);
}

.profile-history-row {
  display: grid;
  grid-template-columns: 132px minmax(110px, 0.8fr) minmax(120px, 1fr) minmax(96px, 0.7fr) minmax(96px, 0.7fr);
  align-items: center;
  gap: 12px;
  min-height: 54px;
  border-bottom: 1px solid var(--border);
}

.profile-history-row time,
.profile-history-row small {
  color: var(--ink-3);
  font-size: 11px;
}

.profile-history-row > span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.profile-history-row strong {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-history-row strong.is-negative,
.history-state small.is-high {
  color: var(--danger);
}

.history-state small.is-medium {
  color: var(--warning);
}

.history-state small.is-low {
  color: var(--success);
}

.history-toggle {
  justify-self: start;
  padding-inline: 0;
}

.activity-chart {
  display: grid;
  grid-template-columns: repeat(30, minmax(3px, 1fr));
  align-items: end;
  gap: 3px;
  height: 96px;
  padding-top: 8px;
  border-bottom: 1px solid var(--border);
}

.activity-column {
  display: flex;
  height: 100%;
  align-items: flex-end;
}

.activity-total {
  position: relative;
  display: block;
  width: 100%;
  min-height: 2px;
  overflow: hidden;
  border-radius: 2px 2px 0 0;
  background: color-mix(in srgb, var(--success) 72%, white);
}

.activity-total b {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  background: color-mix(in srgb, var(--danger) 78%, white);
}

.profile-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 28px;
}

.breakdown-list,
.failure-list {
  display: grid;
  gap: 10px;
}

.breakdown-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.9fr) minmax(120px, 1.1fr);
  align-items: center;
  gap: 14px;
}

.breakdown-row > span {
  display: grid;
  min-width: 0;
}

.breakdown-row strong,
.model-row span,
.failure-list span {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 38px;
  gap: 10px;
  min-height: 25px;
}

.model-row strong {
  color: var(--ink);
  font-size: 12px;
}

.failure-list > div {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) minmax(100px, auto);
  gap: 10px;
  min-height: 30px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.failure-list strong {
  color: var(--danger);
  font-size: 12px;
}

.failure-list code {
  overflow: hidden;
  max-width: 180px;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-empty {
  margin: 0;
}

@media (max-width: 760px) {
  .profile-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-stats > div:nth-child(3n) {
    border-right: 1px solid var(--border);
  }

  .profile-stats > div:nth-child(2n) {
    border-right: 0;
  }

  .profile-stats > div:nth-last-child(-n + 3) {
    border-bottom: 1px solid var(--border);
  }

  .profile-stats > div:nth-last-child(-n + 2) {
    border-bottom: 0;
  }

  .profile-columns {
    grid-template-columns: 1fr;
  }

  .funnel-flow {
    grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr) 14px minmax(0, 1fr);
  }

  .funnel-secondary,
  .funnel-features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-history-row {
    grid-template-columns: 110px minmax(100px, 1fr) minmax(90px, 1fr);
  }

  .profile-history-row > span:nth-last-child(-n + 2) {
    display: none;
  }
}
</style>
