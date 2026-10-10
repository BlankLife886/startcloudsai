<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CopyDocument, Delete, Picture, Plus, VideoPlay } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";
import {
  IMAGE_QUALITY_MODE_OPTIONS,
  IMAGE_SIZE_MODE_OPTIONS,
  type ImageParamProfile,
  type ImageParamRules,
  type RequestCompat,
} from "./providerTypes";
import {
  imageParamProfiles,
  loadImageParamProfiles,
  resetImageParamProfiles,
  saveImageParamProfiles,
} from "./imageParamProfiles";

interface ProfileModel {
  id: string;
  name: string;
  providerId: string;
  upstreamModel: string;
  kind: string;
  compat?: RequestCompat | null;
}
interface ProfileProvider {
  id: string;
  name: string;
  adapter: string;
}

const props = defineProps<{ modelValue: boolean; models: ProfileModel[]; providers: ProfileProvider[] }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const TIERS = ["1K", "2K", "4K"] as const;
const LONG_SIDE: Record<string, number> = { "1K": 1024, "2K": 2048, "4K": 3840 };
const QUALITIES = ["low", "medium", "high", "auto"] as const;
const PLATFORM_RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9", "9:21", "auto"];
const SIZE_MODE_HINTS: Record<string, string> = {
  size: "原样发送 size=宽x高",
  aspect_ratio: "只发比例，不发尺寸",
  aspect_tier: "发比例，再发一个分辨率档位",
  none: "尺寸交给上游默认",
};
const DROP_LABELS: Record<string, string> = {
  background: "背景（透明 / 不透明）",
  output_format: "输出格式",
  output_compression: "压缩率",
  moderation: "审核强度",
  style: "风格",
  input_fidelity: "参考图保真度",
  user: "终端用户标识",
};

const working = ref<ImageParamProfile[]>([]);
const selected = ref(0);
const saving = ref(false);
const loading = ref(false);

watch(visible, async (open) => {
  if (!open) return;
  loading.value = true;
  await loadImageParamProfiles(true);
  loading.value = false;
  working.value = editable(imageParamProfiles.profiles);
  selected.value = 0;
  resetTest();
});

/** Deep copy with the list fields the form binds to always present. */
function editable(profiles: ImageParamProfile[]): ImageParamProfile[] {
  return (JSON.parse(JSON.stringify(profiles)) as ImageParamProfile[]).map((profile) => {
    profile.rules.drop ||= [];
    profile.rules.aspectRatios ||= [];
    profile.capabilities ||= {};
    profile.capabilities.resolutions ||= [];
    profile.capabilities.qualities ||= [];
    return profile;
  });
}

const current = computed(() => working.value[selected.value]);
const usesAspect = computed(() => current.value?.rules.sizeMode === "aspect_ratio" || current.value?.rules.sizeMode === "aspect_tier");

function usersOf(profileId: string) {
  return props.models.filter((model) => model.compat?.imageParams === profileId);
}
function summary(profile: ImageParamProfile) {
  const size = IMAGE_SIZE_MODE_OPTIONS.find((option) => option.value === profile.rules.sizeMode)?.label || "";
  const quality = { send: "画质原样", map: "画质换值", drop: "不发画质" }[profile.rules.qualityMode] || "";
  return `${size} · ${quality}`;
}

function blankProfile(): ImageParamProfile {
  return {
    id: "", name: "新档案", description: "",
    rules: { sizeMode: "size", qualityMode: "send", drop: [], aspectRatios: [] },
    capabilities: { resolutions: [], qualities: [] },
  };
}

function addProfile(copyOf?: ImageParamProfile) {
  const profile = copyOf ? (JSON.parse(JSON.stringify(copyOf)) as ImageParamProfile) : blankProfile();
  if (copyOf) {
    profile.id = `${copyOf.id}-copy`;
    profile.name = `${copyOf.name}（副本）`;
  }
  working.value.push(profile);
  selected.value = working.value.length - 1;
}

