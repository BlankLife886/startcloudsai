import type { ThemeName } from "@/stores/use-theme-store";

type ThemeOrigin = { x?: unknown; y?: unknown } | null | undefined;

export function applyThemeTransition(theme: ThemeName, applyTheme: () => void, origin?: ThemeOrigin) {
    const root = document.documentElement;
    const update = () => {
        root.classList.toggle("dark", theme === "dark");
        root.style.colorScheme = theme;
        applyTheme();
    };
    if (typeof document.startViewTransition !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        update();
        return;
    }

    const rawX = Number(origin?.x);
    const rawY = Number(origin?.y);
    const x = Number.isFinite(rawX) ? rawX : window.innerWidth / 2;
    const y = Number.isFinite(rawY) ? rawY : window.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(update);
    void transition.ready
        .then(() =>
            root.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
                { duration: 400, easing: "ease-in-out", fill: "forwards", pseudoElement: "::view-transition-new(root)" },
            ),
        )
        .catch(() => undefined);
}
