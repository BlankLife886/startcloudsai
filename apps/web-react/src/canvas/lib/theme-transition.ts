import type { ThemeName } from "@/stores/use-theme-store";

type ThemeOrigin = { x?: unknown; y?: unknown } | null | undefined;

type ThemeRequest = {
    theme: ThemeName;
    applyTheme: () => void;
};

let pendingTransition: ThemeRequest | null = null;
let appliedTheme: ThemeName | null = null;
let flushPromise: Promise<void> | null = null;

function applyImmediately(applyTheme: () => void) {
    try {
        applyTheme();
    } catch {
        // A cosmetic theme update must not take down the canvas application.
    }
}

function flushThemeTransition() {
    const request = pendingTransition;
    pendingTransition = null;
    if (!request || request.theme === appliedTheme) return;

    const root = document.documentElement;
    applyImmediately(() => {
        root.classList.toggle("dark", request.theme === "dark");
        root.style.colorScheme = request.theme;
        request.applyTheme();
    });
    appliedTheme = request.theme;
}

export function applyThemeTransition(theme: ThemeName, applyTheme: () => void, _origin?: ThemeOrigin) {
    pendingTransition = { theme, applyTheme };
    if (!flushPromise) {
        flushPromise = Promise.resolve()
            .then(flushThemeTransition)
            .finally(() => {
                flushPromise = null;
                if (pendingTransition) {
                    applyThemeTransition(pendingTransition.theme, pendingTransition.applyTheme);
                }
            });
    }
    return flushPromise;
}
