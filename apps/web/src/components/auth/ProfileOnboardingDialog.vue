<script setup>
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { updateProfile } from '@/services/meApi'
import { uploadFile } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const usernameInput = ref(null)
const avatarInput = ref(null)
const avatarUrl = ref('')
const avatarUploading = ref(false)
const form = reactive({ username: '', bio: '', location: '' })
const saving = ref(false)
const error = ref('')

const MAX_AVATAR_INPUT_BYTES = 4 * 1024 * 1024
const MAX_AVATAR_OUTPUT_BYTES = 500 * 1024

// 仅开发环境用于反复调整弹窗，不改变正式登录流程。
const profileOnboardingPreview =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('profile-onboarding-preview') === '1'

onMounted(() => {
  if (profileOnboardingPreview) authStore.showProfileOnboarding = true
})

watch(
  () => authStore.showProfileOnboarding,
  async (open) => {
    if (!open) return
    form.username = ''
    form.bio = ''
    form.location = ''
    avatarUrl.value = authStore.user?.avatarUrl || ''
    error.value = ''
    await nextTick()
    usernameInput.value?.focus()
  },
)

function dismiss() {
  if (saving.value || avatarUploading.value) return
  authStore.dismissProfileOnboarding()
}

function continueToStudio() {
  if (saving.value || avatarUploading.value) return
  authStore.dismissProfileOnboarding()
  router.push({ name: 'studio' })
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
  if (file.size > MAX_AVATAR_INPUT_BYTES) throw new Error('头像图片不能超过 4MB')
  const image = await loadAvatarImage(file)
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理头像图片')

  const outputSizes = [512, 448, 384, 320, 256, 192]
  const outputQualities = [0.84, 0.72, 0.62, 0.52, 0.42, 0.32]
  let smallestBlob = null

  for (const outputSize of outputSizes) {
    canvas.width = outputSize
    canvas.height = outputSize
    context.clearRect(0, 0, outputSize, outputSize)
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      outputSize,
      outputSize,
    )

    for (const quality of outputQualities) {
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      )
      if (!blob) continue
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob
      if (blob.size <= MAX_AVATAR_OUTPUT_BYTES) {
        return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
      }
    }
  }

  if (!smallestBlob) throw new Error('头像处理失败')
  throw new Error('头像压缩后仍超过 500KB，请选择更简单的图片')
}

async function onAvatarSelected(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || avatarUploading.value) return
  avatarUploading.value = true
  error.value = ''
  try {
    const uploaded = await uploadFile(await createAvatarUpload(file))
    avatarUrl.value = uploaded.url
  } catch (err) {
    error.value = err?.message || '头像上传失败'
  } finally {
    avatarUploading.value = false
  }
}

