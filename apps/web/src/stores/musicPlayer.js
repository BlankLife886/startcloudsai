import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import {
  deleteMusicTrack,
  listMusicTracks,
  putMusicTracks,
} from '@/services/musicLibraryStorage'

const STORAGE_KEY = 'starclouds-music-player'
/** Soft cap for local playlist + IndexedDB footprint. */
export const LOCAL_TRACK_LIMIT = 20

const EMPTY_TRACK = Object.freeze({
  id: '',
  source: 'local',
  title: '未选择歌曲',
  artist: '添加本地音乐开始播放',
  url: '',
  tone: 'violet',
})

let audio = null
let localSequence = 0
let hydratePromise = null
let libraryReady = false

function readPreferences() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writePreferences(value) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* storage can be disabled */
  }
}

function titleFromFile(name) {
  return String(name || '本地歌曲').replace(/\.[^.]+$/, '') || '本地歌曲'
}

function isAudioFile(file) {
  if (String(file?.type || '').startsWith('audio/')) return true
  return /\.(aac|flac|m4a|mp3|ogg|wav|webm)$/i.test(String(file?.name || ''))
}

function scheduleIdle(task) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => task(), { timeout: 2500 })
    return
  }
  setTimeout(task, 0)
}

function trackFromRecord(record, index = 0) {
  const blob = record.blob
  return {
    id: record.id,
    source: 'local',
    title: record.title || '本地歌曲',
    artist: record.artist || '本地音乐',
    url: typeof URL !== 'undefined' && blob ? URL.createObjectURL(blob) : '',
    fileKey: record.fileKey || '',
    tone: record.tone || ['mint', 'coral', 'blue', 'violet'][index % 4],
    blob,
  }
}

function toPlainBlob(value) {
  const raw = toRaw(value)
  if (!raw) return null
  if (typeof Blob !== 'undefined' && raw instanceof Blob) return raw
  return raw
}

function toStoredRecord(track, order) {
  const blob = toPlainBlob(track.blob)
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    tone: track.tone,
    fileKey: track.fileKey,
    order,
    mimeType: blob?.type || '',
    blob,
  }
}

