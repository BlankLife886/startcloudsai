import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import type { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];

export function canvasMentionMenuPlacement(anchor: DOMRect, options?: { menuWidth?: number; gap?: number; maxHeight?: number }) {
    const menuWidth = options?.menuWidth ?? 256;
    const gap = options?.gap ?? 6;
    const maxHeight = options?.maxHeight ?? 224;
    const left = clamp(anchor.left, 8, window.innerWidth - menuWidth - 8);
    const spaceAbove = anchor.top - 8;
    const spaceBelow = window.innerHeight - anchor.bottom - 8;
    const showAbove = spaceAbove >= 80 || spaceAbove >= spaceBelow;
    const style: CSSProperties = {
        left,
        maxHeight: Math.min(maxHeight, Math.max(72, (showAbove ? spaceAbove : spaceBelow) - gap)),
        ...(showAbove ? { bottom: Math.max(8, window.innerHeight - anchor.top + gap) } : { top: anchor.bottom + gap }),
    };
    return { showAbove, style };
}

export function scaledHostCaretRect(host: HTMLElement, local: { left: number; top: number; height?: number }) {
    const rect = host.getBoundingClientRect();
    const scaleX = host.offsetWidth ? rect.width / host.offsetWidth : 1;
    const scaleY = host.offsetHeight ? rect.height / host.offsetHeight : 1;
    const left = rect.left + (local.left - host.scrollLeft) * scaleX;
    const top = rect.top + (local.top - host.scrollTop) * scaleY;
    return new DOMRect(left, top, 0, (local.height ?? 20) * scaleY);
}

export function contentEditableCaretRect(editor: HTMLElement | null): DOMRect | null {
    if (!editor) return null;
    const hostRect = editor.getBoundingClientRect();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return new DOMRect(hostRect.left + 12, hostRect.top + 8, 0, 18);

    const range = selection.getRangeAt(0).cloneRange();
    if (!editor.contains(range.startContainer) && range.startContainer !== editor) {
        return new DOMRect(hostRect.left + 12, hostRect.top + 8, 0, 18);
    }
    range.collapse(true);
    const native = range.getClientRects()[0] || range.getBoundingClientRect();
    if (!native || !(native.left || native.top || native.width || native.height)) {
        return new DOMRect(hostRect.left + 12, hostRect.top + 8, 0, 18);
    }

    const left = clamp(native.left, hostRect.left, Math.max(hostRect.left, hostRect.right - 8));
    const top = clamp(native.top, hostRect.top, Math.max(hostRect.top, hostRect.bottom - 8));
    return new DOMRect(left, top, 0, native.height || 18);
}

export function CanvasResourceMentionMenu({
    anchor,
    references,
    activeIndex,
    theme,
    zIndexClassName = "z-[1100]",
    onSelect,
}: {
    anchor: DOMRect | null;
    references: CanvasResourceReference[];
    activeIndex: number;
    theme: Theme;
    zIndexClassName?: string;
    onSelect: (reference: CanvasResourceReference) => void;
}) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);
    const caret = anchor || new DOMRect(16, 16, 0, 20);
    const placement = canvasMentionMenuPlacement(caret);

    useLayoutEffect(() => {
        selectedRef.current = false;
    }, [references, caret.left, caret.top]);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, references]);

    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    return createPortal(
        <div
            data-canvas-no-zoom
            data-canvas-resource-mention-menu="true"
            data-side={placement.showAbove ? "above" : "below"}
            className={`fixed ${zIndexClassName} w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md`}
            style={{ ...placement.style, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => {
                const subtitle = reference.kind === "image" || reference.kind === "video" ? reference.title : reference.text || reference.title;
                return (
                    <button
                        key={reference.id}
                        ref={index === activeIndex ? activeItemRef : undefined}
                        type="button"
                        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition"
                        style={{ "--mention-i": String(Math.min(index, 6)), background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text } as CSSProperties}
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectReference(reference);
                        }}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectReference(reference);
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectReference(reference);
                        }}
                    >
                        <ReferencePreview reference={reference} />
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate whitespace-nowrap font-medium">{reference.label}</span>
                            {subtitle ? <span className="mt-0.5 block truncate whitespace-nowrap opacity-65">{subtitle}</span> : null}
                        </span>
                    </button>
                );
            })}
        </div>,
        getCanvasPortalRoot(),
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) {
        return <img src={reference.previewUrl} alt="" className="size-9 shrink-0 rounded-md object-cover" />;
    }
    if (reference.kind === "video" && reference.previewUrl) {
        return <video src={reference.previewUrl} className="size-9 shrink-0 rounded-md bg-black object-cover" muted preload="metadata" />;
    }
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

export function sameMentionRect(current: DOMRect | null, next: DOMRect | null) {
    if (current === next) return true;
    if (!current || !next) return false;
    return current.top === next.top && current.left === next.left && current.bottom === next.bottom && current.right === next.right;
}
