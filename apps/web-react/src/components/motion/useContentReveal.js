import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

function animationsDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

export function useContentReveal({
  rootRef,
  selector,
  ready = true,
  resetKey = "",
  contentKey = "",
  identityAttribute = "",
  stateAttribute = "data-content-reveal-state",
  maxItems = 36,
}) {
  const seenRef = useRef(new WeakSet());
  const seenIdsRef = useRef(new Set());
  const resetKeyRef = useRef(resetKey);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root || !selector) return undefined;

      if (resetKeyRef.current !== resetKey) {
        resetKeyRef.current = resetKey;
        seenRef.current = new WeakSet();
        seenIdsRef.current = new Set();
      }
      if (!ready) {
        root.setAttribute(stateAttribute, "loading");
        return undefined;
      }

      let firstFrame = 0;
      let secondFrame = 0;
      let animation;
      const isUnseen = (element) => {
        const id = identityAttribute
          ? String(element.getAttribute(identityAttribute) || "")
          : "";
        if (id) return !seenIdsRef.current.has(id);
        return !seenRef.current.has(element);
      };
      const markSeen = (element) => {
        const id = identityAttribute
          ? String(element.getAttribute(identityAttribute) || "")
          : "";
        if (id) seenIdsRef.current.add(id);
        seenRef.current.add(element);
        element.setAttribute("data-content-reveal-target", "");
      };
      const reveal = () => {
        const candidates = gsap.utils.toArray(selector, root);
        const unseen = candidates
          .filter(isUnseen)
          .slice(0, Math.max(1, maxItems));
        if (!unseen.length) {
          root.setAttribute(stateAttribute, "entered");
          return;
        }
        unseen.forEach(markSeen);
        root.setAttribute(stateAttribute, "entering");
        if (animationsDisabled()) {
          gsap.set(unseen, { clearProps: "opacity,visibility" });
          root.setAttribute(stateAttribute, "entered");
          return;
        }
        animation = gsap.fromTo(
          unseen,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: 0.34,
            stagger: 0.035,
            ease: "power2.out",
            clearProps: "opacity,visibility",
            onComplete: () => root.setAttribute(stateAttribute, "entered"),
          },
        );
      };

      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(reveal);
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
        animation?.kill();
        const targets = gsap.utils.toArray(selector, root);
        gsap.set(targets, { clearProps: "opacity,visibility" });
      };
    },
    {
      dependencies: [ready, resetKey, contentKey, selector],
      scope: rootRef,
    },
  );
}
