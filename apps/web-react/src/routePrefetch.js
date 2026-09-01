const routePreloaders = new Map([
  ["/", () => import("./views/CommercialHomeView.jsx")],
  ["/studio", () => import("./views/StudioHubView.jsx")],
  ["/prompts", () => import("./views/PromptLibraryView.jsx")],
  ["/text-to-image", () => import("./views/TextToImageView.jsx")],
  ["/pricing", () => import("./views/PricingView.jsx")],
  ["/share", () => import("./views/ShareView.jsx")],
  ["/updates", () => import("./views/UpdatesView.jsx")],
  ["/assistant", () => import("./views/AssistantWorkspaceView.jsx")],
  ["/ecommerce-design", () => import("./views/EcommerceDesignView.jsx")],
  ["/ai-illustration-coloring", () => import("./views/AiIllustrationColoringView.jsx")],
  ["/design-workshop", () => import("./views/DesignWorkshopView.jsx")],
  ["/model-sheet", () => import("./views/ModelSheetStudioView.jsx")],
  ["/game-art", () => import("./views/GameArtStudioView.jsx")],
  ["/canvas", () => import("@canvas/native-index-route.tsx")],
  ["/canvas/config", () => import("@canvas/native-routes.tsx")],
  ["/check-in", () => import("./views/CheckinView.jsx")],
  ["/history", () => import("./views/HistoryView.jsx")],
  ["/profile", () => import("./views/ProfileView.jsx")],
  ["/submissions", () => import("./views/SubmissionsView.jsx")],
  ["/wallet", () => import("./views/WalletView.jsx")],
  ["/orders", () => import("./views/OrdersView.jsx")],
  ["/account", () => import("./views/AccountSettingsView.jsx")],
  ["/developer-api", () => import("./views/DeveloperAPIView.jsx")],
  ["/notifications", () => import("./views/NotificationsView.jsx")],
  ["/assets", () => import("./views/MaterialsLibraryView.jsx")],
  ["/tools/puzzle", () => import("./views/PuzzleView.jsx")],
  ["/tools/image-compress", () => import("./views/ImageCompressView.jsx")],
  ["/tools/background-remove", () => import("./views/BackgroundRemoveView.jsx")],
  ["/feedback", () => import("./views/FeedbackView.jsx")],
  ["/incentive-plans", () => import("./views/incentives/CreatorIncentivesRoute.jsx")],
  ["/incentive-plans/group", () => import("./views/incentives/FriendGroupRoute.jsx")],
  ["/incentive-plans/membership", () => import("./views/incentives/MembershipPlanRoute.jsx")],
  ["/incentive-plans/failure", () => import("./views/incentives/FailureCompensationRoute.jsx")],
  ["/incentive-plans/suggestion", () => import("./views/incentives/SuggestionAdoptionRoute.jsx")],
  ["/incentive-plans/usage", () => import("./views/incentives/UsagePlanRoute.jsx")],
]);

const prefetchedRoutes = new Map();

function preloaderForPath(pathname) {
  const exactPreloader = routePreloaders.get(pathname);
  if (exactPreloader) return exactPreloader;
  if (pathname.startsWith("/canvas/")) return routePreloaders.get("/canvas/config");
  if (pathname.startsWith("/tools/")) return () => import("./views/MediaToolsView.jsx");
  if (pathname.startsWith("/incentive-plans/")) {
    return () => import("./views/incentives/CreatorIncentiveDetailRoute.jsx");
  }
  return undefined;
}

export function prefetchRoute(pathname) {
  const normalized = String(pathname || "").split(/[?#]/, 1)[0] || "/";
  if (prefetchedRoutes.has(normalized)) return prefetchedRoutes.get(normalized);
  const preloader = preloaderForPath(normalized);
  if (!preloader) return Promise.resolve(null);

  const request = preloader().catch(() => {
    prefetchedRoutes.delete(normalized);
    return null;
  });
  prefetchedRoutes.set(normalized, request);
  return request;
}
