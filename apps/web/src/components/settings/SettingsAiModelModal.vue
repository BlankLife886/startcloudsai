<script setup>
import { formatAiCapabilityLabel } from '@/config/aiModels'
import {
  formatAiModelPriceParts,
  getAiModelBrand,
  getAiModelDescription,
  getAiModelPriceSummary,
} from '@/config/aiModelUi'

defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  detailOpen: {
    type: Boolean,
    default: false,
  },
  providerConfig: {
    type: Object,
    required: true,
  },
  capabilityTabs: {
    type: Array,
    default: () => [],
  },
  activeCapability: {
    type: String,
    default: '',
  },
  search: {
    type: String,
    default: '',
  },
  models: {
    type: Array,
    default: () => [],
  },
  selectedModel: {
    type: Object,
    default: null,
  },
  selectedIds: {
    type: Array,
    default: () => [],
  },
  primaryId: {
    type: String,
    default: '',
  },
  selectedId: {
    type: String,
    default: '',
  },
  selectedCount: {
    type: Number,
    default: 0,
  },
  syncing: {
    type: Boolean,
    default: false,
  },
  canSync: {
    type: Boolean,
    default: false,
  },
  syncError: {
    type: String,
    default: '',
  },
  syncMeta: {
    type: Object,
    default: () => ({}),
  },
  totalCount: {
    type: Number,
    default: 0,
  },
  providerId: {
    type: String,
    default: '',
  },
  runtimeModelCatalog: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits([
  'close',
  'close-detail',
  'open-detail',
  'save',
  'set-capability',
  'update:search',
  'toggle-model',
  'set-primary',
  'sync-models',
])

function isModelChecked(selectedIds, modelId) {
  return selectedIds.includes(modelId)
}

function visibleCapabilityLabels(model) {
  return (model?.capabilities || [])
    .filter((capability) => capability !== 'profileAnalysis')
    .map(formatAiCapabilityLabel)
    .join(' / ')
}

function formatSyncTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString()
  } catch {
    return ''
  }
}
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="ai-model-modal-backdrop" @click.self="emit('close')">
      <section
        class="ai-model-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-model-modal-title"
      >
        <header class="ai-model-modal-header">
          <div>
            <p>模型管理</p>
            <h3 id="ai-model-modal-title">{{ providerConfig.label }}</h3>
          </div>
          <button type="button" class="ai-model-modal-close" title="关闭" @click="emit('close')">
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <div class="ai-model-modal-meta">
          <span>{{ providerConfig.baseURL }}</span>
          <span>{{ selectedCount }} 个已选</span>
          <span>{{ totalCount }} 个模型</span>
          <span v-if="syncMeta?.fetchedAt">同步于 {{ formatSyncTime(syncMeta.fetchedAt) }}</span>
          <button
            v-if="canSync"
            type="button"
            class="ai-model-modal-sync"
            :disabled="syncing"
            @click="emit('sync-models')"
          >
            <i class="bi" :class="syncing ? 'bi-arrow-repeat spin' : 'bi-cloud-arrow-down'"></i>
            {{ syncing ? '同步中' : '同步模型' }}
          </button>
        </div>
        <p v-if="syncError" class="ai-model-modal-sync-error">{{ syncError }}</p>

        <div class="ai-model-modal-filters">
          <div class="ai-model-modal-tabs">
            <button
              v-for="tab in capabilityTabs"
              :key="tab.value || 'all'"
              type="button"
              class="ai-model-modal-tab"
              :class="{ active: activeCapability === tab.value }"
              @click="emit('set-capability', tab.value)"
            >
              {{ tab.label }}
            </button>
          </div>
          <label class="ai-model-modal-search">
            <i class="bi bi-search"></i>
            <input
              :value="search"
              type="search"
              placeholder="搜索模型"
              @input="emit('update:search', $event.target.value)"
            />
          </label>
        </div>

        <div class="ai-model-modal-body">
          <div class="ai-model-modal-grid">
            <article
              v-for="model in models"
              :key="model.id"
              class="ai-model-option"
              :class="{
                checked: isModelChecked(selectedIds, model.id),
                primary: primaryId === model.id,
                selected: selectedId === model.id,
                adapter: model.adapterReady,
              }"
              @click="emit('open-detail', model)"
            >
              <div class="ai-model-option-head">
                <div class="ai-model-option-brand">
                  <span class="ai-model-option-icon">
                    <img
                      v-if="model.icon"
                      :src="model.icon"
                      :alt="getAiModelBrand(model, providerConfig.label).label"
                      loading="lazy"
                    />
                    <i v-else :class="getAiModelBrand(model, providerConfig.label).icon"></i>
                  </span>
                  <div class="ai-model-option-copy">
                    <strong>{{ model.label }}</strong>
                    <span>{{ getAiModelBrand(model, providerConfig.label).label }}</span>
                  </div>
                </div>
                <label class="ai-model-option-check" @click.stop>
                  <input
                    :checked="isModelChecked(selectedIds, model.id)"
                    type="checkbox"
                    @change="emit('toggle-model', model.id)"
                  />
                  <span>选用</span>
                </label>
              </div>

              <div class="ai-model-option-price">
                <strong>{{ getAiModelPriceSummary(model.id, providerId, runtimeModelCatalog) }}</strong>
              </div>
            </article>
          </div>
        </div>

        <footer class="ai-model-modal-footer">
          <button type="button" class="ai-model-modal-cancel" @click="emit('close')">取消</button>
          <button type="button" class="ai-model-modal-save" @click="emit('save')">保存</button>
        </footer>
      </section>

      <section
        v-if="detailOpen && selectedModel"
        class="ai-model-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-model-detail-modal-title"
        @click.self="emit('close-detail')"
      >
        <div class="ai-model-detail-modal-panel">
          <header class="ai-model-detail-modal-header">
            <div class="ai-model-detail-head">
              <span class="ai-model-detail-icon">
                <img
                  v-if="selectedModel.icon"
                  :src="selectedModel.icon"
                  :alt="getAiModelBrand(selectedModel, providerConfig.label).label"
                  loading="lazy"
                />
                <i v-else :class="getAiModelBrand(selectedModel, providerConfig.label).icon"></i>
              </span>
              <div class="ai-model-detail-copy">
                <strong id="ai-model-detail-modal-title">{{ selectedModel.label }}</strong>
                <small>
                  {{ getAiModelBrand(selectedModel, providerConfig.label).label }} ·
                  {{ visibleCapabilityLabels(selectedModel) }}
                </small>
              </div>
            </div>
            <button
              type="button"
              class="ai-model-modal-close"
              title="关闭"
              @click="emit('close-detail')"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="ai-model-detail-pricing">
            <div
              v-for="row in formatAiModelPriceParts(selectedModel.id, providerId, runtimeModelCatalog).rows || []"
              :key="`${selectedModel.id}-${row.label}-${row.text}`"
              class="ai-model-detail-price"
            >
              <span>{{ row.label }}</span>
              <strong>{{ row.text }}</strong>
            </div>
          </div>

          <div class="ai-model-detail-meta">
            <span>基础模型：{{ selectedModel.baseModel || selectedModel.id }}</span>
            <span>能力数：{{ selectedModel.capabilities.length }}</span>
            <span>
              上下文：{{
                selectedModel.maxInTokenNumber
                  ? `${Math.round(selectedModel.maxInTokenNumber / 1000)}K`
                  : '未知'
              }}
            </span>
            <span>
              来源：<a :href="selectedModel.sourceUrl" target="_blank" rel="noreferrer">官网详情</a>
            </span>
            <span v-if="selectedModel.endpoints?.length">
              接口：{{ selectedModel.endpoints.slice(0, 3).join(' / ') }}
            </span>
          </div>

          <p class="ai-model-detail-description">
            {{ getAiModelDescription(selectedModel) }}
          </p>

          <div class="ai-model-detail-footer">
            <button
              type="button"
              class="ai-model-primary-button"
              :class="{ active: primaryId === selectedModel.id }"
              :disabled="!isModelChecked(selectedIds, selectedModel.id)"
              @click="emit('set-primary', selectedModel.id)"
            >
              <i class="bi bi-star-fill"></i>
            </button>
            <button
              type="button"
              class="ai-model-modal-tab"
              @click="emit('toggle-model', selectedModel.id)"
            >
              {{ isModelChecked(selectedIds, selectedModel.id) ? '取消选用' : '加入选用' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </teleport>
</template>

<style scoped>
.ai-model-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4305;
  display: flex;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(6px);
}

.ai-model-modal {
  width: min(1180px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--card-bg-color) 92%, #000 8%);
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.42);
}

.ai-model-modal-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
}

.ai-model-modal-header p {
  margin: 0 0 4px;
  color: var(--text-muted-color);
  font-size: 0.72rem;
  font-weight: 700;
}

.ai-model-modal-header h3 {
  margin: 0;
  color: var(--text-color);
  font-size: 1rem;
  font-weight: 800;
}

.ai-model-modal-close {
  min-width: 36px;
  min-height: 36px;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted-color);
  cursor: pointer;
}

.ai-model-modal-meta,
.ai-model-modal-filters,
.ai-model-modal-footer {
  padding: 12px 18px;
}

.ai-model-modal-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted-color);
  font-size: 0.74rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
}

.ai-model-modal-sync {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--primary-color) 42%, var(--border-color));
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--text-color);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}

