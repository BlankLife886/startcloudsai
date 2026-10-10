<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Delete, Plus } from "@element-plus/icons-vue";
import { CHAT_API_OPTIONS, compatIsEmpty, IMAGE_EDIT_OPTIONS, IMAGE_RESPONSE_OPTIONS, IMAGE_SIZE_OPTIONS, type ImageParamProfile, type RequestCompat } from "./providerTypes";
import { findImageParamProfile, imageParamProfiles, loadImageParamProfiles } from "./imageParamProfiles";

const props = defineProps<{
  modelValue?: RequestCompat | null;
  /** Rules inherited from the provider, shown read-only for model overrides. */
  inherited?: RequestCompat | null;
  /** Gemini-native model kind: shows the chat endpoint ("chat"), the image response ("image") or both ("all"). */
  gemini?: "chat" | "image" | "all" | "";
  /** Show the reference-image format choice (OpenAI-compatible image models). */
  imageEdit?: boolean;
  /** Show the image parameter profile choice (OpenAI-compatible image models). */
  imageParams?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: RequestCompat | null];
  /** A profile was picked by the admin, so its suggested capabilities can be applied. */
  "profile-picked": [profile: ImageParamProfile];
}>();

onMounted(() => {
  if (props.imageParams) void loadImageParamProfiles();
});
watch(() => props.imageParams, (show) => {
  if (show) void loadImageParamProfiles();
});

const pickedProfile = computed(() => findImageParamProfile(current.value.imageParams));

function pickProfile(id: string) {
  update({ imageParams: id || "" });
  const profile = findImageParamProfile(id);
  if (profile) emit("profile-picked", profile);
}

const COMMON_DROPS = [
  "quality", "background", "moderation", "output_format", "output_compression", "style",
  "parallel_tool_calls", "reasoning_effort", "stream_options", "user", "n",
];

const renameRows = ref<Array<{ from: string; to: string }>>([]);
const extraText = ref("");
const extraError = ref("");

const current = computed<RequestCompat>(() => props.modelValue || {});
const emitted = ref<RequestCompat | null>(props.modelValue || null);

function syncLocal(value?: RequestCompat | null) {
  renameRows.value = Object.entries(value?.renameParams || {}).map(([from, to]) => ({ from, to }));
  extraText.value = Object.keys(value?.extraBody || {}).length ? JSON.stringify(value?.extraBody, null, 2) : "";
  extraError.value = "";
}
syncLocal(props.modelValue);
watch(() => props.modelValue, (value, previous) => {
  // Only resync when switching to a different object (e.g. another provider).
  if (value !== previous && JSON.stringify(value || {}) !== JSON.stringify(emitted.value || {})) syncLocal(value);
});

function update(patch: Partial<RequestCompat>) {
  const next: RequestCompat = { ...current.value, ...patch };
  const cleaned: RequestCompat = {};
  if (next.dropParams?.length) cleaned.dropParams = [...new Set(next.dropParams.map((item) => item.trim()).filter(Boolean))];
  if (next.renameParams && Object.keys(next.renameParams).length) cleaned.renameParams = next.renameParams;
  if (next.extraBody && Object.keys(next.extraBody).length) cleaned.extraBody = next.extraBody;
  if (next.imageSizeParam) cleaned.imageSizeParam = next.imageSizeParam;
  if (next.imageResponse) cleaned.imageResponse = next.imageResponse;
  if (next.chatApi) cleaned.chatApi = next.chatApi;
  if (next.imageEdit) cleaned.imageEdit = next.imageEdit;
  // The server copies the profile's rules onto the model when it is saved.
  if (next.imageParams) cleaned.imageParams = next.imageParams;
  emitted.value = compatIsEmpty(cleaned) ? null : cleaned;
  emit("update:modelValue", emitted.value);
}

function commitRenames() {
  const map: Record<string, string> = {};
  for (const row of renameRows.value) {
    const from = row.from.trim();
    const to = row.to.trim();
    if (from && to && from !== to) map[from] = to;
  }
  update({ renameParams: map });
}

function addRename() {
  renameRows.value.push({ from: "", to: "" });
}

