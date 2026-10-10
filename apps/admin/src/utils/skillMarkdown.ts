/**
 * SKILL.md 互转，后台导入 / 导出官方技能用。
 *
 * 后台是独立构建（Docker 上下文只有 apps/admin），不能直接引用用户端代码，
 * 这里移植自 apps/web-react/src/features/skills/skillComposition.js 的
 * parseSkillMarkdown / serializeSkillMarkdown。两份实现由
 * scripts/test-skill-markdown.mjs 对同一组样例交叉校验，改一边必须同步另一边。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 500;
export const SKILL_INSTRUCTION_MAX_LENGTH = 4000;
export const SKILL_USAGE_GUIDE_MAX_LENGTH = 2000;
export const SKILL_SOURCE_URL_MAX_LENGTH = 300;
export const SKILL_TAG_MAX_LENGTH = 24;
export const SKILL_TAGS_MAX = 10;
export const SKILL_FILE_MAX_BYTES = 256 * 1024;
export const SKILL_FILE_EXTENSIONS = [".md", ".markdown", ".txt"];
/** 批量导入的 zip：最多这么多个技能，整个包不超过 5MB。 */
export const SKILL_ZIP_MAX_SKILLS = 50;
export const SKILL_ZIP_MAX_BYTES = 5 * 1024 * 1024;
export const SKILL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const SKILL_SLUG_MAX_LENGTH = 64;

export interface SkillMarkdownFields {
  slug: string;
  name: string;
  description: string;
  instruction: string;
  tags: string[];
  category: string | null;
  usageGuide?: string;
  sourceUrl?: string;
}

export interface ParsedSkillMarkdown {
  skill: SkillMarkdownFields;
  warnings: string[];
}

// 控制字符（保留 \n \t）、零宽字符与 Unicode 双向控制符，与用户端一致。
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

export function sanitizeSkillLine(value: unknown, max = SKILL_NAME_MAX_LENGTH) {
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

export function sanitizeSkillText(value: unknown, max = SKILL_INSTRUCTION_MAX_LENGTH) {
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

export function sanitizeSkillTags(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,，]/);
  const out: string[] = [];
  for (const item of raw) {
    const tag = sanitizeSkillLine(item, SKILL_TAG_MAX_LENGTH);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= SKILL_TAGS_MAX) break;
  }
  return out;
}

/** 来源地址：只接受带主机名、不带账号密码的 https 链接，与服务端一致。空串合法。 */
export function skillSourceUrlError(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let parsed: URL | null = null;
  try {
    parsed = new URL(text);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || text.length > SKILL_SOURCE_URL_MAX_LENGTH) {
    return `来源地址需是 https 开头的链接，不超过 ${SKILL_SOURCE_URL_MAX_LENGTH} 个字符`;
  }
  return "";
}

export function isValidSkillSlug(slug: unknown) {
  const value = String(slug || "");
  return value.length > 0 && value.length <= SKILL_SLUG_MAX_LENGTH && SKILL_SLUG_PATTERN.test(value);
}

