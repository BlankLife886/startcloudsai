import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Switch } from "antd";
import { gsap } from "gsap";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ImageQuickToolId } from "./canvas-image-toolbar-tools";
import { CanvasEditorModal, EditorGhostButton, EditorPrimaryButton } from "./canvas-editor-modal";

export type ImageToolbarSettingsTool = {
    id: ImageQuickToolId;
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

export function ImageToolSettingsModal({
    open,
    tools,
    selectedIds,
    showLabels,
    onToggle,
    onReorder,
    onShowLabelsChange,
    onCancel,
    onSave,
}: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    showLabels: boolean;
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onReorder: (ids: ImageQuickToolId[]) => void;
    onShowLabelsChange: (value: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const idsRef = useRef(selectedIds);
    const itemRefs = useRef(new Map<string, HTMLElement>());
    const firstRects = useRef(new Map<string, DOMRect>());
    const dragAbortRef = useRef<AbortController | null>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const pointerRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
    const [draggingId, setDraggingId] = useState<ImageQuickToolId | null>(null);
    const [ghost, setGhost] = useState<{ id: ImageQuickToolId; width: number; height: number } | null>(null);
    const toolById = new Map(tools.map((tool) => [tool.id, tool]));
    const visibleTools = selectedIds.map((id) => toolById.get(id)).filter((tool): tool is ImageToolbarSettingsTool => Boolean(tool));
    const draggingTool = draggingId ? toolById.get(draggingId) : null;
    idsRef.current = selectedIds;

    useEffect(() => {
        if (!open) {
            dragAbortRef.current?.abort();
            gsap.killTweensOf(ghostRef.current);
            setDraggingId(null);
            setGhost(null);
            document.body.classList.remove("canvas-tool-dragging");
        }
        return () => {
            dragAbortRef.current?.abort();
            document.body.classList.remove("canvas-tool-dragging");
        };
    }, [open]);

    useLayoutEffect(() => {
        if (!ghostRef.current || !ghost) return;
        const { x, y, offsetX, offsetY } = pointerRef.current;
        gsap.set(ghostRef.current, { x: x - offsetX, y: y - offsetY, scale: 1.06 });
    }, [ghost]);

    useLayoutEffect(() => {
        const first = firstRects.current;
        if (!first.size) return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        itemRefs.current.forEach((element, id) => {
            const previous = first.get(id);
            if (!previous) return;
            const next = element.getBoundingClientRect();
            const x = previous.left - next.left;
            const y = previous.top - next.top;
            if (!x && !y) return;
            gsap.fromTo(element, { x, y }, { x: 0, y: 0, duration: reduceMotion ? 0 : 0.28, ease: "power2.out", overwrite: true, force3D: true });
        });
        firstRects.current = new Map();
    }, [selectedIds]);

    const snapshot = () => {
        firstRects.current = new Map();
        itemRefs.current.forEach((element, id) => {
            firstRects.current.set(id, element.getBoundingClientRect());
        });
    };

    const moveTool = (fromId: ImageQuickToolId, toId: ImageQuickToolId, pointerX: number) => {
        if (fromId === toId) return;
        const current = idsRef.current;
        const fromIndex = current.indexOf(fromId);
        const toIndex = current.indexOf(toId);
        if (fromIndex < 0 || toIndex < 0) return;
        const target = itemRefs.current.get(toId)?.getBoundingClientRect();
        if (target) {
            const mid = target.left + target.width / 2;
            if (fromIndex < toIndex && pointerX < mid) return;
            if (fromIndex > toIndex && pointerX > mid) return;
        }
        const next = current.filter((id) => id !== fromId);
        next.splice(toIndex, 0, fromId);
        snapshot();
        onReorder(next);
    };

    const startDrag = (id: ImageQuickToolId, event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const source = event.currentTarget.getBoundingClientRect();
        pointerRef.current = {
            x: event.clientX,
            y: event.clientY,
            offsetX: event.clientX - source.left,
            offsetY: event.clientY - source.top,
        };
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        document.body.classList.add("canvas-tool-dragging");
        setDraggingId(id);
        setGhost({ id, width: source.width, height: source.height });

        const placeGhost = (clientX: number, clientY: number) => {
            pointerRef.current.x = clientX;
            pointerRef.current.y = clientY;
            if (!ghostRef.current) return;
            gsap.to(ghostRef.current, {
                x: clientX - pointerRef.current.offsetX,
                y: clientY - pointerRef.current.offsetY,
                duration: 0.16,
                ease: "power3.out",
                overwrite: "auto",
            });
        };

        const move = (next: PointerEvent) => {
            placeGhost(next.clientX, next.clientY);
            const target = document.elementFromPoint(next.clientX, next.clientY)?.closest("[data-tool-id]");
            const toId = target?.getAttribute("data-tool-id") as ImageQuickToolId | null;
            if (toId) moveTool(id, toId, next.clientX);
        };
        const finish = () => {
            setDraggingId(null);
            setGhost(null);
            document.body.classList.remove("canvas-tool-dragging");
        };
        const stop = () => {
            controller.abort();
            const destination = itemRefs.current.get(id)?.getBoundingClientRect();
            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (ghostRef.current && destination && !reduceMotion) {
                gsap.to(ghostRef.current, {
                    x: destination.left,
                    y: destination.top,
                    scale: 1,
                    duration: 0.22,
                    ease: "power2.out",
                    overwrite: true,
                    onComplete: finish,
                });
                return;
            }
            finish();
        };

        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", stop, { signal: controller.signal });
        document.addEventListener("pointercancel", stop, { signal: controller.signal });
    };

    return (
        <CanvasEditorModal
            className="canvas-mask-modal"
            open={open}
            onClose={onCancel}
            width={960}
            title={t("canvas.imageTools.customize")}
            hint={<div className="canvas-mask-shortcut">{t("canvas.imageTools.reorder")}</div>}
            meta={`${visibleTools.length} / ${tools.length}`}
            icon={<Settings2 className="size-4" />}
        >
            <div className="flex flex-col gap-3">
                <div className={`canvas-tool-preview${draggingId ? " is-sorting" : ""}`} style={{ background: theme.toolbar.panel, color: theme.toolbar.item, boxShadow: theme.toolbar.shadow }}>
                    {visibleTools.length ? (
                        visibleTools.map((tool) => (
                            <button
                                key={tool.id}
                                type="button"
                                data-tool-id={tool.id}
                                title={tool.title}
                                ref={(node) => {
                                    if (node) itemRefs.current.set(tool.id, node);
                                    else itemRefs.current.delete(tool.id);
                                }}
                                className={`canvas-tool-preview-item${draggingId === tool.id ? " is-dragging" : ""}`}
                                style={{ color: tool.danger ? "#ef4444" : undefined }}
                                onPointerDown={(event) => startDrag(tool.id, event)}
                            >
                                {tool.icon}
                                {showLabels ? <span>{tool.label}</span> : null}
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-2 text-[12px] opacity-45">{t("canvas.imageTools.emptyVisible")}</div>
                    )}
                </div>

                <div className="canvas-tool-picker">
                    {tools.map((tool) => {
                        const active = selectedIds.includes(tool.id);
                        return (
                            <button
                                key={tool.id}
                                type="button"
                                title={tool.title}
                                className={`canvas-crop-ratio${active ? " is-active" : ""}`}
                                style={tool.danger && !active ? { color: "#ef4444" } : undefined}
                                onClick={() => {
                                    snapshot();
                                    onToggle(tool.id, !active);
                                }}
                            >
                                {tool.icon}
                                <span>{tool.label}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] font-medium">
                        <span className="opacity-55">{t("canvas.imageTools.showLabels")}</span>
                        <Switch size="small" checked={showLabels} onChange={onShowLabelsChange} />
                    </div>
                    <EditorGhostButton onClick={onCancel}>{t("common.cancel")}</EditorGhostButton>
                    <EditorPrimaryButton onClick={onSave}>{t("common.save")}</EditorPrimaryButton>
                </div>
            </div>
            {ghost && draggingTool
                ? createPortal(
                      <div
                          ref={ghostRef}
                          className="canvas-tool-preview-ghost"
                          style={{
                              width: ghost.width,
                              height: ghost.height,
                              background: theme.toolbar.panel,
                              color: draggingTool.danger ? "#ef4444" : theme.toolbar.activeText,
                              boxShadow: theme.toolbar.shadow,
                          }}
                      >
                          {draggingTool.icon}
                          {showLabels ? <span>{draggingTool.label}</span> : null}
                      </div>,
                      getCanvasPortalRoot(),
                  )
                : null}
        </CanvasEditorModal>
    );
}
