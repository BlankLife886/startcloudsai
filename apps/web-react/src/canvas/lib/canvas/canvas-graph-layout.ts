export type GraphLayoutNode = { key: string; width: number; height: number; order?: number };
export type GraphLayoutEdge = { from: string; to: string };
export type GraphLayoutOptions = { originX: number; originY: number; columnGap: number; rowGap: number };

export type CanvasArrangeNode = GraphLayoutNode & {
    x: number;
    y: number;
    groupKey?: string;
    isGroup?: boolean;
};

export type CanvasArrangeOptions = Omit<GraphLayoutOptions, "originX" | "originY"> & {
    scope: "all" | "selection";
    selectedKeys?: string[];
    direction?: "LR" | "TB";
};

type NormalizedNode = GraphLayoutNode & { order: number; inputIndex: number };
type LayoutBlock = { id: number; members: NormalizedNode[]; width: number; height: number; order: number; stableKey: string };
type LocalLayout = { positions: Map<string, { x: number; y: number }>; width: number; height: number };

/**
 * Deterministic left-to-right layered layout. Weakly connected components are
 * kept apart, cycles are collapsed into SCC blocks, and isolates are packed in
 * a compact grid. Every node dimension participates in spacing.
 */
export function layoutCanvasGraph(nodes: GraphLayoutNode[], edges: GraphLayoutEdge[], options: GraphLayoutOptions) {
    const safeOptions = normalizeOptions(options);
    const normalizedNodes = normalizeNodes(nodes);
    const usable = normalizeEdges(edges, normalizedNodes);
    if (!normalizedNodes.length) return { positions: new Map<string, { x: number; y: number }>(), edges: usable };

    const compareNodes = nodeComparator(normalizedNodes);
    const { connected, isolates } = weaklyConnectedComponents(normalizedNodes, usable, compareNodes);
    const placed = new Map<string, { x: number; y: number }>();
    const componentGap = Math.max(safeOptions.rowGap * 2, safeOptions.columnGap, 48);
    let cursorY = safeOptions.originY;

    connected.forEach((component) => {
        const keys = new Set(component.map((node) => node.key));
        const componentEdges = usable.filter((edge) => keys.has(edge.from) && keys.has(edge.to));
        const local = layoutConnectedComponent(component, componentEdges, safeOptions, compareNodes);
        local.positions.forEach((position, key) => {
            placed.set(key, { x: safeOptions.originX + position.x, y: cursorY + position.y });
        });
        cursorY += local.height + componentGap;
    });

    if (isolates.length) {
        const local = layoutIsolates(isolates, safeOptions);
        local.positions.forEach((position, key) => {
            placed.set(key, { x: safeOptions.originX + position.x, y: cursorY + position.y });
        });
    }

    // Preserve caller node order in the returned Map while keeping coordinates
    // independent of edge order.
    const positions = new Map<string, { x: number; y: number }>();
    normalizedNodes.forEach((node) => {
        const position = placed.get(node.key);
        if (position) positions.set(node.key, position);
    });
    return { positions, edges: usable };
}

/**
 * Arranges live canvas nodes without accepting coordinates from the Agent.
 * Group descendants are promoted to their outer group and translated as one
 * rigid unit, so groupId metadata never needs to be rewritten.
 */
