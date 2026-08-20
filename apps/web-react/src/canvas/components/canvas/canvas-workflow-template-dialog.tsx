import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Modal } from "antd";
import { Boxes, Layers3, Search, Sparkles } from "lucide-react";

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
        <Modal open={open} onCancel={onClose} footer={null} width={1180} centered destroyOnHidden title={null} className="canvas-template-modal" rootClassName="canvas-template-modal-root">
            <header className="canvas-template-modal__header">
                <div>
                    <span className="canvas-template-modal__eyebrow"><Sparkles className="size-3.5" />生产工作流模板</span>
                    <h2>选择一条可重复执行的生产线</h2>
                </div>
                <div className="canvas-template-modal__metrics" aria-label="模板统计">
                    <span><strong>{templates.length}</strong> 模板</span>
                    <span><strong>{new Set(templates.map((item) => item.nodeCount)).size}</strong> 节点档位</span>
                    <span><strong>0</strong> 音视频节点</span>
                </div>
            </header>

            <div className="canvas-template-toolbar">
                <div className="canvas-template-tabs" role="tablist" aria-label="模板分类">
                    <button type="button" className={category === "all" ? "is-active" : ""} onClick={() => setCategory("all")}>全部 <span>{templates.length}</span></button>
                    {categories.map((item) => (
                        <button key={item.id} type="button" className={category === item.id ? "is-active" : ""} onClick={() => setCategory(item.id)}>{item.label} <span>{item.count}</span></button>
                    ))}
                </div>
                <label className="canvas-template-search">
                    <Search className="size-4" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索行业、平台或交付物" />
                </label>
            </div>

            <div className="canvas-template-grid" aria-live="polite">
                {filtered.map((template) => (
                    <article key={template.id} className="canvas-template-card" style={{ "--template-accent": template.accent } as CSSProperties}>
                        <div className="canvas-template-card__visual" aria-hidden="true">
                            <span className="canvas-template-card__accent" />
                            <span className="canvas-template-card__flow is-input" />
                            <span className="canvas-template-card__line is-first" />
                            <span className="canvas-template-card__flow is-config" />
                            <span className="canvas-template-card__line is-second" />
                            <span className="canvas-template-card__flow is-output" />
                            <span className="canvas-template-card__branch" />
                        </div>
                        <div className="canvas-template-card__body">
                            <div className="canvas-template-card__meta">
                                <span>{template.categoryLabel}</span>
                                <span><Boxes className="size-3" />{template.nodeCount} 节点</span>
                            </div>
                            <h3>{template.title}</h3>
                            <p>{template.summary}</p>
                            <div className="canvas-template-card__platforms">
                                {template.platforms.slice(0, 4).map((platform) => <span key={platform}>{platform}</span>)}
                            </div>
                            <div className="canvas-template-card__footer">
                                <span><Layers3 className="size-3.5" />{template.deliverables.length} 类交付物</span>
                                <button type="button" disabled={Boolean(usingId)} onClick={() => void useTemplate(template)}>{usingId === template.id ? "正在创建" : "使用模板"}</button>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
            {loading ? <div className="canvas-template-empty">正在加载模板</div> : null}
            {!loading && loadError ? <div className="canvas-template-empty">{loadError}</div> : null}
            {!loading && !loadError && !filtered.length ? <div className="canvas-template-empty">后台暂未发布模板</div> : null}
        </Modal>
    );
}
