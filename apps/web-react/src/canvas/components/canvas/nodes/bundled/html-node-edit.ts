// Edits to an existing page are exchanged as SEARCH/REPLACE patches instead of a full rewrite: the reply stays small
// (fast, cheap, never cut off), untouched parts of the page are preserved byte for byte, and a reply that does not
// line up with the page is rejected as a whole instead of half-applied.

export const HTML_EDIT_SYSTEM_PROMPT = `你是一名资深前端工程师。你会收到一个单文件网页的完整源码和一条修改要求。
只输出修改补丁，不要解释，不要 Markdown 代码块。每个补丁的格式严格如下：
<<<<<<< SEARCH
（从原网页中逐字复制的一段连续原文）
=======
（替换后的新内容）
>>>>>>> REPLACE
规则：
- SEARCH 必须与原文逐字一致（包括空格和换行），并且在原文中只出现一次；尽量短，但要带上足够的上下文保证唯一。
- 可以输出多个补丁，按它们在原文中出现的顺序排列；新增内容时，用相邻的原文作为 SEARCH，在 REPLACE 中带上原文和新增部分。
- 形如 __ASSET_1__ 的占位符代表图片数据，保持原样，不要改写。
- 保证修改后的网页仍然完整可运行，并保持原有的交互功能。
- 只有当修改范围超过整个网页的一半时，才直接输出修改后的完整 HTML（从 <!doctype html> 开始，以 </html> 结束）。`;

export type HtmlPatch = { search: string; replace: string };

/** Swaps inline data: URIs (embedded images, fonts) for short placeholders so they do not eat the request budget. */
export function stashHtmlAssets(html: string) {
    const assets: string[] = [];
    const text = html.replace(/data:[a-z0-9.+/-]+;base64,[a-z0-9+/=\s]{200,}/gi, (match) => {
        assets.push(match);
        return `__ASSET_${assets.length}__`;
    });
    const restore = (value: string) => value.replace(/__ASSET_(\d+)__/g, (token, index) => assets[Number(index) - 1] ?? token);
    return { text, restore, count: assets.length };
}

export function parseHtmlPatches(reply: string): HtmlPatch[] {
    const patches: HtmlPatch[] = [];
    const pattern = /<{5,9}\s*SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\S\n]*\n([\s\S]*?)\n?>{5,9}\s*REPLACE/g;
    for (const match of reply.matchAll(pattern)) patches.push({ search: match[1], replace: match[2] });
    return patches;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where a patch applies: an exact unique match, or failing that a unique match that ignores whitespace differences. */
function locate(source: string, search: string): { start: number; end: number } | null {
    if (!search.trim()) return null;
    const first = source.indexOf(search);
    if (first >= 0) return source.indexOf(search, first + 1) < 0 ? { start: first, end: first + search.length } : null;
    const flexible = new RegExp(
        search
            .trim()
            .split(/\s+/)
            .map(escapeRegExp)
            .join("\\s+"),
        "g",
    );
    const matches = [...source.matchAll(flexible)];
    if (matches.length !== 1) return null;
    return { start: matches[0].index!, end: matches[0].index! + matches[0][0].length };
}

/** Applies every patch in order, or none: a single patch that does not line up leaves the page untouched. */
export function applyHtmlPatches(source: string, patches: HtmlPatch[]): { ok: true; html: string } | { ok: false; failed: number[] } {
    let html = source;
    const failed: number[] = [];
    patches.forEach((patch, index) => {
        const at = locate(html, patch.search);
        if (!at) {
            failed.push(index + 1);
            return;
        }
        html = html.slice(0, at.start) + patch.replace + html.slice(at.end);
    });
    return failed.length ? { ok: false, failed } : { ok: true, html };
}
