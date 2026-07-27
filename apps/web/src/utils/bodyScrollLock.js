const locks = new Map()

let bodyStyleSnapshot = null
let frozenScrollY = 0

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

function syncBodyScrollLock() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  const body = document.body
  if (locks.size === 0) {
    if (!bodyStyleSnapshot) return

    writeBodyStyle(body, bodyStyleSnapshot)
    bodyStyleSnapshot = null

    if (frozenScrollY > 0) window.scrollTo(0, frozenScrollY)
    frozenScrollY = 0
    return
  }

  if (!bodyStyleSnapshot) {
    bodyStyleSnapshot = readBodyStyle(body)
    frozenScrollY = window.scrollY || document.documentElement.scrollTop || 0
  }

  const shouldFreezeViewport = Array.from(locks.values()).some((lock) => lock.freezeViewport)
  body.style.overflow = 'hidden'

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
