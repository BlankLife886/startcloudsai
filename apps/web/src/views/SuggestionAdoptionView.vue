<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { submitFeedback } from '@/services/feedbackApi'
import { getGrowthPrograms } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'

const router = useRouter()
const appearanceStore = useAppearanceStore()

const suggestionTypes = [
  { value: 'feature', label: '新功能建议' },
  { value: 'experience', label: '体验优化' },
  { value: 'generation', label: '模型与生成效果' },
  { value: 'content', label: '内容与活动' },
  { value: 'other', label: '其他建议' },
]

const form = reactive({ title: '', content: '', type: '' })
const submitting = ref(false)
const loading = ref(true)
const growthData = ref(null)

const selectedType = computed(() => suggestionTypes.find((item) => item.value === form.type))
const rewardLabel = computed(() => {
  const cents = Number(growthData.value?.rules?.suggestionRewardMaxCents || 0)
  return cents > 0 ? formatPoints(cents).replace(/\s*积分\s*$/, '') : '—'
})
const canSubmit = computed(
  () =>
    form.title.trim().length >= 5 &&
    form.title.trim().length <= 50 &&
    form.content.trim().length >= 20 &&
    form.content.trim().length <= 1000 &&
    Boolean(form.type) &&
    !submitting.value,
)

const processSteps = [
  {
    icon: 'bi-lightbulb-fill',
    title: '提交建议',
    copy: '填写建议并提交，我们会尽快评估',
  },
  {
    icon: 'bi-file-earmark-text-fill',
    title: '评估审核',
    copy: '产品团队评估建议价值与可行性',
  },
  {
    icon: 'bi-patch-check-fill',
    title: '采纳通知',
    copy: '建议被采纳后，系统会通知你',
  },
  {
    icon: 'bi-stack',
    title: '发放奖励',
    copy: '按价值等级发放创作积分',
  },
]

const tips = [
  { icon: 'bi-chat-quote', title: '真实具体', copy: '写清问题、场景与可执行方案' },
  { icon: 'bi-award', title: '按价值奖励', copy: '采纳后按等级发放积分' },
  { icon: 'bi-clock-history', title: '进度可查', copy: '可在问题反馈中追踪状态' },
]

function goBack() {
  const canGoBack =
    typeof window !== 'undefined' &&
    window.history.length > 1 &&
    Boolean(window.history.state?.back)
  if (canGoBack) router.back()
  else router.push('/incentive-plans')
}

async function loadRewardRule() {
  loading.value = true
  try {
    growthData.value = await getGrowthPrograms()
  } catch {
    growthData.value = null
  } finally {
    loading.value = false
  }
}

