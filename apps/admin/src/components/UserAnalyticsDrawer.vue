<script setup lang="ts">
import { computed, ref } from 'vue'
import { DataAnalysis, Refresh } from '@element-plus/icons-vue'
import { request } from '@/request'
import { formatTime } from '@/utils'
import { lifecycleLabels, workspaceLabels } from '@/userProfile'

interface DistributionItem {
  key: string
  count: number
}

interface RetentionCohort {
  week: string
  users: number
  day1Base: number
  day1: number
  day7Base: number
  day7: number
  day30Base: number
  day30: number
}

interface DailyPoint {
  date: string
  newUsers: number
  activeUsers: number
  submittingUsers: number
  successfulUsers: number
}

interface FeatureFunnel {
  feature: string
  opens: number
  visitors: number
  submissions: number
  submittingUsers: number
  succeeded: number
  successfulUsers: number
}

interface UserAnalyticsData {
  summary: {
    totalUsers: number
    profilesReady: number
    newUsers30: number
    activeUsers7: number
    activeUsers30: number
    atRiskUsers: number
    highValueUsers: number
    returnedUsers: number
    frequentFailures: number
  }
  distributions: {
    lifecycle: DistributionItem[]
    risk: DistributionItem[]
    value: DistributionItem[]
  }
  dailyTrend: DailyPoint[]
  retention: RetentionCohort[]
  funnel: {
    trackingSince?: string | null
    features: FeatureFunnel[]
  }
  calculatedAt: string
}

const visible = ref(false)
const loading = ref(false)
const error = ref('')
const data = ref<UserAnalyticsData | null>(null)

const trendMax = computed(() =>
  Math.max(1, ...(data.value?.dailyTrend || []).map((item) => item.activeUsers)),
)

const lifecycleLabel = (key: string) => lifecycleLabels[key] || (key === 'pending' ? '待计算' : key)
const riskLabel = (key: string) => ({ low: '状态正常', medium: '需关注', high: '高风险', pending: '待计算' })[key] || key
const valueLabel = (key: string) => ({ none: '暂无收入', standard: '普通价值', high: '高价值', loss_making: '当前亏损', pending: '待计算' })[key] || key

function percent(count: number, total: number) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'
}

function retention(value: number, base: number) {
  return base > 0 ? `${Math.round((value / base) * 100)}% · ${value}/${base}` : '采集中'
}

function trendHeight(value: number) {
  return `${Math.max(value > 0 ? 8 : 2, Math.round((value / trendMax.value) * 100))}%`
}

async function loadAnalytics(force = false) {
  if (loading.value || (data.value && !force)) return
  loading.value = true
  error.value = ''
  try {
    data.value = await request<UserAnalyticsData>('/api/v1/admin/user-analytics')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '用户分析读取失败'
  } finally {
    loading.value = false
  }
}

function openAnalytics() {
  visible.value = true
  void loadAnalytics()
}
</script>

