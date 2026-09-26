import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App } from "antd";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import { ensureCanvasProjectDocument, pendingCloudProjectDeleteCount, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useCanvasHost } from "@/components/layout/canvas-host-context";
import { createCanvasProjectFromUploadedTemplate, getCanvasWorkflowTemplate, listCanvasWorkflowTemplates, type CanvasWorkflowTemplateSummary } from "@/services/canvas-workflow-template-api";
import { canvasProjectOccupancy, checkCanvasProjectCapacity } from "@/lib/canvas/canvas-project-quota";
import { fetchCanvasProjectQuota, type CanvasProjectQuota } from "@/services/canvas-cloud-repository";
import { CanvasHomeRail, type CanvasHomeRailTarget } from "@/components/canvas/home/canvas-home-rail";
import { CanvasHomeHero } from "@/components/canvas/home/canvas-home-hero";
import { CanvasHomeTemplates, templateCategories } from "@/components/canvas/home/canvas-home-templates";
import { CanvasHomeLibrary } from "@/components/canvas/home/canvas-home-library";
import { CanvasHomeRecentCard, type CanvasHomeProjectActions } from "@/components/canvas/home/canvas-home-project-card";
import { CanvasCommandPalette, CanvasLaunchOverlay, CanvasTemplatePreview } from "@/components/canvas/home/canvas-home-overlays";
import { CanvasHomePageHead, canvasHomeMotionDisabled, categoryColor, useCanvasHomeColumns } from "@/components/canvas/home/canvas-home-shared";
import "@/components/canvas/home/canvas-home.css";

const LAUNCH_DELAY_MS = 420;

type CanvasHomeView = "home" | "library" | "templates";

