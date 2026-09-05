<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  CollectionTag,
  Delete,
  Lock,
  Plus,
  Rank,
} from "@element-plus/icons-vue";
import draggable from "vuedraggable";
import AdminDialog from "@/components/AdminDialog.vue";
import { normalizeList, request, type Page } from "@/request";

interface PromptCategory {
  id: string;
  key: string;
  label: string;
  sort: number;
  active: boolean;
  builtin: boolean;
  count: number;
}

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  changed: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const categories = ref<PromptCategory[]>([]);
const categoryFilter = ref<"all" | "on" | "off">("all");
const dragList = ref<PromptCategory[]>([]);
const loading = ref(false);
const saving = ref("");
const addOpen = ref(false);
const addForm = reactive({ key: "", label: "", active: true });
const editingId = ref("");
const editingLabel = ref("");

const enabledCategories = computed(() =>
  categories.value.filter((item) => item.active),
);

const filteredCategories = computed(() => {
  const list =
    categoryFilter.value === "on"
      ? categories.value.filter((item) => item.active)
      : categoryFilter.value === "off"
        ? categories.value.filter((item) => !item.active)
        : categories.value;
  return [...list].sort(
    (a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "zh-CN"),
  );
});

watch(
  filteredCategories,
  (list) => {
    dragList.value = [...list];
  },
  { immediate: true },
);

watch(open, (value) => {
  if (!value) return;
  categoryFilter.value = "all";
  void loadCategories();
});

async function loadCategories() {
  loading.value = true;
  try {
    const page = await request<PromptCategory[] | Page<PromptCategory>>(
      "/api/v1/admin/prompt-categories",
    ).then(normalizeList);
    categories.value = page.items;
  } finally {
    loading.value = false;
  }
}

function openAddDialog() {
  addForm.key = "";
  addForm.label = "";
  addForm.active = true;
  addOpen.value = true;
}

async function createCategory() {
  const key = addForm.key.trim().toLowerCase();
  const label = addForm.label.trim();
  if (!label) {
    ElMessage.warning("请填写分类名称");
    return;
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key)) {
    ElMessage.warning(
      "分类标识需以小写字母开头，仅使用字母、数字、连字符或下划线",
    );
    return;
  }
  if (["all", "today", "latest", "favorites", "my-favorites"].includes(key)) {
    ElMessage.warning("该分类标识是系统筛选保留字，请更换");
    return;
  }
  saving.value = "__create__";
  try {
    await request("/api/v1/admin/prompt-categories", {
      method: "POST",
      body: { key, label, active: addForm.active },
    });
    addOpen.value = false;
    ElMessage.success("分类已创建");
    await loadCategories();
    emit("changed");
  } finally {
    saving.value = "";
  }
}

async function patchCategory(
  item: PromptCategory,
  body: Partial<PromptCategory>,
) {
  saving.value = item.id;
  try {
    await request(`/api/v1/admin/prompt-categories/${item.id}`, {
      method: "PATCH",
      body,
    });
    await loadCategories();
    emit("changed");
    return true;
  } catch {
    await loadCategories();
    return false;
  } finally {
    saving.value = "";
  }
}

async function toggleCategory(
  item: PromptCategory,
  value: string | number | boolean,
) {
  const active = value === true;
  const updated = await patchCategory(item, { active });
  if (updated) ElMessage.success(active ? "分类已启用" : "分类已停用");
}

