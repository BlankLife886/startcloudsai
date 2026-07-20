<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'
import HomeCelestialCanvas from '@/features/home-motion/components/HomeCelestialCanvas.vue'
import { useHomeMotion } from '@/features/home-motion/composables/useHomeMotion'
import HomeVirtualGrid from './default-home/HomeVirtualGrid.vue'
import { useDefaultHomeData } from './default-home/useDefaultHomeData'
import { useHomeShareFeed } from './default-home/useHomeShareFeed'

const router = useRouter()
const runtimeConfigStore = useRuntimeConfigStore()
const homeRoot = ref(null)
const celestialRef = ref(null)

/* —— 后台可配置的首页模块开关（沿用原 key，community 复用原 video 位） —— */
const homeLayout = computed(() => runtimeConfigStore.getPageLayout('home') || {})
function isHomeModuleVisible(key) {
  return homeLayout.value?.[key]?.enabled !== false
}
const showHeroSection = computed(() => isHomeModuleVisible('hero'))
const showCommunitySection = computed(() => isHomeModuleVisible('video'))
const showMobileSection = computed(() => isHomeModuleVisible('mobile'))
const showDesktopSection = computed(() => isHomeModuleVisible('desktop'))
const showLatestSection = computed(() => isHomeModuleVisible('latest'))
const showRandomSection = computed(() => isHomeModuleVisible('random'))

const {
  mobileTopWallpapers,
  desktopTopWallpapers,
  heroDesktopWallpapers,
  randomSeedWallpapers,
  latestWallpapers,
  favoriteRankWallpapers,
  randomSeed,
  mobileTopTag,
  isLoadingHero,
  isLoadingMobileTop,
  isLoadingDesktopTop,
  isLoadingRandomSeed,
  isLoadingLatest,
  isLoadingFavoriteRank,
  heroError,
  mobileTopError,
  desktopTopError,
  randomSeedError,
  latestError,
  favoriteRankError,
  loadMobileTopWallpapers,
  loadDesktopTopWallpapers,
  loadLatestWallpapers,
  loadFavoriteRankWallpapers,
  loadHeroWallpapers,
  loadRandomSeedWallpapers,
  refreshRandomSeedWallpapers,
  setMobileTopTag,
  homeMobileTags,
  homeQuickSearches,
  homeHeroPlaceholder,
  homeMobileImageQuality,
  homeDesktopImageQuality,
  homeLatestImageQuality,
  homeRandomImageQuality,
  homeVideoImageQuality,
  getHomeImageUrl,
} = useDefaultHomeData({ isSectionEnabled: isHomeModuleVisible })

const {
  shareStats,
  shareFeatured,
  sharePopular,
  shareTrendingTags,
  shareLoading,
  shareError,
  refreshShareOverview,
} = useHomeShareFeed({ enabled: showCommunitySection })

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

/* —— 搜索 —— */
const searchQuery = ref('')

function searchFromInput() {
  const value = searchQuery.value.trim()
  if (!value) {
    router.push({ name: 'search' })
    return
  }
  router.push({
    name: 'search',
    query: { query: value, categories: '111', purity: '100' },
  })
}

function searchFromQuickSearch(item) {
  if (!item) return
  const query = {
    query: item.query || '',
    categories: item.categories || '111',
    purity: item.purity || '100',
    sorting: item.sorting || 'favorites',
  }
  if (item.resolution) query.resolution = item.resolution
  if (item.ratios) query.ratios = item.ratios
  if (item.color) query.color = item.color
  router.push({ name: 'search', query })
}

