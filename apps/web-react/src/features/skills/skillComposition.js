/**
 * 技能（Skill）的纯函数层：调用名规则、`@技能` 提及的识别与展开、SKILL.md 互转。
 *
 * 技能就是一段可复用的生图/对话指令。用法只有一种：在支持的输入框里输入 `@`
 * 选择技能，提交时把技能正文展开进提示词。没有"装载""指定页面"这类预设置。
 *
 * 名称 + 简介用来在 `@` 菜单里辨认；正文只在提交时才拼进去（Codex 的渐进披露）。
 */

/** 支持 `@技能` 的入口。key 与任务类型 / 工作台一致，用于文案与判定。 */
export const SKILL_ENTRY_POINTS = [
  { key: "t2i", label: "文生图", href: "/text-to-image", taskType: "t2i" },
  { key: "ecommerce_design", label: "AI 电商", href: "/ecommerce-design", taskType: "ecommerce_design" },
  { key: "assistant", label: "AI 助手", href: "/assistant", taskType: "" },
  { key: "canvas", label: "无限画布", href: "/canvas", taskType: "" },
];

/** 走 tasksApi.createTask 的入口任务类型；助手与画布有各自的发送路径。 */
export const SKILL_TASK_TYPES = SKILL_ENTRY_POINTS.map((item) => item.taskType).filter(Boolean);

/** 存储位置：本地（仅此浏览器）/ 云端（账号下同步，有配额）/ 官方（只读）。 */
export const SKILL_STORAGE_LOCAL = "local";
export const SKILL_STORAGE_CLOUD = "cloud";
export const SKILL_STORAGE_OFFICIAL = "official";

export const SKILL_STORAGE_LABELS = {
  [SKILL_STORAGE_LOCAL]: "本地",
  [SKILL_STORAGE_CLOUD]: "云端",
  [SKILL_STORAGE_OFFICIAL]: "官方",
};

/** 本地技能上限；云端上限由服务端返回（默认 5）。 */
export const SKILL_LOCAL_MAX = 50;
export const SKILL_CLOUD_MAX_DEFAULT = 5;

export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 500;
export const SKILL_INSTRUCTION_MAX_LENGTH = 4000;
export const SKILL_TAG_MAX_LENGTH = 24;
export const SKILL_TAGS_MAX = 10;

/** 上传 SKILL.md 的大小上限。正文最多 4000 字，256 KB 已经远超正常文件。 */
export const SKILL_FILE_MAX_BYTES = 256 * 1024;
export const SKILL_FILE_EXTENSIONS = [".md", ".markdown", ".txt"];

// ---------- 输入清洗 ----------

// 控制字符（保留 \n \t）、零宽字符与 Unicode 双向控制符。后者能把 `@技能名` 在
// 视觉上伪装成别的名字，一律剔除。
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

/** 单行文本：去控制字符、把换行折成空格、裁到上限。 */
export function sanitizeSkillLine(value, max = SKILL_NAME_MAX_LENGTH) {
  return Array.from(
    String(value ?? "")
      .replace(UNSAFE_CHARS, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, max)
    .join("")
    .trim();
}

/** 多行文本：去控制字符、统一换行、裁到上限。 */
export function sanitizeSkillText(value, max = SKILL_INSTRUCTION_MAX_LENGTH) {
  return Array.from(
    String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(UNSAFE_CHARS, "")
      .trim(),
  )
    .slice(0, max)
    .join("")
    .trim();
}

/** 标签：逐个清洗、去空、去重、限量。 */
export function sanitizeSkillTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,，]/);
  const out = [];
  for (const item of raw) {
    const tag = sanitizeSkillLine(item, SKILL_TAG_MAX_LENGTH);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= SKILL_TAGS_MAX) break;
  }
  return out;
}

/**
 * 读取用户选择的 SKILL.md 文件。只认文本类扩展名，超过大小上限直接拒绝，
 * 不会把一个几百 MB 的文件读进内存。返回清洗过换行与 BOM 的文本。
 */
export async function readSkillFile(file) {
  if (!file) throw new Error("没有选择文件");
  const name = String(file.name || "").toLowerCase();
  if (!SKILL_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new Error("只支持 .md / .markdown / .txt 文件");
  }
  if (file.type && !/^text\/|^application\/(octet-stream|x-markdown)$|^$/.test(file.type)) {
    throw new Error("这不是文本文件");
  }
  if (file.size > SKILL_FILE_MAX_BYTES) {
    throw new Error(`文件超过 ${Math.round(SKILL_FILE_MAX_BYTES / 1024)} KB，技能正文最多 ${SKILL_INSTRUCTION_MAX_LENGTH} 字`);
  }
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error("文件包含二进制内容，不是 SKILL.md");
  return text.replace(/^\uFEFF/, "");
}

