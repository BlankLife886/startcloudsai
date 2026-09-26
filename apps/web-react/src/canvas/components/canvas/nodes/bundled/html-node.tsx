import { useMemo, useState } from "react";
import { Code2, Eye, FilePenLine } from "lucide-react";

import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";

const EDITOR_FONT_SIZE = 12;
const EDITOR_LINE_HEIGHT = 20;

function HtmlEditor({ ctx, value }: { ctx: CanvasNodeContext; value: string }) {
    const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
    const [scrollTop, setScrollTop] = useState(0);
    const codeStyle = { fontFamily: "monospace", fontSize: EDITOR_FONT_SIZE, lineHeight: `${EDITOR_LINE_HEIGHT}px`, boxSizing: "border-box" } as const;

    return (
        <div data-canvas-no-zoom className="flex h-full w-full overflow-hidden" style={{ background: ctx.theme.node.fill }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div
                aria-hidden
                style={{ ...codeStyle, flex: "0 0 auto", padding: "16px 8px 16px 12px", textAlign: "right", color: ctx.theme.node.placeholder, background: `${ctx.theme.toolbar.panel}66`, borderRight: `1px solid ${ctx.theme.node.stroke}`, overflow: "hidden", userSelect: "none", whiteSpace: "pre" }}
            >
                <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                    {Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}
                </div>
            </div>
            <textarea
                autoFocus
                value={value}
                placeholder="<div>Hello, {{input}}</div>"
                spellCheck={false}
                wrap="off"
                onChange={(event) => ctx.updateMetadata({ content: event.target.value })}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                onWheel={(event) => event.stopPropagation()}
                style={{ ...codeStyle, flex: "1 1 auto", minWidth: 0, height: "100%", resize: "none", background: "transparent", padding: "16px 16px 16px 12px", outline: "none", border: "none", color: ctx.theme.node.text, whiteSpace: "pre", overflow: "auto" }}
            />
        </div>
    );
}

function HtmlContent({ ctx }: { ctx: CanvasNodeContext }) {
    const value = ctx.node.metadata?.content || "";
    const upstreamText = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .filter((content): content is string => Boolean(content))
        .join("\n");
    const html = value.replace(/\{\{\s*input\s*\}\}/g, upstreamText);

    const editing = Boolean(ctx.node.metadata?.editing);
    const dark = ctx.theme.scheme === "dark";
    const address = useMemo(() => {
        const title = value.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
        if (title) return title;
        const name = ctx.node.title?.trim();
        return name && name !== "HTML" ? (/\.html?$/i.test(name) ? name : `${name}.html`) : "index.html";
    }, [value, ctx.node.title]);
    const chromeLine = dark ? "rgba(255,255,255,.08)" : "#eeecf4";

    // A browser-window frame: traffic lights and an address pill on top, the sandboxed page (or its source) below.
    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-[inherit]" style={{ background: dark ? "#1d1b26" : "#ffffff" }}>
            <div className="flex h-11 shrink-0 items-center gap-3 px-3.5" style={{ borderBottom: `1px solid ${chromeLine}` }}>
                <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
                    <span className="size-2.5 rounded-full" style={{ background: "#ff5f57" }} />
                    <span className="size-2.5 rounded-full" style={{ background: "#febc2e" }} />
                    <span className="size-2.5 rounded-full" style={{ background: "#28c840" }} />
                </div>
                <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 text-[12px]" style={{ background: dark ? "rgba(255,255,255,.06)" : "#f3f1f9", color: ctx.theme.node.placeholder }}>
                    {editing ? <FilePenLine className="size-3 shrink-0" /> : null}
                    <span className="truncate">{editing ? `${address} · 源码` : address}</span>
                </div>
            </div>
            <div className="relative min-h-0 flex-1">
                {editing ? (
                    <HtmlEditor ctx={ctx} value={value} />
                ) : value ? (
                    <div data-canvas-no-zoom className="h-full w-full">
                        <iframe title="HTML 预览" sandbox="allow-scripts allow-forms" srcDoc={html} className="block h-full w-full border-0 bg-white" />
                    </div>
                ) : (
                    <div className="flex h-full w-full flex-col gap-3 p-5">
                        <div className="h-[38%] min-h-10 rounded-xl" style={{ background: "linear-gradient(120deg, #9b7bff, #3d7bff)", opacity: 0.9 }} />
                        <div className="h-2.5 w-[72%] rounded-full" style={{ background: chromeLine }} />
                        <div className="h-2.5 w-[48%] rounded-full" style={{ background: chromeLine }} />
                        <div className="mt-auto flex items-center gap-1.5 text-[12px]" style={{ color: ctx.theme.node.placeholder }}>
                            <Code2 className="size-3.5" />
                            选中后点上方「编辑」写入 HTML
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export const htmlCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.html,
    name: "HTML 节点",
    version: "1.2.0",
    description: "沙箱 iframe 渲染 HTML，支持 {{input}} 注入上游文本",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.html,
            title: "HTML",
            icon: <Code2 className="size-5" />,
            description: "沙箱渲染 HTML",
            defaultSize: { width: 420, height: 320 },
            defaultMetadata: { content: "" },
            minimapColor: "#ec4899",
            hidePanel: true,
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            Content: HtmlContent,
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                return [
                    {
                        id: "html-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 HTML 源码",
                        label: editing ? "预览" : "编辑",
                        icon: editing ? <Eye className="size-4" /> : <FilePenLine className="size-4" />,
                        active: editing,
                        onClick: () => ctx.updateMetadata({ editing: !editing }),
                    },
                ];
            },
        },
    ],
};
