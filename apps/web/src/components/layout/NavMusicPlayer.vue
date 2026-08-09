<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMusicPlayerStore } from '@/stores/musicPlayer'
import { useAppearanceStore } from '@/stores/appearance'

const musicStore = useMusicPlayerStore()
const appearanceStore = useAppearanceStore()
const {
  currentTrack,
  currentTrackId,
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
} = storeToRefs(musicStore)

const rootEl = ref(null)
const fileInputEl = ref(null)
const panelOpen = ref(false)
const loopLabel = computed(
  () => ({ all: '列表循环', one: '单曲循环', shuffle: '随机播放' })[loopMode.value],
)
const loopIcon = computed(() =>
  ({ all: 'bi-repeat', one: 'bi-repeat-1', shuffle: 'bi-shuffle' })[loopMode.value],
)
const summaryTitle = computed(() =>
  hasTracks.value
    ? `${currentTrack.value.title} · ${currentTrack.value.artist}`
    : '添加本地音乐开始播放',
)
const progressPercent = computed(() =>
  duration.value ? Math.min(100, (currentTime.value / duration.value) * 100) : 0,
)
const volumePercent = computed(() => Math.round(volume.value * 100))

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function togglePanel() {
  panelOpen.value = !panelOpen.value
}

function openFilePicker() {
  if (!canAddTracks.value) {
    musicStore.errorMessage = `播放列表最多 ${trackLimit.value} 首，请先移除部分歌曲`
    return
  }
  fileInputEl.value?.click()
}

function handleFiles(event) {
  // Snapshot before clearing: import is async and FileList is live.
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  void musicStore.importLocalFiles(files)
}

function handleDocumentPointerDown(event) {
  if (!panelOpen.value || rootEl.value?.contains(event.target)) return
  panelOpen.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') panelOpen.value = false
}

