import { onBeforeUnmount } from 'vue'

const FRAME_MS = 28
const MIN_ANSWERING_MS = 520
const TARGET_DRAIN_STEPS = 42
const MAX_CHUNK_SIZE = 18

function textUnits(value) {
  return Array.from(String(value || ''))
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
        const chunkSize = Math.min(
          MAX_CHUNK_SIZE,
          Math.max(1, Math.ceil(remaining / TARGET_DRAIN_STEPS)),
        )
        message.content = targetUnits.slice(0, currentUnits.length + chunkSize).join('')
        message.pending = true
        message.routing = false
        message.statusStage = 'answering'
        onProgress?.()
        schedule()
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
