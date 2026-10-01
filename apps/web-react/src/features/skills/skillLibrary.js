/**
 * 技能库的存储层：本地（localStorage，仅此浏览器）+ 云端（账号下，有配额）+ 官方（只读）。
 *
 * 对上只暴露一份合并后的列表，每一项带 storage 字段；增删改按 storage 分流。
 * 提交提示词时由 expandSkillMentions 读取缓存的列表，把 `@技能` 展开进提示词——
 * 读取失败一律按"没有技能"处理，绝不能挡住生成或发送。
 */
import { apiDelete, apiGet, apiPatch, apiPost } from "../../legacy-modules/services/apiClient.js";
import { getAuthSession } from "../../legacy-modules/services/auth.js";

import {
  SKILL_CLOUD_MAX_DEFAULT,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_INSTRUCTION_MAX_LENGTH,
  SKILL_LOCAL_MAX,
  SKILL_NAME_MAX_LENGTH,
  SKILL_STORAGE_CLOUD,
  SKILL_STORAGE_LOCAL,
  SKILL_STORAGE_OFFICIAL,
  SKILL_TAG_MAX_LENGTH,
  expandSkillMentionsInText,
  fallbackSkillSlug,
  isValidSkillSlug,
  sanitizeSkillLine,
  sanitizeSkillTags,
  sanitizeSkillText,
  slugifySkillName,
} from "./skillComposition.js";

export const SKILL_LIBRARY_UPDATED_EVENT = "starclouds:skill-library-updated";
const LOCAL_KEY = "starclouds:local-skills:v1";
const CACHE_TTL_MS = 60_000;

// ---------- 本地存储 ----------

function readLocalRaw() {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalRaw(items) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
}

function newLocalId() {
  const random =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `local-${random}`;
}

// 无论来自 localStorage 还是接口，都按同一套规则清洗与裁剪：localStorage 可被
// 其他脚本/扩展改写，接口数据也可能来自旧版本。
function normalizeSkill(raw, storage) {
  if (!raw || typeof raw !== "object") return null;
  const name = sanitizeSkillLine(raw.name, SKILL_NAME_MAX_LENGTH);
  const instruction = sanitizeSkillText(raw.instruction, SKILL_INSTRUCTION_MAX_LENGTH);
  if (!name || !instruction) return null;
  const id = sanitizeSkillLine(raw.id, 80) || newLocalId();
  let slug = String(raw.slug || "").trim().toLowerCase();
  if (!isValidSkillSlug(slug)) slug = slugifySkillName(name) || fallbackSkillSlug(id);
  return {
    id,
    slug,
    name,
    description: sanitizeSkillLine(raw.description, SKILL_DESCRIPTION_MAX_LENGTH),
    instruction,
    tags: sanitizeSkillTags(raw.tags),
    category: sanitizeSkillLine(raw.category, SKILL_TAG_MAX_LENGTH) || null,
    storage,
    official: storage === SKILL_STORAGE_OFFICIAL,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

/** 读本地技能（已规范化、过滤掉损坏项）。 */
export function listLocalSkills() {
  return readLocalRaw()
    .map((item) => normalizeSkill(item, SKILL_STORAGE_LOCAL))
    .filter(Boolean);
}

function saveLocalSkills(items) {
  writeLocalRaw(items.map(({ storage: _storage, official: _official, ...rest }) => rest));
}

// ---------- 云端 / 官方 ----------

function isSignedIn() {
  try {
    return Boolean(getAuthSession()?.user);
  } catch {
    return false;
  }
}

async function fetchRemoteSkills() {
  const data = await apiGet("/me/image-skills", { cache: "no-store" });
  const items = (Array.isArray(data?.items) ? data.items : [])
    .map((item) => normalizeSkill(item, item?.official ? SKILL_STORAGE_OFFICIAL : SKILL_STORAGE_CLOUD))
    .filter(Boolean);
  return {
    items,
    cloudMax: Number(data?.maxOwned) || SKILL_CLOUD_MAX_DEFAULT,
  };
}

// ---------- 合并读取（带缓存） ----------

let cache = null;
let inflight = null;

export function invalidateSkillLibrary() {
  cache = null;
  inflight = null;
}

export function notifySkillLibraryUpdated() {
  invalidateSkillLibrary();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SKILL_LIBRARY_UPDATED_EVENT));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(SKILL_LIBRARY_UPDATED_EVENT, invalidateSkillLibrary);
  // 别的标签页改了本地技能也要跟着失效。
  window.addEventListener("storage", (event) => {
    if (event.key === LOCAL_KEY) invalidateSkillLibrary();
  });
}

