<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Delete, Download, EditPen, MagicStick, Plus, Refresh, Search, Upload } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AdminDialog from "@/components/AdminDialog.vue";
import AdminListShell from "@/components/AdminListShell.vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";
import { TASK_TYPE_LABELS } from "@/utils";
import {
  buildSkillZip,
  parseSkillMarkdown,
  readSkillFile,
  readSkillZip,
  referenceTitle,
  isValidReferencePath,
  SKILL_REFERENCE_MAX_BYTES,
  SKILL_REFERENCE_MAX_FILES,
  type SkillMarkdownFields,
  type SkillReferenceFile,
  serializeSkillMarkdown,
  SKILL_FILE_EXTENSIONS,
  skillSourceUrlError,
} from "@/utils/skillMarkdown";

interface ImageSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  instruction: string;
  usageGuide: string;
  /** 改编来源（通常是 GitHub 仓库），用户端显示为跳转图标。 */
  sourceUrl: string;
  taskTypes: string[];
  category: string | null;
  tags: string[];
  sort: number;
  active: boolean;
  official: boolean;
  coverUrl: string | null;
  sampleImages: SkillSampleImage[];
  /** 参考资料份数（只在后台列表里有）。 */
  referenceCount?: number;
}

interface SkillSampleImage {
  key: string;
  url: string;
  caption: string;
}

interface SkillForm {
  name: string;
  slug: string;
  description: string;
  instruction: string;
  usageGuide: string;
  sourceUrl: string;
  taskTypes: string[];
  category: string;
  tagsText: string;
  sort: number;
  active: boolean;
}

const NAME_MAX = 64;
const SLUG_MAX = 64;
const DESCRIPTION_MAX = 500;
const INSTRUCTION_MAX = 4000;
const USAGE_GUIDE_MAX = 2000;
const SOURCE_URL_MAX = 300;
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const defaults = (): SkillForm => ({
  name: "",
  slug: "",
  description: "",
  instruction: "",
  usageGuide: "",
  sourceUrl: "",
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
const pageSize = ref(10);
const visible = ref(false);
const editingId = ref<string | undefined>();
const form = reactive<SkillForm>(defaults());
const slugTouched = ref(false);
const importWarnings = ref<string[]>([]);
const importInput = ref<HTMLInputElement | null>(null);
const coverInput = ref<HTMLInputElement | null>(null);
const sampleInput = ref<HTMLInputElement | null>(null);
const imageBusy = ref(false);
const newSampleCaption = ref("");
const SAMPLE_MAX = 6;
const SAMPLE_CAPTION_MAX = 200;
type EditorSection = "basic" | "usage" | "images" | "references" | "instruction" | "publish";
const activeSection = ref<EditorSection>("basic");
const editorScroll = ref<HTMLElement | null>(null);
/** 打开编辑器时的表单快照，用来判断有没有未保存的修改。 */
const savedSnapshot = ref("");
const formSnapshot = () => JSON.stringify(form);
const dirty = computed(() => visible.value && formSnapshot() !== savedSnapshot.value);

/** 表单顶部的分区锚点，每项带一行状态；必填缺失或格式错误时标红。 */
const editorSections = computed(() => {
  const skill = editingSkill.value;
  const instructionLength = form.instruction.trim().length;
  const usageLength = form.usageGuide.trim().length;
  const sampleCount = skill?.sampleImages.length || 0;
  return [
    {
      key: "basic" as const,
      label: "基本信息",
      status: form.name.trim() || "未填名称",
      error: !form.name.trim() || Boolean(slugError.value) || Boolean(sourceUrlError.value),
    },
    { key: "usage" as const, label: "使用说明", status: usageLength ? `${usageLength} 字` : "未填写", error: false },
    {
      key: "images" as const,
      label: "配图",
      status: !skill ? "保存后可传" : `${skill.coverUrl ? "有封面" : "无封面"} · ${sampleCount} 张`,
      error: false,
    },
    {
      key: "references" as const,
      label: "参考资料",
      status: !skill ? "保存后可加" : references.value.length ? `${references.value.length} 份` : "无",
      error: false,
    },
    { key: "instruction" as const, label: "模型指令", status: instructionLength ? `${instructionLength} 字` : "必填", error: !instructionLength },
    { key: "publish" as const, label: "发布设置", status: form.active ? "启用" : "停用", error: false },
  ];
});

/** 分区相对滚动容器顶部的位置（offsetTop 是相对弹窗算的，不能直接用）。 */
function sectionOffset(container: HTMLElement, section: HTMLElement) {
  return section.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

function scrollToSection(key: EditorSection) {
  const container = editorScroll.value;
  const target = container?.querySelector<HTMLElement>(`[data-section="${key}"]`);
  if (!container || !target) return;
  activeSection.value = key;
  container.scrollTo({ top: Math.max(0, sectionOffset(container, target) - 8) });
}

/** 滚动时高亮当前所在分区。 */
function onEditorScroll() {
  const container = editorScroll.value;
  if (!container) return;
  const sections = [...container.querySelectorAll<HTMLElement>("[data-section]")];
  let current = sections[0]?.dataset.section as EditorSection | undefined;
  for (const section of sections) {
    if (sectionOffset(container, section) - container.scrollTop <= 48) current = section.dataset.section as EditorSection;
  }
  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
    current = sections[sections.length - 1]?.dataset.section as EditorSection;
  }
  if (current) activeSection.value = current;
}

// ---------- 实时预览：和用户端技能库保持同一套展示规则 ----------

const previewName = computed(() => form.name.trim() || "技能名称");
const previewToken = computed(() => {
  const name = form.name.trim();
  if (name && !/[\s@/]/.test(name)) return `@${name}`;
  return form.slug.trim() ? `@${form.slug.trim()}` : "@调用名";
});
const previewTags = computed(() => parseTags(form.tagsText).filter((tag) => !form.name.includes(tag)).slice(0, 2));
const previewInitial = computed(() => Array.from(previewName.value)[0]);
/** 使用说明切成文字段和示例段：以 @ 开头的行是示例；单独的“示例：”标题省略。 */
const previewUsage = computed(() => {
  const segments: { kind: "text" | "examples"; lines: string[] }[] = [];
  for (const raw of form.usageGuide.split("\n")) {
    const line = raw.trim();
    if (/^示例[:：]?$/.test(line)) continue;
    const kind = line.startsWith("@") ? "examples" : "text";
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.lines.push(kind === "examples" ? line : raw);
    else segments.push({ kind, lines: [kind === "examples" ? line : raw] });
  }
  return segments.filter((segment) => segment.lines.join("").trim());
});

// ---------- 参考资料：只给 AI 助手按需读取，用户看不到 ----------

const references = ref<SkillReferenceFile[]>([]);
const referencesBusy = ref(false);
const referenceInput = ref<HTMLInputElement | null>(null);
const openedReference = ref("");

async function fetchReferences(id: string) {
  const data = await request<{ items: SkillReferenceFile[] }>(`/api/v1/admin/image-skills/${id}/references`, { silent: true });
  return data.items || [];
}

async function loadReferences() {
  references.value = [];
  openedReference.value = "";
  if (!editingId.value) return;
  try {
    references.value = await fetchReferences(editingId.value);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "读取参考资料失败");
  }
}

/** 参考资料整体保存：顺序、用途、增删都提交整份列表。 */
async function saveReferences(next: SkillReferenceFile[], success: string) {
  const id = editingId.value;
  if (!id) return;
  referencesBusy.value = true;
  try {
    await request(`/api/v1/admin/image-skills/${id}/references`, {
      method: "PUT",
      body: { items: next.map(({ path, title, purpose, content }) => ({ path, title, purpose, content })) },
      silent: true,
    });
    references.value = next;
    const item = items.value.find((skill) => skill.id === id);
    if (item) item.referenceCount = next.length;
    ElMessage.success(success);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存参考资料失败");
  } finally {
    referencesBusy.value = false;
  }
}

/** 文件名决定路径：references/<文件名>；同名文件视为替换。 */
async function onReferenceFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files || [])];
  input.value = "";
  if (!files.length) return;
  const next = references.value.map((item) => ({ ...item }));
  const problems: string[] = [];
  for (const file of files) {
    const name = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
    const path = `references/${name}`;
    if (!isValidReferencePath(path)) {
      problems.push(`${file.name}：只支持 .md / .txt，文件名用字母、数字、点、横线`);
      continue;
    }
    if (file.size > SKILL_REFERENCE_MAX_BYTES) {
      problems.push(`${file.name}：超过 ${SKILL_REFERENCE_MAX_BYTES / 1024} KB`);
      continue;
    }
    const content = await file.text();
    if (content.includes("\u0000") || !content.trim()) {
      problems.push(`${file.name}：不是文本或内容为空`);
      continue;
    }
    const existing = next.find((item) => item.path === path);
    if (existing) {
      existing.content = content;
      existing.title = referenceTitle(path, content);
    } else {
      next.push({ path, title: referenceTitle(path, content), purpose: "", content });
    }
  }
  if (problems.length) ElMessage.warning(problems.join("；"));
  if (next.length > SKILL_REFERENCE_MAX_FILES) {
    ElMessage.warning(`最多 ${SKILL_REFERENCE_MAX_FILES} 份参考资料`);
    return;
  }
  if (next.length !== references.value.length || problems.length < files.length) {
    await saveReferences(next, "参考资料已保存");
  }
}

