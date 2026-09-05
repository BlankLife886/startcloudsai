<script setup lang="ts">
/**
 * 管理端统一弹窗：header 置顶 / body 中部滚动 / footer 置底。
 * 少边框、浅底、轻重悬浮阴影；业务内容放默认插槽。
 */
import { computed, useSlots, type Component } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    subtitle?: string
    /** 标题旁图标（Element Plus icon 组件） */
    icon?: Component
    width?: string | number
    /** 附加到 el-dialog 根节点的业务 class（teleport 后仍可命中全局样式） */
    panelClass?: string
    appendToBody?: boolean
    destroyOnClose?: boolean
    closeOnClickModal?: boolean
    alignCenter?: boolean
    showClose?: boolean
    /** 隐藏整个 footer */
    hideFooter?: boolean
    footerHint?: string
    confirmText?: string
    cancelText?: string
    showConfirm?: boolean
    showCancel?: boolean
    confirmLoading?: boolean
    confirmDisabled?: boolean
    confirmType?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
    /**
     * 大表单 / Tabs：body 不滚动，由内部区域自行滚动。
     * 普通弹窗保持默认（body 中部滚动）。
     */
    nestedScroll?: boolean
  }>(),
  {
    width: '520px',
    panelClass: '',
    appendToBody: true,
    destroyOnClose: true,
    closeOnClickModal: true,
    alignCenter: true,
    showClose: true,
    hideFooter: false,
    confirmText: '确定',
    cancelText: '取消',
    showConfirm: true,
    showCancel: true,
    confirmLoading: false,
    confirmDisabled: false,
    confirmType: 'primary',
    nestedScroll: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
  closed: []
  open: []
}>()

const slots = useSlots()

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const dialogWidth = computed(() => {
  if (typeof props.width === 'number') return `${props.width}px`
  return props.width
})

const showDefaultHeader = computed(
  () => Boolean(props.title || props.subtitle || props.icon || slots.meta || slots.header),
)

const showFooter = computed(() => {
  if (props.hideFooter) return false
  return Boolean(
    slots.footer ||
      props.footerHint ||
      props.showCancel ||
      props.showConfirm,
  )
})

function close() {
  open.value = false
}

function onCancel() {
  emit('cancel')
  close()
}

function onConfirm() {
  emit('confirm')
}
</script>

<template>
  <el-dialog
    v-model="open"
    :width="dialogWidth"
    :append-to-body="appendToBody"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal"
    :align-center="alignCenter"
    :show-close="showClose"
    class="admin-dialog"
    :class="[panelClass, { 'is-nested-scroll': nestedScroll }]"
    modal-class="admin-dialog-modal"
    @open="emit('open')"
    @closed="emit('closed')"
  >
    <template v-if="showDefaultHeader" #header>
      <slot name="header">
        <div class="admin-dialog__head">
          <span v-if="icon" class="admin-dialog__mark" aria-hidden="true">
            <el-icon :size="18"><component :is="icon" /></el-icon>
          </span>
          <div class="admin-dialog__copy">
            <strong v-if="title">{{ title }}</strong>
            <small v-if="subtitle">{{ subtitle }}</small>
          </div>
          <div v-if="slots.meta" class="admin-dialog__meta">
            <slot name="meta" />
          </div>
        </div>
      </slot>
    </template>

    <div class="admin-dialog__content">
      <slot />
    </div>

    <template v-if="showFooter" #footer>
      <slot name="footer">
        <div class="admin-dialog__footer">
          <span v-if="footerHint" class="admin-dialog__hint">{{ footerHint }}</span>
          <div v-else class="admin-dialog__hint-spacer" />
          <div class="admin-dialog__actions">
            <el-button
              v-if="showCancel"
              class="admin-dialog__btn"
              @click="onCancel"
            >
              {{ cancelText }}
            </el-button>
            <el-button
              v-if="showConfirm"
              class="admin-dialog__btn admin-dialog__btn--ok"
              :type="confirmType"
              :loading="confirmLoading"
              :disabled="confirmDisabled"
              @click="onConfirm"
            >
              {{ confirmText }}
            </el-button>
          </div>
        </div>
      </slot>
    </template>
  </el-dialog>
</template>

<style>
/* teleported overlay / dialog：必须非 scoped */
.admin-dialog-modal.el-overlay {
  background: color-mix(in srgb, var(--ink) 18%, transparent);
  backdrop-filter: blur(10px) saturate(1.02);
  -webkit-backdrop-filter: blur(10px) saturate(1.02);
}

html.dark .admin-dialog-modal.el-overlay {
  background: rgb(0 0 0 / 0.42);
}

.admin-dialog-modal .el-overlay-dialog {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 16px;
}

