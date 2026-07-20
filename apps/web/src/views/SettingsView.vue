<script setup>
import SettingsDataPanel from '@/components/settings/SettingsDataPanel.vue'
import SettingsDownloadPanel from '@/components/settings/SettingsDownloadPanel.vue'
import SettingsPerformancePanel from '@/components/settings/SettingsPerformancePanel.vue'
import SettingsSaveDock from '@/components/settings/SettingsSaveDock.vue'
import { useSettingsPageMotion } from '@/features/settings/composables/useSettingsPageMotion'
import { useAppearanceStore } from '@/stores/appearance'
import { useSettingsViewState } from './settings/useSettingsViewState'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@/styles/settings-console.css'

const {
  activeSettingsDropdown,
  activeTab,
  allSearchDockToolsVisible,
  allSearchToolbarToolsVisible,
  authStore,
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
  isSaving,
  isSecretSaving,
  isVisualToolDisabled,
  performanceQualityCapSelect,
  refreshCloudSummary,
  resetSettings,
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
  toggleDataSection,
  toggleSettingsDropdown,
  uploadCloudNow,
  totalFavorites,
  totalHistory,
  visualSelects,
  visualToggleTools,
  visualToolTitle,
  visibleSections,
  wallhavenSecretConfigured,
  wallhavenSecretUpdatedAt,
} = useSettingsViewState()

const appearanceStore = useAppearanceStore()
const pageRoot = ref(null)
const bodyRef = ref(null)
const pageReady = ref(false)

useSettingsPageMotion({
  pageRef: pageRoot,
  bodyRef,
  ready: pageReady,
  tabKey: activeTab,
})

watch(
  () => isLoading.value,
  async (loading) => {
    if (loading) {
      pageReady.value = false
      return
    }
    await nextTick()
    pageReady.value = true
  },
  { immediate: true },
)

onMounted(() => {
  document.documentElement.classList.add('settings-gallery-page')
  appearanceStore.applyToDocument()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('settings-gallery-page')
})

const activeSectionMeta = computed(
  () =>
    visibleSections.value.find((section) => section.id === activeTab.value) ||
    visibleSections.value[0] || {
      id: 'general',
      label: '设置',
      title: '设置',
      description: '管理浏览、下载、AI 与数据偏好。',
      icon: 'bi-gear',
    },
)

const settingsPulse = computed(() => {
  if (activeTab.value === 'data') {
    return { value: storageUsage.value.total, label: '本地 KB' }
  }
  if (activeTab.value === 'browsing') {
    return { value: String(formData.items_per_page || 24), label: '每页条数' }
  }
  return { value: String(totalFavorites.value), label: '收藏' }
})
</script>

