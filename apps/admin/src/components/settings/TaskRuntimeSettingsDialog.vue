<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Monitor, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AdminDialog from '@/components/AdminDialog.vue'
import { request } from '@/request'
import type { AdminSettings } from './types'
import './settings-dialog.css'

const open = ref(false)
const loading = ref(false)
const saving = ref(false)
const workerConcurrencyCeiling = ref(1)
const effectiveGlobalConcurrency = ref(1)
const form = reactive({
  userMaxRunningTasks: 100,
  userMaxRunningImages: 400,
  userMaxConcurrentTasks: 20,
  globalMaxConcurrentTasks: 2000,
  globalMaxActiveTasks: 12000,
  globalMaxActiveImages: 12000,
  taskFailureRetryCount: 2,
  crossProviderSameModelBalancingEnabled: false,
})

function hydrate(settings: AdminSettings) {
  form.userMaxRunningTasks = settings.userMaxRunningTasks ?? 100
  form.userMaxRunningImages = settings.userMaxRunningImages ?? 400
  form.userMaxConcurrentTasks = settings.userMaxConcurrentTasks ?? 20
  form.globalMaxConcurrentTasks = settings.globalMaxConcurrentTasks ?? 2000
  form.globalMaxActiveTasks = settings.globalMaxActiveTasks ?? 12000
  form.globalMaxActiveImages = settings.globalMaxActiveImages ?? 12000
  form.taskFailureRetryCount = settings.taskFailureRetryCount ?? 2
  form.crossProviderSameModelBalancingEnabled =
    settings.crossProviderSameModelBalancingEnabled ?? false
  workerConcurrencyCeiling.value = Math.max(1, settings.workerConcurrencyCeiling ?? 1)
  effectiveGlobalConcurrency.value = Math.max(
    1,
    settings.effectiveGlobalConcurrency ?? form.globalMaxConcurrentTasks,
  )
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
  if (loading.value || saving.value) return
  saving.value = true
  try {
    hydrate(
      await request<AdminSettings>('/api/v1/admin/settings', {
        method: 'PUT',
        body: {
          userMaxRunningTasks: form.userMaxRunningTasks,
          userMaxRunningImages: form.userMaxRunningImages,
          userMaxConcurrentTasks: form.userMaxConcurrentTasks,
          globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
          globalMaxActiveTasks: form.globalMaxActiveTasks,
          globalMaxActiveImages: form.globalMaxActiveImages,
          taskFailureRetryCount: form.taskFailureRetryCount,
          crossProviderSameModelBalancingEnabled:
            form.crossProviderSameModelBalancingEnabled,
        },
      }),
    )
    open.value = false
    ElMessage.success('任务调度设置已生效')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-button :icon="Setting" @click="open = true">调度设置</el-button>

  <AdminDialog
    v-model="open"
    title="任务与调度设置"
    subtitle="控制用户准入、队列容量、并发和失败重试"
    :icon="Monitor"
    width="820px"
    confirm-text="保存设置"
    :confirm-loading="saving"
    :confirm-disabled="loading"
    @open="load"
    @confirm="save"
  >
    <div v-loading="loading" class="module-settings-form">
      <div class="module-settings-metrics">
        <div class="module-settings-metric"><span>在线 Worker 并发能力</span><strong>{{ workerConcurrencyCeiling.toLocaleString('zh-CN') }}</strong></div>
        <div class="module-settings-metric"><span>当前全局并发配置</span><strong>{{ effectiveGlobalConcurrency.toLocaleString('zh-CN') }}</strong></div>
      </div>

      <section class="module-settings-section">
        <header class="module-settings-section__head"><div><strong>用户级限制</strong><small>防止单个账号占满队列或执行槽位</small></div></header>
        <div class="module-settings-grid">
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>运行中任务上限</strong><small>包含排队中和生成中的任务</small></div><div class="module-settings-control"><el-input-number v-model="form.userMaxRunningTasks" :min="1" :max="10000" :precision="0" /><span>个</span></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>运行中图片上限</strong><small>按任务内图片数量累计</small></div><div class="module-settings-control"><el-input-number v-model="form.userMaxRunningImages" :min="1" :max="100000" :precision="0" /><span>张</span></div></div>
          <div class="module-settings-field module-settings-field--wide"><div class="module-settings-field__copy"><strong>单用户并发任务</strong><small>同一时间允许进入上游执行的任务数量</small></div><div class="module-settings-control"><el-input-number v-model="form.userMaxConcurrentTasks" :min="1" :max="10000" :precision="0" /><span>个</span></div></div>
        </div>
      </section>

      <section class="module-settings-section">
        <header class="module-settings-section__head"><div><strong>全局容量</strong><small>限制平台整体积压和上游执行规模</small></div></header>
        <div class="module-settings-grid">
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>全局并发任务</strong><small>允许同时进入执行阶段的任务</small></div><div class="module-settings-control"><el-input-number v-model="form.globalMaxConcurrentTasks" :min="1" :max="10000000" :precision="0" /><span>个</span></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>活跃任务容量</strong><small>排队中与生成中的总任务上限</small></div><div class="module-settings-control"><el-input-number v-model="form.globalMaxActiveTasks" :min="10" :max="10000000" :precision="0" /><span>个</span></div></div>
          <div class="module-settings-field module-settings-field--wide"><div class="module-settings-field__copy"><strong>活跃图片容量</strong><small>所有活跃任务的图片数量总上限</small></div><div class="module-settings-control"><el-input-number v-model="form.globalMaxActiveImages" :min="10" :max="10000000" :precision="0" /><span>张</span></div></div>
        </div>
      </section>

      <section class="module-settings-section">
        <header class="module-settings-section__head"><div><strong>失败恢复</strong><small>控制同模型服务商切换和失败重试策略</small></div></header>
        <div class="module-settings-grid">
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>任务失败重试</strong><small>上游返回失败时允许的自动重试次数</small></div><div class="module-settings-control"><el-input-number v-model="form.taskFailureRetryCount" :min="0" :max="100" :precision="0" /><span>次</span></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>跨服务商均衡</strong><small>同模型存在多个服务商时分散请求</small></div><el-switch v-model="form.crossProviderSameModelBalancingEnabled" /></div>
        </div>
      </section>
    </div>
  </AdminDialog>
</template>
