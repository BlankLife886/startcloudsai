<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { listNotifications } from '@/services/meApi'
import { TASK_UPDATE_EVENT } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import {
  useClientNotifications,
  NOTIFICATIONS_UPDATED_EVENT,
} from '@/composables/useClientNotifications'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { translateClientText } from '@/i18n/clientTranslations'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const localeStore = useLocaleStore()
const {
  unreadCount,
  badgeLabel,
  applyUnreadCount,
  markAllRead: markInboxAllRead,
  markItemsRead,
  refreshUnreadCount,
} = useClientNotifications()

const items = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const cursor = ref(null)
const error = ref('')
const marking = ref(false)
let realtimeTimer = null
let notificationPollTimer = null
const NOTIFICATION_POLL_MS = 20_000

const empty = computed(() => loaded.value && !loading.value && !items.value.length)

const dayGroups = computed(() => {
  const groups = []
  const map = new Map()

  items.value.forEach((item) => {
    const date = parseDate(item.createdAt)
    const key = date ? dayKey(date) : 'unknown'
    if (!map.has(key)) {
      const group = {
        key,
        label: date ? dayLabel(date) : '更早',
        sublabel: date ? daySublabel(date) : '',
        items: [],
      }
      map.set(key, group)
      groups.push(group)
    }
    map.get(key).items.push(item)
  })

  return groups
})

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function dayLabel(date) {
  const today = new Date()
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays > 1 && diffDays < 7) return `${diffDays} 天前`
  if (date.getFullYear() === today.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function daySublabel(date) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()] || ''
}

function formatClock(value) {
  const date = parseDate(value)
  if (!date) return '—'
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function kindIcon(item) {
  const kind = String(item?.kind || '').toLowerCase()
  const title = String(item?.title || '')
  if (kind === 'trial_access') return 'bi-patch-check'
  if (kind.includes('redeem') || title.includes('兑换')) return 'bi-ticket-perforated'
  if (
    kind.includes('wallet') ||
    title.includes('入账') ||
    title.includes('积分') ||
    title.includes('充值')
  ) {
    return 'bi-wallet2'
  }
  if (kind.includes('task') || title.includes('任务') || title.includes('生成')) {
    return 'bi-stars'
  }
  if (kind.includes('gallery') || title.includes('投稿') || title.includes('审核')) {
    return 'bi-send-check'
  }
  if (kind.includes('system') || title.includes('公告')) return 'bi-megaphone'
  return 'bi-bell'
}

function isTrialAccessNotification(item) {
  return String(item?.kind || '').toLowerCase() === 'trial_access'
}

async function openTrialAccess(item) {
  if (item?.id && !item.readAt) {
    await markItemsRead([item.id]).catch(() => null)
    item.readAt = item.readAt || new Date().toISOString()
  }
  const current = router.currentRoute.value
  await router
    .push({
      path: current.path,
      query: { ...current.query, trial: 'apply' },
      hash: current.hash,
    })
    .catch(() => {})
}

/** 抽出正文里的金额数字，供右侧强调展示。 */
function localizedText(source) {
  return translateClientText(String(source || ''), localeStore.locale)
}

function extractAmount(body) {
  const text = localizedText(body)
  const match =
    text.match(/([\d,]+)\s*(?:分|积分|credits)/i) ||
    text.match(/(?:Added|added|Redeemed|—)\s*([\d,]+)/) ||
    null
  return match?.[1] || ''
}

function amountUnit(body) {
  const text = localizedText(body)
  if (/credits/i.test(text)) return 'credits'
  if (/积分/.test(text) || /分/.test(text)) return '积分'
  return extractAmount(body) ? (localeStore.locale === 'en' ? 'credits' : '积分') : ''
}

/** 把正文里的金额片段拆出来，模板里加粗高亮。 */
function emphasizeParts(body) {
  const text = localizedText(body)
  if (!text) return []
  const re = /([\d,]+)\s*(分|积分|credits)/gi
  const parts = []
  let last = 0
  let match
  while ((match = re.exec(text))) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), hl: false })
    }
    parts.push({ text: match[0], hl: true })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), hl: false })
  return parts.length ? parts : [{ text, hl: false }]
}