async function removeProfile(index: number) {
  const profile = working.value[index];
  const users = usersOf(profile.id);
  if (users.length) {
    ElMessage.warning(`「${profile.name}」还有 ${users.length} 个模型在用，先给它们换一个档案`);
    return;
  }
  try {
    await ElMessageBox.confirm(`删除档案「${profile.name}」？点「保存档案」后生效。`, "删除档案", { type: "warning" });
  } catch {
    return;
  }
  working.value.splice(index, 1);
  selected.value = Math.max(0, Math.min(selected.value, working.value.length - 1));
}

function mapValue(map: Record<string, string> | undefined, key: string) {
  return map?.[key] || "";
}
function setMapValue(field: "tierValues" | "qualityMap", key: string, value: string) {
  const rules = current.value!.rules;
  const next = { ...(rules[field] || {}) };
  if (value.trim()) next[key] = value.trim();
  else delete next[key];
  rules[field] = next;
}
function setMaxReference(value: number | undefined | null) {
  current.value!.capabilities.maxReferenceImages = typeof value === "number" ? value : null;
}

// ---- platform request shared by the preview and the real test ------------

const platform = reactive({ resolution: "2K", ratio: "16:9", quality: "high" });

/** Mirrors the platform's size derivation: long side 1024/2048/3840, multiples of 16. */
const platformSize = computed(() => {
  if (platform.ratio === "auto") return "auto";
  const [w, h] = platform.ratio.split(":").map(Number);
  const long = LONG_SIDE[platform.resolution];
  const round = (value: number) => Math.max(16, Math.round(value / 16) * 16);
  return w >= h ? `${long}x${round((long * h) / w)}` : `${round((long * w) / h)}x${long}`;
});

const platformBody = computed(() => ({
  prompt: "…", size: platformSize.value, quality: platform.quality,
  background: "opaque", output_format: "png", n: 1,
}));

// Mirrors the server's ApplyImageParamRules.
function applyRules(rules: ImageParamRules, input: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...input };
  const size = String(payload.size || "");
  if (rules.sizeMode !== "size") delete payload.size;
  if (rules.sizeMode === "aspect_ratio" || rules.sizeMode === "aspect_tier") {
    const field = rules.aspectField || "aspect_ratio";
    const allowed = rules.aspectRatios || [];
    if (size === "auto") {
      if (allowed.includes("auto")) payload[field] = "auto";
    } else {
      const [width, height] = size.split("x").map(Number);
      if (!allowed.length) {
        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        const divisor = gcd(width, height);
        payload[field] = `${width / divisor}:${height / divisor}`;
      } else {
        let best = "";
        let bestDistance = Infinity;
        for (const ratio of allowed) {
          const [w, h] = ratio.split(":").map(Number);
          if (!w || !h) continue;
          const distance = Math.abs(Math.log(width / height) - Math.log(w / h));
          if (distance < bestDistance) [best, bestDistance] = [ratio, distance];
        }
        if (best) payload[field] = best;
      }
      if (rules.sizeMode === "aspect_tier" && rules.tierField) {
        const edge = Math.max(width, height);
        for (let index = edge > 2880 ? 2 : edge > 1536 ? 1 : 0; index >= 0; index--) {
          const value = rules.tierValues?.[TIERS[index]];
          if (value) {
            payload[rules.tierField] = value;
            break;
          }
        }
      }
    }
  }
  if (rules.qualityMode === "drop") delete payload.quality;
  if (rules.qualityMode === "map") {
    const mapped = rules.qualityMap?.[String(payload.quality)];
    if (mapped) payload.quality = mapped;
    else delete payload.quality;
  }
  for (const field of rules.drop || []) delete payload[field];
  return payload;
}

