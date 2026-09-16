/**
 * 生图 Skill 的装载与拼接。
 *
 * 装载配置只在 /skills 页维护；生图页面不放选择器，提交时由 tasksApi.createTask
 * 统一取当前生效的 Skill 拼进提示词。服务端 /me/image-skills/resolved 已经处理了
 * "页面绑定覆盖全局"以及停用/不适用词条的剔除，前端只负责拼装。
 */

// 只含「用户自己写提示词」的生图页面，须与后端 store.SkillTaskTypes 一致。
// puzzle 是浏览器本地工具（服务端不接受该类型任务），background_remove 与
// media_tool 的提示词由系统生成，拼 skill 指令不会有任何效果。
export const SKILL_TASK_TYPES = [
  "t2i",
  "coloring",
  "ui_design",
  "ecommerce_design",
  "model_sheet",
  "game_art",
];

export const SKILL_GLOBAL_SCOPE = "global";

// 装载位的展示名与对应页面入口。标签沿用 tasksApi 的 TASK_TYPE_LABELS 口径。
export const SKILL_TASK_TYPE_META = {
  t2i: { label: "文生图", href: "/text-to-image" },
  coloring: { label: "插画染色", href: "/ai-illustration-coloring" },
  ui_design: { label: "UI 设计稿", href: "/design-workshop" },
  ecommerce_design: { label: "AI 电商", href: "/ecommerce-design" },
  model_sheet: { label: "模型设计", href: "/model-sheet" },
  game_art: { label: "游戏设计", href: "/game-art" },
};

export function skillTaskTypeLabel(taskType) {
  return SKILL_TASK_TYPE_META[taskType]?.label || taskType;
}

/** skill 适用于某个装载位：taskTypes 为空表示全部生图页面通用。 */
export function skillAppliesTo(skill, taskType) {
  if (taskType === SKILL_GLOBAL_SCOPE) return true;
  const scopes = Array.isArray(skill?.taskTypes) ? skill.taskTypes : [];
  return scopes.length === 0 || scopes.includes(taskType);
}

/**
 * 某个页面实际生效的 skill id：页面绑定优先于全局，页面一旦有绑定就完全覆盖。
 * 与服务端 ResolveSkillsForTaskType 同构，用于在装载页如实呈现生效结果。
 */
export function resolveBoundSkillIds(bindings, taskType) {
  const page = bindings?.[taskType];
  if (Array.isArray(page) && page.length) return page;
  const global = bindings?.[SKILL_GLOBAL_SCOPE];
  return Array.isArray(global) ? global : [];
}

/** 拼接后提示词的硬上限，避免多个 Skill 叠加后超出上游模型限制。 */
export const SKILL_PROMPT_MAX_LENGTH = 6000;

function instructionOf(skill) {
  return String(skill?.instruction || "").trim();
}

/**
 * 把生效的 Skill 指令拼到用户提示词前面。
 *
 * Skill 指令在前、用户输入在后：用户的具体诉求应当是最后一句，避免被通用风格约束盖住。
 * 已经出现过的指令不重复拼接（同一 Skill 可能既在全局又被页面绑定）。
 */
export function composeSkillPrompt(prompt, skills = []) {
  const base = String(prompt || "").trim();
  const seen = new Set();
  const parts = [];
  for (const skill of Array.isArray(skills) ? skills : []) {
    const instruction = instructionOf(skill);
    if (!instruction || seen.has(instruction)) continue;
    seen.add(instruction);
    parts.push(instruction);
  }
  if (!parts.length) return base;
  const merged = base ? [...parts, base].join("\n\n") : parts.join("\n\n");
  if (merged.length <= SKILL_PROMPT_MAX_LENGTH) return merged;
  // 超长时优先保住用户自己的输入，从后往前丢 Skill 指令。
  const kept = [...parts];
  while (kept.length) {
    kept.pop();
    const candidate = base ? [...kept, base].join("\n\n") : kept.join("\n\n");
    if (candidate.length <= SKILL_PROMPT_MAX_LENGTH) return candidate;
  }
  return base.slice(0, SKILL_PROMPT_MAX_LENGTH);
}
