<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Connection, Delete, EditPen, Plus } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";
import CompatRulesEditor from "./CompatRulesEditor.vue";
import {
  ADAPTER_OPTIONS,
  adapterLabel,
  AUTH_STYLE_OPTIONS,
  IMAGE_API_OPTIONS,
  normalizeAPIPath,
  REGION_LABELS,
  type PresetRegion,
  type ProviderPreset,
} from "./providerTypes";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [preset: ProviderPreset];
}>();

const presets = ref<ProviderPreset[]>([]);
const customized = ref(false);
const loading = ref(false);
const saving = ref(false);
const mode = ref<"pick" | "manage" | "edit">("pick");
const editIndex = ref(-1);
const draft = reactive<ProviderPreset>(blankPreset());

function blankPreset(): ProviderPreset {
  return {
    id: "", name: "", region: "relay", description: "", adapter: "openai", baseUrl: "",
    apiPath: "/v1", authStyle: "", imageApi: "standard", compat: null, keyUrl: "",
  };
}

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const groups = computed(() =>
  (Object.keys(REGION_LABELS) as PresetRegion[])
    .map((region) => ({ region, label: REGION_LABELS[region], items: presets.value.filter((item) => item.region === region) }))
    .filter((group) => group.items.length),
);

async function load() {
  loading.value = true;
  try {
    const result = await request<{ presets: ProviderPreset[]; customized: boolean }>("/api/v1/admin/model-config/presets");
    presets.value = result.presets || [];
    customized.value = result.customized;
  } finally {
    loading.value = false;
  }
}

watch(visible, (open) => {
  if (!open) return;
  mode.value = "pick";
  void load();
});

function pick(preset: ProviderPreset) {
  emit("pick", JSON.parse(JSON.stringify(preset)));
  visible.value = false;
}

function startEdit(index: number) {
  editIndex.value = index;
  Object.assign(draft, blankPreset(), index >= 0 ? JSON.parse(JSON.stringify(presets.value[index])) : {});
  mode.value = "edit";
}

async function persist(next: ProviderPreset[]) {
  saving.value = true;
  try {
    const result = await request<{ presets: ProviderPreset[]; customized: boolean }>("/api/v1/admin/model-config/presets", {
      method: "PUT",
      body: { presets: next },
    });
    presets.value = result.presets;
    customized.value = result.customized;
    return true;
  } catch {
    return false;
  } finally {
    saving.value = false;
  }
}

async function commitEdit() {
  draft.id = draft.id.trim();
  draft.name = draft.name.trim();
  draft.apiPath = normalizeAPIPath(draft.apiPath || "");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(draft.id) || !draft.name) {
    ElMessage.warning("请填写名称和英文 ID（小写字母、数字、- 或 _）");
    return;
  }
  const next = [...presets.value];
  const value = JSON.parse(JSON.stringify(draft)) as ProviderPreset;
  if (editIndex.value >= 0) next[editIndex.value] = value;
  else next.push(value);
  if (await persist(next)) {
    ElMessage.success("厂商模板已保存");
    mode.value = "manage";
  }
}

async function removePreset(index: number) {
  const preset = presets.value[index];
  await ElMessageBox.confirm(`删除厂商模板「${preset.name}」？已创建的服务商不受影响。`, "删除模板", { type: "warning" });
  if (await persist(presets.value.filter((_, itemIndex) => itemIndex !== index))) ElMessage.success("已删除");
}

async function resetPresets() {
  await ElMessageBox.confirm("恢复为内置厂商模板？你对模板的修改会丢失，已创建的服务商不受影响。", "恢复默认模板", { type: "warning" });
  saving.value = true;
  try {
    const result = await request<{ presets: ProviderPreset[]; customized: boolean }>("/api/v1/admin/model-config/presets", { method: "DELETE" });
    presets.value = result.presets;
    customized.value = result.customized;
    ElMessage.success("已恢复内置模板");
  } finally {
    saving.value = false;
  }
}

