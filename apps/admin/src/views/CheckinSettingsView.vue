<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { request } from '@/request'
import { normalizePoints } from '@/utils'
import type { AdminSettings } from '@/components/settings/types'
import stampArt from '@/assets/checkin/stamp.png'
import trophyArt from '@/assets/checkin/trophy.png'
import cycleArt from '@/assets/checkin/cycle.png'

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
function dayShare(index: number) {
  const total = weekTotal.value
  const value = normalizePoints(form.checkinRewards[index])
  if (!total || !value) return 0
  return Math.round((value / total) * 100)
}

const DAY_TONES = ['info', 'violet', 'warning', 'success', 'info', 'violet', 'accent'] as const

function dayArt(index: number) {
  return index === 6 ? trophyArt : stampArt
}

function dayTone(index: number) {
  return DAY_TONES[index]
}

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
  <div v-loading="loading" class="checkin-page">
    <header class="checkin-toolbar">
      <div class="checkin-setting-pill" :class="{ 'is-on': form.checkinEnabled }">
        <span>开放签到</span>
        <el-switch v-model="form.checkinEnabled" size="small" />
      </div>
      <el-input
        v-model="form.checkinCampaignTitle"
        class="checkin-title"
        maxlength="40"
        placeholder="活动标题"
      />
      <div class="checkin-toolbar__right">
        <span v-if="isDirty" class="checkin-dirty">未保存</span>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :loading="saving" :disabled="!isDirty" @click="save">
          保存
        </el-button>
      </div>
    </header>

    <div class="checkin-board">
      <label
        v-for="(_, index) in form.checkinRewards"
        :key="index"
        class="checkin-day"
        :class="[`is-tone-${dayTone(index)}`, { 'is-milestone': index === 6 }]"
      >
        <img class="checkin-day__art" :src="dayArt(index)" alt="" />
        <header>
          <b class="tnum">{{ String(index + 1).padStart(2, '0') }}</b>
          <span>
            第 {{ index + 1 }} 天
            <em v-if="index === 6">里程碑</em>
          </span>
        </header>
        <div class="checkin-day__points">
          <el-input-number
            v-model="form.checkinRewards[index]"
            :min="0"
            :max="1000000"
            :step="index === 6 ? 10 : 5"
            :precision="0"
            :controls="false"
          />
          <i>积分 · {{ dayShare(index) }}%</i>
        </div>
        <div class="checkin-day__bar" aria-hidden="true">
          <i :style="{ width: `${dayShare(index)}%` }" />
        </div>
      </label>
      <article class="checkin-day checkin-day--total">
        <img class="checkin-day__art" :src="cycleArt" alt="" />
        <header>
          <b>周期</b>
          <span>合计</span>
        </header>
        <div class="checkin-day__points checkin-day__points--static">
          <strong class="tnum">{{ weekTotal.toLocaleString('zh-CN') }}</strong>
          <i>每周期积分</i>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped lang="scss">
.checkin-page {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding: 0;
  background: var(--bg);
}

.checkin-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.checkin-setting-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;

  &.is-on {
    border-color: color-mix(in srgb, var(--success) 28%, var(--border));
    background: var(--success-soft);
    color: var(--success);
  }
}

.checkin-title {
  width: min(360px, 42vw);
}

.checkin-toolbar__right {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.checkin-dirty {
  color: var(--warning);
  font-size: 12px;
  font-weight: 650;
}

.checkin-board {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 14px;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-soft) 70%, var(--surface)) 0%,
      var(--surface) 42%
    );
  box-shadow: var(--shadow-sm);
}

