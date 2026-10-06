// 回复正文渲染成 HTML 之后的增强：表格（排序、复制）、Mermaid 流程图、引用角标、目录。
// 正文是 marked 生成的静态 HTML，这里都是在 DOM 上加工，交互用事件委托处理。
import { marked } from "marked";

/* ---------- 表格 ---------- */

const SORT_ICONS = { none: "bi-chevron-expand", ascending: "bi-chevron-up", descending: "bi-chevron-down" };

// 给每张表套上工具栏（行数、复制），表头变成可点的排序按钮。
export function enhanceMarkdownTables(root) {
  root.querySelectorAll("table").forEach((table) => {
    if (table.closest(".assistant-table")) return;
    const rows = [...table.querySelectorAll("tbody tr")];
    rows.forEach((row, index) => { row.dataset.rowIndex = String(index); });
    const figure = document.createElement("figure");
    figure.className = "assistant-table";
    // 排序要能连着点（升→降→原顺序），关掉全站的防连点
    figure.dataset.clickGuard = "off";
    const header = document.createElement("header");
    header.className = "assistant-table-toolbar";
    const count = document.createElement("span");
    count.textContent = rows.length > 1 ? `${rows.length} 行 · 点表头排序` : `${rows.length} 行`;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.dataset.tableCopy = "true";
    copy.title = "复制表格，可直接粘贴到 Excel 或文档";
    copy.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i><span>复制</span>';
    header.append(count, copy);
    const scroll = document.createElement("div");
    scroll.className = "assistant-table-scroll";
    table.replaceWith(figure);
    scroll.append(table);
    figure.append(header, scroll);
    if (rows.length < 2) return;
    table.querySelectorAll("thead th").forEach((th, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-table-sort";
      button.dataset.tableSort = String(index);
      button.append(...th.childNodes);
      const icon = document.createElement("i");
      icon.className = `bi ${SORT_ICONS.none}`;
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
      th.append(button);
      th.setAttribute("aria-sort", "none");
    });
  });
}

