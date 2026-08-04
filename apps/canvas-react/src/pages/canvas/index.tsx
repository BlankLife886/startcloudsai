import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App, Button } from "antd";
import { ArrowUp, ArrowUpRight, Download, FileText, FileUp, ImagePlus, Images, Plus, Sparkles, Trash2, Video } from "lucide-react";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType } from "@/types/canvas";

export default function CanvasPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [draftPrompt, setDraftPrompt] = useState("");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = () => enterProject(createProject(`无限画布 ${projects.length + 1}`));
    const createFromPrompt = () => {
        const prompt = draftPrompt.trim();
        if (!prompt) return;
        const title = prompt.length > 22 ? `${prompt.slice(0, 22)}...` : prompt;
        const id = createProject(title);
        const configNode = createCanvasNode(CanvasNodeType.Config, { x: 0, y: 0 }, { composerContent: prompt, prompt, generationMode: "image" });
        updateProject(id, { nodes: [configNode] });
        enterProject(id);
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(`无限画布 ${projects.length + 1}`) : projects[0]?.id || createProject(`无限画布 ${projects.length + 1}`));
    }, [createProject, hydrated, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <main className="canvas-home-pattern h-full overflow-auto text-stone-950 dark:text-stone-100">
            <div className="relative z-[2] mx-auto flex w-full max-w-[1560px] flex-col px-7 pb-12 pt-8">
                <section className="mx-auto w-full max-w-6xl text-center">
                    <h1 className="text-2xl font-semibold leading-8">今天想在无限画布创作什么？</h1>
                    <div className="canvas-liquid-glass mt-5 min-h-[152px] rounded-lg p-4 text-left">
                        <textarea
                            value={draftPrompt}
                            onChange={(event) => setDraftPrompt(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    createFromPrompt();
                                }
                            }}
                            className="h-[68px] w-full resize-none bg-transparent px-1 text-base leading-6 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed"
                            placeholder="描述你的创作想法"
                            aria-label="画布创作需求"
                            disabled={!hydrated}
                        />
                        <div className="mt-3 flex items-center gap-2 border-t border-stone-100 pt-3 dark:border-white/10">
                            <span className="flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-xs font-medium text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-300">
                                <Sparkles className="size-3.5" />
                                智能画布
                            </span>
                            <button type="button" className="h-8 rounded-lg px-2.5 text-xs text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10" onClick={() => navigate("/prompts")}>
                                提示词库
                            </button>
                            <button type="button" className="h-8 rounded-lg px-2.5 text-xs text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10" onClick={() => navigate("/assets")}>
                                我的资产
                            </button>
                            <button
                                type="button"
                                className="ml-auto grid size-9 place-items-center rounded-full bg-stone-900 text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-white dark:text-stone-950 dark:hover:bg-violet-300 dark:disabled:bg-white/10 dark:disabled:text-stone-600"
                                onClick={createFromPrompt}
                                disabled={!hydrated || !draftPrompt.trim()}
                                aria-label="创建画布"
                            >
                                <ArrowUp className="size-4" />
                            </button>
                        </div>
                    </div>
                </section>

                <section className="mt-8">
                    <h2 className="text-sm font-semibold">快速开始</h2>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                        {[
                            { title: "空白画布", meta: "自由创作", icon: Sparkles, image: `${import.meta.env.BASE_URL}quick-start/canvas.webp`, action: createAndEnter },
                            { title: "AI 图片创作", meta: "图片工作台", icon: ImagePlus, image: `${import.meta.env.BASE_URL}quick-start/image.webp`, action: () => navigate("/image") },
                            { title: "视频创作", meta: "视频工作台", icon: Video, image: `${import.meta.env.BASE_URL}quick-start/video.webp`, action: () => navigate("/video") },
                            { title: "提示词库", meta: "创作灵感", icon: FileText, image: `${import.meta.env.BASE_URL}quick-start/prompts.webp`, action: () => navigate("/prompts") },
                            { title: "我的资产", meta: "素材管理", icon: Images, image: `${import.meta.env.BASE_URL}quick-start/assets.webp`, action: () => navigate("/assets") },
                        ].map((item) => {
                            const Icon = item.icon;
                            return (
                                <button key={item.title} type="button" className="canvas-quick-start-card group relative aspect-[3/2] min-w-0 text-left sm:aspect-[2/1]" onClick={item.action} disabled={!hydrated}>
                                    <span className="canvas-quick-start-card__surface absolute inset-0 overflow-hidden">
                                        <img src={item.image} alt="" className="absolute inset-0 size-full object-cover opacity-90 transition-opacity duration-300 group-hover:opacity-100" decoding="async" />
                                        <span className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full border border-white/25 bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                                            <ArrowUpRight className="size-3.5" />
                                        </span>
                                        <span className="pointer-events-none absolute inset-0 flex items-end gap-2.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-12 text-white sm:pb-3 sm:pt-16">
                                            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/10">
                                                <Icon className="size-4" />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold">{item.title}</span>
                                                <span className="mt-0.5 block truncate text-xs text-white/65">{item.meta}</span>
                                            </span>
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <div className="mt-9 flex min-h-10 items-center gap-2 border-b border-stone-200 pb-3 dark:border-white/10">
                    <span className="text-sm font-semibold">最近项目</span>
                    <span className="text-xs text-stone-400">{projects.length}</span>
                    <div className="ml-auto flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <span className="mr-1 text-xs text-stone-500 dark:text-stone-400">已选择 {selectedIds.length} 个</span>
                                <Button
                                    size="small"
                                    disabled={!hydrated}
                                    icon={<Download className="size-3.5" />}
                                    onClick={() =>
                                        void exportCanvasProjects(
                                            projects.filter((project) => selectedIds.includes(project.id)),
                                            `无限画布-${selectedIds.length}个项目`,
                                        )
                                    }
                                >
                                    导出
                                </Button>
                                <Button size="small" danger disabled={!hydrated} icon={<Trash2 className="size-3.5" />} onClick={() => setDeleteIds(selectedIds)}>
                                    删除
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button size="small" type="text" disabled={!hydrated} icon={<FileUp className="size-3.5" />} onClick={() => inputRef.current?.click()}>
                                    导入画布
                                </Button>
                                {projects.length ? (
                                    <Button
                                        size="small"
                                        type="text"
                                        shape="circle"
                                        danger
                                        disabled={!hydrated}
                                        icon={<Trash2 className="size-3.5" />}
                                        onClick={() => setDeleteIds(projects.map((project) => project.id))}
                                        aria-label="删除全部"
                                        title="删除全部"
                                    />
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {!hydrated ? (
                    <section className="mt-4 flex min-h-52 items-center justify-center rounded-lg border border-dashed border-stone-200 bg-white text-sm text-stone-500 dark:border-white/10 dark:bg-white/[0.03]">正在加载画布...</section>
                ) : (
                    <div className="mt-4 grid grid-cols-5 gap-x-3 gap-y-7">
                        <button type="button" className="group min-w-0 rounded-lg text-left outline-none" onClick={createAndEnter}>
                            <span className="canvas-liquid-glass flex aspect-video items-center justify-center rounded-lg transition group-hover:-translate-y-px">
                                <span className="grid size-10 place-items-center rounded-lg border border-stone-200 bg-white text-stone-500 shadow-sm transition group-hover:border-violet-200 group-hover:text-violet-600 dark:border-white/10 dark:bg-stone-900 dark:text-stone-400 dark:group-hover:border-violet-400/30 dark:group-hover:text-violet-300">
                                    <Plus className="size-5" />
                                </span>
                            </span>
                            <span className="block px-1 pb-1 pt-3">
                                <span className="block text-sm font-semibold leading-5">新建画布</span>
                                <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">从空白画布开始创作</span>
                            </span>
                        </button>
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
