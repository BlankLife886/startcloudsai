<script lang="ts">
import { usePricingPageContext } from './pricingPageContext'
import PcDateTimeField from '@/components/pricing/PcDateTimeField.vue'

export default {
  components: { PcDateTimeField },
  setup: usePricingPageContext,
}
</script>

<template>
<Teleport to="body">
  <div
    v-if="keyMenuOpenId && keyMenuOpenKey"
    ref="keyMenuDropdownRef"
    class="pc-keys-menu__dropdown pc-keys-menu__dropdown--fixed"
    :style="keyMenuStyle"
    role="menu"
    @click.stop
    @pointerdown.stop
  >
    <button
      type="button"
      role="menuitem"
      :disabled="Boolean(keyActionLoading) || isKeyToggleDisabled(keyMenuOpenKey)"
      @click="runKeyMenuAction('limits', keyMenuOpenKey)"
    >
      修改限额
    </button>
    <button
      type="button"
      role="menuitem"
      :disabled="Boolean(keyActionLoading) || isKeyToggleDisabled(keyMenuOpenKey)"
      @click="runKeyMenuAction('info', keyMenuOpenKey)"
    >
      修改信息
    </button>
    <button
      type="button"
      role="menuitem"
      :disabled="
        Boolean(keyActionLoading) ||
        ['revoked', 'expired'].includes(String(keyMenuOpenKey.status))
      "
      @click="runKeyMenuAction('reset', keyMenuOpenKey)"
    >
      重置密钥
    </button>
    <button
      type="button"
      role="menuitem"
      class="is-danger"
      :disabled="
        Boolean(keyActionLoading) ||
        isSubscriptionApiKey(keyMenuOpenKey) ||
        ['revoked', 'expired'].includes(String(keyMenuOpenKey.status))
      "
      @click="runKeyMenuAction('revoke', keyMenuOpenKey)"
    >
      注销
    </button>
  </div>
</Teleport>