/* —— 创作工坊：站内核心业务入口（与顶栏 AI 菜单保持一致） —— */
const studioEntries = [
  {
    key: 'text-to-image',
    to: '/text-to-image',
    icon: 'bi-magic',
    title: '文生图',
    tag: 'Text → 4K',
    desc: '以文字为笔，把想象绘成 4K 壁纸与插画，画完即可入馆分享',
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
    key: 'image-to-3d',
    to: '/ai-image-to-3d',
    icon: 'bi-box',
    title: '图转模型',
    tag: 'Image → 3D',
    desc: '一张平面图，长出可转动的立体模型',
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
  {
    key: 'ziwei',
    to: '/ziwei',
    icon: 'bi-stars',
    title: '紫微斗数',
    tag: 'Astrolabe',
    desc: '换个视角，看看自己的星盘',
  },
  {
    key: 'search',
    to: '/search',
    icon: 'bi-search',
    title: '壁纸检索',
    tag: 'Gallery Search',
    desc: '按标签、分辨率与色彩巡馆',
  },
]

/* 工坊卡片配图：从各展墙数据源轮流取画，避开序厅拼贴已用的 5 张 */
const studioArtPool = computed(() => {
  const used = new Set(heroDesktopWallpapers.value.slice(0, 5).map((item) => item.id))
  const feeds = [
    desktopTopWallpapers.value,
    mobileTopWallpapers.value,
    randomSeedWallpapers.value,
    latestWallpapers.value,
    favoriteRankWallpapers.value,
  ]
  const pool = []
  for (let round = 0; round < 6 && pool.length < studioEntries.length; round++) {
    for (const feed of feeds) {
      const item = feed?.[round]
      if (!item || used.has(item.id)) continue
      used.add(item.id)
      pool.push(item)
      if (pool.length >= studioEntries.length) break
    }
  }
  return pool
})
const studioCards = computed(() =>
  studioEntries.map((entry, index) => ({ ...entry, art: studioArtPool.value[index] || null })),
)

/* —— 横屏展墙 tab —— */
const DESK_TABS = [
  { key: 'classic', label: '经典 4K', mono: 'Classic' },
  { key: 'latest', label: '最新入馆', mono: 'Latest' },
  { key: 'rank', label: '收藏榜', mono: 'Loved' },
]
const deskTab = ref('classic')
const deskTabs = computed(() =>
  DESK_TABS.filter((tab) => {
    if (tab.key === 'classic') return showDesktopSection.value
    if (tab.key === 'latest') return showLatestSection.value
    return true
  }),
)
watch(
  deskTabs,
  (tabs) => {
    if (tabs.some((tab) => tab.key === deskTab.value)) return
    deskTab.value = tabs[0]?.key || 'rank'
  },
  { immediate: true },
)
const deskWallpapers = computed(() => {
  if (deskTab.value === 'latest') return latestWallpapers.value
  if (deskTab.value === 'rank') return favoriteRankWallpapers.value
  return desktopTopWallpapers.value
})
const deskLoading = computed(() => {
  if (deskTab.value === 'latest') return isLoadingLatest.value
  if (deskTab.value === 'rank') return isLoadingFavoriteRank.value
  return isLoadingDesktopTop.value
})
const deskError = computed(() => {
  if (deskTab.value === 'latest') return latestError.value
  if (deskTab.value === 'rank') return favoriteRankError.value
  return desktopTopError.value
})
const deskQuality = computed(() => {
  if (deskTab.value === 'latest') return homeLatestImageQuality.value
  if (deskTab.value === 'rank') return homeVideoImageQuality.value
  return homeDesktopImageQuality.value
})

function retryDesk() {
  if (deskTab.value === 'latest') return loadLatestWallpapers(true)
  if (deskTab.value === 'rank') return loadFavoriteRankWallpapers(true)
  return loadDesktopTopWallpapers(true)
}

/* —— 竖屏标签 —— */
const isMobileTagSwitching = ref(false)
async function applyMobileTag(tag) {
  if (mobileTopTag.value === tag && mobileTopWallpapers.value.length) return
  isMobileTagSwitching.value = true
  try {
    await setMobileTopTag(tag)
    await nextTick()
    animateGridRefresh('[data-home-hall="04"]')
  } finally {
    isMobileTagSwitching.value = false
  }
}

/* —— 数据整形 —— */
const heroCollage = computed(() => heroDesktopWallpapers.value.slice(0, 5))
const communityFeatured = computed(() => shareFeatured.value.slice(0, 4))
const communityPopular = computed(() => sharePopular.value.slice(0, 5))
const hasCommunityContent = computed(
  () => communityFeatured.value.length > 0 || communityPopular.value.length > 0,
)

function wallpaperThumb(wallpaper, quality = 'inherit') {
  return getHomeImageUrl(wallpaper, quality)
}

function wallpaperRoute(wallpaper) {
  return { name: 'wallpaper', params: { id: wallpaper.id } }
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

function resolveShareUrl(url = '') {
  return String(url || '').trim()
}

async function refreshRandomWithMotion(event) {
  popButton(event?.currentTarget)
  await refreshRandomSeedWallpapers()
  await nextTick()
  animateGridRefresh('[data-home-hall="06"]')
  scrambleSeed()
}

/* —— 数据到达后的动效补挂 —— */

// 社区画廊等区块在数据到达后才渲染，需要补挂显现观察并刷新滚动触发器
watch([hasCommunityContent, shareLoading, shareError], async () => {
  await nextTick()
  observeNewReveals()
})

watch(shareStats, async (stats) => {
  if (!stats) return
  await nextTick()
  countUpStats()
})

watch(
  () => heroCollage.value.map((item) => item.id).join('|'),
  async (fingerprint) => {
    if (!fingerprint) return
    await nextTick()
    animateNewHeroCells()
  },
)

watch(deskTab, async () => {
  await nextTick()
  animateGridRefresh('[data-home-hall="05"]')
})

// 展墙数据装载会改变页面高度，刷新 ScrollTrigger 位置
watch(
  () => [
    mobileTopWallpapers.value.length,
    deskWallpapers.value.length,
    randomSeedWallpapers.value.length,
  ],
  async () => {
    await nextTick()
    refreshTriggers()
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
            星空云绘是一座云上美术馆：以 AI 为画笔生成壁纸与插画，
            在社区展厅分享创作，也可以随时检索横竖屏馆藏，把星空带回你的屏幕。
          </p>

          <form class="home-search" role="search" @submit.prevent="searchFromInput">
            <i class="bi bi-search" aria-hidden="true"></i>
            <input
              v-model="searchQuery"
              type="search"
              :placeholder="homeHeroPlaceholder"
              aria-label="搜索壁纸"
            />
            <button type="submit">开始巡馆</button>
          </form>

          <div v-if="homeQuickSearches.length" class="home-quick" aria-label="快捷搜索">
            <em>Quick</em>
            <button
              v-for="item in homeQuickSearches"
              :key="item.label"
              type="button"
              @click="searchFromQuickSearch(item)"
            >
              {{ item.label }}
            </button>
          </div>

          <dl v-if="shareStats" class="home-stats">
            <div>
              <dt>Works</dt>
              <dd>{{ compactNumber(shareStats.works) }}</dd>
            </div>
            <div>
              <dt>Creators</dt>
              <dd>{{ compactNumber(shareStats.creators) }}</dd>
            </div>
            <div>
              <dt>Favorites</dt>
              <dd>{{ compactNumber(shareStats.favorites) }}</dd>
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
        <div v-if="isLoadingHero && !heroCollage.length" class="home-hero__collage is-skeleton">
          <span v-for="index in 5" :key="index" class="home-skeleton-block"></span>
        </div>
        <div v-else-if="heroError && !heroCollage.length" class="home-section-error">
          <i class="bi bi-exclamation-circle"></i>
          <strong>{{ heroError }}</strong>
          <button type="button" @click="loadHeroWallpapers(true)">重新加载</button>
        </div>
        <div v-else class="home-hero__collage">
          <router-link
            v-for="(wallpaper, index) in heroCollage"
            :key="wallpaper.id"
            :to="wallpaperRoute(wallpaper)"
            class="home-hero__cell"
            :class="{ 'is-primary': index === 0 }"
          >
            <ShareProgressiveImage
              :src="wallpaperThumb(wallpaper, index === 0 ? 'original' : 'small')"
              :alt="`精选壁纸 ${padIndex(index)}`"
              :eager="index === 0"
            />
            <span class="home-cell-mark">No.{{ padIndex(index) }}</span>
          </router-link>
        </div>
        <p class="home-hero__wall-note">Collection · 今日星幕，每 30 分钟换展</p>
      </div>

      <div class="home-hero__footer" aria-hidden="true">
        <div class="home-hero__edition">
          <em>Vol. 01</em>
          <span>
            Curated by Star Clouds
            <small>AI Art · Wallpaper · Community</small>
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
        <p>从文字到 4K 壁纸，从线稿到成画，再到 3D 模型、UI 设计稿与游戏资产——九间工坊，全天开放。</p>
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
            <ShareProgressiveImage
              :src="wallpaperThumb(studio.art, 'small')"
              alt=""
              :eager="index === 0"
            />
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
          <i></i> 4K WALLPAPER <i></i>
        </span>
      </div>
    </div>

    <!-- Hall 03 · 云端画廊（Share 社区精选） -->
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
        <p>创作者把 AI 作品挂进社区展厅，这里是本周被看见最多的几幅。</p>
        <router-link class="home-hall-head__action" to="/share">进入画廊 →</router-link>
      </header>

      <div
        v-if="shareLoading && !hasCommunityContent"
        class="home-community__loading"
        data-home-reveal
      >
        <span v-for="index in 5" :key="index" class="home-skeleton-block"></span>
      </div>
      <div
        v-else-if="shareError && !hasCommunityContent"
        class="home-section-error"
        data-home-reveal
      >
        <i class="bi bi-cloud-slash"></i>
        <strong>{{ shareError }}</strong>
        <button type="button" @click="refreshShareOverview">重新连接展厅</button>
      </div>
      <div v-else-if="hasCommunityContent" class="home-community__layout">
        <div v-if="communityFeatured.length" class="home-community__featured" data-home-reveal>
          <router-link
            v-for="(item, index) in communityFeatured"
            :key="item.id"
            :to="{ name: 'share', query: { item: item.id } }"
            class="home-community-card"
          >
            <div class="home-community-card__media">
              <ShareProgressiveImage :src="resolveShareUrl(item.resultUrl)" :alt="item.title" />
              <span class="home-cell-mark">Featured {{ padIndex(index) }}</span>
            </div>
            <footer>
              <strong :title="item.title">{{ item.title }}</strong>
              <small>{{ item.authorName || '社区创作者' }}</small>
            </footer>
          </router-link>
        </div>

        <aside v-if="communityPopular.length" class="home-community__rank" data-home-reveal>
          <header>
            <em>Board</em>
            <strong>热门榜</strong>
          </header>
          <ol>
            <li v-for="(item, index) in communityPopular" :key="item.id">
              <router-link :to="{ name: 'share', query: { item: item.id } }">
                <b>{{ padIndex(index) }}</b>
                <ShareProgressiveImage :src="resolveShareUrl(item.resultUrl)" alt="" />
                <span>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.authorName || '社区创作者' }}</small>
                </span>
                <em><i class="bi bi-heart"></i>{{ compactNumber(item.favoriteCount) }}</em>
              </router-link>
            </li>
          </ol>
          <div v-if="shareTrendingTags.length" class="home-community__tags">
            <router-link v-for="row in shareTrendingTags" :key="row.tag" to="/share">
              # {{ row.tag }}
            </router-link>
          </div>
        </aside>
      </div>
    </section>

    <!-- Hall 04 · 竖屏星轨 -->
    <section
      v-if="showMobileSection"
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
        <h2>竖屏星轨</h2>
        <p>为手机屏幕准备的竖幅馆藏，按主题切换展签。</p>
      </header>

      <div v-if="homeMobileTags.length" class="home-wall__tags" data-home-reveal>
        <button
          v-for="tag in homeMobileTags"
          :key="tag.label"
          type="button"
          :class="{ 'is-active': mobileTopTag === tag.query }"
          :disabled="isMobileTagSwitching || isLoadingMobileTop"
          @click="applyMobileTag(tag.query)"
        >
          {{ tag.label }}
        </button>
      </div>

      <div
        v-if="isLoadingMobileTop && !mobileTopWallpapers.length"
        class="home-wall__skeleton is-portrait"
      >
        <span v-for="index in 6" :key="index" class="home-skeleton-block"></span>
      </div>
      <div v-else-if="mobileTopError && !mobileTopWallpapers.length" class="home-section-error">
        <i class="bi bi-exclamation-circle"></i>
        <strong>{{ mobileTopError }}</strong>
        <button type="button" @click="loadMobileTopWallpapers(true)">重新加载</button>
      </div>
      <HomeVirtualGrid
        v-else
        :items="mobileTopWallpapers"
        :min-column-width="170"
        :min-columns="2"
        :gap="14"
        :aspect-ratio="0.5715"
        :meta-height="30"
        :class="{ 'is-switching': isMobileTagSwitching }"
      >
        <template #default="{ item, index }">
          <router-link :to="wallpaperRoute(item)" class="home-work-card is-portrait">
            <div class="home-work-card__media">
              <ShareProgressiveImage
                :src="wallpaperThumb(item, homeMobileImageQuality)"
                :alt="`竖屏壁纸 ${padIndex(index)}`"
              />
            </div>
            <footer>
              <em>{{ item.resolution || 'Portrait' }}</em>
              <span><i class="bi bi-heart"></i>{{ compactNumber(item.favorites) }}</span>
            </footer>
          </router-link>
        </template>
      </HomeVirtualGrid>
    </section>

    <!-- Hall 05 · 横屏星野 -->
    <section
      v-if="showDesktopSection || showLatestSection"
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
        <h2>横屏星野</h2>
        <p>桌面级横幅展墙，从经典 4K 到今日新展。</p>
      </header>

      <div class="home-wall__tabs" data-home-reveal role="tablist" aria-label="横屏展墙分类">
        <button
          v-for="tab in deskTabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="deskTab === tab.key"
          :class="{ 'is-active': deskTab === tab.key }"
          @click="deskTab = tab.key"
        >
          <em>{{ tab.mono }}</em
          >{{ tab.label }}
        </button>
      </div>

      <div v-if="deskLoading && !deskWallpapers.length" class="home-wall__skeleton">
        <span v-for="index in 6" :key="index" class="home-skeleton-block"></span>
      </div>
      <div v-else-if="deskError && !deskWallpapers.length" class="home-section-error">
        <i class="bi bi-exclamation-circle"></i>
        <strong>{{ deskError }}</strong>
        <button type="button" @click="retryDesk">重新加载</button>
      </div>
      <HomeVirtualGrid
        v-else
        :items="deskWallpapers"
        :min-column-width="280"
        :min-columns="2"
        :gap="16"
        :aspect-ratio="1.7778"
        :meta-height="30"
      >
        <template #default="{ item, index }">
          <router-link :to="wallpaperRoute(item)" class="home-work-card">
            <div class="home-work-card__media">
              <ShareProgressiveImage
                :src="wallpaperThumb(item, deskQuality)"
                :alt="`横屏壁纸 ${padIndex(index)}`"
              />
            </div>
            <footer>
              <em>{{ item.resolution || 'Landscape' }}</em>
              <span><i class="bi bi-heart"></i>{{ compactNumber(item.favorites) }}</span>
            </footer>
          </router-link>
        </template>
      </HomeVirtualGrid>
    </section>

    <!-- 大字跑马灯 · 分厅走廊 -->
    <div class="home-marquee" data-reverse="true" aria-hidden="true">
      <div class="home-marquee__track">
        <span v-for="n in 2" :key="n">
          <b>随机星尘</b> STARDUST SEED <i></i> PORTRAIT <i></i> <b>横屏星野</b> LANDSCAPE
          <i></i> COLLECTION <i></i>
        </span>
      </div>
    </div>

    <!-- Hall 06 · 随机星尘 -->
    <section
      v-if="showRandomSection"
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
        <p>用一颗随机种子换一批意外的收获，说不定就有你的下一张壁纸。</p>
        <button
          class="home-hall-head__action"
          type="button"
          :disabled="isLoadingRandomSeed"
          @click="refreshRandomWithMotion"
        >
          <i class="bi bi-shuffle" :class="{ spin: isLoadingRandomSeed }"></i>
          换一批星尘
        </button>
      </header>
      <p class="home-random__seed" data-home-reveal>Seed · {{ randomSeed }}</p>

      <div v-if="isLoadingRandomSeed && !randomSeedWallpapers.length" class="home-wall__skeleton">
        <span v-for="index in 6" :key="index" class="home-skeleton-block"></span>
      </div>
      <div v-else-if="randomSeedError && !randomSeedWallpapers.length" class="home-section-error">
        <i class="bi bi-exclamation-circle"></i>
        <strong>{{ randomSeedError }}</strong>
        <button type="button" @click="loadRandomSeedWallpapers(true)">重新加载</button>
      </div>
      <HomeVirtualGrid
        v-else
        :items="randomSeedWallpapers"
        :min-column-width="240"
        :min-columns="2"
        :gap="16"
        :aspect-ratio="1.5"
        :meta-height="30"
      >
        <template #default="{ item, index }">
          <router-link :to="wallpaperRoute(item)" class="home-work-card">
            <div class="home-work-card__media">
              <ShareProgressiveImage
                :src="wallpaperThumb(item, homeRandomImageQuality)"
                :alt="`随机壁纸 ${padIndex(index)}`"
              />
            </div>
            <footer>
              <em>{{ item.resolution || 'Random' }}</em>
              <span><i class="bi bi-heart"></i>{{ compactNumber(item.favorites) }}</span>
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
