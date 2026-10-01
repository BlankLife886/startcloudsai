<script setup lang="ts">
/**
 * AI 电商 · AI 辅助功能：说明每项辅助能力“关联到哪里”——
 * 谁触发、调哪个接口、用哪个模型（在哪改）、限流与计费，并可开关支持开关的项。
 */
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { MagicStick } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";

interface AssistModel {
  id: string;
  name: string;
  provider: string;
  upstreamModel: string;
}

interface AiAssist {
  id: string;
  name: string;
  tool: string;
  description: string;
  trigger: string;
  endpoint: string;
  modelSource: string;
  model: AssistModel | null;
  modelError?: string;
  rateLimit: string;
  billing: string;
  toggleable: boolean;
  enabled: boolean;
  offBehavior?: string;
}

const open = defineModel<boolean>({ required: true });
const items = ref<AiAssist[]>([]);
const loading = ref(false);
const loadError = ref("");
const savingId = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await request<{ items: AiAssist[] }>(
      "/api/v1/admin/ecommerce/ai-assists",
    );
    items.value = data.items || [];
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "读取失败";
  } finally {
    loading.value = false;
  }
}

async function toggle(item: AiAssist, enabled: boolean) {
  const previous = item.enabled;
  item.enabled = enabled;
  savingId.value = item.id;
  try {
    await request(`/api/v1/admin/ecommerce/ai-assists/${item.id}`, {
      method: "PUT",
      body: { enabled },
    });
    ElMessage.success(enabled ? `已开启${item.name}` : `已关闭${item.name}`);
  } catch {
    item.enabled = previous;
  } finally {
    savingId.value = "";
  }
}

watch(open, (value) => {
  if (value) void load();
});
</script>

<template>
  <AdminDialog
    v-model="open"
    title="AI 辅助功能"
    subtitle="电商里用到 AI 分析的辅助能力：由谁触发、调用哪个接口、使用哪个模型"
    :icon="MagicStick"
    width="760px"
    hide-footer
  >
    <div v-loading="loading" class="ai-assists">
      <el-alert
        v-if="loadError"
        type="error"
        :title="loadError"
        :closable="false"
        show-icon
      />
      <el-alert
        v-else-if="items[0]?.modelError"
        type="warning"
        :title="items[0].modelError"
        :closable="false"
        show-icon
      />

      <article v-for="item in items" :key="item.id" class="ai-assist">
        <header class="ai-assist__head">
          <div class="ai-assist__title">
            <strong>{{ item.name }}</strong>
            <el-tag size="small" effect="plain">{{ item.tool }}</el-tag>
          </div>
          <el-switch
            v-if="item.toggleable"
            :model-value="item.enabled"
            :loading="savingId === item.id"
            inline-prompt
            active-text="开"
            inactive-text="关"
            :aria-label="`${item.name}开关`"
            @change="(value: string | number | boolean) => toggle(item, Boolean(value))"
          />
          <el-tag v-else size="small" type="info">常开</el-tag>
        </header>
        <p class="ai-assist__desc">{{ item.description }}</p>
        <dl class="ai-assist__facts">
          <dt>触发</dt>
          <dd>{{ item.trigger }}</dd>
          <dt>接口</dt>
          <dd><code>{{ item.endpoint }}</code></dd>
          <dt>模型</dt>
          <dd>
            <template v-if="item.model">
              <strong>{{ item.model.name }}</strong>
              <span class="ai-assist__muted">
                · 供应商 {{ item.model.provider || "—" }} · 上游
                <code>{{ item.model.upstreamModel || item.model.id }}</code>
              </span>
            </template>
            <span v-else class="ai-assist__warn">未配置</span>
          </dd>
          <dt>在哪改</dt>
          <dd>{{ item.modelSource }}</dd>
          <dt>限流</dt>
          <dd>{{ item.rateLimit }}</dd>
          <dt>计费</dt>
          <dd>{{ item.billing }}</dd>
          <template v-if="item.offBehavior">
            <dt>关闭后</dt>
            <dd>{{ item.offBehavior }}</dd>
          </template>
        </dl>
      </article>
    </div>
  </AdminDialog>
</template>

<style scoped>
.ai-assists {
  display: grid;
  gap: 12px;
  min-height: 120px;
}
.ai-assist {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}
.ai-assist__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-assist__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-assist__title strong {
  font-size: 14px;
}
.ai-assist__desc {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.ai-assist__facts {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: 12.5px;
}
.ai-assist__facts dt {
  color: var(--el-text-color-secondary);
}
.ai-assist__facts dd {
  margin: 0;
  color: var(--el-text-color-primary);
  word-break: break-word;
}
.ai-assist__facts code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  font-size: 12px;
}
.ai-assist__muted {
  color: var(--el-text-color-secondary);
}
.ai-assist__warn {
  color: var(--el-color-warning);
  font-weight: 600;
}
</style>
