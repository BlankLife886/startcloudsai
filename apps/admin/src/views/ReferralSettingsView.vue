<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import { request } from "@/request";
import ReferralRecords from "./ReferralRecords.vue";

type ReferralMode = "percent" | "fixed";

interface ReferralConfig {
	version?: number;
  enabled: boolean;
  settlementPaused?: boolean;
  mode: ReferralMode;
  percent: number;
  fixedPoints: number;
  minimumAmountCents: number;
  dailyLimitPoints: number;
  firstRewardOnly: boolean;
}

const form = reactive<ReferralConfig>({
  enabled: false,
  settlementPaused: true,
  mode: "percent",
  percent: 10,
  fixedPoints: 10,
  minimumAmountCents: 100,
  dailyLimitPoints: 1000,
  firstRewardOnly: false,
});
const activeTab = ref<"settings" | "relations" | "rewards">("settings");
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const savedSignature = ref("");
let requestSequence = 0;
let loadController: AbortController | undefined;

const signature = () => JSON.stringify(form);
const minimumAmountYuan = computed({get:()=>form.minimumAmountCents / 100,set:(value:number | undefined)=>{form.minimumAmountCents=Math.round(Number(value || 0) * 100)}});
const isDirty = computed(
  () => Boolean(savedSignature.value) && signature() !== savedSignature.value,
);

const previewPoints = computed(() => {
  if (form.mode === "fixed") return form.fixedPoints;
  return Math.floor((1000 * form.percent) / 100);
});

function hydrate(cfg: ReferralConfig) {
  form.enabled = Boolean(cfg.enabled);
  form.settlementPaused = cfg.settlementPaused !== false;
  form.mode = cfg.mode === "fixed" ? "fixed" : "percent";
  form.percent = Number(cfg.percent || 10);
  form.fixedPoints = Number(cfg.fixedPoints || 10);
  form.version = cfg.version;
  form.minimumAmountCents = Number(cfg.minimumAmountCents ?? 100);
  form.dailyLimitPoints = Number(cfg.dailyLimitPoints ?? 1000);
  form.firstRewardOnly = Boolean(cfg.firstRewardOnly);
  savedSignature.value = signature();
}

async function load() {
  if (loading.value || saving.value) return;
  const sequence = ++requestSequence;
  const controller = new AbortController();
  loadController = controller;
  loading.value = true;
  error.value = "";
  try {
    const config = await request<ReferralConfig>("/api/v1/admin/referral-config", { silent: true, signal: controller.signal });
    if (controller.signal.aborted || sequence !== requestSequence) return;
    hydrate(config);
    if(form.version !== 3) error.value = "后端尚未支持月度结算，请先完成服务升级和数据库迁移";
  } catch (e) {
    if (controller.signal.aborted || sequence !== requestSequence) return;
    error.value = e instanceof Error ? e.message : "读取失败";
  } finally {
    if (sequence === requestSequence) {
      loading.value = false;
      loadController = undefined;
    }
  }
}

async function save() {
  if (loading.value || saving.value || error.value) return;
  const sequence = ++requestSequence;
  saving.value = true;
  try {
    const config = await request<ReferralConfig>("/api/v1/admin/referral-config", {
      method: "PUT",
      body: { ...form },
    });
    if (sequence !== requestSequence) return;
    hydrate(config);
    ElMessage.success("邀请返利配置已保存");
  } catch {
    /* request already surfaces the error */
  } finally {
    if (sequence === requestSequence) saving.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  requestSequence += 1;
  loadController?.abort();
});
</script>

