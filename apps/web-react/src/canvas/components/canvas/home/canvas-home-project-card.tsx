import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Check, Copy, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { DownloadIcon } from "@react/components/common/DownloadIcon.jsx";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import { prefetchCanvasProjectDocument, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasTopologyPreview } from "@/components/canvas/canvas-project-card";
import { useViewportMedia } from "@/components/canvas/canvas-preview-image";
import { formatCanvasProjectBytes } from "@/lib/canvas/canvas-project-quota-rules";
import { cn } from "@/lib/utils";
import { formatProjectDate, projectGroupOf } from "./canvas-home-shared";

export type CanvasHomeProjectActions = {
    onOpen: (project: CanvasProject, event?: ReactMouseEvent) => void;
    onRename: (project: CanvasProject) => void;
    onDuplicate: (project: CanvasProject) => void;
    onExport: (project: CanvasProject) => void;
    onDelete: (project: CanvasProject) => void;
};

type CardProps = CanvasHomeProjectActions & {
    project: CanvasProject;
    index: number;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: (project: CanvasProject) => void;
    maxBytes?: number;
};

function projectStats(project: CanvasProject) {
    if (project.documentPending) return i18n.t("canvas.homePage.common.loading");
    return i18n.t("canvas.homePage.common.stats", { nodes: project.nodes.length, connections: project.connections.length });
}

function useProjectPrefetch(project: CanvasProject) {
    const { elementRef, shouldLoad } = useViewportMedia(Boolean(project.documentPending || project.documentStale));
    useEffect(() => {
        if (shouldLoad) prefetchCanvasProjectDocument(project.id);
    }, [project.id, shouldLoad]);
    return elementRef;
}

function ProjectMenu({ project, actions, onClose, className }: { project: CanvasProject; actions: CanvasHomeProjectActions; onClose: () => void; className: string }) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target as Element | null;
            if (ref.current?.contains(target) || target?.closest?.(`[data-ch-menu-anchor="${project.id}"]`)) return;
            onClose();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", escape);
        };
    }, [onClose, project.id]);
    const run = (event: ReactMouseEvent, action: () => void) => {
        event.stopPropagation();
        onClose();
        action();
    };
    return (
        <div ref={ref} role="menu" className={cn("ch-menu", className)} onClick={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={(event) => run(event, () => actions.onOpen(project, event))}>
                <FolderOpen className="size-4" />{t("canvas.homePage.common.open")}
            </button>
            <button type="button" role="menuitem" onClick={(event) => run(event, () => actions.onRename(project))}>
                <Pencil className="size-4" />{t("canvas.homePage.common.rename")}
            </button>
            <button type="button" role="menuitem" onClick={(event) => run(event, () => actions.onDuplicate(project))}>
                <Copy className="size-4" />{t("canvas.homePage.common.duplicate")}
            </button>
            <button type="button" role="menuitem" onClick={(event) => run(event, () => actions.onExport(project))}>
                <DownloadIcon className="size-4" />{t("canvas.homePage.common.export")}
            </button>
            <button type="button" role="menuitem" className="is-danger" onClick={(event) => run(event, () => actions.onDelete(project))}>
                <Trash2 className="size-4" />{t("canvas.homePage.common.delete")}
            </button>
        </div>
    );
}

/** 画布库网格卡片：与「继续创作」同一画布风格，另带多选勾选框和「⋯」菜单。 */
export function CanvasHomeProjectCard({ project, index, selectMode, selected, onToggleSelect, ...actions }: CardProps) {
    const { t } = useTranslation();
    const elementRef = useProjectPrefetch(project);
    const [menuOpen, setMenuOpen] = useState(false);
    const click = (event: ReactMouseEvent) => {
        if (selectMode) onToggleSelect?.(project);
        else actions.onOpen(project, event);
    };
    return (
        <article
            ref={(node) => {
                elementRef.current = node;
            }}
            className={cn("ch-rcard", selected && "is-selected", menuOpen && "is-menu-open")}
            style={{ animationDelay: `${Math.min(index, 12) * 50}ms`, "--rc-hue": projectHue(project.id) } as CSSProperties}
            tabIndex={0}
            role="button"
            aria-label={selectMode ? t("canvas.homePage.common.selectProject", { title: project.title }) : t("canvas.homePage.common.openProject", { title: project.title })}
            aria-pressed={selectMode ? Boolean(selected) : undefined}
            onClick={click}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (selectMode) onToggleSelect?.(project);
                    else actions.onOpen(project);
                }
            }}
        >
            <RecentCanvasContent project={project} />
            {selectMode ? (
                <span className={cn("ch-check ch-rcard__check", selected && "is-on")} aria-hidden="true">
                    <Check className="size-3.5" strokeWidth={3} />
                </span>
            ) : (
                <button
                    type="button"
                    className="ch-more ch-rcard__more"
                    aria-label={t("canvas.homePage.common.moreActions", { title: project.title })}
                    data-ch-menu-anchor={project.id}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen((open) => !open);
                    }}
                >
                    <MoreHorizontal className="size-4" />
                </button>
            )}
            {menuOpen ? <ProjectMenu project={project} actions={actions} onClose={() => setMenuOpen(false)} className="bottom-2 right-12" /> : null}
        </article>
    );
}

