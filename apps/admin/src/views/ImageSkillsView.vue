<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Delete, EditPen, MagicStick, Plus, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AdminDialog from "@/components/AdminDialog.vue";
import AdminListShell from "@/components/AdminListShell.vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";
import { TASK_TYPE_LABELS } from "@/utils";

interface ImageSkill {
  id: string;
  name: string;
  description: string;
  instruction: string;
  taskTypes: string[];
  category: string | null;
  tags: string[];
  sort: number;
  active: boolean;
  official: boolean;
}

interface SkillForm {
  name: string;
  description: string;
  instruction: string;
  taskTypes: string[];
  category: string;
  tagsText: string;
  sort: number;
  active: boolean;
}

const NAME_MAX = 64;
const DESCRIPTION_MAX = 500;
const INSTRUCTION_MAX = 4000;

const defaults = (): SkillForm => ({
  name: "",
  description: "",
  instruction: "",
  taskTypes: [],
  category: "",
  tagsText: "",
  sort: 0,
  active: true,
});

const items = ref<ImageSkill[]>([]);
const taskTypes = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const saveError = ref("");
const busyId = ref("");
const query = ref("");
const status = ref<"all" | "enabled" | "disabled">("all");
const taskTypeFilter = ref("all");
const categoryFilter = ref("all");
const page = ref(1);
const pageSize = 10;
const visible = ref(false);
const editingId = ref<string | undefined>();
const form = reactive<SkillForm>(defaults());

function pageLabel(type: string) {
  return TASK_TYPE_LABELS[type] || type;
}

const counts = computed(() => ({
  all: items.value.length,
  enabled: items.value.filter((item) => item.active).length,
  disabled: items.value.filter((item) => !item.active).length,
}));

const statusOptions = computed(() => [
  { value: "all" as const, label: "全部", count: counts.value.all },
  { value: "enabled" as const, label: "启用中", count: counts.value.enabled },
  { value: "disabled" as const, label: "已停用", count: counts.value.disabled },
]);

const categories = computed(() => {
  const seen = new Set<string>();
  for (const item of items.value) {
    const value = (item.category || "").trim();
    if (value) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
});

const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return items.value.filter((item) => {
    if (status.value === "enabled" && !item.active) return false;
    if (status.value === "disabled" && item.active) return false;
    // 空 taskTypes 表示全部页面通用，筛某个页面时也要命中。
    if (taskTypeFilter.value !== "all") {
      const universal = item.taskTypes.length === 0;
      if (!universal && !item.taskTypes.includes(taskTypeFilter.value)) return false;
    }
    if (categoryFilter.value !== "all" && (item.category || "") !== categoryFilter.value) return false;
    if (!keyword) return true;
    return [item.name, item.description, item.instruction, item.tags.join(" ")]
      .join(" ")
      .toLocaleLowerCase()
      .includes(keyword);
  });
});

const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));

const hasFilters = computed(
  () =>
    Boolean(query.value.trim()) ||
    status.value !== "all" ||
    taskTypeFilter.value !== "all" ||
    categoryFilter.value !== "all",
);

function resetFilters() {
  query.value = "";
  status.value = "all";
  taskTypeFilter.value = "all";
  categoryFilter.value = "all";
  page.value = 1;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await request<{ items: ImageSkill[]; taskTypes: string[] }>("/api/v1/admin/image-skills", {
      silent: true,
    });
    items.value = data.items || [];
    taskTypes.value = data.taskTypes || [];
    // 删除或筛选后当前页可能已越界，收回到最后一页。
    const maxPage = Math.max(1, Math.ceil(filtered.value.length / pageSize));
    if (page.value > maxPage) page.value = maxPage;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载 Skill 词库失败";
  } finally {
    loading.value = false;
  }
}

function edit(item?: ImageSkill) {
  saveError.value = "";
  editingId.value = item?.id;
  Object.assign(
    form,
    item
      ? {
          name: item.name,
          description: item.description,
          instruction: item.instruction,
          taskTypes: [...item.taskTypes],
          category: item.category || "",
          tagsText: item.tags.join("，"),
          sort: item.sort,
          active: item.active,
        }
      : defaults(),
  );
  visible.value = true;
}

function parseTags(text: string) {
  return [...new Set(text.split(/[，,\n]/).map((tag) => tag.trim()).filter(Boolean))];
}

