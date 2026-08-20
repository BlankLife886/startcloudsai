export type GraphLayoutNode = { key: string; width: number; height: number };
export type GraphLayoutEdge = { from: string; to: string };
export type GraphLayoutOptions = { originX: number; originY: number; columnGap: number; rowGap: number };

/**
 * Places a declared graph without any coordinates from the caller: each node
 * sits in the column matching its longest distance from a root, so the edge
 * direction alone yields a readable left-to-right layout. Cycles are tolerated
 * because the relaxation is bounded by the node count.
 */
export function layoutCanvasGraph(nodes: GraphLayoutNode[], edges: GraphLayoutEdge[], options: GraphLayoutOptions) {
    const known = new Set(nodes.map((node) => node.key));
    const usable = edges.filter((edge) => edge.from !== edge.to && known.has(edge.from) && known.has(edge.to));
    const depths = graphDepths(nodes.map((node) => node.key), usable);

    const columns = new Map<number, GraphLayoutNode[]>();
    nodes.forEach((node) => {
        const depth = depths.get(node.key) ?? 0;
        columns.set(depth, [...(columns.get(depth) || []), node]);
    });

    const positions = new Map<string, { x: number; y: number }>();
    let columnX = options.originX;
    [...columns.keys()]
        .sort((left, right) => left - right)
        .forEach((depth) => {
            let rowY = options.originY;
            let columnWidth = 0;
            (columns.get(depth) || []).forEach((node) => {
                positions.set(node.key, { x: columnX, y: rowY });
                rowY += node.height + options.rowGap;
                columnWidth = Math.max(columnWidth, node.width);
            });
            columnX += columnWidth + options.columnGap;
        });
    return { positions, edges: usable };
}

function graphDepths(keys: string[], edges: GraphLayoutEdge[]) {
    const depths = new Map(keys.map((key) => [key, 0]));
    for (let round = 0; round < keys.length; round += 1) {
        let changed = false;
        edges.forEach((edge) => {
            const next = (depths.get(edge.from) ?? 0) + 1;
            if (next > (depths.get(edge.to) ?? 0)) {
                depths.set(edge.to, next);
                changed = true;
            }
        });
        if (!changed) break;
    }
    return depths;
}
