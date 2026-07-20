<script setup>
import { ref } from 'vue'
import ziweiCompassIcon from '@/assets/ziwei/ziwei-compass-gold.svg'
import ZwTimeSelect from './ZwTimeSelect.vue'
import {
  ZW_CINE_CHART_CELLS,
  ZW_CINE_MAIN_STARS,
  ZW_CINE_PALACES,
  ZW_CINE_SIHUA,
  buildGlyphField,
} from './ziweiCinematicData'

defineProps({
  formReady: { type: Boolean, default: false },
  generating: { type: Boolean, default: false },
  timeOptions: { type: Array, default: () => [] },
})

const form = defineModel('form', { type: Object, required: true })

const rememberNextVisit = ref(false)

const emit = defineEmits(['generate', 'skip', 'direct-console'])

const palaceNames = ZW_CINE_PALACES
const chartCells = ZW_CINE_CHART_CELLS
const mainStars = ZW_CINE_MAIN_STARS
const sihuaItems = ZW_CINE_SIHUA
const glyphField = buildGlyphField(36)

const centerFieldDefs = [
  { key: 'wuxing', label: '五行局' },
  { key: 'soul', label: '命主' },
  { key: 'body', label: '身主' },
  { key: 'zodiac', label: '生肖' },
  { key: 'date', label: '生辰' },
  { key: 'time', label: '时辰' },
]
</script>

