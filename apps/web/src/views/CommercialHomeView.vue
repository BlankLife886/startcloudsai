<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import CardSwapGallery from '@/features/home-commercial/components/CardSwapGallery.vue'
import CapabilityLoop from '@/features/home-commercial/components/CapabilityLoop.vue'
import LaserFlowHero from '@/features/home-commercial/components/LaserFlowHero.vue'
import StrandsBand from '@/features/home-commercial/components/StrandsBand.vue'
import TypeLine from '@/features/home-commercial/components/TypeLine.vue'
import { useCommercialHomeMotion } from '@/features/home-commercial/useCommercialHomeMotion'
import '@/features/home-commercial/commercial-home.css'

const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()
const homeRoot = ref(null)

const studioEntries = [
  {
    to: '/assistant',
    icon: 'bi bi-chat-square-heart',
    index: '01',
    title: 'AI 助手',
    english: 'Assistant',
    description: '连续对话、理解图片，并把创作任务留在同一条上下文里。',
    tone: 'mint',
  },
  {
    to: '/text-to-image',
    icon: 'bi bi-stars',
    index: '02',
    title: '文生图',
    english: 'Text to image',
    description: '选择模型、比例与清晰度，把描述快速变成可交付图像。',
    tone: 'blue',
  },
  {
    to: '/ai-illustration-coloring',
    icon: 'bi bi-brush',
    index: '03',
    title: '插画染色',
    english: 'Coloring',
    description: '保留线稿结构，重建颜色、材质与完整光影。',
    tone: 'coral',
  },
  {
    to: '/design-workshop',
    icon: 'bi bi-bezier2',
    index: '04',
    title: 'UI 设计稿',
    english: 'UI design',
    description: '分析整张设计图，定位元素并衔接素材与前端还原。',
    tone: 'yellow',
  },
  {
    to: '/model-sheet',
    icon: 'bi bi-person-bounding-box',
    index: '05',
    title: '超高清模型图',
    english: 'Model sheet',
    description: '生成清晰、统一的多视角角色与模型参考。',
    tone: 'violet',
  },
  {
    to: '/game-art',
    icon: 'bi bi-controller',
    index: '06',
    title: '游戏设计',
    english: 'Game art',
    description: '从角色、场景、道具到图标，组织完整游戏资产流程。',
    tone: 'green',
  },
]

// 业务素材槽位。用户提供正式图片后只需要补充 cover，不改页面结构。
const productShowcases = studioEntries.map((entry) => ({
  id: entry.to.slice(1),
  index: entry.index,
  to: entry.to,
  icon: entry.icon,
  title: entry.title,
  category: entry.english,
  description: entry.description,
  cover: '',
}))

const capabilityItems = [
  { icon: 'bi bi-cpu', label: '多模型目录', detail: '按任务自由选择' },
  { icon: 'bi bi-lightning-charge', label: '快速生成', detail: '快速模型通道' },
  { icon: 'bi bi-badge-hd', label: '2K / 4K', detail: '高清成品输出' },
  { icon: 'bi bi-aspect-ratio', label: '多种比例', detail: '适配不同场景' },
  { icon: 'bi bi-layers', label: '参考图工作流', detail: '保持视觉一致性' },
  { icon: 'bi bi-broadcast-pin', label: '实时任务通知', detail: '结果逐张返回' },
  { icon: 'bi bi-coin', label: '积分透明计费', detail: '标准价与折扣价' },
]

const narrative =
  '从选择模型、组织提示词和参考图，到实时接收生成结果、继续迭代与高清交付，星空云绘把分散的创作步骤收进一条清晰、可追踪的工作流。'
const narrativeWords = narrative.split(/(\s+|(?<=[，。]))/u).filter(Boolean)
const floatTitle = '一套工作流，覆盖整条创作链'
const floatTitleChars = [...floatTitle]

const availableStudios = computed(() =>
  studioEntries.filter(
    (entry) =>
      runtimeConfigStore.isRouteVisible(entry.to) && runtimeConfigStore.isRouteClickable(entry.to),
  ),
)

