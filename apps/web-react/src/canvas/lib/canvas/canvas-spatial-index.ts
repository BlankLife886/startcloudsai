import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasQueryRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

type CanvasViewportSize = {
    width: number;
    height: number;
};

const DEFAULT_CELL_SIZE = 320;
const MAX_BUCKETS_PER_NODE = 256;
const MAX_QUERY_BUCKETS = 4096;

export function canvasViewportQueryRect(viewport: ViewportTransform, size: CanvasViewportSize, overscanPx = 0): CanvasQueryRect {
    const scale = Number.isFinite(viewport.k) && viewport.k > 0 ? viewport.k : 1;
    const overscan = Number.isFinite(overscanPx) ? Math.max(0, overscanPx) : 0;
    return {
        left: (-viewport.x - overscan) / scale,
        top: (-viewport.y - overscan) / scale,
        right: (Math.max(0, size.width) - viewport.x + overscan) / scale,
        bottom: (Math.max(0, size.height) - viewport.y + overscan) / scale,
    };
}

export function shouldRefreshCanvasRenderViewport(previous: ViewportTransform, next: ViewportTransform, translationThreshold: number, scaleThreshold: number) {
    const translationDelta = Math.max(Math.abs(next.x - previous.x), Math.abs(next.y - previous.y));
    const scaleDelta = Math.abs(next.k - previous.k) / Math.max(previous.k, 0.05);
    return translationDelta >= translationThreshold || scaleDelta >= scaleThreshold;
}

function normalizedRect(rect: CanvasQueryRect): CanvasQueryRect {
    return {
        left: Math.min(rect.left, rect.right),
        top: Math.min(rect.top, rect.bottom),
        right: Math.max(rect.left, rect.right),
        bottom: Math.max(rect.top, rect.bottom),
    };
}

function intersects(node: CanvasNodeData, rect: CanvasQueryRect) {
    const left = Math.min(node.position.x, node.position.x + node.width);
    const right = Math.max(node.position.x, node.position.x + node.width);
    const top = Math.min(node.position.y, node.position.y + node.height);
    const bottom = Math.max(node.position.y, node.position.y + node.height);
    return left <= rect.right && right >= rect.left && top <= rect.bottom && bottom >= rect.top;
}

/** Immutable spatial hash rebuilt only when the persisted node array changes. */
export class CanvasSpatialIndex {
    private readonly buckets = new Map<string, CanvasNodeData[]>();
    private readonly oversizedNodes: CanvasNodeData[] = [];
    private readonly orderById = new Map<string, number>();
    private readonly nodeById = new Map<string, CanvasNodeData>();
    private readonly cellSize: number;
    private readonly nodes: CanvasNodeData[];

    constructor(nodes: CanvasNodeData[], cellSize = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.nodes = nodes;
        nodes.forEach((node, order) => {
            this.orderById.set(node.id, order);
            this.nodeById.set(node.id, node);

            const left = Math.min(node.position.x, node.position.x + node.width);
            const right = Math.max(node.position.x, node.position.x + node.width);
            const top = Math.min(node.position.y, node.position.y + node.height);
            const bottom = Math.max(node.position.y, node.position.y + node.height);
            if (![left, right, top, bottom].every(Number.isFinite)) {
                this.oversizedNodes.push(node);
                return;
            }
            const minCellX = Math.floor(left / this.cellSize);
            const maxCellX = Math.floor(right / this.cellSize);
            const minCellY = Math.floor(top / this.cellSize);
            const maxCellY = Math.floor(bottom / this.cellSize);
            const bucketCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);
            if (bucketCount > MAX_BUCKETS_PER_NODE) {
                this.oversizedNodes.push(node);
                return;
            }

            for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
                    const key = `${cellX}:${cellY}`;
                    const bucket = this.buckets.get(key);
                    if (bucket) bucket.push(node);
                    else this.buckets.set(key, [node]);
                }
            }
        });
    }

    get(nodeId: string) {
        return this.nodeById.get(nodeId);
    }

    orderOf(nodeId: string) {
        return this.orderById.get(nodeId) ?? -1;
    }

    queryPoint(x: number, y: number) {
        return this.queryRect({ left: x, top: y, right: x, bottom: y });
    }

    queryRect(input: CanvasQueryRect) {
        const rect = normalizedRect(input);
        const minCellX = Math.floor(rect.left / this.cellSize);
        const maxCellX = Math.floor(rect.right / this.cellSize);
        const minCellY = Math.floor(rect.top / this.cellSize);
        const maxCellY = Math.floor(rect.bottom / this.cellSize);
        const candidates = new Set<CanvasNodeData>(this.oversizedNodes);
        const bucketCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);

        if (!Number.isFinite(bucketCount) || bucketCount > MAX_QUERY_BUCKETS) {
            this.nodes.forEach((node) => candidates.add(node));
        } else {
            for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
                    this.buckets.get(`${cellX}:${cellY}`)?.forEach((node) => candidates.add(node));
                }
            }
        }

        return [...candidates]
            .filter((node) => intersects(node, rect))
            .sort((a, b) => (this.orderById.get(b.id) || 0) - (this.orderById.get(a.id) || 0));
    }
}

export function buildCanvasSpatialIndex(nodes: CanvasNodeData[]) {
    return new CanvasSpatialIndex(nodes);
}

type RankedNode = { node: CanvasNodeData; area: number; order: number };

function rankBefore(left: RankedNode, right: RankedNode) {
    return left.area < right.area || (left.area === right.area && left.order < right.order);
}

/** Selects the largest nodes without copying and sorting the entire canvas. */
export function pickLargestCanvasNodes(nodes: CanvasNodeData[], limit: number) {
    if (limit <= 0) return [];
    if (nodes.length <= limit) return nodes;
    const heap: RankedNode[] = [];

    const siftUp = (index: number) => {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (!rankBefore(heap[index], heap[parent])) break;
            [heap[index], heap[parent]] = [heap[parent], heap[index]];
            index = parent;
        }
    };
    const siftDown = (start: number) => {
        let index = start;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;
            if (left < heap.length && rankBefore(heap[left], heap[smallest])) smallest = left;
            if (right < heap.length && rankBefore(heap[right], heap[smallest])) smallest = right;
            if (smallest === index) break;
            [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
            index = smallest;
        }
    };

    nodes.forEach((node, order) => {
        const rawArea = node.width * node.height;
        const ranked = { node, area: Number.isFinite(rawArea) ? Math.max(0, rawArea) : 0, order };
        if (heap.length < limit) {
            heap.push(ranked);
            siftUp(heap.length - 1);
            return;
        }
        if (!rankBefore(heap[0], ranked)) return;
        heap[0] = ranked;
        siftDown(0);
    });

    return heap.sort((left, right) => left.order - right.order).map((item) => item.node);
}