/** 拼接后提示词的硬上限，避免多个技能叠加后超出上游模型限制。 */
export const SKILL_PROMPT_MAX_LENGTH = 6000;

/** 单条提示词里最多展开多少个技能。 */
export const SKILL_MAX_MENTIONS_PER_PROMPT = 8;

// ---------- 调用名（slug） ----------

/**
 * 调用名规则：以字母开头的 hyphen-case（Codex SKILL.md 的 name 口径），
 * 与服务端 skillSlugPattern、迁移里的 CHECK 一致。
 */
export const SKILL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const SKILL_SLUG_MAX_LENGTH = 64;

export function isValidSkillSlug(slug) {
  const value = String(slug || "");
  return value.length > 0 && value.length <= SKILL_SLUG_MAX_LENGTH && SKILL_SLUG_PATTERN.test(value);
}

/**
 * 从名称推导调用名：只保留 ASCII 字母数字，其余折成连字符，去掉开头的数字段。
 * 纯中文名称推不出任何字符时返回空串，由存储层用 id 兜底。
 */
export function slugifySkillName(name) {
  let slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  while (slug && !/^[a-z]/.test(slug)) {
    const index = slug.indexOf("-");
    slug = index >= 0 ? slug.slice(index + 1) : "";
  }
  if (slug.length > SKILL_SLUG_MAX_LENGTH) {
    slug = slug.slice(0, SKILL_SLUG_MAX_LENGTH).replace(/-+$/g, "");
  }
  return slug;
}

/** 推不出调用名时用 id 生成一个短而稳定的调用名，与服务端 FallbackSkillSlug 同构。 */
export function fallbackSkillSlug(id) {
  const hex = String(id || "").replace(/-/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `skill-${(hex || Math.random().toString(16).slice(2)).slice(0, 8).padEnd(8, "0")}`;
}

// ---------- `@技能` 提及 ----------

/**
 * 技能在输入框里的提及写法：名称不含空白就直接 `@名称`（中文名可读），
 * 否则退回 `@调用名`。菜单选中后插入的就是这个 token。
 */
export function skillMentionToken(skill) {
  const name = String(skill?.name || "").trim();
  const slug = String(skill?.slug || "").trim();
  if (name && !/[\s@/]/.test(name)) return `@${name}`;
  if (slug) return `@${slug}`;
  return name ? `@${name.replace(/\s+/g, "-")}` : "";
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 提及前面不能紧贴 ASCII 字母数字（避免把邮箱 a@b 切出来），后面不能紧跟 ASCII 字母数字或连字符。 */
function mentionPattern(token) {
  return new RegExp(`(^|[^A-Za-z0-9_@])${escapeRegExp(token)}(?![A-Za-z0-9_-])`, "g");
}

/**
 * 在文本里找出已知技能的提及。按 token 长度从长到短匹配，`@柔光人像一只猫` 这种
 * 没加空格的写法也能正确命中「柔光人像」而不是更短的前缀。
 * 同一技能可能有 `@名称` 与 `@调用名` 两种写法，都识别。
 * 返回 [{ skill, token }]，按首次出现位置排序、去重、限量。
 */
export function findSkillMentions(text, skills) {
  const source = String(text || "");
  if (!source.includes("@")) return [];
  const list = (Array.isArray(skills) ? skills : []).filter(Boolean);
  const candidates = [];
  for (const skill of list) {
    const tokens = new Set([skillMentionToken(skill)]);
    if (skill?.slug) tokens.add(`@${String(skill.slug).trim()}`);
    for (const token of tokens) {
      if (token.length > 1) candidates.push({ skill, token });
    }
  }
  candidates.sort((a, b) => b.token.length - a.token.length);
  // 把已命中的区间涂掉，避免短 token 再在长 token 内部命中。
  let masked = source;
  const hits = [];
  for (const candidate of candidates) {
    const pattern = mentionPattern(candidate.token);
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const start = match.index + match[1].length;
      hits.push({ ...candidate, index: start });
      masked = masked.slice(0, start) + "\u0000".repeat(candidate.token.length) + masked.slice(start + candidate.token.length);
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const key = hit.skill.id || hit.skill.slug || hit.skill.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ skill: hit.skill, token: hit.token });
    if (out.length >= SKILL_MAX_MENTIONS_PER_PROMPT) break;
  }
  return out;
}