async function loadList({ append = false } = {}) {
  if (append) {
    if (loadingMore.value || !cursor.value) return
    loadingMore.value = true
  } else {
    if (loading.value) return
    loading.value = true
    error.value = ''
  }

  try {
    const result = await listNotifications({
      limit: 20,
      cursor: append ? cursor.value || '' : '',
    })
    items.value = append ? [...items.value, ...result.items] : result.items
    cursor.value = result.nextCursor
    loaded.value = true
    if (Number.isFinite(Number(result.unread))) applyUnreadCount(result.unread)
  } catch (err) {
    error.value = err?.message || '通知读取失败'
    if (!append) notificationService.error(error.value)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function handleMarkAllRead() {
  if (marking.value || unreadCount.value <= 0) return
  marking.value = true
  try {
    await markInboxAllRead()
    items.value = items.value.map((item) => ({
      ...item,
      readAt: item.readAt || new Date().toISOString(),
    }))
    notificationService.success('已全部标记为已读')
  } catch (err) {
    notificationService.error(err?.message || '操作失败')
  } finally {
    marking.value = false
  }
}

function onNotificationsUpdated(event) {
  if (event?.detail?.source !== 'preview' || !loaded.value) return
  const incoming = Array.isArray(event.detail.previewItems) ? event.detail.previewItems : []
  if (!incoming.length) return
  const merged = new Map(items.value.map((item) => [String(item.id), item]))
  incoming.forEach((item) => merged.set(String(item.id), item))
  items.value = Array.from(merged.values()).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function handleRealtimeTaskUpdate(event) {
  if (
    !event?.detail?.task ||
    !['succeeded', 'failed', 'canceled'].includes(event.detail.task.status)
  ) {
    return
  }
  if (realtimeTimer) window.clearTimeout(realtimeTimer)
  realtimeTimer = window.setTimeout(() => {
    realtimeTimer = null
    void refreshUnreadCount({ force: true })
    void loadList()
  }, 160)
}

function pollNotifications() {
  if (document.visibilityState !== 'visible') return
  void refreshUnreadCount({ force: true })
  void loadList()
}

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    router.replace({
      name: 'auth',
      query: { ...createLoginRedirectQuery('/notifications'), mode: 'login' },
    })
    return
  }
  window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onNotificationsUpdated)
  window.addEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  window.addEventListener('focus', pollNotifications)
  document.addEventListener('visibilitychange', pollNotifications)
  notificationPollTimer = window.setInterval(pollNotifications, NOTIFICATION_POLL_MS)
  await loadList()
})

onBeforeUnmount(() => {
  window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onNotificationsUpdated)
  window.removeEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  window.removeEventListener('focus', pollNotifications)
  document.removeEventListener('visibilitychange', pollNotifications)
  if (realtimeTimer) window.clearTimeout(realtimeTimer)
  if (notificationPollTimer) window.clearInterval(notificationPollTimer)
})
</script>

