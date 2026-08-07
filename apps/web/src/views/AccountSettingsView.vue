<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { updateProfile } from '@/services/meApi'
import { uploadFile } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import ProfileSectionShell from '@/components/profile/ProfileSectionShell.vue'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()

const profileForm = reactive({
  username: '',
  bio: '',
  location: '',
  websiteUrl: '',
  saving: false,
  avatarUploading: false,
})
const avatarInput = ref(null)
const preferenceSaving = ref(false)
const requireCostConfirm = computed(() => authStore.user?.requireCostConfirm !== false)

const normalizedProfileForm = computed(() => ({
  username: profileForm.username.trim(),
  bio: profileForm.bio.trim(),
  location: profileForm.location.trim(),
  websiteUrl: profileForm.websiteUrl.trim(),
}))
const normalizedSavedProfile = computed(() => ({
  username: String(authStore.user?.username || '').trim(),
  bio: String(authStore.user?.bio || '').trim(),
  location: String(authStore.user?.location || '').trim(),
  websiteUrl: String(authStore.user?.websiteUrl || '').trim(),
}))
const profileDirty = computed(
  () =>
    JSON.stringify(normalizedProfileForm.value) !== JSON.stringify(normalizedSavedProfile.value),
)
const usernameError = computed(() => (normalizedProfileForm.value.username ? '' : '昵称不能为空'))
const websiteError = computed(() => {
  const url = normalizedProfileForm.value.websiteUrl
  return url && !/^https?:\/\/[^\s]+$/i.test(url) ? '请输入完整的 http:// 或 https:// 地址' : ''
})
const profileCanSave = computed(
  () => profileDirty.value && !usernameError.value && !websiteError.value && !profileForm.saving,
)

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function syncProfileForm() {
  profileForm.username = authStore.user?.username || ''
  profileForm.bio = authStore.user?.bio || ''
  profileForm.location = authStore.user?.location || ''
  profileForm.websiteUrl = authStore.user?.websiteUrl || ''
}

async function saveProfile() {
  const { username, bio, location, websiteUrl } = normalizedProfileForm.value
  if (!username) {
    notificationService.warning('用户名不能为空')
    return
  }
  profileForm.saving = true
  try {
    if (websiteUrl && !/^https?:\/\/[^\s]+$/i.test(websiteUrl)) {
      notificationService.warning('个人网站需要填写完整的 http/https 地址')
      return
    }
    const result = await updateProfile({ username, bio, location, websiteUrl })
    authStore.patchUser(result?.user || { username, bio, location, websiteUrl })
    syncProfileForm()
    notificationService.success('个人资料已保存')
  } catch (error) {
    notificationService.error(error?.message || '保存失败')
  } finally {
    profileForm.saving = false
  }
}

async function setCostConfirmPreference(enabled) {
  if (preferenceSaving.value) return
  const previous = requireCostConfirm.value
  const next = Boolean(enabled)
  authStore.patchUser({ requireCostConfirm: next })
  preferenceSaving.value = true
  try {
    const result = await updateProfile({ requireCostConfirm: next })
    authStore.patchUser(result?.user || { requireCostConfirm: next })
    notificationService.success(next ? '已开启生成前费用确认' : '已关闭生成前费用确认')
  } catch (error) {
    authStore.patchUser({ requireCostConfirm: previous })
    notificationService.error(error?.message || '创作偏好保存失败')
  } finally {
    preferenceSaving.value = false
  }
}

function loadAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectURL)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectURL)
      reject(new Error('头像图片读取失败'))
    }
    image.src = objectURL
  })
}

async function createAvatarUpload(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择 PNG、JPEG 或 WebP 图片')
  if (file.size > 10 * 1024 * 1024) throw new Error('头像图片不能超过 10MB')
  const image = await loadAvatarImage(file)
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理头像图片')
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    512,
    512,
  )
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('头像处理失败')
  return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
}

