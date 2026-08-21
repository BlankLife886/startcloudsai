import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Modal, Popconfirm, Switch } from "antd";
import { Download, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasIconWellStyle } from "@/lib/canvas-ui";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, hasUpgrade, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialError, setOfficialError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
        }
    }, []);

    useEffect(() => {
        if (open) void loadOfficial();
    }, [open, loadOfficial]);

    const handleInstallOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: true });
            message.success(t("canvas.plugins.installed", { name: plugin.name }));
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(successText);
        } catch (error) {
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    const installedControls = (record: InstalledPlugin, upgradable = false) => (
        <div className="flex shrink-0 items-center gap-1">
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
            {!record.local && (
                <>
                    <IconAction
                        title={t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
                        active={upgradable}
                        theme={theme}
                        onClick={() => runOnPlugin(record, async () => void (await updatePlugin(record)), t("canvas.plugins.updated"))}
                    >
                        <RefreshCw className={`size-3.5 ${busyId === record.id ? "animate-spin" : ""}`} />
                    </IconAction>
                    <Popconfirm title={t("canvas.plugins.uninstallTitle")} okText={t("canvas.plugins.uninstall")} cancelText={t("canvas.editors.cancel")} onConfirm={() => uninstallPlugin(record.id)}>
                        <span>
                            <IconAction title={t("canvas.plugins.uninstall")} danger theme={theme}>
                                <Trash2 className="size-3.5" />
                            </IconAction>
                        </span>
                    </Popconfirm>
                </>
            )}
        </div>
    );

    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <span className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "#22c55e", boxShadow: `0 0 0 2px ${theme.toolbar.panel}` }} title={t("canvas.plugins.newVersion")} />
        </span>
    );

    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-[16px] px-2.5 py-2.5" style={{ background: theme.toolbar.itemHover }}>
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] text-base" style={CanvasIconWellStyle("#6d5cff")}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                        v{version}
                    </span>
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-[12px]" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const emptyHint = (text: string) => (
        <div className="canvas-empty py-10">
            <span className="canvas-empty__icon" style={CanvasIconWellStyle("#6d5cff")}>
                <Puzzle className="size-5" />
            </span>
            <div className="canvas-empty__hint">{text}</div>
        </div>
    );

    return (
        <Modal className="canvas-shortcuts-modal canvas-plugin-modal" title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={640}>
            {officialError ? (
                <div className="rounded-[14px] px-3 py-2 text-[12px]" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {t("canvas.plugins.loadFailed", { error: officialError })}
                </div>
            ) : loadingOfficial && official.length === 0 ? (
                emptyHint(t("canvas.plugins.loadingOfficial"))
            ) : official.length === 0 ? (
                emptyHint(t("canvas.plugins.noOfficial"))
            ) : (
                <div className="space-y-1.5">
                    {official.map((entry) => {
                        const record = recordById.get(entry.id);
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            entry.description,
                            record ? (
                                installedControls(record, upgradable)
                            ) : (
                                <button
                                    type="button"
                                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold disabled:opacity-50"
                                    style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}
                                    disabled={busyId === entry.id}
                                    onClick={() => handleInstallOfficial(entry)}
                                >
                                    <Download className="size-3.5" />
                                    {t("canvas.plugins.install")}
                                </button>
                            ),
                        );
                    })}
                </div>
            )}
        </Modal>
    );
}

function IconAction({
    title,
    theme,
    danger,
    active,
    onClick,
    children,
}: {
    title: string;
    theme: CanvasTheme;
    danger?: boolean;
    active?: boolean;
    onClick?: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            className="grid size-8 place-items-center rounded-full transition"
            style={{
                color: danger ? "#ef4444" : active ? theme.toolbar.activeText : theme.node.muted,
                background: active ? theme.toolbar.activeBg : "transparent",
            }}
            title={title}
            aria-label={title}
            onClick={onClick}
            onMouseEnter={(event) => {
                if (!active) event.currentTarget.style.background = danger ? "rgba(239,68,68,.08)" : theme.toolbar.itemHover;
            }}
            onMouseLeave={(event) => {
                event.currentTarget.style.background = active ? theme.toolbar.activeBg : "transparent";
            }}
        >
            {children}
        </button>
    );
}
