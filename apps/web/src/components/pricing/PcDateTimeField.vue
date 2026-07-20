<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  compact: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const dateOpen = ref(false)
const timeOpen = ref(false)
const viewDate = ref(new Date())
const draftDate = ref('')
const draftHour = ref('23')
const draftMinute = ref('59')
const hourScrollRef = ref(null)
const minuteScrollRef = ref(null)

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const QUICK_TIMES = ['09:00', '12:00', '18:00', '23:59']
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))

function splitDateTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return { date: '', time: '' }
  const [date = '', time = ''] = raw.split('T')
  return { date, time: time.slice(0, 5) }
}

function mergeDateTime(date, time) {
  const datePart = String(date || '').trim()
  const timePart = String(time || '').trim()
  if (!datePart && !timePart) return ''
  if (!datePart) return ''
  return `${datePart}T${timePart || '23:59'}`
}

function parseIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function formatDateDisplay(date) {
  if (!date) return ''
  const parsed = parseIsoDate(date)
  if (!parsed) return date
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

function formatTimeDisplay(time) {
  const raw = String(time || '').trim()
  if (!raw) return ''
  return raw.slice(0, 5)
}

function syncViewDate(date) {
  const parsed = parseIsoDate(date)
  viewDate.value = parsed || new Date()
}

function syncDraftTime(time) {
  const normalized = formatTimeDisplay(time) || '23:59'
  const [hour = '23', minute = '59'] = normalized.split(':')
  draftHour.value = hour
  draftMinute.value = minute
}

function commitValue(next) {
  emit('update:modelValue', String(next || '').trim())
}

const currentParts = computed(() => splitDateTime(props.modelValue))

const dateLabel = computed(() => formatDateDisplay(currentParts.value.date))
const timeLabel = computed(() => formatTimeDisplay(currentParts.value.time))
const hasValue = computed(() => Boolean(String(props.modelValue || '').trim()))
const pickerOpen = computed(() => dateOpen.value || timeOpen.value)
const draftTimeLabel = computed(() => `${draftHour.value}:${draftMinute.value}`)

const monthLabel = computed(() => {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth() + 1
  return `${year}年${month}月`
})

const calendarDays = computed(() => {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const activeDate = dateOpen.value ? draftDate.value : currentParts.value.date
  const cells = []

  for (let index = firstWeekday - 1; index >= 0; index -= 1) {
    const day = daysInPrevMonth - index
    cells.push({
      key: `prev-${day}`,
      day,
      iso: '',
      muted: true,
      selected: false,
      today: false,
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const current = new Date()
    const isToday =
      current.getFullYear() === year &&
      current.getMonth() === month &&
      current.getDate() === day
    cells.push({
      key: iso,
      day,
      iso,
      muted: false,
      selected: iso === activeDate,
      today: isToday,
    })
  }

  let nextDay = 1
  while (cells.length % 7 !== 0) {
    cells.push({
      key: `next-${nextDay}`,
      day: nextDay,
      iso: '',
      muted: true,
      selected: false,
      today: false,
    })
    nextDay += 1
  }

  return cells
})

watch(
  () => props.modelValue,
  (value) => {
    syncViewDate(splitDateTime(value).date)
  },
  { immediate: true },
)

watch(pickerOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

function scrollOptionIntoView(container, value) {
  if (!container) return
  const target = container.querySelector(`[data-value="${value}"]`)
  target?.scrollIntoView({ block: 'center', behavior: 'auto' })
}

function scrollActiveTimeOptions() {
  nextTick(() => {
    nextTick(() => {
      scrollOptionIntoView(hourScrollRef.value, draftHour.value)
      scrollOptionIntoView(minuteScrollRef.value, draftMinute.value)
    })
  })
}

function openDateDialog() {
  draftDate.value = currentParts.value.date
  syncViewDate(draftDate.value)
  timeOpen.value = false
  dateOpen.value = true
}

function openTimeDialog() {
  if (!currentParts.value.date) return
  syncDraftTime(currentParts.value.time)
  dateOpen.value = false
  timeOpen.value = true
  scrollActiveTimeOptions()
}

function closeDialogs() {
  dateOpen.value = false
  timeOpen.value = false
}

function shiftMonth(offset) {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth()
  viewDate.value = new Date(year, month + offset, 1)
}

function pickDate(iso) {
  if (!iso) return
  draftDate.value = iso
}

function confirmDate() {
  if (!draftDate.value) return
  const time = formatTimeDisplay(currentParts.value.time) || '23:59'
  commitValue(mergeDateTime(draftDate.value, time))
  window.setTimeout(closeDialogs, 0)
}

function applyQuickTime(value) {
  syncDraftTime(value)
  scrollActiveTimeOptions()
}

function pickHour(value) {
  draftHour.value = value
  scrollOptionIntoView(hourScrollRef.value, value)
}

function pickMinute(value) {
  draftMinute.value = value
  scrollOptionIntoView(minuteScrollRef.value, value)
}

function confirmTime() {
  if (!currentParts.value.date) return
  commitValue(mergeDateTime(currentParts.value.date, draftTimeLabel.value))
  window.setTimeout(closeDialogs, 0)
}

function clearValue() {
  commitValue('')
  closeDialogs()
}

function handleKeydown(event) {
  if (event.key === 'Escape') closeDialogs()
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="pc-datetime-field" :class="{ 'pc-datetime-field--compact': compact }">
    <div class="pc-datetime-field__row">
      <div class="pc-datetime-field__control">
        <button
          type="button"
          class="pc-datetime-trigger"
          :class="{ 'is-active': dateOpen, 'is-filled': Boolean(dateLabel) }"
          @click.stop="openDateDialog"
        >
          <i class="bi bi-calendar3" aria-hidden="true"></i>
          <span>{{ dateLabel || '选择日期' }}</span>
        </button>
      </div>
      <div class="pc-datetime-field__control">
        <button
          type="button"
          class="pc-datetime-trigger"
          :class="{
            'is-active': timeOpen,
            'is-filled': Boolean(timeLabel),
            'is-disabled': !currentParts.date,
          }"
          :disabled="!currentParts.date"
          @click.stop="openTimeDialog"
        >
          <i class="bi bi-clock" aria-hidden="true"></i>
          <span>{{ timeLabel || '选择时间' }}</span>
        </button>
      </div>
    </div>

    <div class="pc-datetime-field__foot">
      <small class="pc-field-help">
        {{ compact ? '留空表示长期有效' : '先选日期，再选时间；留空表示长期有效。' }}
      </small>
      <button
        v-if="hasValue"
        type="button"
        class="pc-btn pc-btn--ghost pc-btn--xs"
        @click="clearValue"
      >
        清除
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="dateOpen"
        class="pc-pricing-modal-root pc-datetime-overlay"
        @mousedown.self="closeDialogs"
      >
        <div
          class="pc-datetime-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pc-datetime-date-title"
          @mousedown.stop
          @click.stop
        >
          <header class="pc-datetime-dialog__head">
            <h3 id="pc-datetime-date-title">选择日期</h3>
            <button type="button" class="pc-datetime-dialog__close" @click="closeDialogs">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="pc-datetime-panel pc-datetime-panel--calendar">
            <div class="pc-datetime-panel__head">
              <button type="button" class="pc-datetime-panel__nav" @click="shiftMonth(-1)">
                <i class="bi bi-chevron-left"></i>
              </button>
              <strong>{{ monthLabel }}</strong>
              <button type="button" class="pc-datetime-panel__nav" @click="shiftMonth(1)">
                <i class="bi bi-chevron-right"></i>
              </button>
            </div>
            <div class="pc-datetime-calendar__weekdays">
              <span v-for="weekday in WEEKDAYS" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="pc-datetime-calendar__grid">
              <button
                v-for="cell in calendarDays"
                :key="cell.key"
                type="button"
                class="pc-datetime-calendar__day"
                :class="{
                  'is-muted': cell.muted,
                  'is-selected': cell.selected,
                  'is-today': cell.today,
                }"
                :disabled="cell.muted || !cell.iso"
                @click.stop="pickDate(cell.iso)"
              >
                {{ cell.day }}
              </button>
            </div>
          </div>

          <footer class="pc-datetime-dialog__foot">
            <button type="button" class="pc-datetime-btn pc-datetime-btn--ghost" @click="closeDialogs">
              取消
            </button>
            <button
              type="button"
              class="pc-datetime-btn pc-datetime-btn--primary"
              :disabled="!draftDate"
              @click="confirmDate"
            >
              确定
            </button>
          </footer>
        </div>
      </div>

      <div
        v-if="timeOpen"
        class="pc-pricing-modal-root pc-datetime-overlay"
        @mousedown.self="closeDialogs"
      >
        <div
          class="pc-datetime-dialog pc-datetime-dialog--time"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pc-datetime-time-title"
          @mousedown.stop
          @click.stop
        >
          <header class="pc-datetime-dialog__head">
            <h3 id="pc-datetime-time-title">选择时间</h3>
            <button type="button" class="pc-datetime-dialog__close" @click="closeDialogs">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="pc-datetime-panel pc-datetime-panel--time">
            <div class="pc-datetime-time__preview">{{ draftTimeLabel }}</div>

            <div class="pc-datetime-time__section">
              <span class="pc-datetime-time__section-label">快捷选择</span>
              <div class="pc-datetime-time__quick">
                <button
                  v-for="item in QUICK_TIMES"
                  :key="item"
                  type="button"
                  class="pc-datetime-time__chip"
                  :class="{ 'is-active': draftTimeLabel === item }"
                  @click.stop="applyQuickTime(item)"
                >
                  {{ item }}
                </button>
              </div>
            </div>

            <div class="pc-datetime-time__section">
              <span class="pc-datetime-time__section-label">自定义</span>
              <div class="pc-datetime-time__columns">
                <div class="pc-datetime-time__column">
                  <span class="pc-datetime-time__column-label">小时</span>
                  <div ref="hourScrollRef" class="pc-datetime-time__scroll">
                    <div class="pc-datetime-time__scroll-spacer" aria-hidden="true"></div>
                    <button
                      v-for="hour in HOURS"
                      :key="hour"
                      type="button"
                      class="pc-datetime-time__option"
                      :class="{ 'is-active': draftHour === hour }"
                      :data-value="hour"
                      @click.stop="pickHour(hour)"
                    >
                      {{ hour }}
                    </button>
                    <div class="pc-datetime-time__scroll-spacer" aria-hidden="true"></div>
                  </div>
                </div>
                <span class="pc-datetime-time__colon">:</span>
                <div class="pc-datetime-time__column">
                  <span class="pc-datetime-time__column-label">分钟</span>
                  <div ref="minuteScrollRef" class="pc-datetime-time__scroll">
                    <div class="pc-datetime-time__scroll-spacer" aria-hidden="true"></div>
                    <button
                      v-for="minute in MINUTES"
                      :key="minute"
                      type="button"
                      class="pc-datetime-time__option"
                      :class="{ 'is-active': draftMinute === minute }"
                      :data-value="minute"
                      @click.stop="pickMinute(minute)"
                    >
                      {{ minute }}
                    </button>
                    <div class="pc-datetime-time__scroll-spacer" aria-hidden="true"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <footer class="pc-datetime-dialog__foot">
            <button type="button" class="pc-datetime-btn pc-datetime-btn--ghost" @click="closeDialogs">
              取消
            </button>
            <button type="button" class="pc-datetime-btn pc-datetime-btn--primary" @click="confirmTime">
              确定
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>
