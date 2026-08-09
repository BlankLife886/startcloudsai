<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  useClientNotifications,
  NOTIFICATIONS_UPDATED_EVENT,
} from '@/composables/useClientNotifications'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  compact: { type: Boolean, default: false },
})
const authStore = useAuthStore()
const {
  unreadCount,
  hasUnread,
  badgeLabel,
  previewItems,
  previewLoading,
  refreshUnreadCount,
  refreshPreview,
  markItemsRead,
} = useClientNotifications()

const open = ref(false)
let closeTimer = null
let pollTimer = null
const CLOSE_DELAY_MS = 120
const POLL_MS = 20_000
const rootRef = ref(null)

function clearCloseTimer() {
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

function openPanel() {
  clearCloseTimer()
  open.value = true
  void refreshPreview({ limit: 8 })
}

function scheduleClose() {
  clearCloseTimer()
  closeTimer = window.setTimeout(() => {
    closeTimer = null
    open.value = false
  }, CLOSE_DELAY_MS)
}

function onFocusOut(event) {
  const root = rootRef.value
  const next = event.relatedTarget
  if (root instanceof Element && next instanceof Node && root.contains(next)) return
  scheduleClose()
}

function closePanel() {
  clearCloseTimer()
  open.value = false
}

function togglePanel() {
  if (open.value) closePanel()
  else openPanel()
}

function onDocumentClick(event) {
  if (!open.value) return
  const root = rootRef.value
  if (root instanceof Element && event.target instanceof Node && root.contains(event.target)) {
    return
  }
  closePanel()
}

function onEscape(event) {
  if (event.key === 'Escape' && open.value) closePanel()
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
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

async function openItem(item) {
  if (item?.id && !item.readAt) {
    await markItemsRead([item.id]).catch(() => null)
  }
  closePanel()
}

function pollNotifications() {
  if (document.visibilityState !== 'visible') return
  void refreshUnreadCount()
  if (open.value) void refreshPreview({ limit: 8 })
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = null
  if (!authStore.isAuthenticated) return
  pollTimer = window.setInterval(pollNotifications, POLL_MS)
}

watch(open, (isOpen) => {
  if (isOpen) void refreshPreview({ limit: 8 })
})

watch(
  () => authStore.isAuthenticated,
  (authed) => {
    startPolling()
    if (authed) {
      void refreshUnreadCount()
    }
  },
)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onEscape)
  window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, pollNotifications)
  window.addEventListener('focus', pollNotifications)
  document.addEventListener('visibilitychange', pollNotifications)
  startPolling()
  void refreshUnreadCount()
})

onBeforeUnmount(() => {
  clearCloseTimer()
  if (pollTimer) window.clearInterval(pollTimer)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onEscape)
  document.removeEventListener('visibilitychange', pollNotifications)
  window.removeEventListener('focus', pollNotifications)
  window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, pollNotifications)
})
</script>

<template>
  <div
    ref="rootRef"
    class="nav-notify"
    :class="{ open, compact: props.compact, 'has-unread': hasUnread }"
    @mouseenter="openPanel"
    @mouseleave="scheduleClose"
    @focusin="openPanel"
    @focusout="onFocusOut"
  >
    <button
      type="button"
      class="nav-notify__btn"
      :aria-expanded="open"
      aria-haspopup="dialog"
      aria-label="通知"
      title="通知"
      @click.stop="togglePanel"
    >
      <i class="bi bi-bell" aria-hidden="true"></i>
      <em v-if="hasUnread" class="nav-notify__badge">{{ badgeLabel }}</em>
    </button>

    <Transition name="nav-notify-panel">
      <div
        v-if="open"
        class="nav-notify__panel"
        role="dialog"
        aria-label="通知预览"
        @click.stop
      >
        <header class="nav-notify__head">
          <div>
            <strong>通知</strong>
            <small v-if="unreadCount > 0">{{ unreadCount }} 条未读</small>
            <small v-else>暂无未读</small>
          </div>
        </header>

        <div v-if="previewLoading && !previewItems.length" class="nav-notify__loading">
          正在读取通知…
        </div>

        <ul v-else-if="previewItems.length" class="nav-notify__list">
          <li
            v-for="item in previewItems"
            :key="item.id"
            :class="{ 'is-unread': !item.readAt }"
          >
            <RouterLink
              class="nav-notify__item"
              to="/notifications"
              @click="openItem(item)"
            >
              <span class="nav-notify__icon" aria-hidden="true">
                <i class="bi" :class="kindIcon(item)"></i>
              </span>
              <div>
                <strong>{{ item.title || '通知' }}</strong>
                <p v-if="item.body">{{ item.body }}</p>
                <div class="nav-notify__meta">
                  <small>{{ formatTime(item.createdAt) }}</small>
                  <small v-if="!item.readAt">未读</small>
                </div>
              </div>
            </RouterLink>
          </li>
        </ul>

        <div v-else class="nav-notify__empty">
          <i class="bi bi-bell" aria-hidden="true"></i>
          <p>暂无新通知</p>
        </div>

        <footer class="nav-notify__foot">
          <RouterLink to="/notifications" @click="closePanel">查看全部通知</RouterLink>
        </footer>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.nav-notify {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 36px;
}

