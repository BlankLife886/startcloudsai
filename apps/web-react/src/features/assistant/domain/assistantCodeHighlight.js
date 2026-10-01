import hljs from "highlight.js";

const LANGUAGE_LABELS = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dart: "Dart",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  md: "Markdown",
  objectivec: "Objective-C",
  php: "PHP",
  python: "Python",
  py: "Python",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  vue: "Vue",
  wxml: "WXML",
  wxs: "WXS",
  wxss: "WXSS",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
};

const LANGUAGE_ALIASES = {
  "c#": "csharp",
  "c++": "cpp",
  cs: "csharp",
  golang: "go",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  objc: "objectivec",
  "objective-c": "objectivec",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  wxml: "xml",
  wxs: "javascript",
  wxss: "css",
  yml: "yaml",
  zsh: "bash",
};

function languageIdFromClassList(classList) {
  const raw = [...(classList || [])].find((item) => item.startsWith("language-"))?.slice(9) || "";
  return String(raw).trim().toLowerCase();
}

function resolveHighlightLanguage(classList) {
  const key = languageIdFromClassList(classList);
  if (!key || key === "plaintext" || key === "text") return "";
  const mapped = LANGUAGE_ALIASES[key] || key;
  return hljs.getLanguage(mapped) ? mapped : "";
}

export function assistantCodeLanguageLabel(classList) {
  const key = languageIdFromClassList(classList);
  if (!key || key === "plaintext" || key === "text") return "代码";
  if (LANGUAGE_LABELS[key]) return LANGUAGE_LABELS[key];
  const mapped = LANGUAGE_ALIASES[key] || key;
  return hljs.getLanguage(mapped)?.name || key;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function highlightAssistantCode(source, classList, { streaming = false } = {}) {
  const text = String(source || "").replace(/\n$/, "");
  const requested = languageIdFromClassList(classList);
  if (!text || streaming || text.length > 80_000) {
    return { html: escapeHtml(text), language: requested };
  }
  try {
    const language = resolveHighlightLanguage(classList);
    if (language) {
      return {
        html: hljs.highlight(text, { language, ignoreIllegals: true }).value,
        language,
      };
    }
    const result = hljs.highlightAuto(text);
    return { html: result.value, language: result.language || requested || "" };
  } catch {
    return { html: escapeHtml(text), language: requested };
  }
}
