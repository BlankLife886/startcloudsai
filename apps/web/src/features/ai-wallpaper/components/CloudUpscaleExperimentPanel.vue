<script setup>
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  providers: { type: Array, default: () => [] },
  experiments: { type: Array, default: () => [] },
  providerId: { type: String, default: '' },
  target: { type: String, default: '4K' },
  runningProviderId: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  selectedExperimentKey: { type: String, default: '' },
})

const emit = defineEmits([
  'close',
  'select-provider',
  'select-target',
  'run',
  'select-experiment',
  'select-original',
])

const selectedProvider = computed(
  () => props.providers.find((provider) => provider.id === props.providerId) || null,
)
const supportedTargets = computed(() => selectedProvider.value?.supportedTargets || [])
const canRun = computed(
  () =>
    Boolean(selectedProvider.value?.available) &&
    supportedTargets.value.includes(props.target) &&
    !props.runningProviderId,
)

function experimentKey(experiment) {
  return `${experiment.provider}:${experiment.target}`
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0))
  if (!value) return '大小未知'
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function formatDimensions(experiment) {
  const width = Number(experiment?.width || 0)
  const height = Number(experiment?.height || 0)
  return width && height ? `${width} × ${height}` : '尺寸读取中'
}
</script>

<template>
  <Transition name="t2i-cloud-panel">
    <aside v-if="open" class="t2i-cloud-upscale-panel" aria-label="云端超清对照实验" @click.stop>
      <header class="t2i-cloud-upscale-head">
        <div>
          <span class="t2i-cloud-upscale-kicker">画质实验室</span>
          <strong>云端超清对照</strong>
        </div>
        <button type="button" aria-label="关闭云端超清面板" @click="emit('close')">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>

      <section class="t2i-cloud-upscale-section">
        <div class="t2i-cloud-upscale-section-title">
          <strong>选择方案</strong>
          <small>{{ loading && !providers.length ? '读取中' : `${providers.length} 种方案` }}</small>
        </div>
        <div v-if="loading && !providers.length" class="t2i-cloud-provider-skeletons">
          <span v-for="index in 4" :key="index"></span>
        </div>
        <div v-else class="t2i-cloud-provider-list">
          <button
            v-for="provider in providers"
            :key="provider.id"
            type="button"
            class="t2i-cloud-provider-card"
            :class="{
              'is-selected': provider.id === providerId,
              'is-unavailable': !provider.available,
            }"
            @click="emit('select-provider', provider.id)"
          >
            <span class="t2i-cloud-provider-radio" aria-hidden="true"></span>
            <span class="t2i-cloud-provider-copy">
              <strong>{{ provider.label }}</strong>
              <small>{{ provider.description }}</small>
              <em>{{ provider.costLabel }}</em>
            </span>
            <span
              class="t2i-cloud-provider-state"
              :class="{ 'is-ready': provider.available }"
              :title="
                provider.available
                  ? '已完成服务配置；实时可用性以本次运行结果为准'
                  : provider.unavailableReason
              "
            >
              {{ provider.available ? '已接入' : '待配置' }}
            </span>
          </button>
        </div>
      </section>

      <section v-if="selectedProvider" class="t2i-cloud-upscale-section is-runner">
        <div class="t2i-cloud-upscale-section-title">
          <strong>目标尺寸</strong>
          <small>结果卡会显示真实像素</small>
        </div>
        <div class="t2i-cloud-targets">
          <button
            v-for="size in supportedTargets"
            :key="size"
            type="button"
            :class="{ 'is-selected': target === size }"
            @click="emit('select-target', size)"
          >
            {{ size }}
          </button>
        </div>
        <p v-if="!selectedProvider.available" class="t2i-cloud-upscale-unavailable">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          {{ selectedProvider.unavailableReason }}。配置后即可在此直接测试。
        </p>
        <p v-else-if="error" class="t2i-cloud-upscale-error">{{ error }}</p>
        <button
          type="button"
          class="t2i-cloud-upscale-run"
          :disabled="!canRun"
          @click="emit('run')"
        >
          <i
            class="bi"
            :class="runningProviderId ? 'bi-arrow-repeat spin' : 'bi-stars'"
            aria-hidden="true"
          ></i>
          <span>
            {{
              runningProviderId
                ? `${selectedProvider.label} 处理中`
                : selectedProvider.available
                  ? `测试 ${selectedProvider.label} · ${target}`
                  : '当前方案尚未配置'
            }}
          </span>
        </button>
      </section>

      <section class="t2i-cloud-upscale-section is-results">
        <div class="t2i-cloud-upscale-section-title">
          <strong>对照结果</strong>
          <small>{{ experiments.length ? `${experiments.length} 个云端结果` : '尚未测试' }}</small>
        </div>
        <div class="t2i-cloud-result-grid">
          <button
            type="button"
            class="t2i-cloud-result-card is-original"
            :class="{ 'is-selected': !selectedExperimentKey }"
            @click="emit('select-original')"
          >
            <span><i class="bi bi-image" aria-hidden="true"></i></span>
            <strong>当前原图</strong>
            <small>基准画面</small>
          </button>
          <button
            v-for="experiment in experiments"
            :key="experimentKey(experiment)"
            type="button"
            class="t2i-cloud-result-card"
            :class="{ 'is-selected': selectedExperimentKey === experimentKey(experiment) }"
            @click="emit('select-experiment', experiment)"
          >
            <span>{{ experiment.target }}</span>
            <strong>{{ experiment.providerLabel }}</strong>
            <small>{{ formatDimensions(experiment) }} · {{ formatBytes(experiment.bytes) }}</small>
          </button>
        </div>
      </section>
    </aside>
  </Transition>
</template>