async function save() {
  const username = form.username.trim()
  if (!username) {
    error.value = ''
    notificationService.warning('请输入昵称', {
      position: 'top-center',
      duration: 2400,
      closable: false,
    })
    usernameInput.value?.focus()
    return
  }
  saving.value = true
  error.value = ''
  try {
    const profilePayload = {
      username,
      bio: form.bio.trim(),
      location: form.location.trim(),
      ...(avatarUrl.value ? { avatarUrl: avatarUrl.value } : {}),
    }
    const result = await updateProfile(profilePayload)
    authStore.patchUser(
      result?.user || { ...profilePayload },
    )
    authStore.dismissProfileOnboarding()
    notificationService.success('个人资料已保存')
  } catch (err) {
    error.value = err?.message || '资料保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="profile-onboarding">
      <div
        v-if="authStore.showProfileOnboarding"
        class="profile-onboarding-layer"
        role="presentation"
        @mousedown.self="dismiss"
      >
        <section
          class="profile-onboarding-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-onboarding-title"
          tabindex="-1"
          @keydown.esc="dismiss"
        >
          <header class="profile-onboarding-head">
            <span class="profile-onboarding-mark" aria-hidden="true">
              <i class="bi bi-person-vcard"></i>
            </span>
            <div class="profile-onboarding-heading">
              <h2 id="profile-onboarding-title">补充个人资料</h2>
            </div>
            <button type="button" aria-label="关闭资料设置" title="关闭" @click="dismiss">
              <i class="bi bi-x"></i>
            </button>
          </header>

          <form class="profile-onboarding-form" @submit.prevent="save">
            <div class="profile-onboarding-identity">
              <div class="profile-onboarding-avatar-block">
                <button
                  type="button"
                  class="profile-onboarding-avatar"
                  :disabled="avatarUploading"
                  aria-label="选择头像"
                  @click="avatarInput?.click()"
                >
                  <img v-if="avatarUrl" :src="avatarUrl" alt="头像预览" />
                  <i v-else class="bi bi-person-circle" aria-hidden="true"></i>
                  <span v-if="avatarUploading" class="profile-onboarding-avatar__loading">
                    <i class="bi bi-arrow-repeat is-spinning" aria-hidden="true"></i>
                  </span>
                </button>
                <button
                  type="button"
                  class="profile-onboarding-avatar-link"
                  :disabled="avatarUploading"
                  @click="avatarInput?.click()"
                >
                  {{ avatarUploading ? '上传中…' : avatarUrl ? '更换头像' : '设置头像' }}
                </button>
                <input
                  ref="avatarInput"
                  class="profile-onboarding-avatar-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  @change="onAvatarSelected"
                />
              </div>

              <label class="profile-onboarding-field profile-onboarding-field--required" for="profile-username">
                <span class="profile-onboarding-field__head">
                  <span class="profile-onboarding-field__label">
                    <i class="bi bi-person" aria-hidden="true"></i>
                    昵称
                  </span>
                  <small class="is-required">必填</small>
                </span>
                <span class="profile-onboarding-control">
                  <i class="bi bi-at" aria-hidden="true"></i>
                  <input
                    id="profile-username"
                    ref="usernameInput"
                    v-model="form.username"
                    maxlength="64"
                    autocomplete="nickname"
                    aria-describedby="profile-username-hint"
                    placeholder="怎么称呼你"
                  />
                </span>
                <span id="profile-username-hint" class="profile-onboarding-field__meta">
                  <small>展示在你的主页和作品中</small>
                  <small>{{ form.username.length }}/64</small>
                </span>
              </label>
            </div>

            <label class="profile-onboarding-field" for="profile-bio">
              <span class="profile-onboarding-field__head">
                <span class="profile-onboarding-field__label">
                  <i class="bi bi-chat-left" aria-hidden="true"></i>
                  个人简介
                </span>
                <small>选填</small>
              </span>
              <textarea
                id="profile-bio"
                v-model="form.bio"
                maxlength="280"
                rows="3"
                aria-describedby="profile-bio-hint"
                placeholder="简单介绍一下自己"
              ></textarea>
              <span id="profile-bio-hint" class="profile-onboarding-field__meta">
                <small>告诉大家你的创作方向或兴趣</small>
                <small>{{ form.bio.length }}/280</small>
              </span>
            </label>

            <label class="profile-onboarding-field" for="profile-location">
              <span class="profile-onboarding-field__head">
                <span class="profile-onboarding-field__label">
                  <i class="bi bi-geo-alt" aria-hidden="true"></i>
                  所在地
                </span>
                <small>选填</small>
              </span>
              <span class="profile-onboarding-control">
                <i class="bi bi-pin-map" aria-hidden="true"></i>
                <input
                  id="profile-location"
                  v-model="form.location"
                  maxlength="80"
                  autocomplete="address-level2"
                  aria-describedby="profile-location-hint"
                  placeholder="城市或地区"
                />
              </span>
              <span id="profile-location-hint" class="profile-onboarding-field__meta">
                <small>选填，随时可以修改</small>
                <small>{{ form.location.length }}/80</small>
              </span>
            </label>

            <p v-if="error" class="profile-onboarding-error" role="alert">
              <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
              {{ error }}
            </p>

            <footer>
              <span class="profile-onboarding-footer-note">
                <i class="bi bi-info-circle" aria-hidden="true"></i>
                资料稍后也可以在个人中心完善
              </span>
              <span class="profile-onboarding-actions">
                <button
                  type="button"
                  class="is-secondary"
                  :disabled="saving || avatarUploading"
                  @click="continueToStudio"
                >
                  稍后完善
                </button>
                <button type="submit" class="is-primary" :disabled="saving || avatarUploading">
                  {{ saving ? '保存中…' : '保存资料' }}
                </button>
              </span>
            </footer>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.profile-onboarding-layer {
  position: fixed;
  inset: 0;
  z-index: 16000;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(8, 14, 22, 0.68);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.profile-onboarding-dialog {
  width: min(100%, 620px);
  max-height: min(720px, calc(100dvh - 32px));
  overflow: auto;
  border: 1px solid #d9dfe3;
  border-radius: 14px;
  color: #1c2733;
  background: #fff;
  box-shadow: 0 28px 76px rgba(0, 0, 0, 0.28);
  outline: 0;
}

.profile-onboarding-head {
  display: flex;
  gap: 13px;
  align-items: center;
  padding: 22px 24px 19px;
  border-bottom: 1px solid #e1e6e9;
}

.profile-onboarding-mark {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid #c8e6d9;
  border-radius: 14px;
  color: #0f785a;
  background: #e5f5ee;
  font-size: 20px;
}

.profile-onboarding-heading {
  flex: 1 1 auto;
  min-width: 0;
}

.profile-onboarding-head p,
.profile-onboarding-head h2,
.profile-onboarding-heading > span {
  margin: 0;
}

.profile-onboarding-head p {
  color: #74818c;
  font-size: 12px;
  font-weight: 600;
}

.profile-onboarding-head h2 {
  margin: 0;
  color: #1c2733;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.25;
}

.profile-onboarding-heading > span {
  display: block;
  margin-top: 5px;
  color: #71808a;
  font-size: 12px;
  line-height: 1.5;
}

.profile-onboarding-head > button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  flex: 0 0 auto;
  margin-left: auto;
  color: #71808b;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;
}

.profile-onboarding-head > button:hover,
.profile-onboarding-head > button:focus-visible {
  border-color: #cbd5da;
  color: #1c2733;
  background: #f1f5f5;
  outline: 0;
}

.profile-onboarding-form {
  display: grid;
  gap: 17px;
  padding: 20px 24px 22px;
}

.profile-onboarding-identity {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
}

.profile-onboarding-avatar-block {
  display: grid;
  min-width: 0;
  justify-items: center;
  gap: 6px;
}

.profile-onboarding-avatar {
  position: relative;
  display: grid;
  width: 84px;
  height: 84px;
  place-items: center;
  overflow: hidden;
  border: 1px solid #c8e6d9;
  border-radius: 50%;
  color: #0f785a;
  background: #e7f6ef;
  cursor: pointer;
  font-size: 28px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.profile-onboarding-avatar:hover:not(:disabled),
.profile-onboarding-avatar:focus-visible {
  border-color: #167c5c;
  box-shadow: 0 0 0 4px rgba(22, 124, 92, 0.12);
  outline: 0;
  transform: translateY(-1px);
}

.profile-onboarding-avatar:disabled {
  cursor: wait;
  opacity: 0.72;
}

.profile-onboarding-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-onboarding-avatar__loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  color: #fff;
  border: 0;
  border-radius: 50%;
  background: rgba(13, 45, 36, 0.58);
  font-size: 20px;
}

.profile-onboarding-avatar-link {
  padding: 0;
  border: 0;
  color: #0f785a;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.profile-onboarding-avatar-link:hover:not(:disabled),
.profile-onboarding-avatar-link:focus-visible {
  color: #0d6449;
  outline: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.profile-onboarding-avatar-link:disabled {
  cursor: wait;
  opacity: 0.65;
}

.profile-onboarding-avatar-input {
  display: none;
}

.profile-onboarding-field {
  display: grid;
  gap: 7px;
}

.profile-onboarding-field__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.profile-onboarding-field__label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #1d2935;
  font-size: 13px;
  font-weight: 800;
}

.profile-onboarding-field__label > i {
  color: #0f785a;
  font-size: 15px;
}

.profile-onboarding-field__head > small {
  color: #87939b;
  font-size: 11px;
  font-weight: 600;
}

.profile-onboarding-field__head > small.is-required {
  color: #117b5a;
}

.profile-onboarding-control {
  position: relative;
  display: block;
}

.profile-onboarding-control > i {
  position: absolute;
  top: 50%;
  left: 14px;
  z-index: 1;
  color: #8b969e;
  font-size: 15px;
  pointer-events: none;
  transform: translateY(-50%);
}

.profile-onboarding-form input,
.profile-onboarding-form textarea {
  width: 100%;
  border: 1px solid #d5dfe4;
  border-radius: 9px;
  outline: 0;
  color: #17212b;
  background: #fbfcfd;
  font: inherit;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.profile-onboarding-form input {
  height: 44px;
  padding: 0 12px 0 40px;
}

.profile-onboarding-form textarea {
  min-height: 84px;
  padding: 10px 12px;
  line-height: 1.5;
  resize: vertical;
}

.profile-onboarding-form input::placeholder,
.profile-onboarding-form textarea::placeholder {
  color: #9aa3aa;
}

.profile-onboarding-form input:focus,
.profile-onboarding-form textarea:focus,
.profile-onboarding-control:focus-within input {
  border-color: #167c5c;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(22, 124, 92, 0.12);
}

.profile-onboarding-field__meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  color: #8a969e;
  font-size: 11px;
  line-height: 1.35;
}

.profile-onboarding-field__meta small:last-child {
  flex: 0 0 auto;
  color: #a0aab1;
  font-variant-numeric: tabular-nums;
}

.profile-onboarding-error {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: -3px 0 0;
  color: #bd3434;
  font-size: 12px;
}

.profile-onboarding-form footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 4px;
  border-top: 1px solid #edf0f2;
}

.profile-onboarding-footer-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #7c8991;
  font-size: 11px;
  line-height: 1.4;
}

.profile-onboarding-footer-note i {
  color: #0f785a;
  font-size: 14px;
}

.profile-onboarding-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 9px;
}

