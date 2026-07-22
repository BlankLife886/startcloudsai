<script setup>
import notificationService from '@/services/notification'
import { computed } from 'vue'
import { useAppearanceStore } from '@/stores/appearance'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const currentYear = new Date().getFullYear()
const appearanceStore = useAppearanceStore()
const runtimeConfigStore = useRuntimeConfigStore()

const footerGroups = [
  {
    title: '创作',
    links: [
      { label: '文生图', to: '/text-to-image' },
      { label: '插画染色', to: '/ai-illustration-coloring' },
      { label: 'UI 设计稿', to: '/design-workshop' },
      { label: '超高清模型图', to: '/model-sheet' },
      { label: '游戏设计', to: '/game-art' },
      { label: 'AI 拼图', to: '/ai-puzzle' },
    ],
  },
  {
    title: '发现',
    links: [
      { label: '共享画廊', to: '/share' },
      { label: '应用空间', to: '/app-space' },
      { label: '更新说明', to: '/updates' },
    ],
  },
  {
    title: '账户',
    links: [
      { label: '价格与套餐', to: '/pricing' },
      { label: '个人中心', to: '/profile' },
    ],
  },
  {
    title: '支持',
    links: [{ label: '问题反馈', action: 'feedback' }],
  },
]

const primaryCta = { label: '浏览社区', to: '/share' }
const secondaryCta = { label: '开始创作', to: '/text-to-image' }

const visibleFooterGroups = computed(() =>
  footerGroups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => {
        if (link.action || link.external) return true
        return isFooterLinkVisible(link)
      }),
    }))
    .filter((group) => group.links.length > 0),
)

const showPrimaryCta = computed(
  () => isFooterLinkVisible(primaryCta) && !isFooterLinkDisabled(primaryCta),
)
const showSecondaryCta = computed(
  () => isFooterLinkVisible(secondaryCta) && !isFooterLinkDisabled(secondaryCta),
)

function isFooterLinkVisible(link) {
  if (runtimeConfigStore.isBlocked) return false
  return runtimeConfigStore.isRouteVisible(link.to)
}

function isFooterLinkDisabled(link) {
  if (link.action || link.external) return false
  return !runtimeConfigStore.isRouteClickable(link.to)
}

function footerDisabledReason(link) {
  return runtimeConfigStore.getRouteDisabledMessage(link.to)
}

function handleDisabledFooterLink(event) {
  event.preventDefault()
  event.stopPropagation()
}

function reportIssue() {
  notificationService.info('感谢反馈，请将问题描述发送到你的项目问题收集渠道。', {
    duration: 2600,
    position: 'top-right',
  })
}

function onLinkClick(link, event) {
  if (link.action === 'feedback') {
    event.preventDefault()
    reportIssue()
    return
  }
  if (isFooterLinkDisabled(link)) {
    handleDisabledFooterLink(event)
  }
}
</script>

<template>
  <footer class="site-footer" :class="{ 'is-dark': appearanceStore.isDark }">
    <div class="footer-shell">
      <div class="footer-top">
        <section class="footer-brand" aria-label="品牌">
          <router-link class="footer-logo" to="/" aria-label="星空云绘首页">
            <img src="/brand/starcloud-logo.svg" alt="" width="40" height="40" />
            <span class="footer-logo__text">
              <strong>星空云绘</strong>
              <small>StarCloudIsAI</small>
            </span>
          </router-link>

          <p class="footer-brand__desc">
            云端创作与视觉收藏平台。从发现壁纸到 AI 生成，把灵感沉淀成你自己的图库。
          </p>

          <div v-if="showPrimaryCta || showSecondaryCta" class="footer-brand__cta">
            <router-link v-if="showPrimaryCta" class="footer-cta is-primary" :to="primaryCta.to">
              {{ primaryCta.label }}
            </router-link>
            <router-link
              v-if="showSecondaryCta"
              class="footer-cta is-secondary"
              :to="secondaryCta.to"
            >
              {{ secondaryCta.label }}
            </router-link>
          </div>
        </section>

        <nav class="footer-columns" aria-label="站点地图">
          <section v-for="group in visibleFooterGroups" :key="group.title" class="footer-col">
            <h2>{{ group.title }}</h2>
            <ul>
              <li v-for="link in group.links" :key="link.label">
                <a v-if="link.external" :href="link.href" target="_blank" rel="noreferrer">
                  {{ link.label }}
                </a>
                <button v-else-if="link.action" type="button" @click="onLinkClick(link, $event)">
                  {{ link.label }}
                </button>
                <router-link
                  v-else
                  :to="link.to"
                  :class="{ disabled: isFooterLinkDisabled(link) }"
                  :aria-disabled="isFooterLinkDisabled(link)"
                  :title="isFooterLinkDisabled(link) ? footerDisabledReason(link) : ''"
                  @click="onLinkClick(link, $event)"
                >
                  {{ link.label }}
                </router-link>
              </li>
            </ul>
          </section>
        </nav>
      </div>

      <div class="footer-bottom">
        <div class="footer-bottom__left">
          <span>© {{ currentYear }} StarCloudIsAI</span>
          <span class="footer-dot" aria-hidden="true"></span>
          <span>All rights reserved</span>
        </div>
        <div class="footer-bottom__right">
          <button type="button" class="footer-text-btn" @click="reportIssue">反馈</button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  --ft-bg: #f7f5ff;
  --ft-ink: #18203b;
  --ft-muted: #79809a;
  --ft-faint: #9aa1b5;
  --ft-line: rgba(21, 26, 45, 0.12);
  --ft-link: #3d455c;
  --ft-link-hover: #6a4fe0;
  --ft-accent: #6a4fe0;
  --ft-accent-soft: rgba(106, 79, 224, 0.12);
  --ft-on-accent: #ffffff;
  --ft-primary-bg: #151a2d;
  --ft-song: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --ft-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --ft-ease: cubic-bezier(0.22, 0.8, 0.24, 1);

  position: relative;
  isolation: isolate;
  overflow: clip;
  border-top: 1px solid var(--ft-line);
  color: var(--ft-ink);
  background:
    radial-gradient(circle at 10% 0%, rgba(133, 104, 247, 0.08), transparent 28%),
    radial-gradient(circle at 90% 100%, rgba(151, 177, 255, 0.07), transparent 30%),
    linear-gradient(180deg, rgba(247, 245, 255, 0.5) 0%, transparent 36%), var(--ft-bg);
}