/** 把给定 token 从文本里摘掉，并收敛残留的多余空白。 */
export function stripSkillMentions(text, tokens = []) {
  let result = String(text || "");
  const list = [...new Set((Array.isArray(tokens) ? tokens : []).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const token of list) {
    result = result.replace(mentionPattern(token), "$1");
  }
  return result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function instructionOf(skill) {
  return String(skill?.instruction || "").trim();
}

/**
 * 把技能正文拼到用户提示词前面。
 *
 * 技能在前、用户输入在后：用户的具体诉求应当是最后一句，避免被通用约束盖住。
 * 相同正文只拼一次；超长时优先保住用户输入，从后往前丢技能。
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
  const kept = [...parts];
  while (kept.length) {
    kept.pop();
    const candidate = base ? [...kept, base].join("\n\n") : kept.join("\n\n");
    if (candidate.length <= SKILL_PROMPT_MAX_LENGTH) return candidate;
  }
  return base.slice(0, SKILL_PROMPT_MAX_LENGTH);
}

/**
 * 一次提交的完整展开：识别 `@技能` → 摘掉 token → 技能正文拼到前面。
 * 返回 { prompt, skills }，skills 为实际展开的技能（按出现顺序）。
 * 没有任何提及时 prompt 原样返回（只收敛首尾空白）。
 */
export function expandSkillMentionsInText(text, skills) {
  const mentions = findSkillMentions(text, skills);
  if (!mentions.length) return { prompt: String(text || "").trim(), skills: [] };
  const cleaned = stripSkillMentions(text, mentions.map((item) => item.token));
  const used = mentions.map((item) => item.skill);
  return { prompt: composeSkillPrompt(cleaned, used), skills: used };
}

// ---------- SKILL.md 互转 ----------

const META_KEYS = { displayName: "display-name", tags: "tags", category: "category" };

function yamlString(value) {
  // JSON 字符串是合法的 YAML 双引号标量，直接复用以规避转义细节。
  return JSON.stringify(String(value ?? ""));
}

function yamlFlowList(items) {
  return `[${items.map((item) => yamlString(item)).join(", ")}]`;
}

/**
 * 导出为 Codex 兼容的 SKILL.md：frontmatter 里 name 是调用名、description 是简介，
 * 产品自有字段放在 metadata 下，正文即指令内容。
 *
 * 草稿若推不出调用名（纯中文名），name 直接写显示名：往返解析后 slug 仍为空、
 * 交给存储层自动生成，不会凭空多出一个占位调用名。
 */
export function serializeSkillMarkdown(skill) {
  const displayName = String(skill?.name || "").trim();
  const slug = String(skill?.slug || "").trim() || slugifySkillName(displayName);
  const frontName = slug || displayName || "untitled-skill";
  const lines = [
    "---",
    `name: ${slug ? frontName : yamlString(frontName)}`,
    `description: ${yamlString(skill?.description || "")}`,
  ];
  const meta = [];
  if (displayName && displayName !== frontName) meta.push(`  ${META_KEYS.displayName}: ${yamlString(displayName)}`);
  const tags = Array.isArray(skill?.tags) ? skill.tags.filter(Boolean) : [];
  if (tags.length) meta.push(`  ${META_KEYS.tags}: ${yamlFlowList(tags)}`);
  if (skill?.category) meta.push(`  ${META_KEYS.category}: ${yamlString(skill.category)}`);
  if (meta.length) lines.push("metadata:", ...meta);
  lines.push("---", "");
  lines.push(String(skill?.instruction || "").trim(), "");
  return lines.join("\n");
}

function parseYamlScalar(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.startsWith('"')) {
    try {
      return String(JSON.parse(text));
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function parseYamlList(raw) {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("[")) return text ? [parseYamlScalar(text)] : [];
  const inner = text.replace(/^\[/, "").replace(/\]$/, "");
  const items = [];
  let current = "";
  let quote = "";
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current);
  return items.map(parseYamlScalar).filter(Boolean);
}

/**
 * 解析极简 frontmatter：顶层 `key: value`、一层 `metadata:` 嵌套、
 * 流式数组 `[a, b]`、块数组 `- a`、`|` / `>` 多行标量。
 * 够覆盖 Codex 生态里常见的 SKILL.md，不追求完整 YAML。
 */
function parseFrontmatter(block) {
  const root = {};
  const lines = String(block || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  function readBlockScalar(indent, folded) {
    const collected = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() && line.search(/\S/) <= indent) break;
      collected.push(line.slice(Math.min(indent + 2, line.length)).replace(/^\s{0,2}/, ""));
      index += 1;
    }
    const joined = folded ? collected.join(" ").replace(/\s+/g, " ") : collected.join("\n");
    return joined.trim();
  }
  function readBlockList(indent) {
    const items = [];
    while (index < lines.length) {
      const line = lines[index];
      const match = /^(\s*)-\s*(.*)$/.exec(line);
      if (!match || match[1].length <= indent) break;
      items.push(parseYamlScalar(match[2]));
      index += 1;
    }
    return items;
  }
  function readMapping(indent) {
    const target = {};
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim() || line.trimStart().startsWith("#")) {
        index += 1;
        continue;
      }
      const currentIndent = line.search(/\S/);
      if (currentIndent < indent) break;
      const match = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!match) {
        index += 1;
        continue;
      }
      const [, key, rest] = match;
      index += 1;
      const value = rest.trim();
      if (value === "|" || value === ">") {
        target[key] = readBlockScalar(currentIndent, value === ">");
      } else if (value === "") {
        const next = lines[index] || "";
        if (/^\s*-\s/.test(next)) target[key] = readBlockList(currentIndent);
        else if (next.search(/\S/) > currentIndent) target[key] = readMapping(currentIndent + 1);
        else target[key] = "";
      } else if (value.startsWith("[")) {
        target[key] = parseYamlList(value);
      } else {
        target[key] = parseYamlScalar(value);
      }
    }
    return target;
  }
  Object.assign(root, readMapping(0));
  return root;
}

