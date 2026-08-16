import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App, Button } from "antd";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Download, FileUp, Plus, Search, Trash2, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useCanvasHost } from "@/components/layout/canvas-host-context";

gsap.registerPlugin(useGSAP);

function canvasMotionDisabled() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("settings-no-animations");
}

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children?: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

function CanvasHeroStage() {
    return (
        <div className="canvas-hero-stage" data-canvas-hero-stage aria-hidden="true">
            <div className="canvas-hero-stage__grid" />
            <svg className="canvas-hero-stage__edges" viewBox="0 0 640 360">
                <path d="M168 118 C 250 118, 300 168, 368 176" fill="none" stroke="rgba(124,58,237,0.42)" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M368 176 C 430 184, 470 220, 508 236" fill="none" stroke="rgba(56,189,248,0.38)" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M168 118 C 210 170, 240 220, 286 248" fill="none" stroke="rgba(251,146,60,0.34)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="168" cy="118" r="3.4" fill="#7c3aed" />
                <circle cx="368" cy="176" r="3.4" fill="#7c3aed" />
                <circle cx="508" cy="236" r="3.4" fill="#38bdf8" />
                <circle cx="286" cy="248" r="3.4" fill="#fb923c" />
            </svg>
            <div className="canvas-hero-stage__node is-image" data-hero-float style={{ left: "11%", top: "18%" }}>
                <span className="canvas-hero-stage__chip">Image</span>
            </div>
            <div className="canvas-hero-stage__node is-text" data-hero-float style={{ left: "48%", top: "36%" }}>
                <span className="canvas-hero-stage__chip">Text</span>
                <span className="absolute left-3 top-8 h-1.5 w-16 rounded-full bg-violet-300/80" />
                <span className="absolute left-3 top-12 h-1.5 w-12 rounded-full bg-violet-200/80" />
            </div>
            <div className="canvas-hero-stage__node is-video" data-hero-float style={{ left: "70%", top: "56%" }}>
                <span className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95" />
            </div>
            <div className="canvas-hero-stage__node is-plus" data-hero-float style={{ left: "38%", top: "64%" }}>
                <Plus className="size-5" />
            </div>
        </div>
    );
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
                { autoAlpha: 0, y: 18 },
                {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.56,
                    stagger: 0.08,
                    ease: "power3.out",
                    clearProps: "opacity,visibility,transform",
                    onComplete: finish,
                },
            );
            const stage = root.querySelector("[data-canvas-hero-stage]");
            if (stage) {
                gsap.fromTo(stage, { autoAlpha: 0, x: 24, scale: 0.98 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.7, delay: 0.12, ease: "power3.out" });
                gsap.to("[data-hero-float]", {
                    y: (index) => (index % 2 ? 8 : -10),
                    x: (index) => (index % 3 ? 5 : -6),
                    duration: 2.6,
                    stagger: { each: 0.16, repeat: -1, yoyo: true },
                    ease: "sine.inOut",
                });
            }
            const orbs = gsap.utils.toArray<HTMLElement>("[data-canvas-orb]", root);
            const moveOrb = orbs.map((orb, index) => ({
                x: gsap.quickTo(orb, "x", { duration: 0.9 + index * 0.12, ease: "power3" }),
                y: gsap.quickTo(orb, "y", { duration: 0.9 + index * 0.12, ease: "power3" }),
            }));
            const onMove = (contextSafe || ((callback) => callback))((event: MouseEvent) => {
                const rect = root.getBoundingClientRect();
                const nx = (event.clientX - rect.left) / rect.width - 0.5;
                const ny = (event.clientY - rect.top) / rect.height - 0.5;
                moveOrb.forEach((orb, index) => {
                    const strength = 18 + index * 10;
                    orb.x(nx * strength);
                    orb.y(ny * strength);
                });
                if (stage) gsap.to(stage, { x: nx * 10, y: ny * 8, duration: 0.8, ease: "power3", overwrite: "auto" });
            });
            root.addEventListener("mousemove", onMove);
            return () => root.removeEventListener("mousemove", onMove);
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
            <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
                <div data-canvas-orb className="canvas-home-orb left-[8%] top-[12%] size-52 bg-violet-400/25" />
                <div data-canvas-orb className="canvas-home-orb right-[10%] top-[8%] size-40 bg-sky-300/20" />
                <div data-canvas-orb className="canvas-home-orb bottom-[18%] right-[22%] size-48 bg-orange-300/16" />
            </div>
            <div className="canvas-home-pattern__inner relative z-[2] mx-auto flex w-full max-w-[1560px] flex-col px-7 pb-14">
                <section className="canvas-hero">
                    <div className="canvas-hero__copy">
                        <h1 data-canvas-entry-item className="ai-title-aurora max-w-4xl text-balance text-5xl font-semibold tracking-normal lg:text-7xl">{t("canvas.title")}</h1>
                        <p data-canvas-entry-item className="mt-7 max-w-2xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400">
                            <Trans
                                i18nKey="home.description"
                                components={{
                                    canvas: <Highlighter action="underline" color="#FF9800" />,
                                    content: <Highlighter action="highlight" color="#87CEFA" />,
                                }}
                            />
                        </p>
                        <div data-canvas-entry-item className="mt-9 flex flex-wrap items-center gap-3">
                            <Button className="canvas-hero__cta" type="primary" size="large" disabled={!hydrated} onClick={createAndEnter} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                {t("home.start")}
                            </Button>
                        </div>
                    </div>
                    <CanvasHeroStage />
                </section>

                <section data-canvas-entry-item className="mt-8">
                    <div className="canvas-recent-bar">
                        <div className="flex shrink-0 items-baseline gap-3">
                            <h2 className="text-[22px] font-semibold tracking-tight">{t("canvas.recent")}</h2>
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
                                            <Download className="size-3.5" />
                                        </span>
                                        {t("canvas.exportSelected")}
                                    </button>
                                    <button type="button" className="canvas-home-btn is-danger" disabled={!hydrated} onClick={() => setDeleteIds(visibleSelectedIds)} aria-label={t("canvas.deleteSelected")}>
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button type="button" className="canvas-home-btn" disabled={!hydrated} onClick={() => (isAuthenticated ? inputRef.current?.click() : requestAuth())}>
                                        <span className="canvas-home-btn__icon">
                                            <FileUp className="size-3.5" />
                                        </span>
                                        {t("canvas.import")}
                                    </button>
                                    {visibleProjects.length ? (
                                        <button type="button" className="canvas-home-btn is-danger" disabled={!hydrated} onClick={() => setDeleteIds(visibleProjects.map((project) => project.id))} aria-label={t("canvas.deleteAll")} title={t("canvas.deleteAll")}>
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </div>

                    {!hydrated ? (
                        <div className="mt-5 flex min-h-52 items-center justify-center rounded-[18px] border border-dashed border-stone-200 bg-white/70 text-sm text-stone-500 dark:border-white/10 dark:bg-white/[0.03]">{t("canvas.loading")}</div>
                    ) : projectQuery.trim() && !filteredProjects.length ? (
                        <div className="mt-5 flex min-h-40 items-center justify-center rounded-[18px] border border-dashed border-stone-200 bg-white/70 text-sm text-stone-500 dark:border-white/10 dark:bg-white/[0.03]">{t("canvas.noMatchingProjects")}</div>
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
        </main>
    );
}