async function submitSuggestion() {
  if (!canSubmit.value) {
    notificationService.info('请完整填写标题、建议描述与建议类型')
    return
  }

  submitting.value = true
  try {
    await submitFeedback({
      category: 'suggestion',
      title: form.title,
      content: `建议类型：${selectedType.value.label}\n\n${form.content}`,
      pageUrl: '/incentive-plans/suggestion',
    })
    form.title = ''
    form.content = ''
    form.type = ''
    notificationService.success('产品建议已提交，可在问题反馈中查看处理进度')
  } catch (error) {
    notificationService.error(error?.message || '产品建议提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(loadRewardRule)
</script>

<template>
  <main class="suggestion-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <header class="suggestion-top">
      <div class="suggestion-shell suggestion-top__inner">
        <button type="button" class="suggestion-back" @click="goBack">
          <i class="bi bi-arrow-left" aria-hidden="true"></i>
          返回
        </button>
        <div class="suggestion-top__copy">
          <h1>建议采纳</h1>
          <p>提交真实、具体且可执行的产品建议，采纳后按价值等级发放创作积分。</p>
        </div>
        <div class="suggestion-facts" aria-label="建议采纳概览">
          <span
            ><i class="bi bi-stars"></i>上限 {{ loading ? '—' : rewardLabel }} 积分</span
          >
          <span><i class="bi bi-tags"></i>{{ suggestionTypes.length }} 类建议</span>
          <span><i class="bi bi-clock-history"></i>问题反馈追踪</span>
        </div>
      </div>
    </header>

    <section class="suggestion-shell suggestion-workspace" aria-label="建议提交">
      <div class="suggestion-layout">
        <form class="suggestion-form" @submit.prevent="submitSuggestion">
          <div class="section-copy">
            <span class="section-kicker">提交建议</span>
            <h2>产品建议</h2>
            <p>写清问题、场景、方案与预期价值，便于更快评估与采纳。</p>
          </div>

          <label class="suggestion-field">
            <span>建议标题</span>
            <span class="suggestion-control">
              <input
                v-model="form.title"
                maxlength="50"
                autocomplete="off"
                placeholder="请简要概括你的建议（不超过 50 字）"
              />
              <small>{{ form.title.length }}/50</small>
            </span>
          </label>

          <label class="suggestion-field suggestion-field--grow">
            <span>建议描述</span>
            <span class="suggestion-control suggestion-control--textarea">
              <textarea
                v-model="form.content"
                maxlength="1000"
                placeholder="请详细描述你的建议，包括问题、场景、方案与预期价值（不少于 20 字）"
              ></textarea>
              <small>{{ form.content.length }}/1000</small>
            </span>
          </label>

          <label class="suggestion-field">
            <span>建议类型</span>
            <span class="suggestion-control suggestion-control--select">
              <select v-model="form.type">
                <option value="" disabled>请选择建议类型</option>
                <option v-for="item in suggestionTypes" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </span>
          </label>

          <div class="suggestion-submit-row">
            <p>
              提交后可在
              <RouterLink to="/feedback?category=suggestion">问题反馈</RouterLink>
              中追踪建议状态与奖励进度
            </p>
            <button type="submit" class="primary-action" :disabled="!canSubmit">
              <i class="bi bi-send"></i>
              {{ submitting ? '正在提交…' : '提交产品建议' }}
            </button>
          </div>
        </form>

        <aside class="suggestion-process" aria-label="建议处理流程">
          <div class="section-copy">
            <span class="section-kicker">处理流程</span>
            <h2>从提交到奖励</h2>
            <p>全程可在问题反馈中追踪进度。</p>
          </div>
          <ol>
            <li v-for="(step, index) in processSteps" :key="step.title">
              <span class="process-icon" aria-hidden="true">
                <i class="bi" :class="step.icon"></i>
              </span>
              <span class="process-index">{{ index + 1 }}</span>
              <div>
                <strong>{{ step.title }}</strong>
                <p>{{ step.copy }}</p>
              </div>
            </li>
          </ol>
        </aside>
      </div>
    </section>

    <footer class="suggestion-tips" aria-labelledby="suggestion-tips-title">
      <div class="suggestion-shell">
        <h2 id="suggestion-tips-title" class="sr-only">建议采纳说明</h2>
        <ol class="tip-list">
          <li v-for="item in tips" :key="item.title">
            <span><i class="bi" :class="item.icon" aria-hidden="true"></i></span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.copy }}</p>
            </div>
          </li>
        </ol>
      </div>
    </footer>
  </main>
</template>

<style scoped>
:global(.app-container > .main-content:has(> .suggestion-page)) {
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
  overflow: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.suggestion-page {
  --ink: #17171f;
  --body: #4f5160;
  --muted: #777785;
  --accent: #6d5cff;
  --accent-deep: #5746e5;
  --accent-soft: rgb(109 92 255 / 10%);
  --accent-hover: #4f3fe0;
  --surface: #ffffff;
  --surface-soft: #f6f5fc;
  --line: rgb(21 22 31 / 10%);
  --hero: #f4f3fa;
  --focus-ring: rgb(109 92 255 / 14%);
  --process-muted: #777785;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 100dvh;
  max-height: 100dvh;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink);
  background: var(--surface);
}

.suggestion-page.is-dark {
  --ink: rgba(255, 255, 255, 0.96);
  --body: rgb(255 255 255 / 72%);
  --muted: rgb(255 255 255 / 52%);
  --accent: #8b7bff;
  --accent-deep: #a99cff;
  --accent-soft: rgb(109 92 255 / 16%);
  --accent-hover: #9d8fff;
  --surface: #121218;
  --surface-soft: #1a1824;
  --line: rgb(255 255 255 / 10%);
  --hero: #161422;
  --focus-ring: rgb(139 123 255 / 18%);
  --process-muted: rgb(255 255 255 / 52%);
}

.suggestion-shell {
  width: min(1100px, calc(100% - 40px));
  margin-inline: auto;
}

.suggestion-top {
  --hero-pad-top: calc(var(--app-header-offset, 72px) + var(--app-page-content-top-gap, 0px));
  flex: 0 0 auto;
  margin-top: calc(-1 * var(--hero-pad-top));
  padding: calc(var(--hero-pad-top) + 10px) 0 14px;
  background:
    radial-gradient(circle at 92% 0%, rgb(109 92 255 / 16%), transparent 36%),
    linear-gradient(145deg, var(--hero) 0%, color-mix(in srgb, var(--accent) 6%, var(--hero)) 100%);
  border-bottom: 1px solid var(--line);
}

.suggestion-top__inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}

.suggestion-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  color: var(--body);
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
}

.suggestion-back:hover {
  color: var(--accent);
}

.suggestion-top__copy h1 {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 840;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.suggestion-top__copy p {
  margin: 4px 0 0;
  color: var(--body);
  font-size: 0.84rem;
  line-height: 1.4;
}

.suggestion-facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.suggestion-facts span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 720;
}

.suggestion-facts i {
  color: var(--accent);
}

.suggestion-workspace {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  padding: 14px 0 10px;
  overflow: hidden;
}

.suggestion-layout {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1.45fr) minmax(240px, 0.85fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
}

.suggestion-form,
.suggestion-process {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 16px 18px;
  overflow: hidden;
}

.suggestion-form {
  background: var(--surface);
}

