import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { Eye, HardDrive, Search, Workflow, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";
import { cn } from "@/lib/utils";
import { formatCanvasProjectBytes } from "@/lib/canvas/canvas-project-quota-rules";
import { CategoryDot, TemplateCover, categoryColor, splitTemplateTitle, useCanvasHomeColumns } from "./canvas-home-shared";

type TemplatesProps = {
    scrollRef: RefObject<HTMLElement | null>;
    /** 独立模板页由页面头部展示标题与统计，这里不再重复。 */
    hideTitle?: boolean;
    templates: CanvasWorkflowTemplateSummary[];
    loading: boolean;
    error: string;
    category: string;
    onCategoryChange: (category: string) => void;
    onPreview: (template: CanvasWorkflowTemplateSummary) => void;
    onUse: (template: CanvasWorkflowTemplateSummary, event: ReactMouseEvent) => void;
};

export function templateCategories(templates: CanvasWorkflowTemplateSummary[]) {
    const map = new Map<string, { id: string; label: string; count: number }>();
    templates.forEach((template) => {
        const current = map.get(template.category);
        map.set(template.category, { id: template.category, label: template.categoryLabel || template.category, count: (current?.count || 0) + 1 });
    });
    return [...map.values()];
}

export function matchTemplate(template: CanvasWorkflowTemplateSummary, query: string) {
    if (!query) return true;
    return [template.title, template.industry, template.summary, template.categoryLabel, ...(template.platforms || []), ...(template.deliverables || [])].join(" ").toLowerCase().includes(query);
}

type TemplateCardProps = {
    template: CanvasWorkflowTemplateSummary;
    index: number;
    color: string;
    showCategory: boolean;
    onPreview: (template: CanvasWorkflowTemplateSummary) => void;
    onUse: (template: CanvasWorkflowTemplateSummary, event: ReactMouseEvent) => void;
};

function TemplateCard({ template, index, color, showCategory, onPreview, onUse }: TemplateCardProps) {
    const { t } = useTranslation();
    const { eyebrow, name } = splitTemplateTitle(template.title);
    return (
        <article
            className="ch-tcard"
            style={{ animationDelay: `${index * 45}ms`, "--tcard-color": color } as CSSProperties}
            tabIndex={0}
            role="button"
            aria-label={t("canvas.homePage.common.previewTemplate", { title: template.title })}
            onClick={() => onPreview(template)}
            onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onPreview(template);
                }
            }}
        >
            <div className="ch-tcard__media">
                <TemplateCover template={template} />
                {showCategory ? (
                    <span className="ch-pill ch-pill--light ch-tcard__badge">
                        <CategoryDot color={color} />
                        {template.categoryLabel}
                    </span>
                ) : null}
                <div className="ch-tcard__meta ch-num">
                    <span>
                        <Workflow className="size-3" />
                        {t("canvas.homePage.common.nodes", { count: template.nodeCount })}
                    </span>
                    {template.documentBytes ? (
                        <span>
                            <HardDrive className="size-3" />
                            {formatCanvasProjectBytes(template.documentBytes)}
                        </span>
                    ) : null}
                </div>
                <div className="ch-tcard__actions">
                    <button
                        type="button"
                        className="ch-tcard__use"
                        onClick={(event) => {
                            event.stopPropagation();
                            onUse(template, event);
                        }}
                    >
                        {t("canvas.homePage.common.useTemplate")}
                    </button>
                    <button
                        type="button"
                        className="ch-tcard__peek"
                        aria-label={t("canvas.homePage.common.preview")}
                        onClick={(event) => {
                            event.stopPropagation();
                            onPreview(template);
                        }}
                    >
                        <Eye className="size-4" />
                    </button>
                </div>
            </div>
            <div className="ch-tcard__body">
                <span className="ch-tcard__eyebrow">{eyebrow || template.industry || template.categoryLabel}</span>
                <h3 className="ch-tcard__title">{name}</h3>
            </div>
        </article>
    );
}

