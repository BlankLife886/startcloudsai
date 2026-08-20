import { starcloudsRequest } from "@/services/starclouds-api";
import type { CanvasWorkflowTemplateDetail, CanvasWorkflowTemplateSummary } from "@/lib/canvas/canvas-workflow-template-project";

export { createCanvasProjectFromUploadedTemplate } from "@/lib/canvas/canvas-workflow-template-project";
export type { CanvasWorkflowTemplateDetail, CanvasWorkflowTemplateSummary } from "@/lib/canvas/canvas-workflow-template-project";

export async function listCanvasWorkflowTemplates() {
    const data = await starcloudsRequest<{ items: CanvasWorkflowTemplateSummary[] }>("/canvas-workflow-templates");
    return Array.isArray(data.items) ? data.items : [];
}

export function getCanvasWorkflowTemplate(id: string) {
    return starcloudsRequest<CanvasWorkflowTemplateDetail>(`/canvas-workflow-templates/${encodeURIComponent(id)}`);
}
