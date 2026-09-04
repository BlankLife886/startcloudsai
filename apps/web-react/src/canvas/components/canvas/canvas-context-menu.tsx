import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Eye, Pencil, Settings2, Trash2 } from "lucide-react";
import { DownloadIcon } from "@react/components/common/DownloadIcon.jsx";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export function CanvasNodeContextMenu({ menu, connectionCount = 1, onClose, onRename, onEdit, onPreview, onDownload, onDelete }: { menu: ContextMenuState; connectionCount?: number; onClose: () => void; onRename?: () => void; onEdit?: () => void; onPreview?: () => void; onDownload?: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const close = (event: Event) => {
            if (event.target instanceof Element && event.target.closest("[data-canvas-context-menu]")) return;
            onCloseRef.current();
        };
        const timer = window.setTimeout(() => {
            window.addEventListener("pointerdown", close);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("pointerdown", close);
        };
    }, []);

    return (
        <div
            data-canvas-context-menu
            className="canvas-float-menu fixed z-[80] min-w-48 overflow-hidden rounded-[18px] border p-1 shadow-2xl backdrop-blur-xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: theme.toolbar.shadow, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" ? (
                <>
                    {onRename ? <MenuButton icon={<Pencil className="size-4" />} label={t("canvas.nodeToolbar.rename")} onClick={onRename} /> : null}
                    {onEdit ? <MenuButton icon={<Settings2 className="size-4" />} label={t("common.edit")} onClick={onEdit} /> : null}
                    {onPreview ? <MenuButton icon={<Eye className="size-4" />} label={t("canvas.imageTools.view")} onClick={onPreview} /> : null}
                    {onDownload ? <MenuButton icon={<DownloadIcon className="size-4" />} label={t("common.download")} onClick={onDownload} /> : null}
                    <div className="my-1 h-px" style={{ background: theme.toolbar.border }} />
                </>
            ) : null}
            <MenuButton icon={<Trash2 className="size-4" />} label={menu.type === "connection" && connectionCount > 1 ? t("canvas.controls.deleteConnections", { count: connectionCount }) : t("canvas.controls.delete")} onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[13px] font-medium transition"
            style={{ color: danger ? "#ef4444" : theme.node.text }}
            onMouseEnter={(event) => (event.currentTarget.style.background = danger ? "rgba(239,68,68,.08)" : theme.toolbar.itemHover)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
            onClick={onClick}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}
