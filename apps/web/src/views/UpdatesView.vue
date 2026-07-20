<script setup>
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  CHANGELOG,
  CHANGELOG_TAG_FILTERS,
  getChangelogTagMeta,
} from '@/config/changelog'
import { useUpdatesPageMotion } from '@/features/updates/composables/useUpdatesPageMotion'
import { fetchRuntimeAnnouncements } from '@/services/announcements'
import { useAppearanceStore } from '@/stores/appearance'
import '@/features/updates/styles/updates-page.css'

const appearanceStore = useAppearanceStore()
const pageRoot = ref(null)
const timelineRef = ref(null)
const pageReady = ref(false)
const announcementsLoading = ref(false)
const announcements = ref([])
const activeTag = ref('all')

const timeline = computed(() => {
  const fromAnnouncements = announcements.value
    .filter((item) => item?.title)
    .map((item) => ({
      id: `ann-${item.id}`,
      version: item.version ? `v${item.version}` : '公告',
      date: item.startsAt || item.createdAt || '',
      tag: 'announce',
      title: item.title,
      summary: stripHtml(item.content || ''),
      items: [],
      highlight: Number(item.priority || 0) >= 80,
    }))

  const merged = [...fromAnnouncements, ...CHANGELOG]
  return merged.sort((a, b) => getTime(b.date) - getTime(a.date))
})

const filteredTimeline = computed(() => {
  if (activeTag.value === 'all') return timeline.value
  return timeline.value.filter((entry) => entry.tag === activeTag.value)
})

/** 重点条目优先；否则取筛选后的首条，保证顶区始终有展陈感 */
const featuredEntry = computed(() => {
  const list = filteredTimeline.value
  if (!list.length) return null
  return list.find((entry) => entry.highlight) || list[0]
})

const listEntries = computed(() => {
  if (!featuredEntry.value) return filteredTimeline.value
  return filteredTimeline.value.filter((entry) => entry.id !== featuredEntry.value.id)
})

const groupedEntries = computed(() => {
  const groups = []
  let currentKey = ''

  listEntries.value.forEach((entry) => {
    const key = monthKey(entry.date)
    if (key !== currentKey) {
      currentKey = key
      groups.push({ key, label: formatMonthLabel(entry.date), entries: [] })
    }
    groups[groups.length - 1].entries.push(entry)
  })

  return groups
})

const stats = computed(() => ({
  total: CHANGELOG.length,
  features: CHANGELOG.filter((item) => item.tag === 'feature').length,
  experience: CHANGELOG.filter((item) => item.tag === 'experience').length,
  latest: CHANGELOG.find((item) => item.highlight)?.version || CHANGELOG[0]?.version || '-',
}))

const recentVersions = computed(() => {
  const seen = new Set()
  const rows = []
  for (const entry of timeline.value) {
    const version = String(entry.version || '').trim()
    if (!version || seen.has(version)) continue
    seen.add(version)
    rows.push({
      version,
      title: entry.title,
      date: entry.date,
      tag: entry.tag,
    })
    if (rows.length >= 3) break
  }
  return rows
})

const tagFilters = CHANGELOG_TAG_FILTERS
const filterKey = computed(() => activeTag.value)

useUpdatesPageMotion({
  pageRef: pageRoot,
  timelineRef,
  ready: pageReady,
  filterKey,
})

onBeforeMount(() => {
  document.documentElement.classList.add('updates-gallery-page')
  appearanceStore.applyToDocument()
})

onMounted(async () => {
  void loadAnnouncements()
  await nextTick()
  pageReady.value = true
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('updates-gallery-page')
})

async function loadAnnouncements() {
  announcementsLoading.value = true
  try {
    announcements.value = await fetchRuntimeAnnouncements()
  } catch {
    announcements.value = []
  } finally {
    announcementsLoading.value = false
  }
}