.admin-dialog.el-dialog {
  --el-dialog-bg-color: var(--surface);
  position: relative;
  display: flex;
  flex-direction: column;
  max-width: 94vw;
  max-height: calc(100dvh - 56px);
  margin: 0 !important;
  overflow: hidden;
  border: none;
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow:
    0 2px 8px rgb(16 24 40 / 0.04),
    0 18px 48px rgb(16 24 40 / 0.12);
  animation: pop-in 0.28s cubic-bezier(0.21, 1.02, 0.73, 1) both;
}

html.dark .admin-dialog.el-dialog {
  box-shadow:
    0 2px 10px rgb(0 0 0 / 0.28),
    0 22px 56px rgb(0 0 0 / 0.45);
}

.admin-dialog .el-dialog__header {
  flex: 0 0 auto;
  z-index: 2;
  margin: 0;
  padding: 18px 56px 16px 20px;
  border-bottom: none;
  background: var(--surface);
  box-shadow: none;
}

.admin-dialog .el-dialog__headerbtn {
  top: 16px;
  right: 14px;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: none;
  border-radius: 11px;
  background: var(--surface);
  box-shadow:
    0 1px 2px rgb(16 24 40 / 0.05),
    0 4px 12px rgb(16 24 40 / 0.08);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

html.dark .admin-dialog .el-dialog__headerbtn {
  background: color-mix(in srgb, var(--surface) 88%, #fff 4%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.28);
}

.admin-dialog .el-dialog__headerbtn:hover {
  background: var(--surface);
  box-shadow:
    0 2px 6px rgb(16 24 40 / 0.06),
    0 8px 18px rgb(16 24 40 / 0.1);
  transform: translateY(-1px);
}

html.dark .admin-dialog .el-dialog__headerbtn:hover {
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.36);
}

.admin-dialog .el-dialog__headerbtn:active {
  transform: scale(0.96);
}

.admin-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--ink-2);
  font-size: 15px;
}

.admin-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--ink);
}

.admin-dialog .el-dialog__body {
  flex: 0 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 20px;
  background: var(--surface);
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink-3) 45%, transparent) transparent;
}

.admin-dialog.is-nested-scroll .el-dialog__body {
  flex: 1 1 auto;
}

.admin-dialog .el-dialog__body::-webkit-scrollbar {
  width: 8px;
}

.admin-dialog .el-dialog__body::-webkit-scrollbar-track {
  background: transparent;
}

.admin-dialog .el-dialog__body::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink-3) 40%, transparent);
  background-clip: padding-box;
}

.admin-dialog .el-dialog__footer {
  flex: 0 0 auto;
  z-index: 2;
  padding: 12px 20px 14px;
  border-top: none;
  background: var(--surface);
  box-shadow: none;
}

.admin-dialog__head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.admin-dialog__mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border: none;
  border-radius: 12px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  box-shadow:
    0 1px 2px rgb(16 24 40 / 0.04),
    0 6px 14px color-mix(in srgb, var(--accent) 16%, transparent);
}

html.dark .admin-dialog__mark {
  box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 18%, transparent);
}

.admin-dialog__copy {
  min-width: 0;
  flex: 1 1 auto;
}

.admin-dialog__copy strong,
.admin-dialog__copy small {
  display: block;
}

.admin-dialog__copy strong {
  color: var(--ink);
  font-size: 16px;
  font-weight: 740;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.admin-dialog__copy small {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.4;
}

.admin-dialog__meta {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 0;
  max-width: min(280px, 44%);
}

/* 供业务在 meta 插槽里复用的轻量 chip */
.admin-dialog__chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  overflow: hidden;
  border: none;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-shadow:
    0 1px 2px rgb(16 24 40 / 0.05),
    0 4px 10px rgb(16 24 40 / 0.06);
}

html.dark .admin-dialog__chip {
  background: color-mix(in srgb, var(--surface) 90%, #fff 5%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.28);
}

.admin-dialog__chip.is-mono {
  color: var(--ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 500;
}

.admin-dialog__content {
  min-width: 0;
}

/* 大编辑器：body 交给内部滚动，避免双层滚动条 */
.admin-dialog.is-nested-scroll {
  height: min(860px, calc(100dvh - 56px));
}

.admin-dialog.is-nested-scroll .el-dialog__body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 12px;
  padding-bottom: 12px;
}

.admin-dialog.is-nested-scroll .admin-dialog__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.admin-dialog__footer {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.admin-dialog__hint,
.admin-dialog__hint-spacer {
  min-width: 0;
  flex: 1 1 auto;
}

.admin-dialog__hint {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.4;
}

.admin-dialog__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.admin-dialog__btn {
  min-width: 84px;
  height: 34px;
  border-radius: 11px;
}

.admin-dialog__btn--ok {
  min-width: 96px;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .admin-dialog-modal.el-overlay {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .admin-dialog.el-dialog {
    animation: none;
  }

  .admin-dialog .el-dialog__headerbtn:hover,
  .admin-dialog .el-dialog__headerbtn:active {
    transform: none;
  }
}


</style>
