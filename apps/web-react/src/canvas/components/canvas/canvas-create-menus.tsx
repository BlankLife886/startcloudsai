import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, List, Music2, Search, Settings2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isCanvasNodeTypeEnabled } from "@/constant/canvas";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CANVAS_ACCENT, colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { useThemeStore } from "@/stores/use-theme-store";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

function nodeAccent(def?: Pick<CanvasNodeDefinition, "type" | "minimapColor"> | null) {
    if (!def) return CANVAS_ACCENT;
    return def.minimapColor || nodeTypeColor(def.type);
}

function matchesQuery(def: CanvasNodeDefinition, query: string) {
    if (!query) return true;
    const haystack = `${def.title} ${def.description || ""} ${def.type}`.toLowerCase();
    return haystack.includes(query);
}

function MenuShell({
    children,
    className,
    style,
    menuRef,
    connection,
}: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    menuRef?: React.Ref<HTMLDivElement>;
    connection?: boolean;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            ref={menuRef}
            className={`canvas-float-menu absolute z-[120] overflow-hidden rounded-[22px] border shadow-2xl backdrop-blur-xl ${className || ""}`}
            data-canvas-no-zoom
            data-connection-create-menu={connection ? "" : undefined}
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: theme.toolbar.shadow, color: theme.node.text, ...style }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}

function MenuHeader({ title, onClose }: { title: string; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[13px] font-semibold tracking-wide" style={{ color: theme.node.text }}>
                {title}
            </span>
            <button
                type="button"
                className="grid size-7 place-items-center rounded-full transition"
                style={{ color: theme.node.muted }}
                onMouseEnter={(event) => {
                    event.currentTarget.style.background = theme.toolbar.itemHover;
                    event.currentTarget.style.color = theme.node.text;
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                    event.currentTarget.style.color = theme.node.muted;
                }}
                onClick={onClose}
                aria-label={t("canvas.createMenu.close")}
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}

function NodeIcon({ icon, color }: { icon: React.ReactNode; color: string }) {
    return (
        <span
            className="grid size-8 shrink-0 place-items-center rounded-[10px] text-[15px] leading-none [&>img]:size-4 [&>img]:object-contain [&>svg]:size-4"
            style={{ background: colorWash(color), color }}
        >
            {icon}
        </span>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="px-1 pb-1.5 pt-2 text-[11px] font-medium tracking-wide" style={{ color: theme.node.faint }}>
            {children}
        </div>
    );
}

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: string) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const basic = definitions.filter((def) => getNodePluginId(def.type) === "builtin");
    const extensions = definitions.filter((def) => getNodePluginId(def.type) !== "builtin");
    return (
        <MenuShell connection className="w-[300px] p-2.5" style={{ left: pending.position.x, top: pending.position.y }}>
            <MenuHeader title={t("canvas.createMenu.fromNode")} onClose={onClose} />
            <div className="thin-scrollbar max-h-[min(62vh,520px)] overflow-y-auto pr-0.5">
                {basic.length ? <SectionLabel>{t("canvas.createMenu.basic")}</SectionLabel> : null}
                <div className="grid gap-0.5">
                    {basic.map((def) => (
                        <CreateListOption key={def.type} theme={theme} accent={nodeAccent(def)} icon={def.icon} title={def.title} description={def.description} disabled={!isCanvasNodeTypeEnabled(def.type)} onClick={() => onCreate(def.type)} />
                    ))}
                </div>
                {extensions.length ? <SectionLabel>{t("canvas.createMenu.extensions")}</SectionLabel> : null}
                <div className="grid gap-0.5">
                    {extensions.map((def) => (
                        <CreateListOption key={def.type} theme={theme} accent={nodeAccent(def)} icon={def.icon} title={def.title} description={def.description} disabled={!isCanvasNodeTypeEnabled(def.type)} onClick={() => onCreate(def.type)} />
                    ))}
                </div>
            </div>
        </MenuShell>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: CanvasTheme; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return <CreateListOption theme={theme} icon={icon} title={title} description={description} onClick={onClick} />;
}