// "1,280"、"¥ 99.5"、"35%"、"-3 元" 按数字比；其他按中文顺序（数字段按大小）。
function cellNumber(text) {
  const cleaned = String(text || "").replace(/[,\s¥$€£￥元%个次张件台万亿]/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function compareCells(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const na = cellNumber(a);
  const nb = cellNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return a.localeCompare(b, "zh-CN", { numeric: true });
}

// 点同一列：升序 → 降序 → 原顺序。
export function sortMarkdownTable(figure, column) {
  const table = figure?.querySelector("table");
  const body = table?.querySelector("tbody");
  if (!body) return;
  const th = table.querySelectorAll("thead th")[column];
  const current = th?.getAttribute("aria-sort") || "none";
  const next = current === "none" ? "ascending" : current === "ascending" ? "descending" : "none";
  table.querySelectorAll("thead th").forEach((cell) => {
    cell.setAttribute("aria-sort", "none");
    const icon = cell.querySelector(".assistant-table-sort i");
    if (icon) icon.className = `bi ${SORT_ICONS.none}`;
  });
  th?.setAttribute("aria-sort", next);
  const icon = th?.querySelector(".assistant-table-sort i");
  if (icon) icon.className = `bi ${SORT_ICONS[next]}`;
  const rows = [...body.querySelectorAll("tr")];
  const text = (row) => (row.children[column]?.textContent || "").trim();
  rows.sort((a, b) => {
    if (next === "none") return Number(a.dataset.rowIndex) - Number(b.dataset.rowIndex);
    const order = compareCells(text(a), text(b));
    // 空格子不论升降都排在最后
    if (!text(a) || !text(b)) return order;
    return next === "ascending" ? order : -order;
  });
  body.append(...rows);
}

// 按当前顺序导出：TSV 给 Excel，HTML 给文档。
export function markdownTableClipboard(figure) {
  const table = figure?.querySelector("table");
  if (!table) return { text: "", html: "" };
  const lines = [...table.querySelectorAll("tr")].map((row) =>
    [...row.children].map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()).join("\t"));
  const clone = table.cloneNode(true);
  clone.querySelectorAll(".assistant-table-sort").forEach((button) => {
    button.querySelector("i")?.remove();
    button.replaceWith(...button.childNodes);
  });
  clone.querySelectorAll("[aria-sort], [data-row-index]").forEach((node) => {
    node.removeAttribute("aria-sort");
    node.removeAttribute("data-row-index");
  });
  return { text: lines.join("\n"), html: clone.outerHTML };
}

/* ---------- Mermaid 流程图 ---------- */

export function isMermaidCode(code) {
  return [...(code?.classList || [])].some((name) => /^(language-|lang-)?mermaid$/i.test(name));
}

// 流程图先放一个占位，插进页面后再异步渲染成 SVG；渲染失败退回显示源码。
export function createMermaidPlaceholder(source) {
  const figure = document.createElement("figure");
  figure.className = "assistant-diagram";
  figure.dataset.source = source;
  figure.innerHTML = `
    <header class="assistant-diagram-toolbar">
      <span><i class="bi bi-diagram-3" aria-hidden="true"></i>流程图</span>
      <span class="assistant-diagram-actions">
        <button type="button" data-diagram-zoom="true" title="查看大图"><i class="bi bi-arrows-angle-expand" aria-hidden="true"></i></button>
        <button type="button" data-diagram-download="true" title="下载流程图图片（PNG）"><i class="bi bi-download" aria-hidden="true"></i></button>
        <button type="button" data-diagram-source="true" aria-pressed="false" title="查看源码"><i class="bi bi-code-slash" aria-hidden="true"></i><span>源码</span></button>
        <button type="button" data-diagram-copy="true" title="复制 Mermaid 源码"><i class="bi bi-copy" aria-hidden="true"></i></button>
      </span>
    </header>
    <div class="assistant-diagram-canvas" role="img" aria-label="流程图，点击查看大图" title="点击查看大图"><span class="assistant-diagram-loading">正在绘制流程图…</span></div>
    <pre class="assistant-diagram-code" hidden><code></code></pre>`;
  figure.querySelector(".assistant-diagram-code code").textContent = source;
  return figure;
}

let mermaidLoader = null;
let renderQueue = Promise.resolve();
let diagramCounter = 0;
const svgCache = new Map();

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((module) => {
      const mermaid = module.default;
      // 颜色由 CSS 按明暗主题覆盖，这里用中性底色，主题切换不用重画。
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        themeVariables: { fontSize: "13px" },
        flowchart: { curve: "basis", padding: 12 },
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

async function renderOne(figure) {
  const source = figure.dataset.source || "";
  const canvas = figure.querySelector(".assistant-diagram-canvas");
  if (!canvas) return;
  let svg = svgCache.get(source);
  if (!svg) {
    const mermaid = await loadMermaid();
    const id = `assistant-diagram-${++diagramCounter}`;
    try {
      ({ svg } = await mermaid.render(id, source));
      svgCache.set(source, svg);
    } finally {
      // 渲染失败时 mermaid 会在 body 上留下报错节点
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  }
  if (!figure.isConnected) return;
  canvas.innerHTML = svg;
  figure.dataset.rendered = "true";
}

export function renderMermaidDiagrams(root) {
  const figures = [...root.querySelectorAll(".assistant-diagram:not([data-rendered]):not(.is-error)")];
  if (!figures.length) return Promise.resolve();
  // mermaid.render 不能并发，排队一张张画。
  renderQueue = renderQueue.then(async () => {
    for (const figure of figures) {
      if (!figure.isConnected) continue;
      try {
        await renderOne(figure);
      } catch {
        figure.classList.add("is-error");
        const canvas = figure.querySelector(".assistant-diagram-canvas");
        if (canvas) canvas.innerHTML = '<span class="assistant-diagram-loading">流程图语法有误，下面是源码</span>';
        figure.querySelector(".assistant-diagram-code")?.removeAttribute("hidden");
      }
    }
  });
  return renderQueue;
}

export function toggleDiagramSource(figure) {
  const code = figure?.querySelector(".assistant-diagram-code");
  const canvas = figure?.querySelector(".assistant-diagram-canvas");
  const button = figure?.querySelector("[data-diagram-source]");
  if (!code || !canvas || !button || figure.classList.contains("is-error")) return;
  const showing = !code.hidden;
  code.hidden = showing;
  canvas.hidden = !showing;
  button.setAttribute("aria-pressed", String(!showing));
  button.querySelector("span").textContent = showing ? "源码" : "流程图";
  button.title = showing ? "查看源码" : "查看流程图";
}

/* ---------- 流程图：下载图片、查看大图 ---------- */

// 颜色、字体都来自页面 CSS，单独存成图片时要写进每个节点。
const EXPORT_STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "opacity",
  "color", "background-color", "font-family", "font-size", "font-weight", "line-height",
  "text-align", "white-space", "margin", "padding", "display",
];

function diagramSvg(figure) {
  return figure?.querySelector(".assistant-diagram-canvas svg") || null;
}

function diagramSize(svg) {
  const box = svg.viewBox?.baseVal;
  if (box?.width && box?.height) return { width: box.width, height: box.height };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 600, height: rect.height || 400 };
}

function diagramBackground(figure) {
  const workspace = figure.closest(".assistant-workspace") || document.body;
  const value = getComputedStyle(workspace).getPropertyValue("--assistant-card").trim();
  return value || "#ffffff";
}

// 复制一份不依赖页面样式的 SVG：计算后的颜色、字体内联到每个节点。
function styledClone(svg) {
  const clone = svg.cloneNode(true);
  const from = svg.querySelectorAll("*");
  const to = clone.querySelectorAll("*");
  from.forEach((node, index) => {
    const style = getComputedStyle(node);
    to[index]?.setAttribute("style", EXPORT_STYLE_PROPS
      .map((name) => `${name}:${style.getPropertyValue(name)}`)
      .join(";"));
  });
  return clone;
}

// 存成文件用：再写死尺寸，四周留白，铺上底色。
function standaloneSvg(svg, background) {
  const clone = styledClone(svg);
  const { width, height } = diagramSize(svg);
  const pad = 24;
  const box = svg.viewBox?.baseVal;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.ceil(width + pad * 2)));
  clone.setAttribute("height", String(Math.ceil(height + pad * 2)));
  clone.setAttribute("viewBox", `${(box?.x || 0) - pad} ${(box?.y || 0) - pad} ${width + pad * 2} ${height + pad * 2}`);
  clone.setAttribute("style", `background:${background};max-width:none`);
  const fill = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  fill.setAttribute("x", String((box?.x || 0) - pad));
  fill.setAttribute("y", String((box?.y || 0) - pad));
  fill.setAttribute("width", String(width + pad * 2));
  fill.setAttribute("height", String(height + pad * 2));
  fill.setAttribute("fill", background);
  clone.insertBefore(fill, clone.firstChild);
  return { markup: new XMLSerializer().serializeToString(clone), width: width + pad * 2, height: height + pad * 2 };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 存成 2 倍清晰度的 PNG；浏览器不允许把这张图画到画布上时（如 Safari），改存 SVG。
export async function downloadDiagram(figure) {
  const svg = diagramSvg(figure);
  if (!svg) return false;
  const { markup, width, height } = standaloneSvg(svg, diagramBackground(figure));
  const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
    const scale = Math.min(2, 8000 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("empty"))), "image/png");
    });
    saveBlob(png, "流程图.png");
  } catch {
    saveBlob(svgBlob, "流程图.svg");
  }
  return true;
}

