function clampProgress(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

export function createUpscaleProgressController(onUpdate, initial = {}) {
  let displayed = clampProgress(initial.progress || 5)
  let target = displayed
  let message = String(initial.message || '')
  let stage = String(initial.stage || 'prepare')
  let profile = String(initial.profile || '')
  let stopped = false

  const publish = () => {
    onUpdate?.({
      progress: Math.round(displayed * 10) / 10,
      message,
      stage,
      profile,
    })
  }

  const timer = globalThis.setInterval(() => {
    if (stopped) return
    const gap = target - displayed
    if (gap <= 0.05) return
    displayed = Math.min(target, displayed + Math.max(0.18, gap * 0.14))
    publish()
  }, 110)

  publish()

  return {
    report(progress, nextMessage = '', details = {}) {
      if (stopped) return
      target = Math.max(target, clampProgress(progress))
      message = String(nextMessage || message)
      stage = String(details?.stage || stage)
      profile = String(details?.profile || profile)
      publish()
    },
    complete(nextMessage = '高清图片已完成') {
      if (stopped) return
      displayed = 100
      target = 100
      message = String(nextMessage || message)
      stage = 'completed'
      publish()
      this.stop()
    },
    stop() {
      if (stopped) return
      stopped = true
      globalThis.clearInterval(timer)
    },
  }
}
