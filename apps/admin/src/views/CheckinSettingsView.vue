<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { request } from '@/request'
import { normalizePoints } from '@/utils'
import type { AdminSettings } from '@/components/settings/types'

const loading = ref(false)
const saving = ref(false)
const savedSignature = ref('')
const form = reactive({
  checkinEnabled: true,
  checkinCampaignTitle: '连续签到领创作积分',
  checkinRewards: [10, 15, 20, 25, 30, 40, 80],
})

const signature = () =>
  JSON.stringify({
    checkinEnabled: form.checkinEnabled,
    checkinCampaignTitle: form.checkinCampaignTitle.trim(),
    checkinRewards: form.checkinRewards.map(normalizePoints),
  })

const isDirty = computed(
  () => !loading.value && Boolean(savedSignature.value) && signature() !== savedSignature.value,
)
const weekTotal = computed(() =>
  form.checkinRewards.reduce((sum, reward) => sum + normalizePoints(reward), 0),
)

function hydrate(settings: AdminSettings) {
  form.checkinEnabled = settings.checkinEnabled ?? true
  form.checkinCampaignTitle = settings.checkinCampaignTitle || '连续签到领创作积分'
  form.checkinRewards =
    Array.isArray(settings.checkinRewards) && settings.checkinRewards.length === 7
      ? settings.checkinRewards.map(normalizePoints)
      : [10, 15, 20, 25, 30, 40, 80]
  savedSignature.value = signature()
}

async function load() {
  loading.value = true
  try {
    hydrate(await request<AdminSettings>('/api/v1/admin/settings'))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (loading.value || saving.value || !isDirty.value) return
  const title = form.checkinCampaignTitle.trim()
  if (title.length < 2) {
    ElMessage.warning('活动标题至少需要 2 个字')
    return
  }
  if (!form.checkinRewards.some((reward) => normalizePoints(reward) > 0)) {
    ElMessage.warning('7 天奖励中至少一天需要大于 0')
    return
  }
  saving.value = true
  try {
    hydrate(
      await request<AdminSettings>('/api/v1/admin/settings', {
        method: 'PUT',
        body: {
          checkinEnabled: form.checkinEnabled,
          checkinCampaignTitle: title,
          checkinRewards: form.checkinRewards.map(normalizePoints),
        },
      }),
    )
    ElMessage.success('签到活动设置已生效')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="page checkin-settings-page">
    <PageCard>
      <div class="checkin-toolbar">
        <div class="sync-state" :class="{ 'is-dirty': isDirty }">
          <i />{{ isDirty ? '有未保存变更' : '配置已同步' }}
        </div>
        <div class="checkin-toolbar__actions">
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!isDirty"
            @click="save"
          >
            保存并生效
          </el-button>
        </div>
      </div>

      <div class="checkin-workspace">
        <div class="checkin-status" :class="{ 'is-open': form.checkinEnabled }">
          <div>
            <span class="checkin-status__dot" />
            <div>
              <strong>{{ form.checkinEnabled ? '活动开放中' : '活动已暂停' }}</strong>
              <p>
                {{
                  form.checkinEnabled
                    ? '状态和标题会同步到用户签到页面'
                    : '关闭后保留历史记录，停止领取新奖励'
                }}
              </p>
            </div>
          </div>
          <el-switch v-model="form.checkinEnabled" />
        </div>

        <label class="checkin-title">
          <span>
            <strong>活动标题</strong>
            <small>2 至 40 个字符，展示在用户签到页</small>
          </span>
          <el-input
            v-model="form.checkinCampaignTitle"
            maxlength="40"
            show-word-limit
            placeholder="连续签到领创作积分"
          />
        </label>

        <section class="checkin-rewards">
          <header>
            <div>
              <strong>7 天循环奖励</strong>
              <small>连续第 7 天适合作为周期里程碑，之后重新从第 1 天计算</small>
            </div>
            <em>每周期 {{ weekTotal.toLocaleString('zh-CN') }} 积分</em>
          </header>
          <div class="checkin-reward-grid">
            <label
              v-for="(_, index) in form.checkinRewards"
              :key="index"
              :class="{ 'is-milestone': index === 6 }"
            >
              <span>{{ index === 6 ? '第 7 天 · 里程碑' : `第 ${index + 1} 天` }}</span>
              <el-input-number
                v-model="form.checkinRewards[index]"
                :min="0"
                :max="1000000"
                :step="index === 6 ? 10 : 5"
                :precision="0"
              />
            </label>
          </div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.checkin-settings-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.checkin-settings-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.checkin-settings-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.checkin-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
}

.checkin-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}

.checkin-toolbar__actions :deep(.el-button) {
  margin: 0;
  height: 32px;
}

.sync-state {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}

.sync-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.sync-state.is-dirty {
  color: var(--warning);
}

.sync-state.is-dirty i {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.checkin-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.checkin-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);
}

.checkin-status.is-open {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
  background: var(--accent-soft);
}

.checkin-status > div {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.checkin-status__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ink-3);
}

.checkin-status.is-open .checkin-status__dot {
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
}

.checkin-status strong {
  display: block;
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
}

.checkin-status p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.45;
}

.checkin-title {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 220px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.checkin-title span {
  display: grid;
  gap: 2px;
}

.checkin-title strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.checkin-title small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.4;
}

.checkin-rewards {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.checkin-rewards header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.checkin-rewards header strong,
.checkin-rewards header small {
  display: block;
}

.checkin-rewards header strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
}

.checkin-rewards header small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.45;
}

.checkin-rewards header em {
  color: var(--accent-ink);
  font-size: 13px;
  font-style: normal;
  font-weight: 750;
}

.checkin-reward-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
}

.checkin-reward-grid > label {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px 10px 16px;
  border-right: 1px solid var(--border);
}

.checkin-reward-grid > label:last-child {
  border-right: 0;
}

.checkin-reward-grid > label.is-milestone {
  background: var(--accent-soft);
}

.checkin-reward-grid > label > span {
  color: var(--ink);
  font-size: 12px;
  font-weight: 750;
  text-align: center;
}

.checkin-reward-grid :deep(.el-input-number) {
  width: 100%;
}

.checkin-reward-grid :deep(.el-input-number .el-input__wrapper) {
  padding-left: 0;
  padding-right: 0;
}
</style>