export const useMusicPlayerStore = defineStore('music-player', () => {
  const preferences = readPreferences()
  const tracks = ref([])
  const currentTrackId = ref(String(preferences.currentTrackId || ''))
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(Math.min(1, Math.max(0, Number(preferences.volume ?? 0.72))))
  const loopMode = ref(
    ['all', 'one', 'shuffle'].includes(preferences.loopMode) ? preferences.loopMode : 'all',
  )
  const errorMessage = ref('')

  const currentIndex = computed(() =>
    Math.max(
      0,
      tracks.value.findIndex((track) => track.id === currentTrackId.value),
    ),
  )
  const currentTrack = computed(() => {
    if (!tracks.value.length) return EMPTY_TRACK
    return tracks.value.find((track) => track.id === currentTrackId.value) || tracks.value[0]
  })
  const localTracks = computed(() => tracks.value.filter((track) => track.source === 'local'))
  const hasTracks = computed(() => tracks.value.length > 0)
  const trackLimit = LOCAL_TRACK_LIMIT
  const canAddTracks = computed(() => localTracks.value.length < LOCAL_TRACK_LIMIT)

  function persist() {
    writePreferences({
      volume: volume.value,
      loopMode: loopMode.value,
      currentTrackId: currentTrackId.value || '',
    })
  }

  function syncAudioSource() {
    if (!audio) return
    const track = currentTrack.value
    if (!track?.url) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      delete audio.dataset.trackId
      currentTime.value = 0
      duration.value = 0
      isPlaying.value = false
      return
    }
    if (audio.dataset.trackId === track.id) return
    audio.pause()
    audio.src = track.url
    audio.dataset.trackId = track.id
    audio.load()
    currentTime.value = 0
    duration.value = 0
  }

  function ensureAudio() {
    if (typeof Audio === 'undefined') return null
    if (audio) return audio

    audio = new Audio()
    audio.preload = 'metadata'
    audio.volume = volume.value
    audio.addEventListener('loadedmetadata', () => {
      duration.value = Number.isFinite(audio.duration) ? audio.duration : 0
    })
    audio.addEventListener('durationchange', () => {
      duration.value = Number.isFinite(audio.duration) ? audio.duration : 0
    })
    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio.currentTime || 0
    })
    audio.addEventListener('play', () => {
      isPlaying.value = true
      errorMessage.value = ''
    })
    audio.addEventListener('pause', () => {
      isPlaying.value = false
    })
    audio.addEventListener('error', () => {
      isPlaying.value = false
      errorMessage.value = '歌曲无法播放，请重新选择本地文件'
    })
    audio.addEventListener('ended', () => {
      if (!tracks.value.length) return
      if (loopMode.value === 'one') {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        return
      }
      void next(true)
    })
    syncAudioSource()
    return audio
  }

  async function hydrateLibrary() {
    if (libraryReady) return
    if (hydratePromise) return hydratePromise

    hydratePromise = (async () => {
      try {
        const records = await listMusicTracks()
        if (!tracks.value.length && records.length) {
          const limited = records.slice(0, LOCAL_TRACK_LIMIT)
          tracks.value = limited.map((record, index) => trackFromRecord(record, index))
          if (records.length > LOCAL_TRACK_LIMIT) {
            for (const extra of records.slice(LOCAL_TRACK_LIMIT)) {
              void deleteMusicTrack(extra.id)
            }
          }
          if (
            !currentTrackId.value ||
            !tracks.value.some((track) => track.id === currentTrackId.value)
          ) {
            currentTrackId.value = tracks.value[0].id
          }
          persist()
          syncAudioSource()
        }
      } catch {
        /* local library is optional */
      } finally {
        libraryReady = true
      }
    })()

    return hydratePromise
  }

  function prepare() {
    ensureAudio()
    // Idle hydrate keeps first paint / main business paths off the critical path.
    scheduleIdle(() => {
      void hydrateLibrary()
    })
  }

  async function play(trackId) {
    await hydrateLibrary()
    if (!tracks.value.length) {
      errorMessage.value = '请先添加本地歌曲'
      return false
    }
    if (trackId && tracks.value.some((track) => track.id === trackId)) {
      currentTrackId.value = trackId
    }
    if (!currentTrackId.value || !tracks.value.some((track) => track.id === currentTrackId.value)) {
      currentTrackId.value = tracks.value[0].id
    }
    const player = ensureAudio()
    if (!player) {
      errorMessage.value = '当前浏览器不支持音频播放'
      return false
    }
    syncAudioSource()
    errorMessage.value = ''
    try {
      await player.play()
      persist()
      return true
    } catch (error) {
      isPlaying.value = false
      errorMessage.value =
        error?.name === 'NotAllowedError' ? '请点击播放按钮开始播放' : '歌曲加载失败'
      return false
    }
  }

  function pause() {
    audio?.pause()
  }

  function toggle() {
    if (isPlaying.value) {
      pause()
      return
    }
    void play()
  }

  async function selectTrack(id, autoplay = true) {
    await hydrateLibrary()
    if (!tracks.value.some((track) => track.id === id)) return
    const changed = currentTrackId.value !== id
    currentTrackId.value = id
    if (changed) syncAudioSource()
    persist()
    if (autoplay) await play()
  }

  function resolveNextIndex(direction) {
    if (tracks.value.length < 2) return currentIndex.value
    if (loopMode.value === 'shuffle') {
      let candidate = currentIndex.value
      while (candidate === currentIndex.value)
        candidate = Math.floor(Math.random() * tracks.value.length)
      return candidate
    }
    return (currentIndex.value + direction + tracks.value.length) % tracks.value.length
  }

  async function next(autoplay = isPlaying.value) {
    await hydrateLibrary()
    if (!tracks.value.length) return
    const track = tracks.value[resolveNextIndex(1)]
    if (track) await selectTrack(track.id, autoplay)
  }

  async function previous() {
    await hydrateLibrary()
    if (!tracks.value.length) return
    const player = ensureAudio()
    if (player && player.currentTime > 4) {
      seek(0)
      return
    }
    const track = tracks.value[resolveNextIndex(-1)]
    if (track) await selectTrack(track.id, isPlaying.value)
  }

  function seek(seconds) {
    const player = ensureAudio()
    if (!player || !tracks.value.length) return
    const nextTime = Math.min(duration.value || 0, Math.max(0, Number(seconds) || 0))
    player.currentTime = nextTime
    currentTime.value = nextTime
  }

  function setVolume(value) {
    volume.value = Math.min(1, Math.max(0, Number(value) || 0))
    if (audio) audio.volume = volume.value
    persist()
  }

  function cycleLoopMode() {
    const modes = ['all', 'one', 'shuffle']
    loopMode.value = modes[(modes.indexOf(loopMode.value) + 1) % modes.length]
    persist()
  }

  async function importLocalFiles(fileList) {
    if (typeof URL === 'undefined') return 0
    // Caller must snapshot FileList first; hydrate is async and can outlive the input.
    const files = Array.isArray(fileList) ? fileList : Array.from(fileList || [])
    await hydrateLibrary()
    if (!canAddTracks.value) {
      errorMessage.value = `播放列表最多 ${LOCAL_TRACK_LIMIT} 首，请先移除部分歌曲`
      return 0
    }

    const existing = new Set(localTracks.value.map((track) => track.fileKey))
    const available = Math.max(0, LOCAL_TRACK_LIMIT - localTracks.value.length)
    const candidates = files
      .filter(isAudioFile)
      .filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
    const imported = candidates.slice(0, available).map((file, index) => {
      const blob = toPlainBlob(file)
      return {
        id: `local-${Date.now()}-${localSequence++}-${index}`,
        source: 'local',
        title: titleFromFile(file.name),
        artist: '本地音乐',
        url: blob ? URL.createObjectURL(blob) : '',
        fileKey: `${file.name}:${file.size}:${file.lastModified}`,
        tone: ['mint', 'coral', 'blue', 'violet'][index % 4],
        blob,
      }
    })

    if (!imported.length) {
      errorMessage.value = candidates.length
        ? `播放列表最多 ${LOCAL_TRACK_LIMIT} 首`
        : files.length
          ? '未识别到可添加的音频文件'
          : '未选择文件'
      return 0
    }

    const orderBase = Date.now()
    tracks.value.push(...imported)
    errorMessage.value =
      candidates.length > imported.length
        ? `已添加 ${imported.length} 首，播放列表上限为 ${LOCAL_TRACK_LIMIT} 首`
        : ''
    void putMusicTracks(imported.map((track, index) => toStoredRecord(track, orderBase + index)))
    // Autoplay may be blocked after the async hydrate await; adding still succeeded.
    await selectTrack(imported[0].id, false)
    try {
      const player = ensureAudio()
      if (player) await player.play()
    } catch (error) {
      if (error?.name !== 'NotAllowedError') {
        errorMessage.value = '歌曲加载失败，可点击播放重试'
      }
    }
    return imported.length
  }

  async function removeLocalTrack(id) {
    await hydrateLibrary()
    const track = tracks.value.find((item) => item.id === id && item.source === 'local')
    if (!track) return
    const wasCurrent = currentTrackId.value === id
    if (wasCurrent) pause()
    if (track.url) URL.revokeObjectURL(track.url)
    tracks.value = tracks.value.filter((item) => item.id !== id)
    void deleteMusicTrack(id)
    if (!wasCurrent) {
      persist()
      return
    }
    if (tracks.value.length) {
      currentTrackId.value = tracks.value[0].id
      syncAudioSource()
    } else {
      currentTrackId.value = ''
      syncAudioSource()
    }
    persist()
  }

  return {
    tracks,
    currentTrackId,
    currentTrack,
    localTracks,
    hasTracks,
    trackLimit,
    canAddTracks,
    isPlaying,
    currentTime,
    duration,
    volume,
    loopMode,
    errorMessage,
    prepare,
    play,
    pause,
    toggle,
    selectTrack,
    next,
    previous,
    seek,
    setVolume,
    cycleLoopMode,
    importLocalFiles,
    removeLocalTrack,
  }
})