function updateReferencePurpose(index: number, purpose: string) {
  const next = references.value.map((item) => ({ ...item }));
  if (!next[index] || (next[index].purpose || "") === purpose.trim()) return;
  next[index].purpose = purpose.trim();
  void saveReferences(next, "用途已保存");
}

function removeReference(index: number) {
  const next = references.value.filter((_, i) => i !== index);
  void saveReferences(next, "已删除");
}

function referenceSize(content: string) {
  const bytes = new Blob([content]).size;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/** 正在编辑的官方技能（配图要求技能已保存，才有 id 可挂）。 */
const editingSkill = computed(() => items.value.find((item) => item.id === editingId.value));
const selected = ref<ImageSkill[]>([]);

function suggestSlug(name: string) {
  let slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  while (slug && !/^[a-z]/.test(slug)) {
    const index = slug.indexOf("-");
    slug = index >= 0 ? slug.slice(index + 1) : "";
  }
  if (slug.length > SLUG_MAX) {
    slug = slug.slice(0, SLUG_MAX).replace(/-+$/g, "");
  }
  return slug;
}

function slugErrorOf(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > SLUG_MAX || !SLUG_PATTERN.test(trimmed)) {
    return "调用名需为字母开头的小写连字符格式，最长 64 个字符";
  }
  return "";
}

const slugError = computed(() => slugErrorOf(form.slug));
const sourceUrlError = computed(() => skillSourceUrlError(form.sourceUrl));

function onNameInput() {
  if (slugTouched.value) return;
  form.slug = suggestSlug(form.name);
}

function onSlugInput() {
  slugTouched.value = true;
}

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
    return [item.name, item.slug, item.description, item.instruction, item.usageGuide, item.tags.join(" ")]
      .join(" ")
      .toLocaleLowerCase()
      .includes(keyword);
  });
});

const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

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
    // 旧版接口没有配图字段，补默认值，模板里可以直接读。
    items.value = (data.items || []).map((item) => ({
      ...item,
      usageGuide: item.usageGuide || "",
      sourceUrl: item.sourceUrl || "",
      coverUrl: item.coverUrl || null,
      sampleImages: item.sampleImages || [],
    }));
    taskTypes.value = data.taskTypes || [];
    // 删除或筛选后当前页可能已越界，收回到最后一页。
    const maxPage = Math.max(1, Math.ceil(filtered.value.length / pageSize.value));
    if (page.value > maxPage) page.value = maxPage;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载 Skill 词库失败";
  } finally {
    loading.value = false;
  }
}

function edit(item?: ImageSkill) {
  saveError.value = "";
  importWarnings.value = [];
  activeSection.value = "basic";
  editingId.value = item?.id;
  slugTouched.value = Boolean(item?.slug);
  Object.assign(
    form,
    item
      ? {
          name: item.name,
          slug: item.slug || "",
          description: item.description,
          instruction: item.instruction,
          usageGuide: item.usageGuide || "",
          sourceUrl: item.sourceUrl || "",
          taskTypes: [...item.taskTypes],
          category: item.category || "",
          tagsText: item.tags.join("，"),
          sort: item.sort,
          active: item.active,
        }
      : defaults(),
  );
  savedSnapshot.value = formSnapshot();
  visible.value = true;
  void loadReferences();
  void nextTick(() => editorScroll.value?.scrollTo({ top: 0 }));
}