.nav-notify__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
  border: 1px solid rgba(21, 22, 31, 0.1);
  border-radius: 999px;
  background: #ffffff;
  color: var(--nav-accent, #5b4dff);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  line-height: 1;
}

.nav-notify__btn i {
  font-size: 1rem;
  line-height: 1;
}

.nav-notify__btn:hover,
.nav-notify.open .nav-notify__btn {
  border-color: rgba(91, 77, 255, 0.28);
  color: var(--nav-accent, #5b4dff);
  filter: brightness(0.98);
}

.nav-notify__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-style: normal;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}

.nav-notify__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 80;
  width: min(360px, calc(100vw - 24px));
  overflow: hidden;
  border: 1px solid rgba(28, 26, 39, 0.1);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 22px 48px rgba(28, 22, 60, 0.16);
  backdrop-filter: blur(16px);
  color: #1c1a27;
}

.nav-notify__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid rgba(28, 26, 39, 0.08);
}

.nav-notify__head strong {
  display: block;
  font-size: 0.92rem;
  font-weight: 800;
  color: #1c1a27;
}

.nav-notify__head small {
  display: block;
  margin-top: 2px;
  color: rgba(28, 26, 39, 0.55);
  font-size: 0.72rem;
}

.nav-notify__loading,
.nav-notify__empty {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 140px;
  padding: 24px 16px;
  color: rgba(28, 26, 39, 0.5);
  font-size: 0.78rem;
  text-align: center;
}

.nav-notify__empty i {
  font-size: 1.4rem;
  color: var(--nav-accent, #5b4dff);
  opacity: 0.75;
}

.nav-notify__list {
  display: grid;
  gap: 6px;
  max-height: min(420px, 55vh);
  margin: 0;
  padding: 8px;
  overflow: auto;
  list-style: none;
}

.nav-notify__list > li {
  border-radius: 12px;
}

.nav-notify__item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  color: inherit;
  text-decoration: none;
  border-radius: 12px;
  transition: background 140ms ease;
}

.nav-notify__item:hover {
  background: rgba(28, 26, 39, 0.04);
}

.nav-notify__list > li.is-unread .nav-notify__item {
  background: rgba(107, 92, 255, 0.08);
}

.nav-notify__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: #5b4dff;
  background: rgba(107, 92, 255, 0.12);
  font-size: 0.95rem;
}

.nav-notify__item strong {
  display: block;
  font-size: 0.8rem;
  font-weight: 750;
  line-height: 1.35;
  color: #1c1a27;
}

.nav-notify__item p {
  display: -webkit-box;
  margin: 4px 0 0;
  overflow: hidden;
  color: rgba(28, 26, 39, 0.58);
  font-size: 0.7rem;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.nav-notify__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.nav-notify__meta small {
  color: rgba(28, 26, 39, 0.42);
  font-size: 0.64rem;
}

.nav-notify__list > li.is-unread .nav-notify__meta small:last-child {
  color: #5b4dff;
  font-weight: 700;
}

.nav-notify__foot {
  display: flex;
  justify-content: center;
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(28, 26, 39, 0.08);
}

.nav-notify__foot a {
  color: #5b4dff;
  font-size: 0.74rem;
  font-weight: 700;
  text-decoration: none;
}

.nav-notify__foot a:hover {
  text-decoration: underline;
}

.nav-notify-panel-enter-active,
.nav-notify-panel-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.nav-notify-panel-enter-from,
.nav-notify-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.nav-notify.compact {
  height: 32px;
}

.nav-notify.compact .nav-notify__btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
}
</style>
