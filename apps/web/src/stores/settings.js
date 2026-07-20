import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  fetchClientStateQuietly,
  getCloudSyncConflictStrategy,
  isCloudSyncEnabled,
  scheduleClientStatePushQuietly,
  shouldApplyRemoteClientState,
} from '@/services/clientState'
import storageService from '@/services/storage'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const API_KEY_MASK = '********'
const SENSITIVE_SETTING_KEYS = [
  'wallhaven_api_key',
  'ai_api_key',
  'ai_gptsapi_api_key',
  'ai_gptproto_api_key',
  'ai_subrouter_api_key',
  'ai_zeropro_api_key',
  'ai_wallpaper_api_key',
  'ai_preview_api_key',
  'profile_ai_api_key',
]

const LEGACY_CLIENT_AI_SETTING_KEYS = [
  'ai_provider',
  'ai_gateway_base_url',
  'ai_model',
  'ai_enabled_model_ids_by_provider',
  'ai_wallpaper_provider',
  'ai_wallpaper_gateway_base_url',
  'ai_wallpaper_model',
  'ai_wallpaper_enabled_model_ids_by_provider',
  'ai_preview_provider',
  'ai_preview_gateway_base_url',
  'ai_preview_model',
  'ai_preview_enabled_model_ids_by_provider',
  'profile_ai_use_global',
  'profile_ai_provider',
  'profile_ai_gateway_base_url',
  'profile_ai_model',
  'profile_ai_enabled_model_ids_by_provider',
]
const CLOUD_EXCLUDED_SETTING_KEYS = [...SENSITIVE_SETTING_KEYS, ...LEGACY_CLIENT_AI_SETTING_KEYS]
const LOCAL_ONLY_SETTING_KEYS = [
  'wallhaven_api_key',
  'wallhaven_api_key_configured',
  'theme',
  'save_dir',
  'search_waterfall_quality',
]

function asSettingsObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stripLocalOnlySettings(source = {}) {
  const result = { ...asSettingsObject(source) }
  CLOUD_EXCLUDED_SETTING_KEYS.forEach((key) => {
    delete result[key]
  })
  return result
}

function pickLocalOnlySettings(source = {}) {
  const input = asSettingsObject(source)
  return LOCAL_ONLY_SETTING_KEYS.reduce((result, key) => {
    if (input[key] !== undefined && input[key] !== API_KEY_MASK) {
      result[key] = input[key]
    }
    return result
  }, {})
}

function stripSensitiveSettings(source = {}) {
  const result = { ...asSettingsObject(source) }
  SENSITIVE_SETTING_KEYS.forEach((key) => {
    delete result[key]
  })
  LEGACY_CLIENT_AI_SETTING_KEYS.forEach((key) => {
    delete result[key]
  })
  return result
}

function persistSettingsLocally(source = {}) {
  storageService.set('settings', stripSensitiveSettings(source))
}

function mergeSettingsWithModelSelection(
  settingsSources = [],
) {
  const validSettingsSources = settingsSources.map(asSettingsObject)
  return stripSensitiveSettings(Object.assign({}, ...validSettingsSources))
}

