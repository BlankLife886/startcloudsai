import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isCanvasNodeTypeEnabled } from "@/constant/canvas";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CANVAS_ACCENT, colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { useThemeStore } from "@/stores/use-theme-store";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasOperationNodeType, isCanvasOperationNodeType } from "@/lib/canvas/canvas-operation-node";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";
import { CanvasFloatingLayer } from "./canvas-floating-layer";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

type CreateMenuItem = {
    key: string;
    title: string;
    description?: string;
    icon: React.ReactNode;
    accent: string;
    disabled?: boolean;
    hint?: string;
    onClick?: () => void;
};

type CreateMenuSection = {
    id: string;
    label: string;
    items: CreateMenuItem[];
};

function nodeAccent(def?: Pick<CanvasNodeDefinition, "type" | "minimapColor"> | null) {
    if (!def) return CANVAS_ACCENT;
    return def.minimapColor || nodeTypeColor(def.type);
}

function matchesQuery(haystack: string, query: string) {
    if (!query) return true;
    return haystack.toLowerCase().includes(query);
}

function matchesDefinition(def: CanvasNodeDefinition, query: string) {
    return matchesQuery(`${def.title} ${def.description || ""} ${def.type}`, query);
}

function MenuShell({
    children,
    className,
    style,
    menuRef,
    connection,
    position,
    width,
}: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    menuRef?: React.RefObject<HTMLDivElement | null>;
    connection?: boolean;
    position: Position;
    width: number;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const anchorRef = useRef<HTMLSpanElement>(null);
    return (
        <>
            <span ref={anchorRef} aria-hidden className="pointer-events-none absolute" style={{ left: position.x, top: position.y, width: 0, height: 0 }} />
            <CanvasFloatingLayer
                anchorRef={anchorRef}
                panelRef={menuRef}
                placement="bottom-start"
                gap={0}
                width={width}
                className={`canvas-float-menu rounded-[20px] border shadow-2xl backdrop-blur-xl ${className || ""}`}
                data-connection-create-menu={connection ? "" : undefined}
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: theme.toolbar.shadow, color: theme.node.text, ...style }}
            >
                {children}
            </CanvasFloatingLayer>
        </>
    );
}

function MenuHeader({ title, onClose }: { title: string; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div className="flex items-center justify-between gap-1 px-0.5 pb-1">
            <span className="text-[11px] font-semibold tracking-wide" style={{ color: theme.node.text }}>
                {title}
            </span>
            <button
                type="button"
                className="grid size-5 place-items-center rounded-full transition"
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
                <X className="size-3" />
            </button>
        </div>
    );
}

function NodeIcon({ icon, color }: { icon: React.ReactNode; color: string }) {
    return (
        <span
            className="grid shrink-0 place-items-center rounded-[6px] text-[11px] leading-none [&>img]:size-3 [&>img]:object-contain [&>svg]:size-3"
            style={{ background: colorWash(color, 0.12), color, width: 22, height: 22 }}
        >
            {icon}
        </span>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="px-0.5 pb-px pt-1 text-[9px] font-medium tracking-[0.04em]" style={{ color: theme.node.faint }}>
            {children}
        </div>
    );
}

function CreateListOption({
    theme,
    icon,
    title,
    description,
    accent = CANVAS_ACCENT,
    disabled = false,
    hint,
    onClick,
}: {
    theme: CanvasTheme;
    icon: React.ReactNode;
    title: string;
    description?: string;
    accent?: string;
    disabled?: boolean;
    hint?: string;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? hint || description : description ? `${title} · ${description}` : title}
            className="flex w-full items-center gap-1.5 rounded-[8px] px-1 py-0.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40"
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
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4">{title}</span>
        </button>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: CanvasTheme; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return <CreateListOption theme={theme} icon={icon} title={title} description={description} onClick={onClick} />;
}