const dialogTitle = computed(() =>
  mode.value === "pick" ? "添加服务商" : mode.value === "manage" ? "管理厂商模板" : editIndex.value >= 0 ? "编辑厂商模板" : "新建厂商模板",
);
const dialogSubtitle = computed(() =>
  mode.value === "pick"
    ? "选择厂商模板，自动填好地址、接口路径、鉴权与兼容规则；创建后仍可修改"
    : "模板只用于创建服务商时预填；修改模板不会影响已创建的服务商",
);
</script>

<template>
  <AdminDialog
    v-model="visible"
    :title="dialogTitle"
    :subtitle="dialogSubtitle"
    :icon="Connection"
    width="min(1040px, calc(100% - 24px))"
    nested-scroll
    :show-confirm="mode === 'edit'"
    :confirm-loading="saving"
    confirm-text="保存模板"
    :cancel-text="mode === 'pick' ? '取消' : '关闭'"
    @confirm="commitEdit"
  >
    <div v-loading="loading" class="preset-dialog">
      <div class="preset-dialog__bar">
        <button v-if="mode !== 'pick'" type="button" class="preset-link" @click="mode = mode === 'edit' ? 'manage' : 'pick'">
          <ArrowLeft aria-hidden="true" />{{ mode === "edit" ? "返回模板列表" : "返回选择" }}
        </button>
        <span v-else class="preset-dialog__hint">没有你要的厂商？选「自定义 OpenAI 兼容」，或新建一个模板。</span>
        <div class="preset-dialog__bar-actions">
          <template v-if="mode === 'manage'">
            <el-button v-if="customized" :loading="saving" @click="resetPresets">恢复默认</el-button>
            <el-button type="primary" :icon="Plus" @click="startEdit(-1)">新建模板</el-button>
          </template>
          <el-button v-else-if="mode === 'pick'" :icon="EditPen" @click="mode = 'manage'">管理模板</el-button>
        </div>
      </div>

      <template v-if="mode === 'pick'">
        <section v-for="group in groups" :key="group.region" class="preset-group">
          <h4>{{ group.label }}</h4>
          <div class="preset-grid">
            <button v-for="preset in group.items" :key="preset.id" type="button" class="preset-card" @click="pick(preset)">
              <span class="preset-card__avatar" :data-region="preset.region" aria-hidden="true">{{ preset.name.slice(0, 1) }}</span>
              <span class="preset-card__copy">
                <strong>{{ preset.name }}</strong>
                <small>{{ preset.description || preset.baseUrl || "手动填写地址" }}</small>
                <code v-if="preset.baseUrl">{{ preset.baseUrl }}{{ preset.apiPath || "" }}</code>
              </span>
            </button>
          </div>
        </section>
      </template>

      <table v-else-if="mode === 'manage'" class="preset-table">
        <thead>
          <tr><th>模板</th><th>分组</th><th>接口根地址</th><th>协议 / 鉴权</th><th>兼容规则</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="(preset, index) in presets" :key="preset.id">
            <td><strong>{{ preset.name }}</strong><small class="mono">{{ preset.id }}</small></td>
            <td>{{ REGION_LABELS[preset.region] }}</td>
            <td class="mono">{{ preset.baseUrl ? preset.baseUrl + (preset.apiPath || "") : "—" }}</td>
            <td>{{ adapterLabel(preset.adapter) }} · {{ AUTH_STYLE_OPTIONS.find((item) => item.value === (preset.authStyle || ""))?.label }}</td>
            <td>{{ preset.compat ? "有" : "—" }}</td>
            <td class="preset-table__actions">
              <button type="button" class="preset-icon" aria-label="编辑模板" @click="startEdit(index)"><EditPen /></button>
              <button type="button" class="preset-icon is-danger" aria-label="删除模板" @click="removePreset(index)"><Delete /></button>
            </td>
          </tr>
        </tbody>
      </table>

      <el-form v-else label-position="top" class="preset-form">
        <div class="preset-form__grid">
          <el-form-item label="名称"><el-input v-model="draft.name" placeholder="例如 Google Gemini" /></el-form-item>
          <el-form-item label="模板 ID"><el-input v-model="draft.id" :disabled="editIndex >= 0" placeholder="例如 gemini" /></el-form-item>
          <el-form-item label="分组">
            <el-select v-model="draft.region">
              <el-option v-for="(label, region) in REGION_LABELS" :key="region" :label="label" :value="region" />
            </el-select>
          </el-form-item>
          <el-form-item label="调用协议">
            <el-radio-group v-model="draft.adapter">
              <el-radio-button v-for="option in ADAPTER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="Base URL"><el-input v-model="draft.baseUrl" placeholder="https://api.example.com" /></el-form-item>
          <el-form-item label="接口路径前缀"><el-input v-model="draft.apiPath" placeholder="/v1" /></el-form-item>
          <el-form-item label="鉴权方式">
            <el-select :model-value="draft.authStyle || 'default'" @update:model-value="(value: string) => (draft.authStyle = (value === 'default' ? '' : value) as ProviderPreset['authStyle'])">
              <el-option v-for="option in AUTH_STYLE_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'default'" />
            </el-select>
          </el-form-item>
          <el-form-item label="生图接口">
            <el-select :model-value="draft.imageApi || 'auto'" @update:model-value="(value: string) => (draft.imageApi = value === 'auto' ? '' : 'standard')">
              <el-option v-for="option in IMAGE_API_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'auto'" />
            </el-select>
          </el-form-item>
          <el-form-item label="说明" class="span-2"><el-input v-model="draft.description" placeholder="在选择卡片上显示" /></el-form-item>
          <el-form-item label="获取 Key 的地址"><el-input v-model="draft.keyUrl" placeholder="https://…" /></el-form-item>
        </div>
        <h5 class="preset-form__section">导入生图模型时的默认兼容规则 <small>从这个模板的服务商导入生图模型时复制到模型上，之后在模型上单独修改；对话模型不套用</small></h5>
        <CompatRulesEditor v-model="draft.compat" :gemini="draft.adapter === 'gemini' ? 'image' : ''" :image-edit="draft.adapter === 'openai'" :image-params="draft.adapter === 'openai'" />
      </el-form>
    </div>
  </AdminDialog>
