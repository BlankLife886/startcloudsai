const STORAGE_KEY = 'walleven.bookmark-library.v2'

const CATEGORY_RULES = [
  ['AI 与开发', /\b(ai|gpt|llm|github|gitlab|stackoverflow|npm|developer|api|code|编程|开发|模型)\b/i],
  ['设计与灵感', /\b(figma|dribbble|behance|design|font|icon|ui|ux|设计|素材|灵感|配色)\b/i],
  ['影音娱乐', /\b(bilibili|youtube|douyin|movie|music|video|游戏|动漫|影视|音乐|直播)\b/i],
  ['购物生活', /\b(taobao|tmall|jd|meituan|xianyu|shop|淘宝|京东|美团|闲鱼|购物|外卖)\b/i],
  ['资讯阅读', /\b(news|blog|medium|zhihu|weibo|新闻|博客|文章|资讯|知乎|微博)\b/i],
  ['工作效率', /\b(notion|docs|drive|calendar|office|work|文档|表格|会议|工作|效率)\b/i],
  ['社交社区', /\b(xiaohongshu|reddit|discord|twitter|x\.com|小红书|社区|论坛|社交)\b/i],
]

export function readBookmarkLibrary() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(normalizeBookmark).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveBookmarkLibrary(items) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 10000)))
}

export function parseBrowserBookmarkHtml(html) {
  const documentNode = new DOMParser().parseFromString(String(html || ''), 'text/html')
  const items = []
  const walk = (node, folders = []) => {
    for (const child of node.children || []) {
      if (child.tagName === 'DT') {
        const anchor = child.querySelector(':scope > a')
        const heading = child.querySelector(':scope > h3')
        const nested = child.querySelector(':scope > dl')
        if (anchor) {
          const normalized = normalizeBookmark({
            id: crypto.randomUUID(),
            title: anchor.textContent,
            url: anchor.getAttribute('href'),
            category: folders.at(-1) || '未分类',
            folderPath: folders,
            addedAt: unixSecondsToIso(anchor.getAttribute('add_date')),
            tags: [],
          })
          if (normalized) items.push(normalized)
        }
        if (heading && nested) walk(nested, [...folders, heading.textContent.trim()])
      } else if (child.tagName === 'DL') {
        walk(child, folders)
      }
    }
  }
  walk(documentNode.body)
  return dedupeBookmarks(items)
}

export function dedupeBookmarks(items) {
  const seen = new Map()
  for (const raw of items || []) {
    const item = normalizeBookmark(raw)
    if (!item) continue
    const key = canonicalUrl(item.url)
    const existing = seen.get(key)
    if (!existing) seen.set(key, item)
    else {
      existing.tags = Array.from(new Set([...(existing.tags || []), ...(item.tags || [])]))
      if (existing.category === '未分类' && item.category !== '未分类') existing.category = item.category
    }
  }
  return Array.from(seen.values())
}

export function smartClassifyBookmarks(items) {
  return dedupeBookmarks(items).map((item) => {
    const haystack = `${item.title} ${item.url} ${(item.folderPath || []).join(' ')}`
    const category = CATEGORY_RULES.find(([, pattern]) => pattern.test(haystack))?.[0]
      || item.folderPath?.at(-1)
      || '稍后整理'
    const host = safeHostname(item.url)
    const tags = Array.from(new Set([...(item.tags || []), host.split('.').slice(-2, -1)[0]].filter(Boolean)))
    return { ...item, category, tags, updatedAt: new Date().toISOString() }
  })
}

export function exportBookmarkHtml(items) {
  const groups = new Map()
  items.forEach((item) => {
    const key = item.category || '未分类'
    groups.set(key, [...(groups.get(key) || []), item])
  })
  const sections = Array.from(groups.entries()).map(([category, links]) =>
    `<DT><H3>${escapeHtml(category)}</H3>\n<DL><p>\n${links.map((item) => `  <DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title)}</A>`).join('\n')}\n</DL><p>`,
  )
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${sections.join('\n')}\n</DL><p>`
}

export function downloadTextFile(content, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function normalizeBookmark(raw) {
  try {
    const url = new URL(String(raw?.url || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return {
      id: String(raw.id || crypto.randomUUID()),
      title: String(raw.title || url.hostname).trim().slice(0, 180),
      url: url.toString(),
      category: String(raw.category || '未分类').trim().slice(0, 48),
      folderPath: Array.isArray(raw.folderPath) ? raw.folderPath.map(String).slice(0, 12) : [],
      tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 12) : [],
      addedAt: String(raw.addedAt || new Date().toISOString()),
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
    }
  } catch {
    return null
  }
}

function canonicalUrl(value) {
  const url = new URL(value)
  url.hash = ''
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(utm_|spm$|from$|ref$)/i.test(key)) url.searchParams.delete(key)
  }
  return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`.toLowerCase()
}

function safeHostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, '') } catch { return '' }
}

function unixSecondsToIso(value) {
  const seconds = Number(value || 0)
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
}