function getTime(value) {
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function monthKey(value) {
  const date = new Date(value || 0)
  if (!Number.isFinite(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}`
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
    : value
}

function formatMonthLabel(value) {
  if (!value) return '更早的更新'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '更早的更新'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
}

function tagMeta(tag) {
  return getChangelogTagMeta(tag)
}

function setTagFilter(id) {
  activeTag.value = id
}

function scrollToTimeline() {
  timelineRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <main
    ref="pageRoot"
    class="updates-page"
    :class="{ 'is-scheme-dark': appearanceStore.isDark, 'is-ready': pageReady }"
  >
    <div class="updates-atmosphere" aria-hidden="true">
      <span class="updates-atmosphere__orb updates-atmosphere__orb--a"></span>
      <span class="updates-atmosphere__orb updates-atmosphere__orb--b"></span>
      <span class="updates-atmosphere__grid"></span>
    </div>

    <section class="updates-intro">
      <div class="updates-copy" data-updates-motion>
        <div class="updates-copy__spine" aria-hidden="true">
          <span>StarCloud</span>
          <i></i>
          <em>Vol.Notes</em>
        </div>
        <div class="updates-copy__body">
          <span class="updates-copy__eyebrow">StarCloudIsAI · Updates</span>
          <h1>
            <span class="updates-copy__title">更新说明</span>
            <span class="updates-copy__seal" aria-hidden="true">更</span>
          </h1>
          <p class="updates-copy__lead">
            每一版可见的变化，都在这里立档。新功能、体验打磨与平台公告，按时间展陈。
          </p>
          <div class="updates-copy__meta" aria-label="更新统计">
            <div>
              <strong>{{ stats.total }}</strong>
              <span>版本记录</span>
            </div>
            <div>
              <strong>{{ stats.features }}</strong>
              <span>新功能</span>
            </div>
            <div>
              <strong>{{ stats.experience }}</strong>
              <span>体验</span>
            </div>
            <div>
              <strong>{{ stats.latest }}</strong>
              <span>最新</span>
            </div>
          </div>
          <div class="updates-copy__actions">
            <div class="updates-filter" role="tablist" aria-label="按类型筛选">
              <button
                v-for="filter in tagFilters"
                :key="filter.id"
                type="button"
                role="tab"
                class="updates-filter__btn"
                :class="{ active: activeTag === filter.id }"
                :aria-selected="activeTag === filter.id"
                @click="setTagFilter(filter.id)"
              >
                {{ filter.label }}
              </button>
            </div>
            <button type="button" class="updates-copy__cta" @click="scrollToTimeline">
              浏览时间线
              <i class="bi bi-arrow-down" aria-hidden="true"></i>
            </button>
          </div>
          <span v-if="announcementsLoading" class="updates-hint" aria-live="polite">
            <span class="updates-hint-dot" aria-hidden="true"></span>
            同步公告中
          </span>
        </div>
      </div>

      <aside class="updates-catalogue" data-updates-motion aria-label="近期版本">
        <div class="updates-catalogue__head">
          <span class="updates-catalogue__kicker">Catalogue</span>
          <strong>近期版本</strong>
        </div>
        <ol class="updates-catalogue__list">
          <li v-for="(row, index) in recentVersions" :key="row.version">
            <span class="updates-catalogue__index">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="updates-catalogue__main">
              <div class="updates-catalogue__row">
                <span class="updates-catalogue__version">{{ row.version }}</span>
                <span class="updates-tag" :class="tagMeta(row.tag).className">
                  {{ tagMeta(row.tag).label }}
                </span>
              </div>
              <p>{{ row.title }}</p>
              <time>{{ formatDate(row.date) }}</time>
            </div>
          </li>
        </ol>
      </aside>
    </section>

    <div class="updates-shell">
      <div v-if="!filteredTimeline.length" class="updates-empty" data-updates-motion>
        <p>暂无更新记录</p>
      </div>

      <div v-else ref="timelineRef" class="updates-feed">
        <article v-if="featuredEntry" class="updates-spotlight" data-updates-motion>
          <div class="updates-spotlight__watermark" aria-hidden="true">
            {{ featuredEntry.version }}
          </div>
          <div class="updates-spotlight__rail" aria-hidden="true"></div>
          <div class="updates-spotlight__body">
            <div class="updates-spotlight__head">
              <div class="updates-spotlight__meta">
                <span class="updates-spotlight__badge">本期焦点</span>
                <span class="updates-spotlight__version">{{ featuredEntry.version }}</span>
                <span class="updates-tag" :class="tagMeta(featuredEntry.tag).className">
                  {{ tagMeta(featuredEntry.tag).label }}
                </span>
              </div>
              <time class="updates-date">{{ formatDate(featuredEntry.date) }}</time>
            </div>
            <h2>{{ featuredEntry.title }}</h2>
            <p v-if="featuredEntry.summary">{{ featuredEntry.summary }}</p>
            <ul v-if="featuredEntry.items?.length" class="updates-items updates-items--featured">
              <li v-for="item in featuredEntry.items" :key="item">{{ item }}</li>
            </ul>
          </div>
        </article>

        <div class="updates-timeline">
          <section v-for="group in groupedEntries" :key="group.key" class="updates-month-group">
            <div class="updates-month-head">
              <h2 class="updates-month-label">{{ group.label }}</h2>
              <span class="updates-month-line" aria-hidden="true"></span>
              <span class="updates-month-count">{{ group.entries.length }} 条</span>
            </div>

            <div class="updates-month-rail">
              <article v-for="entry in group.entries" :key="entry.id" class="updates-entry">
                <div class="updates-entry__aside">
                  <span class="updates-entry__dot" aria-hidden="true"></span>
                  <time class="updates-entry__date">{{ formatDate(entry.date) }}</time>
                  <span class="updates-entry__version">{{ entry.version }}</span>
                </div>
                <div class="updates-card">
                  <div class="updates-card__top">
                    <h3>{{ entry.title }}</h3>
                    <span class="updates-tag" :class="tagMeta(entry.tag).className">
                      {{ tagMeta(entry.tag).label }}
                    </span>
                  </div>
                  <p v-if="entry.summary">{{ entry.summary }}</p>
                  <ul v-if="entry.items?.length" class="updates-items">
                    <li v-for="item in entry.items" :key="item">{{ item }}</li>
                  </ul>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>
  </main>
</template>
