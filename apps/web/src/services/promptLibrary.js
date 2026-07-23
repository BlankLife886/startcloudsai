/**
 * 提示词库（工作台词库面板数据源）。
 *
 * 优先走服务端 GET /api/prompts（见 promptsApi.js，带内存缓存），
 * 服务端为空或请求失败时回退到调用方提供的本地静态词库，
 * 保持旧的页码式返回结构，工作台 UI 无需改动。
 */
import { listPrompts } from './promptsApi'

// cursor 分页 → 页码分页的游标链：key = `${type}|${category}`，index p 存第 p+1 页的 cursor
const cursorChains = new Map()
// 各 type 的全量分类计数（来自不带分类筛选的请求），筛选态下沿用，避免分类 chips 消失
const countsByType = new Map()
// 记录服务端该 type 是否有数据：无数据时分类筛选也走本地静态词库
const serverHasData = new Map()

function chainKey(type, category) {
  return `${type}|${category}`
}

function toLegacyItem(item) {
  return {
    id: item.id,
    title: item.title,
    label: item.title,
    prompt: item.prompt,
    taskType: item.taskType,
    category: item.category,
    categoryKey: item.category || 'other',
    tags: item.tags || [],
    coverUrl: item.coverUrl || '',
    imageUrl: item.coverUrl || '',
  }
}

function normalizeFallbackItem(item) {
  return {
    id: String(item?.id || ''),
    title: String(item?.title || item?.label || ''),
    label: String(item?.label || item?.title || ''),
    prompt: String(item?.prompt || ''),
    taskType: String(item?.taskType || ''),
    category: String(item?.category || item?.categoryKey || 'other'),
    categoryKey: String(item?.categoryKey || item?.category || 'other'),
    tags: Array.isArray(item?.tags) ? item.tags : [],
    coverUrl: String(item?.coverUrl || item?.imageUrl || ''),
    imageUrl: String(item?.imageUrl || item?.coverUrl || ''),
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

function buildFallbackResponse(fallbackItems, category) {
  const all = fallbackItems.map(normalizeFallbackItem).filter((item) => item.prompt)
  const filtered =
    category && category !== 'all' ? all.filter((item) => item.categoryKey === category) : all
  return {
    items: filtered,
    page: 1,
    total: filtered.length,
    hasMore: false,
    categoryCounts: countCategories(all),
  }
}

/**
 * 按页读取词库，供各创作工作台的词库面板使用。
 *
 * @param {string} type - 服务端词库类型：t2i / game_art / model_sheet / ui_design / coloring
 * @param {object} options
 * @param {number} [options.pageNumber] - 从 1 开始
 * @param {number} [options.pageSize]
 * @param {string} [options.category] - 分类筛选（'all' 或空表示全部）
 * @param {Array}  [options.fallbackItems] - 本地静态词库，服务端为空/失败时回退
 * @returns {Promise<{items: Array, page: number, total: number, hasMore: boolean, categoryCounts: object}>}
 */
export async function listPromptLibrary(type, options = {}) {
  const { pageNumber = 1, pageSize = 24, category = '', fallbackItems = [] } = options
  const normalizedCategory = category === 'all' ? '' : String(category || '')
  const key = chainKey(type, normalizedCategory)
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
      cursor,
      limit: pageSize,
    })
    if (page === 1 && (!normalizedCategory || Number(categoryCounts?.all || 0) > 0)) {
      serverHasData.set(type, items.length > 0 || Number(categoryCounts?.all || 0) > 0)
    }
    if (page === 1 && !items.length && !serverHasData.get(type)) {
      return buildFallbackResponse(fallbackItems, normalizedCategory)
    }
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
          ? categoryCounts?.[normalizedCategory] ?? countsByType.get(type)?.[normalizedCategory]
          : categoryCounts?.all ?? countsByType.get(type)?.all) ?? legacyItems.length,
      ),
      hasMore: Boolean(nextCursor),
      categoryCounts: countsByType.get(type) || countCategories(legacyItems),
    }
  } catch {
    if (page === 1) return buildFallbackResponse(fallbackItems, normalizedCategory)
    return { items: [], page, total: 0, hasMore: false, categoryCounts: { all: 0 } }
  }
}