function parseTags(text: string) {
  return [...new Set(text.split(/[，,\n]/).map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * 保存后默认留在编辑器里（新建的技能拿到 id 后即可配图）；closeAfter 为真时保存并关闭。
 * 返回是否保存成功。
 */
async function save(closeAfter = false) {
  if (saving.value) return false;
  const name = form.name.trim();
  const instruction = form.instruction.trim();
  const slug = form.slug.trim();
  if (!name || slugError.value) {
    scrollToSection("basic");
    ElMessage.warning(slugError.value || "请填写 Skill 名称");
    return false;
  }
  if (sourceUrlError.value) {
    scrollToSection("basic");
    ElMessage.warning(sourceUrlError.value);
    return false;
  }
  if (!instruction) {
    scrollToSection("instruction");
    ElMessage.warning("请填写指令内容");
    return false;
  }
  saving.value = true;
  saveError.value = "";
  try {
    const body = {
      name,
      slug,
      description: form.description.trim(),
      instruction,
      usageGuide: form.usageGuide.trim(),
      sourceUrl: form.sourceUrl.trim(),
      taskTypes: form.taskTypes,
      category: form.category.trim(),
      tags: parseTags(form.tagsText),
      sort: form.sort,
      active: form.active,
    };
    const creating = !editingId.value;
    const saved = creating
      ? await request<ImageSkill>("/api/v1/admin/image-skills", { method: "POST", body, silent: true })
      : await request<ImageSkill>(`/api/v1/admin/image-skills/${editingId.value}`, { method: "PATCH", body, silent: true });
    if (creating && saved?.id) editingId.value = saved.id;
    importWarnings.value = [];
    savedSnapshot.value = formSnapshot();
    ElMessage.success(creating ? "Skill 已录入，可以继续配图" : "已保存");
    await load();
    if (closeAfter) visible.value = false;
    return true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "保存失败";
    return false;
  } finally {
    saving.value = false;
  }
}

/** 点 ×、Esc 或遮罩关闭前：有未保存的修改先确认。 */
async function confirmClose(done: () => void) {
  if (!dirty.value) return done();
  try {
    await ElMessageBox.confirm("有未保存的修改，关闭后会丢失。", "放弃修改？", {
      type: "warning",
      confirmButtonText: "放弃修改",
      cancelButtonText: "继续编辑",
    });
    done();
  } catch {
    // 继续编辑
  }
}

function closeEditor() {
  void confirmClose(() => {
    visible.value = false;
  });
}

function onEditorKeydown(event: KeyboardEvent) {
  if (!visible.value) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
  }
}

watch(visible, (open) => {
  if (open) window.addEventListener("keydown", onEditorKeydown);
  else window.removeEventListener("keydown", onEditorKeydown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onEditorKeydown));

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

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
      `确认永久删除「${item.name}」？用户将不能再通过 @ 调用这个技能。`,
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

function pickImportFile() {
  importInput.value?.click();
}

/**
 * 导入单个 SKILL.md：解析后填入编辑表单，管理员检查后再保存。
 * 调用名已被官方技能占用时让管理员选择覆盖更新，不静默新建重复项；
 * 覆盖时沿用原技能的适用页面、排序和启用状态，只替换文件里带的内容。
 */
/** 写库用的请求体：只含 SKILL.md 里有的字段，覆盖时适用页面、排序、启用和配图保持原样。 */
function skillBodyFromFile(skill: SkillMarkdownFields) {
  return {
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    instruction: skill.instruction,
    usageGuide: skill.usageGuide || "",
    sourceUrl: skill.sourceUrl || "",
    category: skill.category || "",
    tags: skill.tags,
  };
}

/** 批量导入“导出所选”生成的 zip：先列出新增 / 覆盖 / 跳过，确认后逐个写入。 */
async function importZip(file: File) {
  let result;
  try {
    result = readSkillZip(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "读取压缩包失败");
    return;
  }
  const skipped = [...result.skipped];
  const seen = new Set<string>();
  const plan: { skill: SkillMarkdownFields; references: SkillReferenceFile[]; existing?: ImageSkill }[] = [];
  for (const entry of result.skills) {
    const { skill } = entry;
    if (!skill.name || !skill.instruction) {
      skipped.push(`${entry.path}（缺名称或正文）`);
      continue;
    }
    if (skill.slug && seen.has(skill.slug)) {
      skipped.push(`${entry.path}（调用名 @${skill.slug} 在包里重复）`);
      continue;
    }
    if (skill.slug) seen.add(skill.slug);
    plan.push({
      skill,
      references: entry.references,
      existing: skill.slug ? items.value.find((item) => item.slug === skill.slug) : undefined,
    });
  }
  if (!plan.length) {
    ElMessage.warning(skipped.length ? `没有可导入的技能：${skipped.join("；")}` : "压缩包里没有 SKILL.md");
    return;
  }
  const creates = plan.filter((item) => !item.existing);
  const updates = plan.filter((item) => item.existing);
  const withReferences = plan.filter((item) => item.references.length);
  const line = (label: string, names: string[]) =>
    names.length ? h("p", { class: "skill-zip-plan__line" }, [h("strong", `${label} ${names.length} 个：`), names.join("、")]) : null;
  try {
    await ElMessageBox.confirm(
      h("div", { class: "skill-zip-plan" }, [
        line("新增", creates.map((item) => item.skill.name)),
        line("覆盖", updates.map((item) => item.skill.name)),
        line("跳过", skipped),
        line("附带参考资料", withReferences.map((item) => `${item.skill.name}（${item.references.length} 份）`)),
        h(
          "p",
          { class: "skill-zip-plan__note" },
          "覆盖只替换名称、简介、指令、使用说明、分类和标签；包里带参考资料的会整体替换参考资料，不带的保留原有资料。配图、适用页面、排序和启用状态保持原样。",
        ),
      ]),
      "批量导入 SKILL.md",
      { confirmButtonText: "开始导入", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  const failures: string[] = [];
  for (const { skill, references: refs, existing } of plan) {
    try {
      const body = skillBodyFromFile(skill);
      let id = existing?.id;
      if (existing) {
        await request(`/api/v1/admin/image-skills/${existing.id}`, { method: "PATCH", body, silent: true });
      } else {
        const created = await request<ImageSkill>("/api/v1/admin/image-skills", {
          method: "POST",
          body: { ...body, taskTypes: [], sort: 0, active: true },
          silent: true,
        });
        id = created?.id;
      }
      if (id && refs.length) {
        await request(`/api/v1/admin/image-skills/${id}/references`, {
          method: "PUT",
          body: { items: refs.map(({ path, title, purpose, content }) => ({ path, title, purpose, content })) },
          silent: true,
        });
      }
    } catch (err) {
      failures.push(`${skill.name}：${err instanceof Error ? err.message : "保存失败"}`);
    }
  }
  await load();
  const done = plan.length - failures.length;
  if (failures.length) {
    ElMessageBox.alert(failures.join("\n"), `已导入 ${done} 个，${failures.length} 个失败`, { type: "warning" });
  } else {
    ElMessage.success(`已导入 ${done} 个技能`);
  }
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.name.toLowerCase().endsWith(".zip")) {
    await importZip(file);
    return;
  }
  let parsed;
  try {
    parsed = parseSkillMarkdown(await readSkillFile(file));
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "读取文件失败");
    return;
  }
  const { skill, warnings } = parsed;
  const existing = skill.slug ? items.value.find((item) => item.slug === skill.slug) : undefined;
  if (existing) {
    try {
      await ElMessageBox.confirm(
        `调用名 @${skill.slug} 已被「${existing.name}」使用。覆盖更新会用文件内容替换它的名称、简介、指令、使用说明、分类和标签。`,
        "调用名已存在",
        { type: "warning", confirmButtonText: "覆盖更新", cancelButtonText: "取消" },
      );
    } catch {
      return;
    }
  }
  edit(existing);
  Object.assign(form, {
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    instruction: skill.instruction,
    usageGuide: skill.usageGuide || "",
    sourceUrl: skill.sourceUrl || "",
    category: skill.category || "",
    tagsText: skill.tags.join("，"),
  });
  slugTouched.value = Boolean(skill.slug);
  importWarnings.value = warnings;
}

// ---------- 配图：封面 + 效果示例图 ----------

function replaceItem(updated: ImageSkill) {
  const index = items.value.findIndex((item) => item.id === updated.id);
  if (index >= 0) items.value.splice(index, 1, updated);
}

async function sendSkillImage(path: string, method: "PUT" | "POST", file: File, caption = "") {
  const body = new FormData();
  body.append("file", file);
  if (caption) body.append("caption", caption);
  const res = await fetch(path, { method, credentials: "include", body });
  const payload = (await res.json().catch(() => null)) as { success?: boolean; data?: ImageSkill; error?: string } | null;
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.error || `图片上传失败（HTTP ${res.status}）`);
  }
  return payload.data;
}

async function withImageBusy(task: () => Promise<ImageSkill | undefined>, success: string) {
  imageBusy.value = true;
  try {
    const updated = await task();
    if (updated) replaceItem(updated);
    ElMessage.success(success);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "操作失败");
  } finally {
    imageBusy.value = false;
  }
}

function pickedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  return file;
}

