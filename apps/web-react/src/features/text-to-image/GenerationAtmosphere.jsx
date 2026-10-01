import { memo, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "./GenerationAtmosphere.css";

gsap.registerPlugin(useGSAP);

export const GenerationAtmosphere = memo(function GenerationAtmosphere({ state, variant = 0 }) {
  const root = useRef(null);
  const active = state === "generating" || state === "saving";

  useGSAP(() => {
    const element = root.current;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const select = gsap.utils.selector(element);
      const flow = gsap.timeline({ paused: true });
      flow.to(select(".t2i-atmosphere-halo"), {
        scale: active ? 1.18 : 1.06, opacity: active ? 0.85 : 0.45,
        duration: 5.5, ease: "sine.inOut", repeat: -1, yoyo: true,
      }, 0);
      if (active) {
        flow.to(select(".t2i-atmosphere-form"), { yPercent: -5, rotation: 9, duration: 7, ease: "sine.inOut", repeat: -1, yoyo: true }, 0);
        flow.to(select(".t2i-atmosphere-ribbon--first"), { rotation: "+=360", duration: 26, ease: "none", repeat: -1 }, 0);
        flow.to(select(".t2i-atmosphere-ribbon--second"), { rotation: "-=360", duration: 32, ease: "none", repeat: -1 }, 0);
        flow.to(select(".t2i-atmosphere-ribbon--third"), { rotation: "+=360", duration: 38, ease: "none", repeat: -1 }, 0);
        flow.to(select(".t2i-atmosphere-light"), { xPercent: 12, yPercent: -8, scale: 1.15, duration: 9, ease: "sine.inOut", repeat: -1, yoyo: true }, 0);
      }
      // Give sibling images different positions in the same slow, seamless motion.
      flow.time((variant % 4) * 2.7);
      let inView = false;
      const syncPlayback = () => {
        const play = inView && !document.hidden && !document.documentElement.classList.contains("settings-no-animations");
        flow.paused(!play);
        element.dataset.motion = play ? "playing" : "paused";
      };
      const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; syncPlayback(); });
      visibility.observe(element);
      const preferences = new MutationObserver(syncPlayback);
      preferences.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      document.addEventListener("visibilitychange", syncPlayback);
      syncPlayback();
      return () => {
        visibility.disconnect();
        preferences.disconnect();
        document.removeEventListener("visibilitychange", syncPlayback);
        delete element.dataset.motion;
      };
    });
    return () => media.revert();
  }, { scope: root, dependencies: [active, variant], revertOnUpdate: true });

  return <div ref={root} className={`t2i-atmosphere is-${state}`} data-variant={variant % 4} aria-hidden="true">
    <div className="t2i-atmosphere-halo" />
    <div className="t2i-atmosphere-art">
      <div className="t2i-atmosphere-form">
        <span className="t2i-atmosphere-light" />
        <span className="t2i-atmosphere-ribbon t2i-atmosphere-ribbon--first" />
        <span className="t2i-atmosphere-ribbon t2i-atmosphere-ribbon--second" />
        <span className="t2i-atmosphere-ribbon t2i-atmosphere-ribbon--third" />
        <span className="t2i-atmosphere-center" />
      </div>
    </div>
  </div>;
});
