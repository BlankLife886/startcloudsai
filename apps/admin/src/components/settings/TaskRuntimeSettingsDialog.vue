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
  taskRetryFirstDelaySecs: 3,
  taskRetryBackoffSecs: 15,
  crossProviderSameModelBalancingEnabled: false,
  imageVariantFormat: 'webp',
  imageDisplayLossless: false,
  imageDisplayQuality: 85,
  imageDisplayMaxEdge: 2048,
  imageThumbMaxEdge: 512,
  imageFetchConcurrency: 8,
})

function hydrate(settings: AdminSettings) {
  form.userMaxRunningTasks = settings.userMaxRunningTasks ?? 100
  form.userMaxRunningImages = settings.userMaxRunningImages ?? 400
  form.userMaxConcurrentTasks = settings.userMaxConcurrentTasks ?? 20
  form.globalMaxConcurrentTasks = settings.globalMaxConcurrentTasks ?? 2000
  form.globalMaxActiveTasks = settings.globalMaxActiveTasks ?? 12000
  form.globalMaxActiveImages = settings.globalMaxActiveImages ?? 12000
  form.taskFailureRetryCount = settings.taskFailureRetryCount ?? 2
  form.taskRetryFirstDelaySecs = settings.taskRetryFirstDelaySecs ?? 3
  form.taskRetryBackoffSecs = settings.taskRetryBackoffSecs ?? 15
  form.crossProviderSameModelBalancingEnabled =
    settings.crossProviderSameModelBalancingEnabled ?? false
  form.imageVariantFormat = settings.imageVariantFormat === 'png' ? 'png' : 'webp'
  form.imageDisplayLossless = settings.imageDisplayLossless ?? false
  form.imageDisplayQuality = settings.imageDisplayQuality ?? 85
  form.imageDisplayMaxEdge = settings.imageDisplayMaxEdge ?? 2048
  form.imageThumbMaxEdge = settings.imageThumbMaxEdge ?? 512
  form.imageFetchConcurrency = settings.imageFetchConcurrency ?? 8
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
          taskRetryFirstDelaySecs: form.taskRetryFirstDelaySecs,
          taskRetryBackoffSecs: form.taskRetryBackoffSecs,
          crossProviderSameModelBalancingEnabled:
            form.crossProviderSameModelBalancingEnabled,
          imageVariantFormat: form.imageVariantFormat,
          imageDisplayLossless: form.imageDisplayLossless,
          imageDisplayQuality: form.imageDisplayQuality,
          imageDisplayMaxEdge: form.imageDisplayMaxEdge,
          imageThumbMaxEdge: form.imageThumbMaxEdge,
          imageFetchConcurrency: form.imageFetchConcurrency,
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
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>首次重试等待</strong><small>上游临时报错后第一次重试前的等待，越短用户等待越少</small></div><div class="module-settings-control"><el-input-number v-model="form.taskRetryFirstDelaySecs" :min="1" :max="600" :precision="0" /><span>秒</span></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>后续重试间隔</strong><small>第 N 次重试等待 (N-1)×该值 秒，避免持续打爆上游</small></div><div class="module-settings-control"><el-input-number v-model="form.taskRetryBackoffSecs" :min="1" :max="600" :precision="0" /><span>秒</span></div></div>
        </div>
      </section>

      <section class="module-settings-section">
        <header class="module-settings-section__head"><div><strong>图片处理</strong><small>生成结果和上传图片会额外产出「小图 + 展示图」，页面加载更快；下载始终是原图</small></div></header>
        <div class="module-settings-grid">
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>压缩格式</strong><small>WebP 体积更小；PNG 兼容性最好，两者都支持透明底</small></div><div class="module-settings-control"><el-radio-group v-model="form.imageVariantFormat"><el-radio-button value="webp">WebP</el-radio-button><el-radio-button value="png">PNG</el-radio-button></el-radio-group></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>展示图无损压缩</strong><small>仅 WebP 生效：开启后画质零损失但体积更大；PNG 天生无损</small></div><el-switch v-model="form.imageDisplayLossless" :disabled="form.imageVariantFormat !== 'webp'" /></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>展示图质量</strong><small>仅有损 WebP 生效，85 基本看不出差别</small></div><div class="module-settings-control"><el-input-number v-model="form.imageDisplayQuality" :min="1" :max="100" :precision="0" :disabled="form.imageVariantFormat !== 'webp' || form.imageDisplayLossless" /><span>分</span></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>展示图最长边</strong><small>点开大图时看到的尺寸上限，超出等比缩小</small></div><div class="module-settings-control"><el-input-number v-model="form.imageDisplayMaxEdge" :min="512" :max="8192" :step="256" :precision="0" /><span>像素</span></div></div>
          <div class="module-settings-field"><div class="module-settings-field__copy"><strong>小图最长边</strong><small>列表和网格缩略图的尺寸上限</small></div><div class="module-settings-control"><el-input-number v-model="form.imageThumbMaxEdge" :min="128" :max="1024" :step="64" :precision="0" /><span>像素</span></div></div>
          <div class="module-settings-field module-settings-field--wide"><div class="module-settings-field__copy"><strong>上游出图后同时拉回</strong><small>同时从上游图床下载并入库的数量。图床较弱时建议 2；机器升级后可调高</small></div><div class="module-settings-control"><el-input-number v-model="form.imageFetchConcurrency" :min="1" :max="32" :precision="0" /><span>张</span></div></div>
        </div>
      </section>
    </div>
  </AdminDialog>
</template>