<template>
  <div
    class="nt-page"
    :class="{ 'is-light': !appearanceStore.isDark, 'is-dark': appearanceStore.isDark }"
  >
    <div class="nt-atmosphere" aria-hidden="true">
      <div class="nt-atmosphere__wash"></div>
      <div class="nt-atmosphere__orb nt-atmosphere__orb--a"></div>
      <div class="nt-atmosphere__orb nt-atmosphere__orb--b"></div>
    </div>

    <div class="nt-shell">
      <header class="nt-hero">
        <div class="nt-hero__copy">
          <h1>
            通知
            <em v-if="unreadCount > 0">{{ badgeLabel }}</em>
          </h1>
          <p>查看账号、任务与审核消息。</p>
        </div>

        <div class="nt-hero__actions">
          <button
            type="button"
            class="nt-btn is-ghost"
            :disabled="marking || unreadCount <= 0"
            @click="handleMarkAllRead"
          >
            全部已读
          </button>
          <button type="button" class="nt-btn is-ghost" :disabled="loading" @click="loadList()">
            <i class="bi bi-arrow-repeat" :class="{ spin: loading }" aria-hidden="true"></i>
            刷新
          </button>
        </div>
      </header>

      <section class="nt-board" aria-live="polite">
        <div v-if="loading && !items.length" class="nt-skel" aria-hidden="true">
          <div v-for="n in 5" :key="n" class="nt-skel__row"></div>
        </div>

        <div v-else-if="error && !items.length" class="nt-empty is-error">
          <strong>通知读取失败</strong>
          <p>{{ error }}</p>
          <button type="button" class="nt-btn is-ghost" @click="loadList()">重试</button>
        </div>

        <div v-else-if="dayGroups.length" class="nt-tree">
          <section v-for="group in dayGroups" :key="group.key" class="nt-branch">
            <header class="nt-branch__head">
              <span class="nt-branch__node" aria-hidden="true"></span>
              <div class="nt-branch__label">
                <strong>{{ group.label }}</strong>
                <small v-if="group.sublabel">{{ group.sublabel }}</small>
              </div>
              <em>{{ group.items.length }}</em>
            </header>

            <ol class="nt-branch__list">
              <li
                v-for="item in group.items"
                :key="item.id"
                class="nt-leaf"
                :class="{ 'is-unread': !item.readAt }"
              >
                <article class="nt-leaf__card">
                  <span class="nt-leaf__icon" aria-hidden="true">
                    <i class="bi" :class="kindIcon(item)"></i>
                  </span>
                  <div class="nt-leaf__body" data-no-translate>
                    <strong>{{ localizedText(item.title) }}</strong>
                    <p v-if="item.body">
                      <template v-for="(part, index) in emphasizeParts(item.body)" :key="index">
                        <b v-if="part.hl" class="nt-hl">{{ part.text }}</b>
                        <template v-else>{{ part.text }}</template>
                      </template>
                    </p>
                    <button
                      v-if="isTrialAccessNotification(item)"
                      type="button"
                      class="nt-leaf__action"
                      @click="openTrialAccess(item)"
                    >
                      查看体验资格 <i class="bi bi-arrow-right" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div class="nt-leaf__aside" data-no-translate>
                    <div v-if="extractAmount(item.body)" class="nt-leaf__amount">
                      <b>{{ extractAmount(item.body) }}</b>
                      <small>{{ amountUnit(item.body) }}</small>
                    </div>
                    <time>{{ formatClock(item.createdAt) }}</time>
                    <span v-if="!item.readAt" class="nt-leaf__badge">{{
                      localizedText('未读')
                    }}</span>
                  </div>
                </article>
              </li>
            </ol>
          </section>
        </div>

        <div v-else-if="empty" class="nt-empty">
          <i class="bi bi-bell" aria-hidden="true"></i>
          <strong>暂无通知</strong>
          <p>任务进度、审核结果与账号消息会显示在这里。</p>
        </div>

        <button
          v-if="cursor"
          type="button"
          class="nt-btn is-ghost nt-more"
          :disabled="loadingMore"
          @click="loadList({ append: true })"
        >
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nt-page {
  --nt-text: #1c1a27;
  --nt-muted: rgba(28, 26, 39, 0.58);
  --nt-line: rgba(28, 26, 39, 0.1);
  --nt-surface: rgba(255, 255, 255, 0.82);
  --nt-card: rgba(255, 255, 255, 0.92);
  --nt-soft: rgba(248, 246, 255, 0.9);
  --nt-accent: #6b5cff;
  --nt-accent-soft: rgba(107, 92, 255, 0.12);
  --nt-rail: rgba(107, 92, 255, 0.22);
  --nt-shadow: 0 18px 40px rgba(40, 30, 80, 0.07);
  position: relative;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 28px clamp(16px, 3vw, 36px) 72px;
  color: var(--nt-text);
  overflow: clip;
}

