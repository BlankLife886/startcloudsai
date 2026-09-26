import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FolderKanban, LayoutTemplate, Plus, Search, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import type { CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";
import { CategoryDot, TemplateCover, canvasHomeMotionDisabled, formatProjectDate } from "./canvas-home-shared";
import { matchTemplate } from "./canvas-home-templates";

function Portal({ children }: { children: ReactNode }) {
    // 画布样式限定在 .canvas-native-mount 内，浮层挂到画布专用的根节点上。
    return createPortal(<div className="ch-theme">{children}</div>, getCanvasPortalRoot());
}

const EXIT_MS = 200;

/** 关闭时先保留内容播放退场动画，结束后再卸载。 */
function usePresence<T>(value: T | null) {
    const [kept, setKept] = useState<T | null>(value);
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        if (value) {
            setKept(value);
            setClosing(false);
            return;
        }
        if (canvasHomeMotionDisabled()) {
            setKept(null);
            return;
        }
        setClosing(true);
        const timer = window.setTimeout(() => {
            setKept(null);
            setClosing(false);
        }, EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [value]);
    return { item: value ?? kept, closing: !value && closing };
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Esc 关闭；打开时把焦点移入弹窗并限制 Tab 在弹窗内，关闭后还原焦点。 */
function useDialog(open: boolean, onClose: () => void) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        const dialog = dialogRef.current;
        if (dialog && !dialog.contains(document.activeElement)) (dialog.querySelector<HTMLElement>("[data-autofocus]") || dialog).focus();
        const handle = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                closeRef.current();
                return;
            }
            if (event.key !== "Tab" || !dialogRef.current) return;
            const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        const node = dialogRef.current;
        node?.addEventListener("keydown", handle);
        return () => {
            node?.removeEventListener("keydown", handle);
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, [open]);
    return dialogRef;
}

type PreviewProps = {
    template: CanvasWorkflowTemplateSummary | null;
    color: string;
    full: boolean;
    busy: boolean;
    onClose: () => void;
    onUse: (template: CanvasWorkflowTemplateSummary, title: string, event: ReactMouseEvent) => void;
};

