import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function useHomeMotion(rootRef) {
  const entered = useRef(false);
  const [motionOff, setMotionOff] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.classList.contains("settings-no-animations"));

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionOff(query.matches || document.documentElement.classList.contains("settings-no-animations"));
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    query.addEventListener("change", update);
    return () => { observer.disconnect(); query.removeEventListener("change", update); };
  }, []);

  useGSAP(() => {
    if (motionOff) {
      entered.current = true;
      return;
    }
    if (entered.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const root = rootRef.current;
      const timeline = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => { entered.current = true; },
      });
      timeline.fromTo(root, { opacity: 0.2 }, {
        opacity: 1, duration: 0.55, clearProps: "opacity",
      }, 0);
      timeline.fromTo(root.querySelectorAll(":scope > .home-catalog__content, :scope > .home-news, :scope > .home-footer"),
        { y: 10 },
        { y: 0, duration: 0.6, stagger: 0.04, clearProps: "transform" }, 0.04);
      const heroCopy = root.querySelectorAll("[data-home-enter]");
      if (heroCopy.length) timeline.fromTo(heroCopy,
        { y: 8, opacity: 0.4 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.04, clearProps: "transform,opacity" }, 0.04);
    });
    return () => media.revert();
  }, { scope: rootRef, dependencies: [motionOff], revertOnUpdate: true });

  return motionOff;
}
