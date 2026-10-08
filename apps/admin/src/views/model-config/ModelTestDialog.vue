<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { VideoPlay } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";
import { CHAT_API_OPTIONS, IMAGE_RESPONSE_OPTIONS, type RequestCompat } from "./providerTypes";

/** The model under test, as currently configured on the page (may be unsaved). */
export interface ModelTestTarget {
  name: string;
  providerId: string;
  providerName: string;
  providerAdapter: string;
  upstreamModel: string;
  kind: "chat" | "image";
  compat?: RequestCompat | null;
  /** Reasoning levels enabled on the model, marked in the picker. */
  supportedReasoningEfforts?: string[];
}

interface TestStep {
  name: string;
  ok: boolean;
  optional?: boolean;
  latencyMs: number;
  detail?: string;
  image?: string;
}

interface TestResponse {
  ok: boolean;
  provider: string;
  route: string;
  result: { model: string; kind: string; steps: TestStep[] };
}

// Every level the platform can send as reasoning_effort; any can be tried,
// including ones not yet enabled on the model.
const REASONING_OPTIONS = [
  { value: "none", label: "关闭" },
  { value: "minimal", label: "极低" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
  { value: "max", label: "最大" },
];

const DEFAULT_PROMPTS = {
  chat: "用一句中文介绍你自己，并说出你的模型名称。",
  image: "一只戴着宇航员头盔的橘猫坐在月球表面，远处是地球，写实摄影风格",
  edit: "保持这只猫不变，把背景改成夜晚的城市霓虹街道",
};

const props = defineProps<{ modelValue: boolean; target: ModelTestTarget | null }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const prompt = ref("");
const editPrompt = ref(DEFAULT_PROMPTS.edit);
const withEdit = ref(true);
const withTools = ref(true);
const reasoningEffort = ref("");
const testedEffort = ref("");
const running = ref(false);
const response = ref<TestResponse | null>(null);
const failure = ref("");
const startedAt = ref(0);
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

watch(
  () => [props.modelValue, props.target] as const,
  ([open, target]) => {
    if (!open || !target) return;
    prompt.value = target.kind === "image" ? DEFAULT_PROMPTS.image : DEFAULT_PROMPTS.chat;
    editPrompt.value = DEFAULT_PROMPTS.edit;
    reasoningEffort.value = "";
    response.value = null;
    failure.value = "";
  },
);

const isImage = computed(() => props.target?.kind === "image");
const enabledEfforts = computed(() => new Set(props.target?.supportedReasoningEfforts || []));
function effortLabel(value: string) {
  return value ? REASONING_OPTIONS.find((option) => option.value === value)?.label || value : "模型默认";
}
const chatAPILabel = computed(() => {
  if (props.target?.providerAdapter !== "gemini" || isImage.value) return "";
  const value = props.target.compat?.chatApi || "";
  return CHAT_API_OPTIONS.find((option) => option.value === value)?.label || "";
});
const imageResponseLabel = computed(() => {
  if (props.target?.providerAdapter !== "gemini" || !isImage.value) return "";
  const value = props.target.compat?.imageResponse || "";
  return IMAGE_RESPONSE_OPTIONS.find((option) => option.value === value)?.label || "";
});

function imageSrc(base64: string) {
  const mime = base64.startsWith("/9j/") ? "image/jpeg" : base64.startsWith("UklGR") ? "image/webp" : "image/png";
  return `data:${mime};base64,${base64}`;
}

async function run() {
  const target = props.target;
  if (!target || running.value) return;
  running.value = true;
  response.value = null;
  failure.value = "";
  startedAt.value = Date.now();
  elapsed.value = 0;
  testedEffort.value = isImage.value ? "" : reasoningEffort.value;
  timer = setInterval(() => (elapsed.value = Math.round((Date.now() - startedAt.value) / 1000)), 500);
  try {
    response.value = await request<TestResponse>("/api/v1/admin/model-config/model-tests", {
      method: "POST",
      silent: true,
      body: {
        providerId: target.providerId,
        upstreamModel: target.upstreamModel,
        kind: target.kind,
        compat: target.compat || null,
        prompt: prompt.value,
        editPrompt: editPrompt.value,
        edit: isImage.value && withEdit.value,
        skipTools: !isImage.value && !withTools.value,
        reasoningEffort: isImage.value ? "" : reasoningEffort.value,
      },
    });
  } catch (error) {
    failure.value = error instanceof Error ? error.message : "请求失败";
  } finally {
    clearInterval(timer);
    running.value = false;
  }
}
</script>

<template>
  <AdminDialog
    v-model="visible"
    :title="target ? `测试 ${target.name}` : '测试模型'"
    :subtitle="target ? `${target.providerName} · ${target.upstreamModel} · ${isImage ? '生图' : '对话'}` : ''"
    :icon="VideoPlay"
    width="min(1180px, calc(100% - 24px))"
    hide-footer
  >
    <div v-if="target" class="mt">
      <section class="mt-input">
        <label class="mt-field">
          <span>{{ isImage ? "文生图提示词" : "对话内容" }}</span>
          <el-input v-model="prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" :aria-label="isImage ? '文生图提示词' : '对话内容'" />
        </label>
        <template v-if="isImage">
          <el-checkbox v-model="withEdit">再用生成的图测试图生图</el-checkbox>
          <label v-if="withEdit" class="mt-field">
            <span>图生图提示词</span>
            <el-input v-model="editPrompt" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" aria-label="图生图提示词" />
          </label>
        </template>
        <template v-else>
          <label class="mt-field">
            <span>推理档位 <small class="mt-hint">作为 reasoning_effort 发送；标「已开启」的是模型上勾选的档位</small></span>
            <el-select v-model="reasoningEffort" aria-label="推理档位">
              <el-option label="模型默认（不传）" value="" />
              <el-option
                v-for="option in REASONING_OPTIONS"
                :key="option.value"
                :label="`${option.label} · ${option.value}${enabledEfforts.has(option.value) ? ' · 已开启' : ''}`"
                :value="option.value"
              />
            </el-select>
          </label>
          <el-checkbox v-model="withTools">同时测试工具调用（Agent 模式需要）</el-checkbox>
        </template>
        <p class="mt-note">
          使用已保存的服务商地址和 Key，以及这个模型当前的类型和兼容规则（包括尚未保存的修改）。会真实调用上游并产生费用。
          <template v-if="imageResponseLabel"><br />图片返回方式：{{ imageResponseLabel }}（在模型的「请求兼容规则」里修改）</template>
          <template v-if="chatAPILabel"><br />对话接口：{{ chatAPILabel }}（在模型的「请求兼容规则」里修改）</template>
        </p>
        <el-button type="primary" :icon="VideoPlay" :loading="running" @click="run">
          {{ running ? `测试中… ${elapsed}s` : "开始测试" }}
        </el-button>
      </section>

      <section class="mt-output" aria-live="polite">
        <p v-if="failure" class="mt-status is-fail">✕ {{ failure }}</p>
        <template v-else-if="response">
          <p class="mt-status" :class="response.ok ? 'is-ok' : 'is-fail'">
            {{ response.ok ? "✓ 通过" : "✕ 未通过" }}
            <small>{{ response.provider }} · {{ response.route }}<template v-if="!isImage"> · 推理档位：{{ effortLabel(testedEffort) }}</template></small>
          </p>
          <div v-for="step in response.result.steps" :key="step.name" class="mt-step" :class="step.ok ? 'is-ok' : step.optional ? 'is-warn' : 'is-fail'">
            <header>
              <strong>{{ step.ok ? "✓" : "✕" }} {{ step.name }}<em v-if="step.optional && !step.ok">（可选）</em></strong>
              <span class="tnum">{{ (step.latencyMs / 1000).toFixed(1) }}s</span>
            </header>
            <img v-if="step.image" :src="imageSrc(step.image)" :alt="`${step.name}结果`" />
            <p v-if="step.detail">{{ step.detail }}</p>
          </div>
        </template>
        <p v-else-if="!running" class="mt-empty">还没有测试结果</p>
        <p v-else class="mt-empty">正在调用上游…生图通常需要 20–60 秒</p>
      </section>
    </div>
  </AdminDialog>
</template>

<style scoped>
.mt {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 20px;
  min-height: 360px;
}
.mt-input {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mt-input .el-button {
  align-self: flex-start;
}
.mt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mt-field > span {
  font-size: 13px;
  font-weight: 600;
}
.mt-hint {
  margin-left: 6px;
  font-weight: 400;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mt-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.mt-output {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
  overflow: auto;
  max-height: 70vh;
}
.mt-status {
  margin: 0;
  font-weight: 600;
}
.mt-status small {
  margin-left: 8px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
.mt-status.is-ok,
.mt-step.is-ok strong {
  color: var(--el-color-success);
}
.mt-status.is-fail,
.mt-step.is-fail strong {
  color: var(--el-color-danger);
}
.mt-step.is-warn strong {
  color: var(--el-color-warning);
}
.mt-step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--el-bg-color);
}
.mt-step header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.mt-step em {
  font-style: normal;
  font-weight: 400;
}
.mt-step p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.mt-step img {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  align-self: flex-start;
  border-radius: 8px;
}
.mt-empty {
  margin: auto;
  color: var(--el-text-color-secondary);
}
@media (max-width: 760px) {
  .mt {
    grid-template-columns: 1fr;
  }
}
</style>
