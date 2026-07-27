import { computed } from 'vue'

export const DESKTOP_MOCKUP_PLATFORM = {
  macos: 'macos',
  windows: 'windows',
}

export const DESKTOP_MOCKUP_PRESETS = {
  macos: [
    { id: 'macbook-pro-16', label: 'MacBook Pro 16', width: 1728, height: 1117 },
    { id: 'macbook-pro-14', label: 'MacBook Pro 14', width: 1512, height: 982 },
    { id: 'imac-24', label: 'iMac 24', width: 2240, height: 1260 },
  ],
  windows: [
    { id: 'full-hd', label: 'Full HD', width: 1920, height: 1080 },
    { id: 'qhd', label: 'QHD', width: 2560, height: 1440 },
    { id: 'uhd', label: '4K UHD', width: 3840, height: 2160 },
  ],
}

export const DESKTOP_MOCKUP_DEFAULTS = {
  platform: DESKTOP_MOCKUP_PLATFORM.macos,
  width: 1728,
  height: 1117,
}

const DESKTOP_MOCKUP_LIMITS = {
  minWidth: 320,
  minHeight: 240,
  maxExportSide: 8192,
}

const SETTING_KEYS = {
  platform: 'fullscreen_preview_desktop_mockup_platform',
  width: 'fullscreen_preview_desktop_mockup_width',
  height: 'fullscreen_preview_desktop_mockup_height',
}

function toFiniteInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : fallback
}

export function getDesktopMockupScale(platform) {
  return platform === DESKTOP_MOCKUP_PLATFORM.macos ? 2 : 1
}

export function getDefaultDesktopMockupSize(platform) {
  const safePlatform =
    platform === DESKTOP_MOCKUP_PLATFORM.windows ? platform : DESKTOP_MOCKUP_PLATFORM.macos
  return DESKTOP_MOCKUP_PRESETS[safePlatform][0]
}

export function normalizeDesktopMockupConfig(source = {}) {
  const platform =
    source.platform === DESKTOP_MOCKUP_PLATFORM.windows
      ? DESKTOP_MOCKUP_PLATFORM.windows
      : DESKTOP_MOCKUP_PLATFORM.macos
  const scale = getDesktopMockupScale(platform)
  const fallback = getDefaultDesktopMockupSize(platform)
  const maxDisplayWidth = Math.floor(DESKTOP_MOCKUP_LIMITS.maxExportSide / scale)
  const maxDisplayHeight = Math.floor(DESKTOP_MOCKUP_LIMITS.maxExportSide / scale)
  const width = Math.min(
    maxDisplayWidth,
    Math.max(DESKTOP_MOCKUP_LIMITS.minWidth, toFiniteInteger(source.width, fallback.width)),
  )
  const height = Math.min(
    maxDisplayHeight,
    Math.max(DESKTOP_MOCKUP_LIMITS.minHeight, toFiniteInteger(source.height, fallback.height)),
  )

  return {
    platform,
    width,
    height,
    scale,
    exportWidth: width * scale,
    exportHeight: height * scale,
    aspectRatio: width / height,
  }
}

export function useDesktopMockupSettings({ settingsStore }) {
  const desktopMockupConfig = computed(() =>
    normalizeDesktopMockupConfig({
      platform: settingsStore.getSetting(SETTING_KEYS.platform, DESKTOP_MOCKUP_DEFAULTS.platform),
      width: settingsStore.getSetting(SETTING_KEYS.width, DESKTOP_MOCKUP_DEFAULTS.width),
      height: settingsStore.getSetting(SETTING_KEYS.height, DESKTOP_MOCKUP_DEFAULTS.height),
    }),
  )

  function updateDesktopMockupConfig(patch = {}) {
    const next = normalizeDesktopMockupConfig({
      ...desktopMockupConfig.value,
      ...patch,
    })

    // 样机配置属于用户偏好，修改后立即持久化，下次打开直接沿用。
    settingsStore.setSetting(SETTING_KEYS.platform, next.platform)
    settingsStore.setSetting(SETTING_KEYS.width, next.width)
    settingsStore.setSetting(SETTING_KEYS.height, next.height)
  }

  return {
    desktopMockupConfig,
    updateDesktopMockupConfig,
  }
}