async function onAvatarSelected(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || profileForm.avatarUploading) return
  profileForm.avatarUploading = true
  try {
    const uploaded = await uploadFile(await createAvatarUpload(file))
    const result = await updateProfile({ avatarUrl: uploaded.url })
    authStore.patchUser(result?.user || { avatarUrl: uploaded.url })
    notificationService.success('头像已更新')
  } catch (error) {
    notificationService.error(error?.message || '头像上传失败')
  } finally {
    profileForm.avatarUploading = false
  }
}

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    router.replace({
      name: 'auth',
      query: { ...createLoginRedirectQuery('/account'), mode: 'login' },
    })
    return
  }
  await authStore.initAuth().catch(() => null)
  syncProfileForm()
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

    <ProfileSectionShell title="账号设置" description="管理公开资料、创作偏好和账号安全。">
      <div class="ps-account-forms">
        <form class="ps-account-form" @submit.prevent="saveProfile">
          <h3><i class="bi bi-person-vcard"></i> 个人资料</h3>
          <div class="ps-avatar-editor">
            <button
              type="button"
              class="ps-avatar-editor__preview"
              :disabled="profileForm.avatarUploading"
              aria-label="更换头像"
              @click="avatarInput?.click()"
            >
              <img
                v-if="authStore.user?.avatarUrl"
                :src="authStore.user.avatarUrl"
                alt="头像"
                loading="eager"
                decoding="async"
              />
              <img
                v-else
                src="/brand/avatar-placeholder.svg"
                alt="头像"
                loading="eager"
                decoding="async"
              />
            </button>
            <div>
              <strong>{{ authStore.displayName }}</strong>
              <p data-no-translate>{{ authStore.user?.email }}</p>
              <button
                type="button"
                class="ps-btn is-ghost"
                :disabled="profileForm.avatarUploading"
                @click="avatarInput?.click()"
              >
                <i
                  class="bi"
                  :class="profileForm.avatarUploading ? 'bi-arrow-repeat spin' : 'bi-camera'"
                ></i>
                {{ profileForm.avatarUploading ? '上传中…' : '更换头像' }}
              </button>
            </div>
            <input
              ref="avatarInput"
              class="ps-avatar-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              @change="onAvatarSelected"
            />
          </div>

          <div class="ps-profile-grid">
            <label>
              <span>昵称</span>
              <input
                v-model="profileForm.username"
                maxlength="64"
                placeholder="你希望展示的名字"
                :aria-invalid="Boolean(usernameError)"
              />
            </label>
            <label>
              <span>所在地</span>
              <input
                v-model="profileForm.location"
                maxlength="80"
                placeholder="例如：上海 / Remote"
              />
            </label>
            <label class="is-wide">
              <span>个人网站</span>
              <input
                v-model="profileForm.websiteUrl"
                maxlength="300"
                inputmode="url"
                placeholder="https://example.com"
                :aria-invalid="Boolean(websiteError)"
              />
            </label>
            <p v-if="websiteError" class="ps-field-error is-wide">{{ websiteError }}</p>
            <label class="is-wide">
              <span>个人简介 <em>{{ profileForm.bio.length }}/280</em></span>
              <textarea
                v-model="profileForm.bio"
                maxlength="280"
                rows="5"
                placeholder="介绍你的创作方向、擅长风格或正在进行的项目…"
              ></textarea>
            </label>
          </div>

          <div class="ps-form-footer">
            <span :class="{ 'is-dirty': profileDirty }">
              <i class="bi" :class="profileDirty ? 'bi-circle-fill' : 'bi-check2-circle'"></i>
              {{ profileDirty ? '有未保存的修改' : '资料已是最新状态' }}
            </span>
            <button type="submit" class="ps-btn is-primary" :disabled="!profileCanSave">
              {{ profileForm.saving ? '保存中…' : '保存个人资料' }}
            </button>
          </div>
        </form>

        <section class="ps-account-form">
          <h3><i class="bi bi-sliders2"></i> 创作偏好</h3>
          <p class="ps-preference-intro">
            调整生成流程中的确认方式。余额不足、预算超限等安全拦截始终保留。
          </p>
          <label class="ps-preference-row" :class="{ 'is-saving': preferenceSaving }">
            <span class="ps-preference-copy">
              <strong>生成前费用确认</strong>
              <small>
                {{
                  requireCostConfirm
                    ? '每次提交付费生成前显示费用明细'
                    : '校验通过后直接提交生成任务'
                }}
              </small>
            </span>
            <input
              type="checkbox"
              :checked="requireCostConfirm"
              :disabled="preferenceSaving"
              aria-label="生成前费用确认"
              @change="setCostConfirmPreference($event.target.checked)"
            />
            <span class="ps-preference-switch" aria-hidden="true"><i></i></span>
          </label>
          <div class="ps-preference-state">
            <i
              class="bi"
              :class="preferenceSaving ? 'bi-arrow-repeat spin' : 'bi-check2-circle'"
            ></i>
            {{ preferenceSaving ? '正在保存账号偏好…' : '已同步到当前账号' }}
          </div>
        </section>

        <section class="ps-account-form">
          <h3><i class="bi bi-fingerprint"></i> 账号信息</h3>
          <dl class="ps-identity">
            <div>
              <dt>登录邮箱</dt>
              <dd data-no-translate>{{ authStore.user?.email || '—' }}</dd>
            </div>
            <div>
              <dt>账号 ID</dt>
              <dd data-no-translate>{{ authStore.user?.id || '—' }}</dd>
            </div>
            <div>
              <dt>注册时间</dt>
              <dd>{{ formatTime(authStore.user?.createdAt) }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </ProfileSectionShell>
  </div>
</template>

<style scoped>
.ps-page {
  --ps-text: #1c1a27;
  --ps-muted: rgba(28, 26, 39, 0.58);
  --ps-line: rgba(28, 26, 39, 0.1);
  --ps-surface: rgba(255, 255, 255, 0.82);
  --ps-card: rgba(255, 255, 255, 0.96);
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
}

.ps-page.is-dark .ps-btn {
  background: rgba(255, 255, 255, 0.06);
}

.ps-btn.is-primary {
  border-color: transparent;
  background: var(--ps-accent);
  color: #fff;
}

.ps-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(107, 92, 255, 0.35);
  color: var(--ps-accent);
}

