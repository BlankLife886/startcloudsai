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
  router.push({ name: 'pricing', query: { section: 'wallet' } })
}

function goProfileUsage() {
  emit('close')
  router.push({ name: 'profile', query: { tab: 'studio-usage' } })
}
</script>

<template>
  <div v-if="show" class="insufficient-credits-layer" @click.self="emit('close')">
    <section class="insufficient-credits-panel" role="dialog" aria-modal="true">
      <div class="insufficient-credits-icon">
        <i class="bi bi-coin"></i>
      </div>
      <h3>壁纸积分不足</h3>
      <p>
        本次需要 <strong>{{ formatCredits(required) }}</strong> 积分，当前可用
        <strong>{{ formatCredits(available) }}</strong> 积分。
      </p>
      <p class="insufficient-credits-hint">
        请前往 <strong>价格页 → 钱包</strong>，用美元余额兑换壁纸积分后再试。
      </p>
      <div class="insufficient-credits-actions">
        <button type="button" class="ghost" @click="emit('close')">稍后再说</button>
        <button type="button" class="ghost" @click="goProfileUsage">查看用量</button>
        <button type="button" class="primary" @click="goRecharge">去兑换积分</button>
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
