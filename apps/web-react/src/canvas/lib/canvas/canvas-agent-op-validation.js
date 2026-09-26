/**
 * @param {import("./canvas-agent-ops").CanvasAgentSnapshot} snapshot
 * @param {import("./canvas-agent-ops").CanvasAgentOp[]=} ops
 * @returns {{ ops: import("./canvas-agent-ops").CanvasAgentOp[], rejected: number }}
 */
export function validCanvasAgentOps(snapshot, ops) {
    /** @type {import("./canvas-agent-ops").CanvasAgentOp[]} */
    const accepted = [];
    const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const connectionsById = new Map(snapshot.connections.map((connection) => [connection.id, connection]));
    const knownConnections = new Set(snapshot.connections.map((connection) => `${connection.fromNodeId}\0${connection.toNodeId}`));
    let anonymousConnectionIndex = 0;
    const forgetConnection = (id) => {
        const connection = connectionsById.get(id);
        if (!connection) return;
        connectionsById.delete(id);
        knownConnections.delete(`${connection.fromNodeId}\0${connection.toNodeId}`);
    };
    const forgetIncidentConnections = (nodeIds) => {
        [...connectionsById].forEach(([id, connection]) => {
            if (nodeIds.has(connection.fromNodeId) || nodeIds.has(connection.toNodeId)) forgetConnection(id);
        });
    };

    for (const op of Array.isArray(ops) ? ops : []) {
        if (!op?.type) continue;
        if (op.type === "add_node") {
            const id = cleanId(op.id);
            if (id && knownNodeIds.has(id)) continue;
            if (id) knownNodeIds.add(id);
            accepted.push({ ...op, ...(id ? { id } : {}) });
            continue;
        }
        if (op.type === "update_node" || op.type === "resize_node" || op.type === "run_generation") {
            const id = cleanId("id" in op ? op.id : op.nodeId);
            if (!knownNodeIds.has(id)) continue;
            if (op.type === "run_generation") accepted.push({ ...op, nodeId: id });
            else accepted.push({ ...op, id });
            continue;
        }
        if (op.type === "delete_node") {
            const ids = uniqueIds([...(op.ids || []), ...(op.id ? [op.id] : [])]).filter((id) => knownNodeIds.has(id));
            if (!ids.length) continue;
            const removed = new Set(ids);
            ids.forEach((id) => knownNodeIds.delete(id));
            forgetIncidentConnections(removed);
            accepted.push({ type: "delete_node", ids });
            continue;
        }
        if (op.type === "delete_connections") {
            const ids = uniqueIds([...(op.ids || []), ...(op.id ? [op.id] : [])]).filter((id) => connectionsById.has(id));
            if (!ids.length) continue;
            ids.forEach(forgetConnection);
            accepted.push({ type: "delete_connections", ids });
            continue;
        }
        if (op.type === "connect_nodes") {
            const fromNodeId = cleanId(op.fromNodeId || op.from);
            const toNodeId = cleanId(op.toNodeId || op.to);
            const signature = `${fromNodeId}\0${toNodeId}`;
            if (!knownNodeIds.has(fromNodeId) || !knownNodeIds.has(toNodeId) || fromNodeId === toNodeId || knownConnections.has(signature)) continue;
            const id = cleanId(op.id);
            if (id && connectionsById.has(id)) continue;
            knownConnections.add(signature);
            connectionsById.set(id || `\0anonymous:${anonymousConnectionIndex++}`, { id, fromNodeId, toNodeId });
            accepted.push({ type: "connect_nodes", ...(id ? { id } : {}), fromNodeId, toNodeId });
            continue;
        }
        if (op.type === "select_nodes") {
            const requested = uniqueIds(op.ids || []);
            const ids = requested.filter((id) => knownNodeIds.has(id));
            if (requested.length && !ids.length) continue;
            accepted.push({ type: "select_nodes", ids });
            continue;
        }
        if (op.type === "move_nodes") {
            const items = (op.items || [])
                .filter((item) => knownNodeIds.has(cleanId(item?.id)) && hasFiniteMove(item))
                .map((item) => ({ ...item, id: cleanId(item.id) }));
            if (!items.length) continue;
            accepted.push({ type: "move_nodes", items });
            continue;
        }
        if (op.type === "arrange_nodes") {
            if (!knownNodeIds.size || (op.scope === "selection" && !snapshot.selectedNodeIds.some((id) => knownNodeIds.has(id)))) continue;
            const scope = op.scope === "selection" ? "selection" : op.scope === "workflow" ? "workflow" : "all";
            const workflowId = cleanId(op.workflowId);
            if (scope === "workflow" && !workflowId) continue;
            accepted.push({ type: "arrange_nodes", scope, ...(scope === "workflow" ? { workflowId } : {}), direction: op.direction === "TB" ? "TB" : "LR" });
            continue;
        }
        if (op.type === "create_graph") {
            const keys = (op.nodes || []).map((node) => cleanId(node?.key));
            if (!keys.length || keys.some((key) => !key) || new Set(keys).size !== keys.length) continue;
            accepted.push(op);
            continue;
        }
        if (op.type === "set_viewport") {
            if (!isFiniteViewport(op.viewport)) continue;
            accepted.push(op);
            continue;
        }
        if (op.type === "create_generation_flow") accepted.push(op);
    }
    return { ops: accepted, rejected: Math.max(0, (ops?.length || 0) - accepted.length) };
}

function cleanId(value) {
    return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values) {
    return [...new Set(values.map(cleanId).filter(Boolean))];
}

function hasFiniteMove(item) {
    return [item.x, item.y, item.dx, item.dy].some((value) => typeof value === "number" && Number.isFinite(value));
}

function isFiniteViewport(value) {
    return Boolean(value && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && typeof value.k === "number" && Number.isFinite(value.k) && value.k > 0);
}