function firstHeading(markdown) {
  // 逐行扫描而不是一条多行正则，避免在大段空白上回溯。
  for (const line of String(markdown || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "";
}

/**
 * 解析 SKILL.md → 表单字段。没有 frontmatter 时整段当作指令，名称取第一个标题。
 * 返回 { skill, warnings }；缺 name/description 只给提示，不阻断导入。
 * 所有字段都经过清洗与长度裁剪：文件来自用户或第三方，不能信任。
 */
export function parseSkillMarkdown(text) {
  const source = String(text || "")
    .slice(0, SKILL_FILE_MAX_BYTES)
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "");
  const warnings = [];
  let front = {};
  let body = source;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (match) {
    front = parseFrontmatter(match[1]);
    body = source.slice(match[0].length);
  } else {
    warnings.push("没有找到 frontmatter，整段内容按指令处理。");
  }
  const meta = front.metadata && typeof front.metadata === "object" ? front.metadata : {};
  const rawName = sanitizeSkillLine(front.name, SKILL_NAME_MAX_LENGTH);
  const rawSlug = rawName.toLowerCase();
  const slug = isValidSkillSlug(rawSlug) ? rawSlug : slugifySkillName(rawSlug);
  if (rawName && !isValidSkillSlug(rawSlug)) {
    warnings.push(
      slug
        ? `frontmatter 的 name「${rawName}」不是合法调用名，已转换为 ${slug}。`
        : `frontmatter 的 name「${rawName}」推不出调用名，保存时会自动生成。`,
    );
  }
  const displayName =
    sanitizeSkillLine(meta[META_KEYS.displayName] || meta.displayName, SKILL_NAME_MAX_LENGTH) ||
    sanitizeSkillLine(firstHeading(body), SKILL_NAME_MAX_LENGTH) ||
    rawName;
  const tags = sanitizeSkillTags(Array.isArray(meta.tags) ? meta.tags : parseYamlList(meta.tags || ""));
  const rawInstruction = body.trim();
  const instruction = sanitizeSkillText(rawInstruction, SKILL_INSTRUCTION_MAX_LENGTH);
  if (Array.from(rawInstruction).length > SKILL_INSTRUCTION_MAX_LENGTH) {
    warnings.push(`正文超过 ${SKILL_INSTRUCTION_MAX_LENGTH} 字，已截断。`);
  }
  if (!instruction) warnings.push("指令内容为空。");
  if (!displayName) warnings.push("没有名称，请补一个。");
  return {
    skill: {
      slug,
      name: displayName,
      description: sanitizeSkillLine(front.description, SKILL_DESCRIPTION_MAX_LENGTH),
      instruction,
      tags,
      category: sanitizeSkillLine(meta.category, SKILL_TAG_MAX_LENGTH) || null,
    },
    warnings,
  };
}
