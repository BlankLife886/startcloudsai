<script setup>
import { onUnmounted, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  title: { type: String, default: '退出登录' },
  description: {
    type: String,
    default: '确定退出当前登录吗？退出后将切换为本机访客资料，云同步数据需重新登录后恢复。',
  },
})

const emit = defineEmits(['update:open', 'confirm'])

function close() {
  if (props.loading) return
  emit('update:open', false)
}

function confirm() {
  emit('confirm')
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.open && !props.loading) close()
}

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  },
)

onUnmounted(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="profile-logout-modal" @click.self="close">
      <div
        class="profile-logout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-logout-title"
      >
        <div class="profile-logout-dialog__icon" aria-hidden="true">
          <i class="bi bi-box-arrow-right"></i>
        </div>
        <h3 id="profile-logout-title">{{ title }}</h3>
        <p>{{ description }}</p>
        <div class="profile-logout-dialog__actions">
          <button type="button" class="profile-logout-dialog__cancel" :disabled="loading" @click="close">
            取消
          </button>
          <button type="button" class="profile-logout-dialog__confirm" :disabled="loading" @click="confirm">
            <span v-if="loading" class="profile-logout-dialog__spinner" aria-hidden="true"></span>
            {{ loading ? '退出中…' : '确认退出' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
