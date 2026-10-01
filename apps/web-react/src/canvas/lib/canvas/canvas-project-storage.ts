type Backend = { getItem(name: string): string | null | Promise<string | null>; setItem(name: string, value: string): unknown | Promise<unknown>; removeItem(name: string): unknown | Promise<unknown> };
type Project = { id: string };
type Persisted<P extends Project> = { state: { ownerUserId: string | null; projects: P[] }; version?: number };
type Manifest = { canvasProjectIndex: 1; ownerUserId: string | null; projects: Array<{ id: string; key: string }>; version?: number };

/** Project documents are independent records; the small manifest is published last. */
export function createCanvasProjectStorage<P extends Project>(backend: Backend) {
    let saved = new Map<string, P>();
    let chain: Promise<unknown> = Promise.resolve();
    const serial = <T>(work: () => Promise<T>) => {
        const next = chain.catch(() => undefined).then(work);
        chain = next;
        return next;
    };
    const keyFor = (name: string, owner: string | null, id: string) => `${name}:project:${encodeURIComponent(owner || "local")}:${encodeURIComponent(id)}`;
    return {
        getItem: (name: string) => serial(async (): Promise<Persisted<P> | null> => {
            const raw = await backend.getItem(name);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data.canvasProjectIndex !== 1) return data as Persisted<P>; // Migrate legacy monolithic cache on the next successful save.
            const manifest = data as Manifest;
            const projects: P[] = [];
            for (const entry of manifest.projects) {
                if (entry.key !== keyFor(name, manifest.ownerUserId, entry.id)) throw new Error("画布缓存索引不匹配");
                const record = await backend.getItem(entry.key);
                if (!record) throw new Error("画布缓存缺少文档，请恢复存储后重试");
                const project = JSON.parse(record) as P;
                if (project.id !== entry.id) throw new Error("画布缓存文档不匹配");
                projects.push(project);
            }
            saved = new Map(projects.map((project) => [keyFor(name, manifest.ownerUserId, project.id), project]));
            return { state: { ownerUserId: manifest.ownerUserId, projects }, version: manifest.version };
        }),
        setItem: (name: string, value: Persisted<P>) => serial(async () => {
            const { ownerUserId, projects } = value.state;
            const entries = projects.map((project) => ({ id: project.id, key: keyFor(name, ownerUserId, project.id) }));
            const nextSaved = new Map<string, P>();
            for (let index = 0; index < projects.length; index++) {
                const project = projects[index], key = entries[index].key;
                if (saved.get(key) !== project) await backend.setItem(key, JSON.stringify(project));
                nextSaved.set(key, project);
            }
            await backend.setItem(name, JSON.stringify({ canvasProjectIndex: 1, ownerUserId, projects: entries, version: value.version } satisfies Manifest));
            const ownerPrefix = keyFor(name, ownerUserId, "");
            for (const key of saved.keys()) if (key.startsWith(ownerPrefix) && !nextSaved.has(key)) await backend.removeItem(key);
            saved = nextSaved;
        }),
        removeItem: (name: string) => serial(async () => { await backend.removeItem(name); saved.clear(); }),
    };
}
