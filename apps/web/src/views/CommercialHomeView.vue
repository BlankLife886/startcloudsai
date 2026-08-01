<script setup>
import { computed, onMounted, ref } from 'vue'
import notificationService from '@/services/notification'
import { formatPoints } from '@/services/billingApi'
import { fetchTaskPricing } from '@/services/pricing'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import CardSwapGallery from '@/features/home-commercial/components/CardSwapGallery.vue'
import CapabilityLoop from '@/features/home-commercial/components/CapabilityLoop.vue'
import FlowingMenu from '@/features/home-commercial/components/FlowingMenu.vue'
import GradientBlindsHero from '@/features/home-commercial/components/GradientBlindsHero.vue'
import IntroMediaFlip from '@/features/home-commercial/components/IntroMediaFlip.vue'
import StrandsBand from '@/features/home-commercial/components/StrandsBand.vue'
import StudioStoryboard from '@/features/home-commercial/components/StudioStoryboard.vue'
import TypeLine from '@/features/home-commercial/components/TypeLine.vue'
import { useCommercialHomeMotion } from '@/features/home-commercial/useCommercialHomeMotion'
import '@/features/home-commercial/commercial-home.css'

const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()
const homeRoot = ref(null)
const currentYear = new Date().getFullYear()

const studioEntries = [
  {
    id: 'assistant',
    to: '/assistant',
    icon: 'bi bi-chat-square-heart',
    index: '01',
    title: 'AI 助手',
    english: 'Assistant',
    description: '连续对话、理解图片，并把创作任务留在同一条上下文里。',
    tone: 'mint',
    taskType: null,
    priceHint: '按用量计费',
    cover: '/sucai/ai-wallpaper-server-459defa9-9acc-4f92-8d1b-9a6b8e96fdec-1.webp',
  },
  {
    id: 'text-to-image',
    to: '/text-to-image',
    icon: 'bi bi-stars',
    index: '02',
    title: '文生图',
    english: 'Text to image',
    description: '选择模型、比例与清晰度，把描述快速变成可交付图像。',
    tone: 'blue',
    taskType: 't2i',
    cover: '/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.webp',
  },
  {
    id: 'illustration-coloring',
    to: '/ai-illustration-coloring',
    icon: 'bi bi-brush',
    index: '03',
    title: '插画染色',
    english: 'Coloring',
    description: '保留线稿结构，重建颜色、材质与完整光影。',
    tone: 'coral',
    taskType: 'coloring',
    cover: '/sucai/game-character-1785420185589.webp',
  },
  {
    id: 'ui-design',
    to: '/design-workshop',
    icon: 'bi bi-bezier2',
    index: '04',
    title: 'UI 设计稿',
    english: 'UI design',
    description: '分析整张设计图，定位元素并衔接素材与前端还原。',
    tone: 'yellow',
    taskType: 'ui_design',
    cover: '/sucai/ui-design-1785420316960.webp',
  },
  {
    id: 'model-sheet',
    to: '/model-sheet',
    icon: 'bi bi-person-bounding-box',
    index: '05',
    title: '超高清模型图',
    english: 'Model sheet',
    description: '生成清晰、统一的多视角角色与模型参考。',
    tone: 'violet',
    taskType: 'model_sheet',
    cover: '/sucai/ultra-model-sheet-board-1785420340076.webp',
  },
  {
    id: 'game-art',
    to: '/game-art',
    icon: 'bi bi-controller',
    index: '06',
    title: '游戏设计',
    english: 'Game art',
    description: '从角色、场景、道具到图标，组织完整游戏资产流程。',
    tone: 'green',
    taskType: 'game_art',
    cover: '/sucai/game-ui-1785420083438.webp',
  },
]

const capabilityItems = [
  { icon: 'bi bi-cpu', label: '多模型目录', detail: '按任务自由选择' },
  { icon: 'bi bi-lightning-charge', label: '快速生成', detail: '快速模型通道' },
  { icon: 'bi bi-badge-hd', label: '2K / 4K', detail: '支持高清输出' },
  { icon: 'bi bi-aspect-ratio', label: '多种比例', detail: '适配不同场景' },
  { icon: 'bi bi-layers', label: '参考图工作流', detail: '保持视觉一致性' },
  { icon: 'bi bi-broadcast-pin', label: '任务状态回传', detail: '结果逐张返回' },
  { icon: 'bi bi-coin', label: '积分透明计费', detail: '标准价与折扣价' },
]

