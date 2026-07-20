import { USER_CLIENT_DATA_SECTIONS } from '@walleven/shared'
import storageService from '@/services/storage'
import {
  getScopedLocalItem,
  removeScopedLocalItem,
  setScopedLocalItem,
} from '@/services/scopedLocalStorage'

const STORAGE_PREFIX = 'walleven_'

export const DATA_BACKUP_VERSION = 1

export const DATA_SECTIONS = USER_CLIENT_DATA_SECTIONS

function storageKey(key) {
  return storageService.getRawKey(key)
}

function readLocalValue(key) {
  const raw = getScopedLocalItem(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function writeLocalValue(key, value) {
  if (value === undefined) {
    removeScopedLocalItem(key)
    return
  }
  setScopedLocalItem(key, typeof value === 'string' ? value : JSON.stringify(value))
}

function readStorageValue(key) {
  const scopedKeyExists = localStorage.getItem(storageKey(key)) !== null
  const legacyKeyExists =
    storageService.getActiveScope() === 'guest' &&
    localStorage.getItem(storageService.getLegacyRawKey(key)) !== null

  if (!scopedKeyExists && !legacyKeyExists) return undefined
  return storageService.get(key, null)
}

function writeStorageValue(key, value) {
  if (value === undefined) {
    storageService.remove(key)
    return
  }
  storageService.set(key, value)
}

function readEntry(entry) {
  return entry.type === 'local' ? readLocalValue(entry.key) : readStorageValue(entry.key)
}

function writeEntry(entry, value) {
  if (entry.type === 'local') {
    writeLocalValue(entry.key, value)
    return
  }
  writeStorageValue(entry.key, value)
}

function normalizeSectionIds(sectionIds = DATA_SECTIONS.map((section) => section.id)) {
  const wanted = new Set(sectionIds)
  return DATA_SECTIONS.filter((section) => wanted.has(section.id))
}

function getUniqueEntries(sectionIds) {
  const seen = new Set()
  const entries = []
  normalizeSectionIds(sectionIds).forEach((section) => {
    section.keys.forEach((entry) => {
      const id = `${entry.type}:${entry.key}`
      if (seen.has(id)) return
      seen.add(id)
      entries.push({ ...entry, id, sectionId: section.id })
    })
  })
  return entries
}

function measureEntryBytes(entry) {
  const value = readEntry(entry)
  if (value === undefined) return null
  return JSON.stringify(value).length
}

export function getDataSectionStats() {
  return DATA_SECTIONS.map((section) => {
    let bytes = 0
    let syncableBytes = 0
    let localOnlyBytes = 0
    let filled = 0

    section.keys.forEach((entry) => {
      const entryBytes = measureEntryBytes(entry)
      if (entryBytes === null) return
      filled += 1
      bytes += entryBytes
      if (entry.cloudState) syncableBytes += entryBytes
      else localOnlyBytes += entryBytes
    })

    return {
      id: section.id,
      label: section.label,
      description: section.description,
      icon: section.icon,
      keyCount: section.keys.length,
      filled,
      sizeKb: Number((bytes / 1024).toFixed(2)),
      syncableKb: Number((syncableBytes / 1024).toFixed(2)),
      localOnlyKb: Number((localOnlyBytes / 1024).toFixed(2)),
    }
  })
}

export function getCloudSyncableTotals() {
  const sections = getDataSectionStats()
  return sections.reduce(
    (result, section) => {
      result.syncableKb += Number(section.syncableKb || 0)
      result.localOnlyKb += Number(section.localOnlyKb || 0)
      result.totalKb += Number(section.sizeKb || 0)
      return result
    },
    { syncableKb: 0, localOnlyKb: 0, totalKb: 0 },
  )
}

export function createDataBackup(sectionIds) {
  const sections = {}

  normalizeSectionIds(sectionIds).forEach((section) => {
    sections[section.id] = {}
  })

  getUniqueEntries(sectionIds).forEach((entry) => {
    const value = readEntry(entry)
    if (value !== undefined) {
      sections[entry.sectionId][entry.id] = value
    }
  })

  return {
    app: 'walleven',
    version: DATA_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sections,
  }
}

export function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function exportDataBackup(sectionIds, filename = '') {
  const backup = createDataBackup(sectionIds)
  const date = new Date().toISOString().slice(0, 10)
  downloadJsonFile(backup, filename || `walleven-data-backup-${date}.json`)
  return backup
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result))
      } catch (error) {
        reject(error)
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

export function restoreDataBackup(backup, sectionIds) {
  if (
    !backup ||
    backup.app !== 'walleven' ||
    !backup.sections ||
    typeof backup.sections !== 'object'
  ) {
    throw new Error('不是有效的星空云绘数据备份')
  }

  normalizeSectionIds(sectionIds).forEach((section) => {
    const payload = backup.sections[section.id]
    if (!payload || typeof payload !== 'object') return

    getUniqueEntries([section.id]).forEach((entry) => {
      if (Object.prototype.hasOwnProperty.call(payload, entry.id)) {
        writeEntry(entry, payload[entry.id])
      }
    })
  })
}

export function clearDataSections(sectionIds) {
  getUniqueEntries(sectionIds).forEach((entry) => writeEntry(entry, undefined))
}
