<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Check, MagicStick, Operation, Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { request } from "@/request";
import { normalizePoints } from "@/utils";

interface AdminSettings {
  userMaxRunningTasks?: number;
  userMaxConcurrentTasks?: number;
  globalMaxConcurrentTasks?: number;
  globalMaxActiveTasks?: number;
  workerConcurrencyCeiling?: number;
  effectiveGlobalConcurrency?: number;
  registrationEnabled?: boolean;
  signupBonusCents?: number;
}

const loading = ref(false);
const saving = ref(false);
const savedSignature = ref("");
const workerConcurrencyCeiling = ref(1);

const form = reactive({
  userMaxRunningTasks: 100,
  userMaxConcurrentTasks: 2,
  globalMaxConcurrentTasks: 4,
  globalMaxActiveTasks: 2000,
  registrationEnabled: true,
  signupBonusPoints: 0,
});

const settingsSignature = () =>
  JSON.stringify({
    userMaxRunningTasks: form.userMaxRunningTasks,
    userMaxConcurrentTasks: form.userMaxConcurrentTasks,
    globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
    globalMaxActiveTasks: form.globalMaxActiveTasks,
    registrationEnabled: form.registrationEnabled,
    signupBonusPoints: form.signupBonusPoints,
  });

const isDirty = computed(
  () =>
    !loading.value &&
    savedSignature.value !== "" &&
    settingsSignature() !== savedSignature.value,
);
const effectiveGlobalConcurrency = computed(() =>
  Math.min(form.globalMaxConcurrentTasks, workerConcurrencyCeiling.value),
);

function hydrate(settings: AdminSettings) {
  form.userMaxRunningTasks = settings.userMaxRunningTasks ?? 100;
  form.userMaxConcurrentTasks = settings.userMaxConcurrentTasks ?? 2;
  form.globalMaxConcurrentTasks = settings.globalMaxConcurrentTasks ?? 4;
  form.globalMaxActiveTasks = settings.globalMaxActiveTasks ?? 2000;
  workerConcurrencyCeiling.value = Math.max(1, settings.workerConcurrencyCeiling ?? 1);
  form.registrationEnabled = settings.registrationEnabled ?? true;
  form.signupBonusPoints = normalizePoints(settings.signupBonusCents);
  savedSignature.value = settingsSignature();
}

