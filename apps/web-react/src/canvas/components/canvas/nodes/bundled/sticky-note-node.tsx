import { useEffect, useRef, useState } from "react";
import { Pin } from "lucide-react";

import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";

const PRESET_COLORS = ["#fde68a", "#fca5a5", "#fdba74", "#a7f3d0", "#bfdbfe", "#ddd6fe", "#f9a8d4", "#e7e5e4"];
const DEFAULT_COLOR = PRESET_COLORS[0];

function StickyNoteContent({ ctx }: { ctx: CanvasNodeContext }) {
    const [editing, setEditing] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [draftColor, setDraftColor] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const commitTimerRef = useRef<number | null>(null);
    const committedColor = ctx.node.metadata?.pluginColor || DEFAULT_COLOR;
    const color = draftColor ?? committedColor;
    const content = ctx.node.metadata?.content || "";

    useEffect(() => {
        if (!editing && !paletteOpen) return;
        const handleOutsidePointer = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setEditing(false);
                setPaletteOpen(false);
            }
        };
        document.addEventListener("pointerdown", handleOutsidePointer, true);
        return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
    }, [editing, paletteOpen]);

    useEffect(() => {
        setDraftColor(null);
    }, [committedColor]);

    useEffect(
        () => () => {
            if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
        },
        [],
    );

    const previewColor = (next: string) => {
        setDraftColor(next);
        if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            ctx.updateMetadata({ pluginColor: next });
        }, 150);
    };

    const commitColor = (next: string) => {
        if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
        setDraftColor(next);
        ctx.updateMetadata({ pluginColor: next });
    };

    const stopPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation();

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            className="relative flex h-full w-full flex-col rounded-2xl p-3.5"
            style={{ background: color, cursor: editing ? "text" : "move", boxShadow: "inset 0 1px 0 rgba(255,255,255,.45)" }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                setEditing(true);
            }}
        >
            <div className="absolute right-2 top-2 z-[5]" onMouseDown={stopPropagation} onPointerDown={stopPropagation} onDoubleClick={stopPropagation}>
                <button
                    type="button"
                    aria-label="选择便利贴颜色"
                    title="选择颜色"
                    onClick={() => setPaletteOpen((open) => !open)}
                    className="size-[22px] cursor-pointer rounded-full border-2 p-0 shadow-sm"
                    style={{ borderColor: "rgba(0,0,0,.25)", background: color }}
                />
                {paletteOpen ? (
                    <div className="absolute right-0 top-7 grid grid-cols-4 gap-1.5 rounded-lg bg-white p-2 shadow-xl">
                        {PRESET_COLORS.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                title={preset}
                                aria-label={`使用颜色 ${preset}`}
                                onClick={() => {
                                    commitColor(preset);
                                    setPaletteOpen(false);
                                }}
                                className="size-5 cursor-pointer rounded-full border-2 p-0"
                                style={{ borderColor: preset === color ? "#1c1917" : "rgba(0,0,0,.12)", background: preset }}
                            />
                        ))}
                        <label title="自定义颜色" className="relative size-5 cursor-pointer rounded-full border-2" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)", borderColor: "rgba(0,0,0,.12)" }}>
                            <input
                                type="color"
                                aria-label="自定义便利贴颜色"
                                value={color}
                                onChange={(event) => previewColor(event.target.value)}
                                onBlur={(event) => commitColor(event.target.value)}
                                className="absolute inset-0 size-full cursor-pointer border-0 p-0 opacity-0"
                            />
                        </label>
                    </div>
                ) : null}
            </div>

            {editing ? (
                <textarea
                    autoFocus
                    value={content}
                    placeholder="输入便利贴内容..."
                    onChange={(event) => ctx.updateMetadata({ content: event.target.value })}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") setEditing(false);
                    }}
                    onMouseDown={stopPropagation}
                    onPointerDown={stopPropagation}
                    onWheel={stopPropagation}
                    className="h-full w-full flex-1 resize-none border-0 bg-transparent pr-6 text-[15px] leading-6 text-stone-900 outline-none"
                />
            ) : (
                <div className="flex-1 overflow-hidden whitespace-pre-wrap pr-6 text-[15px] leading-6 text-stone-900" style={{ color: content ? "#1c1917" : "rgba(28,25,23,.45)", userSelect: "none" }}>
                    {content || "双击编辑便利贴"}
                </div>
            )}
        </div>
    );
}

export const stickyNoteCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.stickyNote,
    name: "便利贴节点",
    version: "1.1.0",
    description: "可自选颜色、双击编辑、拖动即可移动的便利贴",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.stickyNote,
            title: "便利贴",
            icon: <Pin className="size-5" />,
            description: "彩色便利贴",
            defaultSize: { width: 240, height: 200 },
            defaultMetadata: { content: "", pluginColor: DEFAULT_COLOR },
            minimapColor: "#f59e0b",
            hidePanel: true,
            Content: StickyNoteContent,
        },
    ],
};
