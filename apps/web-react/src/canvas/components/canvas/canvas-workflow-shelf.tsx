import { useState, useMemo } from "react";
import { ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { CANVAS_WORKFLOW_TEMPLATES, type CanvasWorkflowTemplate } from "@/templates/canvas-workflow-templates";
import type { CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";

type ShelfCategory = "featured" | "industry" | "model-poster" | "game-model" | "card";

interface CanvasWorkflowShelfProps {
    onUseTemplate: (template: CanvasWorkflowTemplateSummary) => void | Promise<void>;
    onOpenTemplateDialog: () => void;
    disabled?: boolean;
}

// 4 Flagship Curated Templates for the default "Featured" view
const FEATURED_IDS = [
    "quick-test-ecommerce-main-image",
    "beauty-skincare-launch",
    "fashion-apparel-season",
    "toys-collectibles-launch",
];

// Helper to extract 4 compact pipeline stage names (2-3 chars)
function getPipelineStages(template: CanvasWorkflowTemplate): string[] {
    const id = template.id;
    if (id === "quick-test-ecommerce-main-image") return ["原图", "抠图", "合成", "交付"];
    if (id === "beauty-skincare-launch") return ["瓶器", "质地", "功效", "全案"];
    if (id === "fashion-apparel-season") return ["平铺", "模特", "穿搭", "套组"];
    if (id === "toys-collectibles-launch") return ["角色", "涂装", "陈列", "发售"];
    if (id === "ecommerce-detail-replica") return ["原版", "排版", "拆分", "分屏"];
    if (id === "footwear-sneaker-drop") return ["鞋楦", "拆解", "上脚", "海报"];
    if (id === "jewelry-luxury-detail") return ["微距", "火彩", "佩戴", "礼盒"];
    if (id === "consumer-electronics-launch") return ["外观", "接口", "场景", "KV"];
    if (id === "food-snack-campaign") return ["包装", "质感", "口味", "促销"];
    if (id.startsWith("model-")) return ["定妆", "姿态", "光影", "海报"];
    if (id.startsWith("card-")) return ["角色", "法器", "稀有", "成卡"];
    if (id.startsWith("game-")) return ["原画", "三视", "材质", "模型"];
    if (id.startsWith("icon-")) return ["草图", "网格", "材质", "套组"];

    // Dynamic fallback from deliverables or focus
    if (template.deliverables && template.deliverables.length >= 4) {
        return template.deliverables.slice(0, 4).map((d) => d.slice(0, 2));
    }
    return ["输入", "构图", "生成", "交付"];
}

export function CanvasWorkflowShelf({ onUseTemplate, onOpenTemplateDialog, disabled }: CanvasWorkflowShelfProps) {
    const [selectedCategory, setSelectedCategory] = useState<ShelfCategory>("featured");
    const [loadingId, setLoadingId] = useState<string | null>(null);

    // Filter cards according to selected category (pick 4 per tab)
    const displayedTemplates = useMemo(() => {
        if (selectedCategory === "featured") {
            return FEATURED_IDS.map((id) => CANVAS_WORKFLOW_TEMPLATES.find((t) => t.id === id)!).filter(Boolean);
        }
        return CANVAS_WORKFLOW_TEMPLATES.filter((t) => t.category === selectedCategory).slice(0, 4);
    }, [selectedCategory]);

    const handleSelectTemplate = async (template: CanvasWorkflowTemplate) => {
        if (disabled || loadingId) return;
        setLoadingId(template.id);
        try {
            const summary: CanvasWorkflowTemplateSummary = {
                id: template.id,
                slug: template.id,
                title: template.title,
                category: template.category,
                categoryLabel: template.categoryLabel,
                industry: template.industry,
                summary: template.summary,
                platforms: template.platforms,
                deliverables: template.deliverables,
                accent: template.accent,
                nodeCount: template.nodeCount,
                sort: template.seed,
            };
            await onUseTemplate(summary);
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <section className="canvas-workflow-shelf mb-8">
            {/* Shelf Header & Category Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                    <span
                        className="w-2.5 h-2.5 rounded-full jewel-dot-pulse inline-block"
                        style={{ backgroundColor: "#f59e0b", color: "#f59e0b" }}
                    />
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                        精选案例工作流
                        <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                            工程级管线 · 一键载入
                        </span>
                    </h2>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("featured")}
                        className={`px-3 py-1 rounded-lg transition-all ${
                            selectedCategory === "featured"
                                ? "bg-slate-900 text-white dark:bg-white/20 dark:text-white font-semibold shadow-sm"
                                : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"
                        }`}
                    >
                        精选推荐
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("industry")}
                        className={`px-3 py-1 rounded-lg transition-all ${
                            selectedCategory === "industry"
                                ? "bg-slate-900 text-white dark:bg-white/20 dark:text-white font-semibold shadow-sm"
                                : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"
                        }`}
                    >
                        行业电商 (17)
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("model-poster")}
                        className={`px-3 py-1 rounded-lg transition-all ${
                            selectedCategory === "model-poster"
                                ? "bg-slate-900 text-white dark:bg-white/20 dark:text-white font-semibold shadow-sm"
                                : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"
                        }`}
                    >
                        人物模特 (5)
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("game-model")}
                        className={`px-3 py-1 rounded-lg transition-all ${
                            selectedCategory === "game-model"
                                ? "bg-slate-900 text-white dark:bg-white/20 dark:text-white font-semibold shadow-sm"
                                : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"
                        }`}
                    >
                        游戏与模型 (5)
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("card")}
                        className={`px-3 py-1 rounded-lg transition-all ${
                            selectedCategory === "card"
                                ? "bg-slate-900 text-white dark:bg-white/20 dark:text-white font-semibold shadow-sm"
                                : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"
                        }`}
                    >
                        卡牌设计 (5)
                    </button>
                    <button
                        type="button"
                        onClick={onOpenTemplateDialog}
                        className="ml-1 px-3 py-1 rounded-lg text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-500/10 font-medium transition-all flex items-center gap-1"
                    >
                        全部 43 款 <ArrowRight className="size-3.5 inline" />
                    </button>
                </div>
            </div>

            {/* Template Cards 4-Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {displayedTemplates.map((template) => {
                    const stages = getPipelineStages(template);
                    const isProcessing = loadingId === template.id;
                    const accentColor = template.accent || "#8b5cf6";
                    const cleanTitle = template.title.replace(/^[^｜]+｜/, "");

                    return (
                        <div
                            key={template.id}
                            onClick={() => handleSelectTemplate(template)}
                            className="template-card group relative bg-white dark:bg-gradient-to-b dark:from-[#161822] dark:to-[#0e1017] border border-slate-200/90 dark:border-white/10 hover:border-slate-400 dark:hover:border-white/25 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md dark:shadow-lg dark:shadow-black/40 cursor-pointer transition-all duration-200 hover:-translate-y-1"
                            style={{
                                borderColor: `color-mix(in srgb, ${accentColor} 30%, transparent)`,
                            }}
                        >
                            <div className="space-y-3">
                                {/* Top Mini Pipeline Flow Viz */}
                                <div className="bg-slate-50/90 dark:bg-black/40 border border-slate-200/70 dark:border-white/5 rounded-xl p-3 relative overflow-hidden">
                                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                                        <span
                                            className="font-mono font-semibold flex items-center gap-1"
                                            style={{ color: accentColor }}
                                        >
                                            <span
                                                className="w-1.5 h-1.5 rounded-full inline-block"
                                                style={{ backgroundColor: accentColor }}
                                            />
                                            {template.nodeCount === 10
                                                ? "10 节点工作流"
                                                : template.nodeCount === 100
                                                ? "100 节点全链"
                                                : `${template.nodeCount} 节点系统`}
                                        </span>
                                        <span
                                            className="px-1.5 py-0.5 rounded border text-[10px] font-medium"
                                            style={{
                                                backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                                                borderColor: `color-mix(in srgb, ${accentColor} 25%, transparent)`,
                                                color: accentColor,
                                            }}
                                        >
                                            {template.industry}
                                        </span>
                                    </div>

                                    {/* Flow Nodes and Connecting Animated SVG Lines */}
                                    <div className="flex items-center justify-between py-1 relative">
                                        <svg
                                            className="absolute inset-0 w-full h-full pointer-events-none"
                                            preserveAspectRatio="none"
                                        >
                                            <line
                                                x1="25%"
                                                y1="50%"
                                                x2="50%"
                                                y2="50%"
                                                stroke={accentColor}
                                                strokeWidth="1.5"
                                                className="pipeline-flow-line"
                                                opacity="0.75"
                                            />
                                            <line
                                                x1="50%"
                                                y1="50%"
                                                x2="75%"
                                                y2="50%"
                                                stroke={accentColor}
                                                strokeWidth="1.5"
                                                className="pipeline-flow-line"
                                                opacity="0.75"
                                            />
                                        </svg>

                                        {stages.map((stageName, idx) => {
                                            const isLast = idx === stages.length - 1;
                                            return (
                                                <div
                                                    key={idx}
                                                    className={`z-10 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-medium shadow-sm transition-transform group-hover:scale-105 ${
                                                        isLast
                                                            ? "font-bold text-white"
                                                            : "bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 border"
                                                    }`}
                                                    style={{
                                                        backgroundColor: isLast ? accentColor : undefined,
                                                        borderColor: isLast
                                                            ? accentColor
                                                            : `color-mix(in srgb, ${accentColor} 35%, transparent)`,
                                                    }}
                                                >
                                                    {stageName}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Title and Summary */}
                                <div>
                                    <h4
                                        className="text-sm font-bold text-slate-900 dark:text-white transition-colors flex items-center gap-1.5"
                                    >
                                        {cleanTitle}
                                    </h4>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                        {template.summary}
                                    </p>
                                </div>

                                {/* Platform & Deliverable Badges */}
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {template.platforms?.slice(0, 2).map((platform, idx) => (
                                        <span
                                            key={idx}
                                            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-white/5"
                                        >
                                            {platform}
                                        </span>
                                    ))}
                                    {template.deliverables?.[0] && (
                                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-white/5">
                                            {template.deliverables[0]}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Card Footer */}
                            <div className="pt-3.5 mt-3 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
                                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                    {isProcessing ? "正在载入..." : "点击一键载入"}
                                </span>
                                <span
                                    className="px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all group-hover:shadow-sm"
                                    style={{
                                        backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                                        color: accentColor,
                                    }}
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="size-3 animate-spin inline" /> 载入中
                                        </>
                                    ) : (
                                        <>
                                            载入模板 <ArrowRight className="size-3 inline transition-transform group-hover:translate-x-0.5" />
                                        </>
                                    )}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
