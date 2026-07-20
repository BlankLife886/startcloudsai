import { IMAGE_MODEL_PROVIDERS } from '@/config/aiModels'
import {
  sections,
  searchOrderOptions,
  searchTopRangeOptions,
  searchGridColumnOptions,
  searchColorOptions,
  defaultFilterSelects,
  searchToolbarTools,
  searchDockTools,
  visualSelects,
  visualToggleTools,
  downloadToggleTools,
  dataPerformanceTools,
  performanceQualityCapSelect,
} from '@/config/settingsViewOptions'
import { SETTINGS_FORM_DEFAULTS } from '@/config/settingsDefaults'
import {
  getUsageLogEstimatedCostUsd,
  isBillableUsageLog,
  normalizeClientResourceSummary,
} from '@/features/pricing/pricingMoney.js'
import { useSettingsTooltip } from '@/components/settings/useSettingsTooltip'
import {
  DATA_SECTIONS,
  clearDataSections,
  exportDataBackup,
  getCloudSyncableTotals,
  getDataSectionStats,
  readJsonFile,
  restoreDataBackup,
} from '@/services/dataBackup'
import { clearPreviewBlobCache } from '@/components/wallpaper/fullscreen-preview/features/loader/previewBlobCache'
import { clearAiUsageLedger, getAiUsageLedger } from '@/services/aiUsageLedger'
import { getClientResourceSummary } from '@/services/aiWallpaper'
import { applyWalletFromSummary } from '@/composables/useClientWalletBalance'
import { mergeCloudAiWallpaperState } from '@/services/aiWallpaperState'
import { pushAllLocalClientStateToCloud, reconcileLocalClientStateToCloud } from '@/services/clientStateSync'
import {
  clearClientStateSyncMeta,
  clearCloudClientState,
  getCloudSyncConflictStrategy,
  fetchClientStateSummary,
  isCloudSyncEnabled,
  listClientStateSyncIssues,
  setCloudSyncConflictStrategy,
  setCloudSyncEnabled,
} from '@/services/clientState'
import { deleteUserSecret, fetchUserSecrets, saveUserSecret } from '@/services/userSecrets'
import notificationService from '@/services/notification'
import { useAuthStore } from '@/stores/auth'
import { useDownloadsStore } from '@/stores/downloads'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useSettingsStore } from '@/stores/settings'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useUserStore } from '@/stores/user'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

