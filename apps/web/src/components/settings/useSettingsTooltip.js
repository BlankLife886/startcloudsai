import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const DEFAULT_TOOLTIP_SELECTOR =
  '[data-tooltip], [data-settings-tooltip-source], button[title]:not(.settings-filter-trigger):not(.settings-filter-menu-item), input[title], textarea[title], .tool-chip span[title], .love-heart[title], .settings-color-item[title]'

export function useSettingsTooltip(selector = DEFAULT_TOOLTIP_SELECTOR) {
  const activeTooltipElement = ref(null)
  const settingsTooltip = reactive({
    visible: false,
    text: '',
    placement: 'top',
    style: {
      left: '0px',
      top: '0px',
    },
  })

  function getTooltipElement(target) {
    if (!(target instanceof Element)) return null

    const element = target.closest(selector)
    if (!element || !element.closest('.settings-page')) return null

    return element
  }

  function getTooltipText(element) {
    return (
      element.dataset.tooltip ||
      element.dataset.nativeTitle ||
      element.getAttribute('title') ||
      element.getAttribute('aria-label') ||
      ''
    ).trim()
  }

  function preserveNativeTitle(element) {
    const title = element.getAttribute('title')
    if (!title || element.dataset.nativeTitle) return

    element.dataset.nativeTitle = title
    element.dataset.settingsTooltipSource = 'true'
    element.removeAttribute('title')
  }

  function restoreNativeTitle(element = activeTooltipElement.value) {
    if (!element?.dataset?.nativeTitle) return

    element.setAttribute('title', element.dataset.nativeTitle)
    delete element.dataset.nativeTitle
    delete element.dataset.settingsTooltipSource
  }

  function positionSettingsTooltip(element) {
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const centerX = rect.left + rect.width / 2
    const left = Math.min(Math.max(centerX, 22), viewportWidth - 22)
    const showBelow = rect.top < 54

    settingsTooltip.placement = showBelow ? 'bottom' : 'top'
    settingsTooltip.style = {
      left: `${left}px`,
      top: `${showBelow ? rect.bottom + 10 : rect.top - 10}px`,
    }
  }

  function showSettingsTooltip(event) {
    const element = getTooltipElement(event.target)
    if (!element) return

    const text = getTooltipText(element)
    if (!text) return

    if (activeTooltipElement.value && activeTooltipElement.value !== element) {
      restoreNativeTitle()
    }

    activeTooltipElement.value = element
    preserveNativeTitle(element)
    settingsTooltip.text = text
    positionSettingsTooltip(element)
    settingsTooltip.visible = true
  }

  function hideSettingsTooltip(event) {
    const nextElement = getTooltipElement(event.relatedTarget)
    if (nextElement && nextElement === activeTooltipElement.value) return

    restoreNativeTitle()
    activeTooltipElement.value = null
    settingsTooltip.visible = false
  }

  function dismissSettingsTooltip() {
    restoreNativeTitle()
    activeTooltipElement.value = null
    settingsTooltip.visible = false
  }

  onMounted(() => {
    window.addEventListener('scroll', dismissSettingsTooltip, true)
    window.addEventListener('resize', dismissSettingsTooltip)
  })

  onBeforeUnmount(() => {
    restoreNativeTitle()
    window.removeEventListener('scroll', dismissSettingsTooltip, true)
    window.removeEventListener('resize', dismissSettingsTooltip)
  })

  return {
    settingsTooltip,
    showSettingsTooltip,
    hideSettingsTooltip,
    dismissSettingsTooltip,
  }
}
