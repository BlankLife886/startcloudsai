import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import type { Page } from '@/request'

export interface PagedListOptions<T> {
  /**
   * Loads an arbitrary page in one request (server resolves its start). The
   * returned `cursor` is that page's exclusive start, cached for later visits.
   * Resolve `null` when the server did not honor the page (e.g. an older API);
   * navigation then falls back to following cursors.
   */
  seek?: (page: number) => Promise<(Page<T> & { cursor?: string | null }) | null>
  /**
   * The endpoint accepts `?page=N` (and echoes `page`): far jumps call
   * `fetcher(null, N)` once instead of following cursors page by page.
   */
  pageSeek?: boolean
}

/**
 * Builds a `seek` for list endpoints that accept `?page=N` and echo `page`.
 * An API that ignores `page` returns the first page; resolving `null` then
 * makes navigation fall back to following cursors instead of showing it.
 */
export function seekByPage<T>(load: (page: number) => Promise<Page<T>>) {
  return async (page: number) => {
    const result = await load(page)
    return result.page === page ? result : null
  }
}

/** Cursor navigation commits page number and rows together, only after success. */
export function usePagedList<T>(
  fetcher: (cursor: string | null, page?: number) => Promise<Page<T>>,
  getParams?: () => unknown,
  options: PagedListOptions<T> = {},
) {
  const seek: PagedListOptions<T>['seek'] = options.seek ?? (options.pageSeek ? seekByPage(page => fetcher(null, page)) : undefined)
  const items = ref([]) as Ref<T[]>
  const loading = ref(false)
  const error = ref<string | null>(null)
  const total = ref<number | null>(null)
  const totalCapped = ref(false)
  const page = ref(1)
  const nextCursor = ref<string | null>(null)
  const targetPage = ref<number | null>(null)
  let cursors = new Map<number, string | null>([[1, null]])
  let generation = 0
  const paramsKey = () => getParams ? JSON.stringify(getParams() ?? null) : ''
  let lastParamsKey = paramsKey()
  let attemptedPage = 1

  async function navigate(target: number, restart = false) {
    if (!Number.isFinite(target) || target < 1) return
    target = Math.floor(target)
    if (restart || paramsKey() !== lastParamsKey) {
      target = 1
      cursors = new Map([[1, null]])
      lastParamsKey = paramsKey()
    }
    const ownGeneration = ++generation
    attemptedPage = target
    targetPage.value = target
    loading.value = true
    error.value = null
    try {
      // Previously visited pages can be reached in one request.
      let position = Math.max(...Array.from(cursors.keys()).filter(value => value <= target))
      if (seek && target > position + 1) {
        const result = await seek(target)
        if (ownGeneration !== generation) return
        if (result) {
          const next = result.nextCursor || null
          // A null start past the end must not be cached: null means "first page".
          if (typeof result.cursor === 'string') cursors.set(target, result.cursor)
          if (next) cursors.set(target + 1, next)
          items.value = result.items ?? []
          total.value = result.total ?? null
          totalCapped.value = Boolean(result.totalCapped)
          page.value = target
          nextCursor.value = next
          return
        }
      }
      if (target - position > 20) throw new Error('目标页尚未访问，连续读取过多页面会很慢。请先用时间、搜索或分类缩小范围，再翻页查看。')
      let cursor = cursors.get(position) ?? null
      while (true) {
        const result = await fetcher(cursor)
        if (ownGeneration !== generation) return
        const next = result.nextCursor || null
        if (next && next === cursor) throw new Error('分页游标未前进，请刷新后重试')
        if (next) {
          if (cursors.has(position + 1) && cursors.get(position + 1) !== next) {
            for (const key of cursors.keys()) if (key > position) cursors.delete(key)
          }
          cursors.set(position + 1, next)
        }
        else for (const key of cursors.keys()) if (key > position) cursors.delete(key)

        // A deletion may empty the last page: return to the nearest nonempty page.
        if (!result.items?.length && !next && position > 1) {
          position--
          target = position
          cursor = cursors.get(position) ?? null
          continue
        }
        if (position >= target || !next) {
          items.value = result.items ?? []
          // scopeTotal can describe an unfiltered catalog, not this result set.
          total.value = result.total ?? (position === 1 && !next ? items.value.length : null)
          totalCapped.value = Boolean(result.totalCapped)
          page.value = position
          nextCursor.value = next
          return
        }
        position++
        cursor = next
      }
    } catch (caught) {
      if (ownGeneration === generation) error.value = caught instanceof Error ? caught.message : '加载失败，请重试'
    } finally {
      if (ownGeneration === generation) {
        loading.value = false
        targetPage.value = null
      }
    }
  }

  function reset() { return navigate(1, true) }
  function refresh() {
    if (loading.value) return Promise.resolve()
    return navigate(page.value)
  }
  function goToPage(target: number) {
    if (paramsKey() !== lastParamsKey) return reset()
    if (loading.value || target === page.value) return Promise.resolve()
    return navigate(target)
  }
  function next() {
    if (paramsKey() !== lastParamsKey) return reset()
    return nextCursor.value ? goToPage(page.value + 1) : Promise.resolve()
  }
  function prev() { return goToPage(Math.max(1, page.value - 1)) }
  function retry() { return navigate(attemptedPage) }

  if (getCurrentScope()) onScopeDispose(() => { generation++ })
  return {
    items, loading, error, total, totalCapped, page, targetPage,
    hasPrev: computed(() => page.value > 1),
    hasNext: computed(() => nextCursor.value !== null),
    reset, next, prev, goToPage, refresh, retry,
  }
}
