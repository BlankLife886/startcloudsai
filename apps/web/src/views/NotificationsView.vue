<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const hasMore = computed(() => Boolean(cursor.value))
const loadMoreSentinel = ref(null)
let loadMoreObserver = null

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
    if (append) {
      const seen = new Set(items.value.map((item) => String(item.id)))
      const next = result.items.filter((item) => !seen.has(String(item.id)))
      items.value = [...items.value, ...next]
    } else {
      items.value = result.items
    }
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
  // 已翻页或正在加载更多时，不整表重置，避免打断触底加载
  if (loadingMore.value || items.value.length > 20) return
  void loadList()
}

function setupLoadMoreObserver() {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  if (!loadMoreSentinel.value || !hasMore.value) return
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      void loadList({ append: true })
    },
    { root: null, rootMargin: '160px 0px', threshold: 0 },
  )
  loadMoreObserver.observe(loadMoreSentinel.value)
}

watch([hasMore, loaded, () => items.value.length], async () => {
  await nextTick()
  setupLoadMoreObserver()
})

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
  await nextTick()
  setupLoadMoreObserver()
})

onBeforeUnmount(() => {
  window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onNotificationsUpdated)
  window.removeEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  window.removeEventListener('focus', pollNotifications)
  document.removeEventListener('visibilitychange', pollNotifications)
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  if (realtimeTimer) window.clearTimeout(realtimeTimer)
  if (notificationPollTimer) window.clearInterval(notificationPollTimer)
})
</script>

<template>
  <div
    class="nt-page"
    :class="{ 'is-light': !appearanceStore.isDark, 'is-dark': appearanceStore.isDark }"
  >
    <div class="nt-shell">
      <header class="nt-hero">
        <div class="nt-hero__copy">
          <h1>
            通知
            <em v-if="unreadCount > 0">{{ badgeLabel }}</em>
          </h1>
          <p>账号、任务与审核消息</p>
        </div>

        <div class="nt-hero__actions">
          <button
            type="button"
            class="nt-btn"
            :disabled="marking || unreadCount <= 0"
            @click="handleMarkAllRead"
          >
            全部已读
          </button>
          <button type="button" class="nt-btn" :disabled="loading" @click="loadList()">
            <i class="bi bi-arrow-repeat" :class="{ spin: loading }" aria-hidden="true"></i>
            刷新
          </button>
        </div>
      </header>

      <section class="nt-board" aria-live="polite">
        <div v-if="loading && !items.length" class="nt-skel" aria-hidden="true">
          <div v-for="n in 6" :key="n" class="nt-skel__row"></div>
        </div>

        <div v-else-if="error && !items.length" class="nt-empty is-error">
          <strong>通知读取失败</strong>
          <p>{{ error }}</p>
          <button type="button" class="nt-btn" @click="loadList()">重试</button>
        </div>

        <div v-else-if="dayGroups.length" class="nt-list">
          <section v-for="group in dayGroups" :key="group.key" class="nt-day">
            <header class="nt-day__head">
              <strong>{{ group.label }}</strong>
              <small v-if="group.sublabel">{{ group.sublabel }}</small>
              <span>{{ group.items.length }}</span>
            </header>

            <ol class="nt-day__items">
              <li
                v-for="item in group.items"
                :key="item.id"
                class="nt-item"
                :class="{ 'is-unread': !item.readAt }"
              >
                <span class="nt-item__icon" aria-hidden="true">
                  <i class="bi" :class="kindIcon(item)"></i>
                </span>
                <div class="nt-item__body" data-no-translate>
                  <div class="nt-item__title-row">
                    <strong>{{ localizedText(item.title) }}</strong>
                    <time>{{ formatClock(item.createdAt) }}</time>
                  </div>
                  <p v-if="item.body">
                    <template v-for="(part, index) in emphasizeParts(item.body)" :key="index">
                      <b v-if="part.hl" class="nt-hl">{{ part.text }}</b>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </p>
                  <div class="nt-item__meta">
                    <span v-if="extractAmount(item.body)" class="nt-item__amount">
                      {{ extractAmount(item.body) }}
                      <small>{{ amountUnit(item.body) }}</small>
                    </span>
                    <span v-if="!item.readAt" class="nt-item__dot" aria-label="未读"></span>
                    <button
                      v-if="isTrialAccessNotification(item)"
                      type="button"
                      class="nt-item__action"
                      @click="openTrialAccess(item)"
                    >
                      查看体验资格 <i class="bi bi-arrow-right" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              </li>
            </ol>
          </section>

          <div ref="loadMoreSentinel" class="nt-sentinel" aria-hidden="true"></div>

          <div v-if="loadingMore" class="nt-footer-status">加载中…</div>
          <div v-else-if="hasMore" class="nt-footer-status">
            <button type="button" class="nt-btn nt-more" @click="loadList({ append: true })">
              加载更多
            </button>
          </div>
          <div v-else-if="items.length" class="nt-footer-status is-end">已加载全部通知</div>
        </div>

        <div v-else-if="empty" class="nt-empty">
          <i class="bi bi-bell" aria-hidden="true"></i>
          <strong>暂无通知</strong>
          <p>任务进度、审核结果与账号消息会显示在这里。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nt-page {
  --nt-text: #17171f;
  --nt-muted: #777785;
  --nt-line: rgb(21 22 31 / 8%);
  --nt-bg: #f4f3fa;
  --nt-surface: #ffffff;
  --nt-row: transparent;
  --nt-row-hover: rgb(109 92 255 / 4%);
  --nt-unread: rgb(109 92 255 / 6%);
  --nt-accent: #6d5cff;
  --nt-accent-soft: rgb(109 92 255 / 10%);
  min-height: calc(100dvh - var(--app-header-offset, 72px));
  padding: 20px clamp(16px, 3vw, 28px) 48px;
  color: var(--nt-text);
  background: var(--nt-bg);
}

