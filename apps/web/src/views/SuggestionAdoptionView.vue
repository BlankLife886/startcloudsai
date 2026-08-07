<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { submitFeedback } from '@/services/feedbackApi'
import { getGrowthPrograms } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'

const suggestionTypes = [
  { value: 'feature', label: '新功能建议' },
  { value: 'experience', label: '体验优化' },
  { value: 'generation', label: '模型与生成效果' },
  { value: 'content', label: '内容与活动' },
  { value: 'other', label: '其他建议' },
]

const form = reactive({ title: '', content: '', type: '' })
const submitting = ref(false)
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

async function loadRewardRule() {
  try {
    growthData.value = await getGrowthPrograms()
  } catch {
    growthData.value = null
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
  <main class="suggestion-page">
    <section class="suggestion-hero">
      <span class="suggestion-hero__glow" aria-hidden="true"></span>
      <div class="suggestion-shell suggestion-hero__inner">
        <div class="suggestion-hero__copy">
          <h1>建议<span>采纳页面</span></h1>
          <p>让真实、有价值的产品建议获得清晰回报。</p>

          <div class="reward-banner">
            <div class="reward-banner__asset" aria-hidden="true"></div>
            <div class="reward-banner__copy">
              <span>单次奖励上限</span>
              <strong>{{ rewardLabel }} <small>积分</small></strong>
              <p>提交真实、具体且可执行的产品建议，采纳后按价值等级发放奖励。</p>
            </div>
          </div>
        </div>
        <div class="suggestion-hero__asset" aria-hidden="true"></div>
      </div>
    </section>

    <section class="suggestion-workspace">
      <form class="suggestion-card suggestion-form" @submit.prevent="submitSuggestion">
        <h2>提交产品建议</h2>

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

        <label class="suggestion-field">
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
            提交后可在<RouterLink to="/feedback?category=suggestion">问题反馈</RouterLink
            >中追踪建议状态与奖励进度
          </p>
          <button type="submit" :disabled="!canSubmit">
            {{ submitting ? '正在提交…' : '提交产品建议' }}
          </button>
        </div>
      </form>

      <aside class="suggestion-card suggestion-process">
        <h2>建议处理流程</h2>
        <ol>
          <li class="is-orange">
            <span class="process-icon"><i class="bi bi-lightbulb-fill"></i></span>
            <span class="process-index">1</span>
            <p><strong>提交建议</strong><small>填写建议并提交，我们会尽快评估</small></p>
          </li>
          <li class="is-blue">
            <span class="process-icon"><i class="bi bi-file-earmark-text-fill"></i></span>
            <span class="process-index">2</span>
            <p><strong>评估审核</strong><small>产品团队进行评估，判断建议价值</small></p>
          </li>
          <li class="is-green">
            <span class="process-icon"><i class="bi bi-patch-check-fill"></i></span>
            <span class="process-index">3</span>
            <p><strong>采纳通知</strong><small>建议被采纳后，系统将通知你</small></p>
          </li>
          <li class="is-violet">
            <span class="process-icon"><i class="bi bi-stack"></i></span>
            <span class="process-index">4</span>
            <p><strong>发放奖励</strong><small>按价值等级发放积分奖励</small></p>
          </li>
        </ol>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.suggestion-page {
  --orange: #ff7a16;
  min-width: 1120px;
  min-height: 100vh;
  overflow: hidden;
  color: #202225;
  background: #f8f8f8;
}
.suggestion-shell,
.suggestion-workspace {
  width: min(1456px, calc(100% - 224px));
  margin-inline: auto;
}
.suggestion-hero {
  position: relative;
  height: 440px;
  overflow: hidden;
  background:
    radial-gradient(circle at 76% 12%, rgb(255 219 135 / 45%), transparent 29%),
    linear-gradient(108deg, #fff 0%, #fffaf3 54%, #fff1d2 100%);
}
.suggestion-hero__glow {
  position: absolute;
  top: 33px;
  right: 86px;
  width: 540px;
  height: 340px;
  background: rgb(255 240 198 / 40%);
  border-radius: 50%;
}
.suggestion-hero__inner {
  position: relative;
  display: grid;
  height: 100%;
  grid-template-columns: 55% 45%;
}
.suggestion-hero__copy {
  position: relative;
  z-index: 2;
  padding-top: 73px;
}
.suggestion-hero h1 {
  margin: 0;
  font-size: 82px;
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: 0;
}
.suggestion-hero h1 span {
  color: var(--orange);
}
.suggestion-hero__copy > p {
  margin: 17px 0 0;
  font-size: 29px;
  font-weight: 750;
  line-height: 1.35;
}
.reward-banner {
  display: grid;
  width: 764px;
  height: 171px;
  grid-template-columns: 174px 1fr;
  align-items: center;
  margin-top: 28px;
  background: rgb(255 246 218 / 78%);
  border-radius: 17px;
}
.reward-banner__asset {
  width: 100%;
  height: 100%;
}
.reward-banner__copy {
  display: flex;
  flex-direction: column;
}
.reward-banner__copy > span {
  font-size: 19px;
  font-weight: 750;
}
.reward-banner__copy > strong {
  margin-top: 3px;
  color: var(--orange);
  font-size: 59px;
  font-weight: 850;
  line-height: 1.1;
}
.reward-banner__copy > strong small {
  font-size: 25px;
  font-weight: 750;
}
.reward-banner__copy > p {
  margin: 11px 0 0;
  color: #53565b;
  font-size: 16px;
}
.suggestion-hero__asset {
  position: relative;
  z-index: 1;
}
.suggestion-workspace {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 884px) minmax(0, 548px);
  gap: 32px;
  margin-top: 13px;
  padding-bottom: 24px;
}
.suggestion-card {
  height: 483px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgb(31 35 43 / 5%);
}
.suggestion-card h2 {
  position: relative;
  margin: 0;
  padding-left: 17px;
  font-size: 25px;
  font-weight: 850;
  line-height: 1.25;
}
.suggestion-card h2::before {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 0;
  width: 5px;
  background: var(--orange);
  border-radius: 4px;
  content: '';
}
.suggestion-form {
  padding: 26px 26px 22px;
}
.suggestion-field {
  display: block;
  margin-top: 24px;
}
.suggestion-field + .suggestion-field {
  margin-top: 17px;
}
.suggestion-field > span:first-child {
  display: block;
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 650;
}
.suggestion-control {
  position: relative;
  display: block;
}
.suggestion-control input,
.suggestion-control textarea,
.suggestion-control select {
  width: 100%;
  color: #222;
  background: #fff;
  border: 1px solid #dce1e7;
  border-radius: 9px;
  outline: none;
  font: inherit;
  transition: border-color 150ms ease;
}
.suggestion-control input:focus,
.suggestion-control textarea:focus,
.suggestion-control select:focus {
  border-color: var(--orange);
  box-shadow: 0 0 0 3px rgb(255 122 22 / 9%);
}
.suggestion-control input {
  height: 45px;
  padding: 0 68px 0 15px;
}
.suggestion-control textarea {
  height: 108px;
  padding: 12px 70px 24px 15px;
  resize: none;
}
.suggestion-control select {
  height: 45px;
  padding: 0 46px 0 15px;
  appearance: none;
}
.suggestion-control > small {
  position: absolute;
  right: 15px;
  bottom: 12px;
  color: #b2b7c0;
  font-size: 14px;
}
.suggestion-control--select > i {
  position: absolute;
  top: 50%;
  right: 17px;
  color: #9aa1aa;
  pointer-events: none;
  transform: translateY(-50%);
}
.suggestion-submit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 24px;
}
.suggestion-submit-row p {
  margin: 0;
  color: #8a8f96;
  font-size: 14px;
}
.suggestion-submit-row a {
  margin-inline: 3px;
  color: var(--orange);
  text-decoration: none;
}
.suggestion-submit-row button {
  width: 308px;
  height: 53px;
  flex: 0 0 auto;
  color: #fff;
  background: var(--orange);
  border: 0;
  border-radius: 13px;
  font-size: 18px;
  font-weight: 800;
}
.suggestion-submit-row button:hover:not(:disabled) {
  background: #f36d08;
}
.suggestion-submit-row button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.suggestion-process {
  padding: 26px 25px;
}
.suggestion-process ol {
  display: flex;
  margin: 26px 0 0;
  padding: 0 22px 0 34px;
  list-style: none;
  flex-direction: column;
}
.suggestion-process li {
  --step: #ff8427;
  position: relative;
  display: grid;
  min-height: 94px;
  grid-template-columns: 58px 35px 1fr;
  align-items: start;
  gap: 14px;
}
.suggestion-process li:not(:last-child)::after {
  position: absolute;
  top: 58px;
  bottom: 0;
  left: 28px;
  width: 2px;
  background: repeating-linear-gradient(#ffd7a7 0 5px, transparent 5px 10px);
  content: '';
}
.process-icon {
  position: relative;
  z-index: 1;
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  color: #fff;
  background: var(--step);
  border-radius: 14px;
  box-shadow: 0 7px 14px color-mix(in srgb, var(--step) 22%, transparent);
  font-size: 27px;
}
.process-index {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  margin-top: 4px;
  color: var(--step);
  background: color-mix(in srgb, var(--step) 11%, #fff);
  border-radius: 50%;
  font-size: 16px;
  font-weight: 850;
}
.suggestion-process li p {
  display: flex;
  margin: 4px 0 0;
  flex-direction: column;
  gap: 9px;
}
.suggestion-process li strong {
  font-size: 20px;
}
.suggestion-process li small {
  color: #8f949c;
  font-size: 15px;
}
.suggestion-process li.is-blue {
  --step: #4d8cf7;
}
.suggestion-process li.is-green {
  --step: #3bc978;
}
.suggestion-process li.is-violet {
  --step: #a75bea;
}
@media (max-width: 1360px) {
  .suggestion-shell,
  .suggestion-workspace {
    width: calc(100% - 96px);
  }
  .suggestion-workspace {
    grid-template-columns: minmax(0, 1.62fr) minmax(0, 1fr);
  }
  .reward-banner {
    width: 680px;
  }
}
@media (max-width: 760px) {
  .suggestion-page {
    min-width: 0;
  }
  .suggestion-shell,
  .suggestion-workspace {
    width: calc(100% - 32px);
  }
  .suggestion-hero {
    height: 410px;
  }
  .suggestion-hero__inner {
    display: block;
  }
  .suggestion-hero__copy {
    padding-top: 48px;
  }
  .suggestion-hero h1 {
    font-size: 45px;
  }
  .suggestion-hero__copy > p {
    font-size: 19px;
  }
  .reward-banner {
    width: 100%;
    height: 154px;
    grid-template-columns: 30px 1fr;
    margin-top: 35px;
  }
  .reward-banner__copy > strong {
    font-size: 42px;
  }
  .reward-banner__copy > p {
    padding-right: 15px;
    font-size: 13px;
  }
  .suggestion-workspace {
    display: flex;
    margin-top: 16px;
    flex-direction: column;
  }
  .suggestion-card {
    height: auto;
  }
  .suggestion-form,
  .suggestion-process {
    padding: 22px 18px;
  }
  .suggestion-submit-row {
    align-items: stretch;
    flex-direction: column;
  }
  .suggestion-submit-row button {
    width: 100%;
  }
  .suggestion-process ol {
    padding-inline: 4px;
  }
}
</style>
