<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  siteKey: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:token', 'ready', 'error'])

const containerRef = ref(null)
const widgetError = ref('')
const widgetLoading = ref(false)
let widgetId = null
let scriptEl = null

function resetWidget() {
  emit('update:token', '')
  widgetError.value = ''
  if (widgetId !== null && window.turnstile?.reset) {
    try {
      window.turnstile.reset(widgetId)
    } catch {
      // Ignore widget reset failures.
    }
  }
}

function renderWidget() {
  if (!props.enabled || !props.siteKey || !containerRef.value || !window.turnstile?.render) return

  widgetError.value = ''
  if (widgetId !== null) {
    try {
      window.turnstile.remove(widgetId)
    } catch {
      // Ignore widget cleanup failures.
    }
    widgetId = null
  }

  containerRef.value.innerHTML = ''
  try {
    widgetId = window.turnstile.render(containerRef.value, {
      sitekey: props.siteKey,
      theme: 'dark',
      callback: (token) => {
        widgetLoading.value = false
        emit('update:token', token)
      },
      'error-callback': () => {
        widgetLoading.value = false
        widgetError.value = '人机验证加载失败，请刷新页面重试'
        emit('error', widgetError.value)
      },
      'expired-callback': () => emit('update:token', ''),
    })
    widgetLoading.value = false
    emit('ready')
  } catch {
    widgetLoading.value = false
    widgetError.value = '人机验证初始化失败，请刷新页面重试'
    emit('error', widgetError.value)
  }
}

async function ensureScript() {
  if (!props.enabled || !props.siteKey) {
    widgetLoading.value = false
    widgetError.value = ''
    emit('update:token', '')
    emit('ready')
    return
  }

  widgetLoading.value = true
  widgetError.value = ''
  await nextTick()

  if (window.turnstile?.render) {
    renderWidget()
    return
  }

  if (!scriptEl) {
    scriptEl = document.createElement('script')
    scriptEl.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    scriptEl.async = true
    scriptEl.defer = true
    scriptEl.onload = () => renderWidget()
    scriptEl.onerror = () => {
      widgetLoading.value = false
      widgetError.value = '人机验证脚本加载失败，请检查网络后刷新'
      emit('error', widgetError.value)
    }
    document.head.appendChild(scriptEl)
  }
}

onMounted(ensureScript)

watch(
  () => [props.siteKey, props.enabled],
  () => {
    ensureScript()
  },
)

onBeforeUnmount(() => {
  if (widgetId !== null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(widgetId)
    } catch {
      // Ignore widget cleanup failures.
    }
  }
})

defineExpose({ reset: resetWidget })
</script>

<template>
  <div v-if="enabled && siteKey" class="auth-turnstile">
    <p v-if="widgetLoading" class="auth-turnstile__status">正在加载人机验证…</p>
    <p v-if="widgetError" class="auth-turnstile__error" role="alert">{{ widgetError }}</p>
    <div ref="containerRef" class="auth-turnstile__widget"></div>
  </div>
</template>