<template>
  <div v-loading="loading" class="referral-page">
    <el-tabs v-model="activeTab"><el-tab-pane label="规则配置" name="settings"/><el-tab-pane label="邀请关系" name="relations"/><el-tab-pane label="返利与对账" name="rewards"/></el-tabs>
    <ReferralRecords v-if="activeTab === 'relations' || activeTab === 'rewards'" :mode="activeTab"/>
    <header v-if="activeTab === 'settings'" class="referral-toolbar">
      <div class="referral-status" :class="{ 'is-on': form.enabled }">
        <span>活动状态</span>
        <el-switch v-model="form.enabled" :disabled="loading || saving || !!error" active-text="启用" />
      </div>
      <p class="referral-toolbar__hint">
        {{ form.settlementPaused ? "自动月结已暂停，已有返利记录保留" : form.enabled ? "充值计提返利，每月底统一结算到账" : "关闭后停止新绑定和新计提，既有待结算继续处理" }}
      </p>
      <div class="referral-toolbar__actions">
        <em v-if="isDirty">未保存</em>
        <el-button :icon="Refresh" :loading="loading" :disabled="loading || saving" @click="load">刷新</el-button>
        <el-button type="primary" :loading="saving" :disabled="loading || !!error" @click="save">
          保存配置
        </el-button>
      </div>
    </header>

    <el-alert v-if="error && activeTab === 'settings'" :title="error" type="error" :closable="false" />

    <div v-if="activeTab === 'settings'" class="referral-board" :class="{ 'is-disabled': loading || saving || !!error }">
      <section class="referral-modes" aria-label="返利模式">
        <button
          type="button"
          class="referral-mode"
          :class="{ 'is-active': form.mode === 'percent' }"
          :disabled="loading || saving || !!error"
          @click="form.mode = 'percent'"
        >
          <em>按比例</em>
          <strong class="tnum">{{ form.percent }}%</strong>
          <small>只按充值基础积分返还，不含赠送</small>
        </button>
        <button
          type="button"
          class="referral-mode"
          :class="{ 'is-active': form.mode === 'fixed' }"
          :disabled="loading || saving || !!error"
          @click="form.mode = 'fixed'"
        >
          <em>固定积分</em>
          <strong class="tnum">{{ form.fixedPoints }}</strong>
          <small>每笔合格充值定额计提，月底到账</small>
        </button>
      </section>

      <section class="referral-editor">
        <label v-if="form.mode === 'percent'">
          <span>充值基础积分返还比例（%）</span>
          <el-input-number
            v-model="form.percent"
            :min="1"
            :max="100"
            :precision="0"
            :disabled="loading || saving || !!error"
          />
        </label>
        <label v-else>
          <span>每笔充值返还积分</span>
          <el-input-number
            v-model="form.fixedPoints"
            :min="1"
            :max="10000"
            :precision="0"
            :disabled="loading || saving || !!error"
          />
        </label>
        <label><span>最低实付金额（元，0 不限制）</span><el-input-number v-model="minimumAmountYuan" :min="0" :max="1000000" :precision="2" :disabled="loading || saving || !!error"/></label>
        <label><span>每位邀请人每日计提上限（积分，0 不限制）</span><el-input-number v-model="form.dailyLimitPoints" :min="0" :max="10000000" :precision="0" :disabled="loading || saving || !!error"/></label>
        <el-checkbox v-model="form.firstRewardOnly" :disabled="loading || saving || !!error">每位好友仅奖励一次</el-checkbox>
        <article class="referral-preview">
          <small>基础返利估算（实际受门槛、次数和日上限约束）</small>
          <p>
            好友充值 <b class="tnum">1,000</b> 基础积分，邀请人获得
            <b class="tnum">{{ previewPoints.toLocaleString("zh-CN") }}</b> 积分
          </p>
        </article>
      </section>

      <aside class="referral-notes">
        <h2>发放边界</h2>
        <ul>
          <li>仅支付验证通过的充值积分包，首次完成时记入待结算</li>
          <li>北京时间自然月结算，次月1日00:05起汇总上月返利到账</li>
          <li>按比例只算基础积分，向下取整；固定模式每笔定额</li>
          <li>零元、注册赠送、兑换码、订阅和每日额度不返利</li>
          <li>人工完成且无支付证明的订单不发放</li>
          <li>关闭活动不新增计提，但不取消既有待结算；历史未计提订单不补发</li>
          <li>日上限按计提日计算，超出部分不补发；取消或冲正不恢复额度和获奖次数</li>
          <li>有待追回返利的邀请人暂停获得新奖励，余额充足后须人工重试追回</li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.referral-page {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}
.referral-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.referral-status {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 650;
}
.referral-status.is-on {
  border-color: color-mix(in srgb, var(--success) 28%, var(--border));
  background: var(--success-soft);
  color: var(--success);
}
.referral-toolbar__hint {
  margin: 0;
  min-width: 0;
  flex: 1 1 220px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.4;
}
.referral-toolbar__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.referral-toolbar__actions em {
  color: var(--warning);
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
}
.referral-toolbar__actions :deep(.el-button) {
  min-width: 88px;
  height: 36px;
  padding: 0 16px;
}
.referral-board {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}
.referral-board.is-disabled {
  pointer-events: none;
  opacity: 0.64;
}
.referral-modes {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.referral-mode {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  color: inherit;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.referral-mode em {
  color: var(--ink-3);
  font-size: 13px;
  font-style: normal;
  font-weight: 700;
}
.referral-mode strong {
  color: var(--ink);
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}
.referral-mode small {
  color: var(--ink-3);
  font-size: 13px;
}
.referral-mode.is-active {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background:
    linear-gradient(
      160deg,
      color-mix(in srgb, var(--accent-soft) 80%, var(--surface)),
      var(--surface) 70%
    );
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}
.referral-mode.is-active em,
.referral-mode.is-active strong {
  color: var(--accent-ink, var(--accent));
}
.referral-editor,
.referral-notes {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
  padding: 22px 24px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.referral-editor label {
  display: grid;
  gap: 10px;
}
.referral-editor span {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 650;
}
.referral-editor :deep(.el-input-number) {
  width: 100%;
}
.referral-editor :deep(.el-input__wrapper) {
  padding: 8px 16px;
  box-shadow: none;
  background: var(--surface-2);
}
.referral-editor :deep(.el-input__inner) {
  height: 56px;
  font-size: 28px;
  font-weight: 780;
  letter-spacing: -0.03em;
}
.referral-preview {
  display: grid;
  gap: 6px;
  margin-top: auto;
  padding: 16px 18px;
  border-radius: 14px;
  background: var(--surface-2);
}
.referral-preview small,
.referral-notes h2 {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}
.referral-preview p {
  margin: 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 650;
  line-height: 1.5;
}
.referral-preview b {
  font-weight: 800;
}
.referral-notes ul {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.referral-notes li {
  position: relative;
  padding-left: 16px;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
}
.referral-notes li::before {
  content: "";
  position: absolute;
  top: 8px;
  left: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
@media (max-width: 960px) {
  .referral-page {
    height: auto;
    overflow: visible;
  }
  .referral-board,
  .referral-modes {
    grid-template-columns: 1fr;
  }
}
</style>
