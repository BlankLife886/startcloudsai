<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import ProfileSectionShell from '@/components/profile/ProfileSectionShell.vue'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { listMyFeedback, submitFeedback } from '@/services/feedbackApi'
import notificationService from '@/services/notification'

const route = useRoute()
const appearanceStore = useAppearanceStore()
const authStore = useAuthStore()

const categories = [
  { value: 'bug', label: '功能异常', icon: 'bi-bug', hint: '页面报错或功能无法使用' },
  { value: 'generation', label: '生成问题', icon: 'bi-stars', hint: '生图结果、任务或模型问题' },
  { value: 'account', label: '账号问题', icon: 'bi-person-gear', hint: '登录、资料与账号安全' },
  { value: 'billing', label: '积分与兑换', icon: 'bi-wallet2', hint: '积分、计费或兑换码问题' },
  { value: 'suggestion', label: '产品建议', icon: 'bi-lightbulb', hint: '希望增加或改进的功能' },
  { value: 'other', label: '其他问题', icon: 'bi-chat-square-text', hint: '其他需要协助的事项' },
]

const categoryMap = Object.fromEntries(categories.map((item) => [item.value, item]))
const statusMap = {
  open: { label: '待处理', icon: 'bi-inbox' },
  in_progress: { label: '处理中', icon: 'bi-hourglass-split' },
  resolved: { label: '已解决', icon: 'bi-check2-circle' },
  closed: { label: '已关闭', icon: 'bi-archive' },
}

const requestedCategory = typeof route.query.category === 'string' ? route.query.category : ''
const form = reactive({
  category: categoryMap[requestedCategory] ? requestedCategory : 'bug',
  title: '',
  content: '',
  pageUrl: typeof route.query.from === 'string' ? route.query.from : '',
})
const submitting = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const items = ref([])
const nextCursor = ref(null)

const canSubmit = computed(
  () => form.title.trim().length >= 5 && form.content.trim().length >= 10 && !submitting.value,
)

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function loadFeedback({ append = false } = {}) {
  const busy = append ? loadingMore : loading
  if (busy.value) return
  busy.value = true
  if (!append) loadError.value = ''
  try {
    const page = await listMyFeedback({
      limit: 12,
      cursor: append ? nextCursor.value || '' : '',
    })
    items.value = append ? [...items.value, ...page.items] : page.items
    nextCursor.value = page.nextCursor
  } catch (error) {
    loadError.value = error?.message || '反馈记录读取失败'
  } finally {
    busy.value = false
  }
}

