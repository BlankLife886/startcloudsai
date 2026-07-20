<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAuthStore } from '@/stores/auth'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'
import HomeCelestialCanvas from '@/features/home-motion/components/HomeCelestialCanvas.vue'
import { useHomeMotion } from '@/features/home-motion/composables/useHomeMotion'
import HomeVirtualGrid from './default-home/HomeVirtualGrid.vue'
import {
  randomGallerySeed,
  rotateSlice,
  seededShuffle,
  useHomeGalleryData,
} from './default-home/useHomeGalleryData'

const router = useRouter()
const runtimeConfigStore = useRuntimeConfigStore()
const authStore = useAuthStore()
const homeRoot = ref(null)
const celestialRef = ref(null)

/* —— 后台可配置的首页模块开关（沿用原 key：video=云端画廊，mobile/desktop=展墙） —— */
const homeLayout = computed(() => runtimeConfigStore.getPageLayout('home') || {})
function isHomeModuleVisible(key) {
  return homeLayout.value?.[key]?.enabled !== false
}
const showHeroSection = computed(() => isHomeModuleVisible('hero'))
const showCommunitySection = computed(() => isHomeModuleVisible('video'))
const showMobileSection = computed(() => isHomeModuleVisible('mobile'))
const showDesktopSection = computed(() => isHomeModuleVisible('desktop'))
const showRandomSection = computed(() => isHomeModuleVisible('random'))

/* —— 馆藏数据：全部来自共享画廊 GET /api/gallery —— */
const { galleryItems, galleryStats, isLoading, error, hasMore, reload } = useHomeGalleryData()

/* —— 动效中枢：GSAP ScrollTrigger + anime.js + three.js 星幕 —— */
const {
  observeNewReveals,
  animateNewHeroCells,
  animateGridRefresh,
  refreshTriggers,
  countUpStats,
  scrambleSeed,
  popButton,
} = useHomeMotion(homeRoot, celestialRef)

/* —— 创作工坊：站内六大核心工作台（与顶栏 AI 菜单保持一致） —— */
const studioEntries = [
  {
    key: 'text-to-image',
    to: '/text-to-image',
    icon: 'bi-magic',
    title: '文生图',
    tag: 'Text → Image',
    desc: '以文字为笔，把想象绘成高清图像与插画，画完即可投稿入馆',
  },
  {
    key: 'coloring',
    to: '/ai-illustration-coloring',
    icon: 'bi-brush-fill',
    title: '插画染色',
    tag: 'Lineart Color',
    desc: '上传线稿，AI 注入色彩与光影',
  },
  {
    key: 'ui-design',
    to: '/design-workshop',
    icon: 'bi-bezier2',
    title: 'UI 设计稿',
    tag: 'Product UI',
    desc: '描述产品灵感，产出高保真界面设计稿',
  },
  {
    key: 'model-sheet',
    to: '/model-sheet',
    icon: 'bi-person-bounding-box',
    title: '超高清模型图',
    tag: 'Ultra HD',
    desc: '角色设定与模型图，超高清细节呈现',
  },
  {
    key: 'game-art',
    to: '/game-art',
    icon: 'bi-controller',
    title: '游戏设计',
    tag: 'Game Asset',
    desc: '原画、图标、场景资产一站生成',
  },
  {
    key: 'puzzle',
    to: '/ai-puzzle',
    icon: 'bi-puzzle-fill',
    title: 'AI 拼图',
    tag: 'Puzzle',
    desc: '把喜欢的画面拆成星屑再拼回',
  },
]

/* —— 序厅 —— */
const heroCollage = computed(() => rotateSlice(galleryItems.value, 0, 5))
const primaryCtaTo = computed(() => (authStore.isAuthenticated ? '/text-to-image' : '/auth'))
const primaryCtaLabel = computed(() => (authStore.isAuthenticated ? '开始创作' : '登录开启创作'))
const heroStats = computed(() => ({
  works: galleryStats.value.works,
  creators: galleryStats.value.creators,
  studios: studioEntries.length,
}))
const hasGallery = computed(() => galleryItems.value.length > 0)

