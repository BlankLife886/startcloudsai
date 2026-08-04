import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { fetchSiteModelCatalog } from "@/services/site-model-catalog";
import { getHostAppOrigin } from "@/lib/host-app";
import { applyThemeTransition } from "@/lib/theme-transition";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";

const CANVAS_THEME_MESSAGE = "starclouds:canvas:theme";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const loading = useRef(false);
    const installSiteCatalog = useConfigStore((state) => state.installSiteCatalog);
    const setTheme = useThemeStore((state) => state.setTheme);

    useEffect(() => {
        const hostOrigin = getHostAppOrigin();
        const root = document.documentElement;
        if (window.parent !== window) root.classList.add("starclouds-hosted");
        const handleHostMessage = (event: MessageEvent) => {
            if (window.parent === window || event.source !== window.parent || event.origin !== hostOrigin) return;
            if (event.data?.type !== CANVAS_THEME_MESSAGE || (event.data.theme !== "light" && event.data.theme !== "dark")) return;
            const headerOffset = Number(event.data.headerOffset);
            if (Number.isFinite(headerOffset) && headerOffset >= 0 && headerOffset <= 160) {
                root.style.setProperty("--starclouds-host-header-offset", `${headerOffset}px`);
            }
            const theme = event.data.theme as ThemeName;
            if (useThemeStore.getState().theme === theme) return;
            applyThemeTransition(theme, () => setTheme(theme), event.data.origin);
        };
        window.addEventListener("message", handleHostMessage);
        return () => {
            window.removeEventListener("message", handleHostMessage);
            root.classList.remove("starclouds-hosted");
            root.style.removeProperty("--starclouds-host-header-offset");
        };
    }, [setTheme]);

    useEffect(() => {
        if (loading.current) return;
        loading.current = true;
        void fetchSiteModelCatalog()
            .then(({ channel, defaults }) => installSiteCatalog(channel, defaults))
            .catch((error) => message.error(error instanceof Error ? error.message : "本站模型目录加载失败"));
    }, [installSiteCatalog, message]);

    return <>{children}</>;
}