<template>
  <el-button :icon="DataAnalysis" @click="openAnalytics">群体分析</el-button>

  <el-drawer
    v-model="visible"
    class="user-analytics-drawer"
    size="min(920px, 96vw)"
    append-to-body
    :destroy-on-close="false"
  >
    <template #header>
      <div class="analytics-heading">
        <span>
          <strong>用户群体分析</strong>
          <small>看活跃、风险、留存和业务使用，不包含用户创作内容</small>
        </span>
        <el-button
          circle
          :icon="Refresh"
          :loading="loading"
          aria-label="刷新群体分析"
          @click="loadAnalytics(true)"
        />
      </div>
    </template>

    <div v-loading="loading" class="analytics-body">
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />

      <template v-if="data">
        <div class="analytics-summary">
          <div>
            <small>用户总数</small>
            <strong>{{ data.summary.totalUsers }}</strong>
            <span>画像 {{ data.summary.profilesReady }}/{{ data.summary.totalUsers }}</span>
          </div>
          <div>
            <small>近7日活跃</small>
            <strong>{{ data.summary.activeUsers7 }}</strong>
            <span>{{ percent(data.summary.activeUsers7, data.summary.totalUsers) }} 用户活跃</span>
          </div>
          <div>
            <small>近30日新增</small>
            <strong>{{ data.summary.newUsers30 }}</strong>
            <span>近30日活跃 {{ data.summary.activeUsers30 }}</span>
          </div>
          <div>
            <small>需关注</small>
            <strong :class="{ 'is-danger': data.summary.atRiskUsers }">{{ data.summary.atRiskUsers }}</strong>
            <span>高频失败 {{ data.summary.frequentFailures }}</span>
          </div>
          <div>
            <small>高价值</small>
            <strong>{{ data.summary.highValueUsers }}</strong>
            <span>回流用户 {{ data.summary.returnedUsers }}</span>
          </div>
        </div>

        <section class="analytics-section">
          <header>
            <strong>用户构成</strong>
            <small>按最新画像统计</small>
          </header>
          <div class="distribution-columns">
            <div>
              <b>生命周期</b>
              <span v-for="item in data.distributions.lifecycle" :key="item.key">
                <em>{{ lifecycleLabel(item.key) }}</em>
                <i><u :style="{ width: percent(item.count, data.summary.totalUsers) }" /></i>
                <strong>{{ item.count }}</strong>
              </span>
            </div>
            <div>
              <b>风险状态</b>
              <span v-for="item in data.distributions.risk" :key="item.key">
                <em>{{ riskLabel(item.key) }}</em>
                <i><u :style="{ width: percent(item.count, data.summary.totalUsers) }" /></i>
                <strong>{{ item.count }}</strong>
              </span>
            </div>
            <div>
              <b>用户价值</b>
              <span v-for="item in data.distributions.value" :key="item.key">
                <em>{{ valueLabel(item.key) }}</em>
                <i><u :style="{ width: percent(item.count, data.summary.totalUsers) }" /></i>
                <strong>{{ item.count }}</strong>
              </span>
            </div>
          </div>
        </section>

        <section class="analytics-section">
          <header>
            <strong>近30日活跃趋势</strong>
            <small>柱高为当天活跃用户，深色部分为成功生成用户</small>
          </header>
          <div class="analytics-trend" aria-label="近30日用户活跃趋势">
            <el-tooltip
              v-for="point in data.dailyTrend"
              :key="point.date"
              :content="`${point.date} · 活跃 ${point.activeUsers} · 提交 ${point.submittingUsers} · 成功 ${point.successfulUsers} · 新增 ${point.newUsers}`"
              placement="top"
              :show-after="100"
            >
              <span>
                <i :style="{ height: trendHeight(point.activeUsers) }">
                  <u
                    v-if="point.successfulUsers"
                    :style="{ height: `${Math.max(12, (point.successfulUsers / Math.max(1, point.activeUsers)) * 100)}%` }"
                  />
                </i>
              </span>
            </el-tooltip>
          </div>
        </section>

        <section class="analytics-section">
          <header>
            <strong>注册留存</strong>
            <small>用户注册后的第1、7、30天是否再次使用产品</small>
          </header>
          <div class="retention-table">
            <div class="is-head"><span>注册周</span><span>用户</span><span>次日</span><span>7日</span><span>30日</span></div>
            <div v-for="cohort in data.retention" :key="cohort.week">
              <strong>{{ cohort.week }}</strong>
              <span>{{ cohort.users }}</span>
              <span>{{ retention(cohort.day1, cohort.day1Base) }}</span>
              <span>{{ retention(cohort.day7, cohort.day7Base) }}</span>
              <span>{{ retention(cohort.day30, cohort.day30Base) }}</span>
            </div>
          </div>
          <p v-if="!data.retention.length" class="analytics-empty">最近8周没有新注册用户</p>
        </section>

        <section class="analytics-section">
          <header>
            <strong>业务使用路径</strong>
            <small>
              {{ data.funnel.trackingSince ? `自 ${formatTime(data.funnel.trackingSince)} 开始采集页面进入` : '等待产生页面行为数据' }}
            </small>
          </header>
          <div v-if="data.funnel.features.length" class="feature-funnel">
            <div class="is-head"><span>业务</span><span>进入用户</span><span>提交用户</span><span>成功用户</span><span>任务成功</span></div>
            <div v-for="item in data.funnel.features" :key="item.feature">
              <strong>{{ workspaceLabels[item.feature] || item.feature }}</strong>
              <span>{{ item.visitors }}<small>{{ item.opens }} 次</small></span>
              <span>{{ item.submittingUsers }}<small>{{ item.submissions }} 次</small></span>
              <span>{{ item.successfulUsers }}</span>
              <span>{{ item.succeeded }}</span>
            </div>
          </div>
          <p v-else class="analytics-empty">采集开始后暂时没有业务使用数据</p>
        </section>

        <footer class="analytics-footer">统计于 {{ formatTime(data.calculatedAt) }} · 仅手动刷新，不自动访问接口</footer>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.analytics-heading,