onMounted(() => {
  musicStore.prepare()
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    ref="rootEl"
    class="nav-music-player"
    :class="{ open: panelOpen, playing: isPlaying, 'is-dark': appearanceStore.isDark }"
    @click.stop
  >
    <div class="nav-music-player__compact">
      <button
        type="button"
        class="nav-music-player__summary"
        :aria-expanded="panelOpen"
        aria-haspopup="dialog"
        :aria-label="hasTracks ? `音乐播放器：${currentTrack.title}` : '音乐播放器：添加本地歌曲'"
        :title="summaryTitle"
        @click="togglePanel"
      >
        <span
          class="nav-music-player__disc"
          :class="`tone-${currentTrack.tone}`"
          aria-hidden="true"
        >
          <i class="bi bi-music-note-beamed"></i>
        </span>
      </button>
      <button
        type="button"
        class="nav-music-player__quick-play"
        :aria-label="isPlaying ? '暂停音乐' : '播放音乐'"
        :title="isPlaying ? '暂停' : '播放'"
        @click="musicStore.toggle"
      >
        <span class="nav-music-player__play-orb" aria-hidden="true">
          <i class="bi" :class="isPlaying ? 'bi-pause-fill' : 'bi-play-fill'"></i>
        </span>
      </button>
    </div>

    <Transition name="music-panel">
      <section
        v-if="panelOpen"
        class="nav-music-panel"
        :data-tone="currentTrack.tone"
        role="dialog"
        aria-label="音乐播放器"
      >
        <div class="nav-music-panel__glow" aria-hidden="true"></div>

        <header class="nav-music-panel__head">
          <div class="nav-music-panel__brand">
            <span>本地播放器</span>
          </div>
          <button type="button" aria-label="关闭播放器" title="关闭" @click="panelOpen = false">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="nav-music-stage">
          <div class="nav-music-vinyl" :class="{ spinning: isPlaying }" aria-hidden="true">
            <div class="nav-music-vinyl__plate" :class="`tone-${currentTrack.tone}`">
              <i></i><i></i><i></i>
              <span>
                <b class="bi bi-music-note-beamed"></b>
              </span>
            </div>
          </div>

          <div class="nav-music-meta">
            <strong>{{ currentTrack.title }}</strong>
            <span>{{ currentTrack.artist }}</span>
            <small v-if="hasTracks">{{ isPlaying ? '正在播放' : '已暂停' }}</small>
            <small v-else>等待添加歌曲</small>
          </div>
        </div>

        <div class="nav-music-progress">
          <input
            type="range"
            min="0"
            :max="Math.max(duration, 1)"
            step="0.1"
            :value="currentTime"
            aria-label="播放进度"
            :style="{ '--progress': `${progressPercent}%` }"
            @input="musicStore.seek($event.target.value)"
          />
          <div class="nav-music-progress__times">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>

        <div class="nav-music-controls">
          <button
            type="button"
            class="nav-music-controls__side"
            :title="loopLabel"
            :aria-label="loopLabel"
            @click="musicStore.cycleLoopMode"
          >
            <i class="bi" :class="loopIcon" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="nav-music-controls__side"
            title="上一首"
            aria-label="上一首"
            @click="musicStore.previous"
          >
            <i class="bi bi-skip-start-fill" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="nav-music-controls__play"
            :title="isPlaying ? '暂停' : '播放'"
            :aria-label="isPlaying ? '暂停' : '播放'"
            @click="musicStore.toggle"
          >
            <i
              class="bi"
              :class="isPlaying ? 'bi-pause-fill' : 'bi-play-fill'"
              aria-hidden="true"
            ></i>
          </button>
          <button
            type="button"
            class="nav-music-controls__side"
            title="下一首"
            aria-label="下一首"
            @click="musicStore.next()"
          >
            <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
          </button>
          <label class="nav-music-volume" title="音量">
            <i
              class="bi"
              :class="volume === 0 ? 'bi-volume-mute-fill' : 'bi-volume-up-fill'"
              aria-hidden="true"
            ></i>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              :value="volume"
              aria-label="音量"
              :style="{ '--progress': `${volumePercent}%` }"
              @input="musicStore.setVolume($event.target.value)"
            />
          </label>
        </div>

        <p v-if="errorMessage" class="nav-music-error">
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>{{ errorMessage }}
        </p>

        <section class="nav-music-playlist">
          <div class="nav-music-playlist__head">
            <div class="nav-music-playlist__title">
              <strong>播放列表</strong>
              <span>{{ localTracks.length }}/{{ trackLimit }}</span>
            </div>
            <button
              type="button"
              class="nav-music-import"
              :disabled="!canAddTracks"
              :title="canAddTracks ? '添加本地歌曲' : `最多 ${trackLimit} 首`"
              @click="openFilePicker"
            >
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <span>{{ canAddTracks ? '添加歌曲' : '已满' }}</span>
            </button>
            <input
              ref="fileInputEl"
              class="nav-music-file-input"
              type="file"
              accept="audio/*,.aac,.flac,.m4a,.mp3,.ogg,.wav,.webm"
              multiple
              @change="handleFiles"
            />
          </div>

          <div
            v-if="localTracks.length"
            class="nav-music-list"
            role="listbox"
            aria-label="本地歌曲列表"
          >
            <div
              v-for="(track, index) in localTracks"
              :key="track.id"
              class="nav-music-track"
              :class="{ active: currentTrackId === track.id }"
              role="option"
              tabindex="0"
              :aria-selected="currentTrackId === track.id"
              @click="musicStore.selectTrack(track.id)"
              @keydown.enter="musicStore.selectTrack(track.id)"
              @keydown.space.prevent="musicStore.selectTrack(track.id)"
            >
              <em>{{ String(index + 1).padStart(2, '0') }}</em>
              <span class="nav-music-track__icon" :class="`tone-${track.tone}`" aria-hidden="true">
                <i
                  v-if="currentTrackId === track.id && isPlaying"
                  class="bi bi-soundwave"
                ></i>
                <i v-else class="bi bi-music-note"></i>
              </span>
              <span class="nav-music-track__copy">
                <strong>{{ track.title }}</strong>
                <small>{{ track.artist }}</small>
              </span>
              <span v-if="currentTrackId === track.id" class="nav-music-track__state">
                {{ isPlaying ? '播放中' : '当前' }}
              </span>
              <button
                type="button"
                class="nav-music-track__remove"
                title="移除本地歌曲"
                aria-label="移除本地歌曲"
                @click.stop="musicStore.removeLocalTrack(track.id)"
              >
                <i class="bi bi-trash3" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <button v-else type="button" class="nav-music-empty" @click="openFilePicker">
            <i class="bi bi-file-earmark-music" aria-hidden="true"></i>
            <strong>添加本地歌曲开始播放</strong>
            <span>最多 {{ trackLimit }} 首 · MP3 / AAC / FLAC / WAV</span>
          </button>
        </section>

        <p class="nav-music-privacy">
          <i class="bi bi-shield-check" aria-hidden="true"></i>
          本地文件不会上传，仅保存在本机浏览器中
        </p>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.nav-music-player {
  position: relative;
  flex: 0 0 auto;
  height: 36px;
  color: var(--nav-heading);
}

.nav-music-player__compact {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  min-height: 36px;
  padding: 4px;
  border: 1px solid rgb(167 139 250 / 42%);
  border-radius: 999px;
  background:
    radial-gradient(circle at 18% 0%, rgb(255 255 255 / 50%), transparent 42%),
    linear-gradient(122deg, #f3efff 0%, #e8e0ff 48%, #ddd2ff 100%);
  box-shadow: 0 8px 20px rgb(109 92 255 / 14%);
  box-sizing: border-box;
  transition:
    transform 150ms ease,
    box-shadow 150ms ease,
    border-color 150ms ease;
}

.nav-music-player.open .nav-music-player__compact,
.nav-music-player__compact:hover {
  border-color: rgb(139 92 246 / 48%);
  transform: translateY(-1px);
  box-shadow: 0 11px 24px rgb(109 92 255 / 22%);
}

.nav-music-player__summary,
.nav-music-player__quick-play {
  display: grid;
  height: 100%;
  place-items: center;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.nav-music-player__summary {
  width: 28px;
}

.nav-music-player__disc {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  color: #fff;
  border: 1px solid rgb(255 255 255 / 58%);
  border-radius: 50%;
  font-size: 0.7rem;
  box-shadow: 0 2px 6px rgb(91 77 255 / 24%);
  box-sizing: border-box;
  transition:
    box-shadow 160ms ease,
    border-color 160ms ease;
}

.playing .nav-music-player__disc {
  animation: music-disc-spin 5s linear infinite;
  border-color: rgb(255 255 255 / 72%);
  box-shadow:
    0 0 0 2px rgb(139 92 246 / 22%),
    0 2px 8px rgb(91 77 255 / 30%);
}

.nav-music-player__quick-play {
  width: 28px;
}

.nav-music-player__play-orb {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  color: #fff;
  border: 1px solid rgb(255 255 255 / 45%);
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 24%, rgb(255 255 255 / 26%), transparent 46%),
    linear-gradient(145deg, #6d5cff 0%, #8b5cf6 58%, #a855f7 100%);
  box-shadow: 0 2px 6px rgb(109 92 255 / 26%);
  box-sizing: border-box;
  transition:
    transform 140ms ease,
    box-shadow 140ms ease,
    filter 140ms ease;
}

.nav-music-player__play-orb .bi-play-fill {
  margin-left: 1px;
  font-size: 0.92rem;
  line-height: 1;
}

.nav-music-player__play-orb .bi-pause-fill {
  font-size: 0.86rem;
  line-height: 1;
}

.nav-music-player__quick-play:hover .nav-music-player__play-orb {
  transform: scale(1.04);
  filter: brightness(1.04);
  border-color: rgb(255 255 255 / 62%);
  box-shadow: 0 3px 8px rgb(109 92 255 / 34%);
}

.nav-music-player__summary:focus-visible,
.nav-music-player__quick-play:focus-visible {
  outline: none;
}

.nav-music-player__summary:focus-visible .nav-music-player__disc,
.nav-music-player__quick-play:focus-visible .nav-music-player__play-orb {
  outline: 2px solid #8b5cf6;
  outline-offset: 1px;
}

.nav-music-panel {
  --music-ink: #1d1b27;
  --music-muted: #7a7788;
  --music-line: rgb(40 34 72 / 8%);
  --music-soft: #f4f2fb;
  --music-accent: #6d5cff;
  --music-panel: #fff;

  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 80;
  width: min(276px, calc(100vw - 24px));
  overflow: hidden;
  color: var(--music-ink);
  border: 1px solid var(--music-line);
  border-radius: 16px;
  background: var(--music-panel);
  box-shadow:
    0 16px 40px rgb(28 22 60 / 16%),
    0 2px 0 rgb(255 255 255 / 60%) inset;
}

.nav-music-panel__glow {
  position: absolute;
  inset: 0 0 auto;
  height: 120px;
  background:
    radial-gradient(circle at 50% 0%, rgb(109 92 255 / 22%), transparent 62%),
    linear-gradient(180deg, rgb(244 241 255 / 95%), transparent 100%);
  pointer-events: none;
}

.nav-music-panel[data-tone='blue'] .nav-music-panel__glow {
  background:
    radial-gradient(circle at 50% 0%, rgb(36 111 191 / 22%), transparent 62%),
    linear-gradient(180deg, rgb(236 246 255 / 95%), transparent 100%);
}

.nav-music-panel[data-tone='coral'] .nav-music-panel__glow {
  background:
    radial-gradient(circle at 50% 0%, rgb(211 79 123 / 20%), transparent 62%),
    linear-gradient(180deg, rgb(255 241 245 / 95%), transparent 100%);
}

.nav-music-panel[data-tone='mint'] .nav-music-panel__glow {
  background:
    radial-gradient(circle at 50% 0%, rgb(36 138 128 / 20%), transparent 62%),
    linear-gradient(180deg, rgb(236 250 246 / 95%), transparent 100%);
}

.nav-music-panel[data-tone='violet'] .nav-music-panel__glow {
  background:
    radial-gradient(circle at 50% 0%, rgb(109 92 255 / 22%), transparent 62%),
    linear-gradient(180deg, rgb(244 241 255 / 95%), transparent 100%);
}

.nav-music-panel__head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px 0;
}

.nav-music-panel__brand span {
  font-size: 0.78rem;
  font-weight: 780;
}

.nav-music-panel__head button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  color: var(--music-muted);
  border: 1px solid var(--music-line);
  border-radius: 50%;
  background: rgb(255 255 255 / 72%);
  font-size: 0.68rem;
  cursor: pointer;
}

.nav-music-panel__head button:hover {
  color: var(--music-ink);
  background: #fff;
}

.nav-music-stage {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 10px 12px 4px;
}

.nav-music-vinyl {
  display: grid;
  width: 72px;
  height: 72px;
  place-items: center;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, transparent 46%, rgb(20 16 40 / 8%) 47%, transparent 52%),
    radial-gradient(circle at 50% 50%, rgb(255 255 255 / 70%), rgb(236 232 250));
  box-shadow:
    0 8px 18px rgb(48 36 96 / 12%),
    inset 0 1px 0 rgb(255 255 255 / 80%);
}

.nav-music-vinyl__plate {
  position: relative;
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 50%;
  box-shadow:
    0 6px 14px rgb(0 0 0 / 16%),
    inset 0 0 0 1px rgb(255 255 255 / 28%);
}

.nav-music-vinyl__plate i {
  position: absolute;
  inset: 7px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 50%;
}

.nav-music-vinyl__plate i:nth-child(2) {
  inset: 14px;
}

.nav-music-vinyl__plate i:nth-child(3) {
  inset: 21px;
}

.nav-music-vinyl__plate span {
  position: relative;
  z-index: 1;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: #fff;
  border: 1.5px solid rgb(255 255 255 / 55%);
  border-radius: 50%;
  background: rgb(18 16 34 / 28%);
  font-size: 0.68rem;
}

.nav-music-vinyl.spinning .nav-music-vinyl__plate {
  animation: music-disc-spin 8s linear infinite;
}

.nav-music-player__disc.tone-violet,
.nav-music-vinyl__plate.tone-violet,
.nav-music-track__icon.tone-violet {
  background: linear-gradient(145deg, #5d4de7, #a956d8);
}

.nav-music-player__disc.tone-blue,
.nav-music-vinyl__plate.tone-blue,
.nav-music-track__icon.tone-blue {
  background: linear-gradient(145deg, #246fbf, #55b6cf);
}

.nav-music-player__disc.tone-coral,
.nav-music-vinyl__plate.tone-coral,
.nav-music-track__icon.tone-coral {
  background: linear-gradient(145deg, #d34f7b, #f19467);
}

.nav-music-player__disc.tone-mint,
.nav-music-vinyl__plate.tone-mint,
.nav-music-track__icon.tone-mint {
  background: linear-gradient(145deg, #248a80, #64bd8a);
}

.nav-music-meta {
  display: grid;
  justify-items: start;
  gap: 2px;
  min-width: 0;
  text-align: left;
}

.nav-music-meta strong {
  max-width: 100%;
  overflow: hidden;
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-music-meta span {
  color: var(--music-muted);
  font-size: 0.68rem;
}

.nav-music-meta small {
  margin-top: 1px;
  color: var(--music-accent);
  font-size: 0.6rem;
  font-weight: 720;
}

.nav-music-progress {
  position: relative;
  z-index: 1;
  padding: 6px 12px 0;
}

.nav-music-progress input,
.nav-music-volume input {
  width: 100%;
  height: 4px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--music-accent) var(--progress),
    #e6e2f2 var(--progress)
  );
  cursor: pointer;
  appearance: none;
}

.nav-music-progress input::-webkit-slider-thumb,
.nav-music-volume input::-webkit-slider-thumb {
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--music-accent);
  box-shadow: 0 2px 8px rgb(109 92 255 / 28%);
  appearance: none;
}

.nav-music-progress__times {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  color: var(--music-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.58rem;
  font-variant-numeric: tabular-nums;
}

.nav-music-controls {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 28px 28px 40px 28px minmax(56px, 1fr);
  align-items: center;
  gap: 4px;
  padding: 8px 12px 2px;
}

.nav-music-controls__side,
.nav-music-controls__play {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.nav-music-controls__side {
  width: 28px;
  height: 28px;
  color: #5a5768;
  border-radius: 50%;
  background: transparent;
  font-size: 0.88rem;
}

.nav-music-controls__side:hover {
  color: var(--music-accent);
  background: rgb(109 92 255 / 8%);
}

.nav-music-controls__play {
  width: 40px;
  height: 40px;
  color: #fff;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 24%, rgb(255 255 255 / 28%), transparent 48%),
    linear-gradient(145deg, #6d5cff, #8b5cf6 60%, #a855f7);
  box-shadow: 0 8px 18px rgb(109 92 255 / 28%);
  font-size: 1.05rem;
}

.nav-music-controls__play .bi-play-fill {
  margin-left: 2px;
}

.nav-music-controls__play:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

.nav-music-volume {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: #74717f;
  font-size: 0.74rem;
}

.nav-music-error {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 6px 10px 0;
  padding: 6px 8px;
  color: #a94455;
  border-radius: 8px;
  background: #fff0f2;
  font-size: 0.62rem;
}

.nav-music-playlist {
  position: relative;
  z-index: 1;
  margin: 8px 10px 0;
  padding: 8px;
  border: 1px solid var(--music-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--music-soft) 88%, #fff);
}

.nav-music-playlist__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.nav-music-playlist__title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.nav-music-playlist__title strong {
  font-size: 0.7rem;
  font-weight: 760;
}

.nav-music-playlist__title span {
  display: inline-flex;
  min-width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  color: var(--music-accent);
  border-radius: 999px;
  background: rgb(109 92 255 / 10%);
  font-size: 0.58rem;
  font-weight: 740;
}

.nav-music-import {
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 0;
  color: #fff;
  border-radius: 999px;
  background: linear-gradient(135deg, #6d5cff, #8b5cf6);
  box-shadow: 0 4px 10px rgb(109 92 255 / 18%);
  font: inherit;
  font-size: 0.62rem;
  font-weight: 720;
  white-space: nowrap;
  cursor: pointer;
}

.nav-music-import:disabled {
  color: #8b8798;
  background: #e8e5f0;
  box-shadow: none;
  cursor: not-allowed;
}

.nav-music-file-input {
  display: none;
}

.nav-music-list {
  display: grid;
  max-height: 112px;
  gap: 2px;
  overflow: auto;
  scrollbar-width: thin;
}

.nav-music-track {
  display: grid;
  min-width: 0;
  min-height: 34px;
  grid-template-columns: 18px 26px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 5px;
  padding: 3px 5px;
  color: var(--music-ink);
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nav-music-track > em {
  color: #a8a5b4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.62rem;
  font-style: normal;
  font-weight: 700;
}

.nav-music-track:hover,
.nav-music-track.active {
  border-color: rgb(109 92 255 / 14%);
  background: #fff;
  box-shadow: 0 2px 8px rgb(48 36 96 / 5%);
}

.nav-music-track.active > em {
  color: var(--music-accent);
}

.nav-music-track__icon {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  color: #fff;
  border-radius: 7px;
  font-size: 0.66rem;
}

.nav-music-track__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0;
}

.nav-music-track__copy strong {
  overflow: hidden;
  font-size: 0.68rem;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-music-track__copy small,
.nav-music-track__state {
  color: #94919e;
  font-size: 0.54rem;
}

.nav-music-track__state {
  color: var(--music-accent);
  white-space: nowrap;
}

.nav-music-track__remove {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  color: #aaa7b1;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 0.7rem;
  cursor: pointer;
}

.nav-music-track__remove:hover {
  color: #c14e61;
  background: #ffecef;
}

.nav-music-empty {
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 2px;
  color: var(--music-muted);
  border: 1px dashed #d5d0e4;
  border-radius: 10px;
  background: rgb(255 255 255 / 55%);
  cursor: pointer;
}

.nav-music-empty i {
  color: var(--music-accent);
  font-size: 1.05rem;
}

.nav-music-empty strong {
  color: #433f50;
  font-size: 0.68rem;
}

.nav-music-empty span {
  font-size: 0.56rem;
}

.nav-music-privacy {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 0;
  padding: 8px 12px 10px;
  color: #9b98a4;
  font-size: 0.54rem;
}

.nav-music-privacy i {
  color: #4b9b7d;
}

.nav-music-player.is-dark .nav-music-panel {
  --music-ink: rgb(255 255 255 / 92%);
  --music-muted: rgb(255 255 255 / 52%);
  --music-line: rgb(255 255 255 / 10%);
  --music-soft: #1c1c24;
  --music-panel: #16161d;
  box-shadow: 0 28px 72px rgb(0 0 0 / 48%);
}

.nav-music-player.is-dark .nav-music-panel__head button,
.nav-music-player.is-dark .nav-music-track:hover,
.nav-music-player.is-dark .nav-music-track.active,
.nav-music-player.is-dark .nav-music-empty {
  background: #222229;
}

.nav-music-player.is-dark .nav-music-progress input,
.nav-music-player.is-dark .nav-music-volume input {
  background: linear-gradient(to right, #8b7bff var(--progress), #45434e var(--progress));
}

.nav-music-player.is-dark .nav-music-playlist__title span {
  color: #c4b5fd;
  background: rgb(109 92 255 / 18%);
}

.nav-music-player.is-dark .nav-music-track {
  color: rgb(255 255 255 / 86%);
}

.nav-music-player.is-dark .nav-music-empty strong {
  color: rgb(255 255 255 / 78%);
}

.nav-music-player.is-dark .nav-music-empty {
  border-color: rgb(255 255 255 / 14%);
}

.music-panel-enter-active,
.music-panel-leave-active {
  transition:
    opacity 160ms ease,
    transform 200ms ease;
  transform-origin: top right;
}

.music-panel-enter-from,
.music-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

@keyframes music-disc-spin {
  to {
    transform: rotate(360deg);
  }
}

:global(.nav-compact) .nav-music-player,
:global(.nav-compact) .nav-music-player__compact {
  height: 32px;
  min-height: 32px;
  padding: 2px;
}

:global(.nav-compact) .nav-music-player__summary,
:global(.nav-compact) .nav-music-player__quick-play {
  width: 28px;
}

:global(.nav-compact) .nav-music-player__disc,
:global(.nav-compact) .nav-music-player__play-orb {
  width: 22px;
  height: 22px;
}

:global(.nav-compact) .nav-music-player__disc {
  font-size: 0.66rem;
}

:global(.nav-compact) .nav-music-player__play-orb .bi-play-fill {
  font-size: 0.82rem;
}

:global(.nav-compact) .nav-music-player__play-orb .bi-pause-fill {
  font-size: 0.76rem;
}

@media (prefers-reduced-motion: reduce) {
  .playing .nav-music-player__disc,
  .nav-music-vinyl.spinning .nav-music-vinyl__plate {
    animation: none;
  }

  .nav-music-player__play-orb,
  .nav-music-player__quick-play:hover .nav-music-player__play-orb,
  .nav-music-controls__play:hover {
    transition: none;
    transform: none;
  }
}

@media (max-width: 760px) {
  .nav-music-player__quick-play {
    display: none;
  }

  .nav-music-player__summary {
    width: 36px;
  }

  .nav-music-player__compact {
    padding: 4px;
  }

  .nav-music-panel {
    position: fixed;
    top: 68px;
    right: 12px;
    left: 12px;
    width: auto;
  }
}

@media (max-width: 390px) {
  .nav-music-stage {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 10px;
  }

  .nav-music-vinyl {
    width: 64px;
    height: 64px;
  }

  .nav-music-vinyl__plate {
    width: 52px;
    height: 52px;
  }

  .nav-music-controls {
    grid-template-columns: 26px 26px 36px 26px minmax(48px, 1fr);
    gap: 3px;
  }

  .nav-music-controls__play {
    width: 36px;
    height: 36px;
  }

  .nav-music-import span {
    display: none;
  }
}
</style>
