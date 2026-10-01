import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { ChevronLeft, ChevronRight, FileUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";
import { canvasHomeMotionDisabled, spotlightMove, TemplateCover } from "./canvas-home-shared";

const AUTOPLAY_MS = 6000;
const MAX_FEATURED = 5;

type HeroProps = {
    scrollRef: RefObject<HTMLElement | null>;
    templates: CanvasWorkflowTemplateSummary[];
    disabled: boolean;
    onCreate: (event: ReactMouseEvent) => void;
    onImport: () => void;
    onPreviewTemplate: (template: CanvasWorkflowTemplateSummary) => void;
    onUseTemplate: (template: CanvasWorkflowTemplateSummary, event: ReactMouseEvent) => void;
};

/** 每个分类取一个带封面的模板，不足时用其余模板补齐。 */
function pickFeatured(templates: CanvasWorkflowTemplateSummary[]) {
    const picked: CanvasWorkflowTemplateSummary[] = [];
    const seen = new Set<string>();
    templates.forEach((template) => {
        if (picked.length >= MAX_FEATURED || !template.coverUrl || seen.has(template.category)) return;
        seen.add(template.category);
        picked.push(template);
    });
    templates.forEach((template) => {
        if (picked.length < MAX_FEATURED && !picked.includes(template)) picked.push(template);
    });
    return picked;
}

export function CanvasHomeHero({ scrollRef, templates, disabled, onCreate, onImport, onPreviewTemplate, onUseTemplate }: HeroProps) {
    const { t } = useTranslation();
    const stageRef = useRef<HTMLElement>(null);
    const featured = useMemo(() => pickFeatured(templates), [templates]);
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [visible, setVisible] = useState(true);
    const active = featured[Math.min(index, Math.max(featured.length - 1, 0))];

    // 首屏滚出视野后暂停光晕动画和自动轮播。
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                stage.classList.toggle("is-offscreen", !entry.isIntersecting);
                setVisible(entry.isIntersecting);
            },
            { root: scrollRef.current },
        );
        observer.observe(stage);
        return () => observer.disconnect();
    }, [scrollRef]);

    useEffect(() => {
        if (paused || !visible || featured.length < 2 || canvasHomeMotionDisabled()) return;
        const timer = window.setTimeout(() => {
            if (!document.hidden) setIndex((value) => (value + 1) % featured.length);
        }, AUTOPLAY_MS);
        return () => window.clearTimeout(timer);
    }, [featured.length, index, paused, visible]);

    const go = (step: number) => setIndex((value) => (value + step + featured.length) % featured.length);

    return (
        <section ref={stageRef} className="cvh-stage cvh-hero" onPointerMove={spotlightMove}>
            <div className="cvh-blob cvh-blob--a" />
            <div className="cvh-blob cvh-blob--b" />
            <div className="cvh-blob cvh-blob--c" />
            <div className="cvh-grid" aria-hidden="true" />
            <div className="cvh-grid-hi" aria-hidden="true" />

            <div className="cvh-section relative">
                <div className="cvh-feature">
                    {active ? (
                        <article className="cvh-banner cvh-anim-up" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carousel" aria-label={t("canvas.homePage.hero.featured")}>
                            <button type="button" className="cvh-banner__media" aria-label={t("canvas.homePage.common.previewTemplate", { title: active.title })} onClick={() => onPreviewTemplate(active)}>
                                {featured.map((template, slide) => (
                                    <span key={template.id} className="cvh-banner__slide" data-active={slide === index} aria-hidden={slide !== index}>
                                        <TemplateCover template={template} />
                                    </span>
                                ))}
                            </button>
                            <div className="cvh-banner__body" aria-live="polite">
                                <div key={active.id} className="cvh-banner__text">
                                    <span className="text-xs font-semibold" style={{ color: "var(--cvh-accent-text)" }}>
                                        {t("canvas.homePage.hero.featuredLabel", { category: active.categoryLabel })}
                                    </span>
                                    <h2 className="m-0 text-[22px] font-extrabold leading-snug tracking-tight">{active.title}</h2>
                                    {active.summary ? (
                                        <p className="cvh-banner__summary m-0 text-[13px] leading-6" style={{ color: "var(--cvh-muted)" }}>
                                            {active.summary}
                                        </p>
                                    ) : null}
                                    <span className="cvh-num text-xs" style={{ color: "var(--cvh-faint)" }}>
                                        {t("canvas.homePage.common.nodes", { count: active.nodeCount })}{active.platforms?.length ? ` · ${active.platforms.slice(0, 3).join(" · ")}` : ""}
                                    </span>
                                    {active.deliverables?.length ? (
                                        <div className="mt-1 flex flex-wrap gap-1.5" aria-label={t("canvas.homePage.hero.deliverables")}>
                                            {active.deliverables.slice(0, 4).map((item) => (
                                                <span key={item} className="cvh-chip py-1 text-[11px]">
                                                    {item}
                                                </span>
                                            ))}
                                            {active.deliverables.length > 4 ? (
                                                <span className="cvh-chip cvh-num py-1 text-[11px]" style={{ color: "var(--cvh-muted)" }}>
                                                    +{active.deliverables.length - 4}
                                                </span>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="cvh-banner__foot">
                                    <div className="flex gap-2">
                                        <button type="button" className="cvh-primary h-10 rounded-[11px] px-5 text-[13px]" disabled={disabled} onClick={(event) => onUseTemplate(active, event)}>
                                            {t("canvas.homePage.common.useTemplate")}
                                        </button>
                                        <button type="button" className="cvh-ghost h-10 rounded-[11px] px-4 text-[13px]" onClick={() => onPreviewTemplate(active)}>
                                            {t("canvas.homePage.common.preview")}
                                        </button>
                                    </div>
                                    {featured.length > 1 ? (
                                        <div className="flex items-center gap-1.5">
                                            <button type="button" className="cvh-banner__arrow" aria-label={t("canvas.homePage.hero.previous")} onClick={() => go(-1)}>
                                                <ChevronLeft className="size-4" />
                                            </button>
                                            <div className="cvh-dots" role="tablist" aria-label={t("canvas.homePage.hero.switchFeatured")}>
                                                {featured.map((template, slide) => (
                                                    <button key={template.id} type="button" role="tab" aria-selected={slide === index} aria-label={template.title} onClick={() => setIndex(slide)} />
                                                ))}
                                            </div>
                                            <button type="button" className="cvh-banner__arrow" aria-label={t("canvas.homePage.hero.next")} onClick={() => go(1)}>
                                                <ChevronRight className="size-4" />
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </article>
                    ) : (
                        <div className="cvh-banner is-loading cvh-anim-up" aria-busy="true" />
                    )}

                    <div className="cvh-quick">
                        <button type="button" className="cvh-quick__card is-primary cvh-anim-up" style={{ animationDelay: "60ms" }} disabled={disabled} onClick={onCreate}>
                            <span className="cvh-quick__icon">
                                <Plus className="size-5" strokeWidth={2.4} />
                            </span>
                            <strong>{t("canvas.homePage.hero.blank")}</strong>
                            <span>{t("canvas.homePage.hero.blankHint")}</span>
                        </button>
                        <button type="button" className="cvh-quick__card cvh-anim-up" style={{ animationDelay: "120ms" }} disabled={disabled} onClick={onImport}>
                            <span className="cvh-quick__icon">
                                <FileUp className="size-5" />
                            </span>
                            <strong>{t("canvas.homePage.hero.import")}</strong>
                            <span>{t("canvas.homePage.hero.importHint")}</span>
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