export function arrangeCanvasNodes(nodes: CanvasArrangeNode[], edges: GraphLayoutEdge[], options: CanvasArrangeOptions) {
    if (options.direction && options.direction !== "LR" && options.direction !== "TB") throw new Error(`Unsupported canvas layout direction: ${options.direction}`);
    const direction = options.direction === "TB" ? "TB" : "LR";
    const safeOptions = normalizeOptions({ originX: 0, originY: 0, columnGap: options.columnGap, rowGap: options.rowGap });
    const normalized = normalizeArrangeNodes(nodes);
    if (!normalized.length) return { positions: new Map<string, { x: number; y: number }>(), arrangedKeys: [] as string[] };
    const usableEdges = normalizeEdges(edges, normalized);

    const nodeByKey = new Map(normalized.map((node) => [node.key, node]));
    const groupKeys = new Set(normalized.filter((node) => node.isGroup).map((node) => node.key));
    const rootByKey = rigidGroupRoots(normalized, groupKeys, nodeByKey);
    const selected = new Set((options.selectedKeys || []).map((key) => String(key || "").trim()).filter((key) => nodeByKey.has(key)));
    const activeRoots = new Set<string>();
    if (options.scope === "selection") {
        selected.forEach((key) => activeRoots.add(rootByKey.get(key) || key));
    } else {
        normalized.forEach((node) => activeRoots.add(rootByKey.get(node.key) || node.key));
    }
    if (!activeRoots.size) return { positions: new Map<string, { x: number; y: number }>(), arrangedKeys: [] as string[] };

    const membersByRoot = new Map<string, typeof normalized>();
    normalized.forEach((node) => {
        const root = rootByKey.get(node.key) || node.key;
        if (!activeRoots.has(root)) return;
        membersByRoot.set(root, [...(membersByRoot.get(root) || []), node]);
    });

    const units = [...membersByRoot.entries()].map(([key, members]) => {
        const bounds = boundsOf(members);
        const order = nodeByKey.get(key)?.order ?? Math.min(...members.map((member) => member.order));
        return { key, members, bounds, order };
    });
    units.sort((left, right) => unitCrossAxisStart(left, direction) - unitCrossAxisStart(right, direction)
        || unitMainAxisStart(left, direction) - unitMainAxisStart(right, direction)
        || compareStableStrings(left.key, right.key));
    units.forEach((unit, order) => {
        unit.order = order;
    });
    const unitByMember = new Map<string, string>();
    units.forEach((unit) => unit.members.forEach((member) => unitByMember.set(member.key, unit.key)));

    const unitEdges: GraphLayoutEdge[] = [];
    const seenUnitEdges = new Set<string>();
    usableEdges.forEach((edge) => {
        const from = unitByMember.get(edge.from);
        const to = unitByMember.get(edge.to);
        if (!from || !to || from === to) return;
        const signature = `${from}\u0000${to}`;
        if (seenUnitEdges.has(signature)) return;
        seenUnitEdges.add(signature);
        unitEdges.push({ from, to });
    });

    const activeMembers = units.flatMap((unit) => unit.members);
    const anchor = boundsOf(activeMembers);
    const layout = layoutArrangeUnits(units, unitEdges, safeOptions, anchor, direction);
    const positions = new Map<string, { x: number; y: number }>();
    units.forEach((unit) => {
        const layoutTarget = layout.positions.get(unit.key);
        if (!layoutTarget) return;
        const target = direction === "TB" ? { x: layoutTarget.y, y: layoutTarget.x } : layoutTarget;
        const dx = target.x - unit.bounds.left;
        const dy = target.y - unit.bounds.top;
        unit.members.forEach((member) => positions.set(member.key, { x: member.x + dx, y: member.y + dy }));
    });

    if (options.scope === "selection") avoidFixedNodeOverlap(positions, normalized, usableEdges, safeOptions.columnGap, direction);
    const orderedPositions = new Map<string, { x: number; y: number }>();
    normalized.forEach((node) => {
        const position = positions.get(node.key);
        if (position) orderedPositions.set(node.key, position);
    });
    return { positions: orderedPositions, arrangedKeys: [...orderedPositions.keys()] };
}

function normalizeOptions(options: GraphLayoutOptions): GraphLayoutOptions {
    return {
        originX: finiteNumber(options.originX, "layout originX"),
        originY: finiteNumber(options.originY, "layout originY"),
        columnGap: nonNegativeNumber(options.columnGap, "layout columnGap"),
        rowGap: nonNegativeNumber(options.rowGap, "layout rowGap"),
    };
}