.profile-onboarding-form footer button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 16px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.profile-onboarding-form footer button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.profile-onboarding-form footer button:focus-visible {
  outline: 3px solid rgba(22, 124, 92, 0.2);
  outline-offset: 2px;
}

.profile-onboarding-form footer button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.profile-onboarding-form .is-secondary {
  border: 1px solid #d5dfe4;
  color: #50606b;
  background: #fff;
}

.profile-onboarding-form .is-secondary:hover:not(:disabled) {
  border-color: #b9c7cf;
  background: #f7f9fa;
}

.profile-onboarding-form .is-primary {
  border: 1px solid #147758;
  color: #fff;
  background: #147758;
  box-shadow: 0 6px 14px rgba(20, 119, 88, 0.16);
}

.profile-onboarding-form .is-primary:hover:not(:disabled) {
  border-color: #0d6449;
  background: #0d6449;
}

.is-spinning {
  animation: profile-onboarding-spin 0.8s linear infinite;
}

.profile-onboarding-enter-active,
.profile-onboarding-leave-active {
  transition: opacity 0.2s ease;
}

.profile-onboarding-enter-active .profile-onboarding-dialog,
.profile-onboarding-leave-active .profile-onboarding-dialog {
  transition:
    transform 0.24s ease,
    opacity 0.2s ease;
}