async function save() {
  const name = form.name.trim();
  const instruction = form.instruction.trim();
  if (!name || !instruction) {
    ElMessage.warning("请填写 Skill 名称与指令内容");
    return;
  }
  saving.value = true;
  saveError.value = "";
  try {
    const body = {
      name,
      description: form.description.trim(),
      instruction,
      taskTypes: form.taskTypes,
      category: form.category.trim() || null,
      tags: parseTags(form.tagsText),
      sort: form.sort,
      active: form.active,
    };
    if (editingId.value) {
      await request(`/api/v1/admin/image-skills/${editingId.value}`, { method: "PATCH", body, silent: true });
    } else {
      await request("/api/v1/admin/image-skills", { method: "POST", body, silent: true });
    }
    ElMessage.success(editingId.value ? "Skill 已更新" : "Skill 已录入");
    visible.value = false;
    await load();
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

async function toggle(item: ImageSkill) {
  const next = !item.active;
  busyId.value = item.id;
  item.active = next;
  try {
    await request(`/api/v1/admin/image-skills/${item.id}`, { method: "PATCH", body: { active: next } });
    ElMessage.success(next ? "已启用" : "已停用");
  } catch {
    item.active = !next;
  } finally {
    busyId.value = "";
  }
}

async function remove(item: ImageSkill) {
  try {
    await ElMessageBox.confirm(
      `确认永久删除「${item.name}」？已装载该 Skill 的用户会一并解除装载。`,
      "删除 Skill",
      { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  busyId.value = item.id;
  try {
    await request(`/api/v1/admin/image-skills/${item.id}`, { method: "DELETE" });
    ElMessage.success("Skill 已删除");
    await load();
  } finally {
    busyId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div class="skill-page">
    <PageCard
      title="官方 Skill 词库"
      :subtitle="`${counts.all} 个官方 Skill · 启用中 ${counts.enabled} · 装载后其指令会拼进用户的生图提示词`"
    >
      <template #actions>
        <div class="skill-actions">
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="edit()">新增 Skill</el-button>
        </div>
      </template>

      <div class="skill-toolbar">
        <div class="status-tabs" role="tablist" aria-label="启用状态">
          <button
            v-for="option in statusOptions"
            :key="option.value"
            type="button"
            role="tab"
            class="status-tab"
            :class="{ 'is-active': status === option.value }"
            :aria-selected="status === option.value"
            @click="
              status = option.value;
              page = 1;
            "
          >
            {{ option.label }}
            <em class="tnum">{{ option.count }}</em>
          </button>
        </div>
        <div class="skill-toolbar__actions">
          <el-select
            v-model="taskTypeFilter"
            class="skill-select"
            aria-label="适用页面"
            @change="page = 1"
          >
            <el-option label="全部页面" value="all" />
            <el-option v-for="type in taskTypes" :key="type" :label="pageLabel(type)" :value="type" />
          </el-select>
          <el-select
            v-if="categories.length"
            v-model="categoryFilter"
            class="skill-select"
            aria-label="分类"
            @change="page = 1"
          >
            <el-option label="全部分类" value="all" />
            <el-option v-for="name in categories" :key="name" :label="name" :value="name" />
          </el-select>
          <el-input
            v-model="query"
            class="skill-search"
            placeholder="搜索名称、指令或标签"
            :prefix-icon="Search"
            clearable
            @input="page = 1"
            @clear="page = 1"
          />
          <el-button v-if="hasFilters" text @click="resetFilters">重置</el-button>
        </div>
      </div>

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />

      <AdminListShell
        class="skill-board"
        fill
        :has-prev="page > 1"
        :has-next="page * pageSize < filtered.length"
        :loading="loading"
        :page="page"
        :count="rows.length"
        :total="filtered.length"
        :page-size="pageSize"
        @update:page="page = $event"
      >
        <el-table
          v-loading="loading"
          class="skill-table"
          :data="rows"
          row-key="id"
          height="100%"
          table-layout="fixed"
        >
          <template #empty>
            <el-empty :description="hasFilters ? '没有符合条件的 Skill' : '还没有官方 Skill'" :image-size="64">
              <p v-if="!hasFilters" class="empty-sub">新增后用户即可在 Skill 中心装载</p>
            </el-empty>
          </template>
          <el-table-column label="Skill" min-width="220">
            <template #default="{ row }">
              <div class="skill-cell">
                <strong>{{ row.name }}</strong>
                <span>{{ row.description || "—" }}</span>
                <div v-if="row.tags.length" class="skill-cell__tags">
                  <el-tag v-for="tag in row.tags" :key="tag" size="small" effect="plain" type="info">{{ tag }}</el-tag>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="指令" min-width="280">
            <template #default="{ row }">
              <p class="skill-instruction" :title="row.instruction">{{ row.instruction }}</p>
            </template>
          </el-table-column>
          <el-table-column label="适用页面" min-width="180">
            <template #default="{ row }">
              <div v-if="row.taskTypes.length" class="skill-cell__tags">
                <el-tag v-for="type in row.taskTypes" :key="type" size="small" effect="light">
                  {{ pageLabel(type) }}
                </el-tag>
              </div>
              <span v-else class="cell-muted">全部生图页面</span>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="110">
            <template #default="{ row }">
              <span :class="row.category ? 'cell-text' : 'cell-muted'">{{ row.category || "未分类" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="排序" prop="sort" width="76" align="center" sortable />
          <el-table-column label="启用" width="80" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.active"
                :disabled="!!busyId"
                :aria-label="`${row.name}启用`"
                @change="toggle(row as ImageSkill)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="128" align="center" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" :icon="EditPen" :disabled="!!busyId" @click="edit(row as ImageSkill)">
                编辑
              </el-button>
              <el-button
                text
                size="small"
                type="danger"
                :icon="Delete"
                :disabled="!!busyId"
                @click="remove(row as ImageSkill)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="visible"
      :title="editingId ? '编辑 Skill' : '新增 Skill'"
      subtitle="指令会原样拼进用户的生图提示词，请写成可直接执行的画面要求"
      :icon="MagicStick"
      width="min(760px, 94vw)"
      nested-scroll
      confirm-text="保存 Skill"
      :confirm-loading="saving"
      footer-hint="保存后立即对已装载的用户生效"
      @confirm="save"
    >
      <el-alert v-if="saveError" :title="saveError" type="error" :closable="false" show-icon class="skill-form__error" />
      <el-form label-position="top" class="skill-form">
        <div class="skill-form__row">
          <el-form-item label="名称" required>
            <el-input v-model="form.name" :maxlength="NAME_MAX" show-word-limit placeholder="例如：柔光人像" />
          </el-form-item>
          <el-form-item label="分类">
            <el-select
              v-model="form.category"
              filterable
              allow-create
              default-first-option
              clearable
              placeholder="可新建，例如：人像"
            >
              <el-option v-for="name in categories" :key="name" :label="name" :value="name" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="简介">
          <el-input
            v-model="form.description"
            :maxlength="DESCRIPTION_MAX"
            show-word-limit
            placeholder="一句话说明这个 Skill 解决什么问题，展示给用户"
          />
        </el-form-item>
        <el-form-item label="指令内容" required>
          <el-input
            v-model="form.instruction"
            type="textarea"
            :rows="8"
            :maxlength="INSTRUCTION_MAX"
            show-word-limit
            resize="vertical"
            placeholder="例如：使用柔和顶光，背景纯净，主体居中，肤色自然通透。"
          />
        </el-form-item>
        <el-form-item label="适用页面">
          <el-select v-model="form.taskTypes" multiple collapse-tags collapse-tags-tooltip placeholder="留空表示全部生图页面通用">
            <el-option v-for="type in taskTypes" :key="type" :label="pageLabel(type)" :value="type" />
          </el-select>
        </el-form-item>
        <div class="skill-form__row">
          <el-form-item label="标签">
            <el-input v-model="form.tagsText" placeholder="用逗号分隔，例如：人像，柔光" />
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="form.sort" :min="0" :max="9999" :step="1" :precision="0" controls-position="right" />
          </el-form-item>
        </div>
        <el-form-item>
          <div class="skill-form__switch">
            <el-switch v-model="form.active" inline-prompt active-text="开" inactive-text="关" />
            <div>
              <strong>启用</strong>
              <span>停用后不再出现在用户的可装载列表，已装载的也会失效</span>
            </div>
          </div>
        </el-form-item>
      </el-form>
    </AdminDialog>
  </div>
</template>

<style scoped>
.skill-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.skill-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.skill-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.skill-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.skill-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.skill-toolbar__actions {
  display: inline-flex;
  flex: 1 1 320px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}
.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.status-tab:hover {
  color: var(--ink);
}
.status-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}
.status-tab em {
  color: var(--ink-3);
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
}
.status-tab.is-active em {
  color: var(--surface);
  opacity: 0.72;
}
.skill-select {
  width: 148px;
}
.skill-search {
  width: min(260px, 100%);
  flex: 1 1 180px;
  max-width: 280px;
}
.skill-board {
  flex: 1;
  min-height: 0;
}
.skill-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.skill-cell strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}
.skill-cell span {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.5;
}
.skill-cell__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.skill-instruction {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.skill-form :deep(.el-textarea__inner) {
  min-height: 180px;
  line-height: 1.7;
}
.cell-text {
  color: var(--ink-2);
  font-size: 12px;
}
.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}
.skill-form__error {
  margin-bottom: 12px;
}
.skill-form__row {
  display: grid;
  gap: 0 16px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.skill-form :deep(.el-select),
.skill-form :deep(.el-input-number) {
  width: 100%;
}
.skill-form__switch {
  display: flex;
  align-items: center;
  gap: 12px;
}
.skill-form__switch div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skill-form__switch strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}
.skill-form__switch span {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}
</style>