function normalizeNodes(nodes: GraphLayoutNode[]) {
    const seen = new Set<string>();
    return nodes.map<NormalizedNode>((node, inputIndex) => {
        const key = String(node.key || "").trim();
        if (!key) throw new Error("Canvas graph node key must not be empty");
        if (seen.has(key)) throw new Error(`Duplicate canvas graph node key: ${key}`);
        seen.add(key);
        return {
            key,
            width: positiveNumber(node.width, `node ${key} width`),
            height: positiveNumber(node.height, `node ${key} height`),
            order: node.order === undefined ? inputIndex : finiteNumber(node.order, `node ${key} order`),
            inputIndex,
        };
    });
}

function normalizeArrangeNodes(nodes: CanvasArrangeNode[]) {
    const layoutNodes = normalizeNodes(nodes);
    return layoutNodes.map((node, index) => {
        const source = nodes[index];
        return {
            ...node,
            x: finiteNumber(source.x, `node ${node.key} x`),
            y: finiteNumber(source.y, `node ${node.key} y`),
            groupKey: source.groupKey ? String(source.groupKey).trim() : undefined,
            isGroup: Boolean(source.isGroup),
        };
    });
}

function normalizeEdges(edges: GraphLayoutEdge[], nodes: NormalizedNode[]) {
    const known = new Set(nodes.map((node) => node.key));
    const order = new Map(nodes.map((node) => [node.key, node.order]));
    const seen = new Set<string>();
    const usable: GraphLayoutEdge[] = [];
    edges.forEach((edge) => {
        const from = String(edge.from || "").trim();
        const to = String(edge.to || "").trim();
        if (!from || !to || from === to || !known.has(from) || !known.has(to)) return;
        const signature = `${from}\u0000${to}`;
        if (seen.has(signature)) return;
        seen.add(signature);
        usable.push({ from, to });
    });
    return usable.sort((left, right) => compareKeys(left.from, right.from, order) || compareKeys(left.to, right.to, order));
}

function nodeComparator(nodes: NormalizedNode[]) {
    const order = new Map(nodes.map((node) => [node.key, node.order]));
    return (left: NormalizedNode, right: NormalizedNode) => compareKeys(left.key, right.key, order);
}

function compareKeys(left: string, right: string, order: Map<string, number>) {
    return (order.get(left) ?? 0) - (order.get(right) ?? 0) || compareStableStrings(left, right);
}

function compareStableStrings(left: string, right: string) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function weaklyConnectedComponents(nodes: NormalizedNode[], edges: GraphLayoutEdge[], compareNodes: (left: NormalizedNode, right: NormalizedNode) => number) {
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const adjacent = new Map(nodes.map((node) => [node.key, new Set<string>()]));
    edges.forEach((edge) => {
        adjacent.get(edge.from)?.add(edge.to);
        adjacent.get(edge.to)?.add(edge.from);
    });
    const visited = new Set<string>();
    const connected: NormalizedNode[][] = [];
    const isolates: NormalizedNode[] = [];
    [...nodes].sort(compareNodes).forEach((node) => {
        if (visited.has(node.key)) return;
        visited.add(node.key);
        if (!adjacent.get(node.key)?.size) {
            isolates.push(node);
            return;
        }
        const queue = [node.key];
        const component: NormalizedNode[] = [];
        while (queue.length) {
            const key = queue.shift();
            if (!key) continue;
            const current = nodeByKey.get(key);
            if (current) component.push(current);
            const neighbors = [...(adjacent.get(key) || [])].map((neighbor) => nodeByKey.get(neighbor)).filter((item): item is NormalizedNode => Boolean(item)).sort(compareNodes);
            neighbors.forEach((neighbor) => {
                if (visited.has(neighbor.key)) return;
                visited.add(neighbor.key);
                queue.push(neighbor.key);
            });
        }
        connected.push(component.sort(compareNodes));
    });
    return { connected, isolates };
}

