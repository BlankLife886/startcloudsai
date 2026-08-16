import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export function CanvasNodeContextMenu({ menu, onClose, onDuplicate, onDelete }: { menu: ContextMenuState; onClose: () => void; onDuplicate: () => void; onDelete: () => void }) {
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
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label={t("canvas.controls.duplicate")} onClick={onDuplicate} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label={t("canvas.controls.delete")} onClick={onDelete} danger />
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