export const CanvasHomeTemplates = forwardRef<HTMLElement, TemplatesProps>(function CanvasHomeTemplates({ scrollRef, hideTitle, templates, loading, error, category, onCategoryChange, onPreview, onUse }, ref) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    // 每批加载两整行，宽屏列数变多时不留半行。
    const pageSize = useCanvasHomeColumns() * 2;
    const [pages, setPages] = useState(1);
    const [stuck, setStuck] = useState(false);
    const [edges, setEdges] = useState({ left: false, right: false });
    const anchorRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const tabsRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLSpanElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const categories = useMemo(() => templateCategories(templates), [templates]);
    const categoryIds = useMemo(() => categories.map((item) => item.id), [categories]);
    const normalized = query.trim().toLowerCase();
    const filtered = useMemo(() => templates.filter((template) => (category === "all" || template.category === category) && matchTemplate(template, normalized)), [category, normalized, templates]);
    const visible = filtered.slice(0, pages * pageSize);
    const hasMore = filtered.length > visible.length;
    const tabs = [{ id: "all", label: t("canvas.homePage.templates.all"), count: templates.length }, ...categories];

    // 选中底色滑到当前分类；分类较多时滚到可见位置，并更新两端渐隐。
    useLayoutEffect(() => {
        const list = tabsRef.current;
        const thumb = thumbRef.current;
        if (!list || !thumb) return;
        const sync = () => {
            const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
            if (active) {
                thumb.style.transform = `translateX(${active.offsetLeft}px)`;
                thumb.style.width = `${active.offsetWidth}px`;
                thumb.style.opacity = "1";
            }
            setEdges({ left: list.scrollLeft > 4, right: list.scrollLeft + list.clientWidth < list.scrollWidth - 4 });
        };
        sync();
        const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
        if (active && (active.offsetLeft < list.scrollLeft || active.offsetLeft + active.offsetWidth > list.scrollLeft + list.clientWidth)) {
            list.scrollTo({ left: active.offsetLeft - 16, behavior: "smooth" });
        }
        void document.fonts?.ready.then(sync);
        list.addEventListener("scroll", sync, { passive: true });
        window.addEventListener("resize", sync);
        return () => {
            list.removeEventListener("scroll", sync);
            window.removeEventListener("resize", sync);
        };
    }, [category, categories.length]);

    // 分类栏吸顶后加磨砂背景。
    useEffect(() => {
        const scroller = scrollRef.current;
        const bar = barRef.current;
        if (!scroller || !bar) return;
        let frame = 0;
        const update = () => {
            frame = 0;
            setStuck(scroller.scrollTop > 0 && bar.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + 1);
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        update();
        return () => {
            scroller.removeEventListener("scroll", onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [scrollRef]);

    // 滚到底部附近自动加载下一批。
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) setPages((value) => value + 1);
            },
            { root: scrollRef.current, rootMargin: "0px 0px 480px 0px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, pages, scrollRef]);

    const selectCategory = (id: string) => {
        onCategoryChange(id);
        setPages(1);
        // 已吸顶时切换分类，回到列表开头（分类栏刚好停在顶部）。
        const scroller = scrollRef.current;
        const anchor = anchorRef.current;
        const bar = barRef.current;
        if (stuck && scroller && anchor && bar) {
            const margin = parseFloat(getComputedStyle(bar).marginTop) || 0;
            scroller.scrollTo({ top: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + margin });
        }
    };

    return (
        <section ref={ref} className={cn("ch-section flex flex-col pb-14", hideTitle ? "pt-0" : "pt-11")} aria-labelledby={hideTitle ? undefined : "ch-templates-title"} aria-label={hideTitle ? t("canvas.homePage.templates.title") : undefined}>
            {hideTitle ? null : (
            <div className="flex items-baseline gap-2.5">
                <h2 id="ch-templates-title" className="ch-section-title">
                    {t("canvas.homePage.templates.title")}
                </h2>
                <span className="ch-num text-[13px]" style={{ color: "var(--ch-muted)" }}>
                    {normalized || category !== "all" ? t("canvas.homePage.common.ratio", { shown: filtered.length, total: templates.length }) : t("canvas.homePage.common.count", { count: templates.length })}
                </span>
            </div>
            )}

            <div ref={anchorRef} aria-hidden="true" />
            <div ref={barRef} className={cn("ch-cats-bar", stuck && "is-stuck")}>
                <div className={cn("ch-cats-wrap", edges.left && "fade-left", edges.right && "fade-right")}>
                    <div ref={tabsRef} role="tablist" aria-label={t("canvas.homePage.templates.categories")} className="ch-cats">
                        <span ref={thumbRef} className="ch-cats__thumb" aria-hidden="true" />
                        {tabs.map((tab) => (
                            <button key={tab.id} type="button" role="tab" className="ch-cat" aria-selected={category === tab.id} onClick={() => selectCategory(tab.id)}>
                                {tab.id === "all" ? null : <CategoryDot color={categoryColor(tab.id, categoryIds)} />}
                                {tab.label}
                                <span className="ch-cat__count ch-num">{tab.count}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <label className="ch-input ch-cats-search">
                    <Search className="size-3.5" />
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setPages(1);
                        }}
                        placeholder={t("canvas.homePage.templates.filter")}
                        aria-label={t("canvas.homePage.templates.filter")}
                    />
                    {query ? (
                        <button type="button" className="ch-link" aria-label={t("canvas.homePage.templates.clearFilter")} onClick={() => setQuery("")}>
                            <X className="size-3.5" />
                        </button>
                    ) : null}
                </label>
            </div>

            {loading && !templates.length ? (
                <div className="ch-grid-cards" aria-busy="true">
                    {Array.from({ length: pageSize }, (_, index) => (
                        <div key={index} className="ch-tcard is-skeleton" style={{ animationDelay: `${index * 40}ms` }}>
                            <div className="ch-tcard__media">
                                <span className="ch-img-skeleton" />
                            </div>
                            <div className="ch-tcard__body">
                                <span className="ch-skel-line" style={{ width: "30%" }} />
                                <span className="ch-skel-line" style={{ width: "70%", height: 14 }} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : error && !templates.length ? (
                <div className="ch-empty">
                    <strong>{t("canvas.homePage.templates.loadFailed")}</strong>
                    <span>{error}</span>
                </div>
            ) : !filtered.length ? (
                <div className="ch-empty">
                    <strong>{t("canvas.homePage.templates.noMatch")}</strong>
                    <button
                        type="button"
                        className="ch-ghost h-9 rounded-[10px] px-4 text-[13px]"
                        onClick={() => {
                            setQuery("");
                            selectCategory("all");
                        }}
                    >
                        {t("canvas.homePage.common.clearFilter")}
                    </button>
                </div>
            ) : (
                <div key={`${category}:${normalized}`} className="ch-grid-cards">
                    {visible.map((template, index) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            index={index % pageSize}
                            color={categoryColor(template.category, categoryIds)}
                            showCategory={category === "all"}
                            onPreview={onPreview}
                            onUse={onUse}
                        />
                    ))}
                </div>
            )}

            {filtered.length ? (
                <div ref={sentinelRef} className="ch-load-end" aria-live="polite">
                    {hasMore ? (
                        <span className="ch-load-dots" role="status" aria-label={t("canvas.homePage.templates.loadingMore")}>
                            <i />
                            <i />
                            <i />
                        </span>
                    ) : (
                        <span>{t("canvas.homePage.templates.allShown", { count: filtered.length })}</span>
                    )}
                </div>
            ) : null}
        </section>
    );
});