function onCoverFile(event: Event) {
  const file = pickedFile(event);
  const skill = editingSkill.value;
  if (!file || !skill) return;
  void withImageBusy(() => sendSkillImage(`/api/v1/admin/image-skills/${skill.id}/cover`, "PUT", file), "封面已更新");
}

function removeCover() {
  const skill = editingSkill.value;
  if (!skill) return;
  void withImageBusy(
    () => request<ImageSkill>(`/api/v1/admin/image-skills/${skill.id}/cover`, { method: "DELETE", silent: true }),
    "封面已移除",
  );
}

function onSampleFile(event: Event) {
  const file = pickedFile(event);
  const skill = editingSkill.value;
  if (!file || !skill) return;
  const caption = newSampleCaption.value.trim();
  void withImageBusy(async () => {
    const updated = await sendSkillImage(`/api/v1/admin/image-skills/${skill.id}/samples`, "POST", file, caption);
    newSampleCaption.value = "";
    return updated;
  }, "示例图已添加");
}

/** 示例图的顺序、说明和删除都整体提交，服务端只接受已上传过的图片。 */
function saveSamples(next: SkillSampleImage[], success: string) {
  const skill = editingSkill.value;
  if (!skill) return;
  void withImageBusy(
    () =>
      request<ImageSkill>(`/api/v1/admin/image-skills/${skill.id}/samples`, {
        method: "PUT",
        body: { items: next.map(({ key, caption }) => ({ key, caption })) },
        silent: true,
      }),
    success,
  );
}

function moveSample(index: number, offset: number) {
  const list = [...(editingSkill.value?.sampleImages || [])];
  const target = index + offset;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  saveSamples(list, "顺序已调整");
}

function removeSample(index: number) {
  const list = [...(editingSkill.value?.sampleImages || [])];
  list.splice(index, 1);
  saveSamples(list, "示例图已删除");
}

