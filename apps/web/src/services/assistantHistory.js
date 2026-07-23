const DB_NAME = 'starclouds-assistant'
const STORE_NAME = 'conversation-scopes'
const DB_VERSION = 1
const FALLBACK_PREFIX = 'starclouds-assistant:'
const WORKSPACE_PREFIX = 'starclouds-assistant-workspace:'
const saveQueues = new Map()

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'))
  })
}

function transact(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    let request
    try {
      request = action(tx.objectStore(STORE_NAME))
    } catch (error) {
      db.close()
      reject(error)
      return
    }
    let result
    request.onsuccess = () => {
      result = request.result
    }
    request.onerror = () =>
      reject(request.error || new Error('Assistant history transaction failed'))
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => reject(tx.error || new Error('Assistant history transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('Assistant history transaction aborted'))
  })
}

function plainSnapshot(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function fallbackValue(conversations) {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      images: [],
      referenceImages: [],
    })),
  }))
}

export async function loadAssistantHistory(scope) {
  try {
    const db = await openDatabase()
    const stored = await transact(db, 'readonly', (store) => store.get(scope))
    if (Array.isArray(stored)) return stored
  } catch {
    // Fall through to the lightweight localStorage recovery copy.
  }
  try {
    const fallback = JSON.parse(localStorage.getItem(FALLBACK_PREFIX + scope) || '[]')
    if (Array.isArray(fallback) && fallback.length) void saveAssistantHistory(scope, fallback)
    return Array.isArray(fallback) ? fallback : []
  } catch {
    return []
  }
}

export async function saveAssistantHistory(scope, conversations) {
  const snapshot = plainSnapshot(Array.isArray(conversations) ? conversations : [], [])
  const previous = saveQueues.get(scope) || Promise.resolve()
  const queued = previous
    .catch(() => {})
    .then(async () => {
      try {
        const db = await openDatabase()
        await transact(db, 'readwrite', (store) => store.put(snapshot, scope))
        localStorage.removeItem(FALLBACK_PREFIX + scope)
      } catch {
        localStorage.setItem(FALLBACK_PREFIX + scope, JSON.stringify(fallbackValue(snapshot)))
      }
    })
  saveQueues.set(scope, queued)
  queued.then(
    () => {
      if (saveQueues.get(scope) === queued) saveQueues.delete(scope)
    },
    () => {
      if (saveQueues.get(scope) === queued) saveQueues.delete(scope)
    },
  )
  return queued
}

export function loadAssistantWorkspaceState(scope) {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_PREFIX + scope) || 'null') || {}
  } catch {
    return {}
  }
}

export function saveAssistantWorkspaceState(scope, state) {
  try {
    localStorage.setItem(WORKSPACE_PREFIX + scope, JSON.stringify(plainSnapshot(state, {})))
  } catch {
    // Workspace state is an optimization; conversation history remains in IndexedDB.
  }
}