type LaunchState = { x: number; y: number; title: string } | null;

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isAuthenticated, requestAuth } = useCanvasHost();
    const [searchParams, setSearchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const autoOpenRef = useRef(false);
    const launchTimerRef = useRef(0);
    const [projectQuota, setProjectQuota] = useState<CanvasProjectQuota | null>(null);
    const [templates, setTemplates] = useState<CanvasWorkflowTemplateSummary[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [templatesError, setTemplatesError] = useState("");
    const [templateCategory, setTemplateCategory] = useState("all");
    const [previewTemplate, setPreviewTemplate] = useState<CanvasWorkflowTemplateSummary | null>(null);
    const [usingTemplate, setUsingTemplate] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [launch, setLaunch] = useState<LaunchState>(null);
    const recentCount = useCanvasHomeColumns();
    const cloudProjectsVersion = useCanvasStore((state) => state.cloudProjectsVersion);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const visibleProjects = useMemo(() => (isAuthenticated ? projects : []), [isAuthenticated, projects]);
    const recentProjects = useMemo(() => [...visibleProjects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [visibleProjects]);

    const mode = searchParams.get("mode");
    // 不能用 view 参数：CanvasEntryGate 把它当旧版入口链接重定向。
    const tabParam = searchParams.get("tab");
    const view: CanvasHomeView = tabParam === "library" || tabParam === "templates" ? tabParam : "home";
    const agentQuery = useMemo(() => {
        if (mode !== "new" && mode !== "recent" && mode !== "choose") return "";
        const params = new URLSearchParams(searchParams);
        params.delete("tab");
        return `?${params.toString()}`;
    }, [mode, searchParams]);

    const unsyncedProjectCount = useCanvasStore((state) => state.projects.filter((project) => !project.revision).length);
    const occupiedProjects = projectQuota ? canvasProjectOccupancy(projectQuota, unsyncedProjectCount, pendingCloudProjectDeleteCount()) : 0;
    const quota = projectQuota ? { used: occupiedProjects, limit: projectQuota.limit, planBonus: projectQuota.planBonus, base: projectQuota.base } : null;
    const quotaFull = Boolean(quota && quota.used >= quota.limit);
    const categoryIds = useMemo(() => templateCategories(templates).map((item) => item.id), [templates]);

    const setView = useCallback(
        (next: CanvasHomeView) => {
            setSearchParams(
                (current) => {
                    const params = new URLSearchParams(current);
                    if (next === "home") params.delete("tab");
                    else params.set("tab", next);
                    return params;
                },
                { replace: false },
            );
            mainRef.current?.scrollTo({ top: 0 });
        },
        [setSearchParams],
    );

    const enterProject = useCallback((id: string) => navigate(`/canvas/${id}${agentQuery}`), [agentQuery, navigate]);

    // 从点击位置展开的过渡后再进入画布；减少动态效果时直接进入。
    const launchProject = useCallback(
        (id: string, title: string, event?: ReactMouseEvent) => {
            if (canvasHomeMotionDisabled()) {
                enterProject(id);
                return;
            }
            window.clearTimeout(launchTimerRef.current);
            setLaunch({ x: event?.clientX ?? window.innerWidth / 2, y: event?.clientY ?? window.innerHeight * 0.55, title });
            launchTimerRef.current = window.setTimeout(() => enterProject(id), LAUNCH_DELAY_MS);
        },
        [enterProject],
    );
    useEffect(() => () => window.clearTimeout(launchTimerRef.current), []);

    const ensureCapacity = async (count = 1) => {
        if (!isAuthenticated) {
            requestAuth();
            return false;
        }
        const blocked = await checkCanvasProjectCapacity(count);
        if (blocked) {
            message.warning(blocked);
            return false;
        }
        return true;
    };

    const createAndEnter = async (event?: ReactMouseEvent) => {
        const point = event ? ({ clientX: event.clientX, clientY: event.clientY } as ReactMouseEvent) : undefined;
        if (!(await ensureCapacity())) return;
        const title = t("canvas.defaultTitle", { count: visibleProjects.length + 1 });
        launchProject(createProject(title), title, point);
    };

    const useWorkflowTemplate = async (template: CanvasWorkflowTemplateSummary, title?: string, event?: ReactMouseEvent) => {
        if (usingTemplate) return;
        const point = event ? ({ clientX: event.clientX, clientY: event.clientY } as ReactMouseEvent) : undefined;
        setUsingTemplate(true);
        try {
            if (!(await ensureCapacity())) return;
            const detail = await getCanvasWorkflowTemplate(template.id);
            const id = importProject(createCanvasProjectFromUploadedTemplate(detail));
            const name = (title || "").trim();
            if (name && name !== detail.title) renameProject(id, name);
            setPreviewTemplate(null);
            message.success(t("canvas.homePage.templates.created", { title: name || template.title }));
            launchProject(id, name || template.title, point);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.homePage.templates.createFailed"));
        } finally {
            setUsingTemplate(false);
        }
    };

    const duplicateProjects = async (list: CanvasProject[]) => {
        if (!list.length || !(await ensureCapacity(list.length))) return;
        try {
            const loaded = await Promise.all(list.map((project) => ensureCanvasProjectDocument(project.id)));
            let created = 0;
            loaded.forEach((project) => {
                if (!project) return;
                importProject({ ...project, title: t("canvas.homePage.library.copySuffix", { title: project.title }), createdAt: undefined });
                created += 1;
            });
            if (created) message.success(created === 1 ? t("canvas.homePage.library.duplicated", { title: t("canvas.homePage.library.copySuffix", { title: list[0].title }) }) : t("canvas.homePage.library.duplicatedMany", { count: created }));
        } catch {
            message.error(t("canvas.homePage.library.duplicateFailed"));
        }
    };

    const projectActions: CanvasHomeProjectActions = {
        onOpen: (project, event) => launchProject(project.id, project.title, event),
        onRename: (project) => startEditing(project.id, project.title),
        onDuplicate: (project) => void duplicateProjects([project]),
        onExport: (project) => void exportCanvasProjects([project], project.title || t("canvas.export.defaultProjectName")),
        onDelete: (project) => setDeleteIds([project.id]),
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
            const blocked = await checkCanvasProjectCapacity(data.projects.length);
            if (blocked) {
                message.warning(blocked);
                return;
            }
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
    const openImport = () => (isAuthenticated ? inputRef.current?.click() : requestAuth());

    const navigateRail = (target: CanvasHomeRailTarget) => {
        if (target === "search") setPaletteOpen(true);
        else if (target === "library") setView("library");
        else if (target === "templates") setView("templates");
        else if (view !== "home") setView("home");
        else mainRef.current?.scrollTo({ top: 0, behavior: canvasHomeMotionDisabled() ? "auto" : "smooth" });
    };

    // 模板列表：接口不可用时服务层会回落到内置模板。
    useEffect(() => {
        let active = true;
        setTemplatesLoading(true);
        listCanvasWorkflowTemplates()
            .then((items) => {
                if (active) setTemplates([...items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)));
            })
            .catch((error) => {
                if (active) setTemplatesError(error instanceof Error ? error.message : t("canvas.homePage.templates.loadFailed"));
            })
            .finally(() => {
                if (active) setTemplatesLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    // ⌘K / Ctrl+K 打开命令面板。
    useEffect(() => {
        const handle = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setPreviewTemplate(null);
                setPaletteOpen((open) => !open);
            }
        };
        window.addEventListener("keydown", handle);
        return () => window.removeEventListener("keydown", handle);
    }, []);

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        if (!isAuthenticated) {
            requestAuth();
            navigate("/canvas", { replace: true });
            return;
        }
        const existing = mode === "recent" ? visibleProjects[0]?.id : "";
        if (existing) {
            enterProject(existing);
            return;
        }
        void checkCanvasProjectCapacity().then((blocked) => {
            if (blocked) {
                message.warning(blocked);
                navigate("/canvas", { replace: true });
                return;
            }
            enterProject(createProject(t("canvas.defaultTitle", { count: visibleProjects.length + 1 })));
        });
    }, [createProject, enterProject, hydrated, isAuthenticated, message, mode, navigate, requestAuth, t, visibleProjects]);

    // 配额显示「已用 / 上限」；项目增删后刷新。
    useEffect(() => {
        if (!hydrated || !isAuthenticated) {
            setProjectQuota(null);
            return;
        }
        let active = true;
        fetchCanvasProjectQuota()
            .then((value) => {
                if (active) setProjectQuota(value);
            })
            .catch(() => {
                if (active) setProjectQuota(null);
            });
        return () => {
            active = false;
        };
    }, [hydrated, isAuthenticated, visibleProjects.length, cloudProjectsVersion]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    const railActive: CanvasHomeRailTarget = paletteOpen ? "search" : view;

    return (
        <div className="ch-theme ch-root">
            <CanvasHomeRail active={railActive} projectCount={visibleProjects.length} templateCount={templates.length} quota={quota} isAuthenticated={isAuthenticated} onLogin={requestAuth} onNavigate={navigateRail} />
            <main ref={mainRef} className="ch-main">
                {view === "library" ? (
                    <CanvasHomeLibrary
                        key="library"
                        projects={visibleProjects}
                        hydrated={hydrated}
                        quota={quota}
                        onCreate={(event) => void createAndEnter(event)}
                        onExportMany={(list) => void exportCanvasProjects(list, t("canvas.homePage.library.exportName", { count: list.length }))}
                        onDuplicateMany={(list) => void duplicateProjects(list)}
                        onDeleteMany={(list) => setDeleteIds(list.map((project) => project.id))}
                        {...projectActions}
                    />
                ) : view === "templates" ? (
                    <div key="templates" className="ch-view">
                        <CanvasHomePageHead
                            title={t("canvas.homePage.templatesPage.title")}
                            stats={
                                templates.length ? (
                                    <>
                                        <span>
                                            <b className="ch-num">{templates.length}</b> {t("canvas.homePage.templatesPage.templateUnit")}
                                        </span>
                                        <span>
                                            <b className="ch-num">{categoryIds.length}</b> {t("canvas.homePage.templatesPage.categoryUnit")}
                                        </span>
                                    </>
                                ) : null
                            }
                        />
                        <CanvasHomeTemplates
                            hideTitle
                            scrollRef={mainRef}
                            templates={templates}
                            loading={templatesLoading}
                            error={templatesError}
                            category={templateCategory}
                            onCategoryChange={setTemplateCategory}
                            onPreview={setPreviewTemplate}
                            onUse={(template, event) => void useWorkflowTemplate(template, undefined, event)}
                        />
                    </div>
                ) : (
                    <div key="home" className="ch-view">
                        <CanvasHomeHero
                            scrollRef={mainRef}
                            templates={templates}
                            disabled={!hydrated}
                            onCreate={(event) => void createAndEnter(event)}
                            onImport={openImport}
                            onPreviewTemplate={setPreviewTemplate}
                            onUseTemplate={(template, event) => void useWorkflowTemplate(template, undefined, event)}
                        />

                        <section className="ch-section flex flex-col gap-[18px] pt-2" aria-labelledby="ch-recent-title">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-baseline gap-2.5">
                                    <h2 id="ch-recent-title" className="ch-section-title">
                                        {t("canvas.homePage.recent.title")}
                                    </h2>
                                    {recentProjects.length ? (
                                        <span className="text-[13px]" style={{ color: "var(--ch-muted)" }}>
                                            {t("canvas.homePage.recent.latest", { count: Math.min(recentCount, recentProjects.length) })}
                                        </span>
                                    ) : null}
                                </div>
                                <button type="button" className="ch-ghost h-[34px] rounded-[10px] px-3.5 text-[13px]" onClick={() => setView("library")}>
                                    {t("canvas.homePage.recent.library")} <span className="ch-num">{visibleProjects.length}</span>
                                    <ArrowRight className="size-3.5" />
                                </button>
                            </div>
                            {!hydrated ? (
                                <div className="ch-empty" style={{ minHeight: 200 }}>
                                    {t("canvas.loading")}
                                </div>
                            ) : recentProjects.length ? (
                                <div className="ch-grid-cards">
                                    {recentProjects.slice(0, recentCount).map((project, index) => (
                                        <CanvasHomeRecentCard key={project.id} project={project} index={index} onOpen={projectActions.onOpen} />
                                    ))}
                                </div>
                            ) : (
                                <div className="ch-empty" style={{ minHeight: 200 }}>
                                    <strong>{t("canvas.empty")}</strong>
                                    <span>{t("canvas.emptyDescription")}</span>
                                </div>
                            )}
                        </section>

                        <CanvasHomeTemplates
                            scrollRef={mainRef}
                            templates={templates}
                            loading={templatesLoading}
                            error={templatesError}
                            category={templateCategory}
                            onCategoryChange={setTemplateCategory}
                            onPreview={setPreviewTemplate}
                            onUse={(template, event) => void useWorkflowTemplate(template, undefined, event)}
                        />
                    </div>
                )}
            </main>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasTemplatePreview
                template={previewTemplate}
                color={previewTemplate ? categoryColor(previewTemplate.category, categoryIds) : "#9b7bff"}
                full={quotaFull}
                busy={usingTemplate}
                onClose={() => setPreviewTemplate(null)}
                onUse={(template, title, event) => void useWorkflowTemplate(template, title, event)}
            />
            <CanvasCommandPalette
                open={paletteOpen}
                projects={recentProjects}
                templates={templates}
                full={quotaFull}
                onClose={() => setPaletteOpen(false)}
                onCreate={() => void createAndEnter()}
                onBrowseTemplates={() => setView("templates")}
                onOpenLibrary={() => setView("library")}
                onOpenProject={(project) => launchProject(project.id, project.title)}
                onPreviewTemplate={setPreviewTemplate}
            />
            <CanvasLaunchOverlay launch={launch} />
        </div>
    );
}
