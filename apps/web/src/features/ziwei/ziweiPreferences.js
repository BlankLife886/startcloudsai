const STORAGE_KEY = 'walleven:ziwei:prefs'

export function defaultZiweiPrefs() {
  return {
    /** 进入 /ziwei 时跳过 intro / intake 开场动画 */
    skipEntryCinematic: false,
    /** 控制台点击「生成命盘」后构建 Canvas 沉浸星图 */
    buildStarfieldOnGenerate: false,
    /** 控制台生成时播放排盘 / 揭示动画 */
    playGenerateAnimations: true,
  }
}

export function loadZiweiPrefs() {
  if (typeof localStorage === 'undefined') return defaultZiweiPrefs()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultZiweiPrefs()
    return { ...defaultZiweiPrefs(), ...JSON.parse(raw) }
  } catch {
    return defaultZiweiPrefs()
  }
}

export function saveZiweiPrefs(prefs) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* quota / private mode */
  }
}