.suggestion-process {
  background: var(--surface-soft);
  border-left: 1px solid var(--line);
}

.section-kicker {
  color: var(--accent-deep);
  font-size: 0.72rem;
  font-weight: 750;
}

.section-copy h2 {
  margin: 4px 0 0;
  font-size: 1.15rem;
  font-weight: 820;
  line-height: 1.3;
  letter-spacing: -0.02em;
}

.section-copy p {
  margin: 6px 0 0;
  color: var(--body);
  font-size: 0.8rem;
  line-height: 1.5;
}

.suggestion-field {
  display: block;
  margin-top: 10px;
}

.suggestion-field--grow {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.suggestion-field > span:first-child {
  display: block;
  margin-bottom: 6px;
  font-size: 0.82rem;
  font-weight: 700;
}

.suggestion-control {
  position: relative;
  display: block;
}

.suggestion-field--grow .suggestion-control {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.suggestion-control input,
.suggestion-control textarea,
.suggestion-control select {
  width: 100%;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  outline: none;
  font: inherit;
}

.suggestion-control input:focus,
.suggestion-control textarea:focus,
.suggestion-control select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.suggestion-control input {
  height: 40px;
  padding: 0 56px 0 12px;
  font-size: 0.88rem;
}

.suggestion-control textarea {
  min-height: 88px;
  flex: 1 1 auto;
  padding: 10px 56px 24px 12px;
  resize: none;
  font-size: 0.88rem;
  line-height: 1.45;
}

.suggestion-control select {
  height: 40px;
  padding: 0 36px 0 12px;
  appearance: none;
  font-size: 0.88rem;
}

.suggestion-control > small {
  position: absolute;
  right: 12px;
  bottom: 10px;
  color: var(--muted);
  font-size: 0.72rem;
}

.suggestion-control--select > i {
  position: absolute;
  top: 50%;
  right: 14px;
  color: var(--muted);
  pointer-events: none;
  transform: translateY(-50%);
  font-size: 0.82rem;
}

.suggestion-submit-row {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.suggestion-submit-row p {
  margin: 0;
  color: var(--body);
  font-size: 0.76rem;
  line-height: 1.4;
}

.suggestion-submit-row a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 700;
}

.primary-action {
  display: inline-flex;
  flex: 0 0 auto;
  height: 40px;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  border: 0;
  border-radius: 10px;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 750;
  cursor: pointer;
  box-shadow: 0 8px 18px rgb(109 92 255 / 20%);
}

.primary-action:hover:not(:disabled) {
  background: var(--accent-hover);
}

.primary-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.suggestion-process ol {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.suggestion-process li {
  position: relative;
  display: grid;
  grid-template-columns: 40px 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
}

.suggestion-process li:not(:last-child)::after {
  position: absolute;
  top: calc(50% + 18px);
  bottom: -6px;
  left: 19px;
  width: 2px;
  background: repeating-linear-gradient(
    color-mix(in srgb, var(--accent) 35%, var(--line)) 0 4px,
    transparent 4px 8px
  );
  content: '';
}

.process-icon {
  position: relative;
  z-index: 1;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  border-radius: 11px;
  font-size: 1.05rem;
  box-shadow: 0 6px 12px rgb(109 92 255 / 18%);
}

.process-index {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  border-radius: 50%;
  font-size: 0.68rem;
  font-weight: 800;
}

.suggestion-process li > div {
  min-width: 0;
}

.suggestion-process li strong {
  display: block;
  font-size: 0.86rem;
}

.suggestion-process li p {
  margin: 3px 0 0;
  color: var(--process-muted);
  font-size: 0.72rem;
  line-height: 1.4;
}

.suggestion-tips {
  flex: 0 0 auto;
  padding: 10px 0 14px;
  background: var(--surface-soft);
  border-top: 1px solid var(--line);
}

.tip-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tip-list li {
  display: flex;
  min-width: 0;
  gap: 10px;
}

.tip-list li > span {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  border-radius: 50%;
  font-size: 0.72rem;
}

.tip-list strong {
  display: block;
  font-size: 0.78rem;
}

.tip-list p {
  margin: 3px 0 0;
  color: var(--body);
  font-size: 0.7rem;
  line-height: 1.4;
}

@media (max-width: 960px) {
  :global(.app-container > .main-content:has(> .suggestion-page)) {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .suggestion-page {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .suggestion-top__inner {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .suggestion-facts {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .suggestion-workspace {
    overflow: visible;
  }

  .suggestion-layout {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .suggestion-process {
    border-top: 1px solid var(--line);
    border-left: 0;
  }

  .tip-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .suggestion-shell {
    width: calc(100% - 28px);
  }

  .suggestion-top__inner {
    gap: 10px;
  }

  .suggestion-top__copy h1 {
    font-size: 1.3rem;
  }

  .suggestion-form,
  .suggestion-process {
    padding: 14px;
  }

  .suggestion-submit-row {
    flex-direction: column;
    align-items: stretch;
  }

  .primary-action {
    justify-content: center;
    width: 100%;
  }

  .tip-list {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}
</style>
