import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { ensureCanvasOverlayRoot, syncCanvasOverlayTheme } from "@/lib/canvas-portal";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AppLocale } from "@/i18n";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

const antdLocales = { "zh-CN": zhCN, "zh-TW": zhTW, en: enUS };

export function AppProviders({ children, locale = "zh-CN" }: { children: ReactNode; locale?: AppLocale }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
        syncCanvasOverlayTheme(dark);
    }, [dark, theme]);

    return (
        <ConfigProvider
            locale={antdLocales[locale]}
            theme={getAntThemeConfig(dark)}
            getPopupContainer={() => ensureCanvasOverlayRoot()}
        >
            <App>
                <QueryClientProvider client={queryClient}>
                    <ClientRootInit>{children}</ClientRootInit>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
