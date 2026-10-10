import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// Canvas groups: a frame node (type "group") plus members that point at it through metadata.groupId.
// Everything here is pure so the canvas page can apply it inside setNodes and tests can exercise it directly.

export const GROUP_PADDING = 32;
export const GROUP_HEADER = 44;
export const GROUP_COLLAPSED_SIZE = { width: 280, height: 132 };

export const GROUP_COLORS = [
    { key: "violet", color: "#7c6cf0" },
    { key: "blue", color: "#3d7bff" },
    { key: "teal", color: "#14a37f" },
    { key: "amber", color: "#e0901c" },
    { key: "rose", color: "#e0457b" },
    { key: "slate", color: "#6b7280" },
] as const;

export type CanvasGroupColor = (typeof GROUP_COLORS)[number]["key"];

export function groupColor(node: Pick<CanvasNodeData, "metadata">) {
    return GROUP_COLORS.find((item) => item.key === node.metadata?.groupColor)?.color || GROUP_COLORS[0].color;
}

export function nextGroupColor(current?: string): CanvasGroupColor {
    const index = GROUP_COLORS.findIndex((item) => item.key === current);
    return GROUP_COLORS[(index + 1) % GROUP_COLORS.length].key;
}

type Rect = { left: number; top: number; right: number; bottom: number };

