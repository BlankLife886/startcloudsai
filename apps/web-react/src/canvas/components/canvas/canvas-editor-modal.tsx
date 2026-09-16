import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Modal } from "antd";

import { useIsDark } from "@react/hooks/useIsDark.js";
import { getCanvasPortalRoot, syncCanvasOverlayTheme } from "@/lib/canvas-portal";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasIconWellStyle } from "@/lib/canvas-ui";
import { useThemeStore } from "@/stores/use-theme-store";

/** Swallow the click that closes a modal so it cannot land on the canvas underneath. */
function swallowClosingPointer() {
    const block = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const options: AddEventListenerOptions = { capture: true };
    window.addEventListener("pointerdown", block, options);
    window.addEventListener("mousedown", block, options);
    window.addEventListener("mouseup", block, options);
    window.addEventListener("click", block, options);
    window.setTimeout(() => {
        window.removeEventListener("pointerdown", block, options);
        window.removeEventListener("mousedown", block, options);
        window.removeEventListener("mouseup", block, options);
        window.removeEventListener("click", block, options);
    }, 120);
}

export function CanvasEditorModal({
    open,
    onClose,
    width,
    title,
    hint,
    meta,
    icon,
    children,
    className,
    closable = true,
    ariaTitle,
}: {
    open: boolean;
    onClose: () => void;
    width?: number | string;
    title?: ReactNode;
    hint?: ReactNode;
    meta?: ReactNode;
    icon?: ReactNode;
    children: ReactNode;
    className?: string;
    closable?: boolean;
    /** Accessible name for dialogs that render their own visual heading. */
    ariaTitle?: string;
}) {
    const hostDark = useIsDark();
    const colorTheme = useThemeStore((state) => state.theme);
    const dark = colorTheme === "dark" || hostDark;
    const theme = canvasThemes[dark ? "dark" : "light"];
    const closingRef = useRef(false);
    const wasOpenRef = useRef(open);

    useEffect(() => {
        syncCanvasOverlayTheme(dark);
    }, [dark]);

    // Catch Cancel/Save paths that close by flipping `open` without going through
    // Modal onCancel, so the same pointer cannot select canvas nodes underneath.
    useEffect(() => {
        if (wasOpenRef.current && !open) swallowClosingPointer();
        wasOpenRef.current = open;
    }, [open]);

    const handleClose = useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        swallowClosingPointer();
        onClose();
        window.setTimeout(() => {
            closingRef.current = false;
        }, 160);
    }, [onClose]);

    return (
        <Modal
            className={`canvas-editor-modal${dark ? " is-dark" : ""}${className ? ` ${className}` : ""}`}
            rootClassName={`canvas-editor-modal-root${dark ? " is-dark" : ""}`}
            classNames={{ container: dark ? "is-dark" : undefined }}
            title={ariaTitle ? <span className="canvas-editor-modal-a11y-title">{ariaTitle}</span> : null}
            open={open}
            centered
            width={width}
            footer={null}
            closable={closable}
            // Keep the portal mounted through the leave animation so the closing
            // click cannot fall through onto the infinite canvas underneath.
            destroyOnHidden={false}
            zIndex={12000}
            // Canvas styles are scoped to `.canvas-native-mount` / overlay root.
            getContainer={() => getCanvasPortalRoot()}
            mask={{ closable: true }}
            onCancel={handleClose}
        >
            <div
                data-canvas-no-zoom
                data-canvas-shortcuts-ignore
                onWheel={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                {title ? (
                    <div className="mb-4 flex items-center gap-3 pr-10">
                        {icon ? (
                            <span className="grid size-9 shrink-0 place-items-center rounded-[11px]" style={dark ? { background: "#6d5cff", color: "#fff" } : CanvasIconWellStyle("#6d5cff")}>
                                {icon}
                            </span>
                        ) : null}
                        <div className="min-w-0 shrink-0 text-[16px] font-semibold tracking-[-0.02em]" style={{ color: theme.node.text }}>
                            {title}
                        </div>
                        {hint}
                        <div className="min-w-0 flex-1" />
                        {meta ? <div className="shrink-0 text-[11px] font-medium tabular-nums opacity-40">{meta}</div> : null}
                    </div>
                ) : null}
                {children}
            </div>
        </Modal>
    );
}

export function EditorPrimaryButton({ children, onClick, disabled, icon, className }: { children: ReactNode; onClick?: () => void; disabled?: boolean; icon?: ReactNode; className?: string }) {
    return (
        <button type="button" className={`canvas-editor-btn is-primary ${className || ""}`.trim()} disabled={disabled} onClick={onClick}>
            {icon}
            {children}
        </button>
    );
}

export function EditorGhostButton({ children, onClick, disabled, icon, danger, className }: { children: ReactNode; onClick?: () => void; disabled?: boolean; icon?: ReactNode; danger?: boolean; className?: string }) {
    return (
        <button type="button" className={`canvas-editor-btn${danger ? " is-danger" : ""}${className ? ` ${className}` : ""}`} disabled={disabled} onClick={onClick}>
            {icon}
            {children}
        </button>
    );
}

export function EditorIconButton({ title, onClick, disabled, children }: { title?: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
    return (
        <button type="button" className="canvas-editor-icon-btn" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}

export function EditorChip({ label, active, onClick, disabled }: { label: ReactNode; active?: boolean; onClick?: () => void; disabled?: boolean }) {
    return (
        <button type="button" className={`canvas-prompt-filter-chip${active ? " is-active" : ""}`} disabled={disabled} onClick={onClick}>
            {label}
        </button>
    );
}