.checkin-day {
  --tone: var(--info);
  --tone-mid: var(--violet);
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  padding: 20px 20px 16px;
  border: 1px solid color-mix(in srgb, var(--tone) 22%, var(--border));
  border-radius: var(--radius-card);
  background:
    radial-gradient(90% 70% at 92% 8%, color-mix(in srgb, var(--tone-mid) 28%, transparent), transparent 58%),
    linear-gradient(
      148deg,
      color-mix(in srgb, var(--tone) 46%, var(--surface)) 0%,
      color-mix(in srgb, var(--tone) 22%, var(--surface)) 48%,
      color-mix(in srgb, var(--tone-mid) 16%, var(--surface)) 100%
    );
  cursor: text;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease;

  header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  b {
    color: var(--tone);
    font-size: clamp(28px, 3.6vh, 42px);
    font-weight: 780;
    letter-spacing: -0.06em;
    line-height: 1;
  }

  header span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
    color: var(--tone);
    font-size: 13px;
    font-weight: 650;
    opacity: 0.82;
  }

  em {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-on);
    font-size: 11px;
    font-style: normal;
    font-weight: 750;
    opacity: 1;
  }

  &:focus-within {
    border-color: color-mix(in srgb, var(--tone) 55%, var(--border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
  }

  &.is-tone-violet {
    --tone: var(--violet);
    --tone-mid: var(--info);
  }

  &.is-tone-warning {
    --tone: var(--warning);
    --tone-mid: var(--accent);
  }

  &.is-tone-success {
    --tone: var(--success);
    --tone-mid: var(--accent);
  }

  &.is-tone-accent,
  &.is-milestone {
    --tone: var(--accent-ink);
    --tone-mid: var(--success);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background:
      radial-gradient(90% 70% at 92% 8%, color-mix(in srgb, var(--accent) 36%, transparent), transparent 58%),
      linear-gradient(
        148deg,
        color-mix(in srgb, var(--accent) 52%, var(--surface)) 0%,
        color-mix(in srgb, var(--accent) 28%, var(--surface)) 46%,
        color-mix(in srgb, var(--success) 18%, var(--surface)) 100%
      );

    .checkin-day__bar i {
      background: var(--accent);
    }
  }
}

.checkin-day--total {
  --tone: var(--accent-on);
  cursor: default;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background:
    radial-gradient(80% 70% at 100% 0%, color-mix(in srgb, var(--accent-hover) 70%, transparent), transparent 62%),
    linear-gradient(
      148deg,
      color-mix(in srgb, var(--accent) 82%, var(--accent-hover)) 0%,
      var(--accent) 42%,
      color-mix(in srgb, var(--accent) 68%, var(--success)) 100%
    );

  b,
  header span,
  .checkin-day__points--static strong,
  .checkin-day__points i {
    color: var(--accent-on);
    opacity: 1;
  }

  b {
    letter-spacing: -0.04em;
  }
}

.checkin-day__art {
  position: absolute;
  right: -12px;
  bottom: -28px;
  z-index: 0;
  width: min(62%, 240px);
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 10px 18px rgb(18 20 26 / 0.12));
}

.checkin-day.is-milestone .checkin-day__art {
  width: min(68%, 260px);
  bottom: -22px;
}

.checkin-day__points {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 4px;
  min-width: 0;
  margin-top: auto;
  max-width: 62%;

  :deep(.el-input-number) {
    width: 100%;
  }

  :deep(.el-input__wrapper) {
    padding: 0;
    box-shadow: none;
    background: transparent;
  }

  :deep(.el-input__inner) {
    height: auto;
    padding: 0;
    color: var(--ink);
    font-size: clamp(36px, 5.4vh, 56px);
    font-weight: 780;
    line-height: 1;
    text-align: left;
  }

  i {
    color: var(--ink-3);
    font-size: 13px;
    font-style: normal;
    font-weight: 650;
  }
}

.checkin-day__points--static strong {
  color: var(--ink);
  font-size: clamp(36px, 5.4vh, 56px);
  font-weight: 780;
  letter-spacing: -0.04em;
  line-height: 1;
}

.checkin-day.is-milestone .checkin-day__points {
  :deep(.el-input__inner) {
    color: var(--accent-ink);
  }

  i {
    color: var(--accent-ink);
  }
}

.checkin-day__bar {
  position: relative;
  z-index: 1;
  height: 6px;
  max-width: 46%;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface-3);

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--ink-3) 55%, var(--surface-3));
  }
}

.checkin-day.is-milestone .checkin-day__bar i {
  background: var(--accent);
}

html.dark .checkin-day__art {
  opacity: 0.92;
  filter: drop-shadow(0 8px 16px rgb(0 0 0 / 0.35));
}

@media (prefers-reduced-motion: reduce) {
  .checkin-day {
    transition: none;
  }
}
</style>