<Teleport to="body">
  <div
    v-if="keyCreateModalOpen"
    class="pc-pricing-modal-root pc-keys-modal-backdrop"
    @click.self="closeKeyCreateModal"
  >
    <div
      class="pc-keys-modal pc-keys-modal--compact pc-keys-modal--create"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pc-key-modal-title"
    >
      <header class="pc-keys-modal__head">
        <h2 id="pc-key-modal-title">创建充值密钥</h2>
        <button
          type="button"
          class="pc-keys-modal__close"
          @click="closeKeyCreateModal"
        >
          <i class="bi bi-x-lg"></i>
        </button>
      </header>

      <div class="pc-keys-modal__body pc-keys-modal__body--create">
        <div class="pc-keys-create-layout">
          <section class="pc-keys-create-card">
            <header class="pc-keys-create-card__head">
              <h3>基础配置</h3>
              <p>用于按量调用，与订阅密钥分开计费</p>
            </header>
            <div class="pc-keys-create-form">
              <label class="pc-keys-modal__field" for="pc-key-label-input">
                <span>密钥名称</span>
                <input
                  id="pc-key-label-input"
                  v-model="accountKeyForm.label"
                  class="pc-keys-input"
                  type="text"
                  placeholder="请输入密钥名称"
                  @keydown="handleKeyLabelKeydown"
                />
              </label>
              <div class="pc-keys-create-limit">
                <span class="pc-keys-create-limit__label">日/月/次数限额</span>
                <div
                  class="pc-keys-edit-segment pc-keys-edit-segment--compact"
                  role="tablist"
                  aria-label="日/月/次数限额类型"
                >
                  <button
                    v-for="option in KEY_LIMIT_MODE_OPTIONS"
                    :key="option.id"
                    type="button"
                    role="tab"
                    class="pc-keys-edit-segment__btn"
                    :class="{ 'is-active': keyLimitMode === option.id }"
                    :aria-selected="keyLimitMode === option.id"
                    @click="selectKeyLimitMode(option.id)"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <p class="pc-keys-create-limit__hint">
                  日/月金额与次数只能选一种；不限时仍按钱包余额扣费。同时设每日与每月次数时，每月不能低于每日
                </p>

                <div
                  v-if="keyLimitMode === 'usd'"
                  class="pc-keys-create-form__row pc-keys-create-form__row--limits"
                >
                  <label class="pc-keys-modal__field">
                    <span>日 / 月</span>
                    <select
                      v-model="keyLimitPeriod"
                      class="pc-select pc-keys-input"
                    >
                      <option value="daily">每日</option>
                      <option value="monthly">每月</option>
                    </select>
                  </label>
                  <label class="pc-keys-modal__field">
                    <span>上限金额</span>
                    <input
                      v-model="keyLimitAmount"
                      class="pc-keys-input"
                      type="text"
                      inputmode="decimal"
                      placeholder="例如 $50"
                    />
                  </label>
                </div>

                <div
                  v-else-if="keyLimitMode === 'count'"
                  class="pc-keys-create-form__row pc-keys-create-form__row--limits"
                >
                  <label class="pc-keys-modal__field">
                    <span>每日次数</span>
                    <input
                      v-model="accountKeyForm.dailyLimitUnits"
                      class="pc-keys-input"
                      type="text"
                      inputmode="numeric"
                      placeholder="留空不限"
                    />
                  </label>
                  <label class="pc-keys-modal__field">
                    <span>每月次数</span>
                    <input
                      v-model="accountKeyForm.monthlyLimitUnits"
                      class="pc-keys-input"
                      type="text"
                      inputmode="numeric"
                      placeholder="留空不限"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section class="pc-keys-create-card pc-keys-create-card--access">
            <header
              class="pc-keys-create-card__head pc-keys-create-card__head--row"
            >
              <div class="pc-keys-create-card__title">
                <h3>访问权限</h3>
                <p>选择可调用的模型范围与 API 能力</p>
              </div>
              <div class="pc-key-model-toggle pc-key-model-toggle--compact">
                <button
                  type="button"
                  class="pc-key-model-toggle__btn"
                  :class="{ 'is-active': keyAllowAllModels }"
                  @click="setKeyAllowAllModels(true)"
                >
                  全部模型
                </button>
                <button
                  type="button"
                  class="pc-key-model-toggle__btn"
                  :class="{ 'is-active': !keyAllowAllModels }"
                  @click="setKeyAllowAllModels(false)"
                >
                  指定模型
                </button>
              </div>
            </header>

            <div
              v-if="keyAllowAllModels"
              class="pc-keys-create-panel pc-keys-create-panel--muted"
            >
              当前密钥可调用全部公开模型
            </div>
            <div v-else class="pc-keys-create-panel">
              <label class="pc-keys-modal__field">
                <span>搜索模型</span>
                <input
                  v-model="keyModelSearch"
                  class="pc-keys-input"
                  type="search"
                  placeholder="按名称或 ID 筛选"
                />
              </label>
              <div class="pc-key-model-picker">
                <div class="pc-key-model-picker__meta">
                  <span
                    >已选 {{ selectedKeyModelCount }} /
                    {{ filteredKeyModelOptions.length }}</span
                  >
                </div>
                <div class="pc-key-model-picker__list">
                  <label
                    v-for="model in filteredKeyModelOptions"
                    :key="model.id"
                    class="pc-key-model-option"
                    :class="{ 'is-selected': isKeyModelSelected(model.id) }"
                  >
                    <input
                      class="pc-key-model-option__input"
                      type="checkbox"
                      :checked="isKeyModelSelected(model.id)"
                      @change="toggleKeyModelSelection(model.id)"
                    />
                    <span class="pc-key-model-option__check" aria-hidden="true">
                      <i class="bi bi-check2"></i>
                    </span>
                    <span class="pc-key-model-option__body">
                      <strong>{{ model.label }}</strong>
                      <small
                        v-if="model.displayId && model.displayId !== model.label"
                        >{{ model.displayId }}</small
                      >
                    </span>
                  </label>
                  <p
                    v-if="!filteredKeyModelOptions.length"
                    class="pc-keys-create-card__empty"
                  >
                    没有匹配的模型
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section class="pc-keys-create-card pc-keys-create-card--security">
            <header class="pc-keys-create-card__head">
              <h3>安全设置</h3>
              <p>限制来源 IP 与密钥有效期</p>
            </header>
            <div
              class="pc-keys-create-form__row pc-keys-create-form__row--security"
            >
              <label class="pc-keys-modal__field">
                <span>IP 白名单</span>
                <textarea
                  v-model="accountKeyForm.allowedIpsText"
                  class="pc-keys-textarea pc-keys-textarea--compact"
                  rows="3"
                  placeholder="每行一个 IP，留空不限"
                ></textarea>
              </label>
              <label class="pc-keys-modal__field">
                <span>过期时间</span>
                <PcDateTimeField
                  :model-value="accountKeyForm.expiresAt"
                  compact
                  @update:model-value="
                    (value) => {
                      accountKeyForm.expiresAt = value
                    }
                  "
                />
              </label>
            </div>
          </section>
        </div>
      </div>

      <footer class="pc-keys-modal__foot">
        <button
          type="button"
          class="pc-btn pc-btn--ghost"
          @click="closeKeyCreateModal"
        >
          取消
        </button>
        <button
          type="button"
          class="pc-btn pc-btn--primary"
          :disabled="
            keyActionLoading === 'create' ||
            !String(accountKeyForm.label || '').trim() ||
            (!keyAllowAllModels && !accountKeyForm.allowedPublicModels.length)
          "
          @click="createPlatformKey"
        >
          {{ keyActionLoading === 'create' ? '创建中…' : '创建' }}
        </button>
      </footer>
    </div>
  </div>
