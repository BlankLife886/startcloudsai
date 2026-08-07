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
const dragList = ref<PromptCategory[]>([]);
const loading = ref(false);
const saving = ref("");
const addOpen = ref(false);
const addForm = reactive({ key: "", label: "", active: true });
const editingId = ref("");
const editingLabel = ref("");

watch(
  categories,
  (items) => {
    dragList.value = [...items].sort(
      (a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "zh-CN"),
    );
  },
  { deep: true },
);

watch(open, (value) => {
  if (value) void loadCategories();
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
  const selector = `.prompt-category-manager__row[data-key="${CSS.escape(item.id)}"] input`;
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
  if (saving.value) return;
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
    title="提示词分类"
    :icon="CollectionTag"
    width="min(680px, 92vw)"
    hide-footer
  >
    <div class="prompt-category-manager">
      <div class="prompt-category-manager__toolbar">
        <el-button type="primary" :icon="Plus" @click="openAddDialog"
          >新增分类</el-button
        >
      </div>

      <div v-loading="loading" class="prompt-category-manager__list">
        <el-empty v-if="!loading && !dragList.length" description="暂无分类" />
        <draggable
          v-else
          v-model="dragList"
          item-key="id"
          handle=".prompt-category-manager__handle"
          :animation="180"
          :disabled="Boolean(saving)"
          ghost-class="is-ghost"
          @end="persistOrder"
        >
          <template #item="{ element: item }">
            <article
              class="prompt-category-manager__row"
              :class="{ 'is-off': !item.active }"
              :data-key="item.id"
            >
              <button
                type="button"
                class="prompt-category-manager__handle"
                title="拖动排序"
                :disabled="Boolean(saving)"
              >
                <el-icon><Rank /></el-icon>
              </button>

              <span class="prompt-category-manager__mark">
                <el-icon><CollectionTag /></el-icon>
              </span>

              <div class="prompt-category-manager__copy">
                <el-input
                  v-if="editingId === item.id"
                  v-model="editingLabel"
                  size="small"
                  maxlength="64"
                  @keyup.enter="commitEdit(item)"
                  @keyup.esc="editingId = ''"
                  @blur="commitEdit(item)"
                />
                <button v-else type="button" @click="startEdit(item)">
                  {{ item.label }}
                </button>
                <small>{{ item.key }} · {{ item.count }} 条提示词</small>
              </div>

              <el-tooltip
                :content="
                  item.builtin ? '内置分类可改名和停用，但不能删除' : '删除分类'
                "
              >
                <button
                  type="button"
                  class="prompt-category-manager__delete"
                  :disabled="item.builtin || Boolean(saving)"
                :aria-label="item.builtin ? '内置分类' : '删除分类'"
                @click="removeCategory(item)"
              >
                  <el-icon>
                    <Lock v-if="item.builtin" />
                    <Delete v-else />
                  </el-icon>
                </button>
              </el-tooltip>

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
    title="新增提示词分类"
    :icon="Plus"
    width="440px"
    confirm-text="创建分类"
    :confirm-loading="saving === '__create__'"
    @confirm="createCategory"
  >
    <el-form label-position="top" class="prompt-category-editor">
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

<style scoped>
.prompt-category-manager {
  display: grid;
  gap: 14px;
}

.prompt-category-manager__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.prompt-category-manager__list {
  min-height: 180px;
}

.prompt-category-manager__list > div {
  display: grid;
  gap: 8px;
}

.prompt-category-manager__row {
  display: grid;
  grid-template-columns: 30px 34px minmax(0, 1fr) 32px auto;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  transition:
    opacity 0.15s ease,
    border-color 0.15s ease;
}

.prompt-category-manager__row.is-off {
  opacity: 0.58;
}

.prompt-category-manager__row.is-ghost {
  border-color: var(--accent);
  opacity: 0.5;
}

.prompt-category-manager__handle,
.prompt-category-manager__delete,
.prompt-category-manager__copy button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.prompt-category-manager__handle,
.prompt-category-manager__delete {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 6px;
  color: var(--ink-3);
}

.prompt-category-manager__handle {
  cursor: grab;
}

.prompt-category-manager__delete:not(:disabled):hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.prompt-category-manager__delete:disabled {
  cursor: default;
  opacity: 0.55;
}

.prompt-category-manager__mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.prompt-category-manager__copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.prompt-category-manager__copy button {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-category-manager__copy small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-category-editor {
  display: grid;
  gap: 2px;
}
</style>