function CreateListOption({
    theme,
    icon,
    title,
    description,
    accent = CANVAS_ACCENT,
    disabled = false,
    onClick,
}: {
    theme: CanvasTheme;
    icon: React.ReactNode;
    title: string;
    description?: string;
    accent?: string;
    disabled?: boolean;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? description : undefined}
            className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: theme.node.text }}
            onClick={disabled ? undefined : onClick}
            onMouseEnter={(event) => {
                if (!disabled) event.currentTarget.style.background = theme.toolbar.itemHover;
            }}
            onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
            }}
        >
            <NodeIcon icon={icon} color={accent} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-5">{title}</span>
                {description ? (
                    <span className="mt-0.5 block truncate text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

function CreateTileOption({
    theme,
    icon,
    title,
    accent,
    disabled = false,
    hint,
    onClick,
}: {
    theme: CanvasTheme;
    icon: React.ReactNode;
    title: string;
    accent: string;
    disabled?: boolean;
    hint?: string;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? hint : undefined}
            className="flex h-11 w-full items-center gap-2 rounded-[14px] px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: theme.node.text, background: colorWash(accent, disabled ? 0.04 : 0.05) }}
            onClick={disabled ? undefined : onClick}
            onMouseEnter={(event) => {
                if (!disabled) event.currentTarget.style.background = colorWash(accent, 0.12);
            }}
            onMouseLeave={(event) => {
                event.currentTarget.style.background = colorWash(accent, disabled ? 0.04 : 0.05);
            }}
        >
            <NodeIcon icon={icon} color={accent} />
            <span className="min-w-0 truncate text-[13px] font-medium">{title}</span>
        </button>
    );
}

export function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const normalized = query.trim().toLowerCase();
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const basic = useMemo(() => definitions.filter((def) => getNodePluginId(def.type) === "builtin" && matchesQuery(def, normalized)), [definitions, normalized]);
    const extensions = useMemo(() => definitions.filter((def) => getNodePluginId(def.type) !== "builtin" && matchesQuery(def, normalized)), [definitions, normalized]);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
            window.clearTimeout(timer);
        };
    }, [onClose]);

    return (
        <MenuShell menuRef={menuRef} className="w-[308px] p-2.5" style={{ left: position.x, top: position.y }}>
            <MenuHeader title={t("canvas.createMenu.select")} onClose={onClose} />
            <label
                className="mb-1 flex h-9 items-center gap-2 rounded-[12px] px-2.5"
                style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}
            >
                <Search className="size-3.5 shrink-0 opacity-70" />
                <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("canvas.createMenu.search")}
                    className="h-full w-full bg-transparent text-[13px] outline-none"
                    style={{ color: theme.node.text }}
                />
            </label>
            <div className="thin-scrollbar max-h-[min(62vh,520px)] overflow-y-auto pr-0.5">
                {basic.length ? (
                    <>
                        <SectionLabel>{t("canvas.createMenu.basic")}</SectionLabel>
                        <div className="grid grid-cols-2 gap-1.5">
                            {basic.map((def) => {
                                const disabled = !isCanvasNodeTypeEnabled(def.type);
                                return (
                                    <CreateTileOption
                                        key={def.type}
                                        theme={theme}
                                        icon={def.icon}
                                        title={def.title}
                                        accent={nodeAccent(def)}
                                        disabled={disabled}
                                        hint={t("canvas.unavailable")}
                                        onClick={() => onCreate(def.type)}
                                    />
                                );
                            })}
                        </div>
                    </>
                ) : null}
                {extensions.length ? (
                    <>
                        <SectionLabel>{t("canvas.createMenu.extensions")}</SectionLabel>
                        <div className="grid gap-0.5">
                            {extensions.map((def) => (
                                <CreateListOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} accent={nodeAccent(def)} onClick={() => onCreate(def.type)} />
                            ))}
                        </div>
                    </>
                ) : null}
                {!basic.length && !extensions.length ? (
                    <div className="px-2 py-8 text-center text-[12px]" style={{ color: theme.node.faint }}>
                        {t("canvas.createMenu.empty")}
                    </div>
                ) : null}
            </div>
        </MenuShell>
    );
}
