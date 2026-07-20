<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ziweiCompassIcon from '../assets/ziwei/ziwei-compass-gold.svg'
import { ziweiDocGroups } from '@/features/ziwei/ziweiDocsContent'
import { ziweiBookCategories, ziweiBooksCatalog, getZiweiBookUrl } from '@/features/ziwei/ziweiBooksCatalog'
import quanshuBook from '@/features/ziwei/ziweiQuanshuBook.json'
import './ziwei/ziwei-docs-page.css'

const route = useRoute()
const router = useRouter()

const docGroups = [
  ...ziweiDocGroups,
  { id: 'quanshu', label: '紫微全书', isQuanshu: true },
  { id: 'library', label: '书籍库', isLibrary: true },
]

const quanshuNavSections = quanshuBook.sections.filter((section) => section.level >= 3)

const activeGroupId = ref('basic')
const activeSectionId = ref('intro')
const bookCategoryFilter = ref('all')
const bodyRef = ref(null)
const pageReady = ref(false)

const isQuanshuGroup = computed(() => activeGroupId.value === 'quanshu')
const isLibraryGroup = computed(() => activeGroupId.value === 'library')

const activeGroup = computed(
  () => docGroups.find((group) => group.id === activeGroupId.value) || docGroups[0],
)

const filteredBooks = computed(() => {
  if (bookCategoryFilter.value === 'all') return ziweiBooksCatalog
  return ziweiBooksCatalog.filter((book) => book.category === bookCategoryFilter.value)
})

const navSections = computed(() => {
  if (isLibraryGroup.value) {
    return filteredBooks.value.map((book) => ({
      id: book.id,
      title: book.title,
      level: 3,
    }))
  }
  if (isQuanshuGroup.value) return quanshuNavSections
  return activeGroup.value.sections || []
})

const activeGuideSection = computed(() => {
  if (isQuanshuGroup.value || isLibraryGroup.value) return null
  const group = ziweiDocGroups.find((item) => item.id === activeGroupId.value)
  return (
    group?.sections.find((section) => section.id === activeSectionId.value) || group?.sections[0]
  )
})

const activeQuanshuSection = computed(() => {
  if (!isQuanshuGroup.value) return null
  return (
    quanshuBook.sections.find((section) => section.id === activeSectionId.value) ||
    quanshuNavSections[0]
  )
})

const activeLibraryBook = computed(() => {
  if (!isLibraryGroup.value) return null
  return (
    ziweiBooksCatalog.find((book) => book.id === activeSectionId.value) || filteredBooks.value[0]
  )
})

const activeTitle = computed(() => {
  if (isLibraryGroup.value) return activeLibraryBook.value?.title
  if (isQuanshuGroup.value) return activeQuanshuSection.value?.title
  return activeGuideSection.value?.title
})

const topbarTitle = computed(() => {
  if (isLibraryGroup.value) return '紫微斗数书籍库'
  if (isQuanshuGroup.value) return quanshuBook.title
  return '紫微斗数学习文档'
})

const topbarSubtitle = computed(() => {
  if (isLibraryGroup.value) return `藏书 ${ziweiBooksCatalog.length} 册 · Cloudflare R2 托管`
  if (isQuanshuGroup.value) return '维基文库经典原文'
  return '入门 · 进阶 · 全书 · 书籍对照'
})

function categoryLabel(categoryId) {
  return ziweiBookCategories.find((item) => item.id === categoryId)?.label || categoryId
}

function formatLabel(format) {
  return String(format || '').toUpperCase()
}

function syncRouteQuery() {
  const query = {
    ...route.query,
    group: activeGroupId.value,
    section: activeSectionId.value,
  }
  if (isLibraryGroup.value && bookCategoryFilter.value !== 'all') {
    query.cat = bookCategoryFilter.value
  } else {
    delete query.cat
  }
  router.replace({ query })
}

function selectGroup(groupId) {
  activeGroupId.value = groupId
  bookCategoryFilter.value = 'all'

  if (groupId === 'library') {
    activeSectionId.value = ziweiBooksCatalog[0]?.id || ''
  } else if (groupId === 'quanshu') {
    activeSectionId.value = quanshuNavSections[0]?.id || ''
  } else {
    const group = ziweiDocGroups.find((item) => item.id === groupId)
    activeSectionId.value = group?.sections[0]?.id || ''
  }

  bodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  syncRouteQuery()
}