export function CanvasTemplatePreview({ template, color, full, busy, onClose, onUse }: PreviewProps) {
    const { t } = useTranslation();
    const [title, setTitle] = useState("");
    useEffect(() => {
        if (template) setTitle(template.title);
    }, [template]);
    const dialogRef = useDialog(Boolean(template), onClose);
    const { item: shown, closing } = usePresence(template);
    if (!shown) return null;
    const steps = (shown.deliverables?.length ? shown.deliverables : t("canvas.homePage.preview.defaultSteps").split("|")).slice(0, 6);
    return (
        <Portal>
            <div className={`ch-overlay${closing ? " is-closing" : ""}`} onClick={onClose}>
                <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("canvas.homePage.preview.label", { title: shown.title })} className="ch-preview outline-none" onClick={(event) => event.stopPropagation()}>
                    <div className="ch-preview__cover">
                        <TemplateCover template={shown} />
                    </div>
                    <div className="ch-preview__body">
                        <div className="flex items-center justify-between gap-3">
                            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "var(--ch-accent-soft)", color: "var(--ch-accent-text)" }}>
                                <CategoryDot color={color} />
                                {shown.categoryLabel}
                                {shown.industry ? ` · ${shown.industry}` : ""}
                            </span>
                            <button type="button" className="ch-ghost size-[34px] shrink-0 rounded-full" aria-label={t("canvas.homePage.common.close")} onClick={onClose}>
                                <X className="size-4" />
                            </button>
                        </div>
                        <h2 className="m-0 text-[26px] font-extrabold leading-snug tracking-tight">{shown.title}</h2>
                        {shown.summary ? (
                            <p className="m-0 text-sm leading-7" style={{ color: "var(--ch-muted)" }}>
                                {shown.summary}
                            </p>
                        ) : null}
                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="ch-stat-box">
                                <span>{t("canvas.homePage.preview.nodes")}</span>
                                <b className="ch-num">{shown.nodeCount}</b>
                            </div>
                            <div className="ch-stat-box">
                                <span>{t("canvas.homePage.preview.deliverables")}</span>
                                <b className="ch-num">{shown.deliverables?.length || "—"}</b>
                            </div>
                        </div>
                        {shown.platforms?.length ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="mr-1 text-xs" style={{ color: "var(--ch-muted)" }}>
                                    {t("canvas.homePage.preview.platforms")}
                                </span>
                                {shown.platforms.map((platform) => (
                                    <span key={platform} className="ch-chip">
                                        {platform}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        <div>
                            <span className="mb-2.5 block text-xs" style={{ color: "var(--ch-muted)" }}>
                                {shown.deliverables?.length ? t("canvas.homePage.preview.outputs") : t("canvas.homePage.preview.workflow")}
                            </span>
                            <div className="flex flex-wrap gap-2">
                                {steps.map((step, index) => (
                                    <span key={step} className="ch-chip ch-anim-up" style={{ animationDelay: `${200 + index * 60}ms` }}>
                                        <b className="ch-num text-[11px]" style={{ color: "var(--ch-accent-text)" }}>
                                            {index + 1}
                                        </b>
                                        {step}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="ch-preview__actions">
                            <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                                <span className="text-xs" style={{ color: "var(--ch-muted)" }}>
                                    {t("canvas.homePage.preview.canvasName")}
                                </span>
                                <span className="ch-input h-12 rounded-[13px]">
                                    <input
                                        data-autofocus
                                        value={title}
                                        maxLength={120}
                                        onChange={(event) => setTitle(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" && !event.nativeEvent.isComposing && !full && !busy) {
                                                event.preventDefault();
                                                const rect = event.currentTarget.getBoundingClientRect();
                                                onUse(shown, title, { clientX: rect.right, clientY: rect.top + rect.height / 2 } as ReactMouseEvent);
                                            }
                                        }}
                                        aria-label={t("canvas.homePage.preview.canvasName")}
                                        style={{ fontSize: 14 }}
                                    />
                                </span>
                            </label>
                            <button type="button" className="ch-primary h-12 rounded-[13px] px-6 text-[15px]" disabled={full || busy} onClick={(event) => onUse(shown, title, event)}>
                                {full ? t("canvas.homePage.preview.full") : busy ? t("canvas.homePage.preview.creating") : t("canvas.homePage.preview.create")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Portal>
    );
}

type PaletteItem = {
    key: string;
    group: "actions" | "canvases" | "templates";
    label: string;
    hint: string;
    icon?: ReactNode;
    image?: ReactNode;
    run: () => void;
};

type PaletteProps = {
    open: boolean;
    projects: CanvasProject[];
    templates: CanvasWorkflowTemplateSummary[];
    full: boolean;
    onClose: () => void;
    onCreate: () => void;
    onBrowseTemplates: () => void;
    onOpenLibrary: () => void;
    onOpenProject: (project: CanvasProject) => void;
    onPreviewTemplate: (template: CanvasWorkflowTemplateSummary) => void;
};

export function CanvasCommandPalette({ open, projects, templates, full, onClose, onCreate, onBrowseTemplates, onOpenLibrary, onOpenProject, onPreviewTemplate }: PaletteProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const dialogRef = useDialog(open, onClose);
    useEffect(() => {
        if (open) {
            setQuery("");
            setActive(0);
        }
    }, [open]);

    const items = useMemo<PaletteItem[]>(() => {
        const normalized = query.trim().toLowerCase();
        const done = (action: () => void) => () => {
            onClose();
            action();
        };
        const actionItems: PaletteItem[] = [
            { key: "a:new", group: "actions", label: t("canvas.homePage.palette.newBlank"), hint: full ? t("canvas.homePage.palette.full") : t("canvas.homePage.palette.fromScratch"), icon: <Plus className="size-4" />, run: done(onCreate) },
            { key: "a:templates", group: "actions", label: t("canvas.homePage.palette.browseTemplates"), hint: t("canvas.homePage.palette.templateCount", { count: templates.length }), icon: <Sparkles className="size-4" />, run: done(onBrowseTemplates) },
            { key: "a:library", group: "actions", label: t("canvas.homePage.palette.openLibrary"), hint: t("canvas.homePage.palette.canvasCount", { count: projects.length }), icon: <FolderKanban className="size-4" />, run: done(onOpenLibrary) },
        ];
        const actions = actionItems.filter((item) => !normalized || item.label.toLowerCase().includes(normalized));
        const projectItems: PaletteItem[] = projects
            .filter((project) => !normalized || project.title.toLowerCase().includes(normalized))
            .slice(0, normalized ? 6 : 3)
            .map((project) => ({
                key: `p:${project.id}`,
                group: "canvases",
                label: project.title,
                hint: `${project.documentPending ? "" : `${t("canvas.homePage.common.nodes", { count: project.nodes.length })} · `}${formatProjectDate(project.updatedAt)}`,
                icon: <LayoutTemplate className="size-4" />,
                run: done(() => onOpenProject(project)),
            }));
        const templateItems: PaletteItem[] = templates
            .filter((template) => matchTemplate(template, normalized))
            .slice(0, normalized ? 6 : 3)
            .map((template) => ({
                key: `t:${template.id}`,
                group: "templates",
                label: template.title,
                hint: `${template.categoryLabel} · ${t("canvas.homePage.common.nodes", { count: template.nodeCount })}`,
                image: <TemplateCover template={template} />,
                run: done(() => onPreviewTemplate(template)),
            }));
        return [...actions, ...projectItems, ...templateItems];
    }, [full, onBrowseTemplates, onClose, onCreate, onOpenLibrary, onOpenProject, onPreviewTemplate, projects, query, t, templates]);

    const current = Math.min(active, Math.max(items.length - 1, 0));
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }, [current]);

    const { item: visible, closing } = usePresence(open || null);
    if (!visible) return null;
    return (
        <Portal>
            <div className={`ch-palette-overlay${closing ? " is-closing" : ""}`} onClick={onClose}>
                <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("canvas.homePage.palette.label")} className="ch-palette" onClick={(event) => event.stopPropagation()}>
                    <div className="ch-palette__inner">
                        <div className="flex h-[62px] items-center gap-3 border-b px-5" style={{ borderColor: "var(--ch-line)" }}>
                            <Search className="size-[18px]" style={{ color: "var(--ch-accent-text)" }} />
                            <input
                                autoFocus
                                data-autofocus
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setActive(0);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        setActive(Math.min(current + 1, items.length - 1));
                                    } else if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        setActive(Math.max(current - 1, 0));
                                    } else if (event.key === "Enter") {
                                        event.preventDefault();
                                        items[current]?.run();
                                    }
                                }}
                                placeholder={t("canvas.homePage.palette.placeholder")}
                                aria-label={t("canvas.homePage.palette.inputLabel")}
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="ch-palette-list"
                                className="flex-1 border-0 bg-transparent text-base outline-none"
                                style={{ color: "var(--ch-text)" }}
                            />
                            <span className="ch-kbd">Esc</span>
                        </div>
                        <div ref={listRef} id="ch-palette-list" role="listbox" className="max-h-[380px] overflow-y-auto p-2">
                            {items.map((item, index) => (
                                <div key={item.key}>
                                    {index === 0 || items[index - 1].group !== item.group ? (
                                        <div className="px-3 pb-1.5 pt-2.5 text-[11px] font-semibold tracking-wider" style={{ color: "var(--ch-faint)" }}>
                                            {t(`canvas.homePage.palette.group${item.group === "actions" ? "Actions" : item.group === "canvases" ? "Canvases" : "Templates"}`)}
                                        </div>
                                    ) : null}
                                    <button type="button" role="option" aria-selected={index === current} className="ch-palette__item" onMouseEnter={() => setActive(index)} onClick={item.run}>
                                        <span className="ch-palette__icon">{item.image || item.icon}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm">{item.label}</span>
                                            <span className="ch-num block truncate text-xs" style={{ color: "var(--ch-muted)" }}>
                                                {item.hint}
                                            </span>
                                        </span>
                                        {index === current ? <span className="ch-kbd">↵</span> : null}
                                    </button>
                                </div>
                            ))}
                            {!items.length ? (
                                <div className="py-9 text-center text-[13px]" style={{ color: "var(--ch-muted)" }}>
                                    {t("canvas.homePage.palette.noResult", { query })}
                                </div>
                            ) : null}
                        </div>
                        <div className="flex gap-4 border-t px-5 py-2.5 text-[11px]" style={{ borderColor: "var(--ch-line)", color: "var(--ch-faint)" }}>
                            <span>
                                <span className="ch-kbd">↑</span> <span className="ch-kbd">↓</span> {t("canvas.homePage.palette.navigate")}
                            </span>
                            <span>
                                <span className="ch-kbd">↵</span> {t("canvas.homePage.palette.open")}
                            </span>
                            <span>
                                <span className="ch-kbd">⌘</span> <span className="ch-kbd">K</span> {t("canvas.homePage.palette.anytime")}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Portal>
    );
}

export function CanvasLaunchOverlay({ launch }: { launch: { x: number; y: number; title: string } | null }) {
    const { t } = useTranslation();
    if (!launch) return null;
    return (
        <Portal>
            <div className="ch-launch" role="status" aria-live="polite">
                <span className="ch-launch__eyebrow">{t("canvas.homePage.launch.opening")}</span>
                <span className="ch-launch__title">{launch.title}</span>
                <span className="ch-launch__track" aria-hidden="true">
                    <i />
                </span>
            </div>
        </Portal>
    );
}
