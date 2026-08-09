const DB_NAME = 'starclouds-music-library'
const STORE_NAME = 'tracks'
const DB_VERSION = 1

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'))
  })
}

function withStore(db, mode, action) {
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
    if (request) {
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () =>
        reject(request.error || new Error('Music library transaction failed'))
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => reject(tx.error || new Error('Music library transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('Music library transaction aborted'))
  })
}

export async function listMusicTracks() {
  try {
    const db = await openDatabase()
    const rows = await withStore(db, 'readonly', (store) => store.getAll())
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.id && row?.blob)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
  } catch {
    return []
  }
}

export async function putMusicTrack(record) {
  if (!record?.id || !record?.blob) return false
  try {
    const db = await openDatabase()
    await withStore(db, 'readwrite', (store) =>
      store.put({
        id: record.id,
        source: 'local',
        title: record.title || '本地歌曲',
        artist: record.artist || '本地音乐',
        tone: record.tone || 'violet',
        fileKey: record.fileKey || '',
        order: Number(record.order) || 0,
        mimeType: record.mimeType || record.blob.type || '',
        blob: record.blob,
      }),
    )
    return true
  } catch {
    return false
  }
}

export async function deleteMusicTrack(id) {
  if (!id) return false
  try {
    const db = await openDatabase()
    await withStore(db, 'readwrite', (store) => store.delete(id))
    return true
  } catch {
    return false
  }
}

export async function putMusicTracks(records) {
  const rows = (Array.isArray(records) ? records : []).filter((row) => row?.id && row?.blob)
  if (!rows.length) return false
  try {
    const db = await openDatabase()
    await withStore(db, 'readwrite', (store) => {
      for (const record of rows) {
        store.put({
          id: record.id,
          source: 'local',
          title: record.title || '本地歌曲',
          artist: record.artist || '本地音乐',
          tone: record.tone || 'violet',
          fileKey: record.fileKey || '',
          order: Number(record.order) || 0,
          mimeType: record.mimeType || record.blob?.type || '',
          blob: record.blob,
        })
      }
    })
    return true
  } catch {
    return false
  }
}
