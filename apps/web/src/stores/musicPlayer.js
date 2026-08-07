import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'starclouds-music-player'
const LOCAL_TRACK_LIMIT = 50

export const DEFAULT_MUSIC_TRACKS = Object.freeze([
  {
    id: 'default-cloud-drift',
    source: 'default',
    title: '云端漫游',
    artist: '星空云绘',
    url: '/music/cloud-drift.m4a',
    tone: 'violet',
  },
  {
    id: 'default-midnight-canvas',
    source: 'default',
    title: '午夜画布',
    artist: '星空云绘',
    url: '/music/midnight-canvas.m4a',
    tone: 'blue',
  },
  {
    id: 'default-pixel-sunrise',
    source: 'default',
    title: '像素晨光',
    artist: '星空云绘',
    url: '/music/pixel-sunrise.m4a',
    tone: 'coral',
  },
])

let audio = null
let localSequence = 0

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

export const useMusicPlayerStore = defineStore('music-player', () => {
  const preferences = readPreferences()
  const tracks = ref([...DEFAULT_MUSIC_TRACKS])
  const currentTrackId = ref(
    DEFAULT_MUSIC_TRACKS.some((track) => track.id === preferences.trackId)
      ? preferences.trackId
      : DEFAULT_MUSIC_TRACKS[0].id,
  )
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
  const currentTrack = computed(() => tracks.value[currentIndex.value] || tracks.value[0])
  const defaultTracks = computed(() => tracks.value.filter((track) => track.source === 'default'))
  const localTracks = computed(() => tracks.value.filter((track) => track.source === 'local'))

  function persist() {
    writePreferences({
      trackId:
        currentTrack.value?.source === 'default'
          ? currentTrackId.value
          : DEFAULT_MUSIC_TRACKS[0].id,
      volume: volume.value,
      loopMode: loopMode.value,
    })
  }

  function syncAudioSource() {
    const track = currentTrack.value
    if (!audio || !track) return
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
      errorMessage.value = '歌曲无法播放，请切换歌曲或重新选择本地文件'
    })
    audio.addEventListener('ended', () => {
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

  function prepare() {
    ensureAudio()
  }

  async function play(trackId) {
    if (trackId && tracks.value.some((track) => track.id === trackId)) {
      currentTrackId.value = trackId
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
    const track = tracks.value[resolveNextIndex(1)]
    if (track) await selectTrack(track.id, autoplay)
  }

  async function previous() {
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
    if (!player) return
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

  function importLocalFiles(fileList) {
    if (typeof URL === 'undefined') return 0
    const existing = new Set(localTracks.value.map((track) => track.fileKey))
    const available = Math.max(0, LOCAL_TRACK_LIMIT - localTracks.value.length)
    const imported = Array.from(fileList || [])
      .filter(isAudioFile)
      .filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
      .slice(0, available)
      .map((file, index) => ({
        id: `local-${Date.now()}-${localSequence++}-${index}`,
        source: 'local',
        title: titleFromFile(file.name),
        artist: '本地音乐',
        url: URL.createObjectURL(file),
        fileKey: `${file.name}:${file.size}:${file.lastModified}`,
        tone: ['mint', 'coral', 'blue', 'violet'][index % 4],
      }))

    if (!imported.length) return 0
    tracks.value.push(...imported)
    errorMessage.value = ''
    void selectTrack(imported[0].id, true)
    return imported.length
  }

  function removeLocalTrack(id) {
    const track = tracks.value.find((item) => item.id === id && item.source === 'local')
    if (!track) return
    const wasCurrent = currentTrackId.value === id
    if (wasCurrent) pause()
    URL.revokeObjectURL(track.url)
    tracks.value = tracks.value.filter((item) => item.id !== id)
    if (wasCurrent) {
      currentTrackId.value = DEFAULT_MUSIC_TRACKS[0].id
      syncAudioSource()
      persist()
    }
  }

  return {
    tracks,
    currentTrackId,
    currentTrack,
    defaultTracks,
    localTracks,
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
