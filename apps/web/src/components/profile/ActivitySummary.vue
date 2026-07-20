<script setup>
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useUserStore } from '@/stores/user'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  limit: {
    type: Number,
    default: 10,
  },
})

const emit = defineEmits(['preview-wallpaper'])

// 获取stores
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const userStore = useUserStore()
const router = useRouter()

// 本地状态
const isLoading = ref(false)
const activeTab = ref('all')

const activityTabs = [
  { id: 'all', label: '全部' },
  { id: 'favorite', label: '收藏' },
  { id: 'view', label: '浏览' },
  { id: 'follow_collection', label: '关注' },
]

const activityTypeMeta = {
  favorite: {
    label: '收藏',
    icon: 'bi-heart-fill',
    tone: 'rose',
  },
  view: {
    label: '浏览',
    icon: 'bi-eye-fill',
    tone: 'sky',
  },
  follow_collection: {
    label: '关注',
    icon: 'bi-bookmark-fill',
    tone: 'mint',
  },
}

// 计算属性 - 所有活动，不受展示条数限制
const rawActivities = computed(() => {
  const activities = []

  // 添加收藏活动
  favoritesStore.favorites.forEach((favorite) => {
    activities.push({
      type: 'favorite',
      item: favorite,
      timestamp: new Date(favorite.favorited_at || Date.now()),
      id: `fav-${favorite.id}`,
    })
  })

  // 添加浏览活动
  historyStore.history.forEach((item) => {
    activities.push({
      type: 'view',
      item: item,
      timestamp: new Date(item.viewed_at || Date.now()),
      id: `view-${item.id}`,
    })
  })

  // 添加关注用户活动
  Object.values(userStore.followedCollections).forEach((collection) => {
    activities.push({
      type: 'follow_collection',
      item: collection,
      timestamp: new Date(collection.followed_at || Date.now()),
      id: `follow-col-${collection.username}`,
    })
  })

  return activities.sort((a, b) => b.timestamp - a.timestamp)
})

// 计算属性 - 展示活动
const allActivities = computed(() => {
  return rawActivities.value.slice(0, props.limit)
})

// 计算属性 - 按类型筛选的活动
const filteredActivities = computed(() => {
  if (activeTab.value === 'all') {
    return allActivities.value
  }

  return allActivities.value.filter((activity) => activity.type === activeTab.value)
})

const activityCounts = computed(() => {
  return rawActivities.value.reduce(
    (acc, activity) => {
      acc.all += 1
      acc[activity.type] = (acc[activity.type] || 0) + 1
      return acc
    },
    { all: 0, favorite: 0, view: 0, follow_collection: 0 },
  )
})

const weeklyActivityBars = computed(() => {
  const dayMs = 24 * 60 * 60 * 1000
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getTime() - (6 - index) * dayMs)
    return {
      key: date.toISOString().slice(0, 10),
      label: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      favorite: 0,
      view: 0,
      follow_collection: 0,
      total: 0,
    }
  })

  const dayMap = new Map(days.map((day) => [day.key, day]))
  rawActivities.value.forEach((activity) => {
    const date = new Date(activity.timestamp)
    date.setHours(0, 0, 0, 0)
    const day = dayMap.get(date.toISOString().slice(0, 10))
    if (!day) return
    day[activity.type] += 1
    day.total += 1
  })

  const max = Math.max(1, ...days.map((day) => day.total))
  return days.map((day) => ({
    ...day,
    height: Math.max(10, Math.round((day.total / max) * 100)),
  }))
})

const favoriteVelocity = computed(() => {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const favoritesThisWeek = rawActivities.value.filter((activity) => {
    return activity.type === 'favorite' && activity.timestamp.getTime() >= weekAgo
  }).length
  const totalThisWeek = rawActivities.value.filter((activity) => {
    return activity.timestamp.getTime() >= weekAgo
  }).length

  return {
    favoritesThisWeek,
    totalThisWeek,
    ratio: totalThisWeek ? Math.round((favoritesThisWeek / totalThisWeek) * 100) : 0,
  }
})

const activityInsightText = computed(() => {
  if (activityCounts.value.all === 0) {
    return '开始浏览和收藏壁纸后，这里会生成你的活动节奏。'
  }
  if (favoriteVelocity.value.ratio >= 50) {
    return `本周收藏占活动的 ${favoriteVelocity.value.ratio}%，最近更偏向沉淀灵感。`
  }
  if (activityCounts.value.view > activityCounts.value.favorite) {
    return '最近浏览量高于收藏量，适合继续扩大灵感样本。'
  }
  return '收藏和浏览节奏比较均衡，图库正在稳定成型。'
})

