<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  retryable: { type: Boolean, default: false },
  statusText: { type: String, default: '' },
  isAuthenticated: { type: Boolean, default: false },
  undoCount: { type: Number, default: 0 },
})

const emit = defineEmits(['generate', 'apply-download', 'undo', 'reset', 'retry'])
</script>

<template>
  <section class="ai-actions-section">
    <p class="ai-cost-hint">
      {{
        isAuthenticated
          ? '已登录，本次消耗将从壁纸积分扣除并计入你的账号。'
          : '使用云端 AI 处理需要先登录账号。'
      }}
    </p>

    <div v-if="loading" class="ai-inline-status">
      <span class="ai-inline-dot"></span>
      <span>{{ statusText || 'AI 正在生成优化图片，请稍等...' }}</span>
    </div>

    <div class="ai-actions">
      <button type="button" class="ai-btn primary" :disabled="loading" @click="emit('generate')">
        <i class="bi bi-stars"></i>
        <span>{{ loading ? '生成中...' : '生成预览' }}</span>
      </button>
      <button
        type="button"
        class="ai-btn"
        :disabled="loading"
        @click="emit('apply-download')"
      >
        <i class="bi bi-download"></i>
        <span>应用并下载</span>
      </button>
      <button type="button" class="ai-btn" :disabled="loading || !undoCount" @click="emit('undo')">
        <i class="bi bi-arrow-counterclockwise"></i>
        <span>撤销</span>
      </button>
      <button type="button" class="ai-btn" :disabled="loading" @click="emit('reset')">
        <i class="bi bi-image"></i>
        <span>回滚原图</span>
      </button>
    </div>

    <p v-if="error" class="ai-error">{{ error }}</p>
    <button
      v-if="error && retryable && !loading"
      type="button"
      class="ai-retry-btn"
      @click="emit('retry')"
    >
      <i class="bi bi-arrow-clockwise"></i>
      <span>重试本次 AI 任务</span>
    </button>
  </section>
</template>

<style scoped>
.ai-actions-section {
  display: grid;
  gap: 10px;
}

.ai-cost-hint {
  margin: 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.74rem;
  line-height: 1.45;
}

.ai-inline-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.78rem;
  line-height: 1.45;
}

.ai-inline-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #98e4af;
  box-shadow: 0 0 0 0 rgba(152, 228, 175, 0.58);
  animation: aiPulse 1.2s ease-out infinite;
}

.ai-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ai-btn,
.ai-retry-btn {
  min-width: 0;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 0.78rem;
}

.ai-btn.primary {
  grid-column: 1 / -1;
  background: rgba(130, 220, 155, 0.28);
  border-color: rgba(130, 220, 155, 0.62);
  font-weight: 800;
}

.ai-error {
  margin: 0;
  font-size: 0.78rem;
  color: #ff9f9f;
  line-height: 1.45;
}

.ai-retry-btn {
  border-color: rgba(255, 179, 113, 0.45);
  background: rgba(255, 179, 113, 0.14);
  color: #ffd5ab;
  font-size: 0.76rem;
}

@keyframes aiPulse {
  70% {
    box-shadow: 0 0 0 8px rgba(152, 228, 175, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(152, 228, 175, 0);
  }
}
</style>
