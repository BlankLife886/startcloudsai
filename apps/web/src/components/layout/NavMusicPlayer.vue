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
  defaultTracks,
  localTracks,
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
const activeLibrary = ref('default')
const visibleTracks = computed(() =>
  activeLibrary.value === 'local' ? localTracks.value : defaultTracks.value,
)
const loopLabel = computed(
  () => ({ all: '列表循环', one: '单曲循环', shuffle: '随机播放' })[loopMode.value],
)
const loopIcon = computed(() => (loopMode.value === 'shuffle' ? 'bi-shuffle' : 'bi-repeat'))

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function togglePanel() {
  panelOpen.value = !panelOpen.value
}

function openFilePicker() {
  fileInputEl.value?.click()
}

function handleFiles(event) {
  const count = musicStore.importLocalFiles(event.target.files)
  if (count > 0) activeLibrary.value = 'local'
  event.target.value = ''
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
        :title="`${currentTrack.title} · ${currentTrack.artist}`"
        @click="togglePanel"
      >
        <span
          class="nav-music-player__disc"
          :class="`tone-${currentTrack.tone}`"
          aria-hidden="true"
        >
          <i class="bi bi-music-note-beamed"></i>
        </span>
        <span class="nav-music-player__summary-copy">
          <small>{{ isPlaying ? '正在播放' : '音乐' }}</small>
          <strong>{{ currentTrack.title }}</strong>
        </span>
        <span v-if="isPlaying" class="nav-music-player__meter" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <i v-else class="bi bi-chevron-down nav-music-player__chevron" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="nav-music-player__quick-play"
        :aria-label="isPlaying ? '暂停音乐' : '播放音乐'"
        :title="isPlaying ? '暂停' : '播放'"
        @click="musicStore.toggle"
      >
        <i class="bi" :class="isPlaying ? 'bi-pause-fill' : 'bi-play-fill'" aria-hidden="true"></i>
      </button>
    </div>

    <Transition name="music-panel">
      <section v-if="panelOpen" class="nav-music-panel" role="dialog" aria-label="音乐播放器">
        <header class="nav-music-panel__head">
          <div>
            <span>音乐播放器</span>
            <small>创作时保持专注</small>
          </div>
          <button type="button" aria-label="关闭播放器" title="关闭" @click="panelOpen = false">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="nav-music-now">
          <div class="nav-music-now__cover" :class="`tone-${currentTrack.tone}`" aria-hidden="true">
            <span><i class="bi bi-music-note-beamed"></i></span>
            <b v-for="index in 4" :key="index"></b>
          </div>
          <div class="nav-music-now__copy">
            <small>{{ currentTrack.source === 'local' ? '本地歌曲' : '默认曲库' }}</small>
            <strong>{{ currentTrack.title }}</strong>
            <span>{{ currentTrack.artist }}</span>
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
            :style="{ '--progress': `${duration ? (currentTime / duration) * 100 : 0}%` }"
            @input="musicStore.seek($event.target.value)"
          />
          <div>
            <span>{{ formatTime(currentTime) }}</span
            ><span>{{ formatTime(duration) }}</span>
          </div>
        </div>

        <div class="nav-music-controls">
          <button
            type="button"
            :title="loopLabel"
            :aria-label="loopLabel"
            @click="musicStore.cycleLoopMode"
          >
            <i class="bi" :class="loopIcon" aria-hidden="true"></i>
            <sup v-if="loopMode === 'one'">1</sup>
          </button>
          <button type="button" title="上一首" aria-label="上一首" @click="musicStore.previous">
            <i class="bi bi-skip-start-fill" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="is-primary"
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
          <button type="button" title="下一首" aria-label="下一首" @click="musicStore.next()">
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
              :style="{ '--progress': `${volume * 100}%` }"
              @input="musicStore.setVolume($event.target.value)"
            />
          </label>
        </div>

        <p v-if="errorMessage" class="nav-music-error">
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>{{ errorMessage }}
        </p>

        <div class="nav-music-library-head">
          <div class="nav-music-library-tabs" role="tablist" aria-label="歌曲来源">
            <button
              type="button"
              :class="{ active: activeLibrary === 'default' }"
              role="tab"
              :aria-selected="activeLibrary === 'default'"
              @click="activeLibrary = 'default'"
            >
              默认曲库 <span>{{ defaultTracks.length }}</span>
            </button>
            <button
              type="button"
              :class="{ active: activeLibrary === 'local' }"
              role="tab"
              :aria-selected="activeLibrary === 'local'"
              @click="activeLibrary = 'local'"
            >
              本地歌曲 <span>{{ localTracks.length }}</span>
            </button>
          </div>
          <button
            type="button"
            class="nav-music-import"
            title="添加本地歌曲"
            @click="openFilePicker"
          >
            <i class="bi bi-folder-plus" aria-hidden="true"></i><span>添加</span>
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
          v-if="visibleTracks.length"
          class="nav-music-list"
          role="listbox"
          aria-label="歌曲列表"
        >
          <div
            v-for="track in visibleTracks"
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
            <span class="nav-music-track__icon" :class="`tone-${track.tone}`" aria-hidden="true">
              <i v-if="currentTrackId === track.id && isPlaying" class="bi bi-soundwave"></i>
              <i v-else class="bi bi-music-note"></i>
            </span>
            <span class="nav-music-track__copy">
              <strong>{{ track.title }}</strong>
              <small>{{ track.artist }}</small>
            </span>
            <span v-if="currentTrackId === track.id" class="nav-music-track__state">{{
              isPlaying ? '播放中' : '已选择'
            }}</span>
            <button
              v-if="track.source === 'local'"
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
          <strong>选择本地歌曲</strong>
          <span>音频仅在当前浏览器中播放，不会上传</span>
        </button>
        <p class="nav-music-privacy">
          <i class="bi bi-shield-check" aria-hidden="true"></i
          >本地文件不会上传，刷新页面后需要重新选择
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
  height: 36px;
  overflow: hidden;
  border: 1px solid var(--nav-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--nav-bg-solid) 88%, transparent);
  box-shadow: 0 8px 22px rgb(36 32 75 / 9%);
}