function removeRename(index: number) {
  renameRows.value.splice(index, 1);
  commitRenames();
}

function commitExtra() {
  const text = extraText.value.trim();
  if (!text) {
    extraError.value = "";
    update({ extraBody: {} });
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("需要 JSON 对象");
    extraError.value = "";
    update({ extraBody: parsed });
  } catch (error) {
    extraError.value = `不是有效的 JSON 对象：${error instanceof Error ? error.message : ""}`;
  }
}

const inheritedSummary = computed(() => {
  const value = props.inherited;
  if (compatIsEmpty(value)) return "";
  const parts: string[] = [];
  if (value?.dropParams?.length) parts.push(`移除 ${value.dropParams.join("、")}`);
  const renames = Object.entries(value?.renameParams || {});
  if (renames.length) parts.push(`改名 ${renames.map(([from, to]) => `${from}→${to}`).join("、")}`);
  if (Object.keys(value?.extraBody || {}).length) parts.push(`附加 ${Object.keys(value?.extraBody || {}).join("、")}`);
  if (value?.imageSizeParam) parts.push(`尺寸 ${IMAGE_SIZE_OPTIONS.find((item) => item.value === value.imageSizeParam)?.label}`);
  if (value?.imageParams) parts.push(`参数档案 ${findImageParamProfile(value.imageParams)?.name || value.imageParams}`);
  if (value?.imageEdit) parts.push(`参考图 ${IMAGE_EDIT_OPTIONS.find((item) => item.value === value.imageEdit)?.label}`);
  if (value?.chatApi) parts.push(`对话接口 ${CHAT_API_OPTIONS.find((item) => item.value === value.chatApi)?.label}`);
  if (value?.imageResponse) parts.push(`图片返回 ${IMAGE_RESPONSE_OPTIONS.find((item) => item.value === value.imageResponse)?.label}`);
  return parts.join("；");
});
</script>

