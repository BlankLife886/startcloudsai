import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { loadCanvasBackgroundRemovalTool } from "@/lib/canvas/canvas-background-removal-tool";
import { fetchSiteModelCatalog } from "@/services/site-model-catalog";
import { useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const loading = useRef(false);
    const installSiteCatalog = useConfigStore((state) => state.installSiteCatalog);

    useEffect(() => {
        if (loading.current) return;
        loading.current = true;
        void fetchSiteModelCatalog()
            .then(({ channel, defaults }) => installSiteCatalog(channel, defaults))
            .catch((error) => message.error(error instanceof Error ? error.message : "模型目录加载失败"));
        void loadCanvasBackgroundRemovalTool().catch(() => undefined);
    }, [installSiteCatalog, message]);

    return <>{children}</>;
}