async function submit() {
  if (!canSubmit.value) {
    notificationService.info('请填写至少 5 个字符的标题和 10 个字符的问题描述')
    return
  }
  submitting.value = true
  try {
    const created = await submitFeedback(form)
    items.value = [created, ...items.value]
    form.title = ''
    form.content = ''
    form.pageUrl = ''
    notificationService.success('反馈已提交，我们会尽快处理')
  } catch (error) {
    notificationService.error(error?.message || '反馈提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (authStore.isAuthenticated) void loadFeedback()
})
</script>

<template>
  <div
    class="feedback-page"
    :class="{ 'is-light': !appearanceStore.isDark, 'is-dark': appearanceStore.isDark }"
  >
    <div class="feedback-atmosphere" aria-hidden="true"><span></span><span></span></div>

    <ProfileSectionShell
      title="问题反馈"
      description="遇到问题或有产品建议，告诉我们具体情况和复现方式。"
    >
      <template #actions>
        <span class="feedback-account">
          <i class="bi bi-person-check" aria-hidden="true"></i>
          {{ authStore.user?.email }}
        </span>
      </template>

      <div class="feedback-layout">
        <form class="feedback-form" @submit.prevent="submit">
          <header class="feedback-card-head">
            <span class="feedback-card-icon"><i class="bi bi-send"></i></span>
            <div>
              <h2>提交新反馈</h2>
              <p>信息越具体，我们定位和处理得越快。</p>
            </div>
          </header>

          <fieldset class="feedback-fieldset">
            <legend>问题分类</legend>
            <div class="category-grid">
              <label
                v-for="category in categories"
                :key="category.value"
                class="category-option"
                :class="{ 'is-selected': form.category === category.value }"
              >
                <input v-model="form.category" type="radio" :value="category.value" />
                <span class="category-option__icon"><i class="bi" :class="category.icon"></i></span>
                <span>
                  <strong>{{ category.label }}</strong>
                  <small>{{ category.hint }}</small>
                </span>
                <i class="bi bi-check-circle-fill category-option__check" aria-hidden="true"></i>
              </label>
            </div>
          </fieldset>

          <label class="feedback-field">
            <span>问题标题 <em>必填</em></span>
            <input
              v-model="form.title"
              type="text"
              minlength="5"
              maxlength="120"
              placeholder="用一句话概括你遇到的问题"
              required
            />
            <small>{{ form.title.trim().length }} / 120</small>
          </label>

          <label class="feedback-field">
            <span>详细描述 <em>必填</em></span>
            <textarea
              v-model="form.content"
              rows="7"
              minlength="10"
              maxlength="3000"
              placeholder="请说明操作步骤、预期结果和实际结果。如有错误提示，也请一并填写。"
              required
            ></textarea>
            <small>{{ form.content.trim().length }} / 3000</small>
          </label>

          <label class="feedback-field">
            <span>问题发生页面 <i>可选</i></span>
            <div class="feedback-url-input">
              <i class="bi bi-link-45deg" aria-hidden="true"></i>
              <input
                v-model="form.pageUrl"
                type="text"
                maxlength="500"
                placeholder="例如：https://example.com/text-to-image"
              />
            </div>
          </label>

          <div class="feedback-submit-row">
            <p><i class="bi bi-shield-check"></i> 浏览器信息会随反馈提交，仅用于排查问题。</p>
            <button type="submit" :disabled="!canSubmit">
              <i class="bi" :class="submitting ? 'bi-arrow-repeat spin' : 'bi-send-check'"></i>
              {{ submitting ? '正在提交…' : '提交反馈' }}
            </button>
          </div>
        </form>

        <aside class="feedback-guide">
          <div class="feedback-guide__visual">
            <span><i class="bi bi-chat-heart"></i></span>
            <p>YOUR VOICE<br />SHAPES THE PRODUCT</p>
          </div>
          <h3>反馈处理流程</h3>
          <ol>
            <li>
              <span>01</span>
              <div><strong>提交问题</strong><small>描述问题和复现步骤</small></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>开始处理</strong><small>管理员确认并跟进反馈</small></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>结果通知</strong><small>站内通知同步处理结果</small></div>
            </li>
          </ol>
          <div class="feedback-guide__tip">
            <i class="bi bi-lightbulb"></i>
            <p><strong>更快获得帮助</strong>请避免提交账号密码、验证码或 API 密钥。</p>
          </div>
        </aside>
      </div>

      <section class="feedback-history">
        <header>
          <div>
            <h2>我的反馈</h2>
            <p>查看提交记录、处理状态和管理员回复。</p>
          </div>
          <button type="button" :disabled="loading" @click="loadFeedback()">
            <i class="bi bi-arrow-repeat" :class="{ spin: loading }"></i>刷新
          </button>
        </header>

        <div v-if="loading && !items.length" class="feedback-skeleton" aria-hidden="true">
          <span v-for="n in 3" :key="n"></span>
        </div>
        <div v-else-if="loadError && !items.length" class="feedback-empty is-error">
          <i class="bi bi-cloud-slash"></i><strong>反馈记录加载失败</strong>
          <p>{{ loadError }}</p>
          <button type="button" @click="loadFeedback()">重试</button>
        </div>
        <div v-else-if="!items.length" class="feedback-empty">
          <i class="bi bi-chat-square-text"></i><strong>还没有反馈记录</strong>
          <p>提交后可在这里持续查看处理进度。</p>
        </div>
        <div v-else class="feedback-list">
          <article v-for="item in items" :key="item.id" class="feedback-item">
            <div class="feedback-item__top">
              <span class="feedback-category">
                <i
                  class="bi"
                  :class="categoryMap[item.category]?.icon || 'bi-chat-square-text'"
                ></i>
                {{ categoryMap[item.category]?.label || item.category }}
              </span>
              <span class="feedback-status" :class="`is-${item.status}`">
                <i class="bi" :class="statusMap[item.status]?.icon || 'bi-circle'"></i>
                {{ statusMap[item.status]?.label || item.status }}
              </span>
              <span v-if="item.adopted" class="feedback-adopted">
                <i class="bi bi-lightbulb-fill"></i>
                已采纳 · +{{ item.rewardCents }} 积分
              </span>
            </div>
            <h3>{{ item.title }}</h3>
            <p class="feedback-item__content">{{ item.content }}</p>
            <div v-if="item.adminReply" class="feedback-reply">
              <span><i class="bi bi-person-check-fill"></i>管理员回复</span>
              <p>{{ item.adminReply }}</p>
            </div>
            <footer>
              <span><i class="bi bi-clock"></i>{{ formatTime(item.createdAt) }}</span>
              <a v-if="item.pageUrl" :href="item.pageUrl" target="_blank" rel="noopener noreferrer">
                <i class="bi bi-box-arrow-up-right"></i>问题页面
              </a>
            </footer>
          </article>
        </div>
        <button
          v-if="nextCursor"
          type="button"
          class="feedback-more"
          :disabled="loadingMore"
          @click="loadFeedback({ append: true })"
        >
          {{ loadingMore ? '加载中…' : '加载更多反馈' }}
        </button>
      </section>
    </ProfileSectionShell>
  </div>
</template>

<style scoped>
.feedback-page {
  --fb-text: #1b1927;
  --fb-muted: rgb(27 25 39 / 58%);
  --fb-line: rgb(27 25 39 / 10%);
  --fb-card: rgb(255 255 255 / 90%);
  --fb-soft: rgb(108 92 255 / 7%);
  position: relative;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 32px clamp(16px, 3vw, 38px) 80px;
  overflow: clip;
  color: var(--fb-text);
  background: linear-gradient(180deg, #f6f3ff 0%, #f1f5ff 48%, #f8fafc 100%);
}
.feedback-page.is-dark {
  --fb-text: #f4f2ff;
  --fb-muted: rgb(244 242 255 / 60%);
  --fb-line: rgb(255 255 255 / 12%);
  --fb-card: rgb(24 22 36 / 92%);
  --fb-soft: rgb(169 157 255 / 10%);
  background: linear-gradient(180deg, #120f1c, #171425 52%, #101018);
}
.feedback-page :deep(.ps-shell) {
  position: relative;
  z-index: 1;
}
.feedback-page :deep(.ps-board) {
  padding: 0;
  overflow: hidden;
}
.feedback-atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.feedback-atmosphere span {
  position: absolute;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  filter: blur(2px);
}
.feedback-atmosphere span:first-child {
  top: -330px;
  left: -100px;
  background: rgb(167 139 250 / 24%);
}
.feedback-atmosphere span:last-child {
  top: -360px;
  right: -80px;
  background: rgb(56 189 248 / 14%);
}
.feedback-account {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--fb-line);
  border-radius: 999px;
  color: var(--fb-muted);
  background: var(--fb-card);
  font-size: 0.78rem;
}
.feedback-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.72fr);
}
.feedback-form {
  padding: clamp(24px, 4vw, 44px);
  border-right: 1px solid var(--fb-line);
}
.feedback-card-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 30px;
}
.feedback-card-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 15px;
  color: #6b5cff;
  background: rgb(107 92 255 / 10%);
  font-size: 1.2rem;
}
.feedback-card-head h2,
.feedback-history h2 {
  margin: 0;
  font-size: 1.3rem;
  letter-spacing: -0.025em;
}
.feedback-card-head p,
.feedback-history header p {
  margin: 5px 0 0;
  color: var(--fb-muted);
  font-size: 0.82rem;
}
.feedback-fieldset {
  margin: 0 0 24px;
  padding: 0;
  border: 0;
}
.feedback-fieldset legend,
.feedback-field > span {
  display: block;
  margin-bottom: 10px;
  font-size: 0.8rem;
  font-weight: 760;
}
.feedback-field em,
.feedback-field i {
  margin-left: 5px;
  color: #765fff;
  font-size: 0.68rem;
  font-style: normal;
}
.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
}
.category-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 70px;
  padding: 12px;
  border: 1px solid var(--fb-line);
  border-radius: 14px;
  background: var(--fb-card);
  cursor: pointer;
  transition: 160ms ease;
}
.category-option:hover,
.category-option.is-selected {
  border-color: rgb(107 92 255 / 45%);
  transform: translateY(-1px);
}
.category-option.is-selected {
  background: var(--fb-soft);
  box-shadow: inset 0 0 0 1px rgb(107 92 255 / 16%);
}
.category-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.category-option__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #6b5cff;
  border-radius: 10px;
  background: rgb(107 92 255 / 9%);
}
.category-option strong,
.category-option small {
  display: block;
}
.category-option strong {
  font-size: 0.78rem;
}
.category-option small {
  margin-top: 3px;
  color: var(--fb-muted);
  font-size: 0.64rem;
  line-height: 1.35;
}
.category-option__check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: #6b5cff;
  opacity: 0;
  font-size: 0.72rem;
}
.category-option.is-selected .category-option__check {
  opacity: 1;
}
.feedback-field {
  position: relative;
  display: block;
  margin-top: 20px;
}
.feedback-field > small {
  position: absolute;
  right: 12px;
  bottom: 10px;
  color: var(--fb-muted);
  font-size: 0.62rem;
}
.feedback-field input,
.feedback-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 13px 14px;
  color: var(--fb-text);
  background: var(--fb-card);
  border: 1px solid var(--fb-line);
  border-radius: 13px;
  outline: none;
  font: inherit;
  font-size: 0.84rem;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}
