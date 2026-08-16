import { lazy, Suspense, type ReactNode } from "react";
import { useLocation } from "react-router";

import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const location = useLocation();
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const canvasHome = location.pathname === "/canvas";

    return (
        <div className={`flex overflow-hidden text-foreground${canvasHome ? " canvas-home-shell h-full" : " h-dvh bg-background"}`}>
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