.nav-music-player.open .nav-music-player__compact,
.nav-music-player__compact:hover {
  border-color: var(--nav-line-strong);
  box-shadow: 0 10px 28px rgb(69 56 160 / 15%);
}

.nav-music-player__summary,
.nav-music-player__quick-play {
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.nav-music-player__summary {
  display: grid;
  min-width: 0;
  width: 142px;
  grid-template-columns: 27px minmax(0, 1fr) 15px;
  align-items: center;
  gap: 7px;
  padding: 0 8px 0 5px;
}

.nav-music-player__disc {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  color: #fff;
  border-radius: 50%;
  font-size: 0.72rem;
  box-shadow: inset 0 0 0 5px rgb(0 0 0 / 12%);
}

.playing .nav-music-player__disc {
  animation: music-disc-spin 5s linear infinite;
}

.nav-music-player__summary-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  line-height: 1.08;
}

.nav-music-player__summary-copy small {
  color: var(--nav-muted);
  font-size: 0.55rem;
}

.nav-music-player__summary-copy strong {
  overflow: hidden;
  width: 100%;
  font-size: 0.7rem;
  font-weight: 720;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-music-player__chevron {
  color: var(--nav-muted);
  font-size: 0.62rem;
  transition: transform 160ms ease;
}

.open .nav-music-player__chevron {
  transform: rotate(180deg);
}

.nav-music-player__meter {
  display: flex;
  height: 13px;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}

.nav-music-player__meter i {
  width: 2px;
  height: 45%;
  border-radius: 2px;
  background: var(--nav-accent);
  animation: music-meter 0.8s ease-in-out infinite alternate;
}

.nav-music-player__meter i:nth-child(2) {
  animation-delay: -0.35s;
}

.nav-music-player__meter i:nth-child(3) {
  animation-delay: -0.6s;
}

.nav-music-player__quick-play {
  display: grid;
  width: 34px;
  place-items: center;
  color: var(--nav-accent);
  border-left: 1px solid var(--nav-line);
  font-size: 0.92rem;
}

.nav-music-player__quick-play:hover {
  background: var(--nav-accent-soft);
}

.nav-music-panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: min(370px, calc(100vw - 24px));
  padding: 14px;
  color: #20202a;
  border: 1px solid rgb(31 27 61 / 10%);
  border-radius: 8px;
  background: rgb(255 255 255 / 97%);
  box-shadow: 0 28px 72px rgb(31 25 73 / 22%);
  backdrop-filter: blur(22px) saturate(1.1);
}

.nav-music-panel__head,
.nav-music-library-head,
.nav-music-controls,
.nav-music-now {
  display: flex;
  align-items: center;
}

.nav-music-panel__head {
  justify-content: space-between;
  margin-bottom: 12px;
}

.nav-music-panel__head > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-music-panel__head span {
  font-size: 0.9rem;
  font-weight: 780;
}

.nav-music-panel__head small {
  color: #898795;
  font-size: 0.65rem;
}

.nav-music-panel__head button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  color: #777482;
  border: 0;
  border-radius: 7px;
  background: #f3f2f7;
  cursor: pointer;
}

.nav-music-now {
  gap: 12px;
  padding: 11px;
  overflow: hidden;
  border-radius: 8px;
  background: #f6f5fa;
}