/* 工坊卡片配图：从馆藏轮流取画，避开序厅拼贴已用的 5 张 */
const studioCards = computed(() => {
  const art = rotateSlice(galleryItems.value, 5, studioEntries.length)
  return studioEntries.map((entry, index) => ({ ...entry, art: art[index] || null }))
})

/* —— 云端画廊（Hall 03）—— */
const communityFeatured = computed(() => rotateSlice(galleryItems.value, 5, 4))
const communityPopular = computed(() => rotateSlice(galleryItems.value, 9, 5))
const hasCommunityContent = computed(
  () => communityFeatured.value.length > 0 || communityPopular.value.length > 0,
)

/* —— 展墙（Hall 04/05）：无横竖屏元数据，按奇偶切分错开陈列 —— */
const portraitWallItems = computed(() => {
  const items = galleryItems.value
  if (items.length < 8) return items
  return items.filter((_, index) => index % 2 === 0)
})
const landscapeWallItems = computed(() => {
  const items = galleryItems.value
  if (items.length < 8) return items
  return items.filter((_, index) => index % 2 === 1)
})

/* —— 随机星尘（Hall 06）：本地种子洗牌，换种子即换一批 —— */
const randomSeed = ref(randomGallerySeed())
const randomWallItems = computed(() =>
  seededShuffle(galleryItems.value, randomSeed.value).slice(0, 12),
)

async function refreshRandomWithMotion(event) {
  popButton(event?.currentTarget)
  randomSeed.value = randomGallerySeed()
  await nextTick()
  animateGridRefresh('[data-home-hall="06"]')
  scrambleSeed()
}

/* —— 工具 —— */
function galleryRoute(item) {
  return { name: 'share', query: { item: item.id } }
}

function goStudio(studio) {
  router.push(studio.to)
}

