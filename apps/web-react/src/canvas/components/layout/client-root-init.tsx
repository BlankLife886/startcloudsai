import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { loadCanvasBackgroundRemovalTool } from "@/lib/canvas/canvas-background-removal-tool";
import { fetchSiteModelCatalog } from "@/services/site-model-catalog";
import { useConfigStore } from "@/stores/use-config-store";
import { onSitePricesChanged } from "@react/legacy-modules/services/runtimeConfig.js";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const loading = useRef(false);
    const installSiteCatalog = useConfigStore((state) => state.installSiteCatalog);
    const refreshSiteCatalog = useConfigStore((state) => state.refreshSiteCatalog);

    useEffect(() => {
        if (loading.current) return;
        loading.current = true;
        void fetchSiteModelCatalog()
            .then(({ channel, defaults, agentPricing, batchMaxCount }) => installSiteCatalog(channel, defaults, agentPricing, batchMaxCount))
            .catch((error) => message.error(error instanceof Error ? error.message : "模型目录加载失败"));
        void loadCanvasBackgroundRemovalTool().catch(() => undefined);
    }, [installSiteCatalog, message]);

    // 动态调价到点：重新读取模型目录，价格和「限时调价」标签随之更新。
    useEffect(() => onSitePricesChanged(() => {
        void fetchSiteModelCatalog().then(({ channel }) => refreshSiteCatalog(channel)).catch(() => undefined);
    }), [refreshSiteCatalog]);

    return <>{children}</>;
}