async function load() {
  loading.value = true;
  try {
    hydrate(await request<AdminSettings>("/api/v1/admin/settings"));
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    hydrate(
      await request<AdminSettings>("/api/v1/admin/settings", {
        method: "PUT",
        body: {
          userMaxRunningTasks: form.userMaxRunningTasks,
          userMaxConcurrentTasks: form.userMaxConcurrentTasks,
          globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
          globalMaxActiveTasks: form.globalMaxActiveTasks,
          registrationEnabled: form.registrationEnabled,
          signupBonusCents: normalizePoints(form.signupBonusPoints),
        },
      }),
    );
    ElMessage.success("系统设置已生效");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="settings-page">
    <header class="settings-head">
      <div class="settings-copy">
        <span>SYSTEM CONTROL</span>
        <h1>系统设置</h1>
        <p>管理注册、账户赠送和任务并发；模型价格统一在模型配置中维护。</p>
      </div>

      <div class="settings-actions">
        <div class="save-state" :class="{ 'is-dirty': isDirty }">
          <i />{{ isDirty ? "有未保存变更" : "配置已同步" }}
        </div>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button
          type="primary"
          :icon="Check"
          :loading="saving"
          :disabled="!isDirty"
          @click="save"
        >
          保存并生效
        </el-button>
      </div>
    </header>

    <section class="model-config-entry">
      <div class="entry-icon">
        <el-icon><MagicStick /></el-icon>
      </div>
      <div>
        <strong>服务商与模型</strong>
        <span>连接服务、读取模型并配置用户可选的生图与对话模型</span>
      </div>
      <router-link to="/model-config">进入模型配置</router-link>
    </section>

    <main class="settings-grid">
      <section class="setting-panel operation-panel">
        <header>
          <div class="panel-icon is-operation">
            <el-icon><Operation /></el-icon>
          </div>
          <div><strong>运营设置</strong><span>账号与任务规则</span></div>
        </header>

        <div class="setting-list">
          <label class="setting-row">
            <span
              ><strong>开放注册</strong><small>控制新用户注册入口</small></span
            >
            <el-switch v-model="form.registrationEnabled" />
          </label>

          <label class="setting-row">
            <span
              ><strong>全站同时执行</strong
              ><small
				>上游在途任务上限 · 当前 {{ effectiveGlobalConcurrency }}；Worker 短操作槽
				{{ workerConcurrencyCeiling }}</small
              ></span
            >
            <el-input-number
              v-model="form.globalMaxConcurrentTasks"
              :min="1"
			  :max="10000000"
			  :step="100"
              controls-position="right"
            />
          </label>

          <label class="setting-row">
            <span
              ><strong>单用户同时执行</strong
			  ><small>每个账号允许同时处于上游执行中的任务数</small></span
            >
            <el-input-number
              v-model="form.userMaxConcurrentTasks"
              :min="1"
              :max="10000"
              controls-position="right"
            />
          </label>

          <label class="setting-row">
            <span
              ><strong>全站待处理容量</strong
              ><small>排队与运行任务达到该水位后停止接收新任务，保护服务稳定</small></span
            >
            <el-input-number
              v-model="form.globalMaxActiveTasks"
              :min="10"
              :max="10000000"
              :step="100"
              controls-position="right"
            />
          </label>

          <label class="setting-row">
            <span
              ><strong>单用户待处理任务</strong
              ><small>运行中与排队中的任务总量上限；上游并发由 Worker 单独控制</small></span
            >
            <el-input-number
              v-model="form.userMaxRunningTasks"
              :min="1"
              :max="10000"
              controls-position="right"
            />
          </label>

          <label class="setting-row">
            <span
              ><strong>注册赠送</strong
              ><small>新账号首次获得的积分</small></span
            >
            <div class="points-input">
              <el-input-number
                v-model="form.signupBonusPoints"
                :min="0"
                :step="1"
                :precision="0"
                controls-position="right"
              />
              <b>积分</b>
            </div>
          </label>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  display: grid;
  width: min(1280px, 100%);
  gap: 12px;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 16px 20px 28px;
}

.settings-head {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 4px 0 8px;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(16px);
}

.settings-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.settings-copy > span {
  color: var(--accent-ink);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
}

.settings-copy h1,
.settings-copy p {
  margin: 0;
}

.settings-copy h1 {
  color: var(--ink);
  font-size: 22px;
  line-height: 1.25;
}

.settings-copy p {
  color: var(--ink-3);
  font-size: 12px;
}

.settings-actions,
.save-state,
.model-config-entry,
.setting-panel > header,
.setting-row,
.points-input {
  display: flex;
  align-items: center;
}

.settings-actions {
  flex: 0 0 auto;
  gap: 8px;
}

.save-state {
  gap: 7px;
  margin-right: 2px;
  color: var(--ink-3);
  font-size: 12px;
}

.save-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.save-state.is-dirty {
  color: var(--warning);
}

.save-state.is-dirty i {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.model-config-entry {
  gap: 12px;
  min-height: 58px;
  padding: 10px 14px;
  border-radius: 8px;
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--accent-soft) 74%, var(--surface)),
    var(--surface) 62%
  );
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--accent) 15%, var(--border));
}

.entry-icon,
.panel-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 7px;
}

.entry-icon {
  width: 34px;
  height: 34px;
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.model-config-entry > div:nth-child(2),
.setting-panel > header > div:last-child,
.setting-row > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.model-config-entry strong,
.setting-panel header strong,
.setting-row strong {
  color: var(--ink);
  font-size: 13px;
}

.model-config-entry span,
.setting-panel header span,
.setting-row small {
  color: var(--ink-3);
  font-size: 11px;
}

.model-config-entry a {
  margin-left: auto;
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 650;
  text-decoration: none;
}

.settings-grid {
  display: grid;
  grid-template-columns: minmax(300px, 620px);
  gap: 12px;
  align-items: start;
}

.setting-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.setting-panel > header {
  gap: 10px;
  min-height: 52px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.panel-icon {
  width: 30px;
  height: 30px;
}

.panel-icon.is-operation {
  color: var(--success);
  background: var(--success-soft);
}

.setting-list {
  display: grid;
}

.setting-row {
  min-height: 68px;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 14px;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border);
}

.setting-row :deep(.el-input-number) {
  width: 138px;
}

.points-input {
  flex: 0 0 auto;
  gap: 6px;
}

.points-input b {
  color: var(--ink-3);
  font-size: 12px;
}

@media (max-width: 980px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .settings-page {
    padding: 12px;
  }

  .settings-head {
    position: static;
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .settings-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .save-state {
    margin-right: auto;
  }

  .model-config-entry {
    align-items: flex-start;
  }

  .model-config-entry a {
    white-space: nowrap;
  }
}
</style>
