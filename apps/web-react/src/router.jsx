import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { MigrationPreview } from "./views/MigrationPreview.jsx";
import { AppShell } from "./layout/AppShell.jsx";
import { AuthAccountView } from "./views/auth/AuthAccountView.jsx";
import { ProtectedCanvasRoute } from "./auth/ProtectedCanvasRoute.jsx";
import { importWithRecovery } from "./utils/dynamicImportRecovery.js";

const CanvasNativeLayout = lazy(() =>
  importWithRecovery(() => import("@canvas/native-layout.tsx")).then((module) => ({
    default: module.CanvasNativeLayout,
  })),
);
const CanvasProjectRoute = lazy(() =>
  importWithRecovery(() => import("@canvas/native-routes.tsx")).then((module) => ({
    default: module.CanvasProjectRoute,
  })),
);
const CanvasConfigRoute = lazy(() =>
  importWithRecovery(() => import("@canvas/native-routes.tsx")).then((module) => ({
    default: module.CanvasConfigRoute,
  })),
);

function canvasElement(Page) {
  return (
    <Suspense fallback={null}>
      <CanvasNativeLayout>
        <Page />
      </CanvasNativeLayout>
    </Suspense>
  );
}

function lazyView(importer, exportName) {
  return async () => {
    const module = await importWithRecovery(importer);
    return { Component: module[exportName] };
  };
}

function RouteHydrationFallback() {
  return null;
}