const upstreamBody = computed(() => (current.value ? applyRules(current.value.rules, platformBody.value) : {}));
const removedFields = computed(() => Object.keys(platformBody.value).filter((key) => !(key in upstreamBody.value)));
const addedFields = computed(() => Object.keys(upstreamBody.value).filter((key) => !(key in platformBody.value)));

// ---- real test with the unsaved draft --------------------------------------

interface TestStep {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  image?: string;
}

const testModels = computed(() =>
  props.models
    .filter((model) => model.kind === "image")
    .filter((model) => (props.providers.find((provider) => provider.id === model.providerId)?.adapter || "openai") === "openai")
    .map((model) => ({
      ...model,
      label: `${model.name} · ${props.providers.find((provider) => provider.id === model.providerId)?.name || model.providerId}`,
    })),
);
const test = reactive({
  modelId: "",
  prompt: "一只橘猫坐在窗台上看雨，写实摄影",
  edit: false,
  running: false,
  error: "",
  steps: [] as TestStep[],
  sentSize: "",
  dims: {} as Record<number, string>,
});

function resetTest() {
  test.error = "";
  test.steps = [];
  test.dims = {};
  if (!testModels.value.some((model) => model.id === test.modelId)) test.modelId = testModels.value[0]?.id || "";
}

async function runTest() {
  const model = testModels.value.find((item) => item.id === test.modelId);
  if (!model || !current.value || test.running) return;
  test.running = true;
  test.error = "";
  test.steps = [];
  test.dims = {};
  test.sentSize = platformSize.value;
  try {
    const response = await request<{ ok: boolean; result: { steps: TestStep[] } }>("/api/v1/admin/model-config/model-tests", {
      method: "POST",
      silent: true,
      body: {
        providerId: model.providerId,
        upstreamModel: model.upstreamModel,
        kind: "image",
        compat: { ...(model.compat || {}), imageParams: current.value.id || "draft" },
        imageParamRules: current.value.rules,
        prompt: test.prompt,
        size: platformSize.value,
        quality: platform.quality,
        edit: test.edit,
      },
    });
    test.steps = response.result.steps;
  } catch (error) {
    test.error = error instanceof Error ? error.message : "请求失败";
  } finally {
    test.running = false;
  }
}

