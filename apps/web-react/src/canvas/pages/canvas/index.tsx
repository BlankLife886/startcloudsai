import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App, Button } from "antd";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { FileUp, LayoutTemplate, Plus, Search, Trash2, X } from "lucide-react";
import { DownloadIcon } from "@react/components/common/DownloadIcon.jsx";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useCanvasHost } from "@/components/layout/canvas-host-context";
import { CanvasWorkflowTemplateDialog } from "@/components/canvas/canvas-workflow-template-dialog";
import { createCanvasProjectFromUploadedTemplate, getCanvasWorkflowTemplate, type CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";

gsap.registerPlugin(useGSAP);

function canvasMotionDisabled() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("settings-no-animations");
}

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isAuthenticated, requestAuth } = useCanvasHost();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const pageRef = useRef<HTMLElement>(null);
    const autoOpenRef = useRef(false);
    const [entryState, setEntryState] = useState("waiting");
    const [cardEntryState, setCardEntryState] = useState("waiting");
    const [projectQuery, setProjectQuery] = useState("");
    const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const visibleProjects = useMemo(() => (isAuthenticated ? projects : []), [isAuthenticated, projects]);
    const filteredProjects = useMemo(() => {
        const query = projectQuery.trim().toLowerCase();
        if (!query) return visibleProjects;
        return visibleProjects.filter((project) => project.title.toLowerCase().includes(query) || (project.nodes || []).some((node) => (node.title || "").toLowerCase().includes(query)));
    }, [projectQuery, visibleProjects]);
    const visibleSelectedIds = useMemo(() => selectedIds.filter((id) => filteredProjects.some((project) => project.id === id)), [filteredProjects, selectedIds]);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";

    useGSAP(
        (context, contextSafe) => {
            const root = pageRef.current;
            if (!root) return;
            const targets = gsap.utils.toArray<HTMLElement>("[data-canvas-entry-item]", root);
            if (canvasMotionDisabled()) {
                gsap.set(targets, { clearProps: "opacity,visibility,transform" });
                setEntryState("entered");
                return;
            }
            setEntryState("entering");
            const finish = (contextSafe || ((callback) => callback))(() => setEntryState("entered"));
            gsap.fromTo(
                targets,
                { autoAlpha: 0, y: 10 },
                {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.32,
                    stagger: 0.05,
                    ease: "power2.out",
                    clearProps: "opacity,visibility,transform",
                    onComplete: finish,
                },
            );
        },
        { scope: pageRef },
    );

    useGSAP(
        (context, contextSafe) => {
            const root = pageRef.current;
            if (!root || !hydrated) return;
            const cards = gsap.utils.toArray<HTMLElement>(".canvas-project-grid > *", root);
            if (canvasMotionDisabled()) {
                gsap.set(cards, { clearProps: "opacity,visibility,transform" });
                setCardEntryState("entered");
                return;
            }
            setCardEntryState("entering");
            const finish = (contextSafe || ((callback) => callback))(() => setCardEntryState("entered"));
            gsap.fromTo(
                cards,
                { autoAlpha: 0, y: 8 },
                {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.28,
                    stagger: { each: 0.04, from: "start" },
                    ease: "power2.out",
                    clearProps: "opacity,visibility,transform",
                    onComplete: finish,
                },
            );
        },
        { dependencies: [hydrated, visibleProjects.length], scope: pageRef, revertOnUpdate: true },
    );
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = () => {
        if (!isAuthenticated) {
            requestAuth();
            return;
        }
        enterProject(createProject(t("canvas.defaultTitle", { count: visibleProjects.length + 1 })));
    };
    const useWorkflowTemplate = async (template: CanvasWorkflowTemplateSummary) => {
        if (!isAuthenticated) {
            requestAuth();
            return;
        }
        try {
            const detail = await getCanvasWorkflowTemplate(template.id);
            const id = importProject(createCanvasProjectFromUploadedTemplate(detail));
            setTemplateLibraryOpen(false);
            message.success(`已创建「${template.title}」`);
            enterProject(id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板创建失败");
        }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        if (!isAuthenticated) {
            requestAuth();
            if (inputRef.current) inputRef.current.value = "";
            return;
        }
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
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        if (!isAuthenticated) {
            requestAuth();
            navigate("/canvas", { replace: true });
            return;
        }
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: visibleProjects.length + 1 })) : visibleProjects[0]?.id || createProject(t("canvas.defaultTitle", { count: visibleProjects.length + 1 })));
    }, [createProject, hydrated, isAuthenticated, mode, navigate, requestAuth, t, visibleProjects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main
            ref={pageRef}
            className="canvas-home-pattern h-full overflow-auto text-stone-950 dark:text-stone-100"
            data-canvas-home-motion-state={entryState}
            data-canvas-card-motion-state={cardEntryState}
        >
            <div className="canvas-home-pattern__inner relative z-[2] mx-auto flex h-full w-full max-w-[1560px] flex-col px-7">
                <header data-canvas-entry-item className="canvas-home-toolbar">
                    <div className="canvas-home-toolbar__copy">
                        <h1>{t("canvas.title")}</h1>
                        <p>{t("canvas.createDescription")}</p>
                    </div>
                    <div className="canvas-home-toolbar__actions">
                        <Button className="canvas-home-cta" type="primary" disabled={!hydrated} onClick={createAndEnter} icon={<Plus className="size-4" />}>
                            {t("canvas.create")}
                        </Button>
                        <Button disabled={!hydrated} onClick={() => setTemplateLibraryOpen(true)} icon={<LayoutTemplate className="size-4" />}>
                            {t("canvas.templateLibrary")}
                        </Button>
                        <Button disabled={!hydrated} onClick={() => (isAuthenticated ? inputRef.current?.click() : requestAuth())} icon={<FileUp className="size-4" />}>
                            {t("canvas.import")}
                        </Button>
                    </div>
                </header>

                <section data-canvas-entry-item className="canvas-home-library">
                    {hydrated && !visibleProjects.length && !projectQuery.trim() ? null : <div className="canvas-recent-bar">
                        <div className="flex shrink-0 items-baseline gap-3">
                            <h2 className="text-[15px] font-semibold tracking-tight">{t("canvas.recent")}</h2>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-violet-500/10 px-2 text-xs font-medium tabular-nums text-violet-700 dark:bg-violet-400/10 dark:text-violet-300">
                                {projectQuery.trim() ? filteredProjects.length : visibleProjects.length}
                            </span>
                        </div>
                        <div className="canvas-recent-bar__tools">
                            {visibleProjects.length ? (
                                <label className="canvas-home-search">
                                    <span className="canvas-home-search__icon">
                                        <Search className="size-3.5" />
                                    </span>
                                    <input
                                        type="search"
                                        value={projectQuery}
                                        onChange={(event) => setProjectQuery(event.target.value)}
                                        placeholder={t("canvas.searchProjects")}
                                        aria-label={t("canvas.searchProjects")}
                                    />
                                    {projectQuery ? (
                                        <button type="button" className="canvas-home-search__clear" onClick={() => setProjectQuery("")} aria-label={t("canvas.clearSearch")}>
                                            <X className="size-3" />
                                        </button>
                                    ) : null}
                                </label>
                            ) : null}
                            {visibleSelectedIds.length ? (
                                <>
                                    <span className="text-xs text-stone-500 dark:text-stone-400">{t("canvas.selected", { count: visibleSelectedIds.length })}</span>
                                    <button
                                        type="button"
                                        className="canvas-home-btn"
                                        disabled={!hydrated}
                                        onClick={() =>
                                            void exportCanvasProjects(
                                                visibleProjects.filter((project) => visibleSelectedIds.includes(project.id)),
                                                `无限画布-${visibleSelectedIds.length}个项目`,
                                            )
                                        }
                                    >
                                        <span className="canvas-home-btn__icon">
                                            <DownloadIcon className="size-3.5" />
                                        </span>
                                        {t("canvas.exportSelected")}
                                    </button>
                                    <button type="button" className="canvas-home-btn is-danger" disabled={!hydrated} onClick={() => setDeleteIds(visibleSelectedIds)} aria-label={t("canvas.deleteSelected")}>
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </>
                            ) : visibleProjects.length ? (
                                <button type="button" className="canvas-home-btn is-danger" disabled={!hydrated} onClick={() => setDeleteIds(visibleProjects.map((project) => project.id))} aria-label={t("canvas.deleteAll")} title={t("canvas.deleteAll")}>
                                    <Trash2 className="size-3.5" />
                                </button>
                            ) : null}
                        </div>
                    </div>}

                    {!hydrated ? (
                        <div className="mt-5 flex min-h-52 items-center justify-center rounded-[18px] border border-dashed border-stone-200 bg-white/70 text-sm text-stone-500 dark:border-white/10 dark:bg-white/[0.03]">{t("canvas.loading")}</div>
                    ) : projectQuery.trim() && !filteredProjects.length ? (
                        <div className="mt-5 flex min-h-40 items-center justify-center rounded-[18px] border border-dashed border-stone-200 bg-white/70 text-sm text-stone-500 dark:border-white/10 dark:bg-white/[0.03]">{t("canvas.noMatchingProjects")}</div>
                    ) : !filteredProjects.length ? (
                        <button type="button" className="canvas-home-start" onClick={createAndEnter}>
                            <span className="canvas-project-tile__plus">
                                <Plus className="size-5" />
                            </span>
                            <strong>{t("canvas.create")}</strong>
                            <span>{t("canvas.createDescription")}</span>
                        </button>
                    ) : (
                        <div className="canvas-project-grid mt-4 grid grid-cols-6 gap-3">
                            {projectQuery.trim() ? null : (
                                <button type="button" className="canvas-project-tile group text-left" onClick={createAndEnter}>
                                    <span className="canvas-project-tile__preview is-create flex items-center justify-center">
                                        <span className="canvas-project-tile__plus">
                                            <Plus className="size-4" />
                                        </span>
                                    </span>
                                    <span className="canvas-project-tile__body">
                                        <span className="block truncate text-[13px] font-semibold leading-4">{t("canvas.create")}</span>
                                        <span className="canvas-project-tile__pills">
                                            <span className="canvas-project-tile__pill">{t("canvas.createDescription")}</span>
                                        </span>
                                    </span>
                                </button>
                            )}
                            {filteredProjects.map((project) => (
                                <CanvasProjectCard key={project.id} project={project} />
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasWorkflowTemplateDialog open={templateLibraryOpen} onClose={() => setTemplateLibraryOpen(false)} onUse={useWorkflowTemplate} />
        </main>
    );
}