// 格式化时间
function formatTime(timestamp) {
  const now = new Date()
  const activityTime = new Date(timestamp)
  const diffMs = now - activityTime
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffDay > 30) {
    return activityTime.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } else if (diffDay > 0) {
    return `${diffDay}天前`
  } else if (diffHour > 0) {
    return `${diffHour}小时前`
  } else if (diffMin > 0) {
    return `${diffMin}分钟前`
  } else {
    return '刚刚'
  }
}

// 获取活动图标
function getActivityIcon(type) {
  switch (type) {
    case 'favorite':
      return 'bi-heart-fill text-danger'
    case 'view':
      return 'bi-eye-fill text-primary'
    case 'follow_collection':
      return 'bi-bookmark-fill text-success'
    default:
      return 'bi-activity text-warning'
  }
}

function getActivityMeta(type) {
  return (
    activityTypeMeta[type] || {
      label: '活动',
      icon: 'bi-activity',
      tone: 'gold',
    }
  )
}

// 获取活动描述
function getActivityDescription(activity) {
  if (!activity || !activity.item) {
    return '未知活动'
  }

  switch (activity.type) {
    case 'favorite':
      return activity.item.id ? `收藏了壁纸 ${activity.item.id}` : '收藏了壁纸'
    case 'view':
      return activity.item.id ? `浏览了壁纸 ${activity.item.id}` : '浏览了壁纸'
    case 'follow_collection':
      return activity.item.username
        ? `收藏了用户 ${activity.item.username} 的合集`
        : '收藏了用户合集'
    default:
      return '进行了活动'
  }
}

// 预览壁纸
function previewWallpaper(wallpaper) {
  if (wallpaper) {
    emit('preview-wallpaper', wallpaper)
  } else {
    console.error('尝试预览的壁纸为空')
  }
}

// 导航到壁纸详情页
function navigateToWallpaper(id) {
  if (id) {
    router.push({ name: 'wallpaper', params: { id } })
  } else {
    console.error('尝试导航到的壁纸ID为空')
  }
}

// 导航到用户页面
function navigateToUser(username) {
  if (username) {
    router.push({ name: 'user', params: { username } })
  } else {
    console.error('尝试导航到的用户名为空')
  }
}

// 设置活动标签
function setActivityTab(tab) {
  activeTab.value = tab
}

// 组件挂载时初始化
onMounted(() => {
  const needsInit =
    favoritesStore.favoritesCount === 0 &&
    historyStore.historyCount === 0 &&
    activityCounts.value.follow_collection === 0

  if (!needsInit) return

  isLoading.value = true
  Promise.allSettled([
    favoritesStore.initFavorites(),
    historyStore.initHistory(),
    userStore.initUserData(),
  ]).finally(() => {
    isLoading.value = false
  })
})
</script>