.feedback-field textarea {
  resize: vertical;
  min-height: 146px;
  padding-bottom: 28px;
  line-height: 1.65;
}
.feedback-field input:focus,
.feedback-field textarea:focus {
  border-color: rgb(107 92 255 / 58%);
  box-shadow: 0 0 0 3px rgb(107 92 255 / 9%);
}
.feedback-url-input {
  position: relative;
}
.feedback-url-input > i {
  position: absolute;
  top: 50%;
  left: 13px;
  z-index: 1;
  transform: translateY(-50%);
  color: var(--fb-muted);
}
.feedback-url-input input {
  padding-left: 38px;
}
.feedback-submit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 26px;
}
.feedback-submit-row p {
  margin: 0;
  color: var(--fb-muted);
  font-size: 0.7rem;
}
.feedback-submit-row p i {
  margin-right: 5px;
  color: #16a36a;
}
.feedback-submit-row button,
.feedback-history button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 17px;
  border: 1px solid var(--fb-line);
  border-radius: 11px;
  color: var(--fb-text);
  background: var(--fb-card);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 750;
  cursor: pointer;
}
.feedback-submit-row button {
  min-width: 132px;
  color: #fff;
  border-color: transparent;
  background: linear-gradient(110deg, #6654f6, #9a4ff1);
  box-shadow: 0 12px 24px rgb(107 92 255 / 22%);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.feedback-guide {
  padding: 44px 30px;
  background:
    radial-gradient(circle at 100% 0%, rgb(192 82 213 / 15%), transparent 34%),
    linear-gradient(155deg, #171326, #0c0d13);
  color: #fff;
}
.feedback-guide__visual {
  min-height: 160px;
  padding: 25px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 20px;
  background:
    radial-gradient(circle at 85% 85%, rgb(139 92 246 / 35%), transparent 45%),
    rgb(255 255 255 / 4%);
}
.feedback-guide__visual > span {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  color: #1a1527;
  background: linear-gradient(135deg, #f9a8d4, #c4b5fd);
  font-size: 1.15rem;
}
.feedback-guide__visual > p {
  margin: 34px 0 0;
  color: rgb(255 255 255 / 58%);
  font:
    700 0.7rem/1.7 ui-monospace,
    monospace;
  letter-spacing: 0.13em;
}
.feedback-guide h3 {
  margin: 30px 0 18px;
  font-size: 1rem;
}
.feedback-guide ol {
  display: grid;
  gap: 17px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.feedback-guide li {
  display: flex;
  align-items: center;
  gap: 12px;
}
.feedback-guide li > span {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgb(196 181 253 / 26%);
  border-radius: 50%;
  color: #c4b5fd;
  font-size: 0.6rem;
}
.feedback-guide li strong,
.feedback-guide li small {
  display: block;
}
.feedback-guide li strong {
  font-size: 0.76rem;
}
.feedback-guide li small {
  margin-top: 3px;
  color: rgb(255 255 255 / 47%);
  font-size: 0.64rem;
}
.feedback-guide__tip {
  display: flex;
  gap: 10px;
  margin-top: 28px;
  padding: 14px;
  border-radius: 14px;
  color: rgb(255 255 255 / 58%);
  background: rgb(255 255 255 / 5%);
  font-size: 0.68rem;
  line-height: 1.55;
}
.feedback-guide__tip i {
  color: #fbbf24;
}
.feedback-guide__tip p {
  margin: 0;
}
.feedback-guide__tip strong {
  display: block;
  color: #fff;
}
.feedback-history {
  padding: clamp(24px, 4vw, 40px);
  border-top: 1px solid var(--fb-line);
}
.feedback-history > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.feedback-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.feedback-item {
  padding: 19px;
  border: 1px solid var(--fb-line);
  border-radius: 17px;
  background: var(--fb-card);
}
.feedback-item__top,
.feedback-item footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.feedback-item__top { flex-wrap: wrap; }
.feedback-category,
.feedback-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.67rem;
  font-weight: 750;
}
.feedback-category {
  color: #6b5cff;
}
.feedback-status {
  padding: 5px 8px;
  border-radius: 999px;
  color: #8a6210;
  background: #fff4cc;
}
.feedback-status.is-in_progress {
  color: #2760b8;
  background: #e7f0ff;
}
.feedback-status.is-resolved {
  color: #08744a;
  background: #dff8ec;
}
.feedback-status.is-closed {
  color: #666;
  background: #eee;
}
.feedback-adopted {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 5px 8px;
  border-radius: 999px;
  color: #695400;
  background: #fff0a8;
  font-size: 0.67rem;
  font-weight: 800;
}
.feedback-item h3 {
  margin: 15px 0 8px;
  font-size: 0.94rem;
}
.feedback-item__content {
  display: -webkit-box;
  min-height: 42px;
  margin: 0;
  overflow: hidden;
  color: var(--fb-muted);
  font-size: 0.76rem;
  line-height: 1.65;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.feedback-reply {
  margin-top: 15px;
  padding: 13px;
  border-left: 3px solid #6b5cff;
  border-radius: 0 11px 11px 0;
  background: var(--fb-soft);
}
.feedback-reply span {
  color: #6b5cff;
  font-size: 0.66rem;
  font-weight: 780;
}
.feedback-reply p {
  margin: 7px 0 0;
  font-size: 0.74rem;
  line-height: 1.55;
}
.feedback-item footer {
  margin-top: 17px;
  padding-top: 13px;
  color: var(--fb-muted);
  border-top: 1px solid var(--fb-line);
  font-size: 0.63rem;
}
.feedback-item footer span,
.feedback-item footer a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.feedback-item footer a {
  color: #6b5cff;
  text-decoration: none;
}
.feedback-empty {
  display: grid;
  place-items: center;
  min-height: 230px;
  text-align: center;
  color: var(--fb-muted);
}
.feedback-empty > i {
  font-size: 2rem;
  color: #8b7fff;
}
.feedback-empty strong {
  margin-top: 12px;
  color: var(--fb-text);
}
.feedback-empty p {
  margin: 6px 0 0;
  font-size: 0.76rem;
}
.feedback-empty button {
  margin-top: 14px;
}
.feedback-skeleton {
  display: grid;
  gap: 10px;
}
.feedback-skeleton span {
  height: 112px;
  border-radius: 16px;
  background: linear-gradient(90deg, var(--fb-soft), rgb(255 255 255 / 35%), var(--fb-soft));
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}
.feedback-more {
  width: 100%;
  margin-top: 14px;
}
.spin {
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
@media (max-width: 980px) {
  .feedback-layout {
    grid-template-columns: 1fr;
  }
  .feedback-form {
    border-right: 0;
  }
  .feedback-guide {
    display: none;
  }
  .category-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 680px) {
  .feedback-page {
    padding: 20px 12px 56px;
  }
  .feedback-account {
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .feedback-form,
  .feedback-history {
    padding: 20px 16px;
  }
  .category-grid,
  .feedback-list {
    grid-template-columns: 1fr;
  }
  .category-option {
    min-height: 62px;
  }
  .feedback-submit-row {
    align-items: stretch;
    flex-direction: column;
  }
  .feedback-submit-row button {
    width: 100%;
  }
  .feedback-history > header {
    align-items: flex-start;
  }
  .feedback-item footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
