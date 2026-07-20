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
  titleAccent: { type: String, default: '壁纸工作台' },
  lead: {
    type: String,
    default: '登录后同步你的搜索偏好、收藏壁纸、下载队列与 AI 创作记录。',
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
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-search"></i></span>
            <div class="auth-hero-feature__body">
              <strong>壁纸搜索</strong>
              <p>保存 Wallhaven 搜索偏好、筛选条件与浏览记录</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-heart"></i></span>
            <div class="auth-hero-feature__body">
              <strong>收藏与合集</strong>
              <p>同步收藏壁纸、收藏夹结构与作者/标签入口</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-download"></i></span>
            <div class="auth-hero-feature__body">
              <strong>下载队列</strong>
              <p>记录批量下载配置、失败任务与处理图下载偏好</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-stars"></i></span>
            <div class="auth-hero-feature__body">
              <strong>AI 创作</strong>
              <p>管理 AI 壁纸、插画上色、图转模型与拼图任务</p>
            </div>
          </li>
          <li data-auth-feature class="auth-hero-feature">
            <span class="auth-hero-feature__icon" aria-hidden="true"><i class="bi bi-key"></i></span>
            <div class="auth-hero-feature__body">
              <strong>资源与 API</strong>
              <p>查看套餐、API Key、模型用量与账号资源</p>
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