function boundsOf(nodes: CanvasNodeData[]): Rect | null {
    if (!nodes.length) return null;
    return nodes.reduce<Rect>(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

export function groupMembers(nodes: CanvasNodeData[], groupId: string) {
    return nodes.filter((node) => node.id !== groupId && node.metadata?.groupId === groupId);
}

/** The frame that holds a set of nodes: padding on every side plus room for the header. */
function frameAround(bounds: Rect) {
    return {
        position: { x: bounds.left - GROUP_PADDING, y: bounds.top - GROUP_PADDING - GROUP_HEADER },
        width: bounds.right - bounds.left + GROUP_PADDING * 2,
        height: bounds.bottom - bounds.top + GROUP_PADDING * 2 + GROUP_HEADER,
    };
}

/**
 * Wraps the given nodes in a new group. Frames among them are left out (groups do not nest); members of other groups
 * move to the new one. Returns null when there is nothing to group.
 */
export function createGroupAround(nodes: CanvasNodeData[], ids: Iterable<string>, group: { id: string; title: string; color?: CanvasGroupColor }) {
    const idSet = new Set(ids);
    const members = nodes.filter((node) => idSet.has(node.id) && node.type !== CanvasNodeType.Group && !node.metadata?.hidden);
    const bounds = boundsOf(members);
    if (!bounds) return null;
    const frame: CanvasNodeData = {
        id: group.id,
        type: CanvasNodeType.Group,
        title: group.title,
        ...frameAround(bounds),
        metadata: { groupColor: group.color || GROUP_COLORS[0].key },
    };
    const memberIds = new Set(members.map((node) => node.id));
    // Frames are drawn behind everything else, so the new one goes first.
    return {
        group: frame,
        nodes: [frame, ...nodes.map((node) => (memberIds.has(node.id) ? { ...node, metadata: { ...node.metadata, groupId: group.id } } : node))],
    };
}

/** Removes a group frame and keeps its members where they are (restoring any it had collapsed away). */
export function dissolveGroup(nodes: CanvasNodeData[], groupId: string) {
    return nodes
        .filter((node) => node.id !== groupId)
        .map((node) => {
            if (node.metadata?.groupId !== groupId && node.metadata?.collapsedIntoGroupId !== groupId) return node;
            const collapsed = node.metadata?.collapsedIntoGroupId === groupId;
            return { ...node, metadata: { ...node.metadata, groupId: undefined, ...(collapsed ? { hidden: undefined, collapsedIntoGroupId: undefined } : {}) } };
        });
}

/** Snaps a group frame to exactly fit its members. */
export function fitGroupToMembers(nodes: CanvasNodeData[], groupId: string) {
    const bounds = boundsOf(groupMembers(nodes, groupId).filter((node) => !node.metadata?.hidden));
    if (!bounds) return nodes;
    const frame = frameAround(bounds);
    return nodes.map((node) => (node.id === groupId ? { ...node, ...frame } : node));
}

/**
 * Grows every expanded group whose members stick out of it, so moving or enlarging a member never leaves it half
 * outside its frame. Groups only grow here; "fit" tightens them on request. Returns the same array when nothing moved.
 */
export function growGroupsToFit(nodes: CanvasNodeData[]) {
    const membersByGroup = new Map<string, CanvasNodeData[]>();
    nodes.forEach((node) => {
        const groupId = node.metadata?.groupId;
        if (!groupId || node.metadata?.hidden) return;
        membersByGroup.set(groupId, [...(membersByGroup.get(groupId) || []), node]);
    });
    let changed = false;
    const next = nodes.map((node) => {
        if (node.type !== CanvasNodeType.Group || node.metadata?.groupCollapsed) return node;
        const bounds = boundsOf(membersByGroup.get(node.id) || []);
        if (!bounds) return node;
        const left = Math.min(node.position.x, bounds.left - GROUP_PADDING);
        const top = Math.min(node.position.y, bounds.top - GROUP_PADDING - GROUP_HEADER);
        const right = Math.max(node.position.x + node.width, bounds.right + GROUP_PADDING);
        const bottom = Math.max(node.position.y + node.height, bounds.bottom + GROUP_PADDING);
        if (left === node.position.x && top === node.position.y && right === node.position.x + node.width && bottom === node.position.y + node.height) return node;
        changed = true;
        return { ...node, position: { x: left, y: top }, width: right - left, height: bottom - top };
    });
    return changed ? next : nodes;
}

/** Collapses a group into a small card: its members are hidden (and remembered) and its frame shrinks in place. */
export function collapseGroup(nodes: CanvasNodeData[], groupId: string) {
    const group = nodes.find((node) => node.id === groupId);
    if (!group || group.metadata?.groupCollapsed) return nodes;
    return nodes.map((node) => {
        if (node.id === groupId) return { ...node, ...GROUP_COLLAPSED_SIZE, metadata: { ...node.metadata, groupCollapsed: true, groupExpandedSize: { width: node.width, height: node.height } } };
        // Nodes hidden for other reasons stay out of the group's bookkeeping, so expanding never reveals them.
        if (node.metadata?.groupId !== groupId || node.metadata?.hidden) return node;
        return { ...node, metadata: { ...node.metadata, hidden: true, collapsedIntoGroupId: groupId } };
    });
}

export function expandGroup(nodes: CanvasNodeData[], groupId: string) {
    const group = nodes.find((node) => node.id === groupId);
    if (!group || !group.metadata?.groupCollapsed) return nodes;
    const size = group.metadata.groupExpandedSize;
    return nodes.map((node) => {
        if (node.id === groupId) return { ...node, width: size?.width || node.width, height: size?.height || node.height, metadata: { ...node.metadata, groupCollapsed: undefined, groupExpandedSize: undefined } };
        if (node.metadata?.collapsedIntoGroupId !== groupId) return node;
        return { ...node, metadata: { ...node.metadata, hidden: undefined, collapsedIntoGroupId: undefined } };
    });
}

export type CanvasGroupSummary = { total: number; done: number; failed: number; running: number; thumbnails: string[]; configIds: string[]; mediaIds: string[] };

/** What a group holds, for its header and its toolbar. */
export function summarizeGroups(nodes: CanvasNodeData[]) {
    const summaries = new Map<string, CanvasGroupSummary>();
    nodes.forEach((node) => {
        const groupId = node.metadata?.groupId;
        if (!groupId || node.type === CanvasNodeType.Group) return;
        const summary = summaries.get(groupId) || { total: 0, done: 0, failed: 0, running: 0, thumbnails: [], configIds: [], mediaIds: [] };
        summary.total += 1;
        const status = node.metadata?.status;
        const execution = node.metadata?.executionStatus;
        if (status === "error" || execution === "failed") summary.failed += 1;
        else if (status === "loading" || execution === "running" || execution === "queued") summary.running += 1;
        else if (status === "success" || execution === "succeeded") summary.done += 1;
        if (node.type === "config" || node.metadata?.generationMode) summary.configIds.push(node.id);
        if ((node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && (node.metadata?.content || node.metadata?.storageKey)) summary.mediaIds.push(node.id);
        const thumbnail = node.type === CanvasNodeType.Image ? node.metadata?.thumbnailUrl || (node.metadata?.images?.find((image) => image.id === node.metadata?.primaryImageId) || node.metadata?.images?.[0])?.thumbnailUrl : undefined;
        if (thumbnail && summary.thumbnails.length < 6) summary.thumbnails.push(thumbnail);
        summaries.set(groupId, summary);
    });
    return summaries;
}