function imageFormat(base64: string) {
  return base64.startsWith("/9j/") ? "JPEG" : base64.startsWith("UklGR") ? "WebP" : "PNG";
}
function imageSrc(base64: string) {
  return `data:image/${imageFormat(base64).toLowerCase()};base64,${base64}`;
}
function imageSizeText(base64: string) {
  const bytes = (base64.length * 3) / 4;
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
function onImageLoad(index: number, event: Event) {
  const image = event.target as HTMLImageElement;
  test.dims[index] = `${image.naturalWidth}×${image.naturalHeight}`;
}

// ---- save -----------------------------------------------------------------

async function save() {
  saving.value = true;
  try {
    await saveImageParamProfiles(working.value);
    working.value = editable(imageParamProfiles.profiles);
    ElMessage.success("档案已保存；用到这些档案的模型已同步更新");
  } finally {
    saving.value = false;
  }
}

async function reset() {
  try {
    await ElMessageBox.confirm("恢复为内置的 OpenAI 标准、Grok 原生、Gemini 原生三个档案？自定义的档案会被删除。", "恢复默认", { type: "warning" });
  } catch {
    return;
  }
  saving.value = true;
  try {
    await resetImageParamProfiles();
    working.value = editable(imageParamProfiles.profiles);
    selected.value = 0;
    ElMessage.success("已恢复默认档案");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AdminDialog
    v-model="visible"
    title="生图参数档案"
    subtitle="平台统一的尺寸、画质等参数，按档案换成各家上游认的字段；模型在「请求兼容规则」里选择档案"
    :icon="Picture"
    width="min(1480px, calc(100vw - 32px))"
    panel-class="ipd-dialog"
    nested-scroll
    show-confirm
    :confirm-loading="saving"
    confirm-text="保存档案"
    cancel-text="关闭"
    @confirm="save"
  >
    <div v-loading="loading" class="ipd">
      <!-- 档案列表 -->
      <aside class="ipd-col ipd-list" aria-label="档案列表">
        <header class="ipd-col__head">
          <strong>档案</strong>
          <el-button size="small" :icon="Plus" @click="addProfile()">新建</el-button>
        </header>
        <button
          v-for="(profile, index) in working"
          :key="index"
          type="button"
          class="ipd-item"
          :class="{ 'is-active': index === selected }"
          @click="selected = index; resetTest()"
        >
          <span class="ipd-item__name">{{ profile.name || "未命名" }}</span>
          <span class="ipd-item__id mono">{{ profile.id || "未填 ID" }}</span>
          <span class="ipd-item__meta">{{ summary(profile) }}</span>
          <span class="ipd-item__usage" :class="{ 'is-used': usersOf(profile.id).length }">
            {{ usersOf(profile.id).length ? `${usersOf(profile.id).length} 个模型在用` : "未被使用" }}
          </span>
        </button>
        <el-button v-if="imageParamProfiles.customized" class="ipd-reset" text @click="reset">恢复默认档案</el-button>
      </aside>

      <!-- 档案编辑 -->
      <el-form v-if="current" label-position="top" class="ipd-col ipd-form">
        <header class="ipd-form__head">
          <div>
            <h3>{{ current.name || "未命名" }}</h3>
            <p><span class="mono">{{ current.id || "未填 ID" }}</span> · {{ summary(current) }} · {{ usersOf(current.id).length ? `${usersOf(current.id).length} 个模型在用` : "未被使用" }}</p>
          </div>
          <div class="ipd-form__actions">
            <el-button :icon="CopyDocument" @click="addProfile(current)">复制</el-button>
            <el-button type="danger" plain :icon="Delete" @click="removeProfile(selected)">删除</el-button>
          </div>
        </header>

        <section class="ipd-section">
          <h4><span>1</span>基本信息</h4>
          <div class="ipd-grid">
            <el-form-item label="名称"><el-input v-model="current.name" aria-label="档案名称" /></el-form-item>
            <el-form-item label="档案 ID"><el-input v-model="current.id" aria-label="档案 ID" placeholder="小写字母、数字、- 或 _" /></el-form-item>
            <el-form-item label="说明" class="is-full">
              <el-input v-model="current.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" aria-label="档案说明" />
            </el-form-item>
            <el-form-item label="正在使用的模型" class="is-full">
              <div class="ipd-chips">
                <el-tag v-for="model in usersOf(current.id)" :key="model.id" size="small" type="info">{{ model.name }}</el-tag>
                <span v-if="!usersOf(current.id).length" class="ipd-muted">暂无。在模型编辑窗口的「请求兼容规则」里选择这个档案。</span>
              </div>
            </el-form-item>
          </div>
        </section>

        <section class="ipd-section">
          <h4><span>2</span>尺寸怎么发</h4>
          <el-radio-group v-model="current.rules.sizeMode" class="ipd-modes" aria-label="尺寸写法">
            <el-radio-button v-for="option in IMAGE_SIZE_MODE_OPTIONS" :key="option.value" :value="option.value">
              <strong>{{ option.label }}</strong><small>{{ SIZE_MODE_HINTS[option.value] }}</small>
            </el-radio-button>
          </el-radio-group>
          <div v-if="usesAspect" class="ipd-grid">
            <el-form-item label="比例字段名"><el-input v-model="current.rules.aspectField" placeholder="aspect_ratio" aria-label="比例字段名" /></el-form-item>
            <el-form-item v-if="current.rules.sizeMode === 'aspect_tier'" label="分辨率字段名">
              <el-input v-model="current.rules.tierField" placeholder="resolution 或 image_size" aria-label="分辨率字段名" />
            </el-form-item>
            <el-form-item label="上游接受的比例（就近取值；留空则发送精确比例）" class="is-full">
              <el-select v-model="current.rules.aspectRatios" multiple filterable allow-create default-first-option placeholder="输入后回车，如 16:9、auto" aria-label="上游接受的比例" />
            </el-form-item>
            <el-form-item v-if="current.rules.sizeMode === 'aspect_tier'" label="分辨率档位取值（留空表示上游不支持该档，会降到下一档）" class="is-full">
              <div class="ipd-pairs">
                <label v-for="tier in TIERS" :key="tier">
                  <span>{{ tier }}</span>
                  <el-input :model-value="mapValue(current.rules.tierValues, tier)" :aria-label="`${tier} 档位取值`" placeholder="不支持" @update:model-value="(value: string) => setMapValue('tierValues', tier, value)" />
                </label>
              </div>
            </el-form-item>
          </div>
        </section>

        <section class="ipd-section">
          <h4><span>3</span>画质怎么发</h4>
          <el-radio-group v-model="current.rules.qualityMode" aria-label="画质处理方式">
            <el-radio-button v-for="option in IMAGE_QUALITY_MODE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
          </el-radio-group>
          <div v-if="current.rules.qualityMode === 'map'" class="ipd-pairs ipd-pairs--four">
            <label v-for="quality in QUALITIES" :key="quality">
              <span>{{ quality }}</span>
              <el-input :model-value="mapValue(current.rules.qualityMap, quality)" :aria-label="`${quality} 对应值`" placeholder="不发送" @update:model-value="(value: string) => setMapValue('qualityMap', quality, value)" />
            </label>
          </div>
        </section>

        <section class="ipd-section">
          <h4><span>4</span>不发送的字段</h4>
          <el-checkbox-group v-model="current.rules.drop" class="ipd-checks">
            <el-checkbox v-for="field in imageParamProfiles.droppable" :key="field" :value="field" border>
              {{ DROP_LABELS[field] || field }}<code>{{ field }}</code>
            </el-checkbox>
          </el-checkbox-group>
        </section>

        <section class="ipd-section">
          <h4><span>5</span>选用时填入模型的能力 <small>留空的项不改动模型现有设置</small></h4>
          <div class="ipd-rows">
            <div class="ipd-row">
              <span>分辨率</span>
              <el-checkbox-group v-model="current.capabilities.resolutions">
                <el-checkbox v-for="tier in TIERS" :key="tier" :value="tier">{{ tier }}</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="ipd-row">
              <span>画质选项</span>
              <el-checkbox-group v-model="current.capabilities.qualities">
                <el-checkbox v-for="quality in QUALITIES" :key="quality" :value="quality">{{ quality }}</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="ipd-row">
              <span>参考图上限</span>
              <el-input-number
                :model-value="current.capabilities.maxReferenceImages ?? undefined"
                :min="0"
                :max="16"
                controls-position="right"
                placeholder="不改"
                aria-label="参考图上限"
                @update:model-value="setMaxReference"
              />
            </div>
          </div>
        </section>
      </el-form>

      <!-- 预览与测试 -->
      <aside v-if="current" class="ipd-col ipd-side" aria-label="预览与测试">
        <section class="ipd-card">
          <h4>平台请求</h4>
          <div class="ipd-request">
            <label><span>分辨率</span>
              <el-select v-model="platform.resolution" aria-label="平台分辨率"><el-option v-for="tier in TIERS" :key="tier" :label="tier" :value="tier" /></el-select>
            </label>
            <label><span>比例</span>
              <el-select v-model="platform.ratio" aria-label="平台比例"><el-option v-for="ratio in PLATFORM_RATIOS" :key="ratio" :label="ratio" :value="ratio" /></el-select>
            </label>
            <label><span>画质</span>
              <el-select v-model="platform.quality" aria-label="平台画质"><el-option v-for="quality in QUALITIES" :key="quality" :label="quality" :value="quality" /></el-select>
            </label>
          </div>
          <p class="ipd-muted">平台会发出 <code>size={{ platformSize }}</code>、<code>quality={{ platform.quality }}</code>，以及背景、输出格式等字段。</p>
        </section>

        <section class="ipd-card" aria-label="请求预览">
          <h4>上游实际收到</h4>
          <pre class="mono">{{ JSON.stringify(upstreamBody, null, 2) }}</pre>
          <div class="ipd-diff">
            <span v-if="addedFields.length" class="is-added">新增：{{ addedFields.join("、") }}</span>
            <span v-if="removedFields.length" class="is-removed">去掉：{{ removedFields.join("、") }}</span>
          </div>
        </section>

        <section class="ipd-card" aria-label="真实测试">
          <h4>真实测试 <small>用当前编辑中的规则（无需先保存），会真实调用上游并计费</small></h4>
          <label class="ipd-field"><span>测试模型</span>
            <el-select v-model="test.modelId" filterable placeholder="选择一个生图模型" aria-label="测试模型">
              <el-option v-for="model in testModels" :key="model.id" :label="model.label" :value="model.id" />
            </el-select>
          </label>
          <p v-if="!testModels.length" class="ipd-muted">没有可测试的模型：档案只作用于「OpenAI 兼容」协议的生图模型。</p>
          <label class="ipd-field"><span>提示词</span>
            <el-input v-model="test.prompt" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" aria-label="测试提示词" />
          </label>
          <el-checkbox v-model="test.edit">再用生成的图测试图生图</el-checkbox>
          <el-button type="primary" :icon="VideoPlay" :loading="test.running" :disabled="!test.modelId" @click="runTest">
            {{ test.running ? "测试中…" : `用 ${platformSize} 测试` }}
          </el-button>
          <p v-if="test.error" class="ipd-result is-fail">✕ {{ test.error }}</p>
          <div v-for="(step, index) in test.steps" :key="step.name" class="ipd-step" :class="step.ok ? 'is-ok' : 'is-fail'">
            <header>
              <strong>{{ step.ok ? "✓" : "✕" }} {{ step.name }}</strong>
              <span class="tnum">{{ (step.latencyMs / 1000).toFixed(1) }}s</span>
            </header>
            <template v-if="step.image">
              <img :src="imageSrc(step.image)" :alt="`${step.name}结果`" @load="(event) => onImageLoad(index, event)" />
              <p class="ipd-output">
                请求 <code>{{ test.sentSize }}</code> → 实际输出 <strong>{{ test.dims[index] || "…" }}</strong> · {{ imageFormat(step.image) }} · {{ imageSizeText(step.image) }}
              </p>
            </template>
            <p v-else-if="step.detail" class="ipd-muted">{{ step.detail }}</p>
          </div>
        </section>
      </aside>
    </div>
  </AdminDialog>
</template>

<style scoped>
.ipd {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 240px minmax(0, 1fr) 400px;
  gap: 20px;
  min-height: 0;
}
/* Only the three columns scroll; the dialog body itself does not. */
.ipd-col {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.2s ease;
}
.ipd-col:hover,
.ipd-col:focus-within {
  scrollbar-color: color-mix(in srgb, var(--ink-3) 40%, transparent) transparent;
}
.ipd-col::-webkit-scrollbar {
  width: 6px;
}
.ipd-col::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: transparent;
}
.ipd-col:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink-3) 40%, transparent);
}
.ipd-col__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

