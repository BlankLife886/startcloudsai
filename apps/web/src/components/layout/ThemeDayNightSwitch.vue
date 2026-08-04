<script setup>
/**
 * Day/night theme switch — based on RiccardoRapelli / jolly-chicken-91 (Uiverse.io, MIT).
 * https://uiverse.io/RiccardoRapelli/jolly-chicken-91
 */
import { useId } from 'vue'
import { useAppearanceStore } from '@/stores/appearance'
import { runThemeTransition } from '@/utils/themeTransition'

const appearanceStore = useAppearanceStore()
const inputId = useId()

function onChange(event) {
  const rect = event.target.closest('.theme-dn-switch')?.getBoundingClientRect()
  const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  const next = event.target.checked ? 'dark' : 'light'
  runThemeTransition(() => appearanceStore.setScheme(next, origin), origin)
}
</script>

<template>
  <label
    class="theme-dn-switch"
    :title="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
  >
    <input
      :id="inputId"
      class="theme-dn-switch__input"
      type="checkbox"
      role="switch"
      :checked="appearanceStore.isDark"
      :aria-label="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
      :aria-checked="appearanceStore.isDark"
      @change="onChange"
    />
    <div class="theme-dn-switch__slider" aria-hidden="true">
      <div class="theme-dn-switch__sun-moon">
        <svg class="theme-dn-switch__moon-dot theme-dn-switch__moon-dot--1" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__moon-dot theme-dn-switch__moon-dot--2" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__moon-dot theme-dn-switch__moon-dot--3" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__light-ray theme-dn-switch__light-ray--1" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__light-ray theme-dn-switch__light-ray--2" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__light-ray theme-dn-switch__light-ray--3" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>

        <svg class="theme-dn-switch__cloud theme-dn-switch__cloud--dark theme-dn-switch__cloud--1" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__cloud theme-dn-switch__cloud--dark theme-dn-switch__cloud--2" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__cloud theme-dn-switch__cloud--dark theme-dn-switch__cloud--3" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__cloud theme-dn-switch__cloud--light theme-dn-switch__cloud--4" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__cloud theme-dn-switch__cloud--light theme-dn-switch__cloud--5" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
        <svg class="theme-dn-switch__cloud theme-dn-switch__cloud--light theme-dn-switch__cloud--6" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50"></circle>
        </svg>
      </div>
      <div class="theme-dn-switch__stars">
        <svg class="theme-dn-switch__star theme-dn-switch__star--1" viewBox="0 0 20 20">
          <path
            d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"
          ></path>
        </svg>
        <svg class="theme-dn-switch__star theme-dn-switch__star--2" viewBox="0 0 20 20">
          <path
            d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"
          ></path>
        </svg>
        <svg class="theme-dn-switch__star theme-dn-switch__star--3" viewBox="0 0 20 20">
          <path
            d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"
          ></path>
        </svg>
        <svg class="theme-dn-switch__star theme-dn-switch__star--4" viewBox="0 0 20 20">
          <path
            d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"
          ></path>
        </svg>
      </div>
    </div>
  </label>
</template>

<style scoped>
.theme-dn-switch {
  --theme-dn-w: 62px;
  --theme-dn-h: 36px;
  --theme-dn-knob: 26px;
  --theme-dn-pad: 5px;
  --theme-dn-travel: calc(var(--theme-dn-w) - var(--theme-dn-knob) - var(--theme-dn-pad) * 2);

  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  width: var(--theme-dn-w);
  height: var(--theme-dn-h);
  vertical-align: middle;
  cursor: pointer;
}

.theme-dn-switch__input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.theme-dn-switch__slider {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background-color: #2196f3;
  border-radius: 999px;
  transition: 0.4s;
}

.theme-dn-switch__sun-moon {
  position: absolute;
  left: var(--theme-dn-pad);
  bottom: var(--theme-dn-pad);
  width: var(--theme-dn-knob);
  height: var(--theme-dn-knob);
  background-color: yellow;
  border-radius: 50%;
  transition: 0.4s;
}

.theme-dn-switch__input:focus-visible + .theme-dn-switch__slider {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2196f3;
}

.theme-dn-switch__input:checked + .theme-dn-switch__slider {
  background-color: black;
}

.theme-dn-switch__input:checked + .theme-dn-switch__slider .theme-dn-switch__sun-moon {
  background-color: white;
  transform: translateX(var(--theme-dn-travel));
  animation: theme-dn-rotate-center 0.6s ease-in-out both;
}