.nt-page.is-dark {
  --nt-text: rgba(255, 255, 255, 0.96);
  --nt-muted: rgba(255, 255, 255, 0.52);
  --nt-line: rgb(255 255 255 / 8%);
  --nt-bg: #121218;
  --nt-surface: #1a1824;
  --nt-row-hover: rgb(109 92 255 / 8%);
  --nt-unread: rgb(109 92 255 / 12%);
  --nt-accent: #8b7bff;
  --nt-accent-soft: rgb(109 92 255 / 16%);
}

.nt-shell {
  width: min(760px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 14px;
}

.nt-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.nt-hero h1 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 1.45rem;
  font-weight: 820;
  letter-spacing: -0.03em;
}

.nt-hero h1 em {
  min-width: 1.35rem;
  height: 1.35rem;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--nt-accent);
  color: #fff;
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 780;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.nt-hero__copy > p {
  margin: 4px 0 0;
  color: var(--nt-muted);
  font-size: 0.82rem;
}

.nt-hero__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.nt-board {
  border: 1px solid var(--nt-line);
  border-radius: 16px;
  background: var(--nt-surface);
  padding: 4px 0 8px;
  /* Clip rounded corners without turning the board into the sticky scroll container. */
  overflow: clip;
}

.nt-list {
  display: grid;
  gap: 2px;
}

.nt-day__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 14px 16px 8px;
  position: sticky;
  top: var(--app-header-offset, 72px);
  z-index: 1;
  background: color-mix(in srgb, var(--nt-surface) 92%, transparent);
  backdrop-filter: blur(8px);
}

.nt-day__head strong {
  font-size: 0.8rem;
  font-weight: 780;
}

.nt-day__head small {
  color: var(--nt-muted);
  font-size: 0.72rem;
}

.nt-day__head span {
  margin-left: auto;
  color: var(--nt-muted);
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.nt-day__items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nt-item {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 12px 16px;
  border-top: 1px solid var(--nt-line);
  background: var(--nt-row);
  transition: background 120ms ease;
}

.nt-day__items .nt-item:first-child {
  border-top: 0;
}

.nt-item:hover {
  background: var(--nt-row-hover);
}

.nt-item.is-unread {
  background: var(--nt-unread);
}

.nt-item__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--nt-accent-soft);
  color: var(--nt-accent);
  font-size: 0.95rem;
}

.nt-item.is-unread .nt-item__icon {
  background: var(--nt-accent);
  color: #fff;
}

.nt-item__body {
  min-width: 0;
}

.nt-item__title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.nt-item__title-row strong {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 740;
  letter-spacing: -0.01em;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nt-item__title-row time {
  flex: 0 0 auto;
  color: var(--nt-muted);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.nt-item__body p {
  margin: 4px 0 0;
  color: var(--nt-muted);
  font-size: 0.8rem;
  line-height: 1.45;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.nt-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  min-height: 0;
}

.nt-item__amount {
  color: var(--nt-accent);
  font-size: 0.82rem;
  font-weight: 780;
  font-variant-numeric: tabular-nums;
}

.nt-item__amount small {
  margin-left: 2px;
  color: var(--nt-muted);
  font-size: 0.68rem;
  font-weight: 650;
}

.nt-item__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nt-accent);
}

.nt-item__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 0;
  color: var(--nt-accent);
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 720;
  cursor: pointer;
}

.nt-hl {
  color: var(--nt-accent);
  font-weight: 780;
  font-variant-numeric: tabular-nums;
}

.nt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--nt-line);
  background: var(--nt-surface);
  color: var(--nt-text);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.nt-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--nt-accent) 36%, var(--nt-line));
  color: var(--nt-accent);
}

.nt-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nt-more {
  min-width: 120px;
}

.nt-sentinel {
  height: 1px;
  width: 100%;
}

.nt-footer-status {
  display: grid;
  place-items: center;
  padding: 14px 16px 10px;
  color: var(--nt-muted);
  font-size: 0.76rem;
}

.nt-footer-status.is-end {
  opacity: 0.75;
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
  font-size: 1.4rem;
  color: var(--nt-accent);
}

.nt-empty strong {
  color: var(--nt-text);
  font-size: 0.95rem;
}

.nt-empty p {
  margin: 0;
  max-width: 28ch;
  font-size: 0.82rem;
  line-height: 1.5;
}

.nt-skel {
  display: grid;
  gap: 0;
  padding: 4px 0;
}

.nt-skel__row {
  height: 68px;
  margin: 0 16px;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    rgb(21 22 31 / 3%),
    rgb(21 22 31 / 7%),
    rgb(21 22 31 / 3%)
  );
  background-size: 200% 100%;
  animation: nt-shimmer 1.2s linear infinite;
}

.nt-skel__row + .nt-skel__row {
  margin-top: 8px;
}

.nt-page.is-dark .nt-skel__row {
  background: linear-gradient(
    90deg,
    rgb(255 255 255 / 4%),
    rgb(255 255 255 / 9%),
    rgb(255 255 255 / 4%)
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
    padding: 16px 12px 40px;
  }

  .nt-hero__actions {
    width: 100%;
  }

  .nt-hero__actions .nt-btn {
    flex: 1;
  }

  .nt-item {
    padding: 12px 14px;
  }

  .nt-day__head {
    padding-right: 14px;
    padding-left: 14px;
  }
}
</style>