<template>
  <div class="compat-editor">
    <p v-if="inheritedSummary" class="compat-editor__inherited">
      服务商规则：{{ inheritedSummary }}。这里填写的规则会叠加在其上，同名项以模型为准。
    </p>
    <div class="compat-editor__grid">
      <label class="compat-field">
        <span>移除参数 <small>上游不认的字段，发送前删掉</small></span>
        <el-select
          :model-value="current.dropParams || []"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :max-collapse-tags="4"
          placeholder="选择或输入字段名"
          aria-label="移除参数"
          @update:model-value="(value: string[]) => update({ dropParams: value })"
        >
          <el-option v-for="name in COMMON_DROPS" :key="name" :label="name" :value="name" />
        </el-select>
      </label>
      <label v-if="imageParams" class="compat-field compat-field--wide">
        <span>生图参数档案 <small>上游认哪一套生图参数；中转站已聚合成 OpenAI 格式的选「OpenAI 标准」。选择后会按档案填好分辨率、画质等能力</small></span>
        <el-select
          :model-value="current.imageParams || ''"
          aria-label="生图参数档案"
          placeholder="不使用档案（按下方规则）"
          clearable
          @update:model-value="(value: string) => pickProfile(value || '')"
        >
          <el-option v-for="profile in imageParamProfiles.profiles" :key="profile.id" :label="profile.name" :value="profile.id" />
        </el-select>
        <small v-if="pickedProfile?.description" class="compat-profile-hint">{{ pickedProfile.description }}</small>
      </label>
      <label v-if="!current.imageParams" class="compat-field">
        <span>生图尺寸参数 <small>上游如何接收输出尺寸</small></span>
        <el-select
          :model-value="current.imageSizeParam || 'size'"
          aria-label="生图尺寸参数"
          @update:model-value="(value: string) => update({ imageSizeParam: (value === 'size' ? '' : value) as RequestCompat['imageSizeParam'] })"
        >
          <el-option v-for="option in IMAGE_SIZE_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'size'" />
        </el-select>
      </label>
      <label v-if="imageEdit" class="compat-field">
        <span>参考图发送方式 <small>图生图时参考图怎么发；各厂商不同，按其文档选择</small></span>
        <el-select
          :model-value="current.imageEdit || 'multipart'"
          aria-label="参考图发送方式"
          @update:model-value="(value: string) => update({ imageEdit: (value === 'multipart' ? '' : value) as RequestCompat['imageEdit'] })"
        >
          <el-option v-for="option in IMAGE_EDIT_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'multipart'">
            <span>{{ option.label }}</span><small style="margin-left: 8px; color: var(--el-text-color-secondary)">{{ option.hint }}</small>
          </el-option>
        </el-select>
      </label>
      <label v-if="gemini === 'chat' || gemini === 'all'" class="compat-field">
        <span>对话接口 <small>每个中转站不同，按实际提供的接口选择</small></span>
        <el-select
          :model-value="current.chatApi || 'official'"
          aria-label="对话接口"
          @update:model-value="(value: string) => update({ chatApi: (value === 'official' ? '' : value) as RequestCompat['chatApi'] })"
        >
          <el-option v-for="option in CHAT_API_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'official'">
            <span>{{ option.label }}</span><small style="margin-left: 8px; color: var(--el-text-color-secondary)">{{ option.hint }}</small>
          </el-option>
        </el-select>
      </label>
      <label v-if="gemini === 'image' || gemini === 'all'" class="compat-field">
        <span>图片返回方式 <small>每个中转站不同，按实际返回选择；不会自动识别</small></span>
        <el-select
          :model-value="current.imageResponse || 'inline'"
          aria-label="图片返回方式"
          @update:model-value="(value: string) => update({ imageResponse: (value === 'inline' ? '' : value) as RequestCompat['imageResponse'] })"
        >
          <el-option v-for="option in IMAGE_RESPONSE_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'inline'">
            <span>{{ option.label }}</span><small style="margin-left: 8px; color: var(--el-text-color-secondary)">{{ option.hint }}</small>
          </el-option>
        </el-select>
      </label>
      <div class="compat-field">
        <span>参数改名 <small>把平台发出的字段改成上游要求的名字</small></span>
        <div v-for="(row, index) in renameRows" :key="index" class="compat-rename">
          <el-input v-model="row.from" placeholder="原字段，如 max_completion_tokens" aria-label="原字段" @change="commitRenames" />
          <span aria-hidden="true">→</span>
          <el-input v-model="row.to" placeholder="新字段，如 max_tokens" aria-label="新字段" @change="commitRenames" />
          <button type="button" class="compat-icon-btn" aria-label="删除改名规则" @click="removeRename(index)"><Delete /></button>
        </div>
        <button type="button" class="compat-add" @click="addRename"><Plus aria-hidden="true" />添加改名</button>
      </div>
      <label class="compat-field">
        <span>附加参数（JSON） <small>合并进每个请求体，覆盖同名字段</small></span>
        <el-input
          v-model="extraText"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder='例如 {"watermark": false}'
          aria-label="附加参数"
          class="mono-input"
          @change="commitExtra"
        />
        <em v-if="extraError" class="compat-error">{{ extraError }}</em>
      </label>
    </div>
  </div>
</template>

<style scoped>
.compat-editor {
  display: grid;
  gap: 10px;
}

.compat-editor__inherited {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--ink-2);
  background: var(--surface-2);
  font-size: 12px;
  line-height: 1.6;
}

.compat-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.compat-field--wide {
  grid-column: 1 / -1;
}
.compat-profile-hint {
  line-height: 1.5;
}
.compat-field {
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
}

.compat-field > span {
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}

.compat-field small {
  margin-left: 4px;
  color: var(--ink-3);
  font-weight: 400;
}

.compat-rename {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
}

.compat-icon-btn,
.compat-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.compat-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
}

.compat-icon-btn:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.compat-icon-btn svg,
.compat-add svg {
  width: 13px;
  height: 13px;
}

.compat-add {
  justify-self: start;
  padding: 4px 0;
  color: var(--accent);
}

.compat-error {
  color: var(--danger);
  font-size: 12px;
  font-style: normal;
}

.mono-input :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

@media (max-width: 900px) {
  .compat-editor__grid {
    grid-template-columns: 1fr;
  }
}
</style>
