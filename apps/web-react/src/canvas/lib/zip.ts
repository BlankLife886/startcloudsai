import { unzipSync, zipSync } from "fflate";

type ZipFile = {
    name: string;
    data: BlobPart;
};

export async function createZip(files: ZipFile[]) {
    const used = new Set<string>();
    const uniqueName = (name: string) => {
        if (!used.has(name)) {
            used.add(name);
            return name;
        }
        const dot = name.lastIndexOf(".");
        const base = dot >= 0 ? name.slice(0, dot) : name;
        const ext = dot >= 0 ? name.slice(dot) : "";
        let index = 1;
        let next = `${base}-${index}${ext}`;
        while (used.has(next)) {
            index += 1;
            next = `${base}-${index}${ext}`;
        }
        used.add(next);
        return next;
    };
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [uniqueName(file.name), data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    return new Map(Object.entries(entries).map(([name, data]) => [name, new Blob([data])]));
}
