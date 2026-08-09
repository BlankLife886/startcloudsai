<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { updateProfile } from '@/services/meApi'
import { uploadFile } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'

const router = useRouter()
const authStore = useAuthStore()

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
  <main class="account">
    <header class="account-top">
      <div>
        <h1>账号设置</h1>
        <p>公开资料、创作偏好与账号信息</p>
      </div>
      <div class="account-top__meta">
        <span :class="{ 'is-dirty': profileDirty }">
          <i class="bi" :class="profileDirty ? 'bi-circle-fill' : 'bi-check2-circle'"></i>
          {{ profileDirty ? '有未保存修改' : '资料已同步' }}
        </span>
        <button
          type="button"
          class="account-btn is-primary"
          :disabled="!profileCanSave"
          @click="saveProfile"
        >
          {{ profileForm.saving ? '保存中…' : '保存资料' }}
        </button>
      </div>
    </header>

    <div class="account-stage">
      <form class="account-panel account-profile" @submit.prevent="saveProfile">
        <div class="account-avatar">
          <button
            type="button"
            class="account-avatar__preview"
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
            <span>
              <i
                class="bi"
                :class="profileForm.avatarUploading ? 'bi-arrow-repeat spin' : 'bi-camera'"
              ></i>
            </span>
          </button>
          <div>
            <strong>{{ authStore.displayName }}</strong>
            <p data-no-translate>{{ authStore.user?.email }}</p>
            <button
              type="button"
              class="account-btn is-ghost"
              :disabled="profileForm.avatarUploading"
              @click="avatarInput?.click()"
            >
              {{ profileForm.avatarUploading ? '上传中…' : '更换头像' }}
            </button>
          </div>
          <input
            ref="avatarInput"
            class="account-avatar__input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="onAvatarSelected"
          />
        </div>

        <div class="account-fields">
          <label>
            <span>昵称</span>
            <input
              v-model="profileForm.username"
              maxlength="64"
              placeholder="展示名称"
              :aria-invalid="Boolean(usernameError)"
            />
          </label>
          <label>
            <span>所在地</span>
            <input
              v-model="profileForm.location"
              maxlength="80"
              placeholder="上海 / Remote"
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
          <p v-if="websiteError" class="account-error is-wide">{{ websiteError }}</p>
          <label class="is-wide account-bio">
            <span>个人简介 <em>{{ profileForm.bio.length }}/280</em></span>
            <textarea
              v-model="profileForm.bio"
              maxlength="280"
              rows="3"
              placeholder="创作方向、擅长风格或正在进行的项目…"
            ></textarea>
          </label>
        </div>
      </form>

      <aside class="account-side">
        <section class="account-panel">
          <h2>创作偏好</h2>
          <p>余额不足、预算超限等安全拦截始终保留。</p>
          <label class="account-switch" :class="{ 'is-saving': preferenceSaving }">
            <span>
              <strong>生成前费用确认</strong>
              <small>
                {{
                  requireCostConfirm
                    ? '提交前显示费用明细'
                    : '校验通过后直接提交'
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
            <i aria-hidden="true"><em></em></i>
          </label>
          <small class="account-sync">
            <i
              class="bi"
              :class="preferenceSaving ? 'bi-arrow-repeat spin' : 'bi-check2-circle'"
            ></i>
            {{ preferenceSaving ? '正在保存…' : '已同步到当前账号' }}
          </small>
        </section>

        <section class="account-panel account-identity">
          <h2>账号信息</h2>
          <dl>
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
      </aside>
    </div>
  </main>
</template>

<style scoped>
.account {
  --ink: #1f2430;
  --muted: #6f7a8c;
  --line: #ebe3d8;
  --orange: #f27021;
  --card: rgb(255 255 255 / 94%);
  box-sizing: border-box;
  width: 100%;
  height: calc(100dvh - var(--app-header-offset, 72px));
  max-height: calc(100dvh - var(--app-header-offset, 72px));
  padding: 16px 0 18px;
  overflow: hidden;
  color: var(--ink);
  background:
    radial-gradient(circle at 8% 0%, rgb(255 210 150 / 34%), transparent 28%),
    radial-gradient(circle at 96% 8%, rgb(255 186 120 / 16%), transparent 24%),
    linear-gradient(180deg, #fffaf3 0%, #f6f3ee 48%, #f3f4f7 100%);
}

.account-top,
.account-stage {
  width: min(1120px, calc(100% - 32px));
  margin-inline: auto;
}

.account-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex: none;
}

.account-top h1 {
  margin: 0;
  font-size: clamp(1.45rem, 2.2vw, 1.85rem);
  font-weight: 850;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.account-top p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
}

.account-top__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.account-top__meta > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 0.74rem;
}

.account-top__meta > span.is-dirty {
  color: #b45309;
}

.account-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  background: #fff;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 750;
  cursor: pointer;
}

