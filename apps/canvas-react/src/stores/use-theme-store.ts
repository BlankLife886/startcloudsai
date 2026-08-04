import { create } from "zustand";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

function initialTheme(): ThemeName {
    if (typeof window === "undefined") return "light";
    return new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
}

export const useThemeStore = create<ThemeStore>()((set) => ({
    theme: initialTheme(),
    setTheme: (theme) => set({ theme }),
}));
