<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { Key, Lock, RefreshRight, User } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import heroImage from '@/assets/login/hero.jpg'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const error = ref('')
const captchaCode = ref('')
const captchaSeed = ref(0)

const form = reactive({ email: '', password: '', verifyCode: '' })

const rules: FormRules = {
  email: [{ required: true, message: '请输入邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  verifyCode: [
    { required: true, message: '请输入图片验证码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (
          String(value || '')
            .trim()
            .toLowerCase() !== captchaCode.value.toLowerCase()
        ) {
          callback(new Error('图片验证码不正确'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
}

const captchaSvg = computed(() => {
  const code = captchaCode.value
  const lines = Array.from({ length: 5 }, (_, index) => {
    const x1 = (captchaSeed.value * (index + 3) * 17) % 118
    const y1 = (captchaSeed.value * (index + 5) * 11) % 40
    const x2 = (x1 + 38 + index * 9) % 120
    const y2 = (y1 + 22 + index * 7) % 42
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(94,184,168,.35)" stroke-width="1"/>`
  }).join('')
  const chars = code
    .split('')
    .map((char, index) => {
      const rotate = ((captchaSeed.value + index * 9) % 18) - 9
      return `<text x="${18 + index * 22}" y="${31 + (index % 2) * 3}" transform="rotate(${rotate} ${18 + index * 22} 28)" fill="#e8f2ef" font-size="22" font-family="Arial, sans-serif" font-weight="700">${char}</text>`
    })
    .join('')

  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="44" viewBox="0 0 132 44">
      <rect width="132" height="44" rx="8" fill="#121820"/>
      ${lines}
      ${chars}
    </svg>`,
  )}`
})

function refreshCaptcha() {
  captchaSeed.value = Math.floor(Math.random() * 100000)
  captchaCode.value = Array.from({ length: 4 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(Math.floor(Math.random() * 32)),
  ).join('')
  form.verifyCode = ''
  formRef.value?.clearValidate('verifyCode')
}

async function onSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().then(
    () => true,
    () => false,
  )
  if (!valid) return
  loading.value = true
  error.value = ''
  try {
    const user = await auth.login(form.email, form.password, { silent: true })
    if (user.role !== 'admin') {
      router.push('/forbidden')
      return
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.push(redirect)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '后台登录失败'
    refreshCaptcha()
  } finally {
    loading.value = false
  }
}

onMounted(refreshCaptcha)
</script>

<template>
  <div class="admin-login-page">
    <div class="login-backdrop" aria-hidden="true">
      <img :src="heroImage" alt="" class="hero-photo" />
      <div class="hero-scrim" />
    </div>

    <div class="hero-marks" aria-hidden="true">
      <article class="hero-plate hero-plate--nw">
        <p class="plate-glyph plate-glyph--latin">星</p>
        <div class="plate-footnote plate-footnote--nw">
          <p class="plate-lead">StarCloudsAI</p>
          <span class="plate-rule" />
          <p class="plate-meta">星空云绘 · Admin</p>
        </div>
      </article>

      <article class="hero-plate hero-plate--se">
        <p class="plate-glyph">绘</p>
        <div class="plate-footnote plate-footnote--se">
          <span class="plate-rule" />
          <p class="plate-lead">每一张图，都值得被认真对待</p>
        </div>
      </article>
    </div>

    <section class="login-panel">
      <div class="panel-inner">
        <header class="panel-heading">
          <p class="panel-kicker">管理员入口</p>
          <h2>登录后台</h2>
          <p>使用管理员账号继续。</p>
        </header>

        <el-alert
          v-if="error"
          class="login-alert"
          type="error"
          :title="error"
          show-icon
          closable
          @close="error = ''"
        />

        <el-form
          ref="formRef"
          class="login-form"
          :model="form"
          :rules="rules"
          label-position="top"
          @submit.prevent="onSubmit"
        >
          <el-form-item label="邮箱" prop="email">
            <el-input
              v-model="form.email"
              autofocus
              autocomplete="username"
              :prefix-icon="User"
              placeholder="管理员邮箱"
              @keyup.enter="onSubmit"
            />
          </el-form-item>

          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              autocomplete="current-password"
              :prefix-icon="Lock"
              placeholder="请输入密码"
              @keyup.enter="onSubmit"
            />
          </el-form-item>

          <el-form-item label="图片验证码" prop="verifyCode">
            <div class="captcha-row">
              <el-input
                v-model="form.verifyCode"
                autocomplete="off"
                :prefix-icon="Key"
                placeholder="请输入验证码"
                @keyup.enter="onSubmit"
              />
              <button
                class="captcha-image"
                type="button"
                title="点击刷新验证码"
                aria-label="刷新图片验证码"
                @click="refreshCaptcha"
              >
                <img :src="captchaSvg" alt="图片验证码" />
                <el-icon><RefreshRight /></el-icon>
              </button>
            </div>
          </el-form-item>

          <el-button
            class="login-button"
            type="primary"
            size="large"
            native-type="submit"
            :loading="loading"
            @click="onSubmit"
          >
            {{ loading ? '登录中…' : '进入控制台' }}
          </el-button>
        </el-form>

        <p class="login-terms">
          登录即表示你同意 <a href="javascript:void(0)">服务条款</a> 与
          <a href="javascript:void(0)">隐私政策</a>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Syne:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

.admin-login-page {
  --ink: #ffffff;
  --muted: rgba(236, 244, 240, 0.9);
  --dim: rgba(214, 226, 220, 0.78);
  --line: rgba(255, 255, 255, 0.22);
  --field: rgba(6, 10, 14, 0.42);
  --accent: #6ed9c6;
  --accent-deep: #2f7f74;
  --gold: #e2c98f;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --display: 'Syne', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  --serif: 'Cormorant Garamond', 'Songti SC', 'Noto Serif SC', serif;
  --sans: 'IBM Plex Sans', 'PingFang SC', 'Hiragino Sans GB', sans-serif;

  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--sans);
  background: #0a0e12;
}

.login-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.hero-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.hero-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(8, 12, 18, 0.1) 0%,
    rgba(8, 12, 18, 0.04) 48%,
    rgba(8, 12, 18, 0.28) 72%,
    rgba(8, 12, 18, 0.48) 100%
  );
}

.hero-marks {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.hero-plate {
  position: absolute;
  animation: login-mark-in 0.85s var(--ease) both;
}

.hero-plate--nw {
  top: clamp(12px, 3vh, 28px);
  left: clamp(14px, 2.4vw, 32px);
  width: min(42%, 360px);
  animation-delay: 0.1s;
}

.hero-plate--se {
  left: clamp(24px, 4vw, 56px);
  bottom: clamp(24px, 5vh, 48px);
  width: max-content;
  max-width: min(58%, 520px);
  text-align: left;
  animation-delay: 0.24s;
}

.plate-glyph {
  margin: 0;
  color: rgba(247, 243, 234, 0.13);
  font-family: 'Songti SC', 'Noto Serif SC', var(--serif);
  font-size: clamp(128px, 18vw, 200px);
  font-weight: 600;
  line-height: 0.76;
  letter-spacing: 0.02em;
  user-select: none;
}

.plate-glyph--latin {
  color: rgba(214, 191, 138, 0.18);
  font-family: var(--serif);
  font-size: clamp(140px, 20vw, 220px);
  font-style: italic;
  font-weight: 500;
  letter-spacing: -0.06em;
  line-height: 0.72;
}

.plate-footnote {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plate-footnote--nw {
  margin-top: -28px;
  margin-left: 10px;
  align-items: flex-start;
}

.plate-footnote--se {
  margin-top: -22px;
  align-items: flex-start;
}

.plate-lead {
  margin: 0;
  color: #fff;
  font-family: var(--serif);
  font-size: clamp(20px, 1.9vw, 26px);
  font-weight: 500;
  font-style: italic;
  line-height: 1.2;
  white-space: nowrap;
}

.hero-plate--nw .plate-lead {
  font-family: var(--display);
  font-size: clamp(26px, 2.6vw, 34px);
  font-style: normal;
  font-weight: 740;
  letter-spacing: -0.035em;
}

.plate-rule {
  display: block;
  width: 44px;
  height: 1px;
  background: rgba(226, 201, 143, 0.85);
}

.hero-plate--se .plate-rule {
  width: 56px;
}

.plate-meta {
  margin: 0;
  color: rgba(247, 243, 234, 0.82);
  font-family: var(--serif);
  font-size: 13px;
  font-style: italic;
  letter-spacing: 0.12em;
  white-space: nowrap;
}

.login-panel {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 100vh;
  padding: 40px clamp(24px, 4vw, 56px);
  background: transparent;
}

.panel-inner {
  width: min(100%, 392px);
  padding: 28px 26px 22px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 20px;
  background: rgba(8, 12, 16, 0.52);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  -webkit-backdrop-filter: blur(28px) saturate(1.35);
  backdrop-filter: blur(28px) saturate(1.35);
  animation: login-panel-in 0.55s var(--ease) both;
}

.panel-heading {
  margin-bottom: 28px;
}

.panel-heading .panel-kicker {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.panel-heading h2 {
  margin: 0;
  color: #fff;
  font-family: var(--display);
  font-size: clamp(30px, 2.8vw, 38px);
  font-weight: 740;
  line-height: 1.15;
  letter-spacing: -0.03em;
}

.panel-heading p {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.6;
}

.login-alert {
  margin-bottom: 16px;
}

.captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 124px;
  gap: 8px;
  width: 100%;
}

.captcha-image {
  position: relative;
  display: grid;
  place-items: center;
  width: 124px;
  height: 48px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(10, 15, 21, 0.82);
  cursor: pointer;
  transition:
    border-color 0.18s var(--ease),
    box-shadow 0.18s var(--ease),
    transform 0.18s var(--ease);
}

.captcha-image:hover {
  transform: translateY(-1px);
  border-color: rgba(110, 217, 198, 0.66);
  box-shadow: 0 0 0 3px rgba(110, 217, 198, 0.08);
}

.captcha-image:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(110, 217, 198, 0.16);
}

.captcha-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.captcha-image .el-icon {
  position: absolute;
  top: 50%;
  right: 8px;
  color: rgba(232, 242, 239, 0.55);
  transform: translateY(-50%);
  font-size: 14px;
}

.login-button {
  width: 100%;
  height: 50px;
  margin-top: 9px;
  border: 0;
  border-radius: 8px;
  color: #071210;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: var(--accent);
  box-shadow: 0 12px 28px rgba(94, 184, 168, 0.18);
  transition:
    transform 0.18s var(--ease),
    box-shadow 0.18s var(--ease),
    filter 0.18s var(--ease);
}

.login-button:hover {
  transform: translateY(-1px);
  filter: brightness(1.05);
  box-shadow: 0 14px 32px rgba(94, 184, 168, 0.24);
}

.login-terms {
  margin: 22px 0 0;
  color: var(--dim);
  font-size: 12px;
  line-height: 1.7;
  text-align: center;
}

.login-terms a {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.login-terms a:hover {
  text-decoration: underline;
}

:deep(.el-form-item) {
  margin-bottom: 19px;
}

:deep(.el-form-item__label) {
  margin-bottom: 8px !important;
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.3;
}

:deep(.el-input__wrapper) {
  min-height: 48px;
  padding: 0 13px;
  border-radius: 8px;
  background: rgba(8, 13, 19, 0.68);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.2),
    0 6px 18px rgba(0, 0, 0, 0.08);
  transition:
    box-shadow 0.18s var(--ease),
    background 0.18s var(--ease);
}

:deep(.el-input__wrapper:hover),
:deep(.el-input__wrapper.is-focus) {
  background: rgba(7, 12, 18, 0.82);
  box-shadow:
    inset 0 0 0 1px rgba(110, 217, 198, 0.78),
    0 0 0 3px rgba(110, 217, 198, 0.09);
}

:deep(.el-input__inner) {
  color: #fff;
  font-weight: 560;
}

:deep(.el-input__inner::placeholder) {
  color: rgba(220, 232, 226, 0.58);
}

:deep(.el-input__prefix),
:deep(.el-input__suffix) {
  color: rgba(236, 244, 240, 0.78);
}

:deep(.el-input__suffix .el-icon) {
  color: rgba(236, 244, 240, 0.78);
}

:deep(.el-form-item__error) {
  padding-top: 4px;
  color: #ff8f8f;
  font-weight: 560;
}

@keyframes login-mark-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes login-panel-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-plate,
  .panel-inner {
    animation: none;
  }
}

@media (max-width: 980px) {
  .hero-plate--nw {
    top: 8px;
    left: 10px;
    width: min(58%, 240px);
  }

  .hero-plate--se {
    left: 12px;
    bottom: auto;
    top: 42%;
    width: max-content;
    max-width: calc(100% - 24px);
  }

  .plate-glyph,
  .plate-glyph--latin {
    font-size: 96px;
  }

  .plate-lead {
    font-size: 16px;
  }

  .hero-plate--nw .plate-lead {
    font-size: 22px;
  }

  .plate-footnote--nw {
    margin-top: -18px;
  }

  .plate-footnote--se {
    margin-top: -14px;
  }

  .login-panel {
    align-items: flex-end;
    justify-content: center;
    min-height: 100vh;
    padding: 24px 16px 28px;
  }

  .panel-inner {
    width: min(100%, 400px);
  }
}

@media (max-width: 480px) {
  .hero-plate--se {
    display: none;
  }

  .captcha-row {
    grid-template-columns: 1fr;
  }

  .captcha-image {
    width: 100%;
  }
}
</style>
