import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { HostRouteSync } from "@/components/layout/host-route-sync";
import UserLayout from "@/layouts/user-layout";

const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function PageFallback() {
    return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在加载...</main>;
}

function lazyPage(page: ReactNode) {
    return <Suspense fallback={<PageFallback />}>{page}</Suspense>;
}

const basename = import.meta.env.BASE_URL === "/" ? "/" : import.meta.env.BASE_URL.replace(/\/$/, "");

export const router = createBrowserRouter(
    [
        {
            element: (
                <UserLayout>
                    <AnalyticsTracker />
                    <HostRouteSync />
                    <Outlet />
                </UserLayout>
            ),
            children: [
                { path: "/", element: lazyPage(<HomePage />) },
                { path: "/image", element: lazyPage(<ImagePage />) },
                { path: "/video", element: lazyPage(<VideoPage />) },
                { path: "/assets", element: lazyPage(<AssetsPage />) },
                { path: "/prompts", element: lazyPage(<PromptsPage />) },
                { path: "/canvas", element: lazyPage(<CanvasPage />) },
                { path: "/canvas/:id", element: lazyPage(<CanvasProjectPage />) },
                { path: "/config", element: lazyPage(<ConfigPage />) },
            ],
        },
        { path: "*", element: lazyPage(<NotFound />) },
    ],
    { basename },
);
