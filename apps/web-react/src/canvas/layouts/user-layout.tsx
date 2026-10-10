import { type ReactNode } from "react";
import { useLocation } from "react-router";

export default function UserLayout({ children }: { children: ReactNode }) {
    const location = useLocation();
    const canvasHome = location.pathname === "/canvas";

    return (
        <div className={`flex overflow-hidden text-foreground${canvasHome ? " canvas-home-shell h-full" : " h-dvh"}`}>
            <div className="canvas-app-content min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
