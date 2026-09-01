import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigation } from "react-router";
import { ClientAnnouncementHost } from "../components/ClientAnnouncementHost.jsx";
import { NavBar } from "./NavBar.jsx";
import { AuthPromptProvider } from "../auth/AuthPromptContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { useRouteMotion } from "../components/motion/RouteMotionController.jsx";
import { PageAccessBoundary } from "../page-control/PageAccessBoundary.jsx";
import { PageControlProvider } from "../page-control/PageControlContext.jsx";
import { prefetchRoute } from "../routePrefetch.js";
import {
  behaviorFeatureFromPath,
  setBehaviorTrackingEnabled,
  trackBehaviorEvent,
} from "@react/legacy-modules/services/behaviorTracker.js";
import "@react/legacy-styles/generated/App.css";

const documentScrollRoutes = new Set([
  "/",
  "/pricing",
  "/updates",
  "/studio",
  "/prompts",
  "/history",
  "/submissions",
  "/share",
]);

const incentiveCanvasRoutes = new Set([
  "/incentive-plans",
  "/incentive-plans/group",
  "/incentive-plans/membership",
  "/incentive-plans/failure",
  "/incentive-plans/suggestion",
  "/incentive-plans/usage",
  "/incentive-plans/milestone",
]);

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const navigation = useNavigation();
  const mainRef = useRef(null);
  const navigating = navigation.state !== "idle";
  const documentScroll = documentScrollRoutes.has(location.pathname);
  const canvasHome = location.pathname === "/canvas";
  const canvasEditor = location.pathname.startsWith("/canvas/");

  useRouteMotion({
    pathname: location.pathname,
    rootRef: mainRef,
  });

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.classList.toggle(
      "canvas-entry",
      canvasHome || canvasEditor,
    );
    document.documentElement.classList.toggle("canvas-editor", canvasEditor);
  }, [canvasEditor, canvasHome]);

  useEffect(() => {
    setBehaviorTrackingEnabled(auth.isAuthenticated);
    if (auth.isAuthenticated) {
      trackBehaviorEvent("feature_open", behaviorFeatureFromPath(location.pathname));
    }
  }, [auth.isAuthenticated, location.pathname]);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const scrollTop = Math.max(0, window.scrollY || root.scrollTop || 0);
      const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
      root.classList.toggle("is-page-scrolled", scrollTop > 10);
      root.classList.toggle("has-page-scroll", maxScroll > 24);
      root.style.setProperty(
        "--page-scroll-ratio",
        maxScroll ? String(scrollTop / maxScroll) : "0",
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const prefetchAnchor = (event) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin) void prefetchRoute(url.pathname);
    };
    document.addEventListener("pointerover", prefetchAnchor, { passive: true });
    document.addEventListener("focusin", prefetchAnchor);

    return () => {
      document.removeEventListener("pointerover", prefetchAnchor);
      document.removeEventListener("focusin", prefetchAnchor);
    };
  }, []);

  const mainClasses = ["main-content"];
  if (documentScroll) mainClasses.push("main--document-scroll");
  if (location.pathname === "/pricing")
    mainClasses.push("main--pricing-console");
  if (location.pathname === "/profile")
    mainClasses.push("main--profile-console");
  if (location.pathname === "/wallet")
    mainClasses.push("main--wallet-console");
  if (location.pathname === "/account")
    mainClasses.push("main--settings-console");
  if (location.pathname === "/developer-api")
    mainClasses.push("main--developer-console");
  if (location.pathname === "/updates")
    mainClasses.push("main--updates-gallery");
  if (location.pathname === "/tools/image-compress") {
    mainClasses.push("main--image-compress");
  }
  if (location.pathname === "/tools/background-remove") {
    mainClasses.push("main--background-remove");
  }
  if (location.pathname === "/tools" || (location.pathname.startsWith("/tools/") && !location.pathname.startsWith("/tools/background-remove") && !location.pathname.startsWith("/tools/image-compress") && !location.pathname.startsWith("/tools/puzzle"))) {
    mainClasses.push("main--media-tools");
  }
  if (location.pathname === "/design-workshop") {
    mainClasses.push("main--design-workshop");
  }
  if (location.pathname === "/model-sheet") {
    mainClasses.push("main--model-sheet");
  }
  if (location.pathname === "/game-art") {
    mainClasses.push("main--game-art");
  }
  if (canvasHome) mainClasses.push("main--canvas-home");
  if (canvasEditor) mainClasses.push("main--canvas-app");
  if (location.pathname === "/check-in") mainClasses.push("main--checkin");
  if (
    location.pathname === "/text-to-image" ||
    location.pathname === "/assistant" ||
    location.pathname === "/ecommerce-design" ||
    location.pathname === "/ai-illustration-coloring" ||
    location.pathname === "/design-workshop" ||
    location.pathname === "/model-sheet" ||
    location.pathname === "/game-art"
  ) {
    mainClasses.push("main--studio-console");
  }
  if (incentiveCanvasRoutes.has(location.pathname)) {
    mainClasses.push("main--incentives");
  }

  return (
    <PageControlProvider>
      <AuthPromptProvider>
        <div className={`app-container${documentScroll ? " app--document-scroll" : ""}`}>
          {navigating && (
            <div
              className="route-navigation-progress"
              role="progressbar"
              aria-label="页面切换中"
            >
              <span />
            </div>
          )}
          <NavBar />
          <ClientAnnouncementHost />
          <main
            ref={mainRef}
            className={mainClasses.join(" ")}
            aria-busy={navigating ? "true" : undefined}
          >
            <PageAccessBoundary />
          </main>
        </div>
      </AuthPromptProvider>
    </PageControlProvider>
  );
}
