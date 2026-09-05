/**
 * 提示词库（工作台词库面板数据源）。
 *
 * 数据来自服务端 GET /api/v1/prompts（见 promptsApi.js，带内存缓存），
 * 并转换为工作台使用的页码式返回结构。
 */
import { readLocale } from '../../i18n/locale.js'
import { listPromptCategories, listPrompts, recordPromptEngagement } from './promptsApi'

const ZH_MARKERS = /^(中文|zh|zh-cn|zh-tw|zh-hk|chinese)$/i
const EN_MARKERS = /^(en|english)$/i

function collapsePromptSpace(value) {
  return String(value || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * 词库里常把 [中文] / [English] 写在同一段。按当前语言只取对应正文。
 */
export function resolveLocalizedPrompt(prompt, locale = readLocale()) {
  const text = collapsePromptSpace(prompt)
  if (!text) return ''
  const marks = [...text.matchAll(/\[(中文|English|en|zh|zh-CN|zh-TW|chinese)\]\s*/gi)]
  if (marks.length < 2) return text
  const segments = marks
    .map((mark, index) => {
      const start = mark.index + mark[0].length
      const end = index + 1 < marks.length ? marks[index + 1].index : text.length
      return {
        label: String(mark[1] || '').trim(),
        text: collapsePromptSpace(text.slice(start, end)),
      }
    })
    .filter((segment) => segment.text)
  if (!segments.length) return text
  const preferEnglish = locale === 'en'
  const picked = segments.find((segment) =>
    preferEnglish ? EN_MARKERS.test(segment.label) : ZH_MARKERS.test(segment.label),
  )
  return picked?.text || segments[0].text
}

// cursor 分页 → 页码分页的游标链：key = `${type}|${category}`，index p 存第 p+1 页的 cursor
const cursorChains = new Map()
// 各 type 的全量分类计数（来自不带分类筛选的请求），筛选态下沿用，避免分类 chips 消失
const countsByType = new Map()

function chainKey(type, category, sort) {
  return `${type}|${category}|${sort}`
}

function toLegacyItem(item) {
  return {
    id: item.id,
    title: item.title,
    label: item.title,
    prompt: resolveLocalizedPrompt(item.prompt),
    taskType: item.taskType,
    category: item.category,
    categoryKey: item.category || 'other',
    tags: item.tags || [],
    coverUrl: item.coverUrl || '',
    imageUrl: item.coverUrl || '',
    coverWidth: Math.max(0, Number(item.coverWidth) || 0),
    coverHeight: Math.max(0, Number(item.coverHeight) || 0),
    likeCount: item.likeCount || 0,
    favoriteCount: item.favoriteCount || 0,
    useCount: item.useCount || 0,
    liked: item.liked === true,
    favorited: item.favorited === true,
  }
}

function countCategories(items) {
  const counts = { all: items.length }
  for (const item of items) {
    const key = item.categoryKey || 'other'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/**
 * 按页读取词库，供各创作工作台的词库面板使用。
 *
 * @param {string} type - 服务端词库类型：t2i / game_art / model_sheet / ui_design / coloring
 * @param {object} options
 * @param {number} [options.pageNumber] - 从 1 开始
 * @param {number} [options.pageSize]
 * @param {string} [options.category] - 分类筛选（'all' 或空表示全部）
 * @returns {Promise<{items: Array, page: number, total: number, hasMore: boolean, categoryCounts: object}>}
 */
export async function listPromptLibrary(type, options = {}) {
  const {
    pageNumber = 1,
    pageSize = 24,
    category = '',
    scope = '',
    sort = 'recommended',
    search = '',
  } = options
  const normalizedCategory = category === 'all' ? '' : String(category || '')
  const normalizedSearch = String(search || '').trim()
  const key = chainKey(type, normalizedCategory, `${scope}:${sort}:${normalizedSearch}`)
  const chain = cursorChains.get(key) || ['']
  const page = Math.max(1, Number(pageNumber) || 1)

  let cursor = ''
  if (page > 1) {
    cursor = chain[page - 1]
    // 游标链断裂（如刷新后直接请求深页码）时视为没有更多数据
    if (!cursor) return { items: [], page, total: 0, hasMore: false, categoryCounts: { all: 0 } }
  }

  try {
    const { items, nextCursor, categoryCounts } = await listPrompts({
      type,
      category: normalizedCategory,
      scope,
      sort,
      search: normalizedSearch,
      cursor,
      limit: pageSize,
    })
    const nextChain = chain.slice(0, page)
    if (nextCursor) nextChain[page] = nextCursor
    cursorChains.set(key, nextChain)
    const legacyItems = items.map(toLegacyItem)
    if (categoryCounts && Object.keys(categoryCounts).length) {
      countsByType.set(type, categoryCounts)
    }
    return {
      items: legacyItems,
      page,
      total: Number(
        (normalizedCategory
          ? (categoryCounts?.[normalizedCategory] ?? countsByType.get(type)?.[normalizedCategory])
          : (categoryCounts?.all ?? countsByType.get(type)?.all)) ?? legacyItems.length,
      ),
      hasMore: Boolean(nextCursor),
      categoryCounts: countsByType.get(type) || countCategories(legacyItems),
    }
  } catch {
    if (page === 1) {
      return { items: [], page, total: 0, hasMore: false, categoryCounts: { all: 0 } }
    }
    return { items: [], page, total: 0, hasMore: false, categoryCounts: { all: 0 } }
  }
}

export { listPromptCategories, recordPromptEngagement }