function selectSection(sectionId) {
  activeSectionId.value = sectionId
  bodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  syncRouteQuery()
}

function selectBookCategory(categoryId) {
  bookCategoryFilter.value = categoryId
  const first = filteredBooks.value[0]
  if (first && !filteredBooks.value.some((book) => book.id === activeSectionId.value)) {
    activeSectionId.value = first.id
  }
  syncRouteQuery()
}

function openInAppReader() {
  const book = activeLibraryBook.value
  if (!book?.inAppSection) return
  activeGroupId.value = book.inAppSection.group
  activeSectionId.value = book.inAppSection.section
  syncRouteQuery()
}

function applyRouteQuery() {
  const group = String(route.query.group || '')
  const section = String(route.query.section || '')
  const cat = String(route.query.cat || 'all')
  const validGroup = docGroups.some((item) => item.id === group)

  if (validGroup) activeGroupId.value = group
  if (isLibraryGroup.value && ziweiBookCategories.some((item) => item.id === cat)) {
    bookCategoryFilter.value = cat
  }

  if (activeGroupId.value === 'library') {
    if (section && filteredBooks.value.some((book) => book.id === section)) {
      activeSectionId.value = section
    } else {
      activeSectionId.value = filteredBooks.value[0]?.id || ziweiBooksCatalog[0]?.id || ''
    }
    return
  }

  const sections =
    activeGroupId.value === 'quanshu'
      ? quanshuNavSections
      : ziweiDocGroups.find((item) => item.id === activeGroupId.value)?.sections || []

  if (section && sections.some((item) => item.id === section)) {
    activeSectionId.value = section
  } else if (activeGroupId.value === 'quanshu') {
    activeSectionId.value = quanshuNavSections[0]?.id || ''
  } else {
    activeSectionId.value = sections[0]?.id || 'intro'
  }
}

watch(
  () => route.query,
  () => {
    if (route.name !== 'ziwei-docs') return
    applyRouteQuery()
  },
)

onMounted(() => {
  applyRouteQuery()
  pageReady.value = true
})
</script>

