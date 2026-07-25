<script setup>
import { nextTick, reactive, ref, watch } from 'vue'
import { updateProfile } from '@/services/meApi'
import notificationService from '@/services/notification'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const usernameInput = ref(null)
const form = reactive({ username: '', bio: '', location: '' })
const saving = ref(false)
const error = ref('')

watch(
  () => authStore.showProfileOnboarding,
  async (open) => {
    if (!open) return
    form.username = ''
    form.bio = ''
    form.location = ''
    error.value = ''
    await nextTick()
    usernameInput.value?.focus()
  },
)

function dismiss() {
  if (saving.value) return
  authStore.dismissProfileOnboarding()
}

async function save() {
  const username = form.username.trim()
  if (!username) {
    error.value = '请输入昵称'
    usernameInput.value?.focus()
    return
  }
  saving.value = true
  error.value = ''
  try {
    const result = await updateProfile({
      username,
      bio: form.bio.trim(),
      location: form.location.trim(),
    })
    authStore.patchUser(
      result?.user || { username, bio: form.bio.trim(), location: form.location.trim() },
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
          @keydown.esc="dismiss"
        >
          <header class="profile-onboarding-head">
            <span class="profile-onboarding-mark" aria-hidden="true">
              <i class="bi bi-person-check"></i>
            </span>
            <div>
              <p>账号创建成功</p>
              <h2 id="profile-onboarding-title">补充个人资料</h2>
            </div>
            <button type="button" aria-label="稍后完善" title="稍后完善" @click="dismiss">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <form class="profile-onboarding-form" @submit.prevent="save">
            <label>
              <span>昵称</span>
              <input
                ref="usernameInput"
                v-model="form.username"
                maxlength="64"
                autocomplete="nickname"
                placeholder="怎么称呼你"
              />
            </label>
            <label>
              <span>个人简介 <small>选填</small></span>
              <textarea
                v-model="form.bio"
                maxlength="280"
                rows="3"
                placeholder="简单介绍一下自己"
              ></textarea>
            </label>
            <label>
              <span>所在地 <small>选填</small></span>
              <input v-model="form.location" maxlength="80" placeholder="城市或地区" />
            </label>
            <p v-if="error" class="profile-onboarding-error" role="alert">{{ error }}</p>
            <footer>
              <button type="button" class="is-secondary" :disabled="saving" @click="dismiss">
                稍后完善
              </button>
              <button type="submit" class="is-primary" :disabled="saving">
                <i class="bi" :class="saving ? 'bi-arrow-repeat is-spinning' : 'bi-check2'"></i>
                {{ saving ? '保存中…' : '保存资料' }}
              </button>
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
  padding: 20px;
  background: rgba(8, 12, 18, 0.68);
  backdrop-filter: blur(10px);
}

.profile-onboarding-dialog {
  width: min(100%, 460px);
  max-height: calc(100dvh - 40px);
  overflow: auto;
  border: 1px solid rgba(25, 36, 48, 0.12);
  border-radius: 8px;
  color: #17212b;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
}

.profile-onboarding-head {
  display: grid;
  grid-template-columns: 42px 1fr 36px;
  gap: 12px;
  align-items: center;
  padding: 22px 22px 18px;
  border-bottom: 1px solid rgba(25, 36, 48, 0.1);
}

.profile-onboarding-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 50%;
  color: #0f6b50;
  background: #e5f5ee;
  font-size: 19px;
}

.profile-onboarding-head p,
.profile-onboarding-head h2 {
  margin: 0;
}

.profile-onboarding-head p {
  color: #6c7782;
  font-size: 12px;
}

.profile-onboarding-head h2 {
  margin-top: 2px;
  font-size: 19px;
  line-height: 1.3;
}

.profile-onboarding-head > button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: #66717c;
  background: transparent;
  cursor: pointer;
}

.profile-onboarding-head > button:hover {
  color: #17212b;
  background: #f1f4f6;
}

.profile-onboarding-form {
  display: grid;
  gap: 16px;
  padding: 20px 22px 22px;
}

.profile-onboarding-form label {
  display: grid;
  gap: 7px;
}

.profile-onboarding-form label > span {
  font-size: 13px;
  font-weight: 700;
}

.profile-onboarding-form small {
  color: #7b8792;
  font-size: 11px;
  font-weight: 500;
}

.profile-onboarding-form input,
.profile-onboarding-form textarea {
  width: 100%;
  border: 1px solid #d8dfe5;
  border-radius: 6px;
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
  padding: 0 12px;
}

.profile-onboarding-form textarea {
  min-height: 84px;
  padding: 11px 12px;
  resize: vertical;
}

.profile-onboarding-form input:focus,
.profile-onboarding-form textarea:focus {
  border-color: #178362;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(23, 131, 98, 0.12);
}

.profile-onboarding-error {
  margin: -4px 0 0;
  color: #bd3434;
  font-size: 12px;
}

.profile-onboarding-form footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 2px;
}

.profile-onboarding-form footer button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.profile-onboarding-form footer button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.profile-onboarding-form .is-secondary {
  border: 1px solid #d6dde3;
  color: #4f5c67;
  background: #fff;
}

.profile-onboarding-form .is-primary {
  border: 1px solid #146f55;
  color: #fff;
  background: #146f55;
}

:global(.color-scheme-dark) .profile-onboarding-dialog {
  border-color: rgba(255, 255, 255, 0.1);
  color: #edf2f5;
  background: #171b1f;
}

:global(.color-scheme-dark) .profile-onboarding-head {
  border-bottom-color: rgba(255, 255, 255, 0.09);
}

:global(.color-scheme-dark) .profile-onboarding-head p,
:global(.color-scheme-dark) .profile-onboarding-form small {
  color: #9ca8b2;
}

:global(.color-scheme-dark) .profile-onboarding-head > button {
  color: #aeb8c0;
}

:global(.color-scheme-dark) .profile-onboarding-head > button:hover {
  color: #fff;
  background: #252b30;
}

:global(.color-scheme-dark) .profile-onboarding-form input,
:global(.color-scheme-dark) .profile-onboarding-form textarea {
  border-color: #3b444c;
  color: #edf2f5;
  background: #20252a;
}

:global(.color-scheme-dark) .profile-onboarding-form input:focus,
:global(.color-scheme-dark) .profile-onboarding-form textarea:focus {
  border-color: #4cb28f;
  background: #20252a;
}

:global(.color-scheme-dark) .profile-onboarding-form .is-secondary {
  border-color: #3b444c;
  color: #d7dee3;
  background: #20252a;
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
  transform: translateY(12px) scale(0.98);
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
  .profile-onboarding-leave-active .profile-onboarding-dialog {
    transition: none;
  }
}
</style>
