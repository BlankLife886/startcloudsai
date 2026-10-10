const STORAGE_KEY = 'starclouds:lossless-compress-history-v1'
const DB_NAME = 'starclouds-image-compress'
const STORE_NAME = 'results'
const DB_VERSION = 1
const MAX_ITEMS = 5

function canUseStorage() {
  return typeof localStorage !== 'undefined'
}

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

function withStore(mode, action) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
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
        request.onerror = () => reject(request.error || new Error('压缩历史读写失败'))
        tx.oncomplete = () => {
          db.close()
          resolve(result)
        }
        tx.onerror = () => reject(tx.error || new Error('压缩历史读写失败'))
        tx.onabort = () => reject(tx.error || new Error('压缩历史读写失败'))
      }),
  )
}

export async function saveCompressResultBlob(id, blob) {
  if (!id || !blob) return
  try {
    await withStore('readwrite', (store) => store.put(blob, id))
  } catch {
    /* private mode / quota */
  }
}

export async function loadCompressResultBlob(id) {
  if (!id) return null
  try {
    const blob = await withStore('readonly', (store) => store.get(id))
    return blob instanceof Blob ? blob : null
  } catch {
    return null
  }
}

async function deleteCompressResultBlob(id) {
  if (!id) return
  try {
    await withStore('readwrite', (store) => store.delete(id))
  } catch {
    /* ignore */
  }
}

async function pruneResultBlobs(keepIds = []) {
  const keep = new Set((keepIds || []).filter(Boolean))
  try {
    const keys = await withStore('readonly', (store) => store.getAllKeys())
    const stale = (keys || []).filter((key) => !keep.has(key))
    await Promise.all(stale.map((key) => deleteCompressResultBlob(key)))
  } catch {
    /* ignore */
  }
}

export function loadCompressHistory() {
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const items = parsed.slice(0, MAX_ITEMS)
    if (parsed.length > MAX_ITEMS) {
      saveCompressHistory(items)
      void pruneResultBlobs(items.map((item) => item?.id))
    }
    return items
  } catch {
    return []
  }
}

export function saveCompressHistory(items = []) {
  if (!canUseStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify((items || []).slice(0, MAX_ITEMS)))
  } catch {
    /* quota / private mode */
  }
}

export function prependCompressHistory(entry, items = loadCompressHistory()) {
  const next = [entry, ...items.filter((item) => item?.id !== entry?.id)].slice(0, MAX_ITEMS)
  saveCompressHistory(next)
  void pruneResultBlobs(next.map((item) => item?.id))
  return next
}

export async function clearCompressHistory() {
  if (canUseStorage()) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  try {
    await withStore('readwrite', (store) => store.clear())
  } catch {
    /* ignore */
  }
}