async function startEdit(item: PromptCategory) {
  if (saving.value) return;
  editingId.value = item.id;
  editingLabel.value = item.label;
  await nextTick();
  const selector = `.pcm-card[data-key="${CSS.escape(item.id)}"] .pcm-card__name-input input`;
  const input = document.querySelector(selector) as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

async function commitEdit(item: PromptCategory) {
  if (editingId.value !== item.id) return;
  const label = editingLabel.value.trim();
  editingId.value = "";
  if (!label) {
    ElMessage.warning("分类名称不能为空");
    return;
  }
  if (label === item.label) return;
  await patchCategory(item, { label });
}

async function persistOrder() {
  if (categoryFilter.value !== "all" || saving.value) return;
  const changes = dragList.value
    .map((item, index) => ({ item, sort: (index + 1) * 10 }))
    .filter(({ item, sort }) => item.sort !== sort);
  if (!changes.length) return;
  saving.value = "__order__";
  try {
    await Promise.all(
      changes.map(({ item, sort }) =>
        request(`/api/v1/admin/prompt-categories/${item.id}`, {
          method: "PATCH",
          body: { sort },
        }),
      ),
    );
    ElMessage.success("分类顺序已更新");
    await loadCategories();
    emit("changed");
  } finally {
    saving.value = "";
  }
}

async function removeCategory(item: PromptCategory) {
  if (item.builtin) return;
  const usage =
    item.count > 0 ? `，其中 ${item.count} 条提示词会移入“其他”` : "";
  await ElMessageBox.confirm(
    `确认删除「${item.label}」${usage}？`,
    "删除分类",
    {
      type: "warning",
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
    },
  );
  saving.value = item.id;
  try {
    await request(`/api/v1/admin/prompt-categories/${item.id}`, {
      method: "DELETE",
    });
    ElMessage.success("分类已删除");
    await loadCategories();
    emit("changed");
  } finally {
    saving.value = "";
  }
}
</script>

<template>
  <AdminDialog
    v-model="open"
    panel-class="prompt-category-dialog"
    title="分类管理"
    subtitle="启停、改名与拖动排序；删除后提示词会移入“其他”"
    :icon="CollectionTag"
    width="720px"
    hide-footer
    nested-scroll
  >
    <div class="pcm">
      <div class="pcm-toolbar">
        <div class="pcm-filters">
          <button
            type="button"
            class="pcm-filter"
            :class="{ 'is-active': categoryFilter === 'all' }"
            @click="categoryFilter = 'all'"
          >
            全部 {{ categories.length }}
          </button>
          <button
            type="button"
            class="pcm-filter"
            :class="{ 'is-active': categoryFilter === 'on' }"
            @click="categoryFilter = 'on'"
          >
            启用 {{ enabledCategories.length }}
          </button>
          <button
            type="button"
            class="pcm-filter"
            :class="{ 'is-active': categoryFilter === 'off' }"
            @click="categoryFilter = 'off'"
          >
            停用 {{ categories.length - enabledCategories.length }}
          </button>
        </div>
        <el-button type="primary" :icon="Plus" @click="openAddDialog">
          新增
        </el-button>
      </div>

      <p class="pcm-tip">点击名称改名；停用后用户端不再展示。在「全部」下可拖动手柄排序。</p>

      <div v-loading="loading" class="pcm-list">
        <el-empty v-if="!loading && !dragList.length" description="暂无分类" />
        <draggable
          v-else
          v-model="dragList"
          class="pcm-list__stack"
          item-key="id"
          handle=".pcm-card__handle"
          :animation="180"
          :disabled="categoryFilter !== 'all' || Boolean(saving)"
          ghost-class="is-ghost"
          drag-class="is-drag"
          @end="persistOrder"
        >
          <template #item="{ element: item }">
            <article
              class="pcm-card"
              :data-key="item.id"
              :class="{
                'is-off': !item.active,
                'is-locked': categoryFilter !== 'all',
              }"
            >
              <button
                type="button"
                class="pcm-card__handle"
                :disabled="categoryFilter !== 'all' || Boolean(saving)"
                title="拖动排序"
              >
                <el-icon :size="14"><Rank /></el-icon>
              </button>

              <button
                type="button"
                class="pcm-card__delete"
                :disabled="item.builtin || Boolean(saving)"
                :title="item.builtin ? '内置分类可改名和停用，但不能删除' : '删除分类'"
                @click="removeCategory(item)"
              >
                <el-icon :size="13">
                  <Lock v-if="item.builtin" />
                  <Delete v-else />
                </el-icon>
              </button>

              <div class="pcm-card__icon">
                <el-icon :size="22"><CollectionTag /></el-icon>
              </div>

              <div class="pcm-card__body">
                <el-input
                  v-if="editingId === item.id"
                  v-model="editingLabel"
                  class="pcm-card__name-input"
                  size="small"
                  maxlength="64"
                  @keyup.enter="commitEdit(item)"
                  @keyup.esc="editingId = ''"
                  @blur="commitEdit(item)"
                />
                <button
                  v-else
                  type="button"
                  class="pcm-card__name"
                  title="点击改名"
                  @click="startEdit(item)"
                >
                  {{ item.label || "未命名分类" }}
                </button>
                <small>{{ item.count }} 条</small>
              </div>

              <el-switch
                :model-value="item.active"
                :loading="saving === item.id"
                inline-prompt
                active-text="开"
                inactive-text="关"
                @change="
                  (value: string | number | boolean) =>
                    toggleCategory(item, value)
                "
              />
            </article>
          </template>
        </draggable>
      </div>
    </div>
  </AdminDialog>

  <AdminDialog
    v-model="addOpen"
    title="新增分类"
    :icon="Plus"
    width="420px"
    confirm-text="添加"
    :confirm-loading="saving === '__create__'"
    @confirm="createCategory"
  >
    <el-form label-position="top" class="pcm-editor">
      <el-form-item label="显示名称">
        <el-input
          v-model="addForm.label"
          maxlength="64"
          placeholder="例如：概念艺术"
        />
      </el-form-item>
      <el-form-item label="分类标识">
        <el-input
          v-model="addForm.key"
          maxlength="64"
          placeholder="例如：concept-art"
        />
      </el-form-item>
      <el-form-item label="用户端显示">
        <el-switch v-model="addForm.active" />
      </el-form-item>
    </el-form>
  </AdminDialog>
</template>

<style scoped lang="scss">
.pcm {
  display: grid;
  gap: 12px;
}

.pcm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}

.pcm-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pcm-filter {
  min-height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  &.is-active {
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-on);
  }
}

.pcm-tip {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}

.pcm-list {
  min-height: 180px;
  max-height: min(56vh, 560px);
  overflow: auto;
}

.pcm-list__stack {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.pcm-card {
  position: relative;
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 16px 12px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  text-align: center;

  &.is-off {
    opacity: 0.68;
  }

  &.is-ghost {
    opacity: 0.45;
    border-style: dashed;
  }

  &.is-drag {
    box-shadow: var(--shadow-md);
  }
}

.pcm-card__handle,
.pcm-card__delete {
  position: absolute;
  top: 6px;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-3);

  &:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }
}

.pcm-card__handle {
  left: 6px;
  cursor: grab;

  &:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--accent-ink);
  }

  &:active:not(:disabled) {
    cursor: grabbing;
  }
}

.pcm-card__delete {
  right: 6px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.pcm-card__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.pcm-card__body {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 2px;
}

.pcm-card__name {
  display: block;
  overflow: hidden;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  font-weight: 680;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;

  &:hover {
    color: var(--accent-ink);
  }
}

.pcm-card__name-input {
  width: 100%;
}

.pcm-card__body small {
  color: var(--ink-3);
  font-size: 11px;
}

.pcm-editor {
  display: grid;
  gap: 2px;
}
</style>