const VIEWER_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// 浮层挂在 body 上才能盖住站点顶栏，主题颜色从工作区带过去。
const VIEWER_THEME_VARS = [
  "--assistant-card", "--assistant-text", "--assistant-text-soft", "--assistant-muted",
  "--assistant-border", "--assistant-panel-hover", "--assistant-overlay", "--assistant-shadow",
];

// 大图：铺满窗口的浮层，默认缩放到放得下；可放大、拖动查看、下载，Esc 或点空白处关闭。
export function openDiagramViewer(figure) {
  const svg = diagramSvg(figure);
  if (!svg) return;
  const workspace = getComputedStyle(figure.closest(".assistant-workspace") || document.documentElement);
  const { width, height } = diagramSize(svg);
  const previousFocus = document.activeElement;
  const layer = document.createElement("div");
  layer.className = "assistant-diagram-viewer";
  VIEWER_THEME_VARS.forEach((name) => {
    const value = workspace.getPropertyValue(name).trim();
    if (value) layer.style.setProperty(name, value);
  });
  layer.style.colorScheme = workspace.colorScheme;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "流程图大图");
  layer.innerHTML = `
    <header class="assistant-diagram-viewer-bar">
      <span><i class="bi bi-diagram-3" aria-hidden="true"></i>流程图</span>
      <span class="assistant-diagram-viewer-actions">
        <button type="button" data-viewer-zoom="-1" title="缩小" aria-label="缩小"><i class="bi bi-dash-lg" aria-hidden="true"></i></button>
        <button type="button" data-viewer-fit="true" title="适应窗口" class="assistant-diagram-viewer-scale">100%</button>
        <button type="button" data-viewer-zoom="1" title="放大" aria-label="放大"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>
        <button type="button" data-viewer-download="true" title="下载流程图图片（PNG）"><i class="bi bi-download" aria-hidden="true"></i><span>下载</span></button>
        <button type="button" data-viewer-close="true" title="关闭（Esc）" aria-label="关闭"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      </span>
    </header>
    <div class="assistant-diagram-viewer-stage"><div class="assistant-diagram-viewer-art"></div></div>`;
  const stage = layer.querySelector(".assistant-diagram-viewer-stage");
  const art = layer.querySelector(".assistant-diagram-viewer-art");
  const clone = styledClone(svg);
  clone.removeAttribute("style");
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  art.append(clone);
  document.body.append(layer);

  const fitScale = () => {
    const room = stage.getBoundingClientRect();
    return Math.max(0.2, Math.min(2, (room.width - 48) / width, (room.height - 48) / height));
  };
  let scale = 1;
  const label = layer.querySelector(".assistant-diagram-viewer-scale");
  const apply = (next) => {
    scale = Math.max(0.2, Math.min(4, next));
    clone.style.width = `${Math.round(width * scale)}px`;
    clone.style.height = `${Math.round(height * scale)}px`;
    label.textContent = `${Math.round(scale * 100)}%`;
  };
  apply(fitScale());

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    layer.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  };
  const step = (direction) => {
    const next = direction > 0
      ? VIEWER_ZOOM_STEPS.find((value) => value > scale + 0.01)
      : [...VIEWER_ZOOM_STEPS].reverse().find((value) => value < scale - 0.01);
    apply(next ?? scale);
  };
  function onKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "+" || event.key === "=") {
      step(1);
    } else if (event.key === "-") {
      step(-1);
    }
  }
  document.addEventListener("keydown", onKey, true);
  layer.addEventListener("click", (event) => {
    if (event.target.closest("[data-viewer-close]") || event.target === stage) close();
    else if (event.target.closest("[data-viewer-fit]")) apply(Math.abs(scale - fitScale()) < 0.01 ? 1 : fitScale());
    else if (event.target.closest("[data-viewer-zoom]")) step(Number(event.target.closest("[data-viewer-zoom]").dataset.viewerZoom));
    else if (event.target.closest("[data-viewer-download]")) void downloadDiagram(figure);
  });
  // Ctrl/⌘ + 滚轮缩放（触控板双指捏合也是这个事件）
  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    apply(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  // 按住拖动查看
  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    stage.scrollLeft = drag.left - dx;
    stage.scrollTop = drag.top - dy;
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  layer.querySelector("[data-viewer-close]").focus({ preventScroll: true });
}

