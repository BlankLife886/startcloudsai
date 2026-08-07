<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { deleteMyGallerySubmission, listMyGallerySubmissions } from '@/services/meApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import OptimizedImage from '@/components/common/OptimizedImage.vue'
import ProfileSectionShell from '@/components/profile/ProfileSectionShell.vue'
import DeleteHistoryConfirmDialog from '@/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()

const items = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const cursor = ref(null)
const error = ref('')
const deleteOpen = ref(false)
const pending = ref(null)

const empty = computed(() => loaded.value && !loading.value && !items.value.length)

const STATUS_LABELS = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  removed: '已下架',
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
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
    const result = await listMyGallerySubmissions({
      limit: 12,
      cursor: append ? cursor.value || '' : '',
    })
    items.value = append ? [...items.value, ...result.items] : result.items
    cursor.value = result.nextCursor
    loaded.value = true
  } catch (err) {
    error.value = err?.message || '投稿列表读取失败'
    if (!append) notificationService.error(error.value)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function askDelete(item) {
  pending.value = item
  deleteOpen.value = true
}

async function confirmDelete() {
  const item = pending.value
  deleteOpen.value = false
  pending.value = null
  if (!item) return
  try {
    await deleteMyGallerySubmission(item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
    notificationService.success('投稿已删除')
  } catch (err) {
    notificationService.error(err?.message || '删除失败')
  }
}

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    router.replace({
      name: 'auth',
      query: { ...createLoginRedirectQuery('/submissions'), mode: 'login' },
    })
    return
  }
  await loadList()
})
</script>

<template>
  <div
    class="ps-page"
    :class="{ 'is-light': !appearanceStore.isDark, 'is-dark': appearanceStore.isDark }"
  >
    <div class="ps-atmosphere" aria-hidden="true">
      <div class="ps-atmosphere__wash"></div>
    </div>

    <ProfileSectionShell title="我的投稿" description="查看画廊投稿与审核进度。">
      <template #actions>
        <button type="button" class="ps-btn is-ghost" :disabled="loading" @click="loadList()">
          <i class="bi bi-arrow-repeat" :class="{ spin: loading }"></i>
          刷新
        </button>
      </template>

      <div v-if="loading && !items.length" class="ps-skel" aria-hidden="true">
        <div v-for="n in 4" :key="n" class="ps-skel__row"></div>
      </div>

      <div v-else-if="error && !items.length" class="ps-empty is-error">
        <strong>投稿列表读取失败</strong>
        <p>{{ error }}</p>
        <button type="button" class="ps-btn is-ghost" @click="loadList()">重试</button>
      </div>

      <ul v-else-if="items.length" class="ps-submission-list">
        <li v-for="submission in items" :key="submission.id">
          <OptimizedImage
            v-if="submission.coverUrl || submission.mediaUrls?.length"
            :src="submission.coverUrl || submission.mediaUrls[0]"
            alt=""
            loading="lazy"
            root-margin="480px 0px"
          />
          <div class="ps-submission__body">
            <strong>{{ submission.title || 'AI 作品' }}</strong>
            <small>{{ formatTime(submission.createdAt) }}</small>
            <p v-if="submission.rejectReason" class="ps-submission__reason">
              原因：{{ submission.rejectReason }}
            </p>
          </div>
          <span class="ps-submission__status" :data-status="submission.status">
            {{ STATUS_LABELS[submission.status] || submission.status }}
          </span>
          <button
            type="button"
            class="ps-submission__remove"
            title="撤回/删除"
            @click="askDelete(submission)"
          >
            <i class="bi bi-trash3"></i>
          </button>
        </li>
      </ul>

      <div v-else-if="empty" class="ps-empty">
        <i class="bi bi-send" aria-hidden="true"></i>
        <strong>还没有投稿</strong>
        <p>可在创作历史里把成功任务投稿到画廊。</p>
        <RouterLink class="ps-btn is-ghost" to="/history">打开创作历史</RouterLink>
      </div>

      <button
        v-if="cursor"
        type="button"
        class="ps-btn is-ghost ps-more"
        :disabled="loadingMore"
        @click="loadList({ append: true })"
      >
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
    </ProfileSectionShell>

    <DeleteHistoryConfirmDialog
      :open="deleteOpen"
      heading="删除这项投稿？"
      description="投稿将从你的记录中移除；已展示的作品也会从画廊撤下。"
      confirm-label="确认删除"
      icon="bi-trash3"
      tone="danger"
      :light="!appearanceStore.isDark"
      @confirm="confirmDelete"
      @close="deleteOpen = false"
    />
  </div>