export function slugifySkillName(name: unknown) {
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

// ---------- 导出 ----------

const META_KEYS = {
  displayName: "display-name",
  tags: "tags",
  category: "category",
  usage: "usage",
  sourceUrl: "source-url",
} as const;

function yamlString(value: unknown) {
  return JSON.stringify(String(value ?? ""));
}

/** `|` 多行块的内容行：逐行缩进，空行保持为空。 */
function yamlBlockLines(text: string, indent: string) {
  return text.split("\n").map((line) => (line.trim() ? indent + line : ""));
}

function yamlFlowList(items: string[]) {
  return `[${items.map((item) => yamlString(item)).join(", ")}]`;
}

/** 一份参考资料：SKILL.md 包里 references/ 或 assets/ 下的文本文件。 */
export interface SkillReferenceFile {
  path: string;
  title?: string;
  purpose?: string;
  content: string;
}

export const SKILL_REFERENCE_MAX_BYTES = 64 * 1024;
export const SKILL_REFERENCE_MAX_FILES = 20;
const REFERENCE_PATH_PATTERN = /^(references|assets)\/[A-Za-z0-9][A-Za-z0-9._-]*\.(md|txt)$/;

export function isValidReferencePath(path: string) {
  return path.length <= 120 && !path.includes("..") && REFERENCE_PATH_PATTERN.test(path);
}

/** 参考资料的标题取正文第一个 `# ` 标题，没有就用文件名。 */
export function referenceTitle(path: string, content: string) {
  return firstHeading(content) || path.split("/").pop() || path;
}

/**
 * 导出为 Codex 兼容的 SKILL.md，格式与用户端技能库完全一致。
 * 带参考资料时，在 metadata.reference-notes 里逐行写“路径: 用途”，导回时据此恢复用途。
 */
export function serializeSkillMarkdown(skill: Partial<SkillMarkdownFields>, references: SkillReferenceFile[] = []) {
  const displayName = String(skill?.name || "").trim();
  const slug = String(skill?.slug || "").trim() || slugifySkillName(displayName);
  const frontName = slug || displayName || "untitled-skill";
  const lines = ["---", `name: ${slug ? frontName : yamlString(frontName)}`, `description: ${yamlString(skill?.description || "")}`];
  const meta: string[] = [];
  if (displayName && displayName !== frontName) meta.push(`  ${META_KEYS.displayName}: ${yamlString(displayName)}`);
  const tags = Array.isArray(skill?.tags) ? skill.tags.filter(Boolean) : [];
  if (tags.length) meta.push(`  ${META_KEYS.tags}: ${yamlFlowList(tags)}`);
  if (skill?.category) meta.push(`  ${META_KEYS.category}: ${yamlString(skill.category)}`);
  const sourceUrl = String(skill?.sourceUrl || "").trim();
  if (sourceUrl) meta.push(`  ${META_KEYS.sourceUrl}: ${yamlString(sourceUrl)}`);
  const usage = String(skill?.usageGuide || "").trim();
  if (usage) meta.push(`  ${META_KEYS.usage}: |`, ...yamlBlockLines(usage, "    "));
  const notes = references
    .filter((ref) => ref.purpose?.trim())
    .map((ref) => `${ref.path}: ${sanitizeSkillLine(ref.purpose, 200)}`);
  if (notes.length) meta.push("  reference-notes: |", ...yamlBlockLines(notes.join("\n"), "    "));
  if (meta.length) lines.push("metadata:", ...meta);
  lines.push("---", "");
  lines.push(String(skill?.instruction || "").trim(), "");
  return lines.join("\n");
}

/** 压缩包里的目录名：优先调用名，其次名称，重名时追加序号。 */
function zipFolderName(skill: Partial<SkillMarkdownFields>, used: Set<string>) {
  const base = String(skill.slug || "").trim() || slugifySkillName(skill.name) || "skill";
  let name = base;
  for (let index = 2; used.has(name); index += 1) name = `${base}-${index}`;
  used.add(name);
  return name;
}

/** 批量导出：每个技能一个 `<slug>/SKILL.md`，参考资料放在同目录的 references/、assets/ 下。 */
export function buildSkillZip(skills: (Partial<SkillMarkdownFields> & { references?: SkillReferenceFile[] })[]) {
  const used = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  for (const skill of skills) {
    const folder = zipFolderName(skill, used);
    const references = (skill.references || []).filter((ref) => isValidReferencePath(ref.path));
    files[`${folder}/SKILL.md`] = strToU8(serializeSkillMarkdown(skill, references));
    for (const ref of references) files[`${folder}/${ref.path}`] = strToU8(ref.content);
  }
  return zipSync(files, { level: 6 });
}

// ---------- 导入 ----------

function parseYamlScalar(raw: unknown) {
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

function parseYamlList(raw: unknown): string[] {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("[")) return text ? [parseYamlScalar(text)] : [];
  const inner = text.replace(/^\[/, "").replace(/\]$/, "");
  const items: string[] = [];
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

type FrontValue = string | string[] | FrontMap;
interface FrontMap {
  [key: string]: FrontValue;
}

/** 极简 frontmatter：顶层 key、一层嵌套、流式 / 块数组、`|` `>` 多行标量。 */
function parseFrontmatter(block: string): FrontMap {
  const lines = String(block || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  function readBlockScalar(indent: number, folded: boolean) {
    const raw: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() && line.search(/\S/) <= indent) break;
      raw.push(line);
      index += 1;
    }
    // 按整块最小缩进去掉公共前缀，块内的相对缩进（嵌套列表等）原样保留。
    const widths = raw.filter((line) => line.trim()).map((line) => line.search(/\S/));
    const common = widths.length ? Math.min(...widths) : 0;
    const collected = raw.map((line) => (line.trim() ? line.slice(common) : ""));
    if (folded) return collected.join(" ").replace(/\s+/g, " ").trim();
    return collected.join("\n").replace(/^\n+/, "").trimEnd();
  }
  function readBlockList(indent: number) {
    const items: string[] = [];
    while (index < lines.length) {
      const match = /^(\s*)-\s*(.*)$/.exec(lines[index]);
      if (!match || match[1].length <= indent) break;
      items.push(parseYamlScalar(match[2]));
      index += 1;
    }
    return items;
  }
  function readMapping(indent: number): FrontMap {
    const target: FrontMap = {};
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
  return readMapping(0);
}

function firstHeading(markdown: string) {
  for (const line of String(markdown || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "";
}

/** 解析 SKILL.md → 表单字段；缺字段只给提示，不阻断导入。 */
export function parseSkillMarkdown(text: string): ParsedSkillMarkdown {
  const source = String(text || "")
    .slice(0, SKILL_FILE_MAX_BYTES)
    .replace(/\r\n?/g, "\n")
    .replace(/^﻿/, "");
  const warnings: string[] = [];
  let front: FrontMap = {};
  let body = source;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (match) {
    front = parseFrontmatter(match[1]);
    body = source.slice(match[0].length);
  } else {
    warnings.push("没有找到 frontmatter，整段内容按指令处理。");
  }
  const meta = (front.metadata && typeof front.metadata === "object" && !Array.isArray(front.metadata)
    ? front.metadata
    : {}) as FrontMap;
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
  let sourceUrl = sanitizeSkillLine(meta[META_KEYS.sourceUrl], SKILL_SOURCE_URL_MAX_LENGTH + 1);
  if (sourceUrl && skillSourceUrlError(sourceUrl)) {
    warnings.push(`metadata.source-url「${sourceUrl}」不是 https 链接，已忽略。`);
    sourceUrl = "";
  }
  return {
    skill: {
      slug,
      name: displayName,
      description: sanitizeSkillLine(front.description, SKILL_DESCRIPTION_MAX_LENGTH),
      instruction,
      tags,
      category: sanitizeSkillLine(meta.category, SKILL_TAG_MAX_LENGTH) || null,
      usageGuide: sanitizeSkillText(meta[META_KEYS.usage], SKILL_USAGE_GUIDE_MAX_LENGTH),
      sourceUrl,
    },
    warnings,
  };
}

/** 读取管理员选择的 SKILL.md：只认文本扩展名，超限直接拒绝。 */
export async function readSkillFile(file: File) {
  const name = String(file?.name || "").toLowerCase();
  if (!SKILL_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new Error("只支持 .md / .markdown / .txt 文件");
  }
  if (file.size > SKILL_FILE_MAX_BYTES) {
    throw new Error(`文件超过 ${Math.round(SKILL_FILE_MAX_BYTES / 1024)} KB，技能正文最多 ${SKILL_INSTRUCTION_MAX_LENGTH} 字`);
  }
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error("文件包含二进制内容，不是 SKILL.md");
  return text.replace(/^﻿/, "");
}

export interface ZipSkillEntry extends ParsedSkillMarkdown {
  path: string;
  /** 同目录下 references/、assets/ 里的资料；包里没有这两个目录时为空。 */
  references: SkillReferenceFile[];
}

/**
 * 读取“导出所选”生成的 zip（每个技能一个 `<目录>/SKILL.md`，资料在同目录的
 * references/、assets/ 下）。只解压 SKILL.md 和这两个目录里的 .md / .txt，
 * 其他文件一律忽略；超出大小或数量上限的条目记为跳过。
 */
export function readSkillZip(data: Uint8Array): { skills: ZipSkillEntry[]; skipped: string[] } {
  if (data.byteLength > SKILL_ZIP_MAX_BYTES) {
    throw new Error(`压缩包超过 ${SKILL_ZIP_MAX_BYTES / 1024 / 1024} MB`);
  }
  const skipped: string[] = [];
  let skillCount = 0;
  const referenceFile = /^(.*?)((?:references|assets)\/[^/]+)$/;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        const isSkill = /(^|\/)SKILL\.md$/i.test(file.name);
        const ref = referenceFile.exec(file.name);
        if (!isSkill && !(ref && isValidReferencePath(ref[2]))) return false;
        const limit = isSkill ? SKILL_FILE_MAX_BYTES : SKILL_REFERENCE_MAX_BYTES;
        if (file.originalSize > limit) {
          skipped.push(`${file.name}（超过 ${limit / 1024} KB）`);
          return false;
        }
        if (isSkill) {
          if (skillCount >= SKILL_ZIP_MAX_SKILLS) {
            skipped.push(`${file.name}（超过 ${SKILL_ZIP_MAX_SKILLS} 个上限）`);
            return false;
          }
          skillCount += 1;
        }
        return true;
      },
    });
  } catch {
    throw new Error("不是有效的 zip 文件");
  }
  const paths = Object.keys(files).sort();
  const skills: ZipSkillEntry[] = [];
  for (const path of paths.filter((name) => /(^|\/)SKILL\.md$/i.test(name))) {
    const text = strFromU8(files[path]);
    if (text.includes("\u0000")) {
      skipped.push(`${path}（包含二进制内容）`);
      continue;
    }
    const folder = path.slice(0, path.length - "SKILL.md".length);
    const notes = readReferenceNotes(text);
    const references: SkillReferenceFile[] = [];
    for (const name of paths) {
      const ref = referenceFile.exec(name);
      if (!ref || ref[1] !== folder || !isValidReferencePath(ref[2])) continue;
      const content = strFromU8(files[name]);
      if (content.includes("\u0000") || !content.trim()) {
        skipped.push(`${name}（不是文本或内容为空）`);
        continue;
      }
      if (references.length >= SKILL_REFERENCE_MAX_FILES) {
        skipped.push(`${name}（超过 ${SKILL_REFERENCE_MAX_FILES} 份资料上限）`);
        continue;
      }
      references.push({ path: ref[2], title: referenceTitle(ref[2], content), purpose: notes[ref[2]] || "", content });
    }
    skills.push({ path, references, ...parseSkillMarkdown(text) });
  }
  return { skills, skipped };
}

/** 读 SKILL.md 里 metadata.reference-notes 的“路径: 用途”。 */
export function readReferenceNotes(text: string): Record<string, string> {
  const source = String(text || "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return {};
  const front = parseFrontmatter(match[1]);
  const meta = (front.metadata && typeof front.metadata === "object" && !Array.isArray(front.metadata) ? front.metadata : {}) as FrontMap;
  const notes: Record<string, string> = {};
  for (const line of String(meta["reference-notes"] || "").split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const path = line.slice(0, index).trim();
    if (isValidReferencePath(path)) notes[path] = sanitizeSkillLine(line.slice(index + 1), 200);
  }
  return notes;
}
