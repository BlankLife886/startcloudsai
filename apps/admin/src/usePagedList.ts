import { computed, ref, type Ref } from 'vue'
import type { Page } from '@/request'

/**
 * cursor 分页列表状态：items/loading/error + 上一页/下一页。
 * 上一页通过记录历史 cursor 栈实现（契约只有 nextCursor）。
 *
 * @param fetcher 拉取一页数据
 * @param getParams 可选：返回当前筛选参数（任意可 JSON 序列化的值）。
 *   传入后翻页/刷新前会对比参数快照，发现筛选已变化则自动回到第一页，
 *   避免「改了筛选没点查询就翻页」时 cursor 与参数不一致。
 */
export function usePagedList<T>(
  fetcher: (cursor: string | null) => Promise<Page<T>>,
  getParams?: () => unknown,
) {
  const items = ref([]) as Ref<T[]>
  const loading = ref(false)
  /** 最近一次加载失败的提示文案，成功后清空 */
  const error = ref<string | null>(null)
  const nextCursor = ref<string | null>(null)
  const currentCursor = ref<string | null>(null)
  const prevCursors = ref<(string | null)[]>([])

  function paramsKey(): string {
    return getParams ? JSON.stringify(getParams() ?? null) : ''
  }

  /** 上次成功发起加载时的参数快照 */
  let lastParamsKey = paramsKey()
  /** 最近一次尝试加载的 cursor（失败后供 retry 重放） */
  let attemptedCursor: string | null = null

  async function load(cursor: string | null) {
    attemptedCursor = cursor
    loading.value = true
    error.value = null
    try {
      const page = await fetcher(cursor)
      items.value = page.items
      nextCursor.value = page.nextCursor
      currentCursor.value = cursor
    } catch (e) {
      // request.ts 已弹过 toast，这里落地为可见的错误条状态
      error.value = e instanceof Error && e.message ? e.message : '加载失败，请重试'
    } finally {
      loading.value = false
    }
  }

  /** 筛选条件变化后从第一页重新加载 */
  function reset() {
    prevCursors.value = []
    lastParamsKey = paramsKey()
    return load(null)
  }

  function paramsChanged(): boolean {
    return getParams !== undefined && paramsKey() !== lastParamsKey
  }

  function next() {
    if (paramsChanged()) return reset()
    if (!nextCursor.value) return Promise.resolve()
    prevCursors.value.push(currentCursor.value)
    return load(nextCursor.value)
  }

  function prev() {
    if (paramsChanged()) return reset()
    if (prevCursors.value.length === 0) return Promise.resolve()
    return load(prevCursors.value.pop() ?? null)
  }

  /** 重新加载当前页（写操作后刷新） */
  function refresh() {
    if (paramsChanged()) return reset()
    return load(currentCursor.value)
  }

  /** 失败后重试：重放最近一次尝试的加载 */
  function retry() {
    return load(attemptedCursor)
  }

  return {
    items,
    loading,
    error,
    hasPrev: computed(() => prevCursors.value.length > 0),
    hasNext: computed(() => nextCursor.value !== null),
    reset,
    next,
    prev,
    refresh,
    retry,
  }
}
