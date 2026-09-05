import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Modal } from "antd";
import { ArrowRight, Layers3, Search, Sparkles } from "lucide-react";

import { listCanvasWorkflowTemplates, type CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";

type TemplateDialogProps = {
    open: boolean;
    onClose: () => void;
    onUse: (template: CanvasWorkflowTemplateSummary) => void | Promise<void>;
};

export function CanvasWorkflowTemplateDialog({ open, onClose, onUse }: TemplateDialogProps) {
    const [category, setCategory] = useState("all");
    const [query, setQuery] = useState("");
    const [templates, setTemplates] = useState<CanvasWorkflowTemplateSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [usingId, setUsingId] = useState("");
    useEffect(() => {
        if (!open) return;
        let disposed = false;
        setLoading(true);
        setLoadError("");
        void listCanvasWorkflowTemplates()
            .then((items) => {
                if (!disposed) setTemplates(items);
            })
            .catch((error) => {
                if (!disposed) setLoadError(error instanceof Error ? error.message : "模板加载失败");
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, [open]);
    const categories = useMemo(() => {
        const counts = new Map<string, { id: string; label: string; count: number }>();
        templates.forEach((template) => {
            const current = counts.get(template.category);
            counts.set(template.category, { id: template.category, label: template.categoryLabel, count: (current?.count || 0) + 1 });
        });
        return [...counts.values()];
    }, [templates]);
    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return templates.filter((template) => {
            if (category !== "all" && template.category !== category) return false;
            if (!normalized) return true;
            return [template.title, template.industry, template.summary, ...template.platforms, ...template.deliverables].join(" ").toLowerCase().includes(normalized);
        });
    }, [category, query, templates]);
    const activeCategoryLabel = category === "all" ? "全部模板" : categories.find((item) => item.id === category)?.label || "模板";
    const useTemplate = async (template: CanvasWorkflowTemplateSummary) => {
        if (usingId) return;
        setUsingId(template.id);
        try {
            await onUse(template);
        } finally {
            setUsingId("");
        }
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={1080}
            centered
            destroyOnHidden
            title={null}
            className="canvas-template-modal"
            rootClassName="canvas-template-modal-root"
            styles={{
                container: {
                    width: 1080,
                    minWidth: 1080,
                    maxWidth: 1080,
                    height: 720,
                    minHeight: 720,
                    maxHeight: 720,
                    padding: 0,
                    overflow: "hidden",
                },
                body: {
                    height: "100%",
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                },
            }}
        >
            <header className="canvas-template-modal__header">
                <div className="canvas-template-modal__heading">
                    <span className="canvas-template-modal__mark"><Sparkles className="size-4" /></span>
                    <div>
                        <h2>生产工作流模板</h2>
                        <p>选择一条可重复执行的生产线</p>
                    </div>
                </div>
                <label className="canvas-template-search">
                    <Search className="size-4" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索行业、平台或交付物" />
                </label>
            </header>

            <div className="canvas-template-layout">
                <aside className="canvas-template-sidebar" aria-label="模板分类">
                    <div className="canvas-template-sidebar__title">模板类型</div>
                    <div className="canvas-template-tabs" role="tablist" aria-label="模板分类">
                        <button type="button" role="tab" aria-selected={category === "all"} className={category === "all" ? "is-active" : ""} onClick={() => setCategory("all")}>
                            <span>全部模板</span><strong>{templates.length}</strong>
                        </button>
                        {categories.map((item) => (
                            <button key={item.id} type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? "is-active" : ""} onClick={() => setCategory(item.id)}>
                                <span>{item.label}</span><strong>{item.count}</strong>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="canvas-template-content">
                    <div className="canvas-template-toolbar">
                        <div className="canvas-template-results">
                            <strong>{activeCategoryLabel}</strong>
                            <span>{loading ? "正在载入" : `${filtered.length} 个结果`}</span>
                        </div>
                    </div>

                    <div className="canvas-template-grid" aria-live="polite">
                        {filtered.map((template) => (
                            <article key={template.id} className="canvas-template-card" style={{ "--template-accent": template.accent } as CSSProperties}>
                                <div className="canvas-template-card__visual">
                                    {template.coverUrl ? (
                                        <img src={template.coverUrl} alt="" className="canvas-template-card__cover" loading="lazy" />
                                    ) : (
                                        <div className="canvas-template-card__placeholder" aria-hidden="true">
                                            <strong>{template.title.slice(0, 1)}</strong>
                                        </div>
                                    )}
                                    <span className="canvas-template-card__badge">{template.categoryLabel}</span>
                                </div>
                                <div className="canvas-template-card__body">
                                    {template.industry ? <span className="canvas-template-card__industry">{template.industry}</span> : null}
                                    <h3>{template.title}</h3>
                                    <p>{template.summary}</p>
                                    <div className="canvas-template-card__footer">
                                        <span className="canvas-template-card__stats">
                                            <Layers3 className="size-3.5" />
                                            {template.deliverables.length} 类交付物
                                            {template.platforms.length ? ` · ${template.platforms.slice(0, 2).join(" / ")}` : ""}
                                        </span>
                                        <button type="button" disabled={Boolean(usingId)} onClick={() => void useTemplate(template)}>
                                            {usingId === template.id ? "正在创建" : "使用模板"}
                                            {usingId !== template.id ? <ArrowRight className="size-3.5" /> : null}
                                        </button>
                                    </div>
                                </div>
                            </article>
                        ))}
                        {loading && !templates.length ? (
                            Array.from({ length: 4 }, (_, index) => <div key={index} className="canvas-template-card canvas-template-card--skeleton" aria-hidden="true" />)
                        ) : null}
                        {!loading && loadError ? <div className="canvas-template-empty">{loadError}</div> : null}
                        {!loading && !loadError && !filtered.length ? (
                            <div className="canvas-template-empty">
                                <Search className="size-5" />
                                <strong>{query.trim() ? "没有匹配的模板" : "后台暂未发布模板"}</strong>
                                {query.trim() ? <button type="button" onClick={() => setQuery("")}>清除搜索</button> : null}
                            </div>
                        ) : null}
                    </div>
                </section>
            </div>
        </Modal>
    );
}