<template>
  <div
    ref="pageRoot"
    class="settings-console settings-page"
    :class="{ 'is-scheme-dark': appearanceStore.isDark, 'is-ready': pageReady }"
    @pointerover="showSettingsTooltip"
    @pointerout="hideSettingsTooltip"
    @focusin="showSettingsTooltip"
    @focusout="hideSettingsTooltip"
  >
    <div class="settings-console__ambient settings-console__ambient--a" aria-hidden="true"></div>
    <div class="settings-console__ambient settings-console__ambient--b" aria-hidden="true"></div>

    <div
      v-if="isLoading"
      class="settings-console__shell settings-console__shell--skeleton"
      aria-busy="true"
      aria-label="正在读取设置"
    >
      <aside class="settings-console__aside" data-settings-motion>
        <div class="settings-console__aside-head">
          <span class="settings-console__aside-kicker">控制台</span>
          <strong>设置</strong>
        </div>
        <div class="settings-console__nav" aria-hidden="true">
          <span v-for="n in 6" :key="`nav-skel-${n}`" class="settings-console__skel settings-console__skel--nav"></span>
        </div>
        <div class="settings-console__aside-metrics">
          <span class="settings-console__skel settings-console__skel--line is-short"></span>
          <div class="settings-console__metric-grid">
            <span class="settings-console__skel settings-console__skel--nav"></span>
            <span class="settings-console__skel settings-console__skel--nav"></span>
            <span class="settings-console__skel settings-console__skel--nav"></span>
          </div>
        </div>
      </aside>
      <main class="settings-console__main" data-settings-motion>
        <header class="settings-console__topbar">
          <div class="settings-console__title-block" style="flex: 1; min-width: 0">
            <span class="settings-console__skel settings-console__skel--title"></span>
            <span class="settings-console__skel settings-console__skel--line"></span>
            <span class="settings-console__skel settings-console__skel--line is-short"></span>
          </div>
          <span class="settings-console__skel settings-console__skel--pulse"></span>
        </header>
        <div class="settings-console__tabs" aria-hidden="true">
          <span
            v-for="n in 5"
            :key="`tab-skel-${n}`"
            class="settings-console__skel"
            style="width: 72px; height: 36px; flex-shrink: 0"
          ></span>
        </div>
        <div class="settings-console__body">
          <span class="settings-console__skel settings-console__skel--block"></span>
          <span class="settings-console__skel settings-console__skel--block"></span>
          <span class="settings-console__skel settings-console__skel--block" style="height: 88px"></span>
        </div>
      </main>
    </div>

    <div v-else class="settings-console__shell">
      <aside class="settings-console__aside" data-settings-motion>
        <div class="settings-console__aside-head">
          <span class="settings-console__aside-kicker">控制台</span>
          <strong>设置</strong>
        </div>

        <nav class="settings-console__nav" aria-label="设置分区">
          <button
            v-for="section in visibleSections"
            :key="section.id"
            type="button"
            class="settings-console__nav-item"
            :class="{ 'is-active': activeTab === section.id }"
            @click="setActiveTab(section.id)"
          >
            <i class="bi" :class="section.icon"></i>
            <span>{{ section.label }}</span>
          </button>
        </nav>

        <div class="settings-console__aside-metrics">
          <div class="settings-console__aside-metrics-head">
            <span>本地数据</span>
            <strong>{{ storageUsage.total }} KB</strong>
          </div>
          <div class="settings-console__metric-grid">
            <div class="settings-console__metric">
              <strong>{{ totalFavorites }}</strong>
              <span>收藏</span>
            </div>
            <div class="settings-console__metric">
              <strong>{{ totalHistory }}</strong>
              <span>浏览</span>
            </div>
            <div class="settings-console__metric">
              <strong>{{ storageUsage.settings }}</strong>
              <span>设置</span>
            </div>
          </div>
        </div>
      </aside>

      <main class="settings-console__main">
        <header class="settings-console__topbar" data-settings-motion>
          <div class="settings-console__title-block">
            <div class="settings-console__title-kicker">
              <span></span>
              偏好配置
            </div>
            <h1>
              <i class="bi" :class="activeSectionMeta.icon"></i>
              {{ activeSectionMeta.title || activeSectionMeta.label }}
            </h1>
            <p class="settings-console__desc">{{ activeSectionMeta.description }}</p>
          </div>
          <div class="settings-console__pulse">
            <strong>{{ settingsPulse.value }}</strong>
            <small>{{ settingsPulse.label }}</small>
          </div>
        </header>

        <div class="settings-console__tabs" role="tablist" aria-label="设置标签" data-settings-motion>
          <button
            v-for="section in visibleSections"
            :key="`tab-${section.id}`"
            type="button"
            role="tab"
            class="settings-console__tab"
            :class="{ 'is-active': activeTab === section.id }"
            :aria-selected="activeTab === section.id"
            @click="setActiveTab(section.id)"
          >
            <i class="bi" :class="section.icon"></i>
            {{ section.label }}
          </button>
        </div>

        <form
          id="settings-main-form"
          ref="bodyRef"
          class="settings-console__body settings-main"
          @submit.prevent="saveSettings"
        >
        <section v-if="activeTab === 'general'" class="settings-panel settings-console__section">
          <div class="settings-console__stack">
            <div class="compact-settings-panel">
              <div class="compact-panel-head">
                <strong>内容过滤</strong>
                <span>控制 NSFW 内容的显示与 Wallhaven 搜索授权</span>
              </div>
              <div
                class="nsfw-inline-switch nsfw-inline-switch--left"
                :class="{ 'nsfw-inline-switch--disabled': !canUseNsfw }"
              >
                <div class="love nsfw-love-toggle">
                  <input
                    id="settings-nsfw-switch"
                    v-model="formData.show_nsfw"
                    type="checkbox"
                    :disabled="!canUseNsfw"
                  />
                  <label
                    class="love-heart"
                    for="settings-nsfw-switch"
                    :title="canUseNsfw ? '显示或隐藏 NSFW 内容' : '游客不能开启 NSFW'"
                  >
                    <i class="left"></i>
                    <i class="right"></i>
                    <i class="bottom"></i>
                    <div class="round"></div>
                  </label>
                </div>
                <span class="inline-field-hint">NSFW</span>
              </div>
            </div>

            <div class="compact-settings-panel">
              <div class="compact-panel-head">
                <strong>Wallhaven API Key</strong>
                <span>登录后可加密保存到云端，搜索时由 Worker 自动带上</span>
              </div>
              <div class="secret-input-row">
                <input
                  v-model="formData.wallhaven_api_key"
                  :type="showWallhavenApiKey ? 'text' : 'password'"
                  :placeholder="
                    formData.show_nsfw
                      ? authStore.isAuthenticated
                        ? '填入后会加密保存到后端'
                        : '游客不能使用 NSFW'
                      : authStore.isAuthenticated
                        ? '先开启显示 NSFW，再填写 API Key'
                        : '请先登录账号后再开启 NSFW'
                  "
                  autocomplete="off"
                  :disabled="!canUseNsfw || !formData.show_nsfw"
                  :title="canUseNsfw ? '登录后可加密保存到后端' : '游客不能使用 NSFW，请先登录账号'"
                />
                <button
                  type="button"
                  class="secret-action-button"
                  :title="showWallhavenApiKey ? '隐藏 API Key' : '查看 API Key'"
                  :aria-label="showWallhavenApiKey ? '隐藏 API Key' : '查看 API Key'"
                  :disabled="!formData.wallhaven_api_key"
                  @click="showWallhavenApiKey = !showWallhavenApiKey"
                >
                  <i class="bi" :class="showWallhavenApiKey ? 'bi-eye-slash' : 'bi-eye'"></i>
                </button>
                <button
                  type="button"
                  class="secret-action-button"
                  title="复制 API Key"
                  aria-label="复制 API Key"
                  :disabled="!formData.wallhaven_api_key"
                  @click="copyWallhavenApiKey"
                >
                  <i class="bi bi-clipboard"></i>
                </button>
              </div>
              <div class="secret-cloud-row">
                <span
                  class="secret-status-pill"
                  :class="{ 'secret-status-pill--on': wallhavenSecretConfigured }"
                >
                  <i
                    class="bi"
                    :class="wallhavenSecretConfigured ? 'bi-shield-lock-fill' : 'bi-shield'"
                  ></i>
                  {{ wallhavenSecretConfigured ? '已加密保存到后端' : '未保存到后端' }}
                </span>
                <button
                  type="button"
                  class="secret-inline-button"
                  :disabled="
                    !authStore.isAuthenticated ||
                    isSecretSaving ||
                    !formData.wallhaven_api_key ||
                    formData.wallhaven_api_key === '********'
                  "
                  @click="saveWallhavenApiKey()"
                >
                  {{ isSecretSaving ? '保存中' : '保存到后端' }}
                </button>
                <button
                  type="button"
                  class="secret-inline-button danger"
                  :disabled="
                    !authStore.isAuthenticated || isSecretSaving || !wallhavenSecretConfigured
                  "
                  @click="clearWallhavenApiKey"
                >
                  删除后端 Key
                </button>
              </div>
              <small v-if="authStore.isAuthenticated">
                {{
                  wallhavenSecretConfigured
                    ? `后端已保存，搜索时由 Worker 自动带上。${wallhavenSecretUpdatedAt ? '更新时间：' + new Date(wallhavenSecretUpdatedAt).toLocaleString() : ''}`
                    : '登录账号后可把 Key 加密存到 D1，本机不再长期保存明文。'
                }}
              </small>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'visuals'" class="settings-panel settings-console__section">
          <div class="settings-console__stack">
          <div class="compact-settings-panel">
            <div class="compact-panel-head">
              <strong>预览显示</strong>
              <span>控制图片清晰度、全屏打开方式和加载揭幕</span>
            </div>
            <div class="compact-control-grid visual-control-grid">
              <label v-for="select in visualSelects" :key="select.key" class="compact-field">
                <span>{{ select.label }}</span>
                <div class="settings-filter-dropdown">
                  <button
                    type="button"
                    class="settings-filter-trigger"
                    :aria-expanded="activeSettingsDropdown === select.key"
                    :title="`${select.label}：${getSettingsSelectLabel(select)}，点击切换`"
                    @click="toggleSettingsDropdown(select.key)"
                  >
                    <span>{{ getSettingsSelectLabel(select) }}</span>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </button>
                  <div
                    class="settings-filter-menu"
                    :class="{ show: activeSettingsDropdown === select.key }"
                    role="menu"
                  >
                    <button
                      v-for="option in select.options"
                      :key="`${select.key}-${option.value}`"
                      type="button"
                      class="settings-filter-menu-item"
                      :class="{ active: formData[select.model] === option.value }"
                      role="menuitem"
                      :title="`设为 ${option.label}`"
                      @click="setSettingsSelectValue(select.model, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div class="compact-settings-panel">
            <div class="compact-panel-head">
              <strong>交互效果</strong>
              <span>开关动效、悬停预览和卡片快捷操作</span>
            </div>
            <div class="tool-chip-grid">
              <label
                v-for="tool in visualToggleTools"
                :key="tool.key"
                class="tool-chip"
                :class="{ disabled: isVisualToolDisabled(tool) }"
              >
                <input
                  v-model="formData[tool.key]"
                  type="checkbox"
                  :disabled="isVisualToolDisabled(tool)"
                />
                <span :title="visualToolTitle(tool)">
                  <i class="bi" :class="tool.icon"></i> {{ tool.label }}
                </span>
              </label>
            </div>
          </div>
          </div>
        </section>

        <SettingsDownloadPanel
          v-else-if="activeTab === 'download'"
          :form-data="formData"
          :toggle-tools="downloadToggleTools"
        />

        <section v-else-if="activeTab === 'browsing'" class="settings-panel settings-console__section">
          <div class="settings-console__stack">
          <div class="compact-settings-panel">
            <div class="compact-panel-head">
              <strong>默认筛选</strong>
              <span>进入浏览页和点“重置”时使用这些值</span>
            </div>
            <div class="compact-control-grid">
              <label
                v-for="select in defaultFilterSelects.slice(0, 4)"
                :key="select.key"
                class="compact-field"
              >
                <span>{{ select.label }}</span>
                <div class="settings-filter-dropdown">
                  <button
                    type="button"
                    class="settings-filter-trigger"
                    :aria-expanded="activeSettingsDropdown === select.key"
                    :title="`${select.label}：${getSettingsSelectLabel(select)}，点击切换`"
                    @click="toggleSettingsDropdown(select.key)"
                  >
                    <span>{{ getSettingsSelectLabel(select) }}</span>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </button>
                  <div
                    class="settings-filter-menu"
                    :class="{ show: activeSettingsDropdown === select.key }"
                    role="menu"
                  >
                    <button
                      v-for="option in select.options"
                      :key="`${select.key}-${option.value}`"
                      type="button"
                      class="settings-filter-menu-item"
                      :class="{ active: formData[select.model] === option.value }"
                      role="menuitem"
                      :title="`设为 ${option.label}`"
                      @click="setSettingsSelectValue(select.model, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </label>

              <label class="compact-field">
                <span>颜色</span>
                <div class="settings-filter-dropdown settings-color-dropdown">
                  <button
                    type="button"
                    class="settings-filter-trigger settings-color-trigger"
                    :aria-expanded="activeSettingsDropdown === 'color'"
                    :title="`颜色：${selectedSearchColorOption.label}，点击切换`"
                    @click="toggleSettingsDropdown('color')"
                  >
                    <span
                      class="settings-color-swatch"
                      :class="{ empty: !selectedSearchColorOption.value }"
                      :style="
                        selectedSearchColorOption.value
                          ? { backgroundColor: `#${selectedSearchColorOption.value}` }
                          : {}
                      "
                    ></span>
                    <span>{{ selectedSearchColorOption.label }}</span>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </button>
                  <div
                    class="settings-filter-menu settings-color-menu"
                    :class="{ show: activeSettingsDropdown === 'color' }"
                    role="menu"
                  >
                    <button
                      type="button"
                      class="settings-filter-menu-item settings-color-any"
                      :class="{ active: !formData.default_color }"
                      role="menuitem"
                      title="设为任意颜色"
                      @click="setDefaultSearchColor('')"
                    >
                      任意颜色
                    </button>
                    <div class="settings-color-grid">
                      <button
                        v-for="option in searchColorOptions.filter((item) => item.value)"
                        :key="option.value"
                        type="button"
                        class="settings-color-item"
                        :class="{ active: formData.default_color === option.value }"
                        :style="{ backgroundColor: `#${option.value}` }"
                        :title="option.label"
                        role="menuitem"
                        @click="setDefaultSearchColor(option.value)"
                      >
                        <span class="visually-hidden">{{ option.label }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </label>

              <label
                v-for="select in defaultFilterSelects.slice(4)"
                :key="select.key"
                class="compact-field"
              >
                <span>{{ select.label }}</span>
                <div class="settings-filter-dropdown">
                  <button
                    type="button"
                    class="settings-filter-trigger"
                    :aria-expanded="activeSettingsDropdown === select.key"
                    :title="`${select.label}：${getSettingsSelectLabel(select)}，点击切换`"
                    @click="toggleSettingsDropdown(select.key)"
                  >
                    <span>{{ getSettingsSelectLabel(select) }}</span>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </button>
                  <div
                    class="settings-filter-menu"
                    :class="{ show: activeSettingsDropdown === select.key }"
                    role="menu"
                  >
                    <button
                      v-for="option in select.options"
                      :key="`${select.key}-${option.value}`"
                      type="button"
                      class="settings-filter-menu-item"
                      :class="{ active: formData[select.model] === option.value }"
                      role="menuitem"
                      :title="`设为 ${option.label}`"
                      @click="setSettingsSelectValue(select.model, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div class="compact-settings-panel">
            <div class="compact-panel-head">
              <strong>顶部工具栏</strong>
              <button
                type="button"
                class="toolbar-visibility-button"
                :title="
                  allSearchToolbarToolsVisible
                    ? '一键关闭顶部工具栏全部开关'
                    : '一键开启顶部工具栏全部开关'
                "
                @click="setAllSearchToolbarVisible(!allSearchToolbarToolsVisible)"
              >
                <i
                  class="bi"
                  :class="allSearchToolbarToolsVisible ? 'bi-eye-slash' : 'bi-eye'"
                  aria-hidden="true"
                ></i>
                <span>{{ allSearchToolbarToolsVisible ? '全部关闭' : '全部开启' }}</span>
              </button>
            </div>
            <div class="tool-chip-grid">
              <label class="tool-chip">
                <input v-model="formData.search_toolbar_compact" type="checkbox" />
                <span title="搜索页顶部工具栏采用更紧凑的显示方式">
                  <i class="bi bi-arrows-collapse"></i> 紧凑工具条
                </span>
              </label>
              <label v-for="tool in searchToolbarTools" :key="tool.key" class="tool-chip">
                <input v-model="formData[tool.key]" type="checkbox" />
                <span :title="tool.tooltip">
                  <i class="bi" :class="tool.icon"></i> {{ tool.label }}
                </span>
              </label>
            </div>
          </div>

          <div class="compact-settings-panel">
            <div class="compact-panel-head">
              <strong>底部悬浮栏</strong>
              <button
                type="button"
                class="toolbar-visibility-button"
                :title="
                  allSearchDockToolsVisible
                    ? '一键关闭底部悬浮栏全部开关'
                    : '一键开启底部悬浮栏全部开关'
                "
                @click="setAllSearchDockVisible(!allSearchDockToolsVisible)"
              >
                <i
                  class="bi"
                  :class="allSearchDockToolsVisible ? 'bi-eye-slash' : 'bi-eye'"
                  aria-hidden="true"
                ></i>
                <span>{{ allSearchDockToolsVisible ? '全部关闭' : '全部开启' }}</span>
              </button>
            </div>
            <div class="tool-chip-grid">
              <label v-for="tool in searchDockTools" :key="tool.key" class="tool-chip">
                <input v-model="formData[tool.key]" type="checkbox" />
                <span :title="tool.tooltip">
                  <i class="bi" :class="tool.icon"></i> {{ tool.label }}
                </span>
              </label>
            </div>
          </div>

          <div class="compact-settings-panel">
            <div class="compact-panel-head">
              <strong>滚动与布局</strong>
              <span>控制加载方式和瀑布流性能</span>
            </div>
            <div class="tool-chip-grid">
              <label class="tool-chip">
                <input v-model="formData.infinite_scroll" type="checkbox" />
                <span title="滚动到底部时自动加载下一页">
                  <i class="bi bi-arrow-down-circle"></i> 无限滚动
                </span>
              </label>
              <label class="tool-chip">
                <input v-model="formData.sidebar_compact" type="checkbox" />
                <span title="让页面整体间距更收敛">
                  <i class="bi bi-layout-sidebar-inset"></i> 页面紧凑
                </span>
              </label>
              <label class="tool-chip">
                <input v-model="formData.search_waterfall_layout" type="checkbox" />
                <span title="按图片高低错位排列结果">
                  <i class="bi bi-columns-gap"></i> 瀑布流
                </span>
              </label>
            </div>

            <div class="metric-input-grid">
              <label class="metric-input-card">
                <span>每页</span>
                <div class="metric-number-shell is-readonly">
                  <input
                    v-model.number="formData.items_per_page"
                    type="number"
                    min="24"
                    max="24"
                    readonly
                    title="当前固定为 24"
                  />
                  <i class="bi bi-lock" aria-hidden="true"></i>
                </div>
              </label>

              <label class="metric-input-card">
                <span>首屏渲染</span>
                <div class="metric-number-shell">
                  <input
                    v-model.number="formData.search_waterfall_initial_render_count"
                    type="number"
                    min="6"
                    max="120"
                    step="1"
                    title="首屏渲染数量"
                  />
                </div>
              </label>

              <label class="metric-input-card">
                <span>预加载 px</span>
                <div class="metric-number-shell">
                  <input
                    v-model.number="formData.search_waterfall_preload_px"
                    type="number"
                    min="200"
                    max="3000"
                    step="50"
                    title="滚动到距离底部多少像素时预加载"
                  />
                </div>
              </label>

              <label class="metric-input-card">
                <span>顶栏恢复 ms</span>
                <div class="metric-number-shell">
                  <input
                    v-model.number="formData.search_ui_restore_delay_ms"
                    type="number"
                    min="300"
                    max="10000"
                    step="100"
                    title="顶部工具栏停止滚动后恢复显示的延迟"
                  />
                </div>
              </label>

              <label class="metric-input-card">
                <span>底栏恢复 ms</span>
                <div class="metric-number-shell">
                  <input
                    v-model.number="formData.search_dock_restore_delay_ms"
                    type="number"
                    min="300"
                    max="10000"
                    step="100"
                    title="底部悬浮栏停止滚动后恢复显示的延迟"
                  />
                </div>
              </label>
            </div>
          </div>

          <div class="field-grid three-up browsing-legacy-fields" hidden>
            <label class="field-card">
              <span class="field-title">默认分辨率</span>
              <select v-model="formData.default_resolution">
                <option value="">任意分辨率</option>
                <option value="1920x1080">1920x1080 (FHD)</option>
                <option value="2560x1440">2560x1440 (QHD)</option>
                <option value="3840x2160">3840x2160 (4K UHD)</option>
                <option value="7680x4320">7680x4320 (8K UHD)</option>
              </select>
            </label>

            <label class="field-card">
              <span class="field-title">默认比例</span>
              <select v-model="formData.default_ratio">
                <option value="">任意比例</option>
                <option value="16x9">16:9</option>
                <option value="16x10">16:10</option>
                <option value="21x9">21:9</option>
                <option value="32x9">32:9</option>
                <option value="9x16">9:16（经典手机）</option>
                <option value="19x9">19:9（手机）</option>
                <option value="19x10">19:10（19.5:9 手机）</option>
                <option value="20x9">20:9（全面屏手机）</option>
                <option value="1x1">1:1</option>
              </select>
            </label>

            <label class="field-card">
              <span class="field-title">默认颜色</span>
              <select v-model="formData.default_color">
                <option
                  v-for="option in searchColorOptions"
                  :key="option.value || 'any'"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>

            <label class="field-card">
              <span class="field-title">默认排序</span>
              <select v-model="formData.default_sorting">
                <option value="relevance">相关性</option>
                <option value="date_added">最新</option>
                <option value="views">浏览量</option>
                <option value="favorites">收藏数</option>
                <option value="toplist">热门</option>
                <option value="random">随机</option>
              </select>
            </label>

            <label class="field-card">
              <span class="field-title">默认顺序</span>
              <select v-model="formData.default_order">
                <option value="desc">降序</option>
                <option value="asc">升序</option>
              </select>
            </label>
          </div>

          <div class="toggle-list browsing-legacy-fields" hidden>
            <label class="toggle-card">
              <input v-model="formData.infinite_scroll" type="checkbox" />
              <div>
                <strong>启用无限滚动</strong>
                <p>浏览到列表底部时自动加载下一页内容，也可用底部栏手动加载更多。</p>
              </div>
            </label>

            <label class="toggle-card">
              <input v-model="formData.sidebar_compact" type="checkbox" />
              <div>
                <strong>紧凑模式</strong>
                <p>导航栏和浏览相关界面采用更收敛的间距，适合小屏或高密度浏览。</p>
              </div>
            </label>

            <label class="toggle-card">
              <input v-model="formData.search_waterfall_layout" type="checkbox" />
              <div>
                <strong>搜索结果瀑布流布局</strong>
                <p>按图片自身比例错位排列，减少空白区域；关闭时使用等高网格。</p>
              </div>
            </label>

            <label class="field-card">
              <span class="field-title">瀑布流首屏预渲染数量</span>
              <input
                v-model.number="formData.search_waterfall_initial_render_count"
                type="number"
                min="6"
                max="120"
                step="1"
                title="首屏渲染数量"
              />
              <small>建议 12~24；越大首屏完整度越高，越小滚动性能越好。</small>
            </label>

            <label class="field-card">
              <span class="field-title">瀑布流预加载距离（px）</span>
              <input
                v-model.number="formData.search_waterfall_preload_px"
                type="number"
                min="200"
                max="3000"
                step="50"
                title="滚动到距离底部多少像素时预加载"
              />
              <small>建议 700~1200；越大越早渲染视口外卡片。</small>
            </label>

            <label class="field-card">
              <span class="field-title">顶栏恢复延迟（毫秒）</span>
              <input
                v-model.number="formData.search_ui_restore_delay_ms"
                type="number"
                min="300"
                max="10000"
                step="100"
                title="顶部工具栏停止滚动后恢复显示的延迟"
              />
              <small>滚动时收起顶部导航与筛选栏，停止滚动后按该毫秒值恢复显示。</small>
            </label>
          </div>
          </div>
        </section>

        <SettingsDataPanel
          v-else-if="activeTab === 'data'"
          :cloud-sync-enabled="cloudSyncEnabled"
          :cloud-conflict-strategy="cloudConflictStrategy"
          :cloud-conflict-strategies="cloudConflictStrategies"
          :cloud-summary="cloudSummary"
          :cloud-sync-issues="cloudSyncIssues"
          :sync-parity-hint="syncParityHint"
          :cloud-syncable-totals="cloudSyncableTotals"
          :cloud-data-stats="cloudDataStats"
          :is-cloud-syncing="isCloudSyncing"
          :is-cloud-summary-loading="isCloudSummaryLoading"
          :is-authenticated="authStore.isAuthenticated"
          :can-use-sync="canUseSync"
          :total-favorites="totalFavorites"
          :total-history="totalHistory"
          :storage-usage="storageUsage"
          :data-sections="dataSectionStats"
          :selected-section-ids="selectedDataSectionIds"
          :is-exporting="isDataExporting"
          :is-importing="isDataImporting"
          @toggle-section="toggleDataSection"
          @select-all="toggleAllDataSections"
          @export="exportSelectedDataBackup"
          @import="importSelectedDataBackup"
          @clear="clearSelectedData"
          @toggle-cloud-sync="toggleCloudSync"
          @set-cloud-conflict-strategy="setCloudConflictStrategy"
          @refresh-cloud="refreshCloudSummary"
          @clear-cloud="clearCloudData"
          @upload-cloud="uploadCloudNow"
        />

        <SettingsPerformancePanel
          v-else
          :form-data="formData"
          :storage-usage="storageUsage"
          :performance-tools="dataPerformanceTools"
          :active-dropdown="activeSettingsDropdown"
          :quality-cap-select="performanceQualityCapSelect"
          :get-settings-select-label="getSettingsSelectLabel"
          @toggle-dropdown="toggleSettingsDropdown"
          @set-select="setSettingsSelectValue"
          @clear-cache="clearCache"
        />
        </form>
      </main>
    </div>

    <SettingsSaveDock v-if="!isLoading" :is-saving="isSaving" @reset="resetSettings" />

    <Teleport to="body">
      <div
        v-if="settingsTooltip.visible"
        class="settings-hover-tooltip"
        :class="`is-${settingsTooltip.placement}`"
        :style="settingsTooltip.style"
        role="tooltip"
      >
        {{ settingsTooltip.text }}
      </div>
    </Teleport>
  </div>
</template>
<style src="../styles/settings-view-01.css"></style>
<style src="../styles/settings-view-02.css"></style>
<style src="../styles/settings-view-03.css"></style>
