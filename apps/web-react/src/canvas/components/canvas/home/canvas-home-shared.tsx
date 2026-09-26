import { useEffect, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";


import i18n from "@/i18n";
import type { CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";

/** 与 canvas-home.css 中 .ch-grid-cards 的断点保持一致。 */
function gridColumnsFor(width: number) {
    if (width >= 2100) return 6;
    if (width >= 1680) return 5;
    if (width > 1100) return 4;
    if (width > 820) return 3;
    return 2;
}

export function useCanvasHomeColumns() {
    const [columns, setColumns] = useState(() => gridColumnsFor(window.innerWidth));
    useEffect(() => {
        const update = () => setColumns(gridColumnsFor(window.innerWidth));
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    return columns;
}

export function canvasHomeMotionDisabled() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("settings-no-animations");
}

const frames = new WeakMap<HTMLElement, number>();

function schedule(element: HTMLElement, run: () => void) {
    const pending = frames.get(element);
    if (pending) cancelAnimationFrame(pending);
    frames.set(element, requestAnimationFrame(run));
}

/** 光晕区域的网格聚光与漂浮卡片视差，写入 --mx/--my/--px/--py。 */
export function spotlightMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || canvasHomeMotionDisabled()) return;
    const element = event.currentTarget;
    const { clientX, clientY } = event;
    schedule(element, () => {
        const rect = element.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        element.style.setProperty("--mx", `${Math.round(x)}px`);
        element.style.setProperty("--my", `${Math.round(y)}px`);
        element.style.setProperty("--px", (x / (rect.width || 1) - 0.5).toFixed(3));
        element.style.setProperty("--py", (y / (rect.height || 1) - 0.5).toFixed(3));
    });
}

/** 加载完成后淡入的图片，加载期间父元素显示闪光占位。 */
export function FadeImage({ src, alt = "", className, style }: { src: string; alt?: string; className?: string; style?: CSSProperties }) {
    const [loaded, setLoaded] = useState(false);
    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            draggable={false}
            className={`ch-img ${loaded ? "is-loaded" : ""} ${className || ""}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...style }}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
        />
    );
}

/** 「鞋履运动｜球鞋发售视觉系统」拆成眉题与主标题。 */
export function splitTemplateTitle(title: string) {
    const match = title.match(/^(.+?)\s*[｜|]\s*(.+)$/);
    return match ? { eyebrow: match[1], name: match[2] } : { eyebrow: "", name: title };
}

export function TemplateCover({ template, className }: { template: CanvasWorkflowTemplateSummary; className?: string }) {
    const [loaded, setLoaded] = useState(false);
    const [failedUrl, setFailedUrl] = useState("");
    if (!template.coverUrl || failedUrl === template.coverUrl) {
        const { eyebrow, name } = splitTemplateTitle(template.title);
        return (
            <span className={`ch-template-placeholder ch-poster ${className || ""}`} style={{ "--tpl-accent": template.accent || "#6d4aff" } as CSSProperties} aria-hidden="true">
                <span className="ch-poster__eyebrow">{template.categoryLabel}</span>
                <span className="ch-poster__title">{template.industry || eyebrow || name}</span>
                <span className="ch-poster__meta ch-num">{template.nodeCount} NODES · WORKFLOW</span>
            </span>
        );
    }
    return (
        <>
            {loaded ? null : <span className="ch-img-skeleton" aria-hidden="true" />}
            <img
                src={template.coverUrl}
                alt=""
                loading="lazy"
                draggable={false}
                className={`ch-img ${loaded ? "is-loaded" : ""} ${className || ""}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onLoad={() => setLoaded(true)}
                onError={() => setFailedUrl(template.coverUrl || "")}
            />
        </>
    );
}

const CATEGORY_COLORS = ["#9b7bff", "#ff6fa8", "#f5b83d", "#34d399", "#ff8a4c", "#3dd6f5", "#c9c5d6", "#60a5fa"];

export function categoryColor(category: string, categories: string[]) {
    const index = categories.indexOf(category);
    return CATEGORY_COLORS[(index < 0 ? 0 : index) % CATEGORY_COLORS.length];
}

export function CategoryDot({ color }: { color: string }) {
    return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, display: "inline-block", background: color, boxShadow: `0 0 8px ${color}` }} />;
}

export function formatProjectDate(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const time = date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false });
    if (date.toDateString() === now.toDateString()) return i18n.t("canvas.homePage.common.today", { time });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return i18n.t("canvas.homePage.common.yesterday", { time });
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() === now.getFullYear() ? `${month}-${day}` : `${date.getFullYear()}-${month}-${day}`;
}

export type ProjectGroupKey = "today" | "week" | "month" | "earlier";

/** 分组名随界面语言变化，用时再取。 */
export function projectGroupLabel(key: ProjectGroupKey) {
    return i18n.t(`canvas.homePage.groups.${key}`);
}

export function projectGroupOf(iso: string): ProjectGroupKey {
    const date = new Date(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "today";
    const days = (now.getTime() - date.getTime()) / 86_400_000;
    if (days <= 7) return "week";
    if (days <= 30) return "month";
    return "earlier";
}

/** 画布库、模板库共用的页面头部：标题、统计与右侧操作。 */
export function CanvasHomePageHead({ title, stats, actions }: { title: string; stats?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="ch-page-head">
            <div className="ch-section ch-page-head__inner">
                <div className="min-w-0">
                    <h1 className="ch-page-head__title ch-anim-up">
                        {title}
                    </h1>
                    {stats ? (
                        <div className="ch-page-head__stats ch-anim-up" style={{ animationDelay: "100ms" }}>
                            {stats}
                        </div>
                    ) : null}
                </div>
                {actions ? (
                    <div className="ch-page-head__actions ch-anim-up" style={{ animationDelay: "140ms" }}>
                        {actions}
                    </div>
                ) : null}
            </div>
        </header>
    );
}
