import type { ReactNode } from "react";
import { Modal } from "antd";

import { useIsDark } from "@react/hooks/useIsDark.js";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasIconWellStyle } from "@/lib/canvas-ui";
import { useThemeStore } from "@/stores/use-theme-store";

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
}) {
    const hostDark = useIsDark();
    const colorTheme = useThemeStore((state) => state.theme);
    const dark = colorTheme === "dark" || hostDark;
    const theme = canvasThemes[dark ? "dark" : "light"];

    return (
        <Modal
            className={`canvas-editor-modal${dark ? " is-dark" : ""}${className ? ` ${className}` : ""}`}
            rootClassName={dark ? "is-dark" : undefined}
            classNames={{ container: dark ? "is-dark" : undefined }}
            title={null}
            open={open}
            centered
            width={width}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div data-canvas-no-zoom data-canvas-shortcuts-ignore onWheel={(event) => event.stopPropagation()}>
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