function layoutConnectedComponent(nodes: NormalizedNode[], edges: GraphLayoutEdge[], options: GraphLayoutOptions, compareNodes: (left: NormalizedNode, right: NormalizedNode) => number): LocalLayout {
    const components = stronglyConnectedComponents(nodes, edges, compareNodes)
        .map((members) => ({ members: members.sort(compareNodes) }))
        .sort((left, right) => compareNodes(left.members[0], right.members[0]));
    const blocks: LayoutBlock[] = components.map((component, id) => ({
        id,
        members: component.members,
        width: Math.max(...component.members.map((node) => node.width)),
        height: component.members.reduce((sum, node) => sum + node.height, 0) + options.rowGap * Math.max(0, component.members.length - 1),
        order: Math.min(...component.members.map((node) => node.order)),
        stableKey: component.members.map((node) => node.key).join("\u0000"),
    }));
    const blockByNode = new Map<string, number>();
    blocks.forEach((block) => block.members.forEach((node) => blockByNode.set(node.key, block.id)));
    const incoming = new Map(blocks.map((block) => [block.id, new Set<number>()]));
    const outgoing = new Map(blocks.map((block) => [block.id, new Set<number>()]));
    edges.forEach((edge) => {
        const from = blockByNode.get(edge.from);
        const to = blockByNode.get(edge.to);
        if (from === undefined || to === undefined || from === to) return;
        outgoing.get(from)?.add(to);
        incoming.get(to)?.add(from);
    });

    const compareBlocks = (left: LayoutBlock, right: LayoutBlock) => left.order - right.order || compareStableStrings(left.stableKey, right.stableKey);
    const ranks = condensationRanks(blocks, incoming, outgoing, compareBlocks);
    const maxRank = Math.max(0, ...ranks.values());
    const columns = Array.from({ length: maxRank + 1 }, () => [] as LayoutBlock[]);
    blocks.forEach((block) => columns[ranks.get(block.id) || 0].push(block));
    columns.forEach((column) => column.sort(compareBlocks));
    reduceCrossings(columns, incoming, outgoing, compareBlocks);

    const columnWidths = columns.map((column) => Math.max(...column.map((block) => block.width)));
    const columnHeights = columns.map((column) => column.reduce((sum, block) => sum + block.height, 0) + options.rowGap * Math.max(0, column.length - 1));
    const height = Math.max(...columnHeights);
    const positions = new Map<string, { x: number; y: number }>();
    let x = 0;
    columns.forEach((column, columnIndex) => {
        let y = (height - columnHeights[columnIndex]) / 2;
        column.forEach((block) => {
            let memberY = y;
            block.members.forEach((node) => {
                positions.set(node.key, { x, y: memberY });
                memberY += node.height + options.rowGap;
            });
            y += block.height + options.rowGap;
        });
        x += columnWidths[columnIndex] + options.columnGap;
    });
    const width = columnWidths.reduce((sum, value) => sum + value, 0) + options.columnGap * Math.max(0, columnWidths.length - 1);
    return { positions, width, height };
}

function stronglyConnectedComponents(nodes: NormalizedNode[], edges: GraphLayoutEdge[], compareNodes: (left: NormalizedNode, right: NormalizedNode) => number) {
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const adjacent = new Map(nodes.map((node) => [node.key, [] as NormalizedNode[]]));
    const reverseAdjacent = new Map(nodes.map((node) => [node.key, [] as NormalizedNode[]]));
    edges.forEach((edge) => {
        const source = nodeByKey.get(edge.from);
        const target = nodeByKey.get(edge.to);
        if (target) adjacent.get(edge.from)?.push(target);
        if (source) reverseAdjacent.get(edge.to)?.push(source);
    });
    adjacent.forEach((targets) => targets.sort(compareNodes));
    reverseAdjacent.forEach((sources) => sources.sort(compareNodes));

    const visited = new Set<string>();
    const finishOrder: NormalizedNode[] = [];
    [...nodes].sort(compareNodes).forEach((root) => {
        if (visited.has(root.key)) return;
        visited.add(root.key);
        const stack = [{ node: root, nextTarget: 0 }];
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const targets = adjacent.get(frame.node.key) || [];
            if (frame.nextTarget < targets.length) {
                const target = targets[frame.nextTarget++];
                if (visited.has(target.key)) continue;
                visited.add(target.key);
                stack.push({ node: target, nextTarget: 0 });
                continue;
            }
            finishOrder.push(frame.node);
            stack.pop();
        }
    });

    const assigned = new Set<string>();
    const components: NormalizedNode[][] = [];
    for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
        const root = finishOrder[index];
        if (assigned.has(root.key)) continue;
        assigned.add(root.key);
        const component: NormalizedNode[] = [];
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            component.push(node);
            const sources = reverseAdjacent.get(node.key) || [];
            for (let sourceIndex = sources.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
                const source = sources[sourceIndex];
                if (assigned.has(source.key)) continue;
                assigned.add(source.key);
                stack.push(source);
            }
        }
        components.push(component);
    }
    return components;
}

