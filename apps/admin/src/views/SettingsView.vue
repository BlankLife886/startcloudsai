<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Check, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { request } from '@/request'
import { normalizePoints } from '@/utils'

interface AdminSettings {
  userMaxRunningTasks?: number
  userMaxConcurrentTasks?: number
  globalMaxConcurrentTasks?: number
  globalMaxActiveTasks?: number
  taskFailureRetryCount?: number
  crossProviderSameModelBalancingEnabled?: boolean
  workerConcurrencyCeiling?: number
  effectiveGlobalConcurrency?: number
  registrationEnabled?: boolean
  signupBonusCents?: number
}

const loading = ref(false)
const saving = ref(false)
const savedSignature = ref('')
const workerConcurrencyCeiling = ref(1)

const form = reactive({
  userMaxRunningTasks: 100,
  userMaxConcurrentTasks: 2,
  globalMaxConcurrentTasks: 4,
  globalMaxActiveTasks: 2000,
  taskFailureRetryCount: 0,
  crossProviderSameModelBalancingEnabled: false,
  registrationEnabled: true,
  signupBonusPoints: 0,
})

const settingsSignature = () =>
  JSON.stringify({
    userMaxRunningTasks: form.userMaxRunningTasks,
    userMaxConcurrentTasks: form.userMaxConcurrentTasks,
    globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
    globalMaxActiveTasks: form.globalMaxActiveTasks,
    taskFailureRetryCount: form.taskFailureRetryCount,
    crossProviderSameModelBalancingEnabled: form.crossProviderSameModelBalancingEnabled,
    registrationEnabled: form.registrationEnabled,
    signupBonusPoints: form.signupBonusPoints,
  })

const isDirty = computed(
  () =>
    !loading.value &&
    savedSignature.value !== '' &&
    settingsSignature() !== savedSignature.value,
)
const effectiveGlobalConcurrency = computed(() =>
  Math.min(form.globalMaxConcurrentTasks, workerConcurrencyCeiling.value),
)