function updateSampleCaption(index: number, caption: string) {
  const list = (editingSkill.value?.sampleImages || []).map((item) => ({ ...item }));
  if (!list[index] || list[index].caption === caption.trim()) return;
  list[index].caption = caption.trim();
  saveSamples(list, "说明已保存");
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 带参考资料的技能要连资料一起导出，只能打成 zip。 */
async function withReferences(skills: ImageSkill[]) {
  return Promise.all(
    skills.map(async (skill) => ({ ...skill, references: skill.referenceCount ? await fetchReferences(skill.id) : [] })),
  );
}

async function exportOne(item: ImageSkill) {
  try {
    if (item.referenceCount) {
      const zip = buildSkillZip(await withReferences([item]));
      saveBlob(new Blob([zip], { type: "application/zip" }), `${item.slug || "skill"}.zip`);
      return;
    }
    saveBlob(new Blob([serializeSkillMarkdown(item)], { type: "text/markdown;charset=utf-8" }), `${item.slug || "skill"}.SKILL.md`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "导出失败");
  }
}

async function exportSelected() {
  if (!selected.value.length) return;
  try {
    const zip = buildSkillZip(await withReferences(selected.value));
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlob(new Blob([zip], { type: "application/zip" }), `official-skills-${stamp}.zip`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "导出失败");
  }
}

function onSelectionChange(rows: ImageSkill[]) {
  selected.value = rows;
}

onMounted(load);
</script>

<template>
  <div class="skill-page">
    <PageCard
      title="官方 Skill 词库"
      :subtitle="`${counts.all} 个官方技能 · 启用中 ${counts.enabled} · 用户在输入框输入 @ 选中后，指令会拼进提示词`"
    >
      <template #actions>
        <div class="skill-actions">
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <el-button :icon="Download" :disabled="!selected.length" @click="exportSelected">
            导出所选{{ selected.length ? ` ${selected.length}` : "" }}
          </el-button>
          <el-button :icon="Upload" @click="pickImportFile">导入 SKILL.md / zip</el-button>
          <input
            ref="importInput"
            class="skill-import-input"
            type="file"
            :accept="[...SKILL_FILE_EXTENSIONS, '.zip'].join(',')"
            @change="onImportFile"
          />
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
            placeholder="搜索名称、调用名、指令或标签"
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
        @update:page-size="(size: number) => { pageSize = size; page = 1 }"
      >
        <el-table
          v-loading="loading"
          class="skill-table"
          :data="rows"
          row-key="id"
          height="100%"
          table-layout="fixed"
          @selection-change="onSelectionChange"
        >
          <template #empty>
            <el-empty :description="hasFilters ? '没有符合条件的 Skill' : '还没有官方 Skill'" :image-size="64">
              <p v-if="!hasFilters" class="empty-sub">新增后用户即可在技能库看到并用 @ 调用</p>
            </el-empty>
          </template>
          <el-table-column type="selection" width="44" reserve-selection />
          <el-table-column label="Skill" min-width="270">
            <template #default="{ row }">
              <div class="skill-cell">
                <div class="skill-cell__thumb">
                  <img v-if="row.coverUrl" :src="row.coverUrl" alt="" loading="lazy" />
                  <span v-else>{{ Array.from(row.name || "技")[0] }}</span>
                </div>
                <div class="skill-cell__main">
                  <div class="skill-cell__title">
                    <strong>{{ row.name }}</strong>
                    <code v-if="row.slug" class="skill-cell__slug">@{{ row.slug }}</code>
                  </div>
                  <span class="skill-cell__desc" :title="row.description">{{ row.description || "—" }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="内容" width="144">
            <template #default="{ row }">
              <ul class="skill-status">
                <li>指令 <b class="tnum">{{ row.instruction.length }}</b> 字</li>
                <li :class="{ 'is-missing': !row.usageGuide }">
                  {{ row.usageGuide ? "已写使用说明" : "缺使用说明" }}
                </li>
                <li :class="{ 'is-missing': !row.coverUrl && !row.sampleImages.length }">
                  {{ row.coverUrl ? "有封面" : "无封面" }} · 示例图 <b class="tnum">{{ row.sampleImages.length }}</b>
                </li>
                <li v-if="row.referenceCount">参考资料 <b class="tnum">{{ row.referenceCount }}</b> 份</li>
              </ul>
            </template>
          </el-table-column>
          <el-table-column label="分类 / 页面" min-width="144">
            <template #default="{ row }">
              <div class="skill-cell__meta">
                <span>
                  <span :class="row.category ? 'cell-text' : 'cell-muted'">{{ row.category || "未分类" }}</span>
                  <span class="cell-muted">
                    · {{ row.taskTypes.length ? row.taskTypes.map((type: string) => pageLabel(type)).join("、") : "全部页面" }}
                  </span>
                </span>
                <div v-if="row.tags.length" class="skill-cell__tags">
                  <el-tag v-for="tag in row.tags.slice(0, 3)" :key="tag" size="small" effect="plain" type="info">{{ tag }}</el-tag>
                  <span v-if="row.tags.length > 3" class="cell-muted">+{{ row.tags.length - 3 }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="排序" prop="sort" width="76" align="center" sortable />
          <el-table-column label="启用" width="64" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.active"
                :disabled="!!busyId"
                :aria-label="`${row.name}启用`"
                @change="toggle(row as ImageSkill)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="196" align="center" fixed="right">
            <template #default="{ row }">
              <div class="skill-row-actions">
                <el-button text size="small" :icon="EditPen" :disabled="!!busyId" @click="edit(row as ImageSkill)">
                  编辑
                </el-button>
                <el-button text size="small" :icon="Download" @click="exportOne(row as ImageSkill)">导出</el-button>
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
              </div>
            </template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="visible"
      :title="editingId ? `编辑 Skill · ${form.name || '未命名'}` : '新增 Skill'"
      subtitle="左边编辑，右边是用户在技能库里看到的样子"
      :icon="MagicStick"
      width="min(1320px, 96vw)"
      panel-class="skill-editor-dialog"
      nested-scroll
      :close-on-click-modal="false"
      :before-close="confirmClose"
    >
      <template #meta>
        <span v-if="dirty" class="skill-editor__state is-dirty">未保存</span>
        <span v-else-if="editingId" class="skill-editor__state">已保存</span>
      </template>
      <el-alert v-if="saveError" :title="saveError" type="error" :closable="false" show-icon class="skill-form__error" />
      <el-alert
        v-if="importWarnings.length"
        title="导入提示，保存前请检查"
        type="warning"
        :closable="false"
        show-icon
        class="skill-form__error"
      >
        <ul class="skill-import-warnings">
          <li v-for="warning in importWarnings" :key="warning">{{ warning }}</li>
        </ul>
      </el-alert>
      <div class="skill-editor">
        <div class="skill-editor__main">
          <nav class="skill-editor__anchors" aria-label="编辑分区">
            <button
              v-for="section in editorSections"
              :key="section.key"
              type="button"
              class="skill-editor__anchor"
              :class="{ 'is-active': activeSection === section.key, 'has-error': section.error }"
              @click="scrollToSection(section.key)"
            >
              <strong>{{ section.label }}</strong>
              <span>{{ section.status }}</span>
            </button>
          </nav>

          <div ref="editorScroll" class="skill-editor__scroll" @scroll.passive="onEditorScroll">
            <el-form label-position="top" class="skill-editor__form" @submit.prevent>
              <section data-section="basic" class="skill-editor__section">
                <h3>基本信息<small>名称、简介和标签会展示在用户的技能库里</small></h3>
                <div class="skill-form__row">
                  <el-form-item label="名称" required>
                    <el-input v-model="form.name" :maxlength="NAME_MAX" show-word-limit placeholder="例如：柔光人像" @input="onNameInput" />
                  </el-form-item>
                  <el-form-item label="调用名" :error="slugError">
                    <el-input
                      v-model="form.slug"
                      :maxlength="SLUG_MAX"
                      show-word-limit
                      placeholder="留空自动生成，例如 soft-light"
                      @input="onSlugInput"
                    />
                  </el-form-item>
                </div>
                <el-form-item label="简介">
                  <el-input
                    v-model="form.description"
                    type="textarea"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    :maxlength="DESCRIPTION_MAX"
                    show-word-limit
                    resize="none"
                    placeholder="一句话说明这个 Skill 解决什么问题，显示在技能卡片和详情里"
                  />
                </el-form-item>
                <div class="skill-form__row">
                  <el-form-item label="分类">
                    <el-select v-model="form.category" filterable allow-create default-first-option clearable placeholder="可新建，例如：人像">
                      <el-option v-for="name in categories" :key="name" :label="name" :value="name" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="标签">
                    <el-input v-model="form.tagsText" placeholder="用逗号分隔，例如：人像，柔光" />
                  </el-form-item>
                </div>
                <el-form-item label="来源地址" :error="sourceUrlError">
                  <el-input
                    v-model="form.sourceUrl"
                    :maxlength="SOURCE_URL_MAX"
                    clearable
                    placeholder="改编自开源项目时填上游仓库，例如 https://github.com/作者/仓库；用户端显示为跳转图标"
                  />
                </el-form-item>
              </section>

              <section data-section="usage" class="skill-editor__section">
                <h3>使用说明<small>详情“怎么用”的内容；以 @ 开头的行会显示成可复制的示例</small></h3>
                <el-form-item>
                  <el-input
                    v-model="form.usageGuide"
                    type="textarea"
                    :autosize="{ minRows: 8, maxRows: 18 }"
                    :maxlength="USAGE_GUIDE_MAX"
                    show-word-limit
                    resize="none"
                    placeholder="这个技能适合做什么、需求怎么写，附两三条示例，例如：&#10;@材质插画 画一张流程图解：……"
                  />
                </el-form-item>
              </section>

              <section data-section="images" class="skill-editor__section">
                <h3>配图<small>封面显示在卡片和详情顶部；示例图显示在“怎么用”里</small></h3>
                <div v-if="!editingSkill" class="skill-editor__empty">
              <strong>保存后就能配图</strong>
              <span>配图挂在已保存的技能上。填好名称和指令后保存一次，编辑器不会关闭，可以接着上传封面和示例图。</span>
              <div><el-button type="primary" plain :loading="saving" @click="save()">保存并开始配图</el-button></div>
            </div>
            <div v-else class="skill-images" v-loading="imageBusy">
              <div class="skill-images__cover">
                <div class="skill-images__thumb is-cover">
                  <img v-if="editingSkill.coverUrl" :src="editingSkill.coverUrl" alt="封面" />
                  <span v-else>无封面</span>
                </div>
                <div class="skill-images__cover-actions">
                  <strong>封面</strong>
                  <span>显示在技能库卡片和详情顶部，建议横图</span>
                  <div>
                    <el-button size="small" :disabled="imageBusy" @click="coverInput?.click()">
                      {{ editingSkill.coverUrl ? "更换" : "上传" }}
                    </el-button>
                    <el-button v-if="editingSkill.coverUrl" size="small" text type="danger" :disabled="imageBusy" @click="removeCover">
                      移除
                    </el-button>
                  </div>
                </div>
                <input ref="coverInput" class="skill-import-input" type="file" accept="image/png,image/jpeg,image/webp" @change="onCoverFile" />
              </div>

              <div class="skill-images__head">
                <strong>效果示例图</strong>
                <span>{{ editingSkill.sampleImages.length }} / {{ SAMPLE_MAX }} · 说明建议写生成它用的提示词</span>
              </div>
              <div class="skill-images__grid">
                <div v-for="(sample, index) in editingSkill.sampleImages" :key="sample.key" class="skill-images__item">
                  <div class="skill-images__thumb"><img :src="sample.url" :alt="sample.caption || `示例 ${index + 1}`" /></div>
                  <el-input
                    :model-value="sample.caption"
                    type="textarea"
                    :rows="2"
                    :maxlength="SAMPLE_CAPTION_MAX"
                    placeholder="说明（可选）"
                    :disabled="imageBusy"
                    @change="(value: string) => updateSampleCaption(index, value)"
                  />
                  <div class="skill-images__item-actions">
                    <el-button size="small" text :disabled="imageBusy || index === 0" @click="moveSample(index, -1)">前移</el-button>
                    <el-button
                      size="small"
                      text
                      :disabled="imageBusy || index === editingSkill.sampleImages.length - 1"
                      @click="moveSample(index, 1)"
                    >
                      后移
                    </el-button>
                    <el-button size="small" text type="danger" :disabled="imageBusy" @click="removeSample(index)">删除</el-button>
                  </div>
                </div>
                <div v-if="editingSkill.sampleImages.length < SAMPLE_MAX" class="skill-images__item is-add">
                  <el-input
                    v-model="newSampleCaption"
                    type="textarea"
                    :rows="3"
                    :maxlength="SAMPLE_CAPTION_MAX"
                    placeholder="新示例图的说明（可选），例如：@材质插画 画一张流程图解……"
                  />
                  <el-button size="small" :disabled="imageBusy" @click="sampleInput?.click()">选择图片并添加</el-button>
                  <input ref="sampleInput" class="skill-import-input" type="file" accept="image/png,image/jpeg,image/webp" @change="onSampleFile" />
                </div>
              </div>
              <p class="skill-form__hint">配图上传后立即生效，不需要再点保存。SKILL.md 导入导出不包含配图。</p>
            </div>
              </section>

              <section data-section="references" class="skill-editor__section">
                <h3>参考资料<small>只给 AI 助手按需读取；用户看不到，也不会拼进生图提示词</small></h3>
                <div v-if="!editingSkill" class="skill-editor__empty">
                  <strong>保存后就能添加参考资料</strong>
                  <span>先保存技能，再上传 .md / .txt 资料，并为每份写一句“什么时候读”。</span>
                </div>
                <div v-else v-loading="referencesBusy" class="skill-refs">
                  <p v-if="!references.length" class="skill-form__hint">
                    还没有参考资料。适合放不必每次都发给模型的长内容：风格细则、提示词模板、检查清单等。
                  </p>
                  <div v-for="(item, index) in references" :key="item.path" class="skill-refs__item">
                    <div class="skill-refs__head">
                      <code>{{ item.path }}</code>
                      <span class="skill-refs__title">{{ item.title }}</span>
                      <span class="skill-refs__size">{{ referenceSize(item.content) }}</span>
                      <el-button size="small" text @click="openedReference = openedReference === item.path ? '' : item.path">
                        {{ openedReference === item.path ? "收起" : "查看" }}
                      </el-button>
                      <el-button size="small" text type="danger" :disabled="referencesBusy" @click="removeReference(index)">删除</el-button>
                    </div>
                    <el-input
                      :model-value="item.purpose"
                      :maxlength="200"
                      placeholder="什么时候读这份资料？例如：写出图提示词前读（助手据此决定读哪份）"
                      :disabled="referencesBusy"
                      @change="(value: string) => updateReferencePurpose(index, value)"
                    />
                    <pre v-if="openedReference === item.path" class="skill-refs__content">{{ item.content }}</pre>
                  </div>
                  <div class="skill-refs__actions">
                    <el-button size="small" :disabled="referencesBusy || references.length >= SKILL_REFERENCE_MAX_FILES" @click="referenceInput?.click()">
                      添加 .md / .txt
                    </el-button>
                    <span class="skill-form__hint">同名文件会替换；最多 {{ SKILL_REFERENCE_MAX_FILES }} 份，单份不超过 64 KB。即时保存。</span>
                  </div>
                  <input ref="referenceInput" class="skill-import-input" type="file" multiple accept=".md,.markdown,.txt" @change="onReferenceFiles" />
                </div>
              </section>

              <section data-section="instruction" class="skill-editor__section">
                <h3>模型指令<small>只发给模型，用户看不到；用户 @ 调用时由服务端拼进请求</small></h3>
                <el-form-item required>
                  <el-input
                    v-model="form.instruction"
                    type="textarea"
                    :autosize="{ minRows: 12, maxRows: 30 }"
                    :maxlength="INSTRUCTION_MAX"
                    show-word-limit
                    resize="none"
                    placeholder="例如：使用柔和顶光，背景纯净，主体居中，肤色自然通透。"
                  />
                </el-form-item>
              </section>

              <section data-section="publish" class="skill-editor__section">
                <h3>发布设置</h3>
                <div class="skill-form__row">
                  <el-form-item label="适用页面">
                    <el-select v-model="form.taskTypes" multiple collapse-tags collapse-tags-tooltip placeholder="留空表示全部页面通用">
                      <el-option v-for="type in taskTypes" :key="type" :label="pageLabel(type)" :value="type" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="排序">
                    <el-input-number v-model="form.sort" :min="0" :max="9999" :step="1" :precision="0" controls-position="right" />
                  </el-form-item>
                </div>
                <div class="skill-form__switch">
                  <el-switch v-model="form.active" inline-prompt active-text="开" inactive-text="关" />
                  <div>
                    <strong>启用</strong>
                    <span>停用后不再出现在用户的技能库与 @ 菜单里</span>
                  </div>
                </div>
              </section>
            </el-form>
          </div>
        </div>

        <aside class="skill-preview" aria-label="用户端预览">
          <div class="skill-preview__label">用户看到的样子</div>
          <div class="skill-preview__scroll">
            <div class="skill-preview__card">
              <div class="skill-preview__cover">
                <img v-if="editingSkill?.coverUrl" :src="editingSkill.coverUrl" alt="" />
                <span v-else class="skill-preview__initial">{{ previewInitial }}</span>
                <em>官方</em>
              </div>
              <div class="skill-preview__card-body">
                <strong>{{ previewName }}</strong>
                <p :class="{ 'is-empty': !form.description.trim() }">{{ form.description.trim() || "还没有简介" }}</p>
                <div class="skill-preview__foot">
                  <code>{{ previewToken }}</code>
                  <span v-for="tag in previewTags" :key="tag">#{{ tag }}</span>
                </div>
              </div>
            </div>

            <div class="skill-preview__menu">
              <span class="skill-preview__sub">输入框 @ 菜单</span>
              <div class="skill-preview__menu-item">
                <strong>{{ previewName }}</strong>
                <span>{{ form.description.trim() || "—" }}</span>
              </div>
            </div>

            <div class="skill-preview__detail">
              <span class="skill-preview__sub">详情 · 怎么用</span>
              <div v-if="editingSkill?.sampleImages.length" class="skill-preview__samples">
                <img v-for="sample in editingSkill.sampleImages" :key="sample.key" :src="sample.url" :alt="sample.caption" />
              </div>
              <template v-if="previewUsage.length">
                <template v-for="(segment, index) in previewUsage" :key="index">
                  <ul v-if="segment.kind === 'examples'" class="skill-preview__examples">
                    <li v-for="line in segment.lines" :key="line">{{ line }}</li>
                  </ul>
                  <p v-else class="skill-preview__text">{{ segment.lines.join("\n").trim() }}</p>
                </template>
              </template>
              <p v-else class="skill-preview__text is-empty">还没有使用说明，用户只能看到“输入 {{ previewToken }} 后接着写需求”。</p>
            </div>
          </div>
        </aside>
      </div>

      <template #footer>
        <div class="skill-editor__footer">
          <span class="skill-editor__hint">
            {{ isMac ? "⌘" : "Ctrl" }} + S 保存 · 配图上传后立即生效
          </span>
          <div class="skill-editor__actions">
            <el-button @click="closeEditor">关闭</el-button>
            <el-button :loading="saving" @click="save()">保存</el-button>
            <el-button type="primary" :loading="saving" @click="save(true)">保存并关闭</el-button>
          </div>
        </div>
      </template>
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
/* 头部按钮较多，窄屏时整体换行，避免把标题挤成竖排。 */
.skill-page :deep(.page-card__header) {
  flex-wrap: wrap;
}
.skill-page :deep(.page-card__copy) {
  flex: 1 1 240px;
}
.skill-page :deep(.page-card__actions) {
  flex-shrink: 1;
  min-width: 0;
}
.skill-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
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
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 4px 0;
}
.skill-cell__thumb {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 88px;
  height: 50px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent-soft), var(--surface-2));
  color: var(--accent-ink);
  font-size: 20px;
  font-weight: 800;
}
.skill-cell__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.skill-cell__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.skill-cell__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}
.skill-cell__title strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}
.skill-cell__slug {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.skill-cell__desc {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.skill-cell__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.skill-status {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.5;
}
.skill-status li::before {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--success);
  content: "";
  vertical-align: 1px;
}
.skill-status li.is-missing {
  color: var(--ink-3);
}
.skill-status li.is-missing::before {
  background: var(--warning);
}
.skill-status b {
  color: var(--ink);
  font-weight: 700;
}
.skill-row-actions {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
}
.skill-row-actions .el-button + .el-button {
  margin-left: 2px;
}
.skill-cell__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.skill-editor__form :deep(.el-textarea__inner) {
  line-height: 1.7;
}
/* 编辑器：左侧单列表单（顶部分区锚点），右侧固定的用户端实时预览 */
.skill-editor {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  min-height: 0;
}
.skill-editor__main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.skill-editor__anchors {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: var(--surface-2);
}
.skill-editor__anchor {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
}
.skill-editor__anchor:hover {
  color: var(--ink);
}
.skill-editor__anchor strong {
  font-size: 13px;
  font-weight: 700;
}
.skill-editor__anchor span {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-editor__anchor.is-active {
  border-color: var(--border);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.skill-editor__anchor.has-error span {
  color: var(--danger);
}
.skill-editor__anchor:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.skill-editor__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 8px;
  scroll-behavior: smooth;
  scrollbar-width: thin;
}
.skill-editor__section {
  padding: 4px 0 18px;
}
.skill-editor__section + .skill-editor__section {
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.skill-editor__section h3 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0 0 14px;
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
}
.skill-editor__section h3 small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 500;
}
.skill-editor__section .el-form-item:last-child {
  margin-bottom: 0;
}
.skill-editor__state {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 700;
}
.skill-editor__state.is-dirty {
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--warning);
}
.skill-editor__empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 22px;
  border: 1px dashed var(--border-strong);
  border-radius: 14px;
  background: var(--surface-2);
}
.skill-editor__empty strong {
  color: var(--ink);
  font-size: 14px;
}
.skill-editor__empty span {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
}
.skill-editor__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.skill-editor__hint {
  color: var(--ink-3);
  font-size: 12px;
}
.skill-editor__actions {
  display: inline-flex;
  gap: 8px;
}
.skill-editor__actions .el-button + .el-button {
  margin-left: 0;
}