// Route changes must continue to pass the screenshot and interaction contracts
// maintained in apps/web-react/tests.
export const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthAccountView />,
  },
  {
    path: "/auth/login",
    element: <Navigate replace to="/auth?mode=login" />,
  },
  {
    path: "/auth/register",
    element: <Navigate replace to="/auth?mode=register" />,
  },
  {
    path: "/__migration",
    element: <MigrationPreview />,
  },
  {
    element: <AppShell />,
    HydrateFallback: RouteHydrationFallback,
    children: [
      {
        path: "/",
        lazy: lazyView(
          () => import("./views/CommercialHomeView.jsx"),
          "CommercialHomeView",
        ),
      },
      {
        path: "/ai-tools",
        lazy: lazyView(
          () => import("./views/AIToolsCatalogView.jsx"),
          "AIToolsCatalogView",
        ),
      },
      {
        path: "/prompts",
        lazy: lazyView(
          () => import("./views/PromptLibraryView.jsx"),
          "PromptLibraryView",
        ),
      },
      {
        path: "/studio",
        lazy: lazyView(
          () => import("./views/StudioHubView.jsx"),
          "StudioHubView",
        ),
      },
      {
        path: "/text-to-image",
        lazy: lazyView(
          () => import("./views/TextToImageView.jsx"),
          "TextToImageView",
        ),
      },
      {
        path: "/pricing",
        lazy: lazyView(() => import("./views/PricingView.jsx"), "PricingView"),
      },
      {
        path: "/share",
        lazy: lazyView(() => import("./views/ShareView.jsx"), "ShareView"),
      },
      {
        path: "/updates",
        lazy: lazyView(() => import("./views/UpdatesView.jsx"), "UpdatesView"),
      },
      {
        path: "/app-space",
        lazy: lazyView(
          () => import("./views/AppSpaceView.jsx"),
          "AppSpaceView",
        ),
      },
      {
        path: "/access-limited",
        lazy: lazyView(
          () => import("./views/AccessLimitedView.jsx"),
          "AccessLimitedView",
        ),
      },
      {
        path: "/tools",
        element: <Navigate replace to="/" />,
      },
      {
        path: "/tools/:modelId",
        lazy: lazyView(() => import("./views/MediaToolsView.jsx"), "MediaToolsView"),
      },
      {
        path: "/tools/puzzle",
        lazy: lazyView(() => import("./views/PuzzleView.jsx"), "PuzzleView"),
      },
      {
        path: "/ai-puzzle",
        element: <Navigate replace to="/tools/puzzle" />,
      },
      {
        path: "/tools/image-compress",
        lazy: lazyView(
          () => import("./views/ImageCompressView.jsx"),
          "ImageCompressView",
        ),
      },
          {
            path: "/feedback",
            lazy: lazyView(
              () => import("./views/FeedbackView.jsx"),
              "FeedbackView",
            ),
          },
          {
            path: "/assistant",
            lazy: lazyView(
              () => import("./views/AssistantWorkspaceView.jsx"),
              "AssistantWorkspaceView",
            ),
          },
          {
            path: "/ecommerce-design",
            lazy: lazyView(
              () => import("./views/EcommerceDesignView.jsx"),
              "EcommerceDesignView",
            ),
          },
          {
            path: "/ai-illustration-coloring",
            lazy: lazyView(
              () => import("./views/AiIllustrationColoringView.jsx"),
              "AiIllustrationColoringView",
            ),
          },
          {
            path: "/tools/background-remove",
            lazy: lazyView(
              () => import("./views/BackgroundRemoveView.jsx"),
              "BackgroundRemoveView",
            ),
          },
          {
            path: "/design-workshop",
            lazy: lazyView(
              () => import("./views/DesignWorkshopView.jsx"),
              "DesignWorkshopView",
            ),
          },
          {
            path: "/model-sheet",
            lazy: lazyView(
              () => import("./views/ModelSheetStudioView.jsx"),
              "ModelSheetStudioView",
            ),
          },
          {
            path: "/game-art",
            lazy: lazyView(
              () => import("./views/GameArtStudioView.jsx"),
              "GameArtStudioView",
            ),
          },
          {
            path: "/canvas",
            lazy: lazyView(
              () => import("@canvas/native-index-route.tsx"),
              "CanvasNativeIndexRoute",
            ),
          },
          {
            path: "/canvas/config",
            element: (
              <ProtectedCanvasRoute>
                {canvasElement(CanvasConfigRoute)}
              </ProtectedCanvasRoute>
            ),
          },
          {
            path: "/canvas/:id",
            element: (
              <ProtectedCanvasRoute>
                {canvasElement(CanvasProjectRoute)}
              </ProtectedCanvasRoute>
            ),
          },
          {
            path: "/check-in",
            lazy: lazyView(
              () => import("./views/CheckinView.jsx"),
              "CheckinView",
            ),
          },
          {
            path: "/history",
            lazy: lazyView(
              () => import("./views/HistoryView.jsx"),
              "HistoryView",
            ),
          },
          {
            path: "/profile",
            lazy: lazyView(
              () => import("./views/ProfileView.jsx"),
              "ProfileView",
            ),
          },
          {
            path: "/submissions",
            lazy: lazyView(
              () => import("./views/SubmissionsView.jsx"),
              "SubmissionsView",
            ),
          },
          {
            path: "/wallet",
            lazy: lazyView(
              () => import("./views/WalletView.jsx"),
              "WalletView",
            ),
          },
          {
            path: "/orders",
            lazy: lazyView(
              () => import("./views/OrdersView.jsx"),
              "OrdersView",
            ),
          },
          {
            path: "/account",
            lazy: lazyView(
              () => import("./views/AccountSettingsView.jsx"),
              "AccountSettingsView",
            ),
          },
          {
            path: "/developer-api",
            lazy: lazyView(
              () => import("./views/DeveloperAPIView.jsx"),
              "DeveloperAPIView",
            ),
          },
          {
            path: "/notifications",
            lazy: lazyView(
              () => import("./views/NotificationsView.jsx"),
              "NotificationsView",
            ),
          },
          {
            path: "/assets",
            lazy: lazyView(
              () => import("./views/MaterialsLibraryView.jsx"),
              "MaterialsLibraryView",
            ),
          },
          {
            path: "/materials",
            element: <Navigate replace to="/assets" />,
          },
          {
            path: "/incentive-plans",
            lazy: lazyView(
              () => import("./views/incentives/CreatorIncentivesRoute.jsx"),
              "CreatorIncentivesView",
            ),
          },
          {
            path: "/incentive-plans/group",
            lazy: lazyView(
              () => import("./views/incentives/FriendGroupRoute.jsx"),
              "FriendGroupView",
            ),
          },
          {
            path: "/incentive-plans/membership",
            lazy: lazyView(
              () => import("./views/incentives/MembershipPlanRoute.jsx"),
              "MembershipPlanView",
            ),
          },
          {
            path: "/incentive-plans/failure",
            lazy: lazyView(
              () => import("./views/incentives/FailureCompensationRoute.jsx"),
              "FailureCompensationView",
            ),
          },
          {
            path: "/incentive-plans/suggestion",
            lazy: lazyView(
              () => import("./views/incentives/SuggestionAdoptionRoute.jsx"),
              "SuggestionAdoptionView",
            ),
          },
          {
            path: "/incentive-plans/usage",
            lazy: lazyView(
              () => import("./views/incentives/UsagePlanRoute.jsx"),
              "UsagePlanView",
            ),
          },
          {
            path: "/incentive-plans/milestone",
            element: <Navigate replace to="/incentive-plans/usage" />,
          },
          {
            path: "/incentive-plans/:program",
            lazy: lazyView(
              () =>
                import("./views/incentives/CreatorIncentiveDetailRoute.jsx"),
              "CreatorIncentiveDetailView",
            ),
          },
      {
        path: "*",
        lazy: lazyView(
          () => import("./views/NotFoundView.jsx"),
          "NotFoundView",
        ),
      },
    ],
  },
]);