function hydrate(settings: AdminSettings) {
  form.userMaxRunningTasks = settings.userMaxRunningTasks ?? 100
  form.userMaxConcurrentTasks = settings.userMaxConcurrentTasks ?? 2
  form.globalMaxConcurrentTasks = settings.globalMaxConcurrentTasks ?? 4
  form.globalMaxActiveTasks = settings.globalMaxActiveTasks ?? 2000
  form.taskFailureRetryCount = settings.taskFailureRetryCount ?? 0
  form.crossProviderSameModelBalancingEnabled =
    settings.crossProviderSameModelBalancingEnabled ?? false
  workerConcurrencyCeiling.value = Math.max(1, settings.workerConcurrencyCeiling ?? 1)
  form.registrationEnabled = settings.registrationEnabled ?? true
  form.signupBonusPoints = normalizePoints(settings.signupBonusCents)
  savedSignature.value = settingsSignature()
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
  saving.value = true
  try {
    hydrate(
      await request<AdminSettings>('/api/v1/admin/settings', {
        method: 'PUT',
        body: {
          userMaxRunningTasks: form.userMaxRunningTasks,
          userMaxConcurrentTasks: form.userMaxConcurrentTasks,
          globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
          globalMaxActiveTasks: form.globalMaxActiveTasks,
          taskFailureRetryCount: form.taskFailureRetryCount,
          crossProviderSameModelBalancingEnabled: form.crossProviderSameModelBalancingEnabled,
          registrationEnabled: form.registrationEnabled,
          signupBonusCents: normalizePoints(form.signupBonusPoints),
        },
      }),
    )
    ElMessage.success('系统设置已生效')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="page">
    <PageCard>
      <div class="settings-toolbar">
        <div class="save-state" :class="{ 'is-dirty': isDirty }">
          <i />{{ isDirty ? '有未保存变更' : '配置已同步' }}
        </div>
        <div class="settings-toolbar__actions">
          <el-button :icon="Refresh" @click="load">刷新</el-button>
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
      </div>

      <div class="settings-body">
        <section class="settings-group">
          <header class="settings-group__head">
            <strong>账号</strong>
            <span>注册入口与新用户赠送</span>
          </header>
          <div class="settings-grid settings-grid--pair">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>开放注册</strong>
                <el-switch v-model="form.registrationEnabled" />
              </div>
              <small>控制新用户注册入口</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>注册赠送</strong>
                <div class="points-input">
                  <el-input-number
                    v-model="form.signupBonusPoints"
                    class="settings-stepper"
                    :min="0"
                    :step="1"
                    :precision="0"
                  />
                  <b>积分</b>
                </div>
              </div>
              <small>新账号首次获得的积分</small>
            </label>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>任务并发</strong>
            <span>全站与单用户执行水位</span>
          </header>
          <div class="settings-grid">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>全站同时执行</strong>
                <el-input-number
                  v-model="form.globalMaxConcurrentTasks"
                  class="settings-stepper"
                  :min="1"
                  :max="10000000"
                  :step="100"
                />
              </div>
              <small>
                上游在途上限 · 当前 {{ effectiveGlobalConcurrency }} / Worker
                {{ workerConcurrencyCeiling }}
              </small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>单用户同时执行</strong>
                <el-input-number
                  v-model="form.userMaxConcurrentTasks"
                  class="settings-stepper"
                  :min="1"
                  :max="10000"
                />
              </div>
              <small>每个账号允许同时处于上游执行中的任务数</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>全站待处理容量</strong>
                <el-input-number
                  v-model="form.globalMaxActiveTasks"
                  class="settings-stepper"
                  :min="10"
                  :max="10000000"
                  :step="100"
                />
              </div>
              <small>排队与运行达到水位后停止接收新任务</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>单用户待处理任务</strong>
                <el-input-number
                  v-model="form.userMaxRunningTasks"
                  class="settings-stepper"
                  :min="1"
                  :max="10000"
                />
              </div>
              <small>运行中与排队中的任务总量上限</small>
            </label>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>调度与重试</strong>
            <span>失败补偿与跨服务商泄压</span>
          </header>
          <div class="settings-grid settings-grid--pair">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>任务失败重试</strong>
                <el-input-number
                  v-model="form.taskFailureRetryCount"
                  class="settings-stepper"
                  :min="0"
                  :max="100"
                  :step="1"
                  :precision="0"
                />
              </div>
              <small>连接、超时或临时上游错误的额外尝试次数；0 表示不重试</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>同名模型跨服务商泄压</strong>
                <el-switch v-model="form.crossProviderSameModelBalancingEnabled" />
              </div>
              <small>仅同类型、同名称、同积分且参数兼容的模型参与容量调度</small>
            </label>
          </div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.settings-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.settings-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.save-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.save-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.save-state.is-dirty {
  color: var(--warning);
}

.save-state.is-dirty i {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.settings-body {
  display: grid;
  gap: 20px;
  width: 100%;
}

.settings-group {
  display: grid;
  gap: 10px;
}

.settings-group__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
}

.settings-group__head strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.settings-group__head span {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 500;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.settings-grid--pair {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.setting-tile {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 6px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: default;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.setting-tile:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--surface-2) 55%, var(--surface));
}

.setting-tile__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.setting-tile__top strong {
  min-width: 0;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.setting-tile > small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
}

.points-input {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.points-input b {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.setting-tile :deep(.settings-stepper) {
  width: 136px;
  line-height: 34px;
}

.setting-tile :deep(.settings-stepper .el-input-number__decrease),
.setting-tile :deep(.settings-stepper .el-input-number__increase) {
  width: 30px;
  color: var(--ink-2);
  background: var(--surface-2);
  border-color: var(--border);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.setting-tile :deep(.settings-stepper .el-input-number__decrease) {
  border-radius: var(--radius-control) 0 0 var(--radius-control);
}

.setting-tile :deep(.settings-stepper .el-input-number__increase) {
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}

.setting-tile :deep(.settings-stepper .el-input-number__decrease:hover),
.setting-tile :deep(.settings-stepper .el-input-number__increase:hover) {
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.setting-tile :deep(.settings-stepper .el-input__wrapper) {
  height: 34px;
  padding: 0 34px;
  border-radius: var(--radius-control);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--border) inset;
  transition: box-shadow 0.15s ease;
}

.setting-tile :deep(.settings-stepper .el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 55%, var(--border)) inset,
    0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.setting-tile :deep(.settings-stepper .el-input__inner) {
  height: 34px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
  text-align: center;
}


</style>
