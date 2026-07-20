<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthPageMotion } from './useAuthPageMotion.js'

const route = useRoute()
const appearanceStore = useAppearanceStore()
const pageRef = ref(null)
useAuthPageMotion(pageRef)

const props = defineProps({
  kicker: { type: String, default: '登录' },
  titleMain: { type: String, default: '星空云绘' },
  titleAccent: { type: String, default: 'AI 创作平台' },
  lead: {
    type: String,
    default: '登录后同步你的 AI 创作记录、云端任务进度与共享画廊作品。',
  },
  panelTitle: { type: String, default: '账号登录' },
  panelSubtitle: { type: String, default: '' },
  panelIcon: { type: String, default: '' },
  activeMode: { type: String, default: 'login' },
  showModeNav: { type: Boolean, default: true },
  customPanel: { type: Boolean, default: false },
  /** 漫画分格底图：换成你的图片路径即可，例如 /brand/my-bg.jpg */
  mangaImage: { type: String, default: '/brand/auth-manga-bg.png' },
})

const forwardedQuery = computed(() => route.query)
const mangaImageStyle = computed(() => ({
  '--auth-manga-image': `url("${props.mangaImage}")`,
}))

/** 漫画分格：贴满四边，只在分格之间留细白缝 */
const mangaPanels = [
  'polygon(0 0, 47.5% 0, 0 63%)',
  'polygon(49% 0, 75% 0, 66% 53%, 49% 0)',
  'polygon(76.5% 0, 100% 0, 100% 35%, 68% 53%, 76.5% 0)',
  // 底左 / 底右：分隔缝右上→左下
  'polygon(0 65.5%, 0 100%, 42% 100%, 54% 55%, 0 65.5%)',
  'polygon(56% 55%, 68% 55%, 100% 37%, 100% 100%, 44% 100%)',
]

function authModeQuery(mode) {
  return {
    ...forwardedQuery.value,
    mode,
  }
}
</script>

<template>
  <main
    ref="pageRef"
    class="auth-page is-single"
    :class="{ 'is-dark': appearanceStore.isDark }"
    :style="mangaImageStyle"
  >
    <div class="auth-backdrop" aria-hidden="true">
      <div class="auth-manga">
        <div
          v-for="(panel, index) in mangaPanels"
          :key="index"
          class="auth-manga__panel"
          :style="{ clipPath: panel }"
        ></div>
        <div class="auth-manga__shade"></div>
      </div>
      <div class="auth-split-white"></div>
    </div>

    <header class="auth-topbar">
      <RouterLink data-auth-top to="/" class="auth-brand">
        <img src="/brand/starcloud-logo.svg" alt="" />
        <span>
          <strong>星空云绘</strong>
          <small>StarCloudIsAI</small>
        </span>
      </RouterLink>
      <RouterLink data-auth-top to="/" class="auth-back">
        <i class="bi bi-arrow-left"></i>
        返回首页
      </RouterLink>
    </header>

    <div class="auth-stage">
      <section class="auth-hero" aria-label="账号入口介绍">
        <p data-auth-hero class="auth-hero-brandline">StarCloudIsAI · CREATIVE WORKSPACE</p>
        <p data-auth-hero class="auth-kicker">{{ kicker }}</p>
        <h1 data-auth-hero class="auth-site-name">{{ titleMain }}</h1>
        <p data-auth-hero class="auth-hero-lead">{{ lead }}</p>
        <ul class="auth-hero-features" aria-label="账号职责">
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-stars"></i></span>
            <div class="auth-hero-feature__body">
              <strong>六大创作工作台</strong>
              <p>文生图、插画染色、UI 设计稿、模型图、游戏设计与 AI 拼图</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-cloud-arrow-up"></i></span>
            <div class="auth-hero-feature__body">
              <strong>云端任务</strong>
              <p>任务队列云端执行，历史记录与创作产物跨设备同步</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-images"></i></span>
            <div class="auth-hero-feature__body">
              <strong>共享画廊</strong>
              <p>一键投稿作品到社区画廊，浏览官方精选与分类展墙</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-wallet2"></i></span>
            <div class="auth-hero-feature__body">
              <strong>钱包与套餐</strong>
              <p>按张计费透明可查，充值套餐与兑换码即时入账</p>
            </div>
          </li>
        </ul>
      </section>

      <div class="auth-panel-shell auth-panel-shell--single">
        <div data-auth-card class="auth-panel-motion">
          <slot v-if="customPanel" name="panel" />
          <div v-else class="auth-panel-card">
            <nav v-if="showModeNav" class="auth-route-nav" aria-label="账号操作">
              <RouterLink
                :to="{ name: 'auth', query: authModeQuery('login') }"
                :class="{ 'is-active': activeMode === 'login' }"
              >
                登录
              </RouterLink>
              <RouterLink
                :to="{ name: 'auth', query: authModeQuery('register') }"
                :class="{ 'is-active': activeMode === 'register' }"
              >
                注册
              </RouterLink>
            </nav>
            <div class="auth-panel-head">
              <div v-if="panelIcon" class="auth-panel-head__badge" aria-hidden="true">
                <i :class="panelIcon"></i>
              </div>
              <div class="auth-panel-head__copy">
                <h2>{{ panelTitle }}</h2>
                <p v-if="panelSubtitle">{{ panelSubtitle }}</p>
              </div>
            </div>
            <div v-if="$slots.alerts" class="auth-panel-alerts" aria-live="polite">
              <slot name="alerts" />
            </div>
            <div class="auth-panel-body">
              <slot />
            </div>
            <div v-if="$slots.footer" class="auth-panel-footer">
              <slot name="footer" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