const processSteps = [
  {
    index: '01',
    icon: 'bi bi-sliders2',
    title: '选择模型',
    description: '按创作目标选择模型、分辨率、比例和参考图能力。',
    tone: 'mint',
  },
  {
    index: '02',
    icon: 'bi bi-broadcast',
    title: '持续执行',
    description: '排队、生成和逐张结果持续同步到当前页面。',
    tone: 'yellow',
  },
  {
    index: '03',
    icon: 'bi bi-box-arrow-down',
    title: '高清交付',
    description: '保留原图与任务记录，继续迭代或下载高清成品。',
    tone: 'coral',
  },
]

const usageSteps = [
  {
    index: '01',
    icon: 'bi bi-person-check',
    title: '登录账号',
    description: '进入平台后登录，同步积分与创作记录。',
  },
  {
    index: '02',
    icon: 'bi bi-grid-1x2',
    title: '选择工作室',
    description: '按目标打开文生图、染色、UI 或游戏等工作台。',
  },
  {
    index: '03',
    icon: 'bi bi-magic',
    title: '生成交付',
    description: '设置参数并生成，完成后下载或继续迭代。',
  },
]

const narrative =
  '从选择模型、组织提示词和参考图，到持续接收生成结果、继续迭代与高清交付，星空云绘把分散的创作步骤收进一条清晰、可追踪的工作流。'
const narrativeWords = narrative.split(/(\s+|(?<=[，。]))/u).filter(Boolean)
const floatTitle = '一套工作流，覆盖整条创作链'
const floatTitleChars = [...floatTitle]
/** 工作流区右侧配图；可继续往数组里加图，自动翻页切换 */
const introMediaSlides = [
  '/sucai/home-intro-sticker-sheet.png',
  '/sucai/home-intro-02.png',
  '/sucai/home-intro-03.png',
]

const taskPointPrices = ref({})

const availableStudios = computed(() =>
  studioEntries.filter(
    (entry) =>
      runtimeConfigStore.isRouteVisible(entry.to) && runtimeConfigStore.isRouteClickable(entry.to),
  ),
)

function resolveStudioPrice(entry) {
  if (!entry?.taskType) {
    return {
      priceAmount: entry?.priceHint || '按用量计费',
      priceSuffix: '',
    }
  }
  const points = Number(taskPointPrices.value?.[entry.taskType])
  if (!Number.isFinite(points) || points <= 0) {
    return {
      priceAmount: '价格待定',
      priceSuffix: '',
    }
  }
  return {
    priceAmount: formatPoints(points),
    priceSuffix: '/ 张起',
  }
}

const primaryCta = computed(() => {
  if (!authStore.isAuthenticated) return { to: '/auth', label: '登录开始创作' }
  const preferred = availableStudios.value.find((entry) => entry.to === '/text-to-image')
  const destination = preferred || availableStudios.value[0]
  return destination
    ? { to: destination.to, label: '开始创作' }
    : { to: '/share', label: '浏览作品' }
})

const heroArtworks = computed(() => {
  const withCovers = availableStudios.value.filter((entry) => entry.cover)
  return withCovers.length ? withCovers.slice(0, 4) : availableStudios.value.slice(0, 4)
})
const showcaseArtworks = computed(() =>
  availableStudios.value.map((entry) => ({
    ...entry,
    ...resolveStudioPrice(entry),
  })),
)

const flowingMenuItems = computed(() => {
  const fallbacks = [
    '/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.webp',
    '/sucai/ai-wallpaper-server-459defa9-9acc-4f92-8d1b-9a6b8e96fdec-1.webp',
    '/sucai/ui-design-1785420323803.webp',
    '/sucai/game-character-1785420168113.webp',
  ]
  return availableStudios.value.map((entry, index) => ({
    link: entry.to,
    text: entry.title,
    image: entry.cover || fallbacks[index % fallbacks.length],
  }))
})

