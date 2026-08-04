import { ArrowUpRight, Check, Download, Layers3, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { cn } from "@/lib/utils";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const PREVIEW_PADDING_X = 64;
const PREVIEW_PADDING_Y = 56;

const nodeColors: Record<string, { fill: string; stroke: string; accent: string }> = {
    image: { fill: "#f5f3ff", stroke: "#a78bfa", accent: "#7c3aed" },
    text: { fill: "#eff6ff", stroke: "#93c5fd", accent: "#2563eb" },
    config: { fill: "#f8fafc", stroke: "#94a3b8", accent: "#475569" },
    video: { fill: "#fff7ed", stroke: "#fdba74", accent: "#ea580c" },
    audio: { fill: "#ecfdf5", stroke: "#6ee7b7", accent: "#059669" },
    group: { fill: "#fdf2f8", stroke: "#f9a8d4", accent: "#db2777" },
};

function CanvasTopologyPreview({ project }: { project: CanvasProject }) {
    if (!project.nodes.length) {
        return (
            <div className="flex h-full flex-col items-center justify-center text-stone-400 dark:text-stone-500">
                <span className="grid size-11 place-items-center rounded-lg border border-stone-200 bg-white/80 shadow-sm dark:border-white/10 dark:bg-stone-900/80">
                    <Layers3 className="size-5" />
                </span>
                <span className="mt-3 text-xs font-medium">空白画布</span>
            </div>
        );
    }

    const bounds = project.nodes.reduce(
        (result, node) => ({
            minX: Math.min(result.minX, node.position.x),
            minY: Math.min(result.minY, node.position.y),
            maxX: Math.max(result.maxX, node.position.x + node.width),
            maxY: Math.max(result.maxY, node.position.y + node.height),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = Math.min((PREVIEW_WIDTH - PREVIEW_PADDING_X * 2) / contentWidth, (PREVIEW_HEIGHT - PREVIEW_PADDING_Y * 2) / contentHeight);
    const offsetX = (PREVIEW_WIDTH - contentWidth * scale) / 2;
    const offsetY = (PREVIEW_HEIGHT - contentHeight * scale) / 2;
    const previewNodes = project.nodes.map((node) => {
        const width = Math.min(Math.max(node.width * scale, 54), 128);
        const height = Math.min(Math.max(node.height * scale, 28), 62);
        const centerX = offsetX + (node.position.x - bounds.minX + node.width / 2) * scale;
        const centerY = offsetY + (node.position.y - bounds.minY + node.height / 2) * scale;
        return {
            ...node,
            previewX: Math.min(Math.max(centerX - width / 2, 18), PREVIEW_WIDTH - width - 18),
            previewY: Math.min(Math.max(centerY - height / 2, 16), PREVIEW_HEIGHT - height - 16),
            previewWidth: width,
            previewHeight: height,
        };
    });
    const nodeMap = new Map(previewNodes.map((node) => [node.id, node]));

    return (
        <svg className="h-full w-full" viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`} role="img" aria-label={`${project.title} 节点拓扑预览`}>
            <defs>
                <filter id={`preview-shadow-${project.id}`} x="-20%" y="-30%" width="140%" height="170%">
                    <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#1c1917" floodOpacity="0.08" />
                </filter>
            </defs>
            {project.connections.map((connection) => {
                const from = nodeMap.get(connection.fromNodeId);
                const to = nodeMap.get(connection.toNodeId);
                if (!from || !to) return null;
                const x1 = from.previewX + from.previewWidth / 2;
                const y1 = from.previewY + from.previewHeight / 2;
                const x2 = to.previewX + to.previewWidth / 2;
                const y2 = to.previewY + to.previewHeight / 2;
                const bend = Math.max(Math.abs(x2 - x1) * 0.42, 34);
                return <path key={connection.id} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-300/90 dark:text-violet-400/45" />;
            })}
            {previewNodes.map((node) => {
                const colors = nodeColors[node.type] ?? nodeColors.config;
                const labelLength = Math.max(Math.floor((node.previewWidth - 28) / 8), 3);
                const label = node.title.length > labelLength ? `${node.title.slice(0, labelLength)}...` : node.title;
                return (
                    <g key={node.id} filter={`url(#preview-shadow-${project.id})`}>
                        <rect x={node.previewX} y={node.previewY} width={node.previewWidth} height={node.previewHeight} rx="7" fill={colors.fill} stroke={colors.stroke} strokeWidth="1.5" />
                        <rect x={node.previewX} y={node.previewY} width="5" height={node.previewHeight} rx="2.5" fill={colors.accent} />
                        {node.previewWidth >= 72 ? (
                            <text x={node.previewX + 16} y={node.previewY + node.previewHeight / 2 + 4} fill="#44403c" fontSize="12" fontWeight="600">
                                {label}
                            </text>
                        ) : null}
                    </g>
                );
            })}
        </svg>
    );
}

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article className={cn("group min-w-0 rounded-lg outline-none transition", selected && "rounded-lg bg-violet-50/70 ring-2 ring-violet-500/20 dark:bg-violet-500/[0.07]")}>
            <div className="canvas-liquid-glass relative aspect-video cursor-pointer overflow-hidden rounded-lg transition group-hover:-translate-y-px" onClick={() => !editing && open()}>
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className={cn("absolute left-3 top-3 z-10 size-4 accent-violet-600 transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    aria-label={`选择 ${project.title}`}
                />
                <div
                    className="absolute right-2.5 top-2.5 z-10 flex translate-y-1 items-center gap-1 rounded-lg border border-white/40 bg-white/85 p-1 opacity-0 shadow-sm backdrop-blur-md transition group-hover:translate-y-0 group-hover:opacity-100 dark:border-white/10 dark:bg-stone-950/80"
                    onClick={(event) => event.stopPropagation()}
                >
                    <Button type="text" size="small" shape="circle" icon={<Download className="size-3.5" />} onClick={() => void exportCanvasProjects([project], project.title || "无限画布")} aria-label="导出" />
                    <Button type="text" size="small" shape="circle" icon={<Pencil className="size-3.5" />} onClick={() => startEditing(project.id, project.title)} aria-label="重命名" />
                    <Button type="text" size="small" shape="circle" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleteIds([project.id])} aria-label="删除" />
                </div>
                <CanvasTopologyPreview project={project} />
            </div>

            <div className="px-1 pb-1 pt-3">
                <div className="flex min-h-11 items-start gap-2">
                    {editing ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                            <Input
                                className="min-w-0"
                                size="small"
                                value={editingTitle}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onKeyDown={(event) => event.key === "Enter" && saveTitle()}
                                autoFocus
                            />
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-3.5" />} onClick={saveTitle} aria-label="保存名称" />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-3.5" />} onClick={stopEditing} aria-label="取消重命名" />
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-2 text-left"
                            onClick={(event) => {
                                event.stopPropagation();
                                open();
                            }}
                        >
                            <span className="min-w-0">
                                <h2 className="truncate text-sm font-semibold leading-5">{project.title}</h2>
                                <span className="mt-1 block truncate text-xs text-stone-500 dark:text-stone-400">
                                    画布 · {project.nodes.length} 个节点 · {project.connections.length} 条连线 · {new Date(project.updatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} 修改
                                </span>
                            </span>
                            <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-stone-400 opacity-0 transition group-hover:opacity-100" />
                        </button>
                    )}
                </div>
            </div>
        </article>
    );
}
