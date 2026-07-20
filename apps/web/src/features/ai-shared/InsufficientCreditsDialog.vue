<script setup>
import { useRouter } from 'vue-router'

defineProps({
  show: { type: Boolean, default: false },
  required: { type: Number, default: 0 },
  available: { type: Number, default: 0 },
})

const emit = defineEmits(['close'])
const router = useRouter()

function formatCredits(value = 0) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0'
  return num >= 1000 ? Math.round(num).toLocaleString() : String(Math.round(num * 1000) / 1000)
}

function goRecharge() {
  emit('close')
  router.push({ path: '/pricing', query: { section: 'wallet' } })
}
</script>

<template>
  <div v-if="show" class="insufficient-credits-layer" @click.self="emit('close')">
    <section class="insufficient-credits-panel" role="dialog" aria-modal="true">
      <div class="insufficient-credits-icon">
        <i class="bi bi-coin"></i>
      </div>
      <h3>钱包余额不足</h3>
      <p v-if="required > 0">
        本次预计需要 <strong>¥{{ formatCredits(required) }}</strong
        >，当前可用 <strong>¥{{ formatCredits(available) }}</strong
        >。
      </p>
      <p v-else>当前钱包余额不足以提交本次任务。</p>
      <p class="insufficient-credits-hint">
        请前往 <strong>价格页</strong> 充值或使用兑换码入账后再试。
      </p>
      <div class="insufficient-credits-actions">
        <button type="button" class="ghost" @click="emit('close')">稍后再说</button>
        <button type="button" class="primary" @click="goRecharge">去充值</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.insufficient-credits-layer {
  position: fixed;
  inset: 0;
  z-index: 5200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(8, 10, 18, 0.62);
  backdrop-filter: blur(4px);
}

.insufficient-credits-panel {
  width: min(420px, 100%);
  padding: 22px 20px 18px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #15151c;
  color: #f4f4f5;
  text-align: center;
}

.insufficient-credits-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 10px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  font-size: 1.25rem;
}

.insufficient-credits-panel h3 {
  margin: 0 0 8px;
}

.insufficient-credits-panel p {
  margin: 0 0 8px;
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.55;
}

.insufficient-credits-hint {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.62);
}

.insufficient-credits-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}

.insufficient-credits-actions button {
  border-radius: 999px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.insufficient-credits-actions .primary {
  border: none;
  background: linear-gradient(135deg, #7c3aed, #6366f1);
  color: #fff;
}
</style>