/**
 * 读取合并后的技能库。
 *
 * 返回 { items, local, cloud, official, quota: { local: {used,max}, cloud: {used,max} }, remoteError }。
 * 未登录只有本地技能；云端读取失败时 remoteError 带上错误，但本地技能照常返回。
 * fresh=true 绕过缓存。
 */
export async function loadSkillLibrary({ fresh = false } = {}) {
  if (!fresh && cache && cache.expiresAt > Date.now()) return cache.value;
  if (!fresh && inflight) return inflight;
  const pending = (async () => {
    const local = listLocalSkills();
    let remote = { items: [], cloudMax: SKILL_CLOUD_MAX_DEFAULT };
    let remoteError = null;
    if (isSignedIn()) {
      try {
        remote = await fetchRemoteSkills();
      } catch (error) {
        remoteError = error instanceof Error ? error : new Error("云端技能读取失败");
      }
    }
    const cloud = remote.items.filter((item) => item.storage === SKILL_STORAGE_CLOUD);
    const official = remote.items.filter((item) => item.storage === SKILL_STORAGE_OFFICIAL);
    const value = {
      // 顺序：本地 → 云端 → 官方；`@` 菜单与技能库页都按这个顺序展示。
      items: [...local, ...cloud, ...official],
      local,
      cloud,
      official,
      quota: {
        local: { used: local.length, max: SKILL_LOCAL_MAX },
        cloud: { used: cloud.length, max: remote.cloudMax },
      },
      signedIn: isSignedIn(),
      remoteError,
    };
    // 云端读失败不缓存，下次重试。
    if (!remoteError) cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  })();
  inflight = pending.finally(() => {
    if (inflight === pending) inflight = null;
  });
  return inflight;
}

// ---------- 增删改 ----------

function pickInput(input) {
  return {
    slug: String(input?.slug || "").trim().toLowerCase(),
    // 不在这里裁长度：超长应当报错让用户改，而不是悄悄截掉。
    name: sanitizeSkillLine(input?.name, Number.MAX_SAFE_INTEGER),
    description: sanitizeSkillLine(input?.description, Number.MAX_SAFE_INTEGER),
    instruction: sanitizeSkillText(input?.instruction, Number.MAX_SAFE_INTEGER),
    tags: sanitizeSkillTags(input?.tags),
  };
}

function assertInput(fields) {
  if (!fields.name) throw new Error("请填写名称");
  if (Array.from(fields.name).length > SKILL_NAME_MAX_LENGTH) {
    throw new Error(`名称不能超过 ${SKILL_NAME_MAX_LENGTH} 字`);
  }
  if (Array.from(fields.description).length > SKILL_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`简介不能超过 ${SKILL_DESCRIPTION_MAX_LENGTH} 字`);
  }
  if (!fields.instruction) throw new Error("请填写指令内容");
  if (Array.from(fields.instruction).length > SKILL_INSTRUCTION_MAX_LENGTH) {
    throw new Error(`正文不能超过 ${SKILL_INSTRUCTION_MAX_LENGTH} 字`);
  }
  if (fields.slug && !isValidSkillSlug(fields.slug)) {
    throw new Error("调用名只能用小写字母、数字和连字符，以字母开头");
  }
}

function localSlugTaken(items, slug, exceptId) {
  return items.some((item) => item.slug === slug && item.id !== exceptId);
}

/**
 * 新建技能。storage 为 local 或 cloud。
 * 本地：立即写 localStorage；云端：POST 到服务端（配额由服务端校验，超限报 422）。
 */
