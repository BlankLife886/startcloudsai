import { onBeforeUnmount } from 'vue'

const FRAME_MS = 30
const MIN_ANSWERING_MS = 700
const SENTENCE_PAUSE_MS = 130
const CLAUSE_PAUSE_MS = 70

function textUnits(value) {
  return Array.from(String(value || ''))
}

function visibleChunkSize(remaining) {
  if (remaining > 800) return 5
  if (remaining > 400) return 4
  if (remaining > 180) return 3
  if (remaining > 48) return 2
  return 1
}

function nextChunkEnd(units, start, remaining) {
  const limit = Math.min(units.length, start + visibleChunkSize(remaining))
  for (let index = start; index < limit; index += 1) {
    if (/[，。！？；：、,.!?;:\n]/u.test(units[index])) return index + 1
  }
  return limit
}

function punctuationPause(lastUnit) {
  if (/[。！？.!?\n]/u.test(lastUnit || '')) return SENTENCE_PAUSE_MS
  if (/[，；：、,;:]/u.test(lastUnit || '')) return CLAUSE_PAUSE_MS
  return FRAME_MS
}

export function useAssistantTextStream() {
  const renderers = new Map()

  function createTextStreamRenderer(message, { onProgress } = {}) {
    renderers.get(message.id)?.cancel()

    let target = String(message.content || '')
    let targetUnits = textUnits(target)
    let timer = 0
    let startedAt = 0
    let done = false
    let settled = false
    let terminalStatus = ''
    let resolveSettled
    const settledPromise = new Promise((resolve) => {
      resolveSettled = resolve
    })

    function clearTimer() {
      if (!timer) return
      window.clearTimeout(timer)
      timer = 0
    }

    function settle() {
      if (settled) return
      clearTimer()
      settled = true
      renderers.delete(message.id)
      if (terminalStatus === 'succeeded') {
        message.pending = false
        message.routing = false
        message.statusStage = 'complete'
      }
      resolveSettled?.()
    }

    function schedule(delay = FRAME_MS) {
      if (settled || timer) return
      timer = window.setTimeout(tick, delay)
    }

    function tick() {
      timer = 0
      if (settled) return

      const currentUnits = textUnits(message.content)
      const remaining = targetUnits.length - currentUnits.length
      if (remaining > 0) {
        const nextEnd = nextChunkEnd(targetUnits, currentUnits.length, remaining)
        message.content = targetUnits.slice(0, nextEnd).join('')
        message.pending = true
        message.routing = false
        message.statusStage = 'answering'
        onProgress?.()
        schedule(punctuationPause(targetUnits[nextEnd - 1]))
        return
      }

      if (!done) return
      const visibleFor = startedAt ? performance.now() - startedAt : 0
      if (visibleFor < MIN_ANSWERING_MS) {
        schedule(MIN_ANSWERING_MS - visibleFor)
        return
      }
      settle()
    }

    function push(fullText) {
      const next = String(fullText || '')
      if (!next || textUnits(next).length <= targetUnits.length) return
      target = next
      targetUnits = textUnits(target)
      if (!startedAt) startedAt = performance.now()
      message.pending = true
      message.routing = false
      message.statusStage = 'answering'
      schedule(0)
    }

    function finish(status = 'succeeded') {
      if (settled) return
      done = true
      terminalStatus = status
      if (!startedAt) startedAt = performance.now()
      if (status !== 'succeeded') {
        settle()
        return
      }
      schedule(0)
    }

    function cancel() {
      if (settled) return
      terminalStatus = 'canceled'
      settle()
    }

    const renderer = {
      push,
      finish,
      cancel,
      whenSettled: () => settledPromise,
      isSettled: () => settled,
      hasStarted: () => Boolean(startedAt),
    }
    renderers.set(message.id, renderer)
    return renderer
  }

  onBeforeUnmount(() => {
    for (const renderer of renderers.values()) renderer.cancel()
    renderers.clear()
  })

  return { createTextStreamRenderer }
}
