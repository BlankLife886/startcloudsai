<script setup>
import { computed } from 'vue'
import { ref } from 'vue'

const importInput = ref(null)
const importFileName = ref('')

const props = defineProps({
  totalFavorites: {
    type: Number,
    default: 0,
  },
  totalHistory: {
    type: Number,
    default: 0,
  },
  storageUsage: {
    type: Object,
    required: true,
  },
  dataSections: {
    type: Array,
    default: () => [],
  },
  selectedSectionIds: {
    type: Array,
    default: () => [],
  },
  isExporting: {
    type: Boolean,
    default: false,
  },
  isImporting: {
    type: Boolean,
    default: false,
  },
  cloudSyncEnabled: {
    type: Boolean,
    default: false,
  },
  cloudSyncIssues: {
    type: Array,
    default: () => [],
  },
  syncParityHint: {
    type: Object,
    default: () => ({}),
  },
  cloudSyncableTotals: {
    type: Object,
    default: () => ({ syncableKb: 0, localOnlyKb: 0, totalKb: 0 }),
  },
  cloudSummary: {
    type: Object,
    default: () => ({ totalKb: 0, summary: {} }),
  },
  cloudDataStats: {
    type: Array,
    default: () => [],
  },
  cloudConflictStrategy: {
    type: String,
    default: 'merge',
  },
  cloudConflictStrategies: {
    type: Array,
    default: () => [],
  },
  isCloudSyncing: {
    type: Boolean,
    default: false,
  },
  isCloudSummaryLoading: {
    type: Boolean,
    default: false,
  },
  isAuthenticated: {
    type: Boolean,
    default: false,
  },
  canUseSync: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits([
  'toggle-section',
  'select-all',
  'export',
  'import',
  'clear',
  'toggle-cloud-sync',
  'set-cloud-conflict-strategy',
  'refresh-cloud',
  'clear-cloud',
  'upload-cloud',
])

const selectedStats = computed(() => {
  const selected = props.dataSections.filter((section) =>
    props.selectedSectionIds.includes(section.id),
  )
  return {
    count: selected.length,
    sizeKb: Number(
      selected.reduce((sum, section) => sum + Number(section.sizeKb || 0), 0).toFixed(2),
    ),
    keys: selected.reduce((sum, section) => sum + Number(section.filled || 0), 0),
  }
})

function triggerImport() {
  importInput.value?.click()
}

function handleImport(event) {
  const file = event?.target?.files?.[0]
  importFileName.value = file?.name || ''
  emit('import', event)
}

function onImportBoxKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  triggerImport()
}
</script>

<template>
  <section class="settings-panel settings-console__section">
    <div class="settings-console__stack">
    <div class="compact-settings-panel data-center-panel">
      <div class="cloud-sync-panel">
        <div class="cloud-sync-main">
          <div>
            <strong>云同步</strong>
            <span>
              {{
                isAuthenticated
                  ? cloudSyncEnabled
                    ? '已开启，用户资源数据会同步到当前账号'
                    : '关闭中，本机数据不会上传；再次开启会合并云端与本机数据'
                  : canUseSync
                    ? '登录账号后可开启云同步'
                    : '云同步暂未开放'
              }}
            </span>
          </div>
          <button
            type="button"
            class="cloud-switch"
            :class="{ active: cloudSyncEnabled }"
            :disabled="isCloudSyncing || !isAuthenticated || !canUseSync"
            @click="$emit('toggle-cloud-sync')"
          >
            <i class="bi" :class="cloudSyncEnabled ? 'bi-cloud-check' : 'bi-cloud'"></i>
            <span>{{
              isCloudSyncing ? '处理中...' : cloudSyncEnabled ? '关闭云同步' : '开启云同步'
            }}</span>
          </button>
        </div>

        <div class="cloud-stat-row">
          <span>云端 {{ Number(cloudSummary.totalKb || 0).toFixed(2) }} KB</span>
          <span>可同步 {{ Number(syncParityHint.syncableKb || cloudSyncableTotals.syncableKb || 0).toFixed(2) }} KB</span>
          <span v-if="Number(syncParityHint.localOnlyKb || cloudSyncableTotals.localOnlyKb || 0) > 0">
            仅本地 {{ Number(syncParityHint.localOnlyKb || cloudSyncableTotals.localOnlyKb || 0).toFixed(2) }} KB
          </span>
          <span v-for="item in cloudDataStats" :key="item.key">
            {{ item.label }} {{ item.sizeKb }} KB / {{ item.itemCount }} 项
          </span>
        </div>

        <div
          v-if="cloudSyncEnabled && (syncParityHint.isOutOfSync || syncParityHint.showOrphanBackupHint)"
          class="cloud-sync-parity-hint"
        >
          <strong>同步状态说明</strong>
          <p v-if="syncParityHint.showOrphanBackupHint">
            检测到收藏主数据为 0 条，但本地仍有约 {{ syncParityHint.favoritesOrphanKb }} KB
            的收藏备份/缓存。云同步只上传「当前收藏列表」，不会自动上传备份文件。
          </p>
          <p v-if="syncParityHint.isOutOfSync">
            当前可同步数据约 {{ syncParityHint.syncableKb }} KB，云端仅
            {{ syncParityHint.cloudKb }} KB，相差约 {{ syncParityHint.gapKb }} KB。
          </p>
          <p>可点击下方「立即上传到云端」尝试从备份恢复收藏并重新同步。</p>
        </div>

        <div v-if="cloudSyncIssues.length" class="cloud-sync-issues">
          <strong>同步异常</strong>
          <p v-for="issue in cloudSyncIssues" :key="issue.stateKey">
            {{ issue.label }}：{{ issue.error }}
          </p>
        </div>

        <div class="cloud-action-row">
          <label class="cloud-conflict-select">
            <span>同步策略</span>
            <select
              :value="cloudConflictStrategy"
              :disabled="isCloudSyncing || !isAuthenticated || !canUseSync"
              @change="$emit('set-cloud-conflict-strategy', $event.target.value)"
            >
              <option
                v-for="strategy in cloudConflictStrategies"
                :key="strategy.value"
                :value="strategy.value"
              >
                {{ strategy.label }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="data-simple-button primary"
            :disabled="isCloudSyncing || !isAuthenticated || !canUseSync || !cloudSyncEnabled"
            @click="$emit('upload-cloud')"
          >
            <i class="bi bi-cloud-upload"></i>
            <span>{{ isCloudSyncing ? '同步中...' : '立即上传到云端' }}</span>
          </button>
          <button
            type="button"
            class="data-simple-button"
            :disabled="isCloudSummaryLoading || !isAuthenticated || !canUseSync"
            @click="$emit('refresh-cloud')"
          >
            <i class="bi bi-arrow-clockwise"></i>
            <span>{{ isCloudSummaryLoading ? '刷新中...' : '刷新云端用量' }}</span>
          </button>
          <button
            type="button"
            class="data-simple-button danger"
            :disabled="isCloudSyncing || !isAuthenticated || !canUseSync"
            @click="$emit('clear-cloud')"
          >
            <i class="bi bi-cloud-slash"></i>
            <span>清空云端</span>
          </button>
        </div>
      </div>

      <div class="data-center-stats">
        <span>已选 {{ selectedStats.count }}/{{ dataSections.length }}</span>
        <span>可同步 {{ Number(syncParityHint.syncableKb || cloudSyncableTotals.syncableKb || 0).toFixed(2) }} KB</span>
        <span>收藏 {{ totalFavorites }}</span>
        <span>历史 {{ totalHistory }}</span>
        <span>本地合计 {{ storageUsage.total }} KB</span>
        <span>选中 {{ selectedStats.keys }} 项</span>
      </div>

      <div class="data-center-grid">
        <div class="data-center-block">
          <div class="data-block-head">
            <strong>范围</strong>
            <button
              type="button"
              class="data-text-button"
              title="选择或取消选择全部数据范围"
              @click="$emit('select-all')"
            >
              {{ selectedSectionIds.length === dataSections.length ? '取消全选' : '全选' }}
            </button>
          </div>
          <div class="data-chip-grid">
            <label v-for="section in dataSections" :key="section.id" class="data-choice-chip">
              <input
                type="checkbox"
                :checked="selectedSectionIds.includes(section.id)"
                @change="$emit('toggle-section', section.id)"
              />
              <span class="data-choice-chip__face">
                <i class="bi" :class="section.icon" aria-hidden="true"></i>
                <strong>{{ section.label }}</strong>
                <small>
                  {{ section.syncableKb ?? section.sizeKb }} KB
                  <template v-if="Number(section.localOnlyKb || 0) > 0">
                    · 缓存 {{ section.localOnlyKb }} KB
                  </template>
                </small>
              </span>
            </label>
          </div>
        </div>

        <div
          class="data-import-box"
          :class="{ 'is-busy': isImporting, 'has-file': Boolean(importFileName) }"
          role="button"
          tabindex="0"
          :aria-label="isImporting ? '正在还原备份' : '选择 JSON 备份文件还原'"
          @click="triggerImport"
          @keydown="onImportBoxKeydown"
        >
          <span class="data-import-icon" aria-hidden="true">
            <i class="bi" :class="isImporting ? 'bi-arrow-repeat spin' : 'bi-file-earmark-arrow-up'"></i>
          </span>
          <div class="data-import-main">
            <strong>{{ isImporting ? '正在还原备份' : '还原文件' }}</strong>
            <small>{{ importFileName || '点击选择 JSON 备份' }}</small>
          </div>
          <span class="data-import-cta">{{ isImporting ? '处理中' : '选择' }}</span>
          <input
            ref="importInput"
            class="data-import-input"
            type="file"
            accept=".json,application/json"
            tabindex="-1"
            @click.stop
            @change="handleImport"
          />
        </div>
      </div>

      <div class="data-action-row">
        <button
          type="button"
          class="data-simple-button primary"
          title="导出选中范围为一个 JSON 备份文件"
          :disabled="isExporting || selectedSectionIds.length === 0"
          @click="$emit('export')"
        >
          <i class="bi bi-safe2"></i>
          <span>{{ isExporting ? '备份中...' : '备份选中' }}</span>
        </button>
        <button
          type="button"
          class="data-simple-button"
          title="立即备份全部信息"
          :disabled="isExporting"
          @click="$emit('export', true)"
        >
          <i class="bi bi-archive"></i>
          <span>备份全部</span>
        </button>
        <button
          type="button"
          class="data-simple-button"
          title="选择星空云绘备份文件并还原选中范围"
          :disabled="isImporting || selectedSectionIds.length === 0"
          @click="triggerImport"
        >
          <i class="bi bi-arrow-counterclockwise"></i>
          <span>{{ isImporting ? '还原中...' : '还原选中' }}</span>
        </button>
        <button
          type="button"
          class="data-simple-button danger"
          title="清空选中范围的本地数据"
          :disabled="selectedSectionIds.length === 0"
          @click="$emit('clear')"
        >
          <i class="bi bi-trash3"></i>
          <span>清空选中</span>
        </button>
        <button
          type="button"
          class="data-simple-button danger ghost"
          title="清空全部可管理的数据"
          @click="$emit('clear', true)"
        >
          <i class="bi bi-exclamation-triangle"></i>
          <span>清空全部</span>
        </button>
      </div>
    </div>
    </div>
  </section>
</template>
