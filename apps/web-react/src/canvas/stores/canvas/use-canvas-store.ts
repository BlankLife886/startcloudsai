import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import i18n from "@/i18n";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasWorkflowCheckpoint } from "@/lib/canvas/canvas-workflow";
import { canvasProjectNeedsCloudRetry, mergeCanvasProjectDocuments, mergeCanvasProjectSnapshots, type CanvasCloudProjectSummary } from "@/lib/canvas/canvas-project-sync";
import { createCloudCanvasProject, deleteCloudCanvasProject, getCloudCanvasProject, listCloudCanvasProjectSummaries, updateCloudCanvasProject } from "@/services/canvas-cloud-repository";
import { StarcloudsApiError } from "@/services/starclouds-api";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision?: number;
    /** Local changes that have not been confirmed by the cloud yet ("未同步"). Cleared when a cloud save succeeds. */
    pendingSync?: boolean;
    /** Cloud-only list entry whose document has not been downloaded yet; fetched when the project is opened. */
    documentPending?: boolean;
    /** The cloud revision moved past the local copy; the document is refetched and merged when the project is opened. */
    documentStale?: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    workflowRun?: CanvasWorkflowCheckpoint | null;
};

type CanvasStore = {
    hydrated: boolean;
    ownerUserId: string | null;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "workflowRun">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "ownerUserId" | "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let queuedPersistValue: StorageValue<CanvasStore> | null = null;
const cloudSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cloudSaveChains = new Map<string, Promise<void>>();
let resolveLocalHydration!: () => void;
const localHydrationPromise = new Promise<void>((resolve) => {
    resolveLocalHydration = resolve;
});
let cloudSyncUserId = "";
let cloudSyncPromise: Promise<void> | null = null;

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Sync notifications: the store runs outside React, so pages register a
// notifier (usually antd message) to surface save failures to the user
// instead of swallowing them silently.

export type CanvasSyncNotification = {
    kind: "save_failed" | "save_recovered";
    projectId: string;
    projectTitle: string;
    errorMessage: string;
};

let canvasSyncNotifier: ((notification: CanvasSyncNotification) => void) | null = null;
const failedSaveProjectIds = new Set<string>();

export function setCanvasSyncNotifier(notifier: (notification: CanvasSyncNotification) => void) {
    canvasSyncNotifier = notifier;
    return () => {
        if (canvasSyncNotifier === notifier) canvasSyncNotifier = null;
    };
}

function notifyCloudSaveFailed(id: string, error: unknown) {
    // One warning per project until a save succeeds again, so retry loops do not spam toasts.
    if (failedSaveProjectIds.has(id)) return;
    failedSaveProjectIds.add(id);
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    canvasSyncNotifier?.({
        kind: "save_failed",
        projectId: id,
        projectTitle: project?.title || "",
        errorMessage: error instanceof Error ? error.message : "",
    });
}

function notifyCloudSaveRecovered(id: string) {
    if (!failedSaveProjectIds.delete(id)) return;
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    canvasSyncNotifier?.({ kind: "save_recovered", projectId: id, projectTitle: project?.title || "", errorMessage: "" });
}

function replaceCloudProject(saved: CanvasProject, expectedUpdatedAt?: string, mergeIntoLocal = false) {
    useCanvasStore.setState((state) => ({
        projects: state.projects.map((project) => {
            if (project.id !== saved.id) return project;
            if (!expectedUpdatedAt || project.updatedAt === expectedUpdatedAt) return saved;
            // Local edits landed while the save was in flight: keep them
            // (still pendingSync), adopt the saved revision, and — after a
            // conflict merge — the remotely merged nodes as well.
            const base = mergeIntoLocal ? mergeCanvasProjectDocuments(project, saved) : project;
            return { ...base, revision: saved.revision, pendingSync: true };
        }),
    }));
}

async function persistProjectToCloud(id: string, userId: string) {
    const state = useCanvasStore.getState();
    if (cloudSyncUserId !== userId || state.ownerUserId !== userId) return;
    const project = state.projects.find((item) => item.id === id);
    if (!project || project.documentPending) return;
    const expectedUpdatedAt = project.updatedAt;
    let saved: CanvasProject | null;
    let mergedRemote = false;
    try {
        saved = project.revision ? await updateCloudCanvasProject(project) : await createCloudCanvasProject(project);
    } catch (error) {
        if (!(error instanceof StarcloudsApiError) || error.code !== "revision_conflict") throw error;
        const remote = await getCloudCanvasProject(id);
        if (!remote) throw error;
        // Another writer advanced the document (second tab, reconnect race).
        // Merge node-by-node instead of overwriting, so outputs generated
        // elsewhere survive, then save on top of the remote revision.
        saved = await updateCloudCanvasProject(mergeCanvasProjectDocuments(project, remote));
        mergedRemote = true;
    }
    if (cloudSyncUserId !== userId || useCanvasStore.getState().ownerUserId !== userId) return;
    if (saved) {
        replaceCloudProject(saved, expectedUpdatedAt, mergedRemote);
        notifyCloudSaveRecovered(id);
    }
    const latest = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (canvasProjectNeedsCloudRetry(latest)) scheduleCloudSave(id, 1500);
}

let cloudSaveBaseDelayMs = 700;

/** Raise the default save debounce while a workflow runs (progress lives in the run lease; the full document does not need to be saved on every checkpoint tick). Pass null to restore the default. */
export function setCanvasCloudSaveBaseDelay(delay: number | null) {
    cloudSaveBaseDelayMs = delay ?? 700;
}

function scheduleCloudSave(id: string, delay = cloudSaveBaseDelayMs) {
    const userId = useCanvasStore.getState().ownerUserId;
    if (!userId || cloudSyncUserId !== userId) return;
    const currentTimer = cloudSaveTimers.get(id);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(() => {
        cloudSaveTimers.delete(id);
        const previous = cloudSaveChains.get(id) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => persistProjectToCloud(id, userId))
            .catch((error) => {
                console.error("Canvas cloud save failed", error);
                notifyCloudSaveFailed(id, error);
            })
            .finally(() => {
                if (cloudSaveChains.get(id) === next) cloudSaveChains.delete(id);
            });
        cloudSaveChains.set(id, next);
    }, delay);
    cloudSaveTimers.set(id, timer);
}