function CreateMenuSections({ sections, emptyLabel }: { sections: CreateMenuSection[]; emptyLabel: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const visible = sections.filter((section) => section.items.length);
    if (!visible.length) {
        return (
            <div className="px-2 py-6 text-center text-[11px]" style={{ color: theme.node.faint }}>
                {emptyLabel}
            </div>
        );
    }
    return (
        <div className="thin-scrollbar max-h-[min(52vh,360px)] overflow-y-auto">
            {visible.map((section, index) => (
                <div key={section.id} className={index === 0 ? "" : "border-t"} style={{ borderColor: theme.toolbar.border }}>
                    <SectionLabel>{section.label}</SectionLabel>
                    <div className="grid grid-cols-2 gap-x-0.5 gap-y-0">
                        {section.items.map((item) => (
                            <CreateListOption
                                key={item.key}
                                theme={theme}
                                icon={item.icon}
                                title={item.title}
                                description={item.description}
                                accent={item.accent}
                                disabled={item.disabled}
                                hint={item.hint}
                                onClick={item.onClick}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function useDismissibleMenu(onClose: () => void, menuRef: React.RefObject<HTMLDivElement | null>, searchRef?: React.RefObject<HTMLInputElement | null>) {
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        const timer = window.setTimeout(() => searchRef?.current?.focus(), 30);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
            window.clearTimeout(timer);
        };
    }, [menuRef, onClose, searchRef]);
}

/** Grouped node list shared by the create menus and the toolbar's more-tools panel. */
export function CanvasNodeDefinitionSections({
    sections,
    onCreate,
}: {
    sections: Array<{ id: string; label: string; definitions: CanvasNodeDefinition[] }>;
    onCreate: (type: string) => void;
}) {
    const { t } = useTranslation();
    const unavailable = t("canvas.unavailable");
    return (
        <CreateMenuSections
            sections={sections.map((section) => ({
                id: section.id,
                label: section.label,
                items: section.definitions.map((def) => definitionToItem(def, onCreate, unavailable)),
            }))}
            emptyLabel={t("canvas.createMenu.empty")}
        />
    );
}

function definitionToItem(def: CanvasNodeDefinition, onCreate: (type: string) => void, unavailableLabel: string): CreateMenuItem {
    return {
        key: def.type,
        title: def.title,
        description: def.description,
        icon: def.icon,
        accent: nodeAccent(def),
        disabled: !isCanvasNodeTypeEnabled(def.type),
        hint: unavailableLabel,
        onClick: () => onCreate(def.type),
    };
}

function partitionBuiltinDefinitions(definitions: CanvasNodeDefinition[]) {
    const media: CanvasNodeDefinition[] = [];
    const generate: CanvasNodeDefinition[] = [];
    const process: CanvasNodeDefinition[] = [];
    const organize: CanvasNodeDefinition[] = [];
    const other: CanvasNodeDefinition[] = [];
    const mediaTypes = new Set<string>([CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio]);
    const processTypes = new Set<string>([
        CanvasOperationNodeType.Crop,
        CanvasOperationNodeType.Split,
        CanvasOperationNodeType.Upscale,
        CanvasOperationNodeType.Angle,
        CanvasOperationNodeType.ReversePrompt,
    ]);

    for (const def of definitions) {
        if (mediaTypes.has(def.type)) media.push(def);
        else if (def.type === CanvasNodeType.Config) generate.push(def);
        else if (processTypes.has(def.type) || isCanvasOperationNodeType(def.type)) process.push(def);
        else if (def.type === CanvasNodeType.Group) organize.push(def);
        else other.push(def);
    }
    return { media, generate, process, organize, other };
}

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onCreateStoryboard,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: string) => void;
    onCreateStoryboard?: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    useDismissibleMenu(onClose, menuRef);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const builtin = definitions.filter((def) => getNodePluginId(def.type) === "builtin");
    const extensions = definitions.filter((def) => getNodePluginId(def.type) !== "builtin");
    const partitioned = partitionBuiltinDefinitions(builtin);
    const unavailable = t("canvas.unavailable");
    const storyboardTitle = t("canvas.toolbar.storyboard");
    const storyboardDescription = t("canvas.storyboard.configSubtitle");
    const sections: CreateMenuSection[] = [
        { id: "media", label: t("canvas.createMenu.sectionMedia"), items: partitioned.media.map((def) => definitionToItem(def, onCreate, unavailable)) },
        {
            id: "generate",
            label: t("canvas.createMenu.sectionGenerate"),
            items: [
                ...partitioned.generate.map((def) => definitionToItem(def, onCreate, unavailable)),
                ...(onCreateStoryboard
                    ? [
                          {
                              key: "storyboard-batch",
                              title: storyboardTitle,
                              description: storyboardDescription,
                              icon: <Clapperboard className="size-3" />,
                              accent: CANVAS_ACCENT,
                              onClick: onCreateStoryboard,
                          } satisfies CreateMenuItem,
                      ]
                    : []),
                ...partitioned.other.map((def) => definitionToItem(def, onCreate, unavailable)),
            ],
        },
        { id: "process", label: t("canvas.createMenu.sectionProcess"), items: partitioned.process.map((def) => definitionToItem(def, onCreate, unavailable)) },
        { id: "organize", label: t("canvas.createMenu.sectionOrganize"), items: partitioned.organize.map((def) => definitionToItem(def, onCreate, unavailable)) },
        { id: "extensions", label: t("canvas.createMenu.extensions"), items: extensions.map((def) => definitionToItem(def, onCreate, unavailable)) },
    ];

    return (
        <MenuShell menuRef={menuRef} connection className="p-1.5" position={pending.position} width={260} style={{ borderRadius: 14 }}>
            <MenuHeader title={t("canvas.createMenu.fromNode")} onClose={onClose} />
            <CreateMenuSections sections={sections} emptyLabel={t("canvas.createMenu.empty")} />
        </MenuShell>
    );
}

export function NodeCreateMenu({
    position,
    onCreate,
    onCreateStoryboard,
    onClose,
}: {
    position: Position;
    onCreate: (type: string) => void;
    onCreateStoryboard?: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const normalized = query.trim().toLowerCase();
    useDismissibleMenu(onClose, menuRef, searchRef);

    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const builtin = useMemo(
        () => definitions.filter((def) => getNodePluginId(def.type) === "builtin" && matchesDefinition(def, normalized)),
        [definitions, normalized],
    );
    const extensions = useMemo(
        () => definitions.filter((def) => getNodePluginId(def.type) !== "builtin" && matchesDefinition(def, normalized)),
        [definitions, normalized],
    );
    const partitioned = useMemo(() => partitionBuiltinDefinitions(builtin), [builtin]);
    const storyboardTitle = t("canvas.toolbar.storyboard");
    const storyboardDescription = t("canvas.storyboard.configSubtitle");
    const storyboardMatches =
        Boolean(onCreateStoryboard) &&
        matchesQuery(`${storyboardTitle} ${storyboardDescription} storyboard batch 批量配置`, normalized);
    const unavailable = t("canvas.unavailable");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const sections: CreateMenuSection[] = [
        {
            id: "media",
            label: t("canvas.createMenu.sectionMedia"),
            items: partitioned.media.map((def) => definitionToItem(def, onCreate, unavailable)),
        },
        {
            id: "generate",
            label: t("canvas.createMenu.sectionGenerate"),
            items: [
                ...partitioned.generate.map((def) => definitionToItem(def, onCreate, unavailable)),
                ...(storyboardMatches
                    ? [
                          {
                              key: "storyboard-batch",
                              title: storyboardTitle,
                              description: storyboardDescription,
                              icon: <Clapperboard className="size-3" />,
                              accent: CANVAS_ACCENT,
                              onClick: onCreateStoryboard,
                          } satisfies CreateMenuItem,
                      ]
                    : []),
                ...partitioned.other.map((def) => definitionToItem(def, onCreate, unavailable)),
            ],
        },
        {
            id: "process",
            label: t("canvas.createMenu.sectionProcess"),
            items: partitioned.process.map((def) => definitionToItem(def, onCreate, unavailable)),
        },
        {
            id: "organize",
            label: t("canvas.createMenu.sectionOrganize"),
            items: partitioned.organize.map((def) => definitionToItem(def, onCreate, unavailable)),
        },
        {
            id: "extensions",
            label: t("canvas.createMenu.extensions"),
            items: extensions.map((def) => definitionToItem(def, onCreate, unavailable)),
        },
    ];

    return (
        <MenuShell menuRef={menuRef} className="p-1.5" position={position} width={260} style={{ borderRadius: 14 }}>
            <MenuHeader title={t("canvas.createMenu.select")} onClose={onClose} />
            <label
                className="mb-0.5 flex h-7 items-center gap-1 rounded-[8px] px-1.5"
                style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}
            >
                <Search className="size-3 shrink-0 opacity-70" />
                <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("canvas.createMenu.search")}
                    className="h-full w-full bg-transparent text-[11px] outline-none"
                    style={{ color: theme.node.text }}
                />
            </label>
            <CreateMenuSections sections={sections} emptyLabel={t("canvas.createMenu.empty")} />
        </MenuShell>
    );
}