function compactNumber(value = 0) {
  const number = Number(value || 0)
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`
  return String(Math.max(0, Math.round(number)))
}

function padIndex(index) {
  return String(index + 1).padStart(2, '0')
}

function shortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/* —— 数据到达后的动效补挂 —— */
// 骨架屏 → 内容 / 错误态切换都会渲染新的 reveal 节点，需要补挂显现观察
watch(
  () => [galleryItems.value.length, isLoading.value, error.value],
  async () => {
    await nextTick()
    observeNewReveals()
    refreshTriggers()
  },
)

watch(
  () => heroCollage.value.map((item) => item.id).join('|'),
  async (fingerprint) => {
    if (!fingerprint) return
    await nextTick()
    animateNewHeroCells()
  },
)

watch(
  () => [isLoading.value, hasGallery.value],
  async ([loading, ready]) => {
    if (loading || !ready) return
    await nextTick()
    countUpStats()
  },
)

onMounted(() => {
  document.documentElement.classList.add('starcloud-home-page')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('starcloud-home-page')
})
</script>

<template>
  <div ref="homeRoot" class="starcloud-home">
    <HomeCelestialCanvas ref="celestialRef" />
    <div class="home-atmosphere" aria-hidden="true"></div>
    <div class="home-orbit" aria-hidden="true">
      <i class="home-orbit__ring is-one"></i>
      <i class="home-orbit__ring is-two"></i>
      <span v-for="index in 7" :key="index" class="home-spark"></span>
    </div>
    <div class="home-godrays" aria-hidden="true">
      <i class="home-godray"></i>
      <i class="home-godray"></i>
      <i class="home-godray"></i>
    </div>
    <div class="home-spotlight" aria-hidden="true"></div>
    <div class="home-vignette" aria-hidden="true"></div>
    <div class="home-grain" aria-hidden="true"></div>
    <div class="home-cursor" aria-hidden="true"><i></i><span></span></div>
    <aside class="home-journey" aria-hidden="true">
      <span class="home-journey__number">01</span>
      <i class="home-journey__rail"><b></b></i>
      <em class="home-journey__name">Prologue</em>
    </aside>

    <!-- Hall 01 · 序厅 -->
    <section
      v-if="showHeroSection"
      class="home-hero"
      data-home-hall="01"
      data-home-hall-name="Prologue"
    >
      <div class="home-hero__masthead" aria-hidden="true">
        <div class="home-hero__masthead-index">
          <b>SC / 01</b>
          <span>云层编号 · 今日星幕</span>
        </div>
        <div class="home-hero__masthead-map">
          <i></i>
          <span>31°13′ N · 121°28′ E</span>
          <i></i>
        </div>
        <div class="home-hero__masthead-live">
          <i></i>
          <span>Collection online</span>
        </div>
      </div>

      <div class="home-shape-grid" aria-hidden="true"></div>

      <div class="home-hero__copy" data-home-reveal>
        <div class="home-spine" aria-hidden="true">
          <span>StarCloud Atlas</span>
          <i></i>
          <em>Vol. 01</em>
        </div>
        <div class="home-hero__body">
          <p class="home-eyebrow">Hall 01 · Prologue</p>
          <h1 class="home-hero__title">
            <span class="home-seal" aria-hidden="true">云绘</span>
            <span class="home-title-line is-first"><span>星空为幕</span></span
            ><br />
            <span class="home-title-line is-second"><span>云上作画</span></span>
          </h1>
          <p class="home-hero__lede">
            星空云绘是一座云上美术馆：以 AI 为画笔生成图像与插画，
            在社区展厅分享创作，也可以随时巡览馆藏，把星空带回你的屏幕。
          </p>

          <div class="home-hero__cta">
            <router-link :to="primaryCtaTo" class="is-primary">
              {{ primaryCtaLabel }}
            </router-link>
            <router-link to="/share">进入画廊巡馆</router-link>
          </div>

          <div class="home-quick" aria-label="创作工坊快捷入口">
            <em>Quick</em>
            <button
              v-for="studio in studioEntries"
              :key="studio.key"
              type="button"
              @click="goStudio(studio)"
            >
              {{ studio.title }}
            </button>
          </div>

          <dl v-if="hasGallery" class="home-stats">
            <div>
              <dt>Works</dt>
              <dd>{{ compactNumber(heroStats.works) }}{{ hasMore ? '+' : '' }}</dd>
            </div>
            <div>
              <dt>Creators</dt>
              <dd>{{ compactNumber(heroStats.creators) }}</dd>
            </div>
            <div>
              <dt>Studios</dt>
              <dd>{{ compactNumber(heroStats.studios) }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div class="home-hero__wall" data-home-reveal>
        <svg
          class="home-constellation"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            class="home-constellation__line"
            pathLength="100"
            d="M3 71 L24 45 L42 56 L66 20 L96 34"
          />
          <path
            class="home-constellation__line is-secondary"
            pathLength="100"
            d="M24 45 L18 13 M42 56 L57 88 M66 20 L83 72"
          />
          <circle class="home-constellation__node" cx="3" cy="71" r="0.75" />
          <circle class="home-constellation__node" cx="24" cy="45" r="1" />
          <circle class="home-constellation__node" cx="42" cy="56" r="0.7" />
          <circle class="home-constellation__node" cx="66" cy="20" r="1.15" />
          <circle class="home-constellation__node" cx="96" cy="34" r="0.7" />
          <circle class="home-constellation__node" cx="57" cy="88" r="0.6" />
          <circle class="home-constellation__node" cx="83" cy="72" r="0.85" />
        </svg>
        <div v-if="isLoading && !heroCollage.length" class="home-hero__collage is-skeleton">
          <span v-for="index in 5" :key="index" class="home-skeleton-block"></span>
        </div>
        <div v-else-if="error && !heroCollage.length" class="home-section-error">
          <i class="bi bi-exclamation-circle"></i>
          <strong>{{ error }}</strong>
          <button type="button" @click="reload">重新加载</button>
        </div>
        <div v-else-if="!heroCollage.length" class="home-section-error">
          <i class="bi bi-images"></i>
          <strong>展墙虚位以待，等你挂上第一幅作品</strong>
          <button type="button" @click="router.push('/text-to-image')">去创作</button>
        </div>
        <div v-else class="home-hero__collage">
          <router-link
            v-for="(item, index) in heroCollage"
            :key="item.id"
            :to="galleryRoute(item)"
            class="home-hero__cell"
            :class="{ 'is-primary': index === 0 }"
          >
            <ShareProgressiveImage :src="item.cover" :alt="item.title" :eager="index === 0" />
            <span class="home-cell-mark">No.{{ padIndex(index) }}</span>
          </router-link>
        </div>
        <p class="home-hero__wall-note">Collection · 社区画廊近期入馆作品</p>
      </div>

      <div class="home-hero__footer" aria-hidden="true">
        <div class="home-hero__edition">
          <em>Vol. 01</em>
          <span>
            Curated by Star Clouds
            <small>AI Art · Gallery · Community</small>
          </span>
        </div>
        <div class="home-hero__scroll"><i></i><span>Scroll to explore</span><b>↓</b></div>
      </div>
    </section>

    <!-- Hall 02 · 创作工坊 -->
    <section
      class="home-hall home-studios"
      data-hall="02"
      data-home-hall="02"
      data-home-hall-name="Studios"
    >
      <header class="home-hall-head" data-home-reveal>
        <div class="home-hall-head__label">
          <em>Hall 02</em>
          <i></i>
          <span>Studios</span>
        </div>
        <h2>创作工坊</h2>
        <p>从文字到高清图像，从线稿到成画，再到 UI 设计稿与游戏资产——六间工坊，全天开放。</p>
      </header>
      <div class="home-studios__grid" data-home-reveal>
        <router-link
          v-for="(studio, index) in studioCards"
          :key="studio.key"
          :to="studio.to"
          class="home-studio-card"
          :class="{ 'is-feature': index === 0 }"
        >
          <span v-if="studio.art" class="home-studio-card__art" aria-hidden="true">
            <ShareProgressiveImage :src="studio.art.cover" alt="" :eager="index === 0" />
          </span>
          <span class="home-studio-card__index">{{ padIndex(index) }}</span>
          <span class="home-studio-card__tag">{{ studio.tag }}</span>
          <span class="home-studio-card__body">
            <i class="bi" :class="studio.icon" aria-hidden="true"></i>
            <strong>{{ studio.title }}</strong>
            <small>{{ studio.desc }}</small>
            <span class="home-studio-card__arrow" aria-hidden="true">进入工坊 →</span>
          </span>
        </router-link>
      </div>
    </section>

    <!-- 大字跑马灯 · 分厅走廊 -->
    <div class="home-marquee" aria-hidden="true">
      <div class="home-marquee__track">
        <span v-for="n in 2" :key="n">
          <b>星空为幕</b> STARCLOUD ATLAS <i></i> AI ART <i></i> <b>云上作画</b> CLOUD GALLERY
          <i></i> COMMUNITY WORKS <i></i>
        </span>
      </div>
    </div>

    <!-- Hall 03 · 云端画廊（社区精选） -->
    <section
      v-if="showCommunitySection"
      class="home-hall home-community"
      data-hall="03"
      data-home-hall="03"
      data-home-hall-name="Gallery"
    >
      <header class="home-hall-head" data-home-reveal>
        <div class="home-hall-head__label">
          <em>Hall 03</em>
          <i></i>
          <span>Gallery</span>
        </div>
        <h2>云端画廊</h2>
        <p>创作者把 AI 作品挂进社区展厅，这里是最近被挂上墙的几幅。</p>
        <router-link class="home-hall-head__action" to="/share">进入画廊 →</router-link>
      </header>

      <div
        v-if="isLoading && !hasCommunityContent"
        class="home-community__loading"
        data-home-reveal
      >
        <span v-for="index in 5" :key="index" class="home-skeleton-block"></span>
      </div>
      <div v-else-if="error && !hasCommunityContent" class="home-section-error" data-home-reveal>
        <i class="bi bi-cloud-slash"></i>
        <strong>{{ error }}</strong>
        <button type="button" @click="reload">重新连接展厅</button>
      </div>
      <div v-else-if="!hasCommunityContent" class="home-section-error" data-home-reveal>
        <i class="bi bi-images"></i>
        <strong>展厅还没有作品，快去创作第一幅吧</strong>
        <button type="button" @click="router.push('/text-to-image')">立即创作</button>
      </div>
      <div v-else class="home-community__layout">
        <div v-if="communityFeatured.length" class="home-community__featured" data-home-reveal>
          <router-link
            v-for="(item, index) in communityFeatured"
            :key="item.id"
            :to="galleryRoute(item)"
            class="home-community-card"
          >
            <div class="home-community-card__media">
              <ShareProgressiveImage :src="item.cover" :alt="item.title" />
              <span class="home-cell-mark">Featured {{ padIndex(index) }}</span>
            </div>
            <footer>
              <strong :title="item.title">{{ item.title }}</strong>
              <small>{{ item.authorName }}</small>
            </footer>
          </router-link>
        </div>

        <aside v-if="communityPopular.length" class="home-community__rank" data-home-reveal>
          <header>
            <em>Board</em>
            <strong>近期入馆</strong>
          </header>
          <ol>
            <li v-for="(item, index) in communityPopular" :key="item.id">
              <router-link :to="galleryRoute(item)">
                <b>{{ padIndex(index) }}</b>
                <ShareProgressiveImage :src="item.cover" alt="" />
                <span>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.authorName }}</small>
                </span>
                <em><i class="bi bi-calendar3"></i>{{ shortDate(item.createdAt) }}</em>
              </router-link>
            </li>
          </ol>
          <div class="home-community__tags">
            <router-link
              v-for="studio in studioEntries.slice(0, 4)"
              :key="studio.key"
              :to="studio.to"
            >
              # {{ studio.title }}
            </router-link>
          </div>
        </aside>
      </div>
    </section>

    <!-- Hall 04 · 竖幅星轨 -->
    <section
      v-if="showMobileSection && (isLoading || portraitWallItems.length)"
      class="home-hall home-wall"
      data-hall="04"
      data-home-hall="04"
      data-home-hall-name="Portrait"
    >
      <header class="home-hall-head" data-home-reveal>
        <div class="home-hall-head__label">
          <em>Hall 04</em>
          <i></i>
          <span>Portrait</span>
        </div>
        <h2>竖幅星轨</h2>
        <p>竖幅陈列的社区馆藏，适合握在手心里细看。</p>
      </header>

      <div v-if="isLoading && !portraitWallItems.length" class="home-wall__skeleton is-portrait">
        <span v-for="index in 6" :key="index" class="home-skeleton-block"></span>
      </div>
      <HomeVirtualGrid
        v-else
        :items="portraitWallItems"
        :min-column-width="170"
        :min-columns="2"
        :gap="14"
        :aspect-ratio="0.5715"
        :meta-height="30"
      >
        <template #default="{ item }">
          <router-link :to="galleryRoute(item)" class="home-work-card is-portrait">
            <div class="home-work-card__media">
              <ShareProgressiveImage :src="item.cover" :alt="item.title" />
            </div>
            <footer>
              <em>{{ shortDate(item.createdAt) || 'Portrait' }}</em>
              <span><i class="bi bi-person-circle"></i>{{ item.authorName }}</span>
            </footer>
          </router-link>
        </template>
      </HomeVirtualGrid>
    </section>

    <!-- Hall 05 · 横幅星野 -->
    <section
      v-if="showDesktopSection && (isLoading || landscapeWallItems.length)"
      class="home-hall home-wall"
      data-hall="05"
      data-home-hall="05"
      data-home-hall-name="Landscape"
    >
      <header class="home-hall-head" data-home-reveal>
        <div class="home-hall-head__label">
          <em>Hall 05</em>
          <i></i>
          <span>Landscape</span>
        </div>
        <h2>横幅星野</h2>
        <p>横幅展墙上的社区新作，铺满整块屏幕的辽阔。</p>
      </header>

      <div v-if="isLoading && !landscapeWallItems.length" class="home-wall__skeleton">
        <span v-for="index in 6" :key="index" class="home-skeleton-block"></span>
      </div>
      <HomeVirtualGrid
        v-else
        :items="landscapeWallItems"
        :min-column-width="280"
        :min-columns="2"
        :gap="16"
        :aspect-ratio="1.7778"
        :meta-height="30"
      >
        <template #default="{ item }">
          <router-link :to="galleryRoute(item)" class="home-work-card">
            <div class="home-work-card__media">
              <ShareProgressiveImage :src="item.cover" :alt="item.title" />
            </div>
            <footer>
              <em>{{ shortDate(item.createdAt) || 'Landscape' }}</em>
              <span><i class="bi bi-person-circle"></i>{{ item.authorName }}</span>
            </footer>
          </router-link>
        </template>
      </HomeVirtualGrid>
    </section>

    <!-- 大字跑马灯 · 分厅走廊 -->
    <div class="home-marquee" data-reverse="true" aria-hidden="true">
      <div class="home-marquee__track">
        <span v-for="n in 2" :key="n">
          <b>随机星尘</b> STARDUST SEED <i></i> PORTRAIT <i></i> <b>横幅星野</b> LANDSCAPE
          <i></i> COLLECTION <i></i>
        </span>
      </div>
    </div>

    <!-- Hall 06 · 随机星尘 -->
    <section
      v-if="showRandomSection && (isLoading || randomWallItems.length)"
      class="home-hall home-wall home-random"
      data-hall="06"
      data-home-hall="06"
      data-home-hall-name="Stardust"
    >
      <header class="home-hall-head" data-home-reveal>
        <div class="home-hall-head__label">
          <em>Hall 06</em>
          <i></i>
          <span>Stardust</span>
        </div>
        <h2>随机星尘</h2>
        <p>用一颗随机种子重洗馆藏，说不定就有让你停下脚步的那一张。</p>
        <button
          class="home-hall-head__action"
          type="button"
          :disabled="isLoading"
          @click="refreshRandomWithMotion"
        >
          <i class="bi bi-shuffle" :class="{ spin: isLoading }"></i>
          换一批星尘
        </button>
      </header>
      <p class="home-random__seed" data-home-reveal>Seed · {{ randomSeed }}</p>

      <div v-if="isLoading && !randomWallItems.length" class="home-wall__skeleton">
        <span v-for="index in 6" :key="index" class="home-skeleton-block"></span>
      </div>
      <HomeVirtualGrid
        v-else
        :items="randomWallItems"
        :min-column-width="240"
        :min-columns="2"
        :gap="16"
        :aspect-ratio="1.5"
        :meta-height="30"
      >
        <template #default="{ item }">
          <router-link :to="galleryRoute(item)" class="home-work-card">
            <div class="home-work-card__media">
              <ShareProgressiveImage :src="item.cover" :alt="item.title" />
            </div>
            <footer>
              <em>{{ shortDate(item.createdAt) || 'Random' }}</em>
              <span><i class="bi bi-person-circle"></i>{{ item.authorName }}</span>
            </footer>
          </router-link>
        </template>
      </HomeVirtualGrid>
    </section>

    <!-- 馆末落款 -->
    <section class="home-outro" data-home-reveal data-home-hall="07" data-home-hall-name="Epilogue">
      <p class="home-outro__mono">StarCloudIsAI · Cloud Painted Sky</p>
      <h2>把星空带回你的屏幕</h2>
      <div class="home-outro__actions">
        <router-link to="/text-to-image" class="is-primary">开始创作</router-link>
        <router-link to="/share">逛逛画廊</router-link>
      </div>
    </section>
  </div>
</template>

<style src="./default-home/home-gallery.css"></style>
<style src="@/features/home-motion/styles/home-motion.css"></style>
