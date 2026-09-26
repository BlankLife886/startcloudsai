import { useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import { Braces, Eye, FilePenLine } from "lucide-react";

import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";

function SvgContent({ ctx }: { ctx: CanvasNodeContext }) {
    const stored = ctx.node.metadata?.content;
    const upstream = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((text): text is string => typeof text === "string" && text.trim().startsWith("<svg"));
    const source = (stored || upstream || "").trim();
    const sanitizedSvg = useMemo(() => DOMPurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true } }), [source]);

    useEffect(() => {
        if (stored === undefined && upstream) ctx.updateMetadata({ content: upstream });
    }, [stored, upstream]);

    const dark = ctx.theme.scheme === "dark";
    const cell = dark ? "rgba(255,255,255,.05)" : "#f1eff8";
    // Transparency checkerboard, like an image editor, so the vector's own background (or lack of one) is visible.
    const checker = {
        backgroundColor: dark ? "#1d1b26" : "#ffffff",
        backgroundImage: `linear-gradient(45deg, ${cell} 25%, transparent 25%, transparent 75%, ${cell} 75%), linear-gradient(45deg, ${cell} 25%, transparent 25%, transparent 75%, ${cell} 75%)`,
        backgroundSize: "24px 24px",
        backgroundPosition: "0 0, 12px 12px",
    } as const;

    if (ctx.node.metadata?.editing) {
        return (
            <textarea
                autoFocus
                value={stored || ""}
                placeholder="粘贴 SVG 源码，如 <svg ...>...</svg>"
                onChange={(event) => ctx.updateMetadata({ content: event.target.value })}
                onKeyDown={(event) => {
                    if (event.key === "Escape") ctx.updateMetadata({ editing: false });
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
                className="thin-scrollbar"
                style={{ height: "100%", width: "100%", resize: "none", background: ctx.theme.node.fill, borderRadius: "inherit", padding: 16, boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, lineHeight: "20px", outline: "none", border: "none", color: ctx.theme.node.text }}
            />
        );
    }

    if (!sanitizedSvg) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-[inherit] p-4 text-center" style={checker}>
                <svg viewBox="0 0 150 120" className="w-[46%] max-w-[150px]" aria-hidden>
                    <circle cx="48" cy="54" r="42" fill="#8b6cff" fillOpacity=".78" />
                    <rect x="84" y="10" width="58" height="84" rx="12" fill="#3dd5f3" fillOpacity=".78" />
                    <path d="M 75 38 L 120 116 L 30 116 Z" fill="#ff6fa5" fillOpacity=".82" />
                </svg>
                <span className="text-[12px]" style={{ color: ctx.theme.node.placeholder }}>选中后点上方「编辑」粘贴 SVG 源码</span>
            </div>
        );
    }

    return <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] p-4 [&>svg]:max-h-full [&>svg]:max-w-full" style={checker} dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />;
}

export const svgCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.svg,
    name: "SVG 节点",
    version: "1.1.0",
    description: "透明背景渲染 SVG 矢量图，可接收上游文本节点的 SVG 源码",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.svg,
            title: "SVG",
            icon: <Braces className="size-5" />,
            description: "渲染 SVG 矢量图",
            defaultSize: { width: 320, height: 320 },
            defaultMetadata: {},
            minimapColor: "#14b8a6",
            hidePanel: true,
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            Content: SvgContent,
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                return [
                    {
                        id: "svg-toggle-edit",
                        title: editing ? "预览 SVG" : "编辑 SVG 源码",
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
