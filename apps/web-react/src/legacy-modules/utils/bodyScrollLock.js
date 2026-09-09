const locks = new Map()

let bodyStyleSnapshot = null
let htmlStyleSnapshot = null
let frozenScrollY = 0
let usedFreezeViewport = false

function readBodyStyle(body) {
  return {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  }
}

function writeBodyStyle(body, style) {
  Object.entries(style).forEach(([property, value]) => {
    body.style[property] = value
  })
}

function restoreScrollPosition(y) {
  const html = document.documentElement
  const previousBehavior = html.style.scrollBehavior
  html.style.scrollBehavior = 'auto'
  html.scrollTop = y
  document.body.scrollTop = y
  window.scrollTo(0, y)
  html.style.scrollBehavior = previousBehavior
}

function syncBodyScrollLock() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  const body = document.body
  const html = document.documentElement

  if (locks.size === 0) {
    if (!bodyStyleSnapshot && !htmlStyleSnapshot) return

    const y = frozenScrollY
    const shouldRestoreScroll = usedFreezeViewport

    if (bodyStyleSnapshot) {
      writeBodyStyle(body, bodyStyleSnapshot)
      bodyStyleSnapshot = null
    }
    if (htmlStyleSnapshot) {
      html.style.overflow = htmlStyleSnapshot.overflow
      htmlStyleSnapshot = null
    }

    frozenScrollY = 0
    usedFreezeViewport = false

    // 只有用过 position:fixed 冻结时才需要回跳；否则 scrollTo 会造成“自动滚动”
    if (shouldRestoreScroll) restoreScrollPosition(y)
    return
  }

  if (!bodyStyleSnapshot) {
    bodyStyleSnapshot = readBodyStyle(body)
    htmlStyleSnapshot = { overflow: html.style.overflow }
    frozenScrollY = window.scrollY || html.scrollTop || body.scrollTop || 0
  }

  const shouldFreezeViewport = Array.from(locks.values()).some((lock) => lock.freezeViewport)
  usedFreezeViewport = usedFreezeViewport || shouldFreezeViewport

  body.style.overflow = 'hidden'
  html.style.overflow = 'hidden'

  if (shouldFreezeViewport) {
    body.style.position = 'fixed'
    body.style.top = `-${frozenScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    return
  }

  body.style.position = bodyStyleSnapshot.position
  body.style.top = bodyStyleSnapshot.top
  body.style.left = bodyStyleSnapshot.left
  body.style.right = bodyStyleSnapshot.right
  body.style.width = bodyStyleSnapshot.width
}

export function setBodyScrollLock(owner, locked, options = {}) {
  if (!owner) return

  if (locked) {
    locks.set(owner, { freezeViewport: Boolean(options.freezeViewport) })
  } else {
    locks.delete(owner)
  }
  syncBodyScrollLock()
}

export function hasBodyScrollLocks() {
  return locks.size > 0
}