/* 参考资料 */
.skill-refs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skill-refs__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.skill-refs__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.skill-refs__head code {
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.skill-refs__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-refs__size {
  color: var(--ink-3);
  font-size: 11.5px;
  white-space: nowrap;
}
.skill-refs__head .el-button + .el-button {
  margin-left: 0;
}
.skill-refs__content {
  max-height: 260px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.skill-refs__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.skill-refs__actions .skill-form__hint {
  margin: 0;
}

/* 右侧预览 */
.skill-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px;
  border-radius: 18px;
  background: var(--surface-2);
}
.skill-preview__label {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.skill-preview__scroll {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.skill-preview__sub {
  display: block;
  margin-bottom: 6px;
  color: var(--ink-3);
  font-size: 11.5px;
  font-weight: 600;
}
.skill-preview__card {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}
.skill-preview__cover {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(135deg, #e9e6ff, #f6f1ea);
}
.skill-preview__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.skill-preview__initial {
  color: rgba(17, 18, 24, 0.55);
  font-family: "Songti SC", "Noto Serif SC", serif;
  font-size: 44px;
  font-weight: 700;
}
.skill-preview__cover em {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(17, 18, 24, 0.78);
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}
.skill-preview__card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px 14px;
}
.skill-preview__card-body strong {
  color: var(--ink);
  font-size: 14px;
}
.skill-preview__card-body p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.skill-preview__card-body p.is-empty,
.skill-preview__text.is-empty {
  color: var(--ink-3);
  font-style: italic;
}
.skill-preview__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 11.5px;
}
.skill-preview__foot code {
  padding: 1px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, #5b4dff 14%, transparent);
  color: #5b4dff;
  font-size: 11.5px;
  font-weight: 650;
}
.skill-preview__menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.skill-preview__menu-item strong {
  color: var(--ink);
  font-size: 13px;
}
.skill-preview__menu-item span {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-preview__detail {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}
.skill-preview__samples {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}
.skill-preview__samples img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  object-fit: cover;
}
.skill-preview__text {
  margin: 0 0 8px;
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.skill-preview__examples {
  display: grid;
  gap: 6px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}
.skill-preview__examples li {
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.55;
}
:global(html.dark) .skill-preview__cover {
  background: linear-gradient(135deg, #2a2640, #2b2a25);
}
:global(html.dark) .skill-preview__initial {
  color: rgba(255, 255, 255, 0.78);
}
@media (prefers-reduced-motion: reduce) {
  .skill-editor__scroll {
    scroll-behavior: auto;
  }
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
.skill-import-input {
  display: none;
}
.skill-images {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.skill-images__cover {
  display: flex;
  align-items: center;
  gap: 14px;
}
.skill-images__cover-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skill-images__cover-actions strong,
.skill-images__head strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}
.skill-images__cover-actions span,
.skill-images__head span {
  color: var(--ink-3);
  font-size: 12px;
}
.skill-images__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.skill-images__thumb {
  display: grid;
  place-items: center;
  overflow: hidden;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
}
.skill-images__thumb.is-cover {
  width: 160px;
  aspect-ratio: 16 / 9;
}
.skill-images__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.skill-images__grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.skill-images__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.skill-images__item.is-add {
  justify-content: center;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 10px;
}
.skill-images__item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.skill-images__item-actions .el-button + .el-button {
  margin-left: 0;
}
.skill-import-warnings {
  margin: 4px 0 0;
  padding-left: 18px;
}
.skill-form__error {
  margin-bottom: 12px;
}
.skill-form__hint {
  margin: 6px 0 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}
.skill-form__row {
  display: grid;
  gap: 0 16px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.skill-editor__form :deep(.el-select),
.skill-editor__form :deep(.el-input-number) {
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

<style>
/* 批量导入确认框挂在 body 上，不能用 scoped 样式 */
.skill-zip-plan__line {
  margin: 0 0 8px;
  line-height: 1.6;
  word-break: break-all;
}
.skill-zip-plan__note {
  margin: 10px 0 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
}
</style>