<template>
  <main class="zwd" :class="{ 'zwd--ready': pageReady }">
    <header class="zwd-topbar">
      <div class="zwd-topbar__left">
        <RouterLink to="/ziwei" class="zwd-back">
          <i class="bi bi-arrow-left"></i>
          返回命盘
        </RouterLink>
        <div class="zwd-brand">
          <img class="zwd-brand__mark" :src="ziweiCompassIcon" alt="" aria-hidden="true" />
          <div>
            <strong>{{ topbarTitle }}</strong>
            <small>{{ topbarSubtitle }}</small>
          </div>
        </div>
      </div>

      <div v-if="isQuanshuGroup" class="zwd-topbar__actions">
        <a
          class="zwd-chip"
          href="https://zh.wikisource.org/wiki/紫微斗數全書"
          target="_blank"
          rel="noopener noreferrer"
        >
          <i class="bi bi-box-arrow-up-right"></i>
          维基文库
        </a>
        <a class="zwd-chip" :href="getZiweiBookUrl('quanshu-epub', true)" download>
          <i class="bi bi-download"></i>
          EPUB
        </a>
      </div>
    </header>

    <div class="zwd-shell">
      <aside class="zwd-nav">
        <div class="zwd-nav__groups zwd-nav__groups--4">
          <button
            v-for="group in docGroups"
            :key="group.id"
            type="button"
            :class="{ active: activeGroupId === group.id }"
            @click="selectGroup(group.id)"
          >
            {{ group.label }}
          </button>
        </div>

        <div v-if="isLibraryGroup" class="zwd-nav__filters">
          <button
            v-for="cat in ziweiBookCategories"
            :key="cat.id"
            type="button"
            :class="{ active: bookCategoryFilter === cat.id }"
            @click="selectBookCategory(cat.id)"
          >
            {{ cat.label }}
          </button>
        </div>

        <div class="zwd-nav__label">
          {{ isLibraryGroup ? '书目' : '目录' }} · {{ navSections.length }}
          {{ isLibraryGroup ? '册' : '篇' }}
        </div>

        <nav class="zwd-nav__sections" :aria-label="`${activeGroup.label}目录`">
          <button
            v-for="section in navSections"
            :key="section.id"
            type="button"
            :class="[
              { active: activeSectionId === section.id },
              section.level === 4 ? 'is-nested' : '',
            ]"
            @click="selectSection(section.id)"
          >
            <span class="zwd-nav__dot" aria-hidden="true"></span>
            <span class="zwd-nav__text">{{ section.title }}</span>
          </button>
        </nav>
      </aside>

      <article ref="bodyRef" class="zwd-body">
        <header class="zwd-body__head">
          <span class="zwd-body__tag">{{ activeGroup.label }}</span>
          <h1>{{ activeTitle }}</h1>
        </header>

        <div v-if="!isQuanshuGroup && !isLibraryGroup && activeGuideSection" class="zwd-sheet">
          <div class="zwd-content">
            <p v-for="(paragraph, index) in activeGuideSection.body" :key="index">
              {{ paragraph }}
            </p>

            <ul v-if="activeGuideSection.list?.length" class="zwd-list">
              <li v-for="item in activeGuideSection.list" :key="item">{{ item }}</li>
            </ul>

            <ol v-if="activeGuideSection.ordered?.length" class="zwd-ordered">
              <li v-for="item in activeGuideSection.ordered" :key="item">{{ item }}</li>
            </ol>

            <p v-if="activeGuideSection.note" class="zwd-note">
              {{ activeGuideSection.note }}
            </p>
          </div>
        </div>

        <div v-else-if="isQuanshuGroup && activeQuanshuSection" class="zwd-sheet zwd-sheet--classic">
          <div class="zwd-content">
            <p
              v-for="(paragraph, index) in activeQuanshuSection.body"
              :key="index"
              class="zwd-classic"
            >
              {{ paragraph }}
            </p>
            <p v-if="!activeQuanshuSection.body?.length" class="zwd-muted">
              本节为卷首标题，请从左侧选择具体篇章阅读。
            </p>
          </div>
          <footer class="zwd-source">
            原文来源：
            <a
              href="https://zh.wikisource.org/wiki/紫微斗數全書"
              target="_blank"
              rel="noopener noreferrer"
            >
              维基文库《紫微斗數全書》
            </a>
            · {{ quanshuBook.license }}
          </footer>
        </div>

        <div v-else-if="isLibraryGroup && activeLibraryBook" class="zwd-sheet zwd-sheet--library">
          <div class="zwd-content zwd-content--library">
            <div class="zwd-book-meta">
              <div class="zwd-book-meta__item">
                <span>作者 / 来源</span>
                <strong>{{ activeLibraryBook.author || '—' }}</strong>
              </div>
              <div class="zwd-book-meta__item">
                <span>分类</span>
                <strong>{{ categoryLabel(activeLibraryBook.category) }}</strong>
              </div>
              <div class="zwd-book-meta__item">
                <span>格式</span>
                <strong>{{ formatLabel(activeLibraryBook.format) }}</strong>
              </div>
              <div class="zwd-book-meta__item">
                <span>页数</span>
                <strong>{{ activeLibraryBook.pages ? `${activeLibraryBook.pages} 页` : '—' }}</strong>
              </div>
              <div class="zwd-book-meta__item">
                <span>大小</span>
                <strong>{{ activeLibraryBook.sizeMb }} MB</strong>
              </div>
            </div>

            <p v-if="activeLibraryBook.note" class="zwd-note">{{ activeLibraryBook.note }}</p>

            <div class="zwd-book-actions">
              <a
                class="zwd-book-btn zwd-book-btn--primary"
                :href="getZiweiBookUrl(activeLibraryBook.id)"
                target="_blank"
                rel="noopener noreferrer"
              >
                <i class="bi bi-box-arrow-up-right"></i>
                浏览器打开
              </a>
              <a class="zwd-book-btn" :href="getZiweiBookUrl(activeLibraryBook.id, true)" download>
                <i class="bi bi-download"></i>
                下载文件
              </a>
              <button
                v-if="activeLibraryBook.inAppSection"
                type="button"
                class="zwd-book-btn"
                @click="openInAppReader"
              >
                <i class="bi bi-journal-richtext"></i>
                站内读全书
              </button>
            </div>

            <p class="zwd-muted zwd-library-tip">
              PDF 多为扫描版，请使用浏览器或系统阅读器查看。书籍文件托管在 Cloudflare R2，不会随前端仓库一起发布。
            </p>
          </div>
        </div>
      </article>
    </div>
  </main>
</template>