.profile-onboarding-enter-from,
.profile-onboarding-leave-to {
  opacity: 0;
}

.profile-onboarding-enter-from .profile-onboarding-dialog,
.profile-onboarding-leave-to .profile-onboarding-dialog {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
}

@keyframes profile-onboarding-spin {
  to {
    transform: rotate(360deg);
  }
}



@media (prefers-reduced-motion: reduce) {
  .profile-onboarding-enter-active,
  .profile-onboarding-leave-active,
  .profile-onboarding-enter-active .profile-onboarding-dialog,
  .profile-onboarding-leave-active .profile-onboarding-dialog,
  .profile-onboarding-form footer button {
    transition: none;
  }
}
/* 创作台视觉令牌：紫色渐变、轻玻璃面板和柔和的创作光晕。 */
.profile-onboarding-layer {
  background: rgba(12, 9, 24, 0.64);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
}

.profile-onboarding-dialog {
  border-color: rgba(88, 60, 140, 0.18);
  border-radius: 20px;
  color: #1a1428;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 30px 84px rgba(88, 60, 140, 0.24);
  font-family: 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
}

.profile-onboarding-head {
  border-bottom-color: rgba(88, 60, 140, 0.12);
}

.profile-onboarding-mark {
  border-color: rgba(124, 92, 255, 0.22);
  color: #7c5cff;
  background: rgba(124, 92, 255, 0.12);
}

.profile-onboarding-head p,
.profile-onboarding-heading > span,
.profile-onboarding-field__head > small,
.profile-onboarding-field__meta,
.profile-onboarding-footer-note {
  color: #8b839c;
}

.profile-onboarding-head h2,
.profile-onboarding-field__label {
  color: #1a1428;
}

.profile-onboarding-head > button:hover,
.profile-onboarding-head > button:focus-visible {
  border-color: rgba(124, 92, 255, 0.22);
  color: #4a4260;
  background: rgba(124, 92, 255, 0.08);
}

.profile-onboarding-avatar {
  border-color: rgba(124, 92, 255, 0.24);
  color: #7c5cff;
  background: rgba(124, 92, 255, 0.1);
}

.profile-onboarding-avatar:hover:not(:disabled),
.profile-onboarding-avatar:focus-visible {
  border-color: #7c5cff;
  box-shadow: 0 0 0 4px rgba(124, 92, 255, 0.14);
}

