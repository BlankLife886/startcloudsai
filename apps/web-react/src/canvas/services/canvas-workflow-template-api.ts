import { starcloudsRequest } from "@/services/starclouds-api";
import type { CanvasWorkflowTemplateDetail, CanvasWorkflowTemplateSummary } from "@/lib/canvas/canvas-workflow-template-project";
import { CANVAS_WORKFLOW_TEMPLATES, createCanvasProjectFromTemplate } from "@/templates/canvas-workflow-templates";

export { createCanvasProjectFromUploadedTemplate } from "@/lib/canvas/canvas-workflow-template-project";
export type { CanvasWorkflowTemplateDetail, CanvasWorkflowTemplateSummary } from "@/lib/canvas/canvas-workflow-template-project";

export async function listCanvasWorkflowTemplates(): Promise<CanvasWorkflowTemplateSummary[]> {
    try {
        const data = await starcloudsRequest<{ items: CanvasWorkflowTemplateSummary[] }>("/canvas-workflow-templates");
        if (Array.isArray(data?.items) && data.items.length > 0) return data.items;
    } catch {
        // Fallback to local static templates if API unavailable
    }
    return CANVAS_WORKFLOW_TEMPLATES.map((t) => ({
        id: t.id,
        slug: t.id,
        title: t.title,
        category: t.category,
        categoryLabel: t.categoryLabel,
        industry: t.industry,
        summary: t.summary,
        platforms: t.platforms,
        deliverables: t.deliverables,
        accent: t.accent,
        nodeCount: t.nodeCount,
        sort: t.seed,
    }));
}

export async function getCanvasWorkflowTemplate(id: string): Promise<CanvasWorkflowTemplateDetail> {
    try {
        return await starcloudsRequest<CanvasWorkflowTemplateDetail>(`/canvas-workflow-templates/${encodeURIComponent(id)}`);
    } catch {
        const template = CANVAS_WORKFLOW_TEMPLATES.find((t) => t.id === id);
        if (!template) throw new Error(`找不到模版: ${id}`);
        const project = createCanvasProjectFromTemplate(template);
        return {
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
            document: {
                version: 3,
                nodes: project.nodes,
                connections: project.connections,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo,
                viewport: project.viewport,
            },
        };
    }
}

