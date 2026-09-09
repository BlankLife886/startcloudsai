import { computed, ref, watch } from 'vue'

export function useClientPagination<T>(source: () => T[], initialPageSize = 20) {
  const page = ref(1)
  const pageSize = ref(initialPageSize)
  const total = computed(() => source().length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const items = computed(() => {
    const start = (page.value - 1) * pageSize.value
    return source().slice(start, start + pageSize.value)
  })

  function reset() {
    page.value = 1
  }

  function prev() {
    page.value = Math.max(1, page.value - 1)
  }

  function next() {
    page.value = Math.min(pageCount.value, page.value + 1)
  }

  function goToPage(target: number) {
    page.value = Math.min(pageCount.value, Math.max(1, target))
  }

  function setPageSize(size: number) {
    pageSize.value = size
    page.value = 1
  }

  watch(total, () => {
    if (page.value > pageCount.value) page.value = pageCount.value
  })

  return {
    items,
    page,
    pageSize,
    total,
    hasPrev: computed(() => page.value > 1),
    hasNext: computed(() => page.value < pageCount.value),
    reset,
    prev,
    next,
    goToPage,
    setPageSize,
  }
}