.analytics-heading > span,
.analytics-section,
.distribution-columns > div {
  display: grid;
}

.analytics-heading {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.analytics-heading > span {
  gap: 3px;
}

.analytics-heading strong {
  color: var(--ink);
  font-size: 17px;
}

.analytics-heading small,
.analytics-section header small,
.analytics-summary small,
.analytics-summary span,
.analytics-empty,
.analytics-footer,
.feature-funnel small {
  color: var(--ink-3);
  font-size: 11px;
}

.analytics-body {
  display: grid;
  gap: 24px;
  min-height: 240px;
}

.analytics-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-block: 1px solid var(--border);
}

.analytics-summary > div {
  display: grid;
  gap: 4px;
  padding: 14px;
  border-right: 1px solid var(--border);
}

.analytics-summary > div:last-child {
  border-right: 0;
}

.analytics-summary strong {
  color: var(--ink);
  font-size: 22px;
}

.analytics-summary strong.is-danger {
  color: var(--danger);
}

.analytics-section {
  gap: 12px;
}

.analytics-section > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.analytics-section > header strong {
  color: var(--ink);
  font-size: 13px;
}

.distribution-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.distribution-columns > div {
  align-content: start;
  gap: 8px;
}

.distribution-columns b {
  color: var(--ink-2);
  font-size: 12px;
}

.distribution-columns span {
  display: grid;
  grid-template-columns: 64px minmax(40px, 1fr) 28px;
  align-items: center;
  gap: 8px;
}

.distribution-columns em {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.distribution-columns i {
  height: 5px;
  overflow: hidden;
  background: var(--surface-2);
}

.distribution-columns u {
  display: block;
  height: 100%;
  background: var(--primary);
}

.distribution-columns span strong {
  color: var(--ink-2);
  font-size: 11px;
  text-align: right;
}

.analytics-trend {
  display: grid;
  grid-template-columns: repeat(30, minmax(3px, 1fr));
  align-items: end;
  gap: 3px;
  height: 96px;
  padding-top: 8px;
  border-bottom: 1px solid var(--border);
}

.analytics-trend > span {
  display: flex;
  height: 100%;
  align-items: flex-end;
}

.analytics-trend i {
  position: relative;
  display: block;
  width: 100%;
  min-height: 2px;
  background: color-mix(in srgb, var(--primary) 24%, var(--surface-2));
}

.analytics-trend u {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  background: color-mix(in srgb, var(--success) 76%, white);
}

.retention-table,
.feature-funnel {
  overflow-x: auto;
}

.retention-table > div,
.feature-funnel > div {
  display: grid;
  align-items: center;
  min-width: 620px;
  min-height: 36px;
  border-bottom: 1px solid var(--border);
}

.retention-table > div {
  grid-template-columns: 120px 60px repeat(3, minmax(100px, 1fr));
}

.feature-funnel > div {
  grid-template-columns: minmax(130px, 1fr) repeat(4, minmax(84px, .7fr));
}

.retention-table span,
.retention-table strong,
.feature-funnel span,
.feature-funnel strong {
  color: var(--ink-2);
  font-size: 11px;
}

.feature-funnel span {
  display: flex;
  gap: 5px;
}

.retention-table .is-head,
.feature-funnel .is-head {
  min-height: 30px;
  background: var(--surface-2);
}

.retention-table .is-head span,
.feature-funnel .is-head span {
  color: var(--ink-3);
}

.analytics-empty,
.analytics-footer {
  margin: 0;
}

.analytics-footer {
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

@media (max-width: 720px) {
  .analytics-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics-summary > div {
    border-bottom: 1px solid var(--border);
  }

  .analytics-summary > div:nth-child(2n) {
    border-right: 0;
  }

  .distribution-columns {
    grid-template-columns: 1fr;
  }

  .analytics-section > header {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
}
</style>
