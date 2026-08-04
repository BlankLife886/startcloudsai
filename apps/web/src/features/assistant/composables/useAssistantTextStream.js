import { onBeforeUnmount } from 'vue'

export function useAssistantTextStream() {
  const renderers = new Map()

  function createTextStreamRenderer(message, { onProgress } = {}) {
    renderers.get(message.id)?.cancel()

    let target = String(message.content || '')
    let frame = 0
    let fallbackTimer = 0
    let started = false
    let done = false
    let settled = false
    let terminalStatus = ''
    let resolveSettled
    const settledPromise = new Promise((resolve) => {
      resolveSettled = resolve
    })

    function clearScheduledFlush() {
      if (frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = 0
      }
    }

    function settle() {
      if (settled) return
      clearScheduledFlush()
      settled = true
      renderers.delete(message.id)
      if (terminalStatus === 'succeeded') {
        message.pending = false
        message.routing = false
        message.statusStage = 'complete'
      }
      resolveSettled?.()
    }

    function schedule() {
      if (settled || frame || fallbackTimer) return
      frame = window.requestAnimationFrame(flush)
      fallbackTimer = window.setTimeout(flush, 120)
    }

    function flush() {
      clearScheduledFlush()
      if (settled) return
      if (String(message.content || '') !== target) {
        message.content = target
        message.pending = true
        message.routing = false
        message.statusStage = 'answering'
        onProgress?.()
      }
      if (done) settle()
    }

    function push(fullText, { replace = false } = {}) {
      const next = String(fullText || '')
      if (!next || (!replace && next.length <= target.length) || next === target) return
      target = next
      started = true
      message.pending = true
      message.routing = false
      message.statusStage = 'answering'
      schedule()
    }

    function finish(status = 'succeeded') {
      if (settled) return
      done = true
      terminalStatus = status
      if (status !== 'succeeded') {
        settle()
        return
      }
      schedule()
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
      hasStarted: () => started,
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