function condensationRanks(blocks: LayoutBlock[], incoming: Map<number, Set<number>>, outgoing: Map<number, Set<number>>, compareBlocks: (left: LayoutBlock, right: LayoutBlock) => number) {
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const indegree = new Map(blocks.map((block) => [block.id, incoming.get(block.id)?.size || 0]));
    const available = blocks.filter((block) => !indegree.get(block.id)).sort(compareBlocks);
    const ranks = new Map(blocks.map((block) => [block.id, 0]));
    while (available.length) {
        const block = available.shift();
        if (!block) break;
        [...(outgoing.get(block.id) || [])]
            .map((id) => blockById.get(id))
            .filter((item): item is LayoutBlock => Boolean(item))
            .sort(compareBlocks)
            .forEach((target) => {
                ranks.set(target.id, Math.max(ranks.get(target.id) || 0, (ranks.get(block.id) || 0) + 1));
                const next = (indegree.get(target.id) || 0) - 1;
                indegree.set(target.id, next);
                if (!next) {
                    available.push(target);
                    available.sort(compareBlocks);
                }
            });
    }
    return ranks;
}

function reduceCrossings(columns: LayoutBlock[][], incoming: Map<number, Set<number>>, outgoing: Map<number, Set<number>>, compareBlocks: (left: LayoutBlock, right: LayoutBlock) => number) {
    const neighborScore = (ids: Set<number> | undefined, indexes: Map<number, number>) => {
        const values = [...(ids || [])].map((id) => indexes.get(id)).filter((value): value is number => value !== undefined);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
    };
    for (let round = 0; round < 4; round += 1) {
        for (let rank = 1; rank < columns.length; rank += 1) {
            if (columns[rank].length < 2) continue;
            const indexes = blockIndexes(columns);
            columns[rank].sort((left, right) => compareOptionalScores(neighborScore(incoming.get(left.id), indexes), neighborScore(incoming.get(right.id), indexes)) || compareBlocks(left, right));
        }
        for (let rank = columns.length - 2; rank >= 0; rank -= 1) {
            if (columns[rank].length < 2) continue;
            const indexes = blockIndexes(columns);
            columns[rank].sort((left, right) => compareOptionalScores(neighborScore(outgoing.get(left.id), indexes), neighborScore(outgoing.get(right.id), indexes)) || compareBlocks(left, right));
        }
    }
    reduceCrossingsByAdjacentSwap(columns, incoming, outgoing);
}

function reduceCrossingsByAdjacentSwap(columns: LayoutBlock[][], incoming: Map<number, Set<number>>, outgoing: Map<number, Set<number>>) {
    const locations = new Map<number, { rank: number; index: number }>();
    columns.forEach((column, rank) => column.forEach((block, index) => locations.set(block.id, { rank, index })));
    let improved = true;
    while (improved) {
        improved = false;
        columns.forEach((column) => {
            for (let index = 0; index < column.length - 1; index += 1) {
                const first = column[index];
                const second = column[index + 1];
                const delta = neighborSwapCrossingDelta(incoming.get(first.id), incoming.get(second.id), locations)
                    + neighborSwapCrossingDelta(outgoing.get(first.id), outgoing.get(second.id), locations);
                if (delta >= 0) continue;
                [column[index], column[index + 1]] = [second, first];
                const firstLocation = locations.get(first.id);
                const secondLocation = locations.get(second.id);
                if (firstLocation) firstLocation.index = index + 1;
                if (secondLocation) secondLocation.index = index;
                improved = true;
            }
        });
    }
}

