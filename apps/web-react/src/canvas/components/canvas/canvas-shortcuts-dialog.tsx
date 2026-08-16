import { Modal } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type ShortcutItem = {
    keys: string[];
    action: string;
    join?: "plus" | "slash";
};

type ShortcutGroup = {
    title: string;
    items: ShortcutItem[];
};

function isApplePlatform() {
    if (typeof navigator === "undefined") return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export function CanvasShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const apple = isApplePlatform();
    const mod = apple ? "⌘" : "Ctrl";
    const shift = apple ? "⇧" : "Shift";
    const groups: ShortcutGroup[] = [
        {
            title: t("canvas.shortcut.groupView"),
            items: [
                { keys: [mod, "Space", t("canvas.shortcut.drag")], action: t("canvas.shortcut.toggleTool") },
                { keys: [t("canvas.shortcut.wheel")], action: t("canvas.shortcut.zoom") },
                { keys: [t("canvas.shortcut.zoomSlider")], action: t("canvas.shortcut.preciseZoom") },
            ],
        },
        {
            title: t("canvas.shortcut.groupSelect"),
            items: [
                { keys: [t("canvas.shortcut.drag")], action: t("canvas.shortcut.boxSelect") },
                { keys: [shift, t("canvas.shortcut.click")], action: t("canvas.shortcut.addSelection") },
                { keys: [mod, "A"], action: t("canvas.shortcut.selectAll") },
                { keys: ["Esc"], action: t("canvas.shortcut.escape") },
            ],
        },
        {
            title: t("canvas.shortcut.groupEdit"),
            items: [
                { keys: [mod, "C", "V"], action: t("canvas.shortcut.copyPaste"), join: "slash" },
                { keys: [mod, "Z"], action: t("canvas.undo") },
                { keys: [mod, shift, "Z"], action: t("canvas.redo") },
                { keys: ["Delete"], action: t("canvas.shortcut.delete") },
                { keys: [t("canvas.shortcut.dropMedia")], action: t("canvas.shortcut.upload") },
            ],
        },
    ];

    return (
        <Modal
            className="canvas-shortcuts-modal"
            title={t("canvas.shortcuts")}
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            width={460}
            destroyOnHidden
        >
            <div className="space-y-4">
                {groups.map((group) => (
                    <section key={group.title}>
                        <div className="canvas-shortcuts-group__label" style={{ color: theme.node.faint }}>
                            {group.title}
                        </div>
                        <div className="grid gap-0.5">
                            {group.items.map((item) => (
                                <div key={item.action} className="canvas-shortcuts-row">
                                    <span className="min-w-0 text-[13px] font-medium leading-5" style={{ color: theme.node.text }}>
                                        {item.action}
                                    </span>
                                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                        {item.keys.map((key, index) => (
                                            <span key={`${item.action}-${key}-${index}`} className="flex items-center gap-1">
                                                {index ? <span className="text-[11px] opacity-35">{item.join === "slash" && index === item.keys.length - 1 ? "/" : "+"}</span> : null}
                                                <kbd className="canvas-key-chip">{key}</kbd>
                                            </span>
                                        ))}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </Modal>
    );
}