const primaryCta = computed(() =>
  authStore.isAuthenticated
    ? { to: '/text-to-image', label: '开始创作' }
    : { to: '/auth', label: '登录开始创作' },
)

const heroArtworks = productShowcases.slice(0, 4)
const showcaseArtworks = productShowcases

useCommercialHomeMotion(homeRoot)

onMounted(() => {
  void runtimeConfigStore.loadRuntimeConfig({ background: true })
})
</script>

<template>
  <div ref="homeRoot" class="commercial-home">
    <section class="commercial-hero" aria-labelledby="commercial-home-title">
      <LaserFlowHero color="#72f7d0" accent="#ffd15c" />
      <div class="commercial-hero__noise" aria-hidden="true"></div>

      <div class="commercial-shell commercial-hero__layout">
        <div class="commercial-hero__copy">
          <p data-commercial-hero="eyebrow" class="commercial-eyebrow">
            <i aria-hidden="true"></i>
            AI IMAGE PRODUCTION SUITE · 2026
          </p>
          <h1 id="commercial-home-title" data-commercial-hero="title">星空云绘</h1>
          <div data-commercial-hero="copy" class="commercial-hero__typed">
            <TypeLine
              :texts="[
                '从一句描述，到可交付图像',
                '让每一次生成都清晰可见',
                '一个工作台，连接完整创作链',
              ]"
            />
          </div>
          <p data-commercial-hero="copy" class="commercial-hero__summary">
            文生图、插画染色、UI 设计稿、模型图与游戏美术，统一在一个可追踪的
            AI 创作工作流中完成。
          </p>

          <div data-commercial-hero="actions" class="commercial-hero__actions">
            <RouterLink class="commercial-button commercial-button--primary" :to="primaryCta.to">
              <span>{{ primaryCta.label }}</span>
              <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
            </RouterLink>
            <RouterLink class="commercial-button commercial-button--ghost" to="/share">
              <i class="bi bi-collection-play" aria-hidden="true"></i>
              <span>浏览真实作品</span>
            </RouterLink>
          </div>

          <dl data-commercial-hero="proof" class="commercial-hero__proof">
            <div>
              <dt>多模型</dt>
              <dd>按任务选择</dd>
            </div>
            <div>
              <dt>2K / 4K</dt>
              <dd>高清输出</dd>
            </div>
            <div>
              <dt>实时</dt>
              <dd>任务通知</dd>
            </div>
          </dl>
        </div>

        <div data-commercial-hero="gallery" class="commercial-hero__gallery">
          <div class="commercial-hero__gallery-label">
            <span>LIVE OUTPUT</span>
            <i></i>
            <small>六大创作工作台</small>
          </div>
          <CardSwapGallery :items="heroArtworks" />
        </div>
      </div>

      <a class="commercial-hero__scroll" href="#creative-workflow" aria-label="继续浏览">
        <span>SCROLL</span>
        <i class="bi bi-arrow-down" aria-hidden="true"></i>
      </a>
    </section>

    <section class="commercial-capabilities" aria-label="平台能力">
      <CapabilityLoop :items="capabilityItems" />
    </section>

    <section id="creative-workflow" class="commercial-intro commercial-band">
      <div class="commercial-shell commercial-intro__layout">
        <div class="commercial-section-mark" data-commercial-reveal>
          <span>01</span>
          <small>ONE WORKFLOW</small>
        </div>
        <div>
          <h2 data-commercial-float class="commercial-float-title" aria-label="一套工作流，覆盖整条创作链">
            <span
              v-for="(char, index) in floatTitleChars"
              :key="`${char}-${index}`"
              data-commercial-float-char
              aria-hidden="true"
            >{{ char === ' ' ? '\u00a0' : char }}</span>
          </h2>
          <p data-commercial-narrative class="commercial-intro__narrative">
            <span
              v-for="(word, index) in narrativeWords"
              :key="`${word}-${index}`"
              data-commercial-word
            >{{ word }}</span>
          </p>
        </div>
      </div>
    </section>

    <section class="commercial-studios commercial-band" aria-labelledby="studios-title">
      <div class="commercial-shell">
        <header class="commercial-section-head" data-commercial-reveal>
          <div>
            <span>02 · CREATIVE STUDIOS</span>
            <h2 id="studios-title">创作，不必切换工具</h2>
          </div>
          <p>从灵感探索到可交付资产，每个工作台共享同一套模型、积分和任务系统。</p>
        </header>

        <div class="commercial-studio-grid">
          <RouterLink
            v-for="entry in availableStudios"
            :key="entry.to"
            :to="entry.to"
            class="commercial-studio"
            :class="`tone-${entry.tone}`"
            data-commercial-reveal
          >
            <span class="commercial-studio__index">{{ entry.index }}</span>
            <i :class="entry.icon" aria-hidden="true"></i>
            <div>
              <small>{{ entry.english }}</small>
              <h3>{{ entry.title }}</h3>
              <p>{{ entry.description }}</p>
            </div>
            <span class="commercial-studio__arrow" aria-hidden="true">
              <i class="bi bi-arrow-up-right"></i>
            </span>
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="commercial-process commercial-band" aria-labelledby="process-title">
      <StrandsBand />
      <div class="commercial-process__shade" aria-hidden="true"></div>
      <div class="commercial-shell commercial-process__content">
        <header class="commercial-process__head" data-commercial-reveal>
          <span>03 · VISIBLE PROCESS</span>
          <h2 id="process-title">每一次生成，都能被看见、继续和交付</h2>
          <p>任务状态、生成结果与版本路径保持连续，不再让等待打断创作。</p>
        </header>

        <ol class="commercial-process__steps">
          <li class="commercial-glass" data-commercial-reveal>
            <span>01</span>
            <i class="bi bi-sliders2" aria-hidden="true"></i>
            <h3>选择模型</h3>
            <p>按页面与任务选择已配置模型、分辨率、比例和输出能力。</p>
          </li>
          <li class="commercial-glass" data-commercial-reveal>
            <span>02</span>
            <i class="bi bi-broadcast" aria-hidden="true"></i>
            <h3>实时执行</h3>
            <p>排队、生成和逐张结果通过实时通道同步到当前页面。</p>
          </li>
          <li class="commercial-glass" data-commercial-reveal>
            <span>03</span>
            <i class="bi bi-box-arrow-down" aria-hidden="true"></i>
            <h3>高清交付</h3>
            <p>保留原图与任务记录，继续迭代或下载 2K、4K 成品。</p>
          </li>
        </ol>
      </div>
    </section>

    <section
      class="commercial-gallery commercial-band"
      data-commercial-gallery-section
      aria-labelledby="showcase-title"
    >
      <div class="commercial-shell">
        <header class="commercial-section-head" data-commercial-reveal>
          <div>
            <span>04 · PRODUCT SCENES</span>
            <h2 id="showcase-title">六个场景，各自保持完整语境</h2>
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
              <span>{{ item.category }}</span>
              <i :class="item.icon"></i>
              <small>SC / {{ item.index }}</small>
            </div>
            <div>
              <span>{{ item.category }}</span>
              <strong>{{ item.title }}</strong>
              <small>打开工作台</small>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="commercial-final commercial-band" aria-labelledby="final-title">
      <div class="commercial-shell commercial-final__layout">
        <div data-commercial-reveal>
          <span>READY WHEN YOU ARE</span>
          <h2 id="final-title">现在，把想法交给星空云绘</h2>
        </div>
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
      <div class="commercial-shell commercial-footer__layout">
        <RouterLink class="commercial-footer__brand" to="/" aria-label="星空云绘首页">
          <img src="/brand/starcloud-logo.svg" alt="" />
          <span><strong>星空云绘</strong><small>StarCloudIsAI</small></span>
        </RouterLink>
        <nav aria-label="页脚导航">
          <RouterLink to="/share">画廊</RouterLink>
          <RouterLink to="/pricing">价格</RouterLink>
          <RouterLink to="/updates">更新</RouterLink>
          <RouterLink to="/app-space">应用空间</RouterLink>
        </nav>
        <small>© 2026 StarCloudIsAI</small>
      </div>
    </footer>
  </div>
</template>