.nt-page.is-dark {
  --nt-text: #f4f2ff;
  --nt-muted: rgba(244, 242, 255, 0.62);
  --nt-line: rgba(244, 242, 255, 0.12);
  --nt-surface: rgba(24, 22, 36, 0.78);
  --nt-card: rgba(32, 28, 48, 0.92);
  --nt-soft: rgba(40, 34, 58, 0.88);
  --nt-accent: #a99dff;
  --nt-accent-soft: rgba(169, 157, 255, 0.16);
  --nt-rail: rgba(169, 157, 255, 0.28);
  --nt-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}

.nt-atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.nt-atmosphere__wash {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(167, 139, 250, 0.22), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(125, 211, 252, 0.16), transparent 50%),
    linear-gradient(180deg, #f6f3ff 0%, #eef2ff 48%, #f8fafc 100%);
}

.nt-page.is-dark .nt-atmosphere__wash {
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(99, 102, 241, 0.28), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(56, 189, 248, 0.14), transparent 50%),
    linear-gradient(180deg, #120f1c 0%, #161325 48%, #101018 100%);
}

.nt-atmosphere__orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.55;
}

.nt-atmosphere__orb--a {
  width: 220px;
  height: 220px;
  top: 8%;
  right: 12%;
  background: rgba(167, 139, 250, 0.35);
}

.nt-atmosphere__orb--b {
  width: 180px;
  height: 180px;
  bottom: 18%;
  left: 8%;
  background: rgba(125, 211, 252, 0.28);
}

.nt-shell {
  position: relative;
  z-index: 1;
  width: min(1240px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 22px;
}

.nt-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 8px 4px 0;
}

.nt-hero h1 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: clamp(1.7rem, 2.6vw, 2.15rem);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.nt-hero h1 em {
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--nt-accent);
  color: #fff;
  font-style: normal;
  font-size: 0.78rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.nt-hero__copy > p:last-child {
  margin: 8px 0 0;
  color: var(--nt-muted);
  font-size: 0.92rem;
}

.nt-hero__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.nt-board {
  border: 1px solid var(--nt-line);
  border-radius: 28px;
  background: var(--nt-surface);
  backdrop-filter: blur(16px);
  padding: 22px 18px 18px;
  box-shadow: var(--nt-shadow);
}

.nt-tree {
  display: grid;
  gap: 28px;
}

.nt-branch {
  position: relative;
  display: grid;
  gap: 14px;
  padding-left: 8px;
}

.nt-branch::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 8px;
  left: 20px;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--nt-rail), transparent 96%);
  pointer-events: none;
}

.nt-branch__head {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  z-index: 1;
  margin-bottom: 2px;
}

.nt-branch__node {
  width: 14px;
  height: 14px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--nt-accent);
  box-shadow:
    0 0 0 5px var(--nt-accent-soft),
    0 0 0 1px rgba(107, 92, 255, 0.2);
}

.nt-branch__label strong {
  display: block;
  font-size: 0.98rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.nt-branch__label small {
  color: var(--nt-muted);
  font-size: 0.72rem;
}

.nt-branch__head > em {
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--nt-accent-soft);
  color: var(--nt-accent);
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.nt-branch__list {
  list-style: none;
  margin: 0;
  padding: 0 0 0 34px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.nt-leaf {
  min-width: 0;
}

.nt-leaf__card {
  min-width: 0;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) minmax(88px, auto);
  gap: 16px;
  align-items: center;
  padding: 16px 18px;
  border: 1px solid var(--nt-line);
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(107, 92, 255, 0.04), transparent 42%), var(--nt-card);
  box-shadow: 0 10px 24px rgba(40, 30, 80, 0.04);
}

.nt-leaf.is-unread .nt-leaf__card {
  border-color: rgba(107, 92, 255, 0.34);
  box-shadow:
    0 12px 28px rgba(107, 92, 255, 0.1),
    0 0 0 1px rgba(107, 92, 255, 0.06);
  background: linear-gradient(135deg, rgba(107, 92, 255, 0.14), transparent 52%), var(--nt-card);
}

.nt-leaf__icon {
  width: 48px;
  height: 48px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  background: var(--nt-accent-soft);
  color: var(--nt-accent);
  border: 1px solid rgba(107, 92, 255, 0.14);
}

