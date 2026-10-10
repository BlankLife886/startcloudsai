import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ListChecks, Palette, Pin, Type } from "lucide-react";

import { CanvasFloatingLayer } from "@/components/canvas/canvas-floating-layer";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";
import { continueStickyList, parseStickyLines, stickyTextColor, stickyTodoProgress, toggleStickyChecklist, toggleStickyTodo } from "./sticky-note-model";

const PRESET_COLORS = ["#fde68a", "#fed7aa", "#fecaca", "#fbcfe8", "#ddd6fe", "#bfdbfe", "#a5f3fc", "#bbf7d0", "#e7e5e4", "#334155"];
const DEFAULT_COLOR = PRESET_COLORS[0];
const FONT_SIZES = [
    { size: 13, label: "小" },
    { size: 15, label: "中" },
    { size: 18, label: "大" },
];
const PALETTE_EVENT = "sticky-note:palette";
const EDIT_EVENT = "sticky-note:edit";

function fontSizeOf(ctx: CanvasNodeContext) {
    const size = Number(ctx.node.metadata?.fontSize);
    return FONT_SIZES.some((item) => item.size === size) ? size : 15;
}

function formatEdited(iso?: string) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function StickyNoteContent({ ctx }: { ctx: CanvasNodeContext }) {
    const [editing, setEditing] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [draftColor, setDraftColor] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const swatchRef = useRef<HTMLButtonElement>(null);
    const paletteRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const commitTimerRef = useRef<number | null>(null);
    const committedColor = ctx.node.metadata?.pluginColor || DEFAULT_COLOR;
    const color = draftColor ?? committedColor;
    const ink = stickyTextColor(color);
    const content = ctx.node.metadata?.content || "";
    const fontSize = fontSizeOf(ctx);
    const lineHeight = Math.round(fontSize * 1.6);
    const progress = stickyTodoProgress(content);
    const nodeId = ctx.node.id;
    const onRef = useRef(ctx.on);
    onRef.current = ctx.on;

    const writeContent = (next: string) => ctx.updateMetadata({ content: next, stickyUpdatedAt: new Date().toISOString() });

    useEffect(() => {
        const offPalette = onRef.current(PALETTE_EVENT, (payload) => payload === nodeId && setPaletteOpen((open) => !open));
        const offEdit = onRef.current(EDIT_EVENT, (payload) => payload === nodeId && setEditing(true));
        return () => {
            offPalette();
            offEdit();
        };
    }, [nodeId]);

    useEffect(() => {
        if (!editing && !paletteOpen) return;
        const handleOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node;
            if (rootRef.current?.contains(target) || paletteRef.current?.contains(target)) return;
            setEditing(false);
            setPaletteOpen(false);
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
    const textStyle: CSSProperties = { fontSize, lineHeight: `${lineHeight}px`, color: ink };
    const muted = ink === "#1c1917" ? "rgba(28,25,23,.5)" : "rgba(250,250,249,.62)";

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            className="group/sticky relative flex h-full w-full flex-col overflow-hidden rounded-2xl"
            style={{ background: color, cursor: editing ? "text" : "move", boxShadow: "inset 0 1px 0 rgba(255,255,255,.45)" }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                setEditing(true);
            }}
        >
            <button
                ref={swatchRef}
                type="button"
                aria-label="选择便利贴颜色"
                title="选择颜色"
                onMouseDown={stopPropagation}
                onPointerDown={stopPropagation}
                onDoubleClick={stopPropagation}
                onClick={() => setPaletteOpen((open) => !open)}
                className="absolute right-2.5 top-2.5 z-[5] grid size-6 place-items-center rounded-full opacity-0 transition-opacity group-hover/sticky:opacity-100"
                style={{ background: "rgba(255,255,255,.55)", color: "#1c1917", opacity: paletteOpen ? 1 : undefined, boxShadow: "0 1px 3px rgba(0,0,0,.12)" }}
            >
                <Palette className="size-3.5" />
            </button>

            <div className="min-h-0 flex-1 px-4 pb-2 pt-3.5">
                {editing ? (
                    <textarea
                        ref={textareaRef}
                        autoFocus
                        value={content}
                        placeholder={"输入便利贴内容…\n- [ ] 待办事项\n- 列表\n# 标题"}
                        onChange={(event) => writeContent(event.target.value)}
                        onBlur={() => setEditing(false)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
                                event.preventDefault();
                                setEditing(false);
                                return;
                            }
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                const target = event.currentTarget;
                                const next = continueStickyList(target.value, target.selectionStart);
                                if (!next) return;
                                event.preventDefault();
                                writeContent(next.value);
                                requestAnimationFrame(() => textareaRef.current?.setSelectionRange(next.caret, next.caret));
                            }
                        }}
                        onMouseDown={stopPropagation}
                        onPointerDown={stopPropagation}
                        onWheel={stopPropagation}
                        className="h-full w-full resize-none border-0 bg-transparent pr-6 outline-none placeholder:opacity-50"
                        style={{ ...textStyle, caretColor: ink }}
                    />
                ) : content.trim() ? (
                    <div className="h-full overflow-hidden pr-5" style={{ ...textStyle, userSelect: "none" }}>
                        {parseStickyLines(content).map((line) => {
                            if (line.kind === "todo") {
                                return (
                                    <div key={line.index} className="flex items-start gap-2">
                                        <button
                                            type="button"
                                            aria-label={line.done ? "标记为未完成" : "标记为完成"}
                                            onMouseDown={stopPropagation}
                                            onPointerDown={stopPropagation}
                                            onDoubleClick={stopPropagation}
                                            onClick={() => writeContent(toggleStickyTodo(content, line.index))}
                                            className="mt-[3px] grid shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors"
                                            style={{ width: fontSize, height: fontSize, borderColor: line.done ? ink : muted, background: line.done ? ink : "transparent", color: color, cursor: "pointer" }}
                                        >
                                            {line.done ? <Check className="size-[80%]" strokeWidth={3.2} /> : null}
                                        </button>
                                        <span className="min-w-0 flex-1 break-words" style={line.done ? { textDecoration: "line-through", color: muted } : undefined}>
                                            {line.text || " "}
                                        </span>
                                    </div>
                                );
                            }
                            if (line.kind === "bullet") {
                                return (
                                    <div key={line.index} className="flex items-start gap-2">
                                        <span className="shrink-0 rounded-full" style={{ width: 5, height: 5, marginTop: lineHeight / 2 - 2.5, background: ink, opacity: 0.7 }} />
                                        <span className="min-w-0 flex-1 break-words">{line.text}</span>
                                    </div>
                                );
                            }
                            if (line.kind === "heading") {
                                return (
                                    <div key={line.index} className="break-words font-bold" style={{ fontSize: fontSize + 2 }}>
                                        {line.text}
                                    </div>
                                );
                            }
                            return (
                                <div key={line.index} className="whitespace-pre-wrap break-words">
                                    {line.text || " "}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex h-full flex-col gap-1" style={{ ...textStyle, color: muted, userSelect: "none" }}>
                        <span>双击写点什么</span>
                        <span className="text-[11px] leading-5">支持 “- [ ] 待办”、“- 列表”、“# 标题”</span>
                    </div>
                )}
            </div>

            {progress.total || ctx.node.metadata?.stickyUpdatedAt ? (
                <div className="flex shrink-0 items-center gap-2 px-4 pb-3 text-[11px] tabular-nums" style={{ color: muted }}>
                    {progress.total ? (
                        <>
                            <span className="h-1 w-14 overflow-hidden rounded-full" style={{ background: ink === "#1c1917" ? "rgba(0,0,0,.1)" : "rgba(255,255,255,.2)" }}>
                                <span className="block h-full rounded-full transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%`, background: ink }} />
                            </span>
                            <span>
                                {progress.done}/{progress.total}
                            </span>
                        </>
                    ) : null}
                    <span className="flex-1" />
                    {formatEdited(ctx.node.metadata?.stickyUpdatedAt)}
                </div>
            ) : null}

            {/* Folded paper corner */}
            <span className="pointer-events-none absolute bottom-0 right-0 size-5" style={{ background: `linear-gradient(135deg, transparent 50%, ${ink === "#1c1917" ? "rgba(0,0,0,.09)" : "rgba(255,255,255,.14)"} 50%)`, borderTopLeftRadius: 6 }} />

            {paletteOpen ? (
                <CanvasFloatingLayer anchorRef={swatchRef} panelRef={paletteRef} placement="bottom" gap={8} data-canvas-no-zoom className="canvas-float-menu rounded-[14px] border p-2.5" style={{ background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border, boxShadow: ctx.theme.toolbar.shadow }} onMouseDown={stopPropagation} onPointerDown={stopPropagation}>
                    <div className="grid grid-cols-5 gap-2">
                        {PRESET_COLORS.map((preset) => {
                            const active = preset.toLowerCase() === color.toLowerCase();
                            return (
                                <button
                                    key={preset}
                                    type="button"
                                    title={preset}
                                    aria-label={`使用颜色 ${preset}`}
                                    aria-pressed={active}
                                    onClick={() => {
                                        commitColor(preset);
                                        setPaletteOpen(false);
                                    }}
                                    className="grid size-7 place-items-center rounded-full transition-transform hover:scale-110"
                                    style={{ background: preset, boxShadow: active ? `0 0 0 2px ${ctx.theme.toolbar.panel}, 0 0 0 4px ${ctx.theme.node.activeStroke}` : "inset 0 0 0 1px rgba(0,0,0,.1)", color: stickyTextColor(preset) }}
                                >
                                    {active ? <Check className="size-3.5" strokeWidth={3} /> : null}
                                </button>
                            );
                        })}
                    </div>
                    <label className="mt-2.5 flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-[12px] transition-colors hover:bg-black/[.04]" style={{ color: ctx.theme.node.text }}>
                        <span className="relative size-5 shrink-0 rounded-full" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
                            <input
                                type="color"
                                aria-label="自定义便利贴颜色"
                                value={color}
                                onChange={(event) => previewColor(event.target.value)}
                                onBlur={(event) => commitColor(event.target.value)}
                                className="absolute inset-0 size-full cursor-pointer border-0 p-0 opacity-0"
                            />
                        </span>
                        自定义颜色
                        <span className="ml-auto font-mono text-[11px] uppercase" style={{ color: ctx.theme.node.placeholder }}>
                            {color}
                        </span>
                    </label>
                </CanvasFloatingLayer>
            ) : null}
        </div>
    );
}

export const stickyNoteCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.stickyNote,
    name: "便利贴节点",
    version: "2.0.0",
    description: "彩色便利贴：待办清单、列表与标题、字号、自定义颜色，文字可作为下游节点的输入",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.stickyNote,
            title: "便利贴",
            icon: <Pin className="size-5" />,
            description: "彩色便利贴 / 待办清单",
            defaultSize: { width: 240, height: 200 },
            defaultMetadata: { content: "", pluginColor: DEFAULT_COLOR },
            minimapColor: "#f59e0b",
            hidePanel: true,
            Content: StickyNoteContent,
            // The note's text can feed prompts downstream, like a text node.
            resource: (node) => (node.metadata?.content?.trim() ? { kind: "text", text: node.metadata.content } : null),
            toolbar: (ctx) => {
                const size = fontSizeOf(ctx);
                const next = FONT_SIZES[(FONT_SIZES.findIndex((item) => item.size === size) + 1) % FONT_SIZES.length];
                const current = FONT_SIZES.find((item) => item.size === size) || FONT_SIZES[1];
                const content = ctx.node.metadata?.content || "";
                const isChecklist = Boolean(content.trim()) && content.split("\n").filter((line) => line.trim()).every((line) => /^\s*[-*]\s\[( |x|X)\]/.test(line));
                return [
                    { id: "sticky-edit", title: "编辑内容（也可以双击便利贴）", label: "编辑", icon: <Type className="size-4" />, onClick: () => ctx.emit(EDIT_EVENT, ctx.node.id) },
                    { id: "sticky-color", title: "换颜色", label: "颜色", icon: <Palette className="size-4" />, onClick: () => ctx.emit(PALETTE_EVENT, ctx.node.id) },
                    { id: "sticky-font", title: `字号：${current.label}（点一下换成${next.label}）`, label: `字号 ${current.label}`, icon: <span className="text-[13px] font-bold leading-none">A</span>, onClick: () => ctx.updateMetadata({ fontSize: next.size }) },
                    {
                        id: "sticky-checklist",
                        title: isChecklist ? "改回普通文字" : "把每一行变成待办",
                        label: "待办",
                        icon: <ListChecks className="size-4" />,
                        active: isChecklist,
                        onClick: () => ctx.updateMetadata({ content: toggleStickyChecklist(content), stickyUpdatedAt: new Date().toISOString() }),
                    },
                ];
            },
        },
    ],
};
