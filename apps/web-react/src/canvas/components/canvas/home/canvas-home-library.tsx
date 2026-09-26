import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AlertTriangle, CheckSquare, LayoutGrid, List, Plus, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { formatCanvasProjectBytes } from "@/lib/canvas/canvas-project-quota-rules";
import { CanvasHomeProjectCard, CanvasHomeProjectRow, type CanvasHomeProjectActions } from "./canvas-home-project-card";
import { CanvasHomePageHead, projectGroupLabel, projectGroupOf, type ProjectGroupKey } from "./canvas-home-shared";
import { cn } from "@/lib/utils";

type SortKey = "updated" | "name" | "size";
type LayoutKey = "grid" | "list";

const LAYOUT_KEY = "canvas-home-library-layout";
const SORTS: { key: SortKey; labelKey: string }[] = [
    { key: "updated", labelKey: "canvas.homePage.library.sortRecent" },
    { key: "name", labelKey: "canvas.homePage.library.sortName" },
    { key: "size", labelKey: "canvas.homePage.library.sortSize" },
];

function readLayout(): LayoutKey {
    try {
        return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
    } catch {
        return "grid";
    }
}

type LibraryProps = CanvasHomeProjectActions & {
    projects: CanvasProject[];
    hydrated: boolean;
    quota: { used: number; limit: number } | null;
    onCreate: (event: ReactMouseEvent) => void;
    onExportMany: (projects: CanvasProject[]) => void;
    onDuplicateMany: (projects: CanvasProject[]) => void;
    onDeleteMany: (projects: CanvasProject[]) => void;
};