export async function createSkill(input, storage = SKILL_STORAGE_LOCAL) {
  const fields = pickInput(input);
  assertInput(fields);
  let created;
  if (storage === SKILL_STORAGE_CLOUD) {
    if (!isSignedIn()) throw new Error("登录后才能保存到云端");
    const data = await apiPost("/me/image-skills", fields);
    created = normalizeSkill(data, SKILL_STORAGE_CLOUD);
  } else {
    const items = listLocalSkills();
    if (items.length >= SKILL_LOCAL_MAX) throw new Error(`本地最多保存 ${SKILL_LOCAL_MAX} 个技能`);
    const id = newLocalId();
    const slug = fields.slug || slugifySkillName(fields.name) || fallbackSkillSlug(id);
    if (localSlugTaken(items, slug)) throw new Error("这个调用名在本地已经被占用，换一个试试");
    const now = new Date().toISOString();
    created = normalizeSkill({ ...fields, id, slug, createdAt: now, updatedAt: now }, SKILL_STORAGE_LOCAL);
    saveLocalSkills([...items, created]);
  }
  notifySkillLibraryUpdated();
  return created;
}

/** 修改技能（官方只读，会抛错）。 */
export async function updateSkill(skill, input) {
  const fields = pickInput(input);
  assertInput(fields);
  let updated;
  if (skill?.storage === SKILL_STORAGE_CLOUD) {
    const data = await apiPatch(`/me/image-skills/${encodeURIComponent(skill.id)}`, fields);
    updated = normalizeSkill(data, SKILL_STORAGE_CLOUD);
  } else if (skill?.storage === SKILL_STORAGE_LOCAL) {
    const items = listLocalSkills();
    const index = items.findIndex((item) => item.id === skill.id);
    if (index < 0) throw new Error("本地技能不存在，可能已在别处删除");
    const slug = fields.slug || items[index].slug;
    if (localSlugTaken(items, slug, skill.id)) throw new Error("这个调用名在本地已经被占用，换一个试试");
    updated = normalizeSkill(
      { ...items[index], ...fields, slug, updatedAt: new Date().toISOString() },
      SKILL_STORAGE_LOCAL,
    );
    items[index] = updated;
    saveLocalSkills(items);
  } else {
    throw new Error("官方技能只读，可以复制一份再改");
  }
  notifySkillLibraryUpdated();
  return updated;
}

/** 删除技能（官方只读，会抛错）。 */
export async function deleteSkill(skill) {
  if (skill?.storage === SKILL_STORAGE_CLOUD) {
    await apiDelete(`/me/image-skills/${encodeURIComponent(skill.id)}`);
  } else if (skill?.storage === SKILL_STORAGE_LOCAL) {
    saveLocalSkills(listLocalSkills().filter((item) => item.id !== skill.id));
  } else {
    throw new Error("官方技能不能删除");
  }
  notifySkillLibraryUpdated();
}

/**
 * 在本地与云端之间搬运：先在目标位置创建成功，再删掉原来的，任何一步失败都不丢数据。
 * 官方技能可"复制到"本地或云端（相当于复制为我的）。
 */
export async function moveSkill(skill, targetStorage) {
  if (!skill || skill.storage === targetStorage) return skill;
  const created = await createSkill(
    {
      slug: skill.storage === SKILL_STORAGE_OFFICIAL ? "" : skill.slug,
      name: skill.name,
      description: skill.description,
      instruction: skill.instruction,
      tags: skill.tags,
    },
    targetStorage,
  );
  if (skill.storage !== SKILL_STORAGE_OFFICIAL) {
    try {
      await deleteSkill(skill);
    } catch {
      // 源没删掉只是多了一份副本，不算失败。
    }
  }
  notifySkillLibraryUpdated();
  return created;
}

// ---------- 提交时展开 ----------

/**
 * 把文本里的 `@技能` 展开成技能正文。任何失败都原样返回文本。
 * 返回 { prompt, skills }。
 */
export async function expandSkillMentions(text) {
  const source = String(text || "");
  if (!source.includes("@")) return { prompt: source.trim(), skills: [] };
  try {
    const library = await loadSkillLibrary();
    return expandSkillMentionsInText(source, library.items);
  } catch {
    return { prompt: source.trim(), skills: [] };
  }
}
