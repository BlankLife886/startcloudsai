const aborted = () => new DOMException("Aborted", "AbortError");
type Consumer<T> = { resolve(value: T): void; reject(error: unknown): void; detach(): void };
type Job<T> = { key: string; priority: number; controller: AbortController; work(signal: AbortSignal): Promise<T>; consumers: Set<Consumer<T>>; started: boolean };

/** Deduplicated work with per-consumer cancellation and visible-canvas priority. */
export function createCanvasMediaQueue<T>(concurrency = 2) {
    const jobs = new Map<string, Job<T>>();
    let active = 0;
    const pump = () => {
        while (active < concurrency) {
            const job = [...jobs.values()].filter(job => !job.started && job.consumers.size).sort((a, b) => b.priority - a.priority)[0];
            if (!job) return;
            job.started = true; active++;
            Promise.resolve().then(() => job.work(job.controller.signal)).then(
                value => job.consumers.forEach(consumer => { consumer.detach(); consumer.resolve(value); }),
                error => job.consumers.forEach(consumer => { consumer.detach(); consumer.reject(error); }),
            ).finally(() => { if (jobs.get(job.key) === job) jobs.delete(job.key); active--; pump(); });
        }
    };
    return {
        request(key: string, work: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; priority?: number } = {}): Promise<T> {
            if (options.signal?.aborted) return Promise.reject(aborted());
            let job = jobs.get(key);
            if (!job) { job = { key, work, priority: options.priority || 0, controller: new AbortController(), consumers: new Set(), started: false }; jobs.set(key, job); }
            job.priority = Math.max(job.priority, options.priority || 0);
            const current = job;
            const result = new Promise<T>((resolve, reject) => {
                const cancel = () => {
                    consumer.detach(); current.consumers.delete(consumer); reject(aborted());
                    if (!current.consumers.size) { current.controller.abort(); if (jobs.get(key) === current) jobs.delete(key); pump(); }
                };
                const consumer: Consumer<T> = { resolve, reject, detach: () => options.signal?.removeEventListener("abort", cancel) };
                current.consumers.add(consumer);
                options.signal?.addEventListener("abort", cancel, { once: true });
            });
            pump();
            return result;
        },
        clear() {
            for (const job of jobs.values()) {
                job.controller.abort();
                job.consumers.forEach(consumer => { consumer.detach(); consumer.reject(aborted()); });
                job.consumers.clear();
            }
            jobs.clear();
        },
    };
}