.nav-music-now__cover {
  position: relative;
  display: grid;
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  place-items: center;
  overflow: hidden;
  border-radius: 7px;
}

.nav-music-now__cover span {
  position: relative;
  z-index: 2;
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  color: #fff;
  border: 1px solid rgb(255 255 255 / 45%);
  border-radius: 50%;
  background: rgb(20 18 38 / 28%);
}

.nav-music-now__cover b {
  position: absolute;
  width: 78px;
  height: 1px;
  background: rgb(255 255 255 / 30%);
  transform: rotate(calc(var(--i, 1) * 22deg));
}

.nav-music-now__cover b:nth-of-type(1) {
  transform: rotate(20deg);
}
.nav-music-now__cover b:nth-of-type(2) {
  transform: rotate(70deg);
}
.nav-music-now__cover b:nth-of-type(3) {
  transform: rotate(120deg);
}
.nav-music-now__cover b:nth-of-type(4) {
  transform: rotate(160deg);
}

.tone-violet {
  background: linear-gradient(135deg, #5d4de7, #a956d8);
}
.tone-blue {
  background: linear-gradient(135deg, #246fbf, #55b6cf);
}
.tone-coral {
  background: linear-gradient(135deg, #d34f7b, #f19467);
}
.tone-mint {
  background: linear-gradient(135deg, #248a80, #64bd8a);
}

.nav-music-now__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.nav-music-now__copy small {
  color: #6d5cff;
  font-size: 0.61rem;
  font-weight: 720;
}

.nav-music-now__copy strong {
  overflow: hidden;
  font-size: 0.95rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-music-now__copy span {
  color: #817f8c;
  font-size: 0.68rem;
}

.nav-music-progress {
  margin: 12px 2px 3px;
}

.nav-music-progress input,
.nav-music-volume input {
  width: 100%;
  height: 3px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(to right, #6d5cff var(--progress), #dedce7 var(--progress));
  cursor: pointer;
  appearance: none;
}

.nav-music-progress input::-webkit-slider-thumb,
.nav-music-volume input::-webkit-slider-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #6d5cff;
  box-shadow: 0 1px 5px rgb(31 25 73 / 25%);
  appearance: none;
}

.nav-music-progress > div {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  color: #92909c;
  font-size: 0.58rem;
  font-variant-numeric: tabular-nums;
}

.nav-music-controls {
  justify-content: center;
  gap: 8px;
  margin: 3px 0 13px;
}

.nav-music-controls > button {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  color: #5e5b68;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.nav-music-controls > button:hover {
  color: #6d5cff;
  background: #efedff;
}

.nav-music-controls > button.is-primary {
  width: 43px;
  height: 43px;
  color: #fff;
  background: #6d5cff;
  box-shadow: 0 8px 20px rgb(109 92 255 / 28%);
  font-size: 1.15rem;
}

.nav-music-controls sup {
  position: absolute;
  right: 4px;
  bottom: 4px;
  font-size: 0.5rem;
}

.nav-music-volume {
  display: flex;
  width: 76px;
  align-items: center;
  gap: 6px;
  color: #74717f;
  font-size: 0.8rem;
}

.nav-music-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -3px 0 10px;
  padding: 7px 9px;
  color: #a94455;
  border-radius: 7px;
  background: #fff0f2;
  font-size: 0.65rem;
}

.nav-music-library-head {
  justify-content: space-between;
  gap: 8px;
  padding-top: 11px;
  border-top: 1px solid #eceaf1;
}

.nav-music-library-tabs {
  display: flex;
  min-width: 0;
  padding: 3px;
  border-radius: 7px;
  background: #f2f1f5;
}

.nav-music-library-tabs button,
.nav-music-import {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.nav-music-library-tabs button {
  padding: 5px 8px;
  color: #777482;
  border-radius: 5px;
  background: transparent;
  font-size: 0.64rem;
  font-weight: 680;
  white-space: nowrap;
}

.nav-music-library-tabs button.active {
  color: #292632;
  background: #fff;
  box-shadow: 0 2px 7px rgb(32 28 62 / 10%);
}

.nav-music-library-tabs span {
  margin-left: 2px;
  color: #9b98a4;
}

.nav-music-import {
  display: inline-flex;
  height: 29px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  color: #5d4ee6;
  border-radius: 7px;
  background: #efedff;
  font-size: 0.65rem;
  font-weight: 720;
  white-space: nowrap;
}

.nav-music-file-input {
  display: none;
}

.nav-music-list {
  display: grid;
  max-height: 190px;
  gap: 3px;
  margin-top: 9px;
  overflow: auto;
  scrollbar-width: thin;
}

.nav-music-track {
  display: grid;
  min-width: 0;
  min-height: 44px;
  grid-template-columns: 30px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 4px 7px;
  color: #35323f;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nav-music-track:hover,
.nav-music-track.active {
  border-color: #e3dffc;
  background: #f5f3ff;
}

.nav-music-track__icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: #fff;
  border-radius: 6px;
  font-size: 0.74rem;
}

.nav-music-track__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.nav-music-track__copy strong {
  overflow: hidden;
  font-size: 0.7rem;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-music-track__copy small,
.nav-music-track__state {
  color: #94919e;
  font-size: 0.58rem;
}

.nav-music-track__state {
  color: #6d5cff;
  white-space: nowrap;
}

.nav-music-track__remove {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  padding: 0;
  color: #aaa7b1;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.nav-music-track__remove:hover {
  color: #c14e61;
  background: #ffecef;
}

.nav-music-empty {
  display: flex;
  width: 100%;
  min-height: 116px;
  margin-top: 9px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
  color: #817e8b;
  border: 1px dashed #d8d4e3;
  border-radius: 8px;
  background: #faf9fc;
  cursor: pointer;
}

.nav-music-empty i {
  color: #6d5cff;
  font-size: 1.35rem;
}
.nav-music-empty strong {
  color: #4b4855;
  font-size: 0.72rem;
}
.nav-music-empty span {
  font-size: 0.6rem;
}

.nav-music-privacy {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 8px 0 0;
  color: #9b98a4;
  font-size: 0.57rem;
}

.nav-music-privacy i {
  color: #4b9b7d;
}

.nav-music-player.is-dark .nav-music-panel {
  color: rgb(255 255 255 / 92%);
  border-color: rgb(255 255 255 / 10%);
  background: rgb(24 24 30 / 98%);
  box-shadow: 0 28px 72px rgb(0 0 0 / 48%);
}

.nav-music-player.is-dark .nav-music-panel__head small,
.nav-music-player.is-dark .nav-music-now__copy span,
.nav-music-player.is-dark .nav-music-track__copy small,
.nav-music-player.is-dark .nav-music-track__state,
.nav-music-player.is-dark .nav-music-privacy {
  color: rgb(255 255 255 / 48%);
}

.nav-music-player.is-dark .nav-music-panel__head button,
.nav-music-player.is-dark .nav-music-now,
.nav-music-player.is-dark .nav-music-library-tabs,
.nav-music-player.is-dark .nav-music-empty {
  color: rgb(255 255 255 / 72%);
  background: #222229;
}

.nav-music-player.is-dark .nav-music-progress input,
.nav-music-player.is-dark .nav-music-volume input {
  background: linear-gradient(to right, #8b7bff var(--progress), #45434e var(--progress));
}

.nav-music-player.is-dark .nav-music-library-head {
  border-color: rgb(255 255 255 / 8%);
}
.nav-music-player.is-dark .nav-music-library-tabs button {
  color: rgb(255 255 255 / 52%);
}
.nav-music-player.is-dark .nav-music-library-tabs button.active {
  color: #fff;
  background: #34313e;
}
.nav-music-player.is-dark .nav-music-track {
  color: rgb(255 255 255 / 84%);
}
.nav-music-player.is-dark .nav-music-track:hover,
.nav-music-player.is-dark .nav-music-track.active {
  border-color: #4b426d;
  background: #2b2739;
}
.nav-music-player.is-dark .nav-music-empty {
  border-color: rgb(255 255 255 / 14%);
}
.nav-music-player.is-dark .nav-music-empty strong {
  color: rgb(255 255 255 / 78%);
}

.music-panel-enter-active,
.music-panel-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
  transform-origin: top right;
}

.music-panel-enter-from,
.music-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

@keyframes music-disc-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes music-meter {
  to {
    height: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .playing .nav-music-player__disc,
  .nav-music-player__meter i {
    animation: none;
  }
}

@media (max-width: 1480px) {
  .nav-music-player__summary {
    width: 35px;
    grid-template-columns: 27px;
    padding: 0 4px;
  }
  .nav-music-player__summary-copy,
  .nav-music-player__meter,
  .nav-music-player__chevron {
    display: none;
  }
}

@media (max-width: 760px) {
  .nav-music-player,
  .nav-music-player__compact {
    height: 34px;
  }
  .nav-music-player__summary {
    width: 33px;
  }
  .nav-music-player__quick-play {
    display: none;
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
  .nav-music-panel {
    padding: 12px;
  }
  .nav-music-volume {
    width: 60px;
  }
  .nav-music-library-tabs button {
    padding-inline: 6px;
  }
  .nav-music-import span {
    display: none;
  }
}
</style>