.ps-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ps-account-forms {
  display: grid;
  gap: 14px;
}

.ps-account-form {
  padding: 16px;
  border: 1px solid var(--ps-line);
  border-radius: 18px;
  background: var(--ps-card);
}

.ps-account-form h3 {
  margin: 0 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
}

.ps-avatar-editor {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.ps-avatar-editor__preview {
  width: 72px;
  height: 72px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  background: rgba(28, 26, 39, 0.06);
}

.ps-avatar-editor__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ps-avatar-editor strong {
  display: block;
  font-size: 0.95rem;
}

.ps-avatar-editor p {
  margin: 4px 0 10px;
  color: var(--ps-muted);
  font-size: 0.78rem;
}

.ps-avatar-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.ps-profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ps-profile-grid label {
  display: grid;
  gap: 6px;
}

.ps-profile-grid .is-wide {
  grid-column: 1 / -1;
}

.ps-profile-grid span {
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--ps-muted);
}

.ps-profile-grid em {
  font-style: normal;
  font-weight: 600;
}

.ps-profile-grid input,
.ps-profile-grid textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ps-line);
  border-radius: 12px;
  background: transparent;
  color: var(--ps-text);
  font: inherit;
}

.ps-field-error {
  margin: 0;
  color: #ef4444;
  font-size: 0.76rem;
}

.ps-form-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.ps-form-footer span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ps-muted);
  font-size: 0.78rem;
}

.ps-form-footer span.is-dirty {
  color: #d97706;
}

.ps-preference-intro {
  margin: 0 0 12px;
  color: var(--ps-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.ps-preference-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(28, 26, 39, 0.03);
  cursor: pointer;
}

.ps-page.is-dark .ps-preference-row {
  background: rgba(255, 255, 255, 0.04);
}

.ps-preference-copy {
  display: grid;
  gap: 4px;
}

.ps-preference-copy small {
  color: var(--ps-muted);
  font-size: 0.76rem;
}

.ps-preference-row input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.ps-preference-switch {
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: rgba(28, 26, 39, 0.16);
  position: relative;
  flex: none;
}

.ps-preference-switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 160ms ease;
}

.ps-preference-row input:checked + .ps-preference-switch {
  background: var(--ps-accent);
}

.ps-preference-row input:checked + .ps-preference-switch i {
  transform: translateX(18px);
}

.ps-preference-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--ps-muted);
  font-size: 0.76rem;
}

.ps-identity {
  margin: 0;
  display: grid;
  gap: 10px;
}

.ps-identity > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ps-line);
}

.ps-identity > div:last-child {
  border-bottom: 0;
}

.ps-identity dt {
  color: var(--ps-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.ps-identity dd {
  margin: 0;
  font-size: 0.86rem;
  word-break: break-all;
}

.spin {
  animation: ps-spin 0.9s linear infinite;
}

@keyframes ps-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .ps-profile-grid {
    grid-template-columns: 1fr;
  }

  .ps-identity > div {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