function neighborSwapCrossingDelta(firstNeighbors: Set<number> | undefined, secondNeighbors: Set<number> | undefined, locations: Map<number, { rank: number; index: number }>) {
    let delta = 0;
    (firstNeighbors || []).forEach((firstId) => {
        const first = locations.get(firstId);
        if (!first) return;
        (secondNeighbors || []).forEach((secondId) => {
            const second = locations.get(secondId);
            if (!second || first.rank !== second.rank || first.index === second.index) return;
            delta += first.index < second.index ? 1 : -1;
        });
    });
    return delta;
}

function blockIndexes(columns: LayoutBlock[][]) {
    const indexes = new Map<number, number>();
    columns.forEach((column) => {
        const denominator = Math.max(1, column.length - 1);
        column.forEach((block, index) => indexes.set(block.id, index / denominator));
    });
    return indexes;
}

function compareOptionalScores(left: number | undefined, right: number | undefined) {
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
}

function layoutIsolates(nodes: NormalizedNode[], options: GraphLayoutOptions): LocalLayout {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const rows = Math.ceil(nodes.length / columns);
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights = Array.from({ length: rows }, () => 0);
    nodes.forEach((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        columnWidths[column] = Math.max(columnWidths[column], node.width);
        rowHeights[row] = Math.max(rowHeights[row], node.height);
    });
    const xOffsets = offsets(columnWidths, options.columnGap);
    const yOffsets = offsets(rowHeights, options.rowGap);
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => positions.set(node.key, { x: xOffsets[index % columns], y: yOffsets[Math.floor(index / columns)] }));
    return {
        positions,
        width: columnWidths.reduce((sum, value) => sum + value, 0) + options.columnGap * Math.max(0, columns - 1),
        height: rowHeights.reduce((sum, value) => sum + value, 0) + options.rowGap * Math.max(0, rows - 1),
    };
}

function offsets(sizes: number[], gap: number) {
    let cursor = 0;
    return sizes.map((size) => {
        const offset = cursor;
        cursor += size + gap;
        return offset;
    });
}

function rigidGroupRoots<T extends { key: string; groupKey?: string }>(nodes: T[], groupKeys: Set<string>, nodeByKey: Map<string, T>) {
    const roots = new Map<string, string>();
    nodes.forEach((node) => {
        if (roots.has(node.key)) return;
        const path: string[] = [];
        const pathIndexes = new Map<string, number>();
        let current = node.key;
        let root = "";
        while (!root) {
            const cached = roots.get(current);
            if (cached) {
                root = cached;
                break;
            }
            if (pathIndexes.has(current)) throw new Error(`Cyclic canvas group relation at ${current}`);
            pathIndexes.set(current, path.length);
            path.push(current);
            const currentNode = nodeByKey.get(current);
            const parent = currentNode?.groupKey && groupKeys.has(currentNode.groupKey) && nodeByKey.has(currentNode.groupKey) ? currentNode.groupKey : "";
            if (!parent || parent === current) root = current;
            else current = parent;
        }
        path.forEach((key) => roots.set(key, root));
    });
    return roots;
}

