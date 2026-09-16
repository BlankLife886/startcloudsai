/**
 * 生图 Skill 的运行时读取与缓存。
 *
 * 提交生图时需要知道"当前页面生效哪些 Skill"，但不能为此多等一次网络往返、
 * 更不能因为这个请求失败就挡住生成。这里按 taskType 缓存服务端的解析结果，
 * 装载配置变更时由 /skills 页广播事件失效缓存。
 */
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
} from "../../legacy-modules/services/apiClient.js";

import { SKILL_TASK_TYPES } from "./skillComposition.js";

export const SKILL_BINDINGS_UPDATED_EVENT = "starclouds:skill-bindings-updated";

const CACHE_TTL_MS = 60_000;

/** taskType -> { skills, expiresAt } */
const cache = new Map();
/** taskType -> Promise，避免同一页面并发提交时重复请求。 */
const inflight = new Map();

export function invalidateSkillCache() {
  cache.clear();
  inflight.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(SKILL_BINDINGS_UPDATED_EVENT, invalidateSkillCache);
}

export function notifySkillBindingsUpdated() {
  invalidateSkillCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SKILL_BINDINGS_UPDATED_EVENT));
  }
}

async function fetchResolvedSkills(taskType) {
  // 未登录或接口异常时由 resolveSkillsForTaskType 兜成空数组，不打断生成。
  const data = await apiGet("/me/image-skills/resolved", {
    query: { taskType },
    cache: "no-store",
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * 读取某个生图页面当前生效的 Skill。
 *
 * 任何失败都返回空数组：Skill 是增强项，不能成为生成的前置依赖。
 */
export async function resolveSkillsForTaskType(taskType) {
  if (!SKILL_TASK_TYPES.includes(taskType)) return [];
  const hit = cache.get(taskType);
  if (hit && hit.expiresAt > Date.now()) return hit.skills;
  if (inflight.has(taskType)) return inflight.get(taskType);
  const pending = fetchResolvedSkills(taskType)
    .then((skills) => {
      cache.set(taskType, { skills, expiresAt: Date.now() + CACHE_TTL_MS });
      return skills;
    })
    .catch(() => [])
    .finally(() => inflight.delete(taskType));
  inflight.set(taskType, pending);
  return pending;
}

export async function listMySkills({ taskType = "", search = "" } = {}) {
  const query = {};
  if (taskType) query.taskType = taskType;
  if (search) query.search = search;
  const data = await apiGet("/me/image-skills", { query, cache: "no-store" });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    bindings: data?.bindings && typeof data.bindings === "object" ? data.bindings : {},
    maxPerScope: Number(data?.maxPerScope) || 0,
  };
}

export async function setSkillBinding(scope, skillIds) {
  const data = await apiPut(`/me/skill-bindings/${encodeURIComponent(scope)}`, {
    skillIds: Array.isArray(skillIds) ? skillIds : [],
  });
  notifySkillBindingsUpdated();
  return data?.bindings && typeof data.bindings === "object" ? data.bindings : {};
}

/** 自建 Skill 的增删改。改完要失效缓存：可能正被装载着。 */
export async function createMySkill(input) {
  const skill = await apiPost("/me/image-skills", input);
  notifySkillBindingsUpdated();
  return skill;
}

export async function updateMySkill(id, input) {
  const skill = await apiPatch(`/me/image-skills/${encodeURIComponent(id)}`, input);
  notifySkillBindingsUpdated();
  return skill;
}

export async function deleteMySkill(id) {
  await apiDelete(`/me/image-skills/${encodeURIComponent(id)}`);
  notifySkillBindingsUpdated();
}
