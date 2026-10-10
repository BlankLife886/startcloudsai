import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

type StoredState = {
    __infiniteCanvasStorage: 1;
    revision: number;
    writer: string;
    value: string | null;
};

type StorageOptions = {
    primary: { getItem: (name: string) => Promise<unknown>; setItem: (name: string, value: string) => Promise<unknown> };
    fallback: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
    withLock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
    enabled?: () => boolean;
    writer?: string;
};

function decodeStoredState(raw: unknown): StoredState | null {
    if (typeof raw !== "string") return null;
    try {
        const parsed = JSON.parse(raw) as Partial<StoredState> | null;
        if (parsed?.__infiniteCanvasStorage === 1 && Number.isSafeInteger(parsed.revision) && Number(parsed.revision) > 0
            && typeof parsed.writer === "string" && (parsed.value === null || typeof parsed.value === "string")) return parsed as StoredState;
    } catch {
        // Pre-envelope StateStorage values are ordinary strings, not necessarily JSON.
    }
    return { __infiniteCanvasStorage: 1, revision: 0, writer: "", value: raw };
}

function compareStoredState(left: StoredState, right: StoredState) {
    return left.revision - right.revision || (left.writer < right.writer ? -1 : left.writer > right.writer ? 1 : 0);
}

/** Keeps the public StateStorage string contract while versioning the two physical copies. */
export function createLocalForageStorage(options: StorageOptions): StateStorage {
    const chains = new Map<string, Promise<unknown>>();
    const writer = options.writer || globalThis.crypto?.randomUUID?.() || `storage-${Math.random().toString(36).slice(2)}`;
    let lastRevision = 0;
    const serialize = <T>(name: string, task: () => Promise<T>): Promise<T> => {
        const previous = chains.get(name) || Promise.resolve();
        const next = previous.catch(() => undefined).then(() => options.withLock ? options.withLock(name, task) : task());
        chains.set(name, next);
        const cleanup = () => { if (chains.get(name) === next) chains.delete(name); };
        void next.then(cleanup, cleanup);
        return next;
    };
    const readCopies = (name: string) => Promise.allSettled([
        Promise.resolve().then(() => options.primary.getItem(name)).then(decodeStoredState),
        Promise.resolve().then(() => decodeStoredState(options.fallback().getItem(name))),
    ]);
    const nextRecord = (value: string | null, records: Array<StoredState | null>): StoredState => {
        lastRevision = Math.max(Date.now(), lastRevision + 1, ...records.map((record) => (record?.revision || 0) + 1));
        return { __infiniteCanvasStorage: 1, revision: lastRevision, writer, value };
    };
    const clearOlderFallback = (name: string, saved: StoredState) => {
        try {
            const fallback = options.fallback();
            const current = decodeStoredState(fallback.getItem(name));
            if (current && compareStoredState(current, saved) <= 0) fallback.removeItem(name);
        } catch {
            // The primary copy is durable; a stale fallback cannot outrank its revision.
        }
    };
    const write = async (name: string, value: string | null) => {
        const copies = await readCopies(name);
        const record = nextRecord(value, copies.map((copy) => copy.status === "fulfilled" ? copy.value : null));
        const encoded = JSON.stringify(record);
        try {
            // A null envelope is a deletion tombstone, so an old fallback never
            // resurrects a removed key if clearing localStorage is unavailable.
            await options.primary.setItem(name, encoded);
            clearOlderFallback(name, record);
        } catch (primaryError) {
            try {
                options.fallback().setItem(name, encoded);
            } catch (fallbackError) {
                throw new AggregateError([primaryError, fallbackError], "本地保存失败：浏览器存储空间不足或不可用，请勿关闭页面");
            }
        }
    };
    return {
        getItem: (name) => {
            if (options.enabled && !options.enabled()) return Promise.resolve(null);
            return serialize(name, async () => {
                const [primaryRead, fallbackRead] = await readCopies(name);
                const primary = primaryRead.status === "fulfilled" ? primaryRead.value : null;
                const fallback = fallbackRead.status === "fulfilled" ? fallbackRead.value : null;
                // Old fallbacks were only written after IDB failed. With no
                // version information, preserve that fallback conservatively.
                const fallbackWins = Boolean(fallback && (!primary || compareStoredState(fallback, primary) >= 0));
                const chosen = fallbackWins ? fallback : primary;
                if (!chosen) {
                    if (primaryRead.status === "rejected") throw new Error("无法读取本地画布缓存，请恢复浏览器存储后重试", { cause: primaryRead.reason });
                    return null;
                }
                lastRevision = Math.max(lastRevision, chosen.revision);
                if (fallbackWins) {
                    const recovered = chosen.revision ? chosen : nextRecord(chosen.value, [primary, fallback]);
                    try {
                        await options.primary.setItem(name, JSON.stringify(recovered));
                        clearOlderFallback(name, recovered);
                    } catch {
                        // Keep returning the durable fallback while IDB remains unavailable.
                    }
                } else {
                    clearOlderFallback(name, chosen);
                }
                return chosen.value;
            });
        },
        setItem: (name, value) => options.enabled && !options.enabled() ? Promise.resolve() : serialize(name, () => write(name, value)),
        removeItem: (name) => options.enabled && !options.enabled() ? Promise.resolve() : serialize(name, () => write(name, null)),
    };
}

export const localForageStorage = createLocalForageStorage({
    primary: localforage,
    fallback: () => window.localStorage,
    enabled: () => typeof window !== "undefined",
    withLock: async <T>(name: string, task: () => Promise<T>): Promise<T> => typeof navigator !== "undefined" && navigator.locks?.request
        ? await navigator.locks.request(`infinite-canvas:storage:${name}`, task)
        : await task(),
});