/* ---------- 引用角标 ---------- */

const CITE_PATTERN = /[[［【](\d{1,2})[\]］】]/g;

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

// 正文里的 [n] 换成上标，链接到第 n 个来源；超出来源数量的编号保持原样。
export function linkMarkdownCitations(root, sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest("pre, code, a, .assistant-code, .assistant-diagram")) return NodeFilter.FILTER_REJECT;
      CITE_PATTERN.lastIndex = 0;
      return CITE_PATTERN.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const value = node.nodeValue || "";
    const parts = [];
    let last = 0;
    CITE_PATTERN.lastIndex = 0;
    let match = CITE_PATTERN.exec(value);
    while (match) {
      const number = Number(match[1]);
      const source = list[number - 1];
      if (source) {
        if (match.index > last) parts.push(document.createTextNode(value.slice(last, match.index)));
        const link = document.createElement("a");
        link.className = "assistant-cite";
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = String(number);
        link.dataset.title = source.title || hostOf(source.url);
        link.dataset.host = source.host || hostOf(source.url);
        link.setAttribute("aria-label", `来源 ${number}：${source.title || hostOf(source.url)}`);
        parts.push(link);
        last = match.index + match[0].length;
      }
      match = CITE_PATTERN.exec(value);
    }
    if (!parts.length) continue;
    if (last < value.length) parts.push(document.createTextNode(value.slice(last)));
    node.replaceWith(...parts);
  }
}

/* ---------- 长回复目录 ---------- */

export const OUTLINE_MIN_CHARS = 1200;
export const OUTLINE_MIN_HEADINGS = 3;

function plainHeading(text) {
  return String(text || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

// 够长、标题够多才给目录。只取一到三级标题；层级按出现过的最高级别算起。
export function markdownOutline(content) {
  const text = String(content || "");
  if (text.length < OUTLINE_MIN_CHARS) return [];
  let tokens = [];
  try {
    tokens = marked.lexer(text, { gfm: true });
  } catch {
    return [];
  }
  const headings = tokens
    .filter((token) => token.type === "heading" && token.depth <= 3)
    .map((token) => ({ depth: token.depth, title: plainHeading(token.text) }))
    .filter((heading) => heading.title);
  if (headings.length < OUTLINE_MIN_HEADINGS) return [];
  const top = Math.min(...headings.map((heading) => heading.depth));
  return headings.map((heading, index) => ({ index, level: heading.depth - top + 1, title: heading.title }));
}
