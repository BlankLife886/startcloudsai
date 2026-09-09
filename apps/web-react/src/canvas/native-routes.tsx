import { lazy, Suspense } from "react";

const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));

export function CanvasProjectRoute() {
    return <Suspense fallback={null}><CanvasProjectPage /></Suspense>;
}

export function CanvasConfigRoute() {
    return <Suspense fallback={null}><ConfigPage /></Suspense>;
}