export function CanvasHomeProjectRow({ project, index, selectMode, selected, onToggleSelect, maxBytes = 1, ...actions }: CardProps) {
    const { t } = useTranslation();
    const elementRef = useProjectPrefetch(project);
    const [menuOpen, setMenuOpen] = useState(false);
    const bytes = project.sizeBytes || 0;
    return (
        <div
            ref={(node) => {
                elementRef.current = node;
            }}
            className={cn("ch-row", selected && "is-selected", menuOpen && "is-menu-open")}
            style={{ animationDelay: `${Math.min(index, 16) * 30}ms` }}
            tabIndex={0}
            role="button"
            aria-label={selectMode ? t("canvas.homePage.common.selectProject", { title: project.title }) : t("canvas.homePage.common.openProject", { title: project.title })}
            aria-pressed={selectMode ? Boolean(selected) : undefined}
            onClick={(event) => (selectMode ? onToggleSelect?.(project) : actions.onOpen(project, event))}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (selectMode) onToggleSelect?.(project);
                    else actions.onOpen(project);
                }
            }}
        >
            {selectMode ? (
                <span className={cn("ch-row__check", selected && "is-on")} aria-hidden="true">
                    <Check className="size-3" strokeWidth={3} />
                </span>
            ) : null}
            <span className="ch-row__thumb">
                <CanvasTopologyPreview project={project} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{project.title}</span>
                <span className="ch-num mt-0.5 block text-xs" style={{ color: "var(--ch-muted)" }}>
                    {projectStats(project)}
                </span>
            </span>
            <span className="hidden w-[120px] shrink-0 flex-col gap-1.5 sm:flex">
                <span className="ch-num text-xs" style={{ color: "var(--ch-muted)" }}>
                    {bytes ? formatCanvasProjectBytes(bytes) : t("canvas.homePage.common.unsynced")}
                </span>
                <span className="ch-sizebar">
                    <span style={{ width: `${bytes ? Math.max(6, Math.round((bytes / Math.max(maxBytes, 1)) * 100)) : 0}%` }} />
                </span>
            </span>
            <span className="ch-num hidden w-[96px] shrink-0 text-xs md:block" style={{ color: "var(--ch-muted)" }}>
                {formatProjectDate(project.updatedAt)}
            </span>
            {!selectMode ? (
                <button
                    type="button"
                    className="ch-more"
                    aria-label={t("canvas.homePage.common.moreActions", { title: project.title })}
                    data-ch-menu-anchor={project.id}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen((open) => !open);
                    }}
                >
                    <MoreHorizontal className="size-4" />
                </button>
            ) : null}
            {menuOpen ? <ProjectMenu project={project} actions={actions} onClose={() => setMenuOpen(false)} className="right-2 top-[58px]" /> : null}
        </div>
    );
}

/** 按画布 ID 固定取一个色相，同一画布每次颜色一致。 */
function projectHue(id: string) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    return 200 + (hash % 140);
}

/** 画布卡片的画面：缩略图（或空白提示）、更新时间、名称与规模。 */
function RecentCanvasContent({ project }: { project: CanvasProject }) {
    const empty = !project.documentPending && project.nodes.length === 0;
    const stats = projectStats(project);
    const size = typeof project.sizeBytes === "number" && project.sizeBytes > 0 ? ` · ${formatCanvasProjectBytes(project.sizeBytes)}` : "";
    return (
        <>
            {empty ? (
                <span className="ch-rcard__blank">
                    <Plus className="size-3.5" />
                    {i18n.t("canvas.homePage.common.blankCanvas")}
                </span>
            ) : (
                <div className="ch-rcard__preview">
                    <CanvasTopologyPreview project={project} />
                </div>
            )}
            <span className="ch-rcard__time ch-num">
                {projectGroupOf(project.updatedAt) === "today" ? <i aria-hidden="true" /> : null}
                {formatProjectDate(project.updatedAt)}
            </span>
            <div className="ch-rcard__info">
                <span className="ch-rcard__title">{project.title}</span>
                <span className="ch-rcard__meta ch-num">
                    {stats}
                    {size}
                </span>
            </div>
        </>
    );
}

/** 「继续创作」里的卡片：整张卡片就是一块画布，名称与规模直接叠在画面上。 */
export function CanvasHomeRecentCard({ project, index, onOpen }: { project: CanvasProject; index: number; onOpen: CanvasHomeProjectActions["onOpen"] }) {
    const elementRef = useProjectPrefetch(project);
    return (
        <article
            ref={(node) => {
                elementRef.current = node;
            }}
            className="ch-rcard"
            style={{ animationDelay: `${Math.min(index, 12) * 50}ms`, "--rc-hue": projectHue(project.id) } as CSSProperties}
            tabIndex={0}
            role="button"
            aria-label={i18n.t("canvas.homePage.common.openProject", { title: project.title })}
            onClick={(event) => onOpen(project, event)}
            onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onOpen(project);
                }
            }}
        >
            <RecentCanvasContent project={project} />
        </article>
    );
}
