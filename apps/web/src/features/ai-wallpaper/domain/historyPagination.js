export function resolveServerJobsPagination({
  append = false,
  pageDepth = 0,
  currentCursor = '',
  currentHasMore = false,
  nextCursor = '',
  hasMore = false,
} = {}) {
  const depth = Math.max(0, Number(pageDepth) || 0)
  if (append) {
    return {
      cursor: String(nextCursor || ''),
      hasMore: hasMore === true,
      pageDepth: depth + 1,
    }
  }

  // Realtime refreshes only reload the newest page. Once older pages have
  // been appended, keep their boundary or the next request would fetch page 2
  // again and make infinite scrolling appear stuck.
  if (depth > 1) {
    return {
      cursor: String(currentCursor || ''),
      hasMore: currentHasMore === true,
      pageDepth: depth,
    }
  }

  return {
    cursor: String(nextCursor || ''),
    hasMore: hasMore === true,
    pageDepth: Math.max(1, depth),
  }
}