export const useSettingsStore = defineStore('settings', () => {
  // 默认设置
  const defaultSettings = {
    // 下载设置
    max_threads: 5,
    timeout: 30,
    download_launch_delay_ms: 900,
    save_metadata: false,
    overwrite: true,
    show_progress: true,
    batch_download_as_zip: true,
    save_mode: 'default', // 默认保存方式：default, resolution, date, custom
    custom_folder: '', // 自定义归类名称

    // 界面设置
    infinite_scroll: true, // 默认启用无限滚动
    items_per_page: 24, // 与 Wallhaven API 一致，每页固定 24（仅作展示/兼容字段）
    sidebar_compact: false, // 导航栏紧凑布局（由 NavBar + html 类消费）
    enable_animations: true, // 全局动效（由 App 写入 html 类）
    sidebar_animation_effect: true, // 侧边栏/导航栏交互过渡
    enable_blur_effects: true, // 毛玻璃（由 App 写入 html 类）
    /** 缩略图揭幕：off | medium | epic */
    image_reveal_strength: 'medium',
    /** 揭幕形式：mosaic 马赛克格子 | soft 轻量 | blur 渐进清晰 */
    image_reveal_style: 'blur',

    // 内容设置
    show_nsfw: false, // 默认不显示NSFW内容
    wallhaven_api_key: '', // Wallhaven API 密钥
    wallhaven_api_key_configured: false, // 后端是否已保存 Wallhaven API Key
    auto_play_videos: true, // 预留：当前预览以图为主，值仍会持久化
    // AI 设置由后台 AI 中转站统一分配，用户端只保留预算和体验偏好。
    ai_gptsapi_daily_budget_usd: 2,
    ai_gptsapi_monthly_budget_usd: 20,
    ai_gptproto_daily_budget_usd: 2,
    ai_gptproto_monthly_budget_usd: 20,
    ai_subrouter_daily_budget_usd: 2,
    ai_subrouter_monthly_budget_usd: 20,
    ai_zeropro_daily_budget_usd: 2,
    ai_zeropro_monthly_budget_usd: 20,
    ai_wallpaper_execution_mode: 'server',
    ai_wallpaper_daily_budget_usd: 2,
    ai_wallpaper_monthly_budget_usd: 20,
    ai_preview_daily_budget_usd: 2,
    ai_preview_monthly_budget_usd: 20,
    ai_usage_total_requests: 0,
    ai_usage_estimated_cost_usd: 0,
    ai_require_cost_confirm: true,
    ai_daily_budget_usd: 2,
    ai_monthly_budget_usd: 20,
    ai_quality_mode: 'balanced',
    ai_enable_privacy_mode: true,
    // 个人中心 AI 分析设置：模型和服务商由后台 AI 中转站分配。
    public_profile_enabled: true,
    profile_ai_daily_budget_usd: 1,
    profile_ai_monthly_budget_usd: 10,
    /** 全屏预览显示模式：contain 完整显示 | cover 铺满裁切 */
    fullscreen_preview_fit_mode: 'contain',
    /** 桌面样机系统：macos 会按 Retina 逻辑尺寸导出 2x 实际像素 */
    fullscreen_preview_desktop_mockup_platform: 'macos',
    fullscreen_preview_desktop_mockup_width: 1728,
    fullscreen_preview_desktop_mockup_height: 1117,
    /** 搜索/收藏等壁纸卡片画质：tiny 极小 | medium 中等 | high 高清 | original 原图 */
    preview_image_quality: 'high',
    /** 搜索卡片鼠标悬停时是否显示高清预览浮层 */
    show_hover_preview: true,
    /** 搜索卡片悬停时是否显示工具条 */
    show_card_action_toolbar: true,
    /** 搜索卡片悬停时是否显示单图隐藏按钮 */
    show_card_hide_button: true,
    /** 首页 Hero 区域：固定横屏，固定 small 图 */
    home_hero_categories: '111',
    home_hero_purity: '100',
    home_hero_sorting: 'favorites',
    home_hero_resolution: '3840x2160',
    home_hero_color: '',
    home_hero_query: '',
    /** 首页视频灵感：固定横屏 */
    home_video_categories: '111',
    home_video_purity: '100',
    home_video_sorting: 'favorites',
    home_video_resolution: '3840x2160',
    home_video_color: '66cccc',
    home_video_query: '',
    home_video_image_quality: 'original',
    /** 首页手机模块：固定竖屏，可选竖屏比例 */
    home_mobile_categories: '011',
    home_mobile_purity: '100',
    home_mobile_sorting: 'favorites',
    home_mobile_resolution: '',
    home_mobile_color: '',
    home_mobile_ratios: '9x16,10x16',
    home_mobile_query: '',
    home_mobile_image_quality: 'original',
    /** 首页桌面模块：固定横屏 */
    home_desktop_categories: '100',
    home_desktop_purity: '100',
    home_desktop_sorting: 'favorites',
    home_desktop_resolution: '3840x2160',
    home_desktop_color: '',
    home_desktop_query: '',
    home_desktop_image_quality: 'original',
    /** 首页最新模块：固定最新排序 */
    home_latest_categories: '111',
    home_latest_purity: '100',
    home_latest_ratios: '',
    home_latest_resolution: '',
    home_latest_color: '',
    home_latest_query: '',
    home_latest_image_quality: 'original',
    /** 首页随机种子模块 */
    home_random_categories: '111',
    home_random_purity: '100',
    home_random_sorting: 'random',
    home_random_ratios: '',
    home_random_resolution: '',
    home_random_color: '',
    home_random_similar_id: '',
    home_random_image_quality: 'original',
    /** 首页手机模块标签配置：每行 Label=query，query 可为空 */
    home_mobile_tags:
      'All=\nPortrait=portrait\nGirl=girl\nAnime=anime\nBlue=blue\nHatsune Miku=hatsune miku',

    // 性能 / 加载
    enable_lazy_loading: true,
    performance_low_data_mode: false,
    performance_preview_quality_cap: 'high',
    // 旧字段保留兼容，当前网站端没有独立图片缓存引擎
    cache_images: true,
    max_cache_size: 200,
    /** 全屏预览 full 图 blob 缓存：仅缓存用户打开过的高清原图 */
    fullscreen_preview_blob_cache_enabled: true,
    fullscreen_preview_blob_cache_max_items: 10,
    fullscreen_preview_blob_cache_max_mb: 80,
    clear_cache_on_exit: false,

    // 搜索默认设置
    default_resolution: '', // 默认分辨率，空字符串表示不限制
    default_ratio: '', // 默认比例，空字符串表示不限制
    default_sorting: 'favorites', // 默认排序方式
    default_order: 'desc', // 默认排序顺序
    default_color: '', // 默认颜色，空字符串表示不限制
    /** 搜索结果瀑布流：按图片自身比例错位排列，减少空白 */
    search_waterfall_layout: false,
    /** 瀑布流首屏预渲染卡片数量（越大首屏越完整，越小越省性能） */
    search_waterfall_initial_render_count: 18,
    /** 瀑布流预加载距离（px，越大越早渲染可视区外卡片） */
    search_waterfall_preload_px: 900,
    /** 搜索页滚动停止后，顶部导航与筛选栏恢复显示的等待时间（毫秒） */
    search_ui_restore_delay_ms: 3000,
    /** 浏览与搜索：默认分类 */
    search_default_categories: '111',
    /** 浏览与搜索：默认纯度 */
    search_default_purity: '100',
    /** 浏览与搜索：默认热门时间范围 */
    search_default_top_range: '1M',
    /** 浏览与搜索：默认网格列数 */
    search_default_grid_columns: 4,
    /** 浏览与搜索：工具条默认紧凑模式 */
    search_toolbar_compact: true,
    /** 浏览与搜索：工具显示控制 */
    search_toolbar_show_categories: true,
    search_toolbar_show_purity: true,
    search_toolbar_show_resolution: true,
    search_toolbar_show_ratio: true,
    search_toolbar_show_color: true,
    search_toolbar_show_sorting: true,
    search_toolbar_show_top_range: true,
    search_toolbar_show_order: true,
    search_toolbar_show_grid: true,
    search_toolbar_show_quality: true,
    search_toolbar_show_download: true,
    search_toolbar_show_search: true,
    search_toolbar_show_reset: true,
    /** 浏览与搜索：底部悬浮栏滚动停止后恢复显示的等待时间（毫秒） */
    search_dock_restore_delay_ms: 600,
    /** 浏览与搜索：底部悬浮栏工具显示控制 */
    search_dock_show_summary: true,
    search_dock_show_colors: true,
    search_dock_show_selection: true,
    search_dock_show_export_links: true,
    search_dock_show_pending: true,
    search_dock_show_hide_selected: true,
    search_dock_show_compare: true,
    search_dock_show_collection: true,
    search_dock_show_favorite: true,
    search_dock_show_download: true,
    search_dock_show_hidden: true,
    search_dock_show_jump: true,
    search_dock_show_pager: true,
    search_dock_show_more: true,
  }

  // 状态
  const settings = ref({ ...defaultSettings })
  const isLoading = ref(false)
  const error = ref(null)
  let initPromise = null
  let hasInitialized = false

  function getRuntimeSettingsDefaults() {
    try {
      const runtimeConfigStore = useRuntimeConfigStore()
      const defaults = runtimeConfigStore.config?.userOverrides?.settingsDefaults
      return asSettingsObject(defaults)
    } catch {
      return {}
    }
  }

  function syncSettingsState() {
    if (isLoading.value) {
      return Promise.resolve({
        success: false,
        skipped: true,
        reason: 'settings hydrating',
      })
    }

    return scheduleClientStatePushQuietly('settings', () => ({
      settings: stripLocalOnlySettings(settings.value),
    }))
  }

  // 初始化设置
  async function initSettings(options = {}) {
    if (hasInitialized && !options.forceRemote) return true
    if (initPromise) return initPromise

    initPromise = loadSettings(options)
    try {
      const result = await initPromise
      hasInitialized = true
      return result
    } finally {
      initPromise = null
    }
  }

  async function reloadSettings(options = {}) {
    hasInitialized = false
    return initSettings(options)
  }

  async function mergeCloudSettings() {
    const remoteState = await fetchClientStateQuietly('settings')
    const remoteSettings = asSettingsObject(remoteState?.payload?.settings || remoteState?.payload)
    const localOnlySettings = pickLocalOnlySettings(settings.value)
    const strategy = getCloudSyncConflictStrategy()

    if (strategy === 'remote') {
      settings.value = mergeSettingsWithModelSelection([
        defaultSettings,
        getRuntimeSettingsDefaults(),
        stripLocalOnlySettings(remoteSettings),
        localOnlySettings,
      ])
    } else {
      settings.value = mergeSettingsWithModelSelection([
        stripLocalOnlySettings(remoteSettings),
        stripLocalOnlySettings(settings.value),
        localOnlySettings,
      ])
    }

    persistSettingsLocally(settings.value)
    hasInitialized = true
    return syncSettingsState()
  }

  function normalizeLegacySettings(settingsObject) {
    const next = asSettingsObject(settingsObject)
    if (Number(next.search_dock_restore_delay_ms) === 580) {
      next.search_dock_restore_delay_ms = 600
    }
    return next
  }

  async function loadSettings(options = {}) {
    try {
      isLoading.value = true
      error.value = null

      // 从本地存储加载设置
      const storedSettings = asSettingsObject(storageService.get('settings', {}))
      const { theme: _ignoredTheme, ...restStored } = storedSettings
      delete restStored.search_waterfall_quality
      const localOnlySettings = pickLocalOnlySettings(restStored)
      const runtimeSettingsDefaults = getRuntimeSettingsDefaults()
      settings.value = normalizeLegacySettings(
        mergeSettingsWithModelSelection([
          defaultSettings,
          runtimeSettingsDefaults,
          restStored,
        ]),
      )
      // 兼容旧字段 search_ui_restore_delay_sec -> 新字段 search_ui_restore_delay_ms
      if (
        settings.value.search_ui_restore_delay_ms === undefined &&
        settings.value.search_ui_restore_delay_sec !== undefined
      ) {
        const sec = Number(settings.value.search_ui_restore_delay_sec)
        if (Number.isFinite(sec)) settings.value.search_ui_restore_delay_ms = Math.round(sec * 1000)
      }
      if (settings.value.search_ui_restore_delay_ms === undefined) {
        settings.value.search_ui_restore_delay_ms = defaultSettings.search_ui_restore_delay_ms
      }

      const remoteState = await fetchClientStateQuietly('settings')
      const remoteSettings = asSettingsObject(
        remoteState?.payload?.settings || remoteState?.payload,
      )
      if (Object.keys(remoteSettings).length > 0) {
        const strategy = options.conflictStrategy || getCloudSyncConflictStrategy()
        const shouldApplyRemote =
          strategy === 'merge' ||
          (strategy !== 'local' &&
            (options.forceRemote ||
              shouldApplyRemoteClientState('settings', remoteState?.updatedAt)))

        if (shouldApplyRemote) {
          settings.value = normalizeLegacySettings(
            mergeSettingsWithModelSelection([
              strategy === 'remote' ? defaultSettings : settings.value,
              strategy === 'remote' ? getRuntimeSettingsDefaults() : {},
              stripLocalOnlySettings(remoteSettings),
              strategy === 'merge' ? stripLocalOnlySettings(settings.value) : {},
              localOnlySettings,
            ]),
          )
        } else if (strategy === 'local' || strategy === 'merge') {
          settings.value = normalizeLegacySettings(
            mergeSettingsWithModelSelection([
              settings.value,
              strategy === 'merge' ? stripLocalOnlySettings(remoteSettings) : {},
              stripLocalOnlySettings(settings.value),
              localOnlySettings,
            ]),
          )
        }

        persistSettingsLocally(settings.value)
        if (strategy === 'local') void syncSettingsState()
      } else if (isCloudSyncEnabled()) {
        void syncSettingsState()
      }

      persistSettingsLocally(settings.value)

      isLoading.value = false
      return true
    } catch (err) {
      console.error('初始化设置失败:', err)
      error.value = '加载设置失败'
      isLoading.value = false
      return false
    }
  }

  // 更新设置
  async function updateSettings(newSettings) {
    try {
      const payload = { ...asSettingsObject(newSettings) }
      delete payload.theme
      delete payload.save_dir
      delete payload.search_waterfall_quality
      SENSITIVE_SETTING_KEYS.forEach((key) => {
        if (payload[key] === API_KEY_MASK) delete payload[key]
      })

      settings.value = mergeSettingsWithModelSelection([settings.value, payload])
      delete settings.value.theme

      persistSettingsLocally(settings.value)
      void syncSettingsState()
      error.value = null

      return true
    } catch (err) {
      console.error('更新设置失败:', err)
      error.value = '更新设置失败'
      return false
    }
  }

  // 重置设置
  function resetSettings() {
    try {
      // 重置为默认设置
      settings.value = { ...defaultSettings }

      // 保存到本地存储
      persistSettingsLocally(settings.value)
      void syncSettingsState()

      return true
    } catch (err) {
      console.error('重置设置失败:', err)
      error.value = '重置设置失败'
      return false
    }
  }

  // 获取特定设置
  function getSetting(key, defaultValue = null) {
    return settings.value[key] !== undefined ? settings.value[key] : defaultValue
  }

  // 设置特定设置
  function setSetting(key, value) {
    try {
      // 更新特定设置
      if (key === 'search_waterfall_quality') {
        key = 'preview_image_quality'
        value = ['tiny', 'medium', 'high', 'original'].includes(value) ? value : 'high'
      }
      settings.value[key] = value

      // 保存到本地存储
      persistSettingsLocally(settings.value)
      void syncSettingsState()

      return true
    } catch (err) {
      console.error(`设置 ${key} 失败:`, err)
      error.value = `设置 ${key} 失败`
      return false
    }
  }

  return {
    settings,
    isLoading,
    error,
    initSettings,
    reloadSettings,
    mergeCloudSettings,
    updateSettings,
    resetSettings,
    getSetting,
    setSetting,
    syncSettingsState,
  }
})