function boundsOf(nodes: Array<{ x: number; y: number; width: number; height: number }>) {
    return nodes.reduce(
        (bounds, node) => ({
            left: Math.min(bounds.left, node.x),
            top: Math.min(bounds.top, node.y),
            right: Math.max(bounds.right, node.x + node.width),
            bottom: Math.max(bounds.bottom, node.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function unitCrossAxisStart(unit: { bounds: ReturnType<typeof boundsOf> }, direction: "LR" | "TB") {
    return direction === "TB" ? unit.bounds.left : unit.bounds.top;
}

function unitMainAxisStart(unit: { bounds: ReturnType<typeof boundsOf> }, direction: "LR" | "TB") {
    return direction === "TB" ? unit.bounds.top : unit.bounds.left;
}

function layoutArrangeUnits(
    units: Array<{ key: string; bounds: ReturnType<typeof boundsOf>; order: number }>,
    edges: GraphLayoutEdge[],
    options: GraphLayoutOptions,
    anchor: ReturnType<typeof boundsOf>,
    direction: "LR" | "TB",
) {
    const stateSignature = () => JSON.stringify([...units].sort((left, right) => left.order - right.order || compareStableStrings(left.key, right.key)).map((unit) => unit.key));
    const seen = new Map<string, number>();
    const results: Array<{ layout: ReturnType<typeof layoutCanvasGraph>; nextState: string }> = [];
    let state = stateSignature();
    seen.set(state, 0);

    // Geometry-based ordering can expose another strict crossing improvement.
    // Resolve that feedback inside one arrange call so repeated requests do not
    // shuffle branches a second time.
    const iterationLimit = Math.min(4, Math.max(2, units.length));
    for (let iteration = 0; iteration < iterationLimit; iteration += 1) {
        const layout = layoutCanvasGraph(
            units.map((unit) => {
                const width = unit.bounds.right - unit.bounds.left;
                const height = unit.bounds.bottom - unit.bounds.top;
                return { key: unit.key, width: direction === "TB" ? height : width, height: direction === "TB" ? width : height, order: unit.order };
            }),
            edges,
            {
                ...options,
                originX: direction === "TB" ? anchor.top : anchor.left,
                originY: direction === "TB" ? anchor.left : anchor.top,
            },
        );
        const nextOrder = [...units].sort((left, right) => {
            const leftPosition = layout.positions.get(left.key);
            const rightPosition = layout.positions.get(right.key);
            return (leftPosition?.y ?? 0) - (rightPosition?.y ?? 0)
                || (leftPosition?.x ?? 0) - (rightPosition?.x ?? 0)
                || compareStableStrings(left.key, right.key);
        });
        const nextState = JSON.stringify(nextOrder.map((unit) => unit.key));
        results.push({ layout, nextState });
        if (nextState === state) return layout;

        const cycleStart = seen.get(nextState);
        if (cycleStart !== undefined) {
            return [...results.slice(cycleStart)].sort((left, right) => compareStableStrings(left.nextState, right.nextState))[0].layout;
        }
        nextOrder.forEach((unit, order) => {
            unit.order = order;
        });
        state = nextState;
        seen.set(state, results.length);
    }
    return [...results].sort((left, right) => compareStableStrings(left.nextState, right.nextState))[0].layout;
}

function avoidFixedNodeOverlap(
    positions: Map<string, { x: number; y: number }>,
    nodes: ReturnType<typeof normalizeArrangeNodes>,
    edges: GraphLayoutEdge[],
    gap: number,
    direction: "LR" | "TB",
) {
    const arranged = new Set(positions.keys());
    const moving = nodes.filter((node) => arranged.has(node.key));
    const fixed = nodes.filter((node) => !arranged.has(node.key));
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    let minimumShift = Number.NEGATIVE_INFINITY;
    let maximumShift = Number.POSITIVE_INFINITY;
    edges.forEach((edge) => {
        const fromNode = nodeByKey.get(edge.from);
        const toNode = nodeByKey.get(edge.to);
        const fromPosition = positions.get(edge.from);
        const toPosition = positions.get(edge.to);
        if (!fromNode || !toNode || Boolean(fromPosition) === Boolean(toPosition)) return;
        if (fromPosition) {
            maximumShift = Math.min(maximumShift, axisStart(toNode, direction) - gap - axisEnd(fromNode, fromPosition, direction));
            return;
        }
        if (toPosition) {
            minimumShift = Math.max(minimumShift, axisEnd(fromNode, fromNode, direction) + gap - axisStart(toPosition, direction));
        }
    });
    const directionalConstraintsAreCompatible = minimumShift <= maximumShift;

    const overlapsFixed = moving.some((node) => {
        const position = positions.get(node.key);
        return Boolean(position && fixed.some((fixedNode) => rectanglesOverlap(position.x, position.y, node.width, node.height, fixedNode.x, fixedNode.y, fixedNode.width, fixedNode.height)));
    });
    const directionRequiresShift = directionalConstraintsAreCompatible && (minimumShift > 0 || maximumShift < 0);
    if (!overlapsFixed && !directionRequiresShift) return;

    // Each fixed/moving pair forbids an interval of rigid translations on the
    // layout axis. Pick the closest permitted boundary of the merged interval;
    // this clears every obstacle at once and avoids cascading collisions.
    const clearance = overlapsFixed || directionRequiresShift ? gap : 0;
    const forbidden: Array<[number, number]> = [];
    moving.forEach((node) => {
        const position = positions.get(node.key);
        if (!position) return;
        fixed.forEach((fixedNode) => {
            if (direction === "TB") {
                if (!spansOverlap(position.x, position.x + node.width, fixedNode.x, fixedNode.x + fixedNode.width)) return;
                forbidden.push([
                    fixedNode.y - clearance - (position.y + node.height),
                    fixedNode.y + fixedNode.height + clearance - position.y,
                ]);
                return;
            }
            if (!spansOverlap(position.y, position.y + node.height, fixedNode.y, fixedNode.y + fixedNode.height)) return;
            forbidden.push([
                fixedNode.x - clearance - (position.x + node.width),
                fixedNode.x + fixedNode.width + clearance - position.x,
            ]);
        });
    });
    forbidden.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

    const merged: Array<[number, number]> = [];
    forbidden.forEach((interval) => {
        const current = merged[merged.length - 1];
        if (!current || interval[0] >= current[1]) {
            merged.push(interval);
            return;
        }
        current[1] = Math.max(current[1], interval[1]);
    });

    const preferredShift = directionalConstraintsAreCompatible ? Math.max(minimumShift, Math.min(maximumShift, 0)) : 0;
    const containingPreferred = merged.find((interval) => interval[0] < preferredShift && interval[1] > preferredShift);
    let shift = preferredShift;
    if (containingPreferred) {
        let candidates = [containingPreferred[0], containingPreferred[1]];
        if (directionalConstraintsAreCompatible) {
            candidates = candidates.filter((candidate) => candidate >= minimumShift && candidate <= maximumShift);
            if (!candidates.length) throw new Error("Selected nodes cannot avoid fixed nodes while preserving connection direction");
        }
        candidates.sort((left, right) => directionalShiftPenalty(left, minimumShift, maximumShift) - directionalShiftPenalty(right, minimumShift, maximumShift)
            || Math.abs(left) - Math.abs(right)
            || right - left);
        [shift] = candidates;
    }
    positions.forEach((position, key) => positions.set(key, direction === "TB"
        ? { x: position.x, y: position.y + shift }
        : { x: position.x + shift, y: position.y }));
}

function directionalShiftPenalty(shift: number, minimum: number, maximum: number) {
    return Math.max(0, minimum - shift) + Math.max(0, shift - maximum);
}

function axisStart(position: { x: number; y: number }, direction: "LR" | "TB") {
    return direction === "TB" ? position.y : position.x;
}

function axisEnd(node: { width: number; height: number }, position: { x: number; y: number }, direction: "LR" | "TB") {
    return axisStart(position, direction) + (direction === "TB" ? node.height : node.width);
}

function rectanglesOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    return aStart < bEnd && aEnd > bStart;
}

function finiteNumber(value: number, label: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
    return value;
}

function positiveNumber(value: number, label: string) {
    const number = finiteNumber(value, label);
    if (!(number > 0)) throw new Error(`${label} must be greater than zero`);
    return number;
}

function nonNegativeNumber(value: number, label: string) {
    const number = finiteNumber(value, label);
    if (number < 0) throw new Error(`${label} must not be negative`);
    return number;
}