.site-footer.is-dark {
  --ft-bg: #0d0f18;
  --ft-ink: #eceaf7;
  --ft-muted: #9a96b0;
  --ft-faint: rgba(205, 200, 235, 0.48);
  --ft-line: rgba(255, 255, 255, 0.1);
  --ft-link: rgba(236, 232, 255, 0.78);
  --ft-link-hover: #b4a4ff;
  --ft-accent: #b4a4ff;
  --ft-accent-soft: rgba(181, 163, 255, 0.18);
  --ft-on-accent: #12101c;
  --ft-primary-bg: #eceaf7;
  background:
    radial-gradient(circle at 12% 0%, rgba(106, 79, 224, 0.16), transparent 30%),
    radial-gradient(circle at 88% 100%, rgba(88, 120, 220, 0.1), transparent 32%), var(--ft-bg);
}

.footer-shell {
  position: relative;
  z-index: 1;
  width: min(1540px, 100%);
  margin: 0 auto;
  padding: clamp(48px, 5vw, 72px) clamp(18px, 4vw, 72px) clamp(22px, 3vw, 28px);
}

.footer-top {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: 48px 64px;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--ft-line);
}

.footer-brand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.footer-logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}

.footer-logo img {
  display: block;
  width: 40px;
  height: 40px;
  object-fit: cover;
  border: 0;
  background: transparent;
}

.footer-logo__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.footer-logo__text strong {
  font-family: var(--ft-song);
  font-size: 1.12rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.15;
}

.footer-logo__text small {
  color: var(--ft-muted);
  font-family: var(--ft-mono);
  font-size: 0.62rem;
  font-weight: 650;
  letter-spacing: 0.1em;
}

.footer-brand__desc {
  margin: 0;
  max-width: 32ch;
  color: var(--ft-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

.footer-brand__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 2px;
}

.footer-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 0;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
  transition:
    background 0.18s var(--ft-ease),
    border-color 0.18s var(--ft-ease),
    color 0.18s var(--ft-ease),
    box-shadow 0.18s var(--ft-ease),
    transform 0.18s var(--ft-ease);
}

.footer-cta.is-primary {
  color: var(--ft-on-accent);
  background: var(--ft-primary-bg);
  border: 1px solid transparent;
  box-shadow: 4px 4px 0 var(--ft-accent-soft);
}

.footer-cta.is-primary:hover {
  color: var(--ft-on-accent);
  transform: translate(-1px, -1px);
  box-shadow: 6px 6px 0 var(--ft-accent-soft);
}

.footer-cta.is-secondary {
  color: var(--ft-ink);
  background: transparent;
  border: 1px solid var(--ft-line);
}

.footer-cta.is-secondary:hover {
  color: var(--ft-accent);
  border-color: color-mix(in srgb, var(--ft-accent) 45%, var(--ft-line));
}

.footer-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 28px 24px;
  padding-top: 2px;
}

.footer-col h2 {
  margin: 0 0 16px;
  color: var(--ft-ink);
  font-family: var(--ft-song);
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.footer-col ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.footer-col a,
.footer-col button {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0;
  border: 0;
  color: var(--ft-link);
  background: none;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 520;
  line-height: 1.35;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    color 0.15s var(--ft-ease),
    transform 0.15s var(--ft-ease);
}

.footer-col a:hover,
.footer-col button:hover {
  color: var(--ft-link-hover);
  transform: translateX(2px);
}

.footer-col a.disabled,
.footer-col a.disabled:hover {
  color: var(--ft-faint);
  cursor: not-allowed;
  transform: none;
}

.footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 20px;
  color: var(--ft-faint);
  font-family: var(--ft-mono);
  font-size: 0.7rem;
  font-weight: 560;
  letter-spacing: 0.04em;
  line-height: 1.5;
}

.footer-bottom__left,
.footer-bottom__right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.footer-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.7;
}

.footer-text-btn {
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  transition: color 0.15s var(--ft-ease);
}

.footer-text-btn:hover {
  color: var(--ft-link-hover);
}

@media (max-width: 960px) {
  .footer-top {
    grid-template-columns: 1fr;
    gap: 36px;
    padding-bottom: 36px;
  }

  .footer-brand__desc {
    max-width: 44ch;
  }

  .footer-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px 20px;
  }
}

@media (max-width: 560px) {
  .footer-shell {
    padding: 40px 16px 20px;
  }

  .footer-bottom {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