export function CanvasHomeLibrary({ projects, hydrated, quota, onCreate, onExportMany, onDuplicateMany, onDeleteMany, ...actions }: LibraryProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SortKey>("updated");
    const [layout, setLayoutState] = useState<LayoutKey>(readLayout);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const setLayout = (next: LayoutKey) => {
        setLayoutState(next);
        try {
            window.localStorage.setItem(LAYOUT_KEY, next);
        } catch {
            // 浏览器存储不可用时只在本次会话生效。
        }
    };

    const normalized = query.trim().toLowerCase();
    const filtered = useMemo(() => {
        const list = projects.filter((project) => !normalized || project.title.toLowerCase().includes(normalized) || (project.nodes || []).some((node) => (node.title || "").toLowerCase().includes(normalized)));
        const sorted = [...list];
        if (sort === "name") sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-CN", { numeric: true }));
        else if (sort === "size") sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
        else sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return sorted;
    }, [normalized, projects, sort]);

    const groups = useMemo(() => {
        if (sort !== "updated" || normalized) return [{ key: "all", label: normalized ? t("canvas.homePage.library.searchResults") : sort === "name" ? t("canvas.homePage.library.byName") : t("canvas.homePage.library.bySize"), items: filtered }];
        const order: ProjectGroupKey[] = ["today", "week", "month", "earlier"];
        return order.map((key) => ({ key, label: projectGroupLabel(key), items: filtered.filter((project) => projectGroupOf(project.updatedAt) === key) })).filter((group) => group.items.length);
    }, [filtered, normalized, sort, t]);

    // 已删除的项目从选中里移除。
    useEffect(() => {
        setSelectedIds((ids) => ids.filter((id) => projects.some((project) => project.id === id)));
    }, [projects]);

    const selected = projects.filter((project) => selectedIds.includes(project.id));
    const allSelected = filtered.length > 0 && filtered.every((project) => selectedIds.includes(project.id));
    const totalBytes = projects.reduce((sum, project) => sum + (project.sizeBytes || 0), 0);
    const maxBytes = Math.max(1, ...projects.map((project) => project.sizeBytes || 0));
    const toggle = (project: CanvasProject) => setSelectedIds((ids) => (ids.includes(project.id) ? ids.filter((id) => id !== project.id) : [...ids, project.id]));
    const exitSelect = () => {
        setSelectMode(false);
        setSelectedIds([]);
    };
    const sortIndex = SORTS.findIndex((item) => item.key === sort);
    const quotaFull = Boolean(quota && quota.used >= quota.limit);
    let running = 0;

    return (
        <div className="ch-view">
            <CanvasHomePageHead
                title={t("canvas.homePage.library.title")}
                stats={
                    <>
                        <span>
                            <b className="ch-num">{projects.length}</b> {t("canvas.homePage.library.canvasUnit")}
                        </span>
                        <span title={t("canvas.homePage.library.totalHint")}>
                            {t("canvas.homePage.library.totalPrefix")} <b className="ch-num">{totalBytes ? formatCanvasProjectBytes(totalBytes) : "0 KB"}</b>
                        </span>
                        {quota ? (
                            <span>
                                {t("canvas.homePage.library.quotaPrefix")} <b className="ch-num">{quota.used} / {quota.limit}</b>
                                <span className={cn("ch-page-head__bar", quotaFull && "is-full")}>
                                    <span style={{ width: `${Math.min(100, Math.round((quota.used / Math.max(quota.limit, 1)) * 100))}%` }} />
                                </span>
                            </span>
                        ) : null}
                    </>
                }
                actions={
                    <>
                        <button
                            type="button"
                            className="ch-ghost h-10 rounded-[11px] px-4 text-[13px]"
                            aria-pressed={selectMode}
                            style={selectMode ? { borderColor: "var(--ch-accent-line)", background: "var(--ch-accent-soft)", color: "var(--ch-accent-text)", fontWeight: 600 } : undefined}
                            disabled={!projects.length}
                            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                        >
                            <CheckSquare className="size-4" />
                            {selectMode ? t("canvas.homePage.library.cancelSelect") : t("canvas.homePage.library.select")}
                        </button>
                        <button type="button" className="ch-primary h-10 rounded-[11px] px-4 text-[13px]" disabled={!hydrated} onClick={onCreate}>
                            <Plus className="size-4" strokeWidth={2.4} />
                            {t("canvas.homePage.common.newCanvas")}
                        </button>
                    </>
                }
            />

            <div className="ch-section flex flex-col gap-8 pb-36">
                <div className="ch-libbar">
                    <label className="ch-input w-[320px] max-w-full">
                        <Search className="size-3.5" />
                        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("canvas.homePage.library.searchPlaceholder")} aria-label={t("canvas.homePage.library.searchLabel")} />
                        {query ? (
                            <button type="button" className="ch-link" aria-label={t("canvas.homePage.common.clearSearch")} onClick={() => setQuery("")}>
                                <X className="size-3.5" />
                            </button>
                        ) : null}
                    </label>
                    <span className="flex-1" />
                    <div className="ch-segment hidden sm:flex" role="group" aria-label={t("canvas.homePage.library.sortLabel")}>
                        <span className="ch-segment__thumb" style={{ left: 4 + sortIndex * 56, width: 56 }} />
                        {SORTS.map((item) => (
                            <button key={item.key} type="button" aria-pressed={sort === item.key} style={{ width: 56, padding: 0 }} onClick={() => setSort(item.key)}>
                                {t(item.labelKey)}
                            </button>
                        ))}
                    </div>
                    <div className="ch-segment" role="group" aria-label={t("canvas.homePage.library.viewLabel")}>
                        <span className="ch-segment__thumb" style={{ left: layout === "grid" ? 4 : 44, width: 40 }} />
                        <button type="button" aria-pressed={layout === "grid"} aria-label={t("canvas.homePage.library.gridView")} style={{ width: 40, padding: 0 }} onClick={() => setLayout("grid")}>
                            <LayoutGrid className="size-[15px]" />
                        </button>
                        <button type="button" aria-pressed={layout === "list"} aria-label={t("canvas.homePage.library.listView")} style={{ width: 40, padding: 0 }} onClick={() => setLayout("list")}>
                            <List className="size-[15px]" />
                        </button>
                    </div>
                </div>

                {quotaFull && !selectMode ? (
                    <div className="ch-notice" role="status">
                        <AlertTriangle className="size-4 shrink-0" />
                        <span className="flex-1">{t("canvas.homePage.library.quotaFullNotice", { used: quota?.used, limit: quota?.limit })}</span>
                        <button type="button" className="ch-link" onClick={() => setSelectMode(true)}>
                            {t("canvas.homePage.library.cleanUp")}
                        </button>
                    </div>
                ) : null}

                {!hydrated ? (
                    <div className="ch-empty">{t("canvas.homePage.library.loading")}</div>
                ) : !projects.length ? (
                    <div className="ch-empty">
                        <strong>{t("canvas.homePage.library.empty")}</strong>
                        <span>{t("canvas.homePage.library.emptyHint")}</span>
                        <button type="button" className="ch-primary mt-1 h-10 rounded-[11px] px-5 text-[13px]" onClick={onCreate}>
                            <Plus className="size-4" />
                            {t("canvas.homePage.common.newCanvas")}
                        </button>
                    </div>
                ) : !filtered.length ? (
                    <div className="ch-empty">
                        <strong>{t("canvas.homePage.library.notFound", { query })}</strong>
                        <span>{t("canvas.homePage.library.notFoundHint")}</span>
                        <button type="button" className="ch-ghost mt-1 h-9 rounded-[10px] px-4 text-[13px]" onClick={() => setQuery("")}>
                            {t("canvas.homePage.common.clearSearch")}
                        </button>
                    </div>
                ) : (
                    groups.map((group, groupIndex) => (
                        <section key={group.key} className="flex flex-col gap-4" aria-label={group.label}>
                            <div className="ch-group-head ch-anim-up" style={{ animationDelay: `${groupIndex * 80}ms` }}>
                                <span className="text-sm font-bold">{group.label}</span>
                                <span className="ch-num text-xs" style={{ color: "var(--ch-faint)" }}>
                                    {t("canvas.homePage.common.count", { count: group.items.length })}
                                </span>
                            </div>
                            {layout === "grid" ? (
                                <div className="ch-grid-cards">
                                    {group.items.map((project) => (
                                        <CanvasHomeProjectCard key={project.id} project={project} index={running++} selectMode={selectMode} selected={selectedIds.includes(project.id)} onToggleSelect={toggle} {...actions} />
                                    ))}
                                </div>
                            ) : (
                                <div className="ch-list">
                                    {group.items.map((project) => (
                                        <CanvasHomeProjectRow key={project.id} project={project} index={running++} maxBytes={maxBytes} selectMode={selectMode} selected={selectedIds.includes(project.id)} onToggleSelect={toggle} {...actions} />
                                    ))}
                                </div>
                            )}
                        </section>
                    ))
                )}
            </div>

            {selectMode ? (
                <div className="ch-selectbar ch-glass" role="toolbar" aria-label={t("canvas.homePage.library.batchLabel")}>
                    <span className="mr-2 whitespace-nowrap text-[13px]" style={{ color: "var(--ch-muted)" }}>
                        {t("canvas.homePage.library.selectedPrefix")} <b className="ch-num text-[15px]" style={{ color: "var(--ch-text)" }}>{selected.length}</b> {t("canvas.homePage.library.selectedSuffix")}
                    </span>
                    <span className="h-[22px] w-px" style={{ background: "var(--ch-line2)" }} />
                    <button type="button" onClick={() => setSelectedIds(allSelected ? [] : filtered.map((project) => project.id))}>
                        {allSelected ? t("canvas.homePage.library.unselectAll") : t("canvas.homePage.library.selectAll")}
                    </button>
                    <button type="button" disabled={!selected.length} onClick={() => onExportMany(selected)}>
                        {t("canvas.homePage.common.export")}
                    </button>
                    <button type="button" disabled={!selected.length} onClick={() => onDuplicateMany(selected)}>
                        {t("canvas.homePage.common.duplicate")}
                    </button>
                    <button type="button" className="is-danger" disabled={!selected.length} onClick={() => onDeleteMany(selected)}>
                        {t("canvas.homePage.common.delete")}
                    </button>
                    <button type="button" className="ch-primary ml-1 h-10 rounded-[11px] px-[18px] text-[13px]" onClick={exitSelect}>
                        {t("canvas.homePage.library.done")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