<template>
  <section class="activity-craft" aria-label="活动摘要">
    <header class="activity-craft__head">
      <div class="activity-craft__title-block">
        <span class="activity-craft__kicker">Activity</span>
        <h3 class="activity-craft__title">活动摘要</h3>
      </div>
      <div class="activity-craft__chips" role="tablist" aria-label="活动类型">
        <button
          v-for="tab in activityTabs"
          :key="tab.id"
          type="button"
          class="activity-craft__chip"
          :class="{ 'is-active': activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          @click="setActivityTab(tab.id)"
        >
          {{ tab.label }}
          <em>{{ activityCounts[tab.id] || 0 }}</em>
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="activity-craft__state">
      <span class="activity-craft__spinner" aria-hidden="true"></span>
      <p>加载活动数据…</p>
    </div>

    <template v-else>
      <div class="activity-craft__rhythm">
        <div class="activity-craft__rhythm-copy">
          <span>7 天收藏活动</span>
          <strong>{{ favoriteVelocity.favoritesThisWeek }}</strong>
          <small>{{ activityInsightText }}</small>
        </div>
        <div class="activity-craft__bars" aria-label="最近七天活动">
          <div v-for="day in weeklyActivityBars" :key="day.key" class="activity-craft__day">
            <div class="activity-craft__bar-track">
              <span class="activity-craft__bar-fill" :style="{ height: `${day.height}%` }"></span>
            </div>
            <small>{{ day.label }}</small>
          </div>
        </div>
      </div>

      <div v-if="filteredActivities.length === 0" class="activity-craft__empty">
        <i class="bi bi-calendar-x" aria-hidden="true"></i>
        <p>暂无活动记录</p>
        <small>浏览或收藏壁纸后，这里会留下你的足迹。</small>
        <router-link to="/search" class="activity-craft__cta">去逛逛</router-link>
      </div>

      <ul v-else class="activity-craft__list">
        <li v-for="activity in filteredActivities" :key="activity.id" class="activity-craft__row">
          <button
            v-if="(activity.type === 'favorite' || activity.type === 'view') && activity.item"
            type="button"
            class="activity-craft__thumb"
            @click="previewWallpaper(activity.item)"
          >
            <img
              :src="activity.item.thumbnail || activity.item.thumbs?.small"
              :alt="activity.item.id || '壁纸预览'"
            />
          </button>
          <div
            v-else
            class="activity-craft__thumb activity-craft__thumb--icon"
            :data-tone="getActivityMeta(activity.type).tone"
          >
            <i class="bi" :class="getActivityMeta(activity.type).icon" aria-hidden="true"></i>
          </div>

          <div class="activity-craft__body">
            <span class="activity-craft__meta" :data-tone="getActivityMeta(activity.type).tone">
              <i class="bi" :class="getActivityMeta(activity.type).icon" aria-hidden="true"></i>
              {{ getActivityMeta(activity.type).label }}
            </span>
            <p class="activity-craft__desc">{{ getActivityDescription(activity) }}</p>
            <time class="activity-craft__time">{{ formatTime(activity.timestamp) }}</time>
          </div>

          <div class="activity-craft__actions">
            <button
              v-if="
                (activity.type === 'favorite' || activity.type === 'view') &&
                activity.item &&
                activity.item.id
              "
              type="button"
              class="activity-craft__action"
              title="查看详情"
              @click="navigateToWallpaper(activity.item.id)"
            >
              <i class="bi bi-arrow-right" aria-hidden="true"></i>
            </button>
            <button
              v-if="
                activity.type === 'follow_collection' && activity.item && activity.item.username
              "
              type="button"
              class="activity-craft__action"
              title="查看用户"
              @click="navigateToUser(activity.item.username)"
            >
              <i class="bi bi-person" aria-hidden="true"></i>
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.activity-craft {
  --ac-ink: var(--pf-ink, #151a2d);
  --ac-accent: var(--pf-accent, #6a4fe0);
  --ac-accent-soft: var(--pf-accent-soft, rgba(106, 79, 224, 0.1));
  --ac-line: var(--pf-line, rgba(21, 26, 45, 0.1));
  --ac-line-strong: var(--pf-line-strong, rgba(106, 79, 224, 0.4));
  --ac-card: var(--pf-card, #ffffff);
  --ac-heading: var(--pf-heading, #151a2d);
  --ac-text: var(--pf-text, #3a4258);
  --ac-muted: var(--pf-muted, #79809a);
  --ac-subtle: var(--pf-subtle, #8a91a5);
  --ac-song: var(--pf-song, 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif);
  --ac-mono: var(--pf-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  --ac-stamp: var(--pf-stamp, 4px 4px 0 rgba(106, 79, 224, 0.18));
  --ac-stamp-soft: var(--pf-stamp-soft, 3px 3px 0 rgba(106, 79, 224, 0.12));
  --ac-ease: var(--pf-ease, cubic-bezier(0.22, 0.8, 0.24, 1));

  display: grid;
  gap: 14px;
  padding: 16px;
  background: var(--ac-card);
  color: var(--ac-text);
  box-shadow:
    inset 0 0 0 1px var(--ac-line),
    var(--ac-stamp-soft);
}

.activity-craft__head {
  display: grid;
  gap: 12px;
}

.activity-craft__kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--ac-accent);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.activity-craft__title {
  margin: 0;
  font-family: var(--ac-song);
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ac-heading);
  line-height: 1.2;
}

.activity-craft__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.activity-craft__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ac-muted);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--ac-line);
  transition:
    background 0.16s var(--ac-ease),
    color 0.16s var(--ac-ease),
    box-shadow 0.16s var(--ac-ease),
    transform 0.16s var(--ac-ease);
}

.activity-craft__chip em {
  font-family: var(--ac-mono);
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--ac-subtle);
}

.activity-craft__chip:hover {
  color: var(--ac-heading);
  background: var(--ac-accent-soft);
}

.activity-craft__chip.is-active {
  background: var(--ac-ink);
  color: #fff;
  box-shadow: var(--ac-stamp);
}

.activity-craft__chip.is-active em {
  color: rgba(255, 255, 255, 0.78);
}

html.color-scheme-dark .activity-craft__chip.is-active {
  background: var(--ac-accent);
  color: var(--pf-on-accent, #12101c);
}

html.color-scheme-dark .activity-craft__chip.is-active em {
  color: inherit;
  opacity: 0.8;
}

.activity-craft__rhythm {
  display: grid;
  grid-template-columns: minmax(160px, 0.85fr) minmax(0, 1.15fr);
  gap: 14px;
  padding: 12px;
  background: var(--pf-card-soft, rgba(106, 79, 224, 0.06));
  box-shadow: inset 0 0 0 1px var(--ac-line);
}

.activity-craft__rhythm-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.activity-craft__rhythm-copy > span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ac-accent);
}

.activity-craft__rhythm-copy strong {
  font-family: var(--ac-mono);
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1;
  color: var(--ac-heading);
}

.activity-craft__rhythm-copy small {
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--ac-muted);
}

