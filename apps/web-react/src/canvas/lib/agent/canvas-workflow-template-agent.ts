import type { CanvasWorkflowTemplateDetail, CanvasWorkflowTemplateSummary } from "../canvas/canvas-workflow-template-project.ts";
import { buildCanvasSidePanelWorkflowGroups } from "../canvas/canvas-workflow-groups.ts";

type TemplateQuery = { keyword?: unknown; category?: unknown; page?: unknown; pageSize?: unknown };

export function queryCanvasWorkflowTemplates(items: CanvasWorkflowTemplateSummary[], input: TemplateQuery) {
    const keyword = String(input.keyword || "").trim().toLowerCase();
    const category = String(input.category || "").trim().toLowerCase();
    const filtered = items.filter((item) => {
        if (category && item.category.toLowerCase() !== category && item.categoryLabel.toLowerCase() !== category) return false;
        if (!keyword) return true;
        return [item.title, item.category, item.categoryLabel, item.industry, item.summary, ...item.platforms, ...item.deliverables].join(" ").toLowerCase().includes(keyword);
    });
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize)) || 20));
    const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(maxPage, Math.max(1, Math.floor(Number(input.page)) || 1));
    const start = (page - 1) * pageSize;
    return {
        total: filtered.length,
        page,
        pageSize,
        categories: [...new Map(items.map((item) => [item.category, { id: item.category, label: item.categoryLabel }])).values()],
        items: filtered.slice(start, start + pageSize).map(compactTemplateSummary),
    };
}

export function inspectCanvasWorkflowTemplate(template: CanvasWorkflowTemplateDetail) {
    const nodes = template.document.nodes || [];
    const connections = template.document.connections || [];
    const workflows = buildCanvasSidePanelWorkflowGroups(nodes, connections).map((group, index) => ({
        id: group.id,
        index: index + 1,
        nodeIds: group.nodes.map((node) => node.id),
        firstConfigNodeId: group.firstConfig?.id,
    }));
    return {
        ...compactTemplateSummary(template),
        documentVersion: template.document.version,
        backgroundMode: template.document.backgroundMode,
        showImageInfo: Boolean(template.document.showImageInfo),
        nodes: nodes.slice(0, 100).map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
            width: Math.round(node.width),
            height: Math.round(node.height),
            metadata: compactTemplateNodeMetadata(node.metadata),
        })),
        connections: connections.slice(0, 200).map((connection) => ({ id: connection.id, fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId })),
        workflows,
        truncated: nodes.length > 100 || connections.length > 200,
    };
}

function compactTemplateSummary(item: CanvasWorkflowTemplateSummary) {
    return {
        id: item.id,
        slug: item.slug,
        title: item.title,
        category: item.category,
        categoryLabel: item.categoryLabel,
        industry: item.industry,
        summary: compactUtf8(item.summary, 600),
        platforms: item.platforms,
        deliverables: item.deliverables,
        coverUrl: item.coverUrl || undefined,
        nodeCount: item.nodeCount,
        sort: item.sort,
    };
}

function compactTemplateNodeMetadata(metadata: CanvasWorkflowTemplateDetail["document"]["nodes"][number]["metadata"]) {
    if (!metadata) return undefined;
    return {
        generationMode: metadata.generationMode,
        model: metadata.model,
        size: metadata.size,
        resolution: metadata.resolution,
        quality: metadata.quality,
        count: metadata.count,
        background: metadata.background,
        localImageOperation: metadata.localImageOperation,
        localImageOperationParams: metadata.localImageOperationParams,
        composerContent: compactUtf8(metadata.composerContent, 800),
        prompt: compactUtf8(metadata.prompt, 800),
        textContent: metadata.content && !looksLikeMedia(metadata.content) ? compactUtf8(metadata.content, 800) : undefined,
        hasMedia: Boolean(metadata.storageKey || metadata.images?.some((image) => image.storageKey || image.content) || (metadata.content && looksLikeMedia(metadata.content))),
        workflowOutputNodeIds: metadata.workflowOutputNodeIds,
        workflowProducerNodeId: metadata.workflowProducerNodeId,
    };
}

function looksLikeMedia(value: string) {
    return value.startsWith("data:") || value.startsWith("blob:") || /^https?:\/\//i.test(value);
}

function compactUtf8(value: string | undefined, maxBytes: number) {
    const text = String(value || "").trim();
    if (!text) return undefined;
    const encoder = new TextEncoder();
    if (encoder.encode(text).byteLength <= maxBytes) return text;
    let result = "";
    for (const character of text) {
        if (encoder.encode(result + character + "...").byteLength > maxBytes) break;
        result += character;
    }
    return `${result}...`;
}
