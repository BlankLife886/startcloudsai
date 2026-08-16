import { useEffect, useState } from "react";

import { fetchSiteBackgroundRemovalTools } from "@/services/site-model-catalog";

export type CanvasBackgroundRemovalTool = {
    id: string;
    pricePoints?: number;
};

let cache: CanvasBackgroundRemovalTool | null | undefined;
const listeners = new Set<(tool: CanvasBackgroundRemovalTool | null) => void>();

export function getCanvasBackgroundRemovalTool() {
    return cache === undefined ? null : cache;
}

export async function loadCanvasBackgroundRemovalTool() {
    if (cache !== undefined) return cache;
    const tools = await fetchSiteBackgroundRemovalTools();
    const selected = tools.find((item) => item.default) || tools[0];
    cache = selected ? { id: selected.id, pricePoints: selected.pricePoints } : null;
    listeners.forEach((listener) => listener(cache));
    return cache;
}

export function useCanvasBackgroundRemovalTool() {
    const [tool, setTool] = useState(getCanvasBackgroundRemovalTool());
    useEffect(() => {
        listeners.add(setTool);
        void loadCanvasBackgroundRemovalTool().then(setTool).catch(() => setTool(null));
        return () => {
            listeners.delete(setTool);
        };
    }, []);
    return tool;
}
