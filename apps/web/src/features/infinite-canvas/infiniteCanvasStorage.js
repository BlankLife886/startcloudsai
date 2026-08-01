import { getScopedLocalStorageKey } from '@/services/scopedLocalStorage'

const DB_NAME = 'starclouds-infinite-canvas'
const DB_VERSION = 1
const STORE_NAME = 'documents'
const ACTIVE_DOCUMENT_KEY = 'infinite-canvas-active-v1'

let mutationQueue = Promise.resolve()

function documentKey() {
  return getScopedLocalStorageKey(ACTIVE_DOCUMENT_KEY)
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexeddb_unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'))
  })
}

async function runTransaction(mode, operation) {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      let result
      try {
        result = operation(store)
      } catch (error) {
        reject(error)
        return
      }
      transaction.oncomplete = () => resolve(result?.result)
      transaction.onerror = () => reject(transaction.error || new Error('indexeddb_write_failed'))
      transaction.onabort = () => reject(transaction.error || new Error('indexeddb_aborted'))
    })
  } finally {
    database.close()
  }
}

function enqueueMutation(operation) {
  const mutation = mutationQueue.then(operation, operation)
  mutationQueue = mutation.catch(() => undefined)
  return mutation
}

export function loadInfiniteCanvasDocument() {
  return runTransaction('readonly', (store) => store.get(documentKey()))
}

export function saveInfiniteCanvasDocument(document) {
  return enqueueMutation(() =>
    runTransaction('readwrite', (store) =>
      store.put({
        ...document,
        id: documentKey(),
        version: 1,
        updatedAt: new Date().toISOString(),
      }),
    ),
  )
}

export function clearInfiniteCanvasDocument() {
  return enqueueMutation(() =>
    runTransaction('readwrite', (store) => store.delete(documentKey())),
  )
}
