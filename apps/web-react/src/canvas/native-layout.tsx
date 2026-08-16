import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "@/styles/globals.css";

import { useAuth } from "@react/auth/AuthContext.jsx";
import { useAuthPrompt } from "@react/auth/AuthPromptContext.jsx";
import { useIsDark } from "@react/hooks/useIsDark.js";
import { useLocale } from "@react/i18n/index.js";
import "./CanvasNativeLayout.css";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { AppProviders } from "@/components/layout/app-providers";
import { CanvasHostProvider } from "@/components/layout/canvas-host-context";
import UserLayout from "@/layouts/user-layout";
import canvasI18n, { changeAppLocale } from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasRenameProjectDialog } from "@/components/canvas/canvas-rename-project-dialog";
import { disconnectCanvasCloudSync, prepareCanvasCloudSync } from "@/stores/canvas/use-canvas-store";
import { ensureCanvasOverlayRoot, removeCanvasOverlayRoot, syncCanvasOverlayTheme } from "@/lib/canvas-portal";

gsap.registerPlugin(useGSAP);

type HostAuthState = {
    isAuthenticated: boolean;
    user: { id?: string | number } | null;
};

type HostAuthPrompt = {
    requestAuth: (options: { featureLabel: string }) => void;
};

function canvasMotionDisabled() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("settings-no-animations");
}

function CanvasRouteEntry({ children }: { children: ReactNode }) {
    const location = useLocation();
    const rootRef = useRef<HTMLDivElement>(null);
    const home = location.pathname === "/canvas";

    useGSAP(
        (context, contextSafe) => {
            const root = rootRef.current;
            if (!root) return;
            if (home || canvasMotionDisabled()) {
                gsap.set(root, { autoAlpha: 1, clearProps: "transform" });
                root.dataset.canvasRouteMotionState = home ? "custom" : "entered";
                return;
            }
            root.dataset.canvasRouteMotionState = "entering";
            const finish = (contextSafe || ((callback) => callback))(() => {
                root.dataset.canvasRouteMotionState = "entered";
            });
            gsap.fromTo(
                root,
                { autoAlpha: 0 },
                {
                    autoAlpha: 1,
                    duration: 0.22,
                    ease: "power1.out",
                    clearProps: "opacity,visibility",
                    onComplete: finish,
                },
            );
        },
        { dependencies: [home, location.key], scope: rootRef, revertOnUpdate: true },
    );

    return (
        <div
            ref={rootRef}
            className="canvas-native-route-entry"
            data-canvas-route-motion={home ? "home" : "fade"}
            data-canvas-route-motion-state={home ? "custom" : "waiting"}
        >
            {children}
        </div>
    );
}

export function CanvasNativeLayout({ children }: { children?: ReactNode }) {
    const auth = useAuth() as HostAuthState;
    const { requestAuth } = useAuthPrompt() as HostAuthPrompt;
    const isDark = useIsDark();
    const { locale } = useLocale();
    const theme = isDark ? "dark" : "light";

    if (useThemeStore.getState().theme !== theme) {
        useThemeStore.setState({ theme });
    }
    if (canvasI18n.resolvedLanguage !== locale) {
        void changeAppLocale(locale);
    }

    useLayoutEffect(() => {
        const root = document.documentElement;
        const body = document.body;
        const header = document.querySelector<HTMLElement>(".site-header");
        const updateHeaderOffset = () => {
            const height = Math.max(62, Math.round(header?.getBoundingClientRect().height || 0));
            root.style.setProperty("--starclouds-host-header-offset", `${height}px`);
        };

        root.classList.add("starclouds-hosted");
        body.classList.add("canvas-native-active");
        body.classList.toggle("dark", isDark);
        useThemeStore.getState().setTheme(theme);
        syncCanvasOverlayTheme(isDark);
        updateHeaderOffset();

        const observer = header && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeaderOffset) : null;
        if (header && observer) observer.observe(header);
        return () => {
            observer?.disconnect();
            root.classList.remove("starclouds-hosted");
            body.classList.remove("canvas-native-active", "dark");
            root.style.removeProperty("--starclouds-host-header-offset");
        };
    }, [isDark, theme]);

    useLayoutEffect(() => () => removeCanvasOverlayRoot(), []);

    useEffect(() => {
        void changeAppLocale(locale);
    }, [locale]);

    useLayoutEffect(() => {
        if (auth.isAuthenticated && auth.user?.id) {
            void prepareCanvasCloudSync(String(auth.user.id));
            return;
        }
        disconnectCanvasCloudSync();
    }, [auth.isAuthenticated, auth.user?.id]);

    return (
        <section className="canvas-app-view canvas-native-view">
            <div data-no-translate className={`canvas-native-mount starclouds-hosted is-ready${isDark ? " dark" : ""}`}>
                <CanvasHostProvider isAuthenticated={auth.isAuthenticated} requestAuth={() => requestAuth({ featureLabel: "无限画布" })}>
                    <AppProviders locale={locale}>
                        <UserLayout>
                            <AnalyticsTracker />
                            <CanvasRouteEntry>{children || <Outlet />}</CanvasRouteEntry>
                            <CanvasRenameProjectDialog />
                            <CanvasDeleteProjectsDialog />
                        </UserLayout>
                    </AppProviders>
                </CanvasHostProvider>
            </div>
        </section>
    );
}
