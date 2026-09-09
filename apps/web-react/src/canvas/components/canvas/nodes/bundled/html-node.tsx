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
        <div data-canvas-no-zoom className="flex h-full w-full overflow-hidden rounded-2xl" style={{ background: ctx.theme.node.fill }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
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

    if (ctx.node.metadata?.editing) return <HtmlEditor ctx={ctx} value={value} />;

    if (!value) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: ctx.theme.node.placeholder }}>
                <Code2 className="size-7" />
                <span className="text-[13px]">选择节点后，通过上方工具栏编辑 HTML</span>
            </div>
        );
    }

    return (
        <div data-canvas-no-zoom className="relative h-full w-full">
            <iframe title="HTML 预览" sandbox="allow-scripts allow-forms" srcDoc={html} className="block h-full w-full rounded-2xl border-0 bg-white" />
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
