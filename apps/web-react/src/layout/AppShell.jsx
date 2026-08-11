import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { NavBar } from "./NavBar.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import "@legacy/App.vue?react-style";

const documentScrollRoutes = new Set([
  "/",
  "/pricing",
  "/updates",
  "/studio",
  "/prompts",
  "/history",
  "/share",
]);

const incentiveCanvasRoutes = new Set([
  "/incentive-plans",
  "/incentive-plans/membership",
  "/incentive-plans/failure",
  "/incentive-plans/suggestion",
  "/incentive-plans/usage",
  "/incentive-plans/milestone",
]);

export function AppShell() {
  const location = useLocation();
  const auth = useAuth();
  const mainRef = useRef(null);
  const textToImageGate =
    location.pathname === "/text-to-image" && !auth.isAuthenticated;
  const documentScroll =
    documentScrollRoutes.has(location.pathname) || textToImageGate;

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

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
  if (location.pathname === "/canvas") {
    mainClasses.push("main--canvas-app");
  }
  if (location.pathname === "/check-in") mainClasses.push("main--checkin");
  if (
    (location.pathname === "/text-to-image" && auth.isAuthenticated) ||
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
    <div
      className={`app-container${documentScroll ? " app--document-scroll" : ""}`}
    >
      <NavBar />
      <main ref={mainRef} className={mainClasses.join(" ")}>
        <Outlet />
      </main>
    </div>
  );
}
