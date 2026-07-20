import { ref } from 'vue'

// 样机预览只维护设备模式；进入样机前需要关闭哪些其它工具，由主弹窗通过回调协调。
const DESKTOP_MOCKUP_MODE = 'desktop'
const PHONE_MOCKUP_MODES = ['phone-iphone', 'phone-android']

export function usePreviewMockup({ beforeActivate = null } = {}) {
  const mockupMode = ref('none')

  function clearMockupMode() {
    mockupMode.value = 'none'
  }

  function prepareMockupSwitch() {
    if (typeof beforeActivate === 'function') {
      beforeActivate()
    }
  }

  function toggleDesktopMockup() {
    prepareMockupSwitch()
    mockupMode.value = mockupMode.value === DESKTOP_MOCKUP_MODE ? 'none' : DESKTOP_MOCKUP_MODE
  }

  function togglePhoneMockup() {
    prepareMockupSwitch()
    mockupMode.value = PHONE_MOCKUP_MODES.includes(mockupMode.value)
      ? 'none'
      : PHONE_MOCKUP_MODES[0]
  }

  return {
    mockupMode,
    clearMockupMode,
    toggleDesktopMockup,
    togglePhoneMockup,
  }
}