.profile-onboarding-avatar__loading {
  background: linear-gradient(135deg, #7c5cff, #a855f7);
}

.profile-onboarding-avatar-link,
.profile-onboarding-field__label > i,
.profile-onboarding-field__head > small.is-required,
.profile-onboarding-footer-note i {
  color: #7c5cff;
}

.profile-onboarding-avatar-link:hover:not(:disabled),
.profile-onboarding-avatar-link:focus-visible {
  color: #6245d8;
}

.profile-onboarding-form input,
.profile-onboarding-form textarea {
  border-color: rgba(88, 60, 140, 0.18);
  color: #1a1428;
  background: rgba(255, 255, 255, 0.76);
}

.profile-onboarding-form input::placeholder,
.profile-onboarding-form textarea::placeholder {
  color: #a39bad;
}

.profile-onboarding-form input:focus,
.profile-onboarding-form textarea:focus,
.profile-onboarding-control:focus-within input {
  border-color: #7c5cff;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.14);
}

.profile-onboarding-field__meta small:last-child {
  color: #aaa1b6;
}

.profile-onboarding-error {
  color: #d95483;
}

.profile-onboarding-form footer {
  border-top-color: rgba(88, 60, 140, 0.1);
}

.profile-onboarding-form .is-secondary {
  border-color: rgba(88, 60, 140, 0.18);
  color: #4a4260;
  background: rgba(255, 255, 255, 0.72);
}

.profile-onboarding-form .is-secondary:hover:not(:disabled) {
  border-color: rgba(124, 92, 255, 0.3);
  background: rgba(124, 92, 255, 0.07);
}

.profile-onboarding-form .is-primary {
  border-color: transparent;
  background: linear-gradient(135deg, #7c5cff, #a855f7);
  box-shadow: 0 8px 18px rgba(88, 60, 140, 0.22);
}

.profile-onboarding-form .is-primary:hover:not(:disabled) {
  border-color: transparent;
  background: linear-gradient(135deg, #6f50ed, #9847e5);
}

:global(.color-scheme-dark) .profile-onboarding-dialog {
  border-color: rgba(180, 160, 255, 0.18);
  color: rgba(255, 255, 255, 0.94);
  background: rgba(22, 18, 34, 0.96);
  box-shadow: 0 30px 84px rgba(0, 0, 0, 0.52);
}

:global(.color-scheme-dark) .profile-onboarding-head {
  border-bottom-color: rgba(180, 160, 255, 0.14);
}

:global(.color-scheme-dark) .profile-onboarding-mark,
:global(.color-scheme-dark) .profile-onboarding-avatar {
  border-color: rgba(180, 156, 255, 0.28);
  color: #b49cff;
  background: rgba(180, 156, 255, 0.15);
}

:global(.color-scheme-dark) .profile-onboarding-head p,
:global(.color-scheme-dark) .profile-onboarding-heading > span,
:global(.color-scheme-dark) .profile-onboarding-field__head > small,
:global(.color-scheme-dark) .profile-onboarding-field__meta,
:global(.color-scheme-dark) .profile-onboarding-footer-note {
  color: rgba(255, 255, 255, 0.5);
}

:global(.color-scheme-dark) .profile-onboarding-head h2,
:global(.color-scheme-dark) .profile-onboarding-field__label {
  color: rgba(255, 255, 255, 0.94);
}

:global(.color-scheme-dark) .profile-onboarding-form input,
:global(.color-scheme-dark) .profile-onboarding-form textarea {
  border-color: rgba(180, 160, 255, 0.18);
  color: rgba(255, 255, 255, 0.94);
  background: rgba(24, 20, 38, 0.86);
}

:global(.color-scheme-dark) .profile-onboarding-form input::placeholder,
:global(.color-scheme-dark) .profile-onboarding-form textarea::placeholder {
  color: rgba(255, 255, 255, 0.36);
}

:global(.color-scheme-dark) .profile-onboarding-form input:focus,
:global(.color-scheme-dark) .profile-onboarding-form textarea:focus,
:global(.color-scheme-dark) .profile-onboarding-control:focus-within input {
  border-color: #b49cff;
  background: rgba(24, 20, 38, 0.94);
  box-shadow: 0 0 0 3px rgba(180, 156, 255, 0.16);
}

:global(.color-scheme-dark) .profile-onboarding-form footer {
  border-top-color: rgba(180, 160, 255, 0.12);
}

:global(.color-scheme-dark) .profile-onboarding-form .is-secondary {
  border-color: rgba(180, 160, 255, 0.18);
  color: rgba(255, 255, 255, 0.72);
  background: rgba(24, 20, 38, 0.86);
}

:global(.color-scheme-dark) .profile-onboarding-form .is-secondary:hover:not(:disabled) {
  border-color: rgba(180, 156, 255, 0.34);
  background: rgba(180, 156, 255, 0.1);
}
</style>