function createStubProject(summary: CanvasCloudProjectSummary): CanvasProject {
    return {
        id: summary.id,
        title: summary.title,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        revision: summary.revision,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: initialViewport,
        workflowRun: null,
        documentPending: true,
    };
}

async function hydrateCloudProjects(userId: string, localProjects: CanvasProject[]) {
    try {
        const summaries = await listCloudCanvasProjectSummaries();
        if (cloudSyncUserId !== userId) return;
        const cloudIds = new Set(summaries.map((summary) => summary.id));
        const merged = mergeCanvasProjectSnapshots(summaries, localProjects, createStubProject);
        const localOnly = localProjects
            .filter((project) => !project.revision && !cloudIds.has(project.id))
            .map((project) => ({ ...project, id: isUuid(project.id) ? project.id : crypto.randomUUID() }));
        useCanvasStore.setState({
            ownerUserId: userId,
            projects: [...merged.projects, ...localOnly].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        });
        [...localOnly.map((project) => project.id), ...merged.localNewerIds].forEach((id) => scheduleCloudSave(id, 0));
    } catch (error) {
        if (cloudSyncUserId === userId) console.error("Canvas cloud load failed; using local cache", error);
    } finally {
        if (cloudSyncUserId === userId) useCanvasStore.setState({ hydrated: true });
    }
}

const documentLoads = new Map<string, Promise<CanvasProject | null>>();
const CANVAS_DOCUMENT_PREFETCH_CONCURRENCY = 2;
const documentPrefetchQueue: string[] = [];
const queuedDocumentPrefetches = new Set<string>();
let activeDocumentPrefetches = 0;

/**
 * Make sure a project's full document is available locally before it is used.
 * Cloud-only list entries download their document on first open; stale local
 * copies refetch the remote document and node-merge any unsynced local edits
 * into it. Returns the up-to-date project, or null when it no longer exists.
 */
export function ensureCanvasProjectDocument(id: string): Promise<CanvasProject | null> {
    const initialState = useCanvasStore.getState();
    const ownerUserId = initialState.ownerUserId;
    const project = initialState.projects.find((item) => item.id === id);
    if (!project) return Promise.resolve(null);
    if (!project.documentPending && !project.documentStale) return Promise.resolve(project);
    const running = documentLoads.get(id);
    if (running) return running;
    const load = (async (): Promise<CanvasProject | null> => {
        let remote: CanvasProject | null | undefined;
        try {
            remote = await getCloudCanvasProject(id);
        } catch (error) {
            console.error("Canvas cloud document load failed", error);
            remote = undefined;
        }
        const currentState = useCanvasStore.getState();
        if (currentState.ownerUserId !== ownerUserId) return null;
        const current = currentState.projects.find((item) => item.id === id);
        if (!current) return null;
        if (remote === undefined) {
            // Transient load failure: a stub has nothing usable to show, but a
            // stale local copy can still be edited and merged later.
            return current.documentPending ? null : current;
        }
        if (remote === null) {
            // Deleted remotely; drop stubs, keep locally edited copies visible.
            if (current.documentPending) {
                useCanvasStore.setState((state) => ({ projects: state.projects.filter((item) => item.id !== id) }));
                return null;
            }
            return current;
        }
        const next: CanvasProject = current.pendingSync
            ? { ...mergeCanvasProjectDocuments(current, remote), documentPending: false, documentStale: false, pendingSync: true }
            : remote;
        useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === id ? next : item)) }));
        if (current.pendingSync) scheduleCloudSave(id);
        return next;
    })().finally(() => documentLoads.delete(id));
    documentLoads.set(id, load);
    return load;
}