.nt-leaf__icon i {
  font-size: 1.15rem;
  line-height: 1;
}

.nt-leaf.is-unread .nt-leaf__icon {
  background: var(--nt-accent);
  color: #fff;
  border-color: transparent;
}

.nt-leaf__body {
  min-width: 0;
}

.nt-leaf__body strong {
  display: block;
  font-size: 1.02rem;
  font-weight: 820;
  letter-spacing: -0.02em;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nt-leaf.is-unread .nt-leaf__body strong {
  color: var(--nt-text);
}

.nt-leaf__body p {
  margin: 5px 0 0;
  color: var(--nt-muted);
  font-size: 0.84rem;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nt-leaf__action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
  padding: 0;
  color: #167a65;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 760;
  cursor: pointer;
}

.nt-leaf__action:hover {
  color: #0f5e4f;
}

.nt-hl {
  color: var(--nt-accent);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.nt-leaf__aside {
  display: grid;
  gap: 6px;
  justify-items: end;
  align-content: center;
  min-width: 88px;
}

.nt-leaf__amount {
  display: grid;
  justify-items: end;
  gap: 1px;
  line-height: 1;
}

.nt-leaf__amount b {
  color: var(--nt-accent);
  font-size: 1.2rem;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.nt-leaf__amount small {
  color: var(--nt-muted);
  font-size: 0.68rem;
  font-weight: 700;
}

.nt-leaf__aside time {
  color: var(--nt-muted);
  font-size: 0.72rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.nt-leaf__badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--nt-accent);
  color: #fff;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.nt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--nt-line);
  background: #fff;
  color: var(--nt-text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.nt-page.is-dark .nt-btn {
  background: rgba(255, 255, 255, 0.06);
  color: var(--nt-text);
}

.nt-btn:hover:not(:disabled) {
  border-color: rgba(107, 92, 255, 0.35);
  color: var(--nt-accent);
}

.nt-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nt-more {
  width: 100%;
  margin-top: 16px;
}

.nt-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 56px 16px;
  text-align: center;
  color: var(--nt-muted);
}

.nt-empty i {
  font-size: 1.6rem;
  color: var(--nt-accent);
}

.nt-empty strong {
  color: var(--nt-text);
  font-size: 1rem;
}

.nt-empty p {
  margin: 0;
  max-width: 28ch;
  font-size: 0.86rem;
  line-height: 1.5;
}

.nt-skel {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  padding-left: 42px;
}

.nt-skel__row {
  height: 84px;
  border-radius: 18px;
  background: linear-gradient(
    90deg,
    rgba(28, 26, 39, 0.04),
    rgba(28, 26, 39, 0.08),
    rgba(28, 26, 39, 0.04)
  );
  background-size: 200% 100%;
  animation: nt-shimmer 1.2s linear infinite;
}

.nt-page.is-dark .nt-skel__row {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.09),
    rgba(255, 255, 255, 0.04)
  );
  background-size: 200% 100%;
}

.spin {
  animation: nt-spin 0.9s linear infinite;
}

@keyframes nt-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes nt-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 720px) {
  .nt-page {
    padding: 20px 14px 56px;
  }

  .nt-hero {
    align-items: flex-start;
  }

  .nt-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .nt-hero__actions .nt-btn {
    flex: 1;
  }

  .nt-board {
    padding: 18px 12px 14px;
    border-radius: 22px;
  }

  .nt-branch {
    padding-left: 2px;
  }

  .nt-branch::before {
    left: 14px;
  }

  .nt-branch__head {
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 10px;
  }

  .nt-branch__node {
    margin-left: 3px;
  }

  .nt-branch__list {
    padding-left: 28px;
    gap: 10px;
  }

  .nt-leaf__card {
    grid-template-columns: 40px minmax(0, 1fr) minmax(72px, auto);
    gap: 12px;
    padding: 12px 14px;
  }

  .nt-leaf__icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }

  .nt-leaf__amount b {
    font-size: 1.05rem;
  }

  .nt-skel {
    padding-left: 28px;
    grid-template-columns: 1fr;
  }
}
</style>