.account-btn.is-primary {
  color: #fff;
  border-color: var(--orange);
  background: var(--orange);
}

.account-btn.is-ghost {
  min-height: 30px;
  padding: 0 12px;
  font-size: 0.72rem;
}

.account-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.account-stage {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.75fr);
  gap: 12px;
  height: calc(100% - 58px);
  min-height: 0;
}

.account-panel {
  min-height: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--card);
  box-shadow: 0 10px 28px rgb(60 45 20 / 5%);
}

.account-profile {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  background:
    radial-gradient(circle at 100% 0%, rgb(255 186 120 / 22%), transparent 40%),
    var(--card);
}

.account-avatar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.account-avatar__preview {
  position: relative;
  width: 64px;
  height: 64px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  background: #f3ebe1;
}

.account-avatar__preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.account-avatar__preview > span {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  place-items: center;
  height: 22px;
  color: #fff;
  background: rgb(31 36 48 / 55%);
  font-size: 0.72rem;
}

.account-avatar strong {
  display: block;
  font-size: 0.92rem;
  font-weight: 800;
}

.account-avatar p {
  margin: 2px 0 8px;
  color: var(--muted);
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}

.account-avatar__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.account-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-content: start;
  min-height: 0;
}

.account-fields label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.account-fields .is-wide,
.account-error.is-wide {
  grid-column: 1 / -1;
}

.account-fields span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
}

.account-fields em {
  font-style: normal;
  font-weight: 600;
}

.account-fields input,
.account-fields textarea {
  width: 100%;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 11px;
  color: var(--ink);
  background: #fffaf4;
  font: inherit;
  font-size: 0.84rem;
  outline: none;
}

.account-fields input:focus,
.account-fields textarea:focus {
  border-color: #f2b27a;
  box-shadow: 0 0 0 3px rgb(242 112 33 / 10%);
}

.account-bio {
  min-height: 0;
}

.account-bio textarea {
  resize: none;
  min-height: 72px;
  height: 100%;
  max-height: 120px;
}

.account-error {
  margin: 0;
  color: #dc2626;
  font-size: 0.72rem;
}

.account-side {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.account-side h2 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 850;
}

.account-side > .account-panel > p {
  margin: 4px 0 12px;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.4;
}

.account-switch {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: #fff7ef;
  cursor: pointer;
}

.account-switch span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.account-switch strong {
  font-size: 0.82rem;
}

.account-switch small {
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.35;
}

.account-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.account-switch > i {
  position: relative;
  display: block;
  width: 42px;
  height: 24px;
  flex: none;
  border-radius: 999px;
  background: #d7cfc4;
}

.account-switch > i em {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 160ms ease;
}

.account-switch input:checked + i {
  background: var(--orange);
}

.account-switch input:checked + i em {
  transform: translateX(18px);
}

.account-sync {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  color: var(--muted);
  font-size: 0.7rem;
}

.account-identity {
  display: grid;
  align-content: start;
  gap: 10px;
  overflow: hidden;
}

.account-identity dl {
  display: grid;
  gap: 0;
  margin: 0;
}

.account-identity dl > div {
  display: grid;
  gap: 2px;
  padding: 10px 0;
  border-bottom: 1px solid #f0e8dc;
}

.account-identity dl > div:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.account-identity dt {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
}

.account-identity dd {
  margin: 0;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spin {
  animation: account-spin 0.9s linear infinite;
}

@keyframes account-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .account {
    height: calc(100dvh - var(--app-header-offset, 72px));
    overflow: hidden;
  }

  .account-stage {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1.2fr) minmax(0, 0.9fr);
  }

  .account-side {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }
}

@media (max-width: 640px) {
  .account-top,
  .account-stage {
    width: calc(100% - 20px);
  }

  .account-top {
    align-items: stretch;
    flex-direction: column;
  }

  .account-top__meta {
    justify-content: space-between;
  }

  .account-fields {
    grid-template-columns: 1fr;
  }

  .account-side {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }

  .account-bio textarea {
    max-height: 84px;
  }
}
</style>
