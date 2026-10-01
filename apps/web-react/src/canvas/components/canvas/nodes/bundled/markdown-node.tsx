import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { Eye, FilePenLine, FileText } from "lucide-react";
import { marked } from "marked";

import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";
import "./markdown-node.css";

const PLACEHOLDER = "*选中节点后，可通过上方工具栏编辑 Markdown*";
const htmlCache = new Map<string, string>();

function renderMarkdown(source: string) {
    const key = source || PLACEHOLDER;
    const cached = htmlCache.get(key);
    if (cached !== undefined) return cached;
    const html = DOMPurify.sanitize(marked.parse(key, { async: false }));
    htmlCache.set(key, html);
    return html;
}

function MarkdownPreview({ ctx }: { ctx: CanvasNodeContext }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const lastHtmlRef = useRef<string | null>(null);
    const html = renderMarkdown(ctx.node.metadata?.content || "");

    useEffect(() => {
        const container = containerRef.current;
        if (!container || lastHtmlRef.current === html) return;
        container.innerHTML = html;
        lastHtmlRef.current = html;
    }, [html]);

    return <div ref={containerRef} className="canvas-bundled-markdown thin-scrollbar" data-canvas-no-zoom onWheel={(event) => event.stopPropagation()} style={{ color: ctx.theme.node.text }} />;
}

function MarkdownEditor({ ctx }: { ctx: CanvasNodeContext }) {
    return (
        <textarea
            autoFocus
            value={ctx.node.metadata?.content || ""}
            placeholder="# 输入 Markdown"
            onChange={(event) => ctx.updateMetadata({ content: event.target.value })}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            className="thin-scrollbar"
            style={{ height: "100%", width: "100%", resize: "none", background: ctx.theme.node.fill, borderRadius: 16, boxSizing: "border-box", padding: 16, fontFamily: "monospace", fontSize: 14, outline: "none", border: "none", color: ctx.theme.node.text }}
        />
    );
}

function MarkdownContent({ ctx }: { ctx: CanvasNodeContext }) {
    return ctx.node.metadata?.editing ? <MarkdownEditor ctx={ctx} /> : <MarkdownPreview ctx={ctx} />;
}

export const markdownCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.markdown,
    name: "Markdown 节点",
    version: "1.1.0",
    description: "在画布中编辑与渲染 Markdown",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.markdown,
            title: "Markdown",
            icon: <FileText className="size-5" />,
            description: "编辑与渲染 Markdown",
            defaultSize: { width: 360, height: 300 },
            defaultMetadata: { content: "" },
            minimapColor: "#6366f1",
            hidePanel: true,
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            resource: (node) => ({ kind: "text", text: node.metadata?.content || "" }),
            Content: MarkdownContent,
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                return [
                    {
                        id: "md-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 Markdown 源码",
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
