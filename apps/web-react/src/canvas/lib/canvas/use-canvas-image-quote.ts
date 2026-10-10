import { useEffect, useMemo, useState } from "react";

import { canvasImageTaskParams, quoteCanvasImages, type CanvasImageQuote } from "@/services/canvas-task-api";
import type { AiConfig } from "@/stores/use-config-store";

// Price rules switch on the hour at most, so a short cache only saves repeat
// quotes while the user toggles settings back and forth.
const QUOTE_TTL_MS = 60_000;
const QUOTE_DEBOUNCE_MS = 300;
const cache = new Map<string, { quote: CanvasImageQuote; at: number }>();

function quoteKey(config: AiConfig, count: number) {
    try {
        return JSON.stringify([canvasImageTaskParams(config), count]);
    } catch {
        return "";
    }
}

function cached(key: string) {
    const hit = key ? cache.get(key) : undefined;
    return hit && Date.now() - hit.at < QUOTE_TTL_MS ? hit.quote : null;
}

/**
 * Server quote for an image submission with these settings, or null while it
 * loads, when signed out, or when the settings are invalid. Callers show the
 * local tier estimate until it arrives.
 */
export function useCanvasImageQuote(config: AiConfig, count: number, enabled = true): CanvasImageQuote | null {
    const key = useMemo(() => (enabled && config.model ? quoteKey(config, count) : ""), [enabled, config, count]);
    const [result, setResult] = useState<{ key: string; quote: CanvasImageQuote } | null>(null);

    useEffect(() => {
        if (!key || cached(key)) return undefined;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            quoteCanvasImages(config, count, controller.signal)
                .then((quote) => {
                    cache.set(key, { quote, at: Date.now() });
                    setResult({ key, quote });
                })
                .catch(() => undefined);
        }, QUOTE_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
        // The key already encodes every setting the quote depends on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    if (!key) return null;
    return cached(key) ?? (result?.key === key ? result.quote : null);
}
