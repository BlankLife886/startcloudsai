import { onBeforeUnmount, ref } from 'vue'

export function useFavoritesOrbStage() {
  const orbStageRef = ref(null)
  let orbPointerFrame = 0
  let pendingOrbPointer = { x: 0, y: 0 }

  function handleOrbPointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const normalizedX = (event.clientX - rect.left) / rect.width - 0.5
    const normalizedY = (event.clientY - rect.top) / rect.height - 0.5

    pendingOrbPointer = {
      x: Math.max(-1, Math.min(1, normalizedX * 2)),
      y: Math.max(-1, Math.min(1, normalizedY * 2)),
    }

    if (orbPointerFrame) return

    orbPointerFrame = window.requestAnimationFrame(() => {
      const stage = orbStageRef.value
      if (stage) {
        stage.style.setProperty('--stage-shift-x', `${pendingOrbPointer.x * 10}px`)
        stage.style.setProperty('--stage-shift-y', `${pendingOrbPointer.y * 7}px`)
        stage.style.setProperty('--orb-shift-x', `${pendingOrbPointer.x * 8}px`)
        stage.style.setProperty('--orb-shift-y', `${pendingOrbPointer.y * 6}px`)
        stage.classList.add('interacting')
      }
      orbPointerFrame = 0
    })
  }

  function resetOrbCssVars() {
    const stage = orbStageRef.value
    if (!stage) return

    stage.style.setProperty('--stage-shift-x', '0px')
    stage.style.setProperty('--stage-shift-y', '0px')
    stage.style.setProperty('--orb-shift-x', '0px')
    stage.style.setProperty('--orb-shift-y', '0px')
    stage.classList.remove('interacting')
  }

  function cancelOrbPointerFrame() {
    if (orbPointerFrame) {
      window.cancelAnimationFrame(orbPointerFrame)
      orbPointerFrame = 0
    }
  }

  function resetOrbPointer() {
    pendingOrbPointer = { x: 0, y: 0 }
    cancelOrbPointerFrame()
    resetOrbCssVars()
  }

  onBeforeUnmount(() => {
    cancelOrbPointerFrame()
  })

  return {
    orbStageRef,
    handleOrbPointerMove,
    resetOrbPointer,
    cancelOrbPointerFrame,
  }
}