/* list */
.ipd-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}
.ipd-item {
  display: grid;
  gap: 3px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ipd-item:hover {
  border-color: var(--el-border-color);
}
.ipd-item.is-active {
  border-color: var(--accent);
  background: var(--el-fill-color-light);
}
.ipd-item__name {
  font-weight: 600;
}
.ipd-item__id,
.ipd-item__meta,
.ipd-item__usage {
  font-size: 12px;
  color: var(--ink-3);
}
.ipd-item__usage.is-used {
  color: var(--accent);
}
.ipd-reset {
  align-self: flex-start;
}

/* form */
.ipd-form {
  padding: 0 4px 0 20px;
  border-left: 1px solid var(--el-border-color-lighter);
  border-right: 1px solid var(--el-border-color-lighter);
  padding-right: 20px;
}
.ipd-form__head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--surface, var(--el-bg-color));
}
.ipd-form__head h3 {
  margin: 0 0 4px;
  font-size: 18px;
}
.ipd-form__head p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-3);
}
.ipd-form__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  align-items: flex-start;
}
.ipd-section {
  padding: 18px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.ipd-section:last-child {
  border-bottom: 0;
}
.ipd-section h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 14px;
}
.ipd-section h4 > span {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-fill-color);
  font-size: 12px;
}
.ipd-section h4 small,
.ipd-card h4 small {
  font-weight: 400;
  font-size: 12px;
  color: var(--ink-3);
}
.ipd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
  margin-top: 14px;
}
.ipd-section > .ipd-grid:first-of-type {
  margin-top: 0;
}
.ipd-grid .is-full {
  grid-column: 1 / -1;
}
/* Four option cards: one row when there is room, otherwise 2 × 2. */
.ipd-modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  width: 100%;
}
.ipd-modes :deep(.el-radio-button) {
  display: flex;
}
.ipd-modes :deep(.el-radio-button__inner) {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 58px;
  padding: 10px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px !important;
  box-shadow: none !important;
  white-space: normal;
  line-height: 1.3;
}
.ipd-modes :deep(.el-radio-button__inner small) {
  font-size: 11px;
  opacity: 0.75;
}
.ipd-pairs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}
.ipd-pairs--four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 14px;
}
.ipd-pairs label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.ipd-checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.ipd-checks :deep(.el-checkbox) {
  margin: 0;
  width: 100%;
}
.ipd-checks code {
  margin-left: 6px;
  font-size: 11px;
  color: var(--ink-3);
}
.ipd-rows {
  display: grid;
  gap: 12px;
}
.ipd-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.ipd-row > span {
  font-size: 13px;
  color: var(--ink-3);
}
.ipd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* side */
.ipd-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ipd-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
}
.ipd-card h4 {
  margin: 0;
  font-size: 14px;
}
.ipd-request {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.ipd-request label,
.ipd-field {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.ipd-card pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-bg-color);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.ipd-diff {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
}
.ipd-diff .is-added {
  color: var(--el-color-success);
}
.ipd-diff .is-removed {
  color: var(--el-color-warning);
}
.ipd-card > .el-button {
  align-self: flex-start;
}
.ipd-step {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--el-bg-color);
}
.ipd-step header {
  display: flex;
  justify-content: space-between;
}
.ipd-step.is-ok strong,
.ipd-result.is-ok {
  color: var(--el-color-success);
}
.ipd-step.is-fail strong,
.ipd-result.is-fail {
  color: var(--el-color-danger);
}
.ipd-step img {
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  border-radius: 8px;
  background: var(--el-fill-color);
}
.ipd-output {
  margin: 0;
  font-size: 12px;
}
.ipd-muted {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
}
.ipd-result {
  margin: 0;
  font-size: 13px;
  word-break: break-word;
}
code {
  font-size: 12px;
}

@media (max-width: 1180px) {
  .ipd {
    grid-template-columns: 200px minmax(0, 1fr) 340px;
  }
}
@media (max-width: 760px) {
  .ipd {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .ipd-col {
    overflow: visible;
  }
  .ipd-form {
    border: 0;
    padding: 0;
  }
  .ipd-modes,
  .ipd-checks,
  .ipd-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
/* Taller than the default nested-scroll dialog: the editor has three columns. */
.admin-dialog.ipd-dialog.is-nested-scroll {
  height: calc(100dvh - 56px);
}
</style>