const footerDiscoverLinks = [
  { label: '社区', to: '/share' },
  { label: '应用空间', to: '/app-space' },
  { label: '更新说明', to: '/updates' },
  { label: '价格与套餐', to: '/pricing' },
]

const footerAccountLinks = [
  { label: '个人中心', to: '/profile' },
  { label: 'AI 助手', to: '/assistant' },
]

const visibleFooterDiscover = computed(() =>
  footerDiscoverLinks.filter((link) => runtimeConfigStore.isRouteVisible(link.to)),
)

const visibleFooterAccount = computed(() =>
  footerAccountLinks.filter((link) => runtimeConfigStore.isRouteVisible(link.to)),
)

function isFooterLinkDisabled(link) {
  return !runtimeConfigStore.isRouteClickable(link.to)
}

function footerDisabledReason(link) {
  return runtimeConfigStore.getRouteDisabledMessage(link.to)
}

function handleFooterLinkClick(link, event) {
  if (isFooterLinkDisabled(link)) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function reportIssue() {
  notificationService.info('感谢反馈，请将问题描述发送到你的项目问题收集渠道。', {
    duration: 2600,
    position: 'top-right',
  })
}

useCommercialHomeMotion(homeRoot)

onMounted(() => {
  void runtimeConfigStore.loadRuntimeConfig({ background: true })
  void fetchTaskPricing()
    .then((pricing) => {
      taskPointPrices.value = pricing?.taskPointPrices || pricing?.taskPrices || {}
    })
    .catch(() => {
      taskPointPrices.value = {}
    })
})
</script>

<template>
  <div ref="homeRoot" class="commercial-home">
    <section class="commercial-hero" aria-labelledby="commercial-home-title">
      <GradientBlindsHero
        :gradient-colors="['#ff003c', '#ff7a00', '#ffd400', '#2aff6a', '#00d4ff', '#3b5bff', '#b347ff']"
        :angle="20"
        :noise="0.5"
        :blind-count="16"
        :blind-min-width="60"
        :spotlight-radius="0.5"
        :distort-amount="0"
        :mouse-dampening="0.15"
        shine-direction="left"
        mix-blend-mode="lighten"
      />
      <div class="commercial-hero__noise" aria-hidden="true"></div>

      <div class="commercial-shell commercial-hero__layout">
        <div class="commercial-hero__copy">
          <h1 id="commercial-home-title" data-commercial-hero="title">星空云绘</h1>
          <div data-commercial-hero="copy" class="commercial-hero__typed">
            <TypeLine
              :start-delay="880"
              accessible-label="从想法到可交付图像的 AI 创作工作流"
              :texts="[
                '从一句描述，到可交付图像',
                '让模型、进度与结果保持连续',
                '一个入口，连接完整创作链',
              ]"
            />
          </div>
          <p data-commercial-hero="copy" class="commercial-hero__summary">
            AI 助手、文生图、插画染色、UI 设计稿、模型图与游戏美术，
            由统一模型目录、任务系统和高清交付链路连接。
          </p>

          <div data-commercial-hero="actions" class="commercial-hero__actions">
            <RouterLink class="commercial-button commercial-button--hero-cta" :to="primaryCta.to">
              <span>{{ primaryCta.label }}</span>
              <span class="commercial-button__arrow" aria-hidden="true">
                <i class="bi bi-arrow-up-right"></i>
              </span>
            </RouterLink>
          </div>

          <dl data-commercial-hero="proof" class="commercial-hero__proof">
            <div><dt>多模型</dt><dd>按任务选择</dd></div>
            <div><dt>2K / 4K</dt><dd>支持高清输出</dd></div>
            <div><dt>持续回传</dt><dd>任务状态可见</dd></div>
          </dl>
        </div>

        <div data-commercial-hero="gallery" class="commercial-hero__gallery">
          <CardSwapGallery
            :items="heroArtworks"
            :width="800"
            :height="450"
            :card-distance="55"
            :vertical-distance="120"
            :delay="3000"
            :skew-amount="0"
            easing="elastic"
            :pause-on-hover="false"
          />
        </div>
      </div>

      <a class="commercial-hero__scroll" href="#creative-workflow" aria-label="继续浏览创作工作流">
        <span>SCROLL</span>
        <i class="bi bi-arrow-down" aria-hidden="true"></i>
      </a>

      <section class="commercial-capabilities" aria-label="平台能力">
        <CapabilityLoop :items="capabilityItems" />
      </section>
    </section>

    <section id="creative-workflow" class="commercial-intro commercial-band">
      <div class="commercial-shell commercial-intro__layout">
        <div class="commercial-intro__copy">
          <h2 data-commercial-float class="commercial-float-title" :aria-label="floatTitle">
            <span
              v-for="(char, index) in floatTitleChars"
              :key="`${char}-${index}`"
              data-commercial-float-char
              aria-hidden="true"
            >{{ char === ' ' ? ' ' : char }}</span>
          </h2>
          <p data-commercial-narrative class="commercial-intro__narrative">
            <span
              v-for="(word, index) in narrativeWords"
              :key="`${word}-${index}`"
              data-commercial-word
            >{{ word }}</span>
          </p>
        </div>

        <div class="commercial-intro__media" data-commercial-reveal>
          <IntroMediaFlip v-if="introMediaSlides.length" :slides="introMediaSlides" />
          <div v-else class="commercial-intro__skeleton" aria-hidden="true"></div>
        </div>
      </div>
    </section>

    <section
      v-if="flowingMenuItems.length"
      id="flowing-menu"
      class="commercial-flowing commercial-band"
      aria-label="创作入口菜单"
    >
      <FlowingMenu
        :items="flowingMenuItems"
        :speed="15"
        text-color="#ffffff"
        bg-color="#111111"
        marquee-bg-color="#ffffff"
        marquee-text-color="#111111"
        border-color="#ffffff"
      />
    </section>

    <section class="commercial-studios commercial-band" aria-label="创作工作台">
      <StudioStoryboard v-if="availableStudios.length" :studios="availableStudios" />
    </section>

    <section class="commercial-process commercial-band" aria-labelledby="process-title">
      <StrandsBand :speed="0.28" />
      <div class="commercial-process__shade" aria-hidden="true"></div>
      <div class="commercial-shell commercial-process__content">
        <header class="commercial-process__head" data-commercial-reveal>
          <h2 id="process-title">每一次生成，都能被看见、继续和交付</h2>
          <p>任务状态、生成结果与版本路径保持连续，不再让等待打断创作。</p>
        </header>

        <ol class="commercial-process__steps">
          <li
            v-for="step in processSteps"
            :key="step.index"
            class="commercial-glass"
            :class="`tone-${step.tone}`"
            data-commercial-reveal
          >
            <span>{{ step.index }}</span>
            <i :class="step.icon" aria-hidden="true"></i>
            <h3>{{ step.title }}</h3>
            <p>{{ step.description }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section
      v-if="showcaseArtworks.length"
      class="commercial-gallery commercial-band"
      data-commercial-gallery-section
      aria-labelledby="showcase-title"
    >
      <div class="commercial-shell">
        <header class="commercial-section-head" data-commercial-reveal>
          <div>
            <h2 id="showcase-title">不同场景，各自保持完整语境</h2>
          </div>
          <p>从交互到最终画面，为不同创作目标保留清晰、独立的视觉语境。</p>
        </header>

        <div data-commercial-parallax="gallery" class="commercial-gallery__grid">
          <RouterLink
            v-for="item in showcaseArtworks"
            :key="item.id"
            :to="item.to"
            class="commercial-artwork"
          >
            <div v-if="item.cover" class="commercial-artwork__media">
              <img :src="item.cover" :alt="item.title" loading="lazy" decoding="async" />
            </div>
            <div v-else class="commercial-artwork__placeholder" aria-hidden="true">
              <span>{{ item.english }}</span>
              <i :class="item.icon"></i>
              <small>SC / {{ item.index }}</small>
            </div>
            <div class="commercial-artwork__meta">
              <span>{{ item.title }}</span>
              <strong>{{ item.priceAmount }}</strong>
              <small>{{ item.priceSuffix || '查看详情' }}</small>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="commercial-final commercial-band" aria-labelledby="final-title">
      <div class="commercial-shell commercial-final__layout">
        <header class="commercial-final__head" data-commercial-reveal>
          <h2 id="final-title">三步开始使用</h2>
          <p>登录、选工作室、生成交付——把想法推进到成品。</p>
        </header>

        <ol class="commercial-final__steps" data-commercial-reveal>
          <li v-for="step in usageSteps" :key="step.index" class="commercial-final__step">
            <span class="commercial-final__step-index" aria-hidden="true">{{ step.index }}</span>
            <div class="commercial-final__step-body">
              <strong>
                <i :class="step.icon" aria-hidden="true"></i>
                {{ step.title }}
              </strong>
              <p>{{ step.description }}</p>
            </div>
          </li>
        </ol>

        <div class="commercial-final__actions" data-commercial-reveal>
          <RouterLink class="commercial-button commercial-button--primary" :to="primaryCta.to">
            <span>{{ primaryCta.label }}</span>
            <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
          </RouterLink>
          <RouterLink class="commercial-button commercial-button--ghost" to="/pricing">
            <span>查看积分价格</span>
            <i class="bi bi-arrow-right" aria-hidden="true"></i>
          </RouterLink>
        </div>
      </div>
    </section>

    <footer class="commercial-footer">
      <div class="commercial-shell">
        <div class="commercial-footer__top">
          <section class="commercial-footer__brand-block" aria-label="品牌">
            <RouterLink class="commercial-footer__brand" to="/" aria-label="星空云绘首页">
              <img src="/brand/starcloud-logo.svg" alt="" width="36" height="36" />
              <span>
                <strong>星空云绘</strong>
                <small>StarCloudIsAI</small>
              </span>
            </RouterLink>
            <p class="commercial-footer__desc">
              一站式 AI 图像生产工作台。从模型选择到高清交付，把创作链路收进同一条可追踪流程。
            </p>
            <RouterLink class="commercial-footer__cta" :to="primaryCta.to">
              <span>{{ primaryCta.label }}</span>
              <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
            </RouterLink>
          </section>

          <nav class="commercial-footer__columns" aria-label="站点地图">
            <section v-if="availableStudios.length" class="commercial-footer__col">
              <h2>创作</h2>
              <ul>
                <li v-for="entry in availableStudios" :key="entry.id">
                  <RouterLink :to="entry.to">{{ entry.title }}</RouterLink>
                </li>
              </ul>
            </section>

            <section v-if="visibleFooterDiscover.length" class="commercial-footer__col">
              <h2>发现</h2>
              <ul>
                <li v-for="link in visibleFooterDiscover" :key="link.to">
                  <RouterLink
                    :to="link.to"
                    :class="{ disabled: isFooterLinkDisabled(link) }"
                    :aria-disabled="isFooterLinkDisabled(link)"
                    :title="isFooterLinkDisabled(link) ? footerDisabledReason(link) : ''"
                    @click="handleFooterLinkClick(link, $event)"
                  >
                    {{ link.label }}
                  </RouterLink>
                </li>
              </ul>
            </section>

            <section class="commercial-footer__col">
              <h2>支持</h2>
              <ul>
                <li v-for="link in visibleFooterAccount" :key="link.to">
                  <RouterLink
                    :to="link.to"
                    :class="{ disabled: isFooterLinkDisabled(link) }"
                    :aria-disabled="isFooterLinkDisabled(link)"
                    :title="isFooterLinkDisabled(link) ? footerDisabledReason(link) : ''"
                    @click="handleFooterLinkClick(link, $event)"
                  >
                    {{ link.label }}
                  </RouterLink>
                </li>
                <li>
                  <button type="button" class="commercial-footer__text-btn" @click="reportIssue">
                    问题反馈
                  </button>
                </li>
              </ul>
            </section>
          </nav>
        </div>

        <div class="commercial-footer__bottom">
          <div class="commercial-footer__legal">
            <span>© {{ currentYear }} StarCloudIsAI</span>
            <span class="commercial-footer__dot" aria-hidden="true"></span>
            <span>All rights reserved</span>
          </div>
          <button type="button" class="commercial-footer__text-btn" @click="reportIssue">
            反馈
          </button>
        </div>
      </div>
    </footer>
  </div>
</template>
