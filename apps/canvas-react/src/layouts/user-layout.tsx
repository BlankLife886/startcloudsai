import { lazy, Suspense, type ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AppSidebar />
            <div className="canvas-app-content min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
            {panelOpen || panelClosing ? (
                <div className="canvas-app-agent-slot flex min-h-0 shrink-0">
                    <Suspense fallback={null}>
                        <AgentPanel />
                    </Suspense>
                </div>
            ) : null}
        </div>
    );
}
