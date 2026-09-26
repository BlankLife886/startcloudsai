import type { ReactNode } from "react";
import { Image as ImageIcon, ListOrdered, MessageSquare, Music2, PenLine, Settings2, Type, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type CanvasInspectorProps = {
    node: CanvasNodeData;
    typeLabel: string;
    onRename: (node: CanvasNodeData) => void;
    onClose: () => void;
    children: ReactNode;
};

function inspectorIcon(node: CanvasNodeData) {
    if (node.metadata?.storyboardConfig) return ListOrdered;
    switch (node.type) {
        case CanvasNodeType.Text:
            return Type;
        case CanvasNodeType.Image:
            return ImageIcon;
        case CanvasNodeType.Video:
            return Video;
        case CanvasNodeType.Audio:
            return Music2;
        case CanvasNodeType.Config:
            return Settings2;
        default:
            return MessageSquare;
    }
}

/** Fixed right-hand panel that hosts every editor for the selected node, so the canvas itself stays uncluttered. */
export function CanvasInspector({ node, typeLabel, onRename, onClose, children }: CanvasInspectorProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const dark = theme.scheme === "dark";
    const Icon = inspectorIcon(node);

    return (
        <aside
            className="canvas-inspector absolute bottom-4 right-4 top-[72px] z-[40] flex w-[368px] flex-col overflow-hidden rounded-[20px]"
            style={{
                background: dark ? "rgba(24,22,31,.98)" : "rgba(255,255,255,.98)",
                boxShadow: dark ? "0 0 0 1px rgba(255,255,255,.08), 0 18px 40px rgba(0,0,0,.45)" : "0 0 0 1px #ebe8f2, 0 12px 34px rgba(30,20,80,.1)",
                color: theme.node.text,
            }}
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
        >
            <header className="flex shrink-0 items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: dark ? "rgba(255,255,255,.07)" : "#f0eef5" }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px]" style={{ background: theme.toolbar.itemHover, color: theme.node.text }}>
                    <Icon className="size-4" />
                </span>
                <button type="button" className="group min-w-0 flex-1 text-left" title={t("canvas.node.renameHint")} onClick={() => onRename(node)}>
                    <span className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
                        <span className="truncate">{node.title || t("canvas.node.untitled")}</span>
                        <PenLine className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: theme.node.muted }}>
                        {typeLabel}
                    </span>
                </button>
                <button type="button" className="grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors" style={{ color: theme.node.muted }} title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
                    <X className="size-4" />
                </button>
            </header>
            <div className="canvas-inspector__body thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
        </aside>
    );
}
