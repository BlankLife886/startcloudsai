import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createMemoryRouter, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "@/styles/globals.css";

import { AppProviders } from "@/components/layout/app-providers";
import { createCanvasRoutes } from "@/router";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";

type CanvasEmbeddedAppProps = {
    path: string;
    theme: ThemeName;
    headerOffset: number;
    onPathChange?: (path: string) => void;
    onReady?: () => void;
};

function EmbeddedRouteSync({ onPathChange }: { onPathChange: (path: string) => void }) {
    const location = useLocation();

    useEffect(() => {
        onPathChange(`${location.pathname}${location.search}${location.hash}`);
    }, [location.hash, location.pathname, location.search, onPathChange]);

    return null;
}

function hostedRouteSync(callbackRef: React.MutableRefObject<CanvasEmbeddedAppProps["onPathChange"]>): ReactNode {
    return <EmbeddedRouteSync onPathChange={(path) => callbackRef.current?.(path)} />;
}

export function CanvasEmbeddedApp({ path, theme, headerOffset, onPathChange, onReady }: CanvasEmbeddedAppProps) {
    const callbackRef = useRef(onPathChange);
    const readyRef = useRef(onReady);
    const routerRef = useRef<ReturnType<typeof createMemoryRouter> | null>(null);
    callbackRef.current = onPathChange;
    readyRef.current = onReady;

    if (!routerRef.current) {
        routerRef.current = createMemoryRouter(createCanvasRoutes(hostedRouteSync(callbackRef)), {
            initialEntries: [path],
        });
    }
    const memoryRouter = routerRef.current;
    const popupContainer = document.querySelector<HTMLElement>(".canvas-native-mount");

    useLayoutEffect(() => {
        const root = document.documentElement;
        const body = document.body;
        root.classList.add("starclouds-hosted");
        root.style.setProperty("--starclouds-host-header-offset", `${Math.max(0, Math.min(160, Math.round(headerOffset)))}px`);
        body.classList.add("canvas-native-active");
        body.classList.toggle("dark", theme === "dark");
        useThemeStore.getState().setTheme(theme);
    }, [headerOffset, theme]);

    useEffect(() => {
        const current = memoryRouter.state.location;
        const currentPath = `${current.pathname}${current.search}${current.hash}`;
        if (currentPath !== path) void memoryRouter.navigate(path, { replace: true });
    }, [memoryRouter, path]);

    useEffect(() => {
        readyRef.current?.();
    }, []);

    useEffect(
        () => () => {
            memoryRouter.dispose();
            const root = document.documentElement;
            const body = document.body;
            root.classList.remove("starclouds-hosted", "dark");
            body.classList.remove("canvas-native-active", "dark");
            root.style.removeProperty("--starclouds-host-header-offset");
            root.style.removeProperty("color-scheme");
        },
        [memoryRouter],
    );

    return (
        <AppProviders popupContainer={popupContainer}>
            <RouterProvider router={memoryRouter} />
        </AppProviders>
    );
}