</Teleport>

<Teleport to="body">
  <Transition name="pc-keys-modal">
    <div
      v-if="keyEditModal === 'limits'"
      class="pc-pricing-modal-root pc-keys-modal-backdrop"
      @click.self="closeKeyEditModal"
    >
      <div
        class="pc-keys-modal pc-keys-modal--compact pc-keys-modal--edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-key-limits-modal-title"
      >
        <header class="pc-keys-modal__head">
          <div>
            <p class="pc-keys-modal__eyebrow">充值密钥</p>
            <h2 id="pc-key-limits-modal-title">修改限额</h2>
            <p class="pc-keys-modal__subtitle">
              {{ keyEditingKey?.label || '未命名密钥' }}
              <template v-if="keyEditingKeyMeta">
                · {{ keyEditingKeyMeta }}</template
              >
            </p>
          </div>
          <button
            type="button"
            class="pc-keys-modal__close"
            @click="closeKeyEditModal"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <div class="pc-keys-modal__body pc-keys-modal__body--edit">
          <section class="pc-keys-edit-card">
            <header class="pc-keys-edit-card__head">
              <h3>日/月/次数限额</h3>
              <p>
                日/月金额与次数只能选一种；不限时仍按钱包余额扣费。同时设每日与每月次数时，每月不能低于每日
              </p>
            </header>

            <p
              v-if="keyEditingKey && keyHasLegacyDualLimits(keyEditingKey)"
              class="pc-keys-edit-note pc-keys-edit-note--warn"
            >
              该密钥同时存在日/月金额与次数配置，当前按日/月金额限额展示。保存后将只保留你选择的类型。
            </p>

            <div
              class="pc-keys-edit-segment"
              role="tablist"
              aria-label="日/月/次数限额类型"
            >
              <button
                v-for="option in KEY_LIMIT_MODE_OPTIONS"
                :key="option.id"
                type="button"
                role="tab"
                class="pc-keys-edit-segment__btn"
                :class="{ 'is-active': keyEditLimitMode === option.id }"
                :aria-selected="keyEditLimitMode === option.id"
                @click="selectKeyEditLimitMode(option.id)"
              >
                {{ option.label }}
              </button>
            </div>

            <Transition name="pc-keys-edit-reveal" mode="out-in">
              <div
                v-if="keyEditLimitMode === 'usd'"
                key="usd"
                class="pc-keys-edit-limit-panel"
              >
                <div
                  ref="keyEditLimitSegmentRef"
                  class="pc-keys-edit-segment"
                  :class="{
                    'is-indicator-ready': keyEditLimitSegmentIndicatorReady,
                  }"
                  role="tablist"
                  aria-label="日/月金额限额"
                >
                  <span
                    class="pc-keys-edit-segment__indicator"
                    aria-hidden="true"
                    :style="keyEditLimitSegmentIndicatorStyle"
                  ></span>
                  <button
                    v-for="option in KEY_LIMIT_PERIOD_OPTIONS.filter(
                      (item) => item.id !== 'unlimited',
                    )"
                    :key="option.id"
                    type="button"
                    role="tab"
                    :ref="(el) => setKeyEditLimitSegmentBtnRef(option.id, el)"
                    class="pc-keys-edit-segment__btn"
                    :class="{ 'is-active': keyEditLimitPeriod === option.id }"
                    :aria-selected="keyEditLimitPeriod === option.id"
                    @click="selectKeyEditLimitPeriod(option.id)"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <label class="pc-keys-modal__field" for="pc-key-edit-limit-amount">
                  <span>上限金额</span>
                  <input
                    id="pc-key-edit-limit-amount"
                    v-model="keyEditLimitAmount"
                    class="pc-keys-input"
                    type="text"
                    inputmode="decimal"
                    placeholder="例如 $50"
                  />
                  <small class="pc-keys-edit-hint">
                    {{
                      keyEditLimitPeriod === 'monthly'
                        ? '按自然月统计，每月 1 日重置'
                        : '按自然日统计，每日 0 点重置'
                    }}
                  </small>
                </label>
              </div>
              <div
                v-else-if="keyEditLimitMode === 'count'"
                key="count"
                class="pc-keys-edit-grid"
              >
                <label class="pc-keys-modal__field" for="pc-key-edit-daily-units">
                  <span>每日次数</span>
                  <input
                    id="pc-key-edit-daily-units"
                    v-model="keyEditDailyUnits"
                    class="pc-keys-input"
                    type="text"
                    inputmode="numeric"
                    placeholder="留空不限"
                  />
                  <small class="pc-keys-edit-hint">留空表示不限</small>
                </label>
                <label class="pc-keys-modal__field" for="pc-key-edit-monthly-units">
                  <span>每月次数</span>
                  <input
                    id="pc-key-edit-monthly-units"
                    v-model="keyEditMonthlyUnits"
                    class="pc-keys-input"
                    type="text"
                    inputmode="numeric"
                    placeholder="留空不限"
                  />
                  <small class="pc-keys-edit-hint">留空表示不限</small>
                </label>
              </div>
              <p v-else key="unlimited" class="pc-keys-edit-note">
                不设日/月/次数上限，调用费用仍从钱包余额扣除
              </p>
            </Transition>
          </section>

          <aside class="pc-keys-edit-preview">
            <strong>保存后将生效</strong>
            <ul>
              <li>
                <span>日/月/次数限额</span>
                <em>{{ keyEditLimitsPreviewLines.summary }}</em>
              </li>
            </ul>
          </aside>
        </div>

        <footer class="pc-keys-modal__foot">
          <button
            type="button"
            class="pc-btn pc-btn--ghost"
            @click="closeKeyEditModal"
          >
            取消
          </button>
          <button
            type="button"
            class="pc-btn pc-btn--primary"
            :disabled="keyActionLoading === `limits:${keyEditingKey?.id}`"
            @click="saveKeyLimits"
          >
            {{
              keyActionLoading === `limits:${keyEditingKey?.id}`
                ? '保存中…'
                : '保存限额'
            }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</Teleport>

<Teleport to="body">
  <Transition name="pc-keys-modal">
    <div
      v-if="keyEditModal === 'info'"
      class="pc-pricing-modal-root pc-keys-modal-backdrop"
      @click.self="closeKeyEditModal"
    >
      <div
        class="pc-keys-modal pc-keys-modal--compact pc-keys-modal--edit pc-keys-modal--info"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-key-info-modal-title"
      >
        <header class="pc-keys-modal__head">
          <div>
            <p class="pc-keys-modal__eyebrow">充值密钥</p>
            <h2 id="pc-key-info-modal-title">修改信息</h2>
            <p class="pc-keys-modal__subtitle">
              {{ keyEditingKey?.label || '未命名密钥' }}
              <template v-if="keyEditingKeyMeta">
                · {{ keyEditingKeyMeta }}</template
              >
            </p>
          </div>
          <button
            type="button"
            class="pc-keys-modal__close"
            @click="closeKeyEditModal"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <div class="pc-keys-modal__body pc-keys-modal__body--edit">
          <section class="pc-keys-edit-card">
            <header class="pc-keys-edit-card__head">
              <h3>基础信息</h3>
              <p>仅修改名称，不会影响密钥本身</p>
            </header>
            <label class="pc-keys-modal__field" for="pc-key-edit-label-input">
              <span>密钥名称</span>
              <input
                id="pc-key-edit-label-input"
                v-model="keyEditForm.label"
                class="pc-keys-input"
                type="text"
                placeholder="例如：本地开发、Cursor"
              />
            </label>
          </section>

          <section class="pc-keys-edit-card">
            <header class="pc-keys-edit-card__head pc-keys-edit-card__head--row">
              <div>
                <h3>可调用模型</h3>
                <p>控制该密钥能访问哪些公开模型</p>
              </div>
              <div class="pc-key-model-toggle pc-key-model-toggle--compact">
                <button
                  type="button"
                  class="pc-key-model-toggle__btn"
                  :class="{ 'is-active': keyEditAllowAllModels }"
                  @click="setKeyEditAllowAllModels(true)"
                >
                  全部模型
                </button>
                <button
                  type="button"
                  class="pc-key-model-toggle__btn"
                  :class="{ 'is-active': !keyEditAllowAllModels }"
                  @click="setKeyEditAllowAllModels(false)"
                >
                  指定模型
                </button>
              </div>
            </header>

            <Transition name="pc-keys-edit-reveal" mode="out-in">
              <p v-if="keyEditAllowAllModels" key="all" class="pc-keys-edit-note">
                当前密钥可调用全部公开模型
              </p>
              <div v-else key="picker" class="pc-keys-create-panel">
                <label class="pc-keys-modal__field">
                  <span>搜索模型</span>
                  <input
                    v-model="keyEditModelSearch"
                    class="pc-keys-input"
                    type="search"
                    placeholder="按名称或 ID 筛选"
                  />
                </label>
                <div class="pc-key-model-picker">
                  <div class="pc-key-model-picker__meta">
                    <span>
                      已选 {{ selectedKeyEditModelCount }} /
                      {{ filteredKeyEditModelOptions.length }}
                    </span>
                  </div>
                  <div class="pc-key-model-picker__list">
                    <label
                      v-for="model in filteredKeyEditModelOptions"
                      :key="model.id"
                      class="pc-key-model-option"
                      :class="{ 'is-selected': isKeyEditModelSelected(model.id) }"
                    >
                      <input
                        class="pc-key-model-option__input"
                        type="checkbox"
                        :checked="isKeyEditModelSelected(model.id)"
                        @change="toggleKeyEditModelSelection(model.id)"
                      />
                      <span class="pc-key-model-option__check" aria-hidden="true">
                        <i class="bi bi-check2"></i>
                      </span>
                      <span class="pc-key-model-option__body">
                        <strong>{{ model.label }}</strong>
                        <small
                          v-if="model.displayId && model.displayId !== model.label"
                        >
                          {{ model.displayId }}
                        </small>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </Transition>
          </section>

          <section class="pc-keys-edit-card">
            <header class="pc-keys-edit-card__head">
              <h3>安全策略</h3>
              <p>可选配置，留空表示不额外限制</p>
            </header>
            <div class="pc-keys-edit-grid pc-keys-edit-grid--stack">
              <label class="pc-keys-modal__field">
                <span>IP 白名单</span>
                <textarea
                  v-model="keyEditForm.allowedIpsText"
                  class="pc-keys-textarea pc-keys-textarea--compact"
                  rows="3"
                  placeholder="每行一个 IP 地址&#10;例如：192.168.1.10"
                ></textarea>
                <small class="pc-keys-edit-hint">留空表示任意 IP 均可调用</small>
              </label>
              <label class="pc-keys-modal__field">
                <span>过期时间</span>
                <PcDateTimeField
                  :model-value="keyEditForm.expiresAt"
                  compact
                  @update:model-value="
                    (value) => {
                      keyEditForm.expiresAt = value
                    }
                  "
                />
                <small class="pc-keys-edit-hint">留空表示永不过期</small>
              </label>
            </div>
          </section>

          <p v-if="keyEditBlockedReason" class="pc-keys-modal__warn">
            <i class="bi bi-exclamation-circle"></i>
            {{ keyEditBlockedReason }}
          </p>
        </div>

        <footer class="pc-keys-modal__foot">
          <button
            type="button"
            class="pc-btn pc-btn--ghost"
            @click="closeKeyEditModal"
          >
            取消
          </button>
          <button
            type="button"
            class="pc-btn pc-btn--primary"
            :disabled="
              keyActionLoading === `info:${keyEditingKey?.id}` ||
              !String(keyEditForm.label || '').trim() ||
              (!keyEditAllowAllModels && !keyEditForm.allowedPublicModels.length)
            "
            @click="saveKeyInfo"
          >
            {{
              keyActionLoading === `info:${keyEditingKey?.id}`
                ? '保存中…'
                : '保存信息'
            }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</Teleport>

<Teleport to="body">
  <div
    v-if="keyResetModalKey"
    class="pc-pricing-modal-root pc-keys-modal-backdrop"
    @click.self="!keyResetNewSecret && closeKeyResetModal()"
  >
    <div
      class="pc-keys-modal pc-keys-modal--compact pc-keys-modal--reset"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="
        keyResetNewSecret
          ? 'pc-key-reset-success-title'
          : 'pc-key-reset-modal-title'
      "
    >
      <header class="pc-keys-modal__head">
        <h2
          :id="
            keyResetNewSecret
              ? 'pc-key-reset-success-title'
              : 'pc-key-reset-modal-title'
          "
        >
          {{
            keyResetNewSecret
              ? '密钥已重置'
              : `重置密钥 · ${keyResetModalKey?.label || '未命名密钥'}`
          }}
        </h2>
        <button
          type="button"
          class="pc-keys-modal__close"
          @click="closeKeyResetModal"
        >
          <i class="bi bi-x-lg"></i>
        </button>
      </header>
      <div class="pc-keys-modal__body">
        <div v-if="!keyResetNewSecret" class="pc-key-reset-confirm">
          <div class="pc-key-reset-confirm__alert">
            <i class="bi bi-exclamation-triangle"></i>
            <div>
              <strong>旧密钥将立即失效</strong>
              <p>重置后请更新所有使用该密钥的应用，此操作不可撤销。</p>
            </div>
          </div>
          <dl class="pc-key-reset-confirm__meta">
            <div>
              <dt>密钥名称</dt>
              <dd>{{ keyResetModalKey?.label || '未命名密钥' }}</dd>
            </div>
            <div v-if="keyResetModalKey?.prefix">
              <dt>前缀</dt>
              <dd>
                <code>{{ keyResetModalKey.prefix }}</code>
              </dd>
            </div>
          </dl>
        </div>
        <div v-else class="pc-secret pc-secret--modal">
          <div class="pc-secret-head">
            <i class="bi bi-shield-exclamation"></i>
            <div>
              <strong>请立即保存新密钥</strong>
              <small>完整密钥只显示这一次，关闭弹窗后无法再次查看。</small>
            </div>
          </div>
          <div class="pc-secret-body pc-secret-body--stack">
            <code>{{ keyResetNewSecret }}</code>
          </div>
        </div>
      </div>
      <footer class="pc-keys-modal__foot">
        <template v-if="!keyResetNewSecret">
          <button
            type="button"
            class="pc-btn pc-btn--ghost"
            @click="closeKeyResetModal"
          >
            取消
          </button>
          <button
            type="button"
            class="pc-btn is-danger"
            :disabled="keyActionLoading === `reset:${keyResetModalKey?.id}`"
            @click="confirmKeyReset"
          >
            {{
              keyActionLoading === `reset:${keyResetModalKey?.id}`
                ? '重置中…'
                : '确认重置'
            }}
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="pc-btn pc-btn--ghost"
            @click="closeKeyResetModal"
          >
            我已保存
          </button>
          <button
            type="button"
            class="pc-btn pc-btn--primary"
            @click="copyText(keyResetNewSecret, '密钥已复制')"
          >
            <i class="bi bi-clipboard"></i>
            复制密钥
          </button>
        </template>
      </footer>
    </div>
  </div>
</Teleport>

<Teleport to="body">
  <div
    v-if="keyRevokeModalKey"
    class="pc-pricing-modal-root pc-keys-modal-backdrop"
    @click.self="closeKeyRevokeModal"
  >
    <div
      class="pc-keys-modal pc-keys-modal--compact pc-keys-modal--reset"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pc-key-revoke-modal-title"
    >
      <header class="pc-keys-modal__head">
        <h2 id="pc-key-revoke-modal-title">
          注销密钥 · {{ keyRevokeModalKey?.label || '未命名密钥' }}
        </h2>
        <button
          type="button"
          class="pc-keys-modal__close"
          @click="closeKeyRevokeModal"
        >
          <i class="bi bi-x-lg"></i>
        </button>
      </header>
      <div class="pc-keys-modal__body">
        <div class="pc-key-reset-confirm">
          <div class="pc-key-reset-confirm__alert">
            <i class="bi bi-exclamation-triangle"></i>
            <div>
              <strong>注销后密钥将立即失效</strong>
              <p>注销后无法恢复，请确认所有使用该密钥的应用已停止使用。</p>
            </div>
          </div>
          <dl class="pc-key-reset-confirm__meta">
            <div>
              <dt>密钥名称</dt>
              <dd>{{ keyRevokeModalKey?.label || '未命名密钥' }}</dd>
            </div>
            <div v-if="keyRevokeModalKey?.prefix">
              <dt>前缀</dt>
              <dd>
                <code>{{ keyRevokeModalKey.prefix }}</code>
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <footer class="pc-keys-modal__foot">
        <button
          type="button"
          class="pc-btn pc-btn--ghost"
          @click="closeKeyRevokeModal"
        >
          取消
        </button>
        <button
          type="button"
          class="pc-btn is-danger"
          :disabled="keyActionLoading === `revoke:${keyRevokeModalKey?.id}`"
          @click="confirmKeyRevoke"
        >
          {{
            keyActionLoading === `revoke:${keyRevokeModalKey?.id}`
              ? '注销中…'
              : '确认注销'
          }}
        </button>
      </footer>
    </div>
  </div>
</Teleport>
</template>
