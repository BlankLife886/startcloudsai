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
                style={{ height: "100%", width: "100%", resize: "none", background: ctx.theme.node.fill, borderRadius: 16, padding: 16, boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, outline: "none", border: `1px solid ${ctx.theme.node.stroke}`, color: ctx.theme.node.text }}
            />
        );
    }

    if (!sanitizedSvg) {
        return <div className="flex h-full w-full items-center justify-center p-4 text-center text-[13px]" style={{ color: ctx.theme.node.placeholder }}>选择节点后，通过上方工具栏粘贴 SVG 源码</div>;
    }

    return <div className="pointer-events-none flex h-full w-full items-center justify-center p-3 [&>svg]:max-h-full [&>svg]:max-w-full" dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />;
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
            transparentBackground: true,
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