.activity-craft__bars {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  align-items: end;
}

.activity-craft__day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.activity-craft__bar-track {
  width: 100%;
  height: 52px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
  background: var(--pf-card-mute, rgba(106, 79, 224, 0.035));
  box-shadow: inset 0 0 0 1px var(--ac-line);
}

.activity-craft__bar-fill {
  width: 100%;
  min-height: 4px;
  background: linear-gradient(180deg, var(--pf-accent-bright, #8568f7), var(--ac-accent));
}

.activity-craft__day small {
  font-family: var(--ac-mono);
  font-size: 0.68rem;
  color: var(--ac-subtle);
}

.activity-craft__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.activity-craft__row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ac-line);
  transition:
    background 0.16s var(--ac-ease),
    box-shadow 0.16s var(--ac-ease),
    transform 0.16s var(--ac-ease);
}

.activity-craft__row:hover {
  background: var(--ac-accent-soft);
  transform: translate(-1px, -1px);
  box-shadow:
    inset 0 0 0 1px var(--ac-line-strong),
    var(--ac-stamp-soft);
}

.activity-craft__thumb {
  width: 56px;
  height: 56px;
  padding: 0;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: var(--pf-card-mute, rgba(106, 79, 224, 0.035));
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--ac-line);
}

.activity-craft__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.activity-craft__thumb--icon {
  display: grid;
  place-items: center;
  cursor: default;
  color: var(--ac-accent);
  background: var(--ac-accent-soft);
}

.activity-craft__thumb--icon[data-tone='rose'] {
  color: #e14b6a;
  background: rgba(225, 75, 106, 0.12);
}

.activity-craft__thumb--icon[data-tone='sky'] {
  color: #3d7ee8;
  background: rgba(61, 126, 232, 0.12);
}

.activity-craft__thumb--icon[data-tone='mint'] {
  color: var(--ac-accent);
  background: var(--ac-accent-soft);
}

.activity-craft__body {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.activity-craft__meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ac-accent);
}

.activity-craft__meta[data-tone='rose'] {
  color: #e14b6a;
}

.activity-craft__meta[data-tone='sky'] {
  color: #3d7ee8;
}

.activity-craft__desc {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 650;
  line-height: 1.35;
  color: var(--ac-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-craft__time {
  font-family: var(--ac-mono);
  font-size: 0.72rem;
  color: var(--ac-subtle);
}

.activity-craft__actions {
  display: flex;
  gap: 6px;
}

.activity-craft__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--ac-card);
  color: var(--ac-heading);
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px var(--ac-line),
    2px 2px 0 rgba(106, 79, 224, 0.12);
  transition:
    transform 0.16s var(--ac-ease),
    box-shadow 0.16s var(--ac-ease),
    background 0.16s var(--ac-ease);
}

.activity-craft__action:hover {
  background: var(--ac-accent);
  color: #fff;
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.22);
}

.activity-craft__state,
.activity-craft__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
  color: var(--ac-muted);
  box-shadow: inset 0 0 0 1px var(--ac-line);
}

.activity-craft__state p,
.activity-craft__empty p {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
  color: var(--ac-heading);
}

.activity-craft__empty i {
  font-size: 1.8rem;
  color: var(--ac-accent);
}

.activity-craft__empty small {
  font-size: 0.8rem;
  color: var(--ac-muted);
}

.activity-craft__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  margin-top: 4px;
  padding: 0 14px;
  border: none;
  border-radius: 0;
  background: var(--ac-ink);
  color: #fff;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  text-decoration: none;
  box-shadow: var(--ac-stamp);
  transition:
    transform 0.16s var(--ac-ease),
    background 0.16s var(--ac-ease);
}

.activity-craft__cta:hover {
  transform: translate(-1px, -1px);
  background: var(--ac-accent);
  color: #fff;
}

html.color-scheme-dark .activity-craft__cta {
  background: var(--ac-accent);
  color: var(--pf-on-accent, #12101c);
}

.activity-craft__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--ac-line);
  border-top-color: var(--ac-accent);
  border-radius: 0;
  animation: activity-craft-spin 0.7s linear infinite;
}

@keyframes activity-craft-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .activity-craft__rhythm {
    grid-template-columns: 1fr;
  }

  .activity-craft__row {
    grid-template-columns: 48px minmax(0, 1fr) auto;
    gap: 10px;
  }

  .activity-craft__thumb {
    width: 48px;
    height: 48px;
  }
}
</style>
