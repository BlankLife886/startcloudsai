import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { NavBar } from "./NavBar.jsx";
import { AuthPromptProvider } from "../auth/AuthPromptContext.jsx";
import { useRouteMotion } from "../components/motion/RouteMotionController.jsx";
import { PageAccessBoundary } from "../page-control/PageAccessBoundary.jsx";
import { PageControlProvider } from "../page-control/PageControlContext.jsx";
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
  const location = useLocation();
  const mainRef = useRef(null);
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
  }, [canvasEditor, canvasHome]);

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
  if (location.pathname === "/updates")
    mainClasses.push("main--updates-gallery");
  if (location.pathname === "/tools/image-compress") {
    mainClasses.push("main--image-compress");
  }
  if (location.pathname === "/tools/background-remove") {
    mainClasses.push("main--background-remove");
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
          <NavBar />
          <main ref={mainRef} className={mainClasses.join(" ")}>
            <PageAccessBoundary />
          </main>
        </div>
      </AuthPromptProvider>
    </PageControlProvider>
  );
}
