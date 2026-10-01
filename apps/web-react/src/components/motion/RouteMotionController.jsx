import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const CUSTOM_MOTION_ROUTES = new Set([
  "/",
  "/prompts",
  "/studio",
  "/text-to-image",
  "/ecommerce-design",
  "/share",
  "/profile",
  "/model-sheet",
  "/game-art",
]);

const FADE_ONLY_ROUTES = new Set([
  "/assistant",
  "/ai-illustration-coloring",
  "/design-workshop",
  "/tools/puzzle",
  "/tools/image-compress",
  "/tools/background-remove",
]);

function animationsDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function routeMotionMode(pathname) {
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return "native";
  if (CUSTOM_MOTION_ROUTES.has(pathname)) return "custom";
  if (FADE_ONLY_ROUTES.has(pathname)) return "fade";
  return "page";
}

function routeChildren(root) {
  return Array.from(root?.children || []).filter(
    (element) =>
      element instanceof HTMLElement &&
      !element.hasAttribute("data-route-motion-ignore"),
  );
}

export function useRouteMotion({ pathname, rootRef }) {
  const runIdRef = useRef(0);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return undefined;

      const mode = routeMotionMode(pathname);
      const runId = ++runIdRef.current;
      root.dataset.routeMotionMode = mode;
      root.dataset.routeMotionState = mode === "page" || mode === "fade" ? "waiting" : mode;

      if (mode === "native" || mode === "custom") return undefined;

      let frame = 0;
      let observer;
      let animation;
      let completed = false;

      const reveal = () => {
        if (completed || runId !== runIdRef.current) return;
        const targets = routeChildren(root);
        if (!targets.length) return;
        completed = true;
        observer?.disconnect();
        root.dataset.routeMotionState = "entering";
        for (const target of targets) target.dataset.routeMotionTarget = "";

        if (animationsDisabled()) {
          gsap.set(targets, { clearProps: "opacity,visibility,transform" });
          root.dataset.routeMotionState = "entered";
          return;
        }

        animation = gsap.fromTo(
          targets,
          {
            autoAlpha: 0,
            y: mode === "page" ? 10 : 0,
          },
          {
            autoAlpha: 1,
            y: 0,
            duration: mode === "page" ? 0.4 : 0.28,
            stagger: targets.length > 1 ? 0.045 : 0,
            ease: "power2.out",
            clearProps: "opacity,visibility,transform",
            onComplete: () => {
              if (runId === runIdRef.current) root.dataset.routeMotionState = "entered";
            },
          },
        );
      };

      frame = window.requestAnimationFrame(reveal);
      if (!routeChildren(root).length && typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => {
          window.cancelAnimationFrame(frame);
          frame = window.requestAnimationFrame(reveal);
        });
        observer.observe(root, { childList: true });
      }

      return () => {
        window.cancelAnimationFrame(frame);
        observer?.disconnect();
        animation?.kill();
        const targets = routeChildren(root);
        if (targets.length) {
          gsap.set(targets, { clearProps: "opacity,visibility,transform" });
        }
        for (const target of targets) delete target.dataset.routeMotionTarget;
      };
    },
    {
      dependencies: [pathname],
      scope: rootRef,
      revertOnUpdate: true,
    },
  );

}
