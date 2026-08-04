import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
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
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
const cloudSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cloudSaveChains = new Map<string, Promise<void>>();

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

async function persistProjectToCloud(id: string) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
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
    if (saved) replaceCloudProject(saved, expectedUpdatedAt);
    const latest = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (latest && latest.updatedAt !== expectedUpdatedAt) scheduleCloudSave(id, 0);
}

function scheduleCloudSave(id: string, delay = 700) {
    const currentTimer = cloudSaveTimers.get(id);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(() => {
        cloudSaveTimers.delete(id);
        const previous = cloudSaveChains.get(id) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => persistProjectToCloud(id))
            .catch((error) => console.error("Canvas cloud save failed", error))
            .finally(() => {
                if (cloudSaveChains.get(id) === next) cloudSaveChains.delete(id);
            });
        cloudSaveChains.set(id, next);
    }, delay);
    cloudSaveTimers.set(id, timer);
}

async function hydrateCloudProjects() {
    try {
        const cloudProjects = await listCloudCanvasProjects();
        const cloudIds = new Set(cloudProjects.map((project) => project.id));
        const localOnly = useCanvasStore
            .getState()
            .projects.filter((project) => !project.revision && !cloudIds.has(project.id))
            .map((project) => ({ ...project, id: isUuid(project.id) ? project.id : crypto.randomUUID() }));
        useCanvasStore.setState({ projects: [...cloudProjects, ...localOnly].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        localOnly.forEach((project) => scheduleCloudSave(project.id, 0));
    } catch (error) {
        console.error("Canvas cloud load failed; using local cache", error);
    } finally {
        useCanvasStore.setState({ hydrated: true });
    }
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
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
                        .then(() => deleteCloudCanvasProject(id))
                        .catch((error) => console.error("Canvas cloud delete failed", error));
                });
            },
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) => {
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                }));
                scheduleCloudSave(id);
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => void hydrateCloudProjects(),
        },
    ),
);