<template>
  <div class="zw-cine" data-phase="intro" aria-live="polite">
    <canvas class="zw-cine__canvas" aria-hidden="true"></canvas>

    <div class="zw-cine__aurora" aria-hidden="true"></div>
    <div class="zw-cine__nebula zw-cine__nebula--a" aria-hidden="true"></div>
    <div class="zw-cine__nebula zw-cine__nebula--b" aria-hidden="true"></div>

    <div class="zw-cine__chart-skel" aria-hidden="true">
      <div class="zw-cine__chart-grid">
        <div
          v-for="cell in chartCells"
          :key="cell.id"
          class="zw-cine__chart-cell"
          :data-cell="cell.id"
          :style="{ gridArea: cell.gridArea }"
        >
          <span class="zw-cine__chart-branch">{{ cell.branch }}</span>
          <span class="zw-cine__chart-palace" data-palace-label></span>
          <span class="zw-cine__chart-major" data-major-label></span>
          <span class="zw-cine__chart-minor" data-minor-label></span>
          <span class="zw-cine__chart-decadal" data-decadal-label></span>
          <span class="zw-cine__chart-badge" data-palace-badge></span>
          <span class="zw-cine__chart-star" aria-hidden="true"></span>
        </div>
        <div class="zw-cine__chart-center">
          <span class="zw-cine__chart-center-mark">中宫</span>
          <div class="zw-cine__chart-center-fields">
            <div
              v-for="field in centerFieldDefs"
              :key="field.key"
              class="zw-cine__center-field"
              :data-center-field="field.key"
            >
              <span class="zw-cine__center-label">{{ field.label }}</span>
              <span class="zw-cine__center-value" data-center-value>—</span>
            </div>
          </div>
          <svg class="zw-cine__chart-sfsz" viewBox="0 0 100 100" aria-hidden="true">
            <line class="zw-cine__chart-sfsz-line zw-cine__chart-sfsz-line--a" x1="50" y1="50" x2="50" y2="8" />
            <line class="zw-cine__chart-sfsz-line zw-cine__chart-sfsz-line--b" x1="50" y1="50" x2="88" y2="28" />
            <line class="zw-cine__chart-sfsz-line zw-cine__chart-sfsz-line--c" x1="50" y1="50" x2="12" y2="28" />
          </svg>
        </div>
      </div>
    </div>

    <div class="zw-cine__orbit" aria-hidden="true">
      <div class="zw-cine__orbit-track">
        <span
          v-for="(name, i) in palaceNames"
          :key="name"
          class="zw-cine__orbit-node"
          :style="{ '--oi': i }"
        >{{ name }}</span>
      </div>
    </div>

    <div class="zw-cine__glyphfield" aria-hidden="true">
      <span
        v-for="g in glyphField"
        :key="g.id"
        class="zw-cine__glyph"
        :data-glyph-id="g.id"
        :style="{
          '--gx': `${g.x}vw`,
          '--gy': `${g.y}vh`,
          '--gr': `${g.rot}deg`,
          '--gs': g.size,
        }"
      >{{ g.text }}</span>
    </div>

    <div class="zw-cine__starstream" aria-hidden="true">
      <span v-for="(star, i) in mainStars" :key="star" class="zw-cine__starstream-item" :style="{ '--si': i }">
        {{ star }}
      </span>
    </div>

    <div class="zw-cine__paipan" aria-hidden="true">
      <p class="zw-cine__paipan-step">定命宫 · 安十二宫</p>
      <p class="zw-cine__paipan-sub">等待演算…</p>
      <div class="zw-cine__paipan-sihua">
        <span
          v-for="item in sihuaItems"
          :key="item.id"
          class="zw-cine__paipan-sihua-item"
          :class="item.cls"
          :data-sihua="item.label"
        >{{ item.label }}</span>
      </div>
    </div>

    <div class="zw-cine__shockwaves" aria-hidden="true">
      <span v-for="i in 4" :key="i" class="zw-cine__shockwave"></span>
    </div>

    <div class="zw-cine__flash" aria-hidden="true"></div>
    <div class="zw-cine__flare" aria-hidden="true"></div>
    <div class="zw-cine__chromatic" aria-hidden="true"></div>
    <div class="zw-cine__vignette" aria-hidden="true"></div>
    <div class="zw-cine__grain" aria-hidden="true"></div>

    <div class="zw-cine__speedlines" aria-hidden="true">
      <span v-for="i in 12" :key="i" class="zw-cine__speedline" :style="{ '--i': i }"></span>
    </div>

    <div class="zw-cine__tunnel-ring zw-cine__tunnel-ring--a" aria-hidden="true"></div>
    <div class="zw-cine__tunnel-ring zw-cine__tunnel-ring--b" aria-hidden="true"></div>
    <div class="zw-cine__tunnel-ring zw-cine__tunnel-ring--c" aria-hidden="true"></div>
    <div class="zw-cine__tunnel-ring zw-cine__tunnel-ring--d" aria-hidden="true"></div>

    <div class="zw-cine__focal-hub">
      <section class="zw-cine__intro">
        <div class="zw-cine__intro-core">
          <div class="zw-cine__ring-glow" aria-hidden="true"></div>
          <div class="zw-cine__ring">
            <img :src="ziweiCompassIcon" alt="" />
          </div>
          <h1 class="zw-cine__title">
            <span class="zw-cine__title-main">紫微斗数</span>
            <span class="zw-cine__title-ghost zw-cine__title-ghost--a" aria-hidden="true">紫微斗数</span>
            <span class="zw-cine__title-ghost zw-cine__title-ghost--b" aria-hidden="true">紫微斗数</span>
          </h1>
          <p class="zw-cine__subtitle">定命立宫 · 排盘启序</p>
          <p class="zw-cine__hint">Enter 起盘 · Esc 跳过</p>
        </div>
      </section>
    </div>

    <section class="zw-cine__intake" hidden>
      <div class="zw-cine__intake-bloom" aria-hidden="true"></div>
      <div class="zw-cine__intake-inner">
        <p class="zw-cine__intake-whisper">以生辰定星轨 · 落宫安宿</p>

        <div class="zw-cine__fields">
          <div class="zw-cine__field zw-cine__field--inline">
            <span class="zw-cine__label">历法</span>
            <div class="zw-cine__seg" aria-label="历法">
              <button
                type="button"
                :class="{ active: form.calendar === 'solar' }"
                @click="form.calendar = 'solar'"
              >
                阳历
              </button>
              <span class="zw-cine__seg-div" aria-hidden="true">·</span>
              <button
                type="button"
                :class="{ active: form.calendar === 'lunar' }"
                @click="form.calendar = 'lunar'"
              >
                农历
              </button>
            </div>
          </div>

          <div class="zw-cine__field">
            <span class="zw-cine__label">出生日期</span>
            <div class="zw-cine__input-line">
              <input
                v-model="form.birthDate"
                type="text"
                inputmode="numeric"
                placeholder="1990/08/08"
                autocomplete="off"
              />
            </div>
          </div>

          <div class="zw-cine__field">
            <span class="zw-cine__label">出生时辰</span>
            <div class="zw-cine__input-line zw-cine__input-line--select">
              <ZwTimeSelect
                v-model="form.timeIndex"
                :options="timeOptions"
                placeholder="择时"
                variant="cinematic"
              />
            </div>
          </div>

          <div class="zw-cine__field zw-cine__field--inline">
            <span class="zw-cine__label">性别</span>
            <div class="zw-cine__seg" role="group" aria-label="性别">
              <button
                type="button"
                :class="{ active: form.gender === '男' }"
                @click="form.gender = '男'"
              >
                男
              </button>
              <span class="zw-cine__seg-div" aria-hidden="true">·</span>
              <button
                type="button"
                :class="{ active: form.gender === '女' }"
                @click="form.gender = '女'"
              >
                女
              </button>
            </div>
          </div>

          <button
            class="zw-cine__submit"
            type="button"
            :disabled="!formReady || generating"
            @click="emit('generate')"
          >
            <span v-if="generating" class="zw-cine__submit-spinner" aria-hidden="true"></span>
            <span v-else class="zw-cine__submit-glow" aria-hidden="true"></span>
            {{ generating ? '演星排盘中…' : '生成命盘' }}
          </button>
        </div>
      </div>
    </section>

    <div class="zw-cine__dock">
      <button type="button" class="zw-cine__skip" @click="emit('skip')">跳过 · Esc</button>
      <button
        type="button"
        class="zw-cine__skip zw-cine__skip--console"
        @click="emit('direct-console', rememberNextVisit)"
      >
        直接进入控制台
      </button>
      <label class="zw-cine__remember">
        <input v-model="rememberNextVisit" type="checkbox" />
        <span>下次跳过开场动画</span>
      </label>
    </div>
  </div>
</template>

<style src="./ziwei-cinematic.css"></style>
