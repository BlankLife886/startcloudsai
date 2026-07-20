import { computed, ref, type Ref } from 'vue'
import type { Page } from '@/request'

/**
 * cursor 分页列表状态：items/loading + 上一页/下一页。
 * 上一页通过记录历史 cursor 栈实现（契约只有 nextCursor）。
 */
export function usePagedList<T>(fetcher: (cursor: string | null) => Promise<Page<T>>) {
  const items = ref([]) as Ref<T[]>
  const loading = ref(false)
  const nextCursor = ref<string | null>(null)
  const currentCursor = ref<string | null>(null)
  const prevCursors = ref<(string | null)[]>([])

  async function load(cursor: string | null) {
    loading.value = true
    try {
      const page = await fetcher(cursor)
      items.value = page.items
      nextCursor.value = page.nextCursor
      currentCursor.value = cursor
    } finally {
      loading.value = false
    }
  }

  /** 筛选条件变化后从第一页重新加载 */
  function reset() {
    prevCursors.value = []
    return load(null)
  }

  function next() {
    if (!nextCursor.value) return Promise.resolve()
    prevCursors.value.push(currentCursor.value)
    return load(nextCursor.value)
  }

  function prev() {
    if (prevCursors.value.length === 0) return Promise.resolve()
    return load(prevCursors.value.pop() ?? null)
  }

  /** 重新加载当前页（写操作后刷新） */
  function refresh() {
    return load(currentCursor.value)
  }

  return {
    items,
    loading,
    hasPrev: computed(() => prevCursors.value.length > 0),
    hasNext: computed(() => nextCursor.value !== null),
    reset,
    next,
    prev,
    refresh,
  }
}