.theme-dn-switch__moon-dot {
  position: absolute;
  z-index: 4;
  fill: gray;
  opacity: 0;
  transition: 0.4s;
}

.theme-dn-switch__input:checked + .theme-dn-switch__slider .theme-dn-switch__moon-dot {
  opacity: 1;
}

.theme-dn-switch__moon-dot--1 {
  top: 3px;
  left: 10px;
  width: 6px;
  height: 6px;
}

.theme-dn-switch__moon-dot--2 {
  top: 10px;
  left: 3px;
  width: 10px;
  height: 10px;
}

.theme-dn-switch__moon-dot--3 {
  top: 18px;
  left: 15px;
  width: 3px;
  height: 3px;
}

.theme-dn-switch__light-ray {
  position: absolute;
  z-index: -1;
  fill: white;
  opacity: 0.1;
}

.theme-dn-switch__light-ray--1 {
  top: -8px;
  left: -8px;
  width: 40px;
  height: 40px;
}

.theme-dn-switch__light-ray--2 {
  top: -50%;
  left: -50%;
  width: 52px;
  height: 52px;
}

.theme-dn-switch__light-ray--3 {
  top: -18px;
  left: -18px;
  width: 58px;
  height: 58px;
}

.theme-dn-switch__cloud {
  position: absolute;
  animation-name: theme-dn-cloud-move;
  animation-duration: 6s;
  animation-iteration-count: infinite;
}

.theme-dn-switch__cloud--light {
  fill: #eee;
}

.theme-dn-switch__cloud--dark {
  fill: #ccc;
  animation-delay: 1s;
}

.theme-dn-switch__cloud--1 {
  top: 16px;
  left: 30px;
  width: 36px;
}

.theme-dn-switch__cloud--2 {
  top: 11px;
  left: 44px;
  width: 18px;
}

.theme-dn-switch__cloud--3 {
  top: 24px;
  left: 18px;
  width: 28px;
}

.theme-dn-switch__cloud--4 {
  top: 18px;
  left: 34px;
  width: 36px;
}

.theme-dn-switch__cloud--5 {
  top: 14px;
  left: 46px;
  width: 18px;
}

.theme-dn-switch__cloud--6 {
  top: 26px;
  left: 22px;
  width: 28px;
}

.theme-dn-switch__stars {
  opacity: 0;
  transform: translateY(-26px);
  transition: 0.4s;
}

.theme-dn-switch__star {
  position: absolute;
  fill: white;
  transition: 0.4s;
  animation-name: theme-dn-star-twinkle;
  animation-duration: 2s;
  animation-iteration-count: infinite;
}

.theme-dn-switch__input:checked + .theme-dn-switch__slider .theme-dn-switch__stars {
  opacity: 1;
  transform: translateY(0);
}

.theme-dn-switch__star--1 {
  top: 3px;
  left: 3px;
  width: 18px;
  animation-delay: 0.3s;
}

.theme-dn-switch__star--2 {
  top: 16px;
  left: 3px;
  width: 6px;
}

.theme-dn-switch__star--3 {
  top: 20px;
  left: 10px;
  width: 12px;
  animation-delay: 0.6s;
}

.theme-dn-switch__star--4 {
  top: 1px;
  left: 18px;
  width: 16px;
  animation-delay: 1.3s;
}

@keyframes theme-dn-cloud-move {
  0% {
    transform: translateX(0);
  }

  40% {
    transform: translateX(4px);
  }

  80% {
    transform: translateX(-4px);
  }

  100% {
    transform: translateX(0);
  }
}

@keyframes theme-dn-star-twinkle {
  0% {
    transform: scale(1);
  }

  40% {
    transform: scale(1.2);
  }

  80% {
    transform: scale(0.8);
  }

  100% {
    transform: scale(1);
  }
}

@keyframes theme-dn-rotate-center {
  0% {
    transform: translateX(var(--theme-dn-travel)) rotate(0deg);
  }

  100% {
    transform: translateX(var(--theme-dn-travel)) rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-dn-switch__slider,
  .theme-dn-switch__sun-moon,
  .theme-dn-switch__moon-dot,
  .theme-dn-switch__stars,
  .theme-dn-switch__star {
    transition: none;
  }

  .theme-dn-switch__cloud,
  .theme-dn-switch__star,
  .theme-dn-switch__input:checked + .theme-dn-switch__slider .theme-dn-switch__sun-moon {
    animation: none;
  }
}
</style>