</template>

<style scoped>
.ps-page {
  --ps-text: #1c1a27;
  --ps-muted: rgba(28, 26, 39, 0.58);
  --ps-line: rgba(28, 26, 39, 0.1);
  --ps-surface: rgba(255, 255, 255, 0.82);
  --ps-card: rgba(255, 255, 255, 0.94);
  --ps-accent: #6b5cff;
  --ps-shadow: 0 18px 40px rgba(40, 30, 80, 0.07);
  position: relative;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 28px clamp(16px, 3vw, 36px) 72px;
  color: var(--ps-text);
  overflow: clip;
}

.ps-page.is-dark {
  --ps-text: #f4f2ff;
  --ps-muted: rgba(244, 242, 255, 0.62);
  --ps-line: rgba(244, 242, 255, 0.12);
  --ps-surface: rgba(24, 22, 36, 0.78);
  --ps-card: rgba(32, 28, 48, 0.92);
  --ps-accent: #a99dff;
  --ps-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}

.ps-atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.ps-atmosphere__wash {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(167, 139, 250, 0.22), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(125, 211, 252, 0.16), transparent 50%),
    linear-gradient(180deg, #f6f3ff 0%, #eef2ff 48%, #f8fafc 100%);
}

.ps-page.is-dark .ps-atmosphere__wash {
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(99, 102, 241, 0.28), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(56, 189, 248, 0.14), transparent 50%),
    linear-gradient(180deg, #120f1c 0%, #161325 48%, #101018 100%);
}

.ps-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--ps-line);
  background: #fff;
  color: var(--ps-text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
}

.ps-page.is-dark .ps-btn {
  background: rgba(255, 255, 255, 0.06);
}

.ps-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(107, 92, 255, 0.35);
  color: var(--ps-accent);
}

.ps-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ps-more {
  width: 100%;
  margin-top: 14px;
}

.ps-skel {
  display: grid;
  gap: 10px;
}

.ps-skel__row {
  height: 72px;
  border-radius: 16px;
  background: linear-gradient(
    90deg,
    rgba(28, 26, 39, 0.04),
    rgba(28, 26, 39, 0.08),
    rgba(28, 26, 39, 0.04)
  );
  background-size: 200% 100%;
  animation: ps-shimmer 1.2s linear infinite;
}

.ps-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 56px 16px;
  text-align: center;
  color: var(--ps-muted);
}

.ps-empty i {
  font-size: 1.5rem;
  color: var(--ps-accent);
}

.ps-empty strong {
  color: var(--ps-text);
}

.ps-empty p {
  margin: 0;
  max-width: 36ch;
  font-size: 0.86rem;
  line-height: 1.5;
}

.ps-submission-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.ps-submission-list li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--ps-line);
  border-radius: 16px;
  background: var(--ps-card);
}

.ps-submission-list img,
.ps-submission-list :deep(.optimized-image) {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  display: block;
}

.ps-submission__body {
  min-width: 0;
}

.ps-submission__body strong {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.9rem;
}

.ps-submission__body small,
.ps-submission__reason {
  color: var(--ps-muted);
  font-size: 0.74rem;
}

.ps-submission__reason {
  margin: 4px 0 0;
}

.ps-submission__status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(28, 26, 39, 0.06);
}

.ps-submission__status[data-status='approved'] {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.ps-submission__status[data-status='rejected'] {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.ps-submission__status[data-status='pending'] {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.ps-submission__remove {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ps-muted);
  cursor: pointer;
}

.ps-submission__remove:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.spin {
  animation: ps-spin 0.9s linear infinite;
}

@keyframes ps-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ps-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 720px) {
  .ps-submission-list li {
    grid-template-columns: 56px minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
  }

  .ps-submission__remove {
    grid-column: 3;
    grid-row: 1;
  }

  .ps-submission__status {
    grid-column: 2 / 4;
  }
}
</style>