.ai-model-modal-sync:disabled {
  opacity: 0.65;
  cursor: progress;
}

.ai-model-modal-sync-error {
  margin: -4px 18px 10px;
  color: #f97373;
  font-size: 0.74rem;
}

.spin {
  animation: ai-model-spin 0.9s linear infinite;
}

@keyframes ai-model-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-model-modal-filters {
  display: grid;
  gap: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
}

.ai-model-modal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.ai-model-modal-tab {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted-color);
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
}

.ai-model-modal-tab.active {
  color: var(--text-color);
  border-color: color-mix(in srgb, var(--primary-color) 38%, var(--border-color));
  background: color-mix(in srgb, var(--primary-color) 14%, transparent);
}

.ai-model-modal-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--hover-color) 88%, #000 12%);
}

.ai-model-modal-search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-color);
}

.ai-model-modal-body {
  display: block;
  padding: 12px 16px 16px;
  overflow: auto;
}

.ai-model-modal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  min-width: 0;
}

.ai-model-option {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--border-color) 62%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--hover-color) 90%, #000 10%);
  cursor: pointer;
}

.ai-model-option.checked {
  border-color: color-mix(in srgb, var(--primary-color) 30%, var(--border-color));
}

.ai-model-option.selected {
  border-color: color-mix(in srgb, var(--primary-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--primary-color) 10%, var(--hover-color) 90%);
}

.ai-model-option.primary {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

.ai-model-option-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.ai-model-option-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ai-model-option-icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  border-radius: 9px;
  color: var(--text-color);
  background: color-mix(in srgb, var(--card-bg-color) 88%, #000 12%);
}

.ai-model-option-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ai-model-option-check {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted-color);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}

.ai-model-option-check input {
  margin: 0;
}

.ai-model-option-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.ai-model-option-copy strong,
.ai-model-option-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-model-option-copy strong {
  color: var(--text-color);
  font-size: 0.8rem;
}

.ai-model-option-copy span {
  color: var(--text-muted-color);
  font-size: 0.64rem;
}

.ai-model-option-price {
  display: grid;
  gap: 2px;
}

.ai-model-option-price strong {
  color: var(--text-color);
  font-size: 0.7rem;
  line-height: 1.25;
}

.ai-model-option-price small {
  color: var(--text-muted-color);
  font-size: 0.58rem;
}

.ai-model-primary-button {
  min-width: 34px;
  min-height: 34px;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted-color);
  cursor: pointer;
}

.ai-model-primary-button.active {
  color: #f6c344;
  border-color: color-mix(in srgb, #f6c344 40%, var(--border-color));
}

.ai-model-detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ai-model-detail-icon {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--card-bg-color) 88%, #000 12%);
}

.ai-model-detail-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ai-model-detail-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.ai-model-detail-copy strong,
.ai-model-detail-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-model-detail-copy strong {
  color: var(--text-color);
  font-size: 0.9rem;
}

.ai-model-detail-copy small {
  color: var(--text-muted-color);
  font-size: 0.68rem;
}

.ai-model-detail-pricing {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ai-model-detail-price {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 44%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--card-bg-color) 84%, #000 16%);
}

.ai-model-detail-price span {
  color: var(--text-muted-color);
  font-size: 0.62rem;
}

.ai-model-detail-price strong {
  color: var(--text-color);
  font-size: 0.78rem;
}

.ai-model-detail-meta {
  display: grid;
  gap: 6px;
  color: var(--text-muted-color);
  font-size: 0.66rem;
}

.ai-model-detail-meta a {
  color: color-mix(in srgb, var(--primary-color) 72%, white);
  text-decoration: none;
}

.ai-model-detail-description {
  margin: 0;
  color: var(--text-color);
  font-size: 0.72rem;
  line-height: 1.5;
}

.ai-model-detail-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-model-detail-modal {
  position: fixed;
  inset: 24px;
  z-index: 4315;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(6px);
}

.ai-model-detail-modal-panel {
  width: min(620px, 100%);
  max-height: 100%;
  overflow: auto;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--border-color) 62%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--card-bg-color) 94%, #000 6%);
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.46);
}

.ai-model-detail-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 1040px) {
  .ai-model-detail-modal {
    inset: 0;
    padding: 10px;
  }
}

.ai-model-modal-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--card-bg-color) 84%, transparent),
      var(--card-bg-color)
    ),
    color-mix(in srgb, var(--card-bg-color) 94%, #000 6%);
  box-shadow: 0 -12px 26px rgba(0, 0, 0, 0.18);
}

.ai-model-modal-cancel,
.ai-model-modal-save {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
}

.ai-model-modal-save {
  border-color: color-mix(in srgb, var(--primary-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--primary-color) 16%, transparent);
}
</style>