function pumpCanvasDocumentPrefetches() {
    while (activeDocumentPrefetches < CANVAS_DOCUMENT_PREFETCH_CONCURRENCY && documentPrefetchQueue.length) {
        const id = documentPrefetchQueue.shift();
        if (!id) continue;
        queuedDocumentPrefetches.delete(id);
        const project = useCanvasStore.getState().projects.find((item) => item.id === id);
        if (!project?.documentPending && !project?.documentStale) continue;
        activeDocumentPrefetches += 1;
        void ensureCanvasProjectDocument(id)
            .catch((error) => console.error("Canvas project preview prefetch failed", error))
            .finally(() => {
                activeDocumentPrefetches = Math.max(0, activeDocumentPrefetches - 1);
                pumpCanvasDocumentPrefetches();
            });
    }
}

/**
 * Queue a lightweight, viewport-driven document prefetch for a project card.
 * The global limit prevents a long project list from competing with normal API
 * traffic, while documentLoads still deduplicates a simultaneous card open.
 */
export function prefetchCanvasProjectDocument(id: string) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (!project || (!project.documentPending && !project.documentStale)) return;
    if (documentLoads.has(id) || queuedDocumentPrefetches.has(id)) return;
    queuedDocumentPrefetches.add(id);
    documentPrefetchQueue.push(id);
    pumpCanvasDocumentPrefetches();
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        try {
            const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
            queuedPersistState = parsed.state as PersistedCanvasState;
            queuedPersistValue = parsed;
            return parsed;
        } catch (error) {
            console.error("Canvas store failed to parse persisted state", error);
            throw error;
        }
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.ownerUserId === nextState.ownerUserId && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        queuedPersistValue = value;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            if (!queuedPersistValue) return;
            void localForageStorage.setItem(name, JSON.stringify(queuedPersistValue));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export async function flushCanvasPersistence() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!queuedPersistValue) return;
    await localForageStorage.setItem(CANVAS_STORE_KEY, JSON.stringify(queuedPersistValue));
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            ownerUserId: null,
            projects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = crypto.randomUUID();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    pendingSync: true,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    workflowRun: null,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                scheduleCloudSave(id, 0);
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: crypto.randomUUID(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    pendingSync: true,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    workflowRun: null,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                scheduleCloudSave(project.id, 0);
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => {
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString(), pendingSync: true } : project)),
                }));
                scheduleCloudSave(id);
            },
            deleteProjects: (ids) => {
                const userId = get().ownerUserId;
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                });
                ids.forEach((id) => {
                    const timer = cloudSaveTimers.get(id);
                    if (timer) clearTimeout(timer);
                    cloudSaveTimers.delete(id);
                    void (cloudSaveChains.get(id) || Promise.resolve())
                        .catch(() => undefined)
                        .then(() => {
                            if (!userId || cloudSyncUserId !== userId || useCanvasStore.getState().ownerUserId !== userId) return;
                            return deleteCloudCanvasProject(id);
                        })
                        .catch((error) => console.error("Canvas cloud delete failed", error));
                });
            },
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) => {
                const project = get().projects.find((item) => item.id === id);
                if (!project) return;
                const next = { ...project, ...patch };
                const unchanged =
                    next.nodes === project.nodes &&
                    next.connections === project.connections &&
                    next.chatSessions === project.chatSessions &&
                    next.activeChatId === project.activeChatId &&
                    next.backgroundMode === project.backgroundMode &&
                    next.showImageInfo === project.showImageInfo &&
                    next.workflowRun === project.workflowRun &&
                    next.viewport.x === project.viewport.x &&
                    next.viewport.y === project.viewport.y &&
                    next.viewport.k === project.viewport.k;
                if (unchanged) return;
                set((state) => ({
                    projects: state.projects.map((item) => (item.id === id ? { ...next, updatedAt: new Date().toISOString(), pendingSync: true } : item)),
                }));
                scheduleCloudSave(id);
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    ownerUserId: state.ownerUserId,
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
                resolveLocalHydration();
            },
        },
    ),
);

export function prepareCanvasCloudSync(userId: string) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;
    if (cloudSyncUserId === normalizedUserId) return cloudSyncPromise;

    cloudSyncUserId = normalizedUserId;
    const sync = (async () => {
        await localHydrationPromise;
        if (cloudSyncUserId !== normalizedUserId) return;

        const state = useCanvasStore.getState();
        const canUseLocalProjects = !state.ownerUserId || state.ownerUserId === normalizedUserId;
        const localProjects = canUseLocalProjects ? state.projects : [];
        useCanvasStore.setState({
            hydrated: false,
            ownerUserId: normalizedUserId,
            projects: localProjects,
        });
        await hydrateCloudProjects(normalizedUserId, localProjects);
    })().finally(() => {
        if (cloudSyncPromise === sync) cloudSyncPromise = null;
    });
    cloudSyncPromise = sync;
    return sync;
}

export function disconnectCanvasCloudSync() {
    cloudSyncUserId = "";
    documentPrefetchQueue.length = 0;
    queuedDocumentPrefetches.clear();
    cloudSaveTimers.forEach((timer) => clearTimeout(timer));
    cloudSaveTimers.clear();
    useCanvasStore.setState({ hydrated: true });
}
