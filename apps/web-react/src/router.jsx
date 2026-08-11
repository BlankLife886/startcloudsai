import { createBrowserRouter, Navigate } from "react-router";
import { MigrationPreview } from "./views/MigrationPreview.jsx";
import { AppShell } from "./layout/AppShell.jsx";
import { RequireAuth } from "./auth/AuthContext.jsx";

function lazyView(importer, exportName) {
  return async () => {
    const module = await importer();
    return { Component: module[exportName] };
  };
}

// Production paths are intentionally absent until their React implementations
// pass the Vue screenshot and interaction contracts in apps/web.
export const router = createBrowserRouter([
  {
    path: "/auth",
    lazy: lazyView(
      () => import("./views/auth/AuthAccountView.jsx"),
      "AuthAccountView",
    ),
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
    children: [
      {
        path: "/",
        lazy: lazyView(
          () => import("./views/CommercialHomeView.jsx"),
          "CommercialHomeView",
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
        element: <RequireAuth />,
        children: [
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
              () => import("./views/CanvasAppView.jsx"),
              "CanvasAppView",
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
            path: "/account",
            lazy: lazyView(
              () => import("./views/AccountSettingsView.jsx"),
              "AccountSettingsView",
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
            path: "/materials",
            lazy: lazyView(
              () => import("./views/MaterialsLibraryView.jsx"),
              "MaterialsLibraryView",
            ),
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
        ],
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