export function useSettingsViewState() {
  const settingsStore = useSettingsStore()
  const runtimeConfigStore = useRuntimeConfigStore()
  const favoritesStore = useFavoritesStore()
  const historyStore = useHistoryStore()
  const userStore = useUserStore()
  const downloadsStore = useDownloadsStore()
  const authStore = useAuthStore()
  const API_KEY_MASK = '********'
  const SENSITIVE_SETTING_KEYS = ['wallhaven_api_key']
  const SECRET_LABELS = {
    wallhaven_api_key: 'Wallhaven API Key',
  }

  const isLoading = ref(true)
  const isSaving = ref(false)
  const activeTab = ref('general')
  const isDataExporting = ref(false)
  const isDataImporting = ref(false)
  const isCloudSyncing = ref(false)
  const isCloudSummaryLoading = ref(false)
  const isSecretSaving = ref(false)
  const isResourceSummaryLoading = ref(false)
  const cloudSyncEnabled = ref(isCloudSyncEnabled())
  const cloudConflictStrategy = ref(getCloudSyncConflictStrategy())
  const cloudSummary = ref({ totalKb: 0, summary: {} })
  const cloudSyncIssues = ref([])
  const secretStatus = ref({})
  const resourceSummary = ref({
    account: { balance: 0, frozenBalance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
    usage: {
      today: { units: 0, estimatedCostUsd: 0 },
      month: { units: 0, estimatedCostUsd: 0 },
      total: { units: 0, estimatedCostUsd: 0 },
      logs: [],
    },
    credits: { ledger: [] },
  })
  const selectedDataSectionIds = ref(DATA_SECTIONS.map((section) => section.id))
  const showWallhavenApiKey = ref(false)
  const activeSettingsDropdown = ref(null)
  const { settingsTooltip, showSettingsTooltip, hideSettingsTooltip, dismissSettingsTooltip } =
    useSettingsTooltip()

  const settingsPageLayout = computed(() => runtimeConfigStore.getPageLayout('settings') || {})
  const visibleSections = computed(() =>
    sections.filter((section) => isSettingsSectionEnabled(section.id)),
  )
  const totalFavorites = computed(() => favoritesStore.favoritesCount)
  const totalHistory = computed(() => historyStore.historyCount)

  const storageUsage = computed(() => {
    try {
      const stats = getDataSectionStats()
      const favoritesSize = stats.find((item) => item.id === 'favorites')?.sizeKb || 0
      const historySize = stats.find((item) => item.id === 'history')?.sizeKb || 0
      const settingsSize = stats.find((item) => item.id === 'settings')?.sizeKb || 0
      const totalSize = stats.reduce((sum, item) => sum + Number(item.sizeKb || 0), 0)
      return {
        favorites: Number(favoritesSize).toFixed(2),
        history: Number(historySize).toFixed(2),
        settings: Number(settingsSize).toFixed(2),
        total: Number(totalSize).toFixed(2),
      }
    } catch (error) {
      return { favorites: 0, history: 0, settings: 0, total: 0 }
    }
  })
  const dataSectionStats = computed(() => getDataSectionStats())
  const cloudSyncableTotals = computed(() => getCloudSyncableTotals())
  const syncParityHint = computed(() => {
    const syncableKb = Number(cloudSyncableTotals.value.syncableKb || 0)
    const localOnlyKb = Number(cloudSyncableTotals.value.localOnlyKb || 0)
    const cloudKb = Number(cloudSummary.value?.totalKb || 0)
    const gapKb = Math.max(0, syncableKb - cloudKb)
    const favoritesSection = dataSectionStats.value.find((section) => section.id === 'favorites')
    const favoritesOrphanKb = Number(favoritesSection?.localOnlyKb || 0)
    const showOrphanBackupHint =
      totalFavorites.value === 0 && favoritesOrphanKb >= 8 && cloudSyncEnabled.value

    return {
      syncableKb: Number(syncableKb.toFixed(2)),
      localOnlyKb: Number(localOnlyKb.toFixed(2)),
      cloudKb: Number(cloudKb.toFixed(2)),
      gapKb: Number(gapKb.toFixed(2)),
      showOrphanBackupHint,
      favoritesOrphanKb: Number(favoritesOrphanKb.toFixed(2)),
      isOutOfSync: cloudSyncEnabled.value && gapKb >= 8,
    }
  })
  const cloudDataStats = computed(() => {
    const summary = cloudSummary.value?.summary || {}
    const labelMap = {
      favorites: '收藏',
      history: '浏览历史',
      settings: '设置',
      downloads: '下载',
      authors: '关注',
      tags: '标签',
      aiWallpaper: 'AI壁纸',
    }
    return ['favorites', 'history', 'settings', 'downloads', 'authors', 'tags', 'aiWallpaper'].map((key) => {
      const item = summary[key] || {}
      return {
        key,
        label: labelMap[key],
        sizeKb: Number((Number(item.bytes || 0) / 1024).toFixed(2)),
        itemCount: Number(item.itemCount || 0),
        updatedAt: item.updatedAt || '',
      }
    })
  })
  const canUseDownload = computed(() => runtimeConfigStore.canUse('download'))
  const canUseSync = computed(() => runtimeConfigStore.canUse('sync'))
  const canUseAiOptimize = computed(() => runtimeConfigStore.canUse('ai.optimize'))
  const canUseAiImageToModel = computed(() => runtimeConfigStore.canUse('ai.imageToModel'))
  const canUseFilters = computed(() => runtimeConfigStore.canUse('filters'))
  const aiOptimizeRuntimeConfig = computed(
    () => runtimeConfigStore.getFeaturePayload('ai.optimize') || {},
  )
  const runtimeModelCatalog = computed(() => runtimeConfigStore.getAiModelCatalog())
  const runtimeAiProviders = computed(() => {
    const providers = Array.isArray(runtimeModelCatalog.value?.providers)
      ? runtimeModelCatalog.value.providers
      : []
    const normalized = providers
      .map((provider) => ({
        id: String(provider?.id || '').trim(),
        label: String(provider?.label || provider?.id || '').trim(),
        baseURL: String(provider?.baseURL || provider?.baseUrl || ''),
        note: String(provider?.note || ''),
      }))
      .filter((provider) => provider.id)
    return normalized.length ? normalized : IMAGE_MODEL_PROVIDERS
  })
  const runtimeAiProviderOptions = computed(() => {
    const allowedProviders = Array.isArray(aiOptimizeRuntimeConfig.value.allowedProviders)
      ? aiOptimizeRuntimeConfig.value.allowedProviders.map(String).filter(Boolean)
      : []
    const options = runtimeAiProviders.value.map((provider) => ({
      value: provider.id,
      label: provider.label,
    }))
    if (!allowedProviders.length) return options
    return options.filter((provider) => allowedProviders.includes(provider.value))
  })
  const wallhavenSecretConfigured = computed(
    () => secretStatus.value.wallhaven_api_key?.configured === true,
  )

  function isSettingsSectionEnabled(sectionId) {
    const sectionConfig = settingsPageLayout.value?.[sectionId]
    if (sectionConfig?.enabled === false) return false
    if (sectionId === 'download') return canUseDownload.value
    if (sectionId === 'ai') return canUseAiOptimize.value || canUseAiImageToModel.value
    if (sectionId === 'data') return canUseSync.value
    if (sectionId === 'visuals') return canUseFilters.value
    return true
  }

  function ensureActiveSettingsTab() {
    const available = visibleSections.value
    if (!available.some((section) => section.id === activeTab.value)) {
      activeTab.value = available[0]?.id || 'general'
    }
  }
  const wallhavenSecretUpdatedAt = computed(
    () => secretStatus.value.wallhaven_api_key?.updatedAt || '',
  )
  const cloudConflictStrategies = [
    { value: 'merge', label: '合并两边' },
    { value: 'local', label: '本机优先' },
    { value: 'remote', label: '云端优先' },
  ]
  const aiUsageSummary = computed(() => ({
    requests:
      Number(resourceSummary.value.usage?.total?.units) ||
      Number(formData.ai_usage_total_requests) ||
      0,
    cost:
      Number(resourceSummary.value.usage?.total?.estimatedCostUsd) ||
      Number(formData.ai_usage_estimated_cost_usd) ||
      0,
    today: resourceSummary.value.usage?.today || { units: 0, estimatedCostUsd: 0 },
    month: resourceSummary.value.usage?.month || { units: 0, estimatedCostUsd: 0 },
    total: resourceSummary.value.usage?.total || { units: 0, estimatedCostUsd: 0 },
    account: resourceSummary.value.account || {},
  }))
  const aiModelLeaderboard = computed(() => {
    const serverLogs = Array.isArray(resourceSummary.value.usage?.logs)
      ? resourceSummary.value.usage.logs
      : []
    if (serverLogs.length) {
      const byFeature = serverLogs.reduce((result, item) => {
        const label = getAiUsageDisplayLabel(item.resourceType || item.resource_type || '')
        const row = result[label] || { label, success: 0, failed: 0, cost: 0 }
        const status = String(item.status || '').toLowerCase()
        if (status === 'failed') row.failed += 1
        else if (isBillableUsageLog(item)) {
          row.success += Number(item.units || 1)
          row.cost += getUsageLogEstimatedCostUsd(item)
        }
        result[label] = row
        return result
      }, {})
      return Object.values(byFeature)
        .map((stat) => ({
          label: stat.label || 'AI 处理',
          success: Number(stat?.successCount ?? stat?.success ?? 0),
          failed: Number(stat?.failed || 0),
          cost: Number(stat?.cost || 0),
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5)
    }
    try {
      const parsed = getAiUsageLedger()
      const byFeature = parsed?.byFeature || {}
      return Object.entries(byFeature)
        .map(([featureKey, stat]) => ({
          label: getAiUsageDisplayLabel(featureKey),
          success: Number(stat?.successCount ?? stat?.success ?? 0),
          failed: Number(stat?.failed || 0),
          cost: Number(sumAiUsageFeatureCost(stat) || 0),
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5)
    } catch {
      return []
    }
  })

  function getAiUsageDisplayLabel(value) {
    const key = String(value || '').toLowerCase()
    if (key.includes('image-to-model') || key.includes('3d')) return '图转 3D'
    if (key.includes('wallpaper')) return 'AI 壁纸创作'
    if (key.includes('preview') || key === 'ai') return '图片智能优化'
    if (key.includes('profile')) return '个人资料分析'
    return 'AI 处理'
  }

  function sumAiUsageFeatureCost(stat) {
    if (!stat || typeof stat !== 'object') return 0
    const byMonth = stat.byMonth && typeof stat.byMonth === 'object' ? stat.byMonth : {}
    const monthValues = Object.values(byMonth)
    if (monthValues.length) {
      return monthValues.reduce((sum, item) => sum + Number(item?.cost || 0), 0)
    }
    return Object.values(stat.byModel || {}).reduce((sum, item) => sum + Number(item?.cost || 0), 0)
  }

  const selectedSearchColorOption = computed(
    () =>
      searchColorOptions.find((option) => option.value === formData.default_color) ||
      searchColorOptions[0],
  )
  const allSearchToolbarToolsVisible = computed(() =>
    searchToolbarTools.every((tool) => formData[tool.key] !== false),
  )
  const allSearchDockToolsVisible = computed(() =>
    searchDockTools.every((tool) => formData[tool.key] !== false),
  )
  const formData = reactive({ ...SETTINGS_FORM_DEFAULTS })
  const canUseNsfw = computed(() => authStore.isAuthenticated)

  function enforceGuestNsfwLock({ notify = false } = {}) {
    if (canUseNsfw.value) return
    const wasEnabled = formData.show_nsfw === true
    formData.show_nsfw = false
    formData.wallhaven_api_key = ''
    formData.wallhaven_api_key_configured = false
    settingsStore.setSetting('show_nsfw', false)
    settingsStore.setSetting('wallhaven_api_key', '')
    settingsStore.setSetting('wallhaven_api_key_configured', false)
    if (notify && wasEnabled) {
      notificationService.warning('游客不能开启 NSFW，请先登录账号后再保存后端 API Key', {
        duration: 2600,
        position: 'bottom-center',
      })
    }
  }

  function isVisualToolDisabled(tool) {
    return tool.key === 'show_hover_preview' && formData.search_waterfall_layout === true
  }

  function visualToolTitle(tool) {
    if (isVisualToolDisabled(tool)) {
      return '瀑布流布局下不启用高清悬停'
    }
    return tool.tooltip
  }

  watch(
    () => formData.search_waterfall_layout,
    (enabled) => {
      if (enabled) {
        formData.show_hover_preview = false
      }
    },
  )

  watch(
    () => authStore.isAuthenticated,
    () => enforceGuestNsfwLock(),
    { immediate: true },
  )

  watch(
    () => formData.show_nsfw,
    (enabled) => {
      if (enabled && !canUseNsfw.value) {
        enforceGuestNsfwLock({ notify: true })
      }
    },
  )

  watch(
    () => authStore.user?.id || '',
    async () => {
      cloudSyncEnabled.value = isCloudSyncEnabled()
      cloudConflictStrategy.value = getCloudSyncConflictStrategy()
      await refreshCloudSummary()
      await refreshSecretStatus()
      await refreshResourceSummary()
    },
  )

  watch(
    visibleSections,
    () => {
      ensureActiveSettingsTab()
    },
    { immediate: true },
  )

  async function saveSettings() {
    isSaving.value = true

    try {
      const settingsPayload = { ...formData }
      if (!canUseNsfw.value) {
        settingsPayload.show_nsfw = false
        settingsPayload.wallhaven_api_key = ''
        settingsPayload.wallhaven_api_key_configured = false
      }
      if (settingsPayload.search_waterfall_layout === true) {
        settingsPayload.show_hover_preview = false
      }
      delete settingsPayload.theme
      delete settingsPayload.save_dir
      delete settingsPayload.search_waterfall_quality
      stripClientManagedHomeSettings(settingsPayload)
      stripClientManagedAiSettings(settingsPayload)

      if (authStore.isAuthenticated) {
        await saveSensitiveSettingsFromPayload(settingsPayload)
      }

      const success = await settingsStore.updateSettings(settingsPayload)
      if (!success) {
        throw new Error(settingsStore.error || '保存失败')
      }

      // 底部非占位 Toast，不挤压表单布局
      notificationService.success('设置已保存', {
        duration: 2400,
        position: 'bottom-center',
      })
    } catch (error) {
      console.error('保存设置失败:', error)
      const message = error.message || '保存失败'
      notificationService.error(`保存设置失败: ${message}`, {
        duration: 3600,
        position: 'bottom-center',
      })
    } finally {
      isSaving.value = false
    }
  }

  function stripClientManagedAiSettings(settingsPayload) {
    ;[
      'ai_api_key',
      'ai_gptsapi_api_key',
      'ai_gptproto_api_key',
      'ai_subrouter_api_key',
      'ai_zeropro_api_key',
      'ai_wallpaper_api_key',
      'ai_preview_api_key',
      'profile_ai_api_key',
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
    ].forEach((key) => {
      delete settingsPayload[key]
    })
  }

  function stripClientManagedHomeSettings(settingsPayload) {
    Object.keys(settingsPayload).forEach((key) => {
      if (key.startsWith('home_')) delete settingsPayload[key]
    })
  }

  function resetSettings() {
    if (!confirm('确定要将所有设置恢复为默认值吗？（含主题恢复为默认）')) {
      return
    }

    settingsStore.resetSettings()
    Object.assign(formData, settingsStore.settings)
    enforceGuestNsfwLock()
    formData.theme = 'default'

    notificationService.success('已恢复默认设置', {
      duration: 2400,
      position: 'bottom-center',
    })
  }

  function clearCache() {
    if (!confirm('确定要清理站点临时缓存吗？')) {
      return
    }

    try {
      clearPreviewBlobCache()
      localStorage.removeItem('walleven_image_cache')

      if (window.caches) {
        window.caches.keys().then((keys) => {
          keys.filter((key) => key.includes('walleven')).forEach((key) => window.caches.delete(key))
        })
      }

      if (window.indexedDB) {
        window.indexedDB.deleteDatabase('walleven-cache')
      }

      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' })
      }

      notificationService.success('站点临时缓存已清理', {
        duration: 2400,
        position: 'bottom-center',
      })
    } catch (error) {
      console.error('清理缓存失败:', error)
      notificationService.error(`清理缓存失败: ${error.message}`, {
        duration: 3200,
        position: 'bottom-center',
      })
    }
  }

  function resetAiUsage() {
    formData.ai_usage_total_requests = 0
    formData.ai_usage_estimated_cost_usd = 0
    settingsStore.setSetting('ai_usage_total_requests', 0)
    settingsStore.setSetting('ai_usage_estimated_cost_usd', 0)
    clearAiUsageLedger()
    notificationService.success('AI 消耗统计已清零', {
      duration: 2200,
      position: 'bottom-center',
    })
  }

  function setDefaultSearchColor(value) {
    formData.default_color = value
    activeSettingsDropdown.value = null
  }

  function setSettingsColorValue(model, value) {
    formData[model] = value
    activeSettingsDropdown.value = null
  }

  function toggleSettingsDropdown(name) {
    dismissSettingsTooltip()
    activeSettingsDropdown.value = activeSettingsDropdown.value === name ? null : name
  }

  function setSettingsSelectValue(model, value) {
    formData[model] = value
    activeSettingsDropdown.value = null
  }

  function getSettingsSelectLabel(select) {
    return (
      select.options.find((option) => option.value === formData[select.model])?.label ||
      select.options[0]?.label ||
      '选择'
    )
  }

  function getSettingsColorOption(model) {
    return (
      searchColorOptions.find((option) => option.value === formData[model]) || searchColorOptions[0]
    )
  }

  function setAllSearchToolbarVisible(visible) {
    searchToolbarTools.forEach((tool) => {
      formData[tool.key] = visible
    })
  }

  function setAllSearchDockVisible(visible) {
    searchDockTools.forEach((tool) => {
      formData[tool.key] = visible
    })
  }

  function closeSettingsDropdowns(event) {
    if (!event.target.closest('.settings-filter-dropdown')) {
      activeSettingsDropdown.value = null
    }
  }

  async function copyWallhavenApiKey() {
    const key = String(formData.wallhaven_api_key || '').trim()
    if (key === '********') {
      notificationService.info('后端已保存 API Key，明文不会再返回前端', {
        duration: 2600,
        position: 'bottom-center',
      })
      return
    }

    if (!key) {
      notificationService.warning('没有可复制的 Wallhaven API Key', {
        duration: 2200,
        position: 'bottom-center',
      })
      return
    }

    try {
      await navigator.clipboard.writeText(key)
      notificationService.success('Wallhaven API Key 已复制', {
        duration: 2200,
        position: 'bottom-center',
      })
    } catch (error) {
      console.error('复制 Wallhaven API Key 失败:', error)
      notificationService.error('复制失败，请手动选中后复制', {
        duration: 2800,
        position: 'bottom-center',
      })
    }
  }

  async function refreshSecretStatus() {
    if (!authStore.isAuthenticated) {
      secretStatus.value = {}
      return
    }

    try {
      const data = await fetchUserSecrets()
      secretStatus.value = (data.secrets || []).reduce((result, item) => {
        result[item.key] = item
        return result
      }, {})
      SENSITIVE_SETTING_KEYS.forEach((key) => {
        if (secretStatus.value[key]?.configured) {
          formData[key] = API_KEY_MASK
          settingsStore.setSetting(key, '')
          if (key === 'wallhaven_api_key') {
            formData.wallhaven_api_key_configured = true
            settingsStore.setSetting('wallhaven_api_key_configured', true)
          }
        } else if (formData[key] === API_KEY_MASK) {
          formData[key] = ''
          if (key === 'wallhaven_api_key') {
            formData.wallhaven_api_key_configured = false
            settingsStore.setSetting('wallhaven_api_key_configured', false)
          }
        }
      })
    } catch (error) {
      console.warn('读取敏感设置状态失败:', error)
    }
  }

  async function refreshResourceSummary() {
    if (!authStore.isAuthenticated) {
      resourceSummary.value = {
        account: { balance: 0, frozenBalance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
        usage: {
          today: { units: 0, estimatedCostUsd: 0 },
          month: { units: 0, estimatedCostUsd: 0 },
          total: { units: 0, estimatedCostUsd: 0 },
          logs: [],
        },
        credits: { ledger: [] },
      }
      return
    }

    isResourceSummaryLoading.value = true
    try {
      const data = await getClientResourceSummary()
      if (data?.summary) {
        resourceSummary.value = normalizeClientResourceSummary(data.summary)
        // 任何页面拉取资源摘要后都同步全局钱包快照，保证全站余额一致。
        applyWalletFromSummary(resourceSummary.value)
      }
    } catch (error) {
      console.warn('读取资源用量失败:', error)
    } finally {
      isResourceSummaryLoading.value = false
    }
  }

  async function saveSensitiveSettingsFromPayload(settingsPayload) {
    for (const key of SENSITIVE_SETTING_KEYS) {
      const value = String(settingsPayload[key] || '').trim()
      delete settingsPayload[key]
      if (value && value !== API_KEY_MASK) {
        const saved = await saveSensitiveSecret(key, value, { showToast: false })
        if (!saved) throw new Error(`${SECRET_LABELS[key] || key} 保存失败`)
        if (key === 'wallhaven_api_key') {
          settingsPayload.wallhaven_api_key_configured = true
        }
      } else {
        settingsStore.setSetting(key, '')
        if (key === 'wallhaven_api_key') {
          settingsPayload.wallhaven_api_key_configured =
            secretStatus.value.wallhaven_api_key?.configured === true || value === API_KEY_MASK
        }
      }
    }
  }

  async function saveSensitiveSecret(key, rawValue = formData[key], { showToast = true } = {}) {
    if (!authStore.isAuthenticated) {
      if (showToast) {
        notificationService.warning(
          `请先登录账号，再保存 ${SECRET_LABELS[key] || 'API Key'} 到云端`,
          {
            duration: 2600,
            position: 'bottom-center',
          },
        )
      }
      return false
    }

    const value = String(rawValue || '').trim()
    if (!value || value === API_KEY_MASK) {
      if (showToast && value === API_KEY_MASK) {
        notificationService.info('后端已保存，无需重复提交', {
          duration: 2200,
          position: 'bottom-center',
        })
      }
      return false
    }

    isSecretSaving.value = true
    try {
      const data = await saveUserSecret(key, value)
      secretStatus.value = {
        ...secretStatus.value,
        [key]: data.secret,
      }
      formData[key] = API_KEY_MASK
      settingsStore.setSetting(key, '')
      if (key === 'wallhaven_api_key') {
        formData.wallhaven_api_key_configured = true
        settingsStore.setSetting('wallhaven_api_key_configured', true)
      }
      if (showToast) {
        notificationService.success(`${SECRET_LABELS[key] || 'API Key'} 已加密保存到后端`, {
          duration: 2400,
          position: 'bottom-center',
        })
      }
      return true
    } catch (error) {
      if (!showToast) throw error
      notificationService.error(error?.message || `保存 ${SECRET_LABELS[key] || 'API Key'} 失败`, {
        duration: 3200,
        position: 'bottom-center',
      })
      return false
    } finally {
      isSecretSaving.value = false
    }
  }

  async function saveWallhavenApiKey(rawValue = formData.wallhaven_api_key, showToast = true) {
    return saveSensitiveSecret('wallhaven_api_key', rawValue, { showToast })
  }

  async function clearWallhavenApiKey() {
    return clearSensitiveSecret('wallhaven_api_key')
  }

  async function clearSensitiveSecret(key) {
    if (!authStore.isAuthenticated) return false
    if (!confirm(`确定要删除后端保存的 ${SECRET_LABELS[key] || 'API Key'} 吗？`)) return false

    isSecretSaving.value = true
    try {
      await deleteUserSecret(key)
      secretStatus.value = {
        ...secretStatus.value,
        [key]: { configured: false },
      }
      formData[key] = ''
      settingsStore.setSetting(key, '')
      if (key === 'wallhaven_api_key') {
        formData.wallhaven_api_key_configured = false
        settingsStore.setSetting('wallhaven_api_key_configured', false)
      }
      notificationService.success(`${SECRET_LABELS[key] || 'API Key'} 已从后端删除`, {
        duration: 2200,
        position: 'bottom-center',
      })
      return true
    } catch (error) {
      notificationService.error(error?.message || `删除 ${SECRET_LABELS[key] || 'API Key'} 失败`, {
        duration: 3200,
        position: 'bottom-center',
      })
      return false
    } finally {
      isSecretSaving.value = false
    }
  }

  async function refreshLocalStoresAfterDataChange() {
    await Promise.allSettled([
      settingsStore.initSettings(),
      favoritesStore.initFavorites(),
      userStore.initUserData(),
      historyStore.initHistory(),
    ])
    Object.assign(formData, settingsStore.settings)
    enforceGuestNsfwLock()
    formData.theme = 'default'
    normalizeDefaults()
  }

  function refreshCloudSyncIssues() {
    cloudSyncIssues.value = listClientStateSyncIssues()
  }

  async function refreshCloudSummary() {
    if (!authStore.isAuthenticated) {
      cloudSummary.value = { totalKb: 0, summary: {} }
      cloudSyncIssues.value = []
      return
    }

    isCloudSummaryLoading.value = true
    try {
      cloudSummary.value = await fetchClientStateSummary()
      refreshCloudSyncIssues()
    } catch (error) {
      console.error('读取云端摘要失败:', error)
      notificationService.error(`读取云端摘要失败: ${error.message || '未知错误'}`, {
        duration: 3200,
        position: 'bottom-center',
      })
    } finally {
      isCloudSummaryLoading.value = false
    }
  }

  async function enableCloudSync() {
    if (!canUseSync.value) {
      notificationService.warning('云同步功能暂未开放', {
        duration: 2600,
        position: 'bottom-center',
      })
      return
    }
    if (!authStore.isAuthenticated) {
      notificationService.warning('请先登录账号，再开启云同步', {
        duration: 2600,
        position: 'bottom-center',
      })
      return
    }

    isCloudSyncing.value = true
    try {
      if (!setCloudSyncEnabled(true)) {
        throw new Error('账号状态异常，请重新登录')
      }
      cloudSyncEnabled.value = true
      cloudConflictStrategy.value = getCloudSyncConflictStrategy()
      await Promise.allSettled([
        settingsStore.mergeCloudSettings(),
        favoritesStore.mergeCloudFavorites(),
        historyStore.mergeCloudHistory(),
        userStore.mergeCloudUserData(),
        downloadsStore.initDownloads({ conflictStrategy: cloudConflictStrategy.value }),
        mergeCloudAiWallpaperState({
          pushWhenEmpty: true,
          forcePush: true,
          conflictStrategy: cloudConflictStrategy.value,
        }),
      ])
      await pushAllLocalClientStateToCloud()
      await refreshCloudSummary()
      refreshCloudSyncIssues()
      if (cloudSyncIssues.value.length) {
        notificationService.warning(
          `云同步已开启，但部分数据上传失败：${cloudSyncIssues.value.map((item) => item.label).join('、')}`,
          {
            duration: 5000,
            position: 'bottom-center',
          },
        )
      } else {
        notificationService.success('云同步已开启，本地数据已合并并上传到云端', {
          duration: 3000,
          position: 'bottom-center',
        })
      }
    } catch (error) {
      setCloudSyncEnabled(false)
      cloudSyncEnabled.value = false
      notificationService.error(`开启云同步失败: ${error.message || '未知错误'}`, {
        duration: 3600,
        position: 'bottom-center',
      })
    } finally {
      isCloudSyncing.value = false
    }
  }

  async function setCloudConflictStrategy(strategy) {
    cloudConflictStrategy.value = setCloudSyncConflictStrategy(strategy)
    if (!cloudSyncEnabled.value) {
      notificationService.success('同步策略已保存，下次开启云同步时生效', {
        duration: 2400,
        position: 'bottom-center',
      })
      return
    }

    isCloudSyncing.value = true
    try {
      await Promise.allSettled([
        settingsStore.reloadSettings({
          forceRemote: true,
          conflictStrategy: cloudConflictStrategy.value,
        }),
        favoritesStore.reloadFavorites({
          forceRemote: true,
          conflictStrategy: cloudConflictStrategy.value,
        }),
        historyStore.reloadHistory({
          forceRemote: true,
          conflictStrategy: cloudConflictStrategy.value,
        }),
        userStore.mergeCloudUserData({
          forceRemote: true,
          conflictStrategy: cloudConflictStrategy.value,
        }),
        downloadsStore.initDownloads({
          forceRemote: true,
          conflictStrategy: cloudConflictStrategy.value,
        }),
        mergeCloudAiWallpaperState({
          forceRemote: true,
          conflictStrategy: cloudConflictStrategy.value,
          forcePush: true,
        }),
      ])
      await pushAllLocalClientStateToCloud()
      await refreshCloudSummary()
      refreshCloudSyncIssues()
      if (cloudSyncIssues.value.length) {
        notificationService.warning(
          `同步策略已应用，但仍有上传失败项：${cloudSyncIssues.value.map((item) => item.label).join('、')}`,
          {
            duration: 4200,
            position: 'bottom-center',
          },
        )
      } else {
        notificationService.success('同步策略已应用', {
          duration: 2400,
          position: 'bottom-center',
        })
      }
    } finally {
      isCloudSyncing.value = false
    }
  }

  function disableCloudSync() {
    setCloudSyncEnabled(false)
    cloudSyncEnabled.value = false
    notificationService.success('云同步已关闭，后续只保存在本机', {
      duration: 2600,
      position: 'bottom-center',
    })
  }

  async function toggleCloudSync() {
    if (cloudSyncEnabled.value) {
      disableCloudSync()
      return
    }
    await enableCloudSync()
  }

  async function clearCloudData() {
    if (!authStore.isAuthenticated) {
      notificationService.warning('请先登录账号', {
        duration: 2200,
        position: 'bottom-center',
      })
      return
    }
    if (!confirm('确定清空当前账号的云端设置、收藏、历史、下载、关注、标签和 AI 壁纸状态吗？本机数据不会被删除。')) return

    isCloudSyncing.value = true
    try {
      await clearCloudClientState()
      if (cloudSyncEnabled.value) {
        await reconcileLocalClientStateToCloud()
        refreshCloudSyncIssues()
        if (cloudSyncIssues.value.length) {
          notificationService.warning(
            `云端已清空，但部分本机数据未能重新上传：${cloudSyncIssues.value.map((item) => item.label).join('、')}`,
            {
              duration: 5000,
              position: 'bottom-center',
            },
          )
        } else {
          notificationService.success('云端已清空，本机数据已重新上传为新的云端副本', {
            duration: 3200,
            position: 'bottom-center',
          })
        }
      } else {
        // 云端已空，本地 sync meta（remote_updated_at 等）随之失效，必须清理
        clearClientStateSyncMeta()
        notificationService.success('云端数据已清空，本机数据保留', {
          duration: 2600,
          position: 'bottom-center',
        })
      }
      await refreshCloudSummary()
    } catch (error) {
      notificationService.error(`清空云端失败: ${error.message || '未知错误'}`, {
        duration: 3600,
        position: 'bottom-center',
      })
    } finally {
      isCloudSyncing.value = false
    }
  }

  async function uploadCloudNow() {
    if (!cloudSyncEnabled.value) {
      notificationService.warning('请先开启云同步', {
        duration: 2400,
        position: 'bottom-center',
      })
      return
    }
    if (!authStore.isAuthenticated) {
      notificationService.warning('请先登录账号', {
        duration: 2400,
        position: 'bottom-center',
      })
      return
    }

    isCloudSyncing.value = true
    try {
      const { repair } = await reconcileLocalClientStateToCloud()
      await refreshCloudSummary()
      refreshCloudSyncIssues()
      if (cloudSyncIssues.value.length) {
        notificationService.warning(
          `部分数据未能上传：${cloudSyncIssues.value.map((item) => item.label).join('、')}`,
          {
            duration: 5000,
            position: 'bottom-center',
          },
        )
      } else {
        notificationService.success(
          repair?.restoredFavorites
            ? '已从本地备份恢复收藏，并完成上传到云端'
            : '本地可同步数据已上传到云端',
          {
            duration: 3200,
            position: 'bottom-center',
          },
        )
      }
    } catch (error) {
      notificationService.error(`上传云端失败: ${error.message || '未知错误'}`, {
        duration: 3600,
        position: 'bottom-center',
      })
    } finally {
      isCloudSyncing.value = false
    }
  }

  function getSelectedDataSectionIds(useAll = false) {
    return useAll ? DATA_SECTIONS.map((section) => section.id) : selectedDataSectionIds.value
  }

  function toggleDataSection(sectionId) {
    if (selectedDataSectionIds.value.includes(sectionId)) {
      selectedDataSectionIds.value = selectedDataSectionIds.value.filter((id) => id !== sectionId)
      return
    }
    selectedDataSectionIds.value = [...selectedDataSectionIds.value, sectionId]
  }

  function toggleAllDataSections() {
    selectedDataSectionIds.value =
      selectedDataSectionIds.value.length === DATA_SECTIONS.length
        ? []
        : DATA_SECTIONS.map((section) => section.id)
  }

  function exportSelectedDataBackup(useAll = false) {
    const sectionIds = getSelectedDataSectionIds(useAll)
    if (!sectionIds.length) {
      notificationService.warning('请先选择要备份的数据范围', {
        duration: 2200,
        position: 'bottom-center',
      })
      return
    }

    isDataExporting.value = true
    try {
      exportDataBackup(sectionIds)
      notificationService.success(useAll ? '全部数据已开始导出' : '选中数据已开始导出', {
        duration: 2400,
        position: 'bottom-center',
      })
    } catch (error) {
      console.error('导出数据备份失败:', error)
      notificationService.error(`导出失败: ${error.message || '未知错误'}`, {
        duration: 3200,
        position: 'bottom-center',
      })
    } finally {
      isDataExporting.value = false
    }
  }

  async function importSelectedDataBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const sectionIds = getSelectedDataSectionIds(false)
    if (!sectionIds.length) {
      notificationService.warning('请先选择要还原的数据范围', {
        duration: 2200,
        position: 'bottom-center',
      })
      event.target.value = ''
      return
    }

    if (!confirm('确定要用备份文件还原选中范围吗？当前对应数据会被覆盖。')) {
      event.target.value = ''
      return
    }

    isDataImporting.value = true
    try {
      const backup = await readJsonFile(file)
      restoreDataBackup(backup, sectionIds)
      await refreshLocalStoresAfterDataChange()
      notificationService.success('数据已还原', {
        duration: 2600,
        position: 'bottom-center',
      })
    } catch (error) {
      console.error('还原数据备份失败:', error)
      notificationService.error(`还原失败: ${error.message || '未知错误'}`, {
        duration: 3600,
        position: 'bottom-center',
      })
    } finally {
      isDataImporting.value = false
      event.target.value = ''
    }
  }

  async function clearSelectedData(useAll = false) {
    const sectionIds = getSelectedDataSectionIds(useAll)
    if (!sectionIds.length) {
      notificationService.warning('请先选择要清空的数据范围', {
        duration: 2200,
        position: 'bottom-center',
      })
      return
    }

    const message = useAll
      ? '确定要清空全部可管理数据吗？建议先备份全部信息。'
      : '确定要清空选中的本地数据吗？建议先备份。'
    if (!confirm(message)) return

    try {
      clearDataSections(sectionIds)
      await refreshLocalStoresAfterDataChange()
      notificationService.success(useAll ? '全部数据已清空' : '选中数据已清空', {
        duration: 2600,
        position: 'bottom-center',
      })
    } catch (error) {
      console.error('清空数据失败:', error)
      notificationService.error(`清空失败: ${error.message || '未知错误'}`, {
        duration: 3200,
        position: 'bottom-center',
      })
    }
  }

  function setActiveTab(tab) {
    if (!isSettingsSectionEnabled(tab)) {
      ensureActiveSettingsTab()
      return
    }
    activeTab.value = tab

    const urlParams = new URLSearchParams(window.location.search)
    urlParams.set('tab', tab)
    window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`)
  }

  function normalizeDefaults() {
    const booleanDefaultKeys = {
      search_toolbar_compact: true,
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

    Object.entries(booleanDefaultKeys).forEach(([key, value]) => {
      if (formData[key] === undefined) formData[key] = value
    })

    if (
      !['100', '010', '001', '110', '011', '101', '111'].includes(formData.search_default_purity)
    ) {
      formData.search_default_purity = '100'
    }
    if (!/^[01]{3}$/.test(String(formData.search_default_categories || ''))) {
      formData.search_default_categories = '111'
    }
    if (!['1d', '3d', '1w', '1M', '3M', '6M', '1y'].includes(formData.search_default_top_range)) {
      formData.search_default_top_range = '1M'
    }
    if (!searchColorOptions.some((option) => option.value === formData.default_color)) {
      formData.default_color = ''
    }
    formData.search_default_grid_columns = [2, 3, 4, 6, 8].includes(
      Number(formData.search_default_grid_columns),
    )
      ? Number(formData.search_default_grid_columns)
      : 4

    if (formData.enable_animations === undefined) formData.enable_animations = true
    if (formData.sidebar_animation_effect === undefined) formData.sidebar_animation_effect = true
    if (formData.enable_blur_effects === undefined) formData.enable_blur_effects = true
    if (formData.sidebar_compact === undefined) formData.sidebar_compact = false
    if (formData.auto_play_videos === undefined) formData.auto_play_videos = true
    formData.ai_usage_total_requests = Math.max(0, Number(formData.ai_usage_total_requests) || 0)
    formData.ai_usage_estimated_cost_usd = Math.max(
      0,
      Number(formData.ai_usage_estimated_cost_usd) || 0,
    )
    if (formData.ai_require_cost_confirm === undefined) formData.ai_require_cost_confirm = true
    formData.ai_daily_budget_usd = Math.max(0, Number(formData.ai_daily_budget_usd) || 0)
    formData.ai_monthly_budget_usd = Math.max(0, Number(formData.ai_monthly_budget_usd) || 0)
    formData.ai_gptsapi_daily_budget_usd = Math.max(
      0,
      Number(formData.ai_gptsapi_daily_budget_usd ?? formData.ai_daily_budget_usd) || 0,
    )
    formData.ai_gptsapi_monthly_budget_usd = Math.max(
      0,
      Number(formData.ai_gptsapi_monthly_budget_usd ?? formData.ai_monthly_budget_usd) || 0,
    )
    formData.ai_gptproto_daily_budget_usd = Math.max(
      0,
      Number(formData.ai_gptproto_daily_budget_usd ?? formData.ai_daily_budget_usd) || 0,
    )
    formData.ai_gptproto_monthly_budget_usd = Math.max(
      0,
      Number(formData.ai_gptproto_monthly_budget_usd ?? formData.ai_monthly_budget_usd) || 0,
    )
    formData.ai_subrouter_daily_budget_usd = Math.max(
      0,
      Number(formData.ai_subrouter_daily_budget_usd ?? formData.ai_daily_budget_usd) || 0,
    )
    formData.ai_subrouter_monthly_budget_usd = Math.max(
      0,
      Number(formData.ai_subrouter_monthly_budget_usd ?? formData.ai_monthly_budget_usd) || 0,
    )
    if (!['fast', 'balanced', 'quality'].includes(formData.ai_quality_mode)) {
      formData.ai_quality_mode = 'balanced'
    }
    if (formData.ai_enable_privacy_mode === undefined) formData.ai_enable_privacy_mode = true
    if (!['contain', 'cover'].includes(formData.fullscreen_preview_fit_mode)) {
      formData.fullscreen_preview_fit_mode = 'contain'
    }
    // 兼容旧配置：enable_high_quality_previews(bool) -> preview_image_quality(enum)
    if (formData.preview_image_quality === undefined || formData.preview_image_quality === null) {
      formData.preview_image_quality =
        settingsStore.settings.enable_high_quality_previews === false ? 'medium' : 'high'
    }
    if (!['tiny', 'medium', 'high', 'original'].includes(formData.preview_image_quality)) {
      formData.preview_image_quality = 'high'
    }
    if (formData.show_hover_preview === undefined) formData.show_hover_preview = true
    if (formData.show_card_action_toolbar === undefined) formData.show_card_action_toolbar = true
    if (formData.show_card_hide_button === undefined) formData.show_card_hide_button = true
    if (formData.search_waterfall_layout === undefined) formData.search_waterfall_layout = false
    if (formData.search_waterfall_layout === true) formData.show_hover_preview = false
    delete formData.search_waterfall_quality
    formData.search_waterfall_initial_render_count = Math.min(
      120,
      Math.max(6, Number(formData.search_waterfall_initial_render_count) || 18),
    )
    formData.search_waterfall_preload_px = Math.min(
      3000,
      Math.max(200, Number(formData.search_waterfall_preload_px) || 900),
    )
    if (formData.enable_lazy_loading === undefined) formData.enable_lazy_loading = true
    if (formData.performance_low_data_mode === undefined) formData.performance_low_data_mode = false
    if (
      !['tiny', 'medium', 'high', 'original'].includes(formData.performance_preview_quality_cap)
    ) {
      formData.performance_preview_quality_cap = 'high'
    }
    if (formData.cache_images === undefined) formData.cache_images = true
    if (formData.max_cache_size === undefined) formData.max_cache_size = 200
    if (formData.fullscreen_preview_blob_cache_enabled === undefined) {
      formData.fullscreen_preview_blob_cache_enabled = formData.cache_images !== false
    }
    formData.fullscreen_preview_blob_cache_max_items = Math.min(
      100,
      Math.max(1, Number(formData.fullscreen_preview_blob_cache_max_items) || 10),
    )
    formData.fullscreen_preview_blob_cache_max_mb = Math.min(
      4096,
      Math.max(1, Number(formData.fullscreen_preview_blob_cache_max_mb) || 80),
    )
    if (formData.clear_cache_on_exit === undefined) formData.clear_cache_on_exit = false
    if (formData.search_ui_restore_delay_ms === undefined) {
      const legacySec = Number(settingsStore.settings.search_ui_restore_delay_sec)
      formData.search_ui_restore_delay_ms = Number.isFinite(legacySec)
        ? Math.round(legacySec * 1000)
        : 3000
    }
    formData.search_dock_restore_delay_ms = Math.min(
      10000,
      Math.max(300, Number(formData.search_dock_restore_delay_ms) || 600),
    )
    if (!['off', 'medium', 'epic'].includes(formData.image_reveal_strength)) {
      formData.image_reveal_strength = 'medium'
    }
    if (!['mosaic', 'soft', 'blur'].includes(formData.image_reveal_style)) {
      formData.image_reveal_style = 'mosaic'
    }
  }

  onMounted(async () => {
    isLoading.value = true

    try {
      // 首屏只等设置与登录态，尽快露出壳层
      await Promise.allSettled([authStore.initAuth(), settingsStore.initSettings()])

      Object.assign(formData, settingsStore.settings)
      enforceGuestNsfwLock()
      formData.theme = 'default'
      normalizeDefaults()

      const urlParams = new URLSearchParams(window.location.search)
      const tab = urlParams.get('tab')
      if (tab && visibleSections.value.some((section) => section.id === tab)) {
        activeTab.value = tab
      }
      ensureActiveSettingsTab()
    } catch (error) {
      console.error('初始化设置页面失败:', error)
      notificationService.error('设置页加载失败，请刷新后重试', {
        duration: 3600,
        position: 'top-right',
      })
    } finally {
      isLoading.value = false
    }

    // 次要数据后台补齐，不阻塞首屏
    void Promise.allSettled([
      runtimeConfigStore.loadRuntimeConfig(),
      favoritesStore.initFavorites(),
      userStore.initUserData(),
      historyStore.initHistory(),
    ])
    void refreshCloudSummary()
    void refreshSecretStatus()
    void refreshResourceSummary()

    document.addEventListener('click', closeSettingsDropdowns)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', closeSettingsDropdowns)
  })

  return {
    activeSettingsDropdown,
    activeTab,
    aiModelLeaderboard,
    aiUsageSummary,
    allSearchDockToolsVisible,
    allSearchToolbarToolsVisible,
    authStore,
    canUseAiImageToModel,
    canUseAiOptimize,
    canUseNsfw,
    canUseSync,
    clearCache,
    clearCloudData,
    clearSelectedData,
    clearWallhavenApiKey,
    cloudConflictStrategies,
    cloudConflictStrategy,
    cloudDataStats,
    cloudSummary,
    cloudSyncEnabled,
    cloudSyncIssues,
    cloudSyncableTotals,
    syncParityHint,
    copyWallhavenApiKey,
    dataPerformanceTools,
    dataSectionStats,
    defaultFilterSelects,
    downloadToggleTools,
    exportSelectedDataBackup,
    formData,
    getSettingsColorOption,
    getSettingsSelectLabel,
    hideSettingsTooltip,
    importSelectedDataBackup,
    isCloudSummaryLoading,
    isCloudSyncing,
    isDataExporting,
    isDataImporting,
    isLoading,
    isResourceSummaryLoading,
    isSaving,
    isSecretSaving,
    isVisualToolDisabled,
    performanceQualityCapSelect,
    refreshCloudSummary,
    refreshResourceSummary,
    resetAiUsage,
    resetSettings,
    runtimeAiProviderOptions,
    runtimeModelCatalog,
    saveSettings,
    saveWallhavenApiKey,
    searchColorOptions,
    searchDockTools,
    searchToolbarTools,
    selectedDataSectionIds,
    selectedSearchColorOption,
    setActiveTab,
    setAllSearchDockVisible,
    setAllSearchToolbarVisible,
    setCloudConflictStrategy,
    setDefaultSearchColor,
    setSettingsColorValue,
    setSettingsSelectValue,
    settingsTooltip,
    showSettingsTooltip,
    showWallhavenApiKey,
    storageUsage,
    toggleAllDataSections,
    toggleCloudSync,
    uploadCloudNow,
    toggleDataSection,
    toggleSettingsDropdown,
    totalFavorites,
    totalHistory,
    visualSelects,
    visualToggleTools,
    visualToolTitle,
    visibleSections,
    wallhavenSecretConfigured,
    wallhavenSecretUpdatedAt,
  }
}