</template>

<style scoped>
.preset-dialog {
  display: grid;
  gap: 14px;
  min-height: 320px;
}

.preset-dialog__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preset-dialog__hint {
  color: var(--ink-3);
  font-size: 12px;
}

.preset-dialog__bar-actions {
  display: flex;
  gap: 8px;
}

.preset-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.preset-link svg {
  width: 14px;
  height: 14px;
}

.preset-group h4 {
  margin: 0 0 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 8px;
}

.preset-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.preset-card:hover,
.preset-card:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  outline: none;
}

.preset-card__avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  font-weight: 700;
}

.preset-card__avatar[data-region="cn"] {
  color: var(--danger);
  background: var(--danger-soft);
}

.preset-card__avatar[data-region="relay"] {
  color: var(--ink-2);
  background: var(--surface-3);
}

.preset-card__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.preset-card__copy strong {
  font-size: 13px;
}

.preset-card__copy small {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.45;
}

.preset-card__copy code {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.preset-table th,
.preset-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.preset-table th {
  color: var(--ink-3);
  font-weight: 600;
}

.preset-table td strong {
  display: block;
  color: var(--ink);
}

.preset-table td small {
  color: var(--ink-3);
}

.preset-table__actions {
  width: 72px;
  white-space: nowrap;
}

.preset-icon {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}

.preset-icon svg {
  width: 14px;
  height: 14px;
}

.preset-icon:hover {
  color: var(--ink);
  background: var(--surface-2);
}

.preset-icon.is-danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.preset-form__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0 14px;
}

.preset-form__grid .span-2 {
  grid-column: span 2;
}

.preset-form__section {
  margin: 4px 0 10px;
  color: var(--ink);
  font-size: 13px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 900px) {
  .preset-form__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
