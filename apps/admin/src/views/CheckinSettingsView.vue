<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Calendar, Check, Refresh } from '@element-plus/icons-vue'
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
    <PageCard title="签到活动" subtitle="管理活动开放状态与连续 7 天积分奖励">
      <template #actions>
        <div class="checkin-actions">
          <span class="checkin-save-state" :class="{ 'is-dirty': isDirty }">
            <i />{{ isDirty ? '有未保存变更' : '配置已同步' }}
          </span>
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <el-button
            type="primary"
            :icon="Check"
            :loading="saving"
            :disabled="!isDirty"
            @click="save"
          >
            保存并生效
          </el-button>
        </div>
      </template>

      <div class="checkin-settings-form">
        <section class="checkin-basics">
          <div class="checkin-section-title">
            <span class="checkin-section-icon"><el-icon><Calendar /></el-icon></span>
            <div><strong>活动规则</strong><small>状态和标题会同步到用户签到页面</small></div>
          </div>
          <div class="checkin-basic-fields">
            <label>
              <span><strong>开放签到活动</strong><small>关闭后保留历史记录，停止领取新奖励</small></span>
              <el-switch v-model="form.checkinEnabled" />
            </label>
            <label>
              <span><strong>活动标题</strong><small>2 至 40 个字符</small></span>
              <el-input
                v-model="form.checkinCampaignTitle"
                maxlength="40"
                show-word-limit
                placeholder="连续签到领创作积分"
              />
            </label>
          </div>
        </section>

        <section class="checkin-rewards">
          <header>
            <div><strong>7 天循环奖励</strong><small>连续第 7 天适合作为周期里程碑，之后重新从第 1 天计算</small></div>
            <span>每周期 {{ weekTotal.toLocaleString('zh-CN') }} 积分</span>
          </header>
          <div class="checkin-reward-grid">
            <label v-for="(_, index) in form.checkinRewards" :key="index">
              <span>第 {{ index + 1 }} 天</span>
              <el-input-number
                v-model="form.checkinRewards[index]"
                :min="0"
                :max="1000000"
                :step="index === 6 ? 10 : 5"
                :precision="0"
                controls-position="right"
              />
              <small>{{ index === 6 ? '里程碑奖励' : '积分' }}</small>
            </label>
          </div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.checkin-settings-page {
  max-width: 1180px;
}

.checkin-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkin-save-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-right: 4px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
}

.checkin-save-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.checkin-save-state.is-dirty {
  color: var(--warning);
}

.checkin-save-state.is-dirty i {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.checkin-settings-form {
  display: grid;
  gap: 26px;
}

.checkin-basics,
.checkin-rewards {
  display: grid;
  gap: 14px;
}

.checkin-section-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.checkin-section-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.checkin-section-title strong,
.checkin-section-title small,
.checkin-rewards header strong,
.checkin-rewards header small {
  display: block;
}

.checkin-section-title strong,
.checkin-rewards header strong {
  color: var(--ink);
  font-size: 13px;
}

.checkin-section-title small,
.checkin-rewards header small {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: 11px;
}

.checkin-basic-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.checkin-basic-fields > label {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  min-height: 82px;
}

.checkin-basic-fields > label:last-child {
  grid-template-columns: 150px minmax(0, 1fr);
}

.checkin-basic-fields strong,
.checkin-basic-fields small {
  display: block;
}

.checkin-basic-fields strong {
  color: var(--ink);
  font-size: 13px;
}

.checkin-basic-fields small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.5;
}

.checkin-rewards {
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.checkin-rewards header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.checkin-rewards header > span {
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.checkin-reward-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
}

.checkin-reward-grid > label {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 12px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.checkin-reward-grid > label > span,
.checkin-reward-grid > label > small {
  text-align: center;
  font-size: 10px;
}

.checkin-reward-grid > label > span {
  color: var(--ink-2);
  font-weight: 700;
}

.checkin-reward-grid > label > small {
  color: var(--ink-3);
}

.checkin-reward-grid :deep(.el-input-number) {
  width: 100%;
}
</style>
