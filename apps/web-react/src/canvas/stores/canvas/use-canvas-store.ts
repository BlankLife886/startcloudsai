import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import i18n from "@/i18n";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasWorkflowCheckpoint } from "@/lib/canvas/canvas-workflow";
import { mergeCanvasProjectSnapshots } from "@/lib/canvas/canvas-project-sync";
import { createCloudCanvasProject, deleteCloudCanvasProject, getCloudCanvasProject, listCloudCanvasProjects, updateCloudCanvasProject } from "@/services/canvas-cloud-repository";
import { StarcloudsApiError } from "@/services/starclouds-api";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision?: number;
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

function replaceCloudProject(saved: CanvasProject, expectedUpdatedAt?: string) {
    useCanvasStore.setState((state) => ({
        projects: state.projects.map((project) => {
            if (project.id !== saved.id) return project;
            if (expectedUpdatedAt && project.updatedAt !== expectedUpdatedAt) return { ...project, revision: saved.revision };
            return saved;
        }),
    }));
}

async function persistProjectToCloud(id: string, userId: string) {
    const state = useCanvasStore.getState();
    if (cloudSyncUserId !== userId || state.ownerUserId !== userId) return;
    const project = state.projects.find((item) => item.id === id);
    if (!project) return;
    const expectedUpdatedAt = project.updatedAt;
    let saved: CanvasProject | null;
    try {
        saved = project.revision ? await updateCloudCanvasProject(project) : await createCloudCanvasProject(project);
    } catch (error) {
        if (!(error instanceof StarcloudsApiError) || error.code !== "revision_conflict") throw error;
        const remote = await getCloudCanvasProject(id);
        if (!remote) throw error;
        saved = await updateCloudCanvasProject({ ...project, revision: remote.revision });
    }
    if (cloudSyncUserId !== userId || useCanvasStore.getState().ownerUserId !== userId) return;
    if (saved) replaceCloudProject(saved, expectedUpdatedAt);
    const latest = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (latest && latest.updatedAt !== expectedUpdatedAt) scheduleCloudSave(id, 1500);
}

function scheduleCloudSave(id: string, delay = 700) {
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
            .catch((error) => console.error("Canvas cloud save failed", error))
            .finally(() => {
                if (cloudSaveChains.get(id) === next) cloudSaveChains.delete(id);
            });
        cloudSaveChains.set(id, next);
    }, delay);
    cloudSaveTimers.set(id, timer);
}

async function hydrateCloudProjects(userId: string, localProjects: CanvasProject[]) {
    try {
        const cloudProjects = await listCloudCanvasProjects();
        if (cloudSyncUserId !== userId) return;
        const cloudIds = new Set(cloudProjects.map((project) => project.id));
        const merged = mergeCanvasProjectSnapshots(cloudProjects, localProjects);
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

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        queuedPersistValue = parsed;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.ownerUserId === nextState.ownerUserId && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        queuedPersistValue = value;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
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
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
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
                    projects: state.projects.map((item) => (item.id === id ? { ...next, updatedAt: new Date().toISOString() } : item)),
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
    cloudSaveTimers.forEach((timer) => clearTimeout(timer));
    cloudSaveTimers.clear();
    useCanvasStore.setState({ hydrated: true });
}
