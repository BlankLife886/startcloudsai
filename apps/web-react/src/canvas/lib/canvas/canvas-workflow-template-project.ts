import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData, CanvasNodeImage, CanvasNodeMetadata, ViewportTransform } from "@/types/canvas";

export type CanvasWorkflowTemplateSummary = {
    id: string;
    slug: string;
    title: string;
    category: string;
    categoryLabel: string;
    industry: string;
    summary: string;
    platforms: string[];
    deliverables: string[];
    accent: string;
    nodeCount: number;
    sort: number;
};

export type CanvasWorkflowTemplateDocument = {
    version: 3;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    backgroundMode?: CanvasProject["backgroundMode"];
    showImageInfo?: boolean;
    viewport?: ViewportTransform;
};

export type CanvasWorkflowTemplateDetail = CanvasWorkflowTemplateSummary & {
    document: CanvasWorkflowTemplateDocument;
};

function resetTemplateImage(image: CanvasNodeImage): CanvasNodeImage {
    const hasOutput = Boolean(image.content || image.storageKey);
    return {
        ...image,
        status: hasOutput ? "success" : "idle",
        taskId: undefined,
        errorDetails: undefined,
    };
}

function resetTemplateMetadata(metadata: CanvasNodeMetadata | undefined): CanvasNodeMetadata | undefined {
    if (!metadata) return metadata;
    const hasOutput = Boolean(metadata.content) || Boolean(metadata.images?.some((image) => image.content || image.storageKey));
    return {
        ...metadata,
        status: hasOutput ? "success" : "idle",
        images: metadata.images?.map(resetTemplateImage),
        taskId: undefined,
        taskKind: undefined,
        executionStatus: undefined,
        generationQueuedAt: undefined,
        generationStartedAt: undefined,
        generationCompletedAt: undefined,
        generationDurationMs: undefined,
        errorDetails: undefined,
    };
}

export function createCanvasProjectFromUploadedTemplate(template: CanvasWorkflowTemplateDetail): CanvasProject {
    if (template.document?.version !== 3 || !Array.isArray(template.document.nodes) || !template.document.nodes.length) {
        throw new Error("模板文件格式无效");
    }
    const now = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        title: `模板｜${template.title}`,
        createdAt: now,
        updatedAt: now,
        nodes: template.document.nodes.map((node) => ({ ...node, position: { ...node.position }, metadata: resetTemplateMetadata(node.metadata) })),
        connections: (template.document.connections || []).map((connection) => ({ ...connection })),
        chatSessions: [],
        activeChatId: null,
        backgroundMode: template.document.backgroundMode || "lines",
        showImageInfo: Boolean(template.document.showImageInfo),
        viewport: template.document.viewport ? { ...template.document.viewport } : { x: 520, y: 340, k: 0.12 },
        workflowRun: null,
    };
}
