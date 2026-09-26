import { memo, useId, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "./GenerationStateVisual.css";

gsap.registerPlugin(useGSAP);

const PIXELS = Array.from({ length: 144 }, (_, i) => {
  const x = i % 12, y = Math.floor(i / 12);
  const mountain = y > 4 + Math.abs(x - 4) * 0.9 || (x > 5 && y > 6 + Math.abs(x - 8) * 0.65);
  return { x: 82 + x * 13, y: 82 + y * 13, shade: mountain ? 0.7 : 0.1 + ((x * 3 + y * 5) % 5) * 0.04 };
});
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  x: 114 + (i % 6) * 19, y: 133 + Math.floor(i / 6) * 25,
  offsetX: (i % 2 ? 1 : -1) * (52 + i % 4 * 8), offsetY: (i % 3 - 1) * 40,
}));

export const GenerationStateVisual = memo(function GenerationStateVisual({ state, variant = 0, style = "scan" }) {
  const root = useRef(null);
  const id = useId().replace(/:/g, "");
  const phase = state === "waiting" ? "waiting" : state === "saving" ? "saving" : state === "generating" ? "generating" : "preparing";

  useGSAP(() => {
    const element = root.current;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const select = gsap.utils.selector(element);
      const motion = gsap.timeline({ paused: true });
      if (phase === "waiting") {
        motion.to(select(".state-wait-dot"), { opacity: 0.85, duration: 0.8, stagger: 0.28, repeat: -1, yoyo: true, ease: "sine.inOut" }, 0);
      } else if (phase === "preparing") {
        motion.fromTo(select(".state-corner"), {
          x: index => index % 2 ? 6 : -6, y: index => index < 2 ? -6 : 6, opacity: 0.3,
        }, { x: 0, y: 0, opacity: 1, duration: 1.3, repeat: -1, yoyo: true, ease: "power2.inOut" }, 0);
        motion.to(select(".state-prepare-dot"), { opacity: 0.75, duration: 1.3, repeat: -1, yoyo: true, ease: "sine.inOut" }, 0);
      } else if (phase === "saving") {
        motion.fromTo(select(".state-saved-picture"), { y: -12 }, { y: 0, duration: 1.8, repeat: -1, yoyo: true, ease: "sine.inOut" }, 0);
        motion.fromTo(select(".state-save-trace"), { y: -9, opacity: 0 }, { y: 9, opacity: 0.8, duration: 1.8, repeat: -1, ease: "power2.inOut" }, 0);
      } else if (style === "pixels") {
        motion.fromTo(select(".state-pixel"), { opacity: 0.1, scale: 0.45, transformOrigin: "50% 50%" }, {
          opacity: 1, scale: 1, duration: 1.1, stagger: { amount: 2, grid: [12, 12], from: "start" },
          repeat: -1, repeatDelay: 1.2, yoyo: true, ease: "sine.inOut",
        }, 0);
      } else if (style === "gather") {
        motion.fromTo(select(".state-particle"), {
          x: index => PARTICLES[index].offsetX, y: index => PARTICLES[index].offsetY, opacity: 0.12, scale: 0.45, transformOrigin: "50% 50%",
        }, { x: 0, y: 0, scale: 1, opacity: 0.85, duration: 2.1, stagger: { amount: 1.1, from: "center" }, repeat: -1, repeatDelay: 0.7, yoyo: true, ease: "power2.inOut" }, 0);
        motion.to(select(".state-gather-outline"), { opacity: 0.8, duration: 2.5, repeat: -1, yoyo: true, ease: "sine.inOut" }, 0);
      } else {
        motion.fromTo(select(".state-scan-sweep"), { y: -12 }, { y: 110, duration: 2.6, repeat: -1, yoyo: true, ease: "sine.inOut" }, 0);
        motion.to(select(".state-image-highlight"), { opacity: 0.8, duration: 2.6, repeat: -1, yoyo: true, ease: "sine.inOut" }, 0);
      }
      motion.time((variant % 4) * 0.38);
      let inView = false;
      const sync = () => {
        const play = inView && !document.hidden && !document.documentElement.classList.contains("settings-no-animations");
        motion.paused(!play);
        element.dataset.motion = play ? "playing" : "paused";
      };
      const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
      visibility.observe(element);
      const preferences = new MutationObserver(sync);
      preferences.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      document.addEventListener("visibilitychange", sync);
      sync();
      return () => {
        visibility.disconnect(); preferences.disconnect();
        document.removeEventListener("visibilitychange", sync);
        delete element.dataset.motion;
      };
    });
    return () => media.revert();
  }, { scope: root, dependencies: [phase, style, variant], revertOnUpdate: true });

  return <div ref={root} className={`t2i-state-visual style-${style} phase-${phase}`} aria-hidden="true">
    <div className="state-workspace-grid" />
    <svg className="state-visual-art" viewBox="0 0 320 320" fill="none">
      <defs>
        <linearGradient id={`${id}-scan`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity="0" /><stop offset="1" stopColor="currentColor" stopOpacity="0.18" /></linearGradient>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="currentColor" stopOpacity="0.06" /><stop offset="1" stopColor="currentColor" stopOpacity="0.015" /></linearGradient>
        <clipPath id={`${id}-clip`}><rect x="73" y="79" width="174" height="162" rx="7" /></clipPath>
      </defs>
      {phase === "waiting" ? <>
        <rect className="state-frame-back" x="78" y="66" width="174" height="164" rx="12" transform="rotate(8 160 160)" />
        <rect className="state-frame-back" x="64" y="83" width="174" height="164" rx="12" transform="rotate(-5 160 160)" />
        <rect className="state-frame-paper" x="67" y="77" width="186" height="166" rx="12" />
        {[140, 160, 180].map(x => <circle key={x} className="state-wait-dot" cx={x} cy="160" r="3" />)}
      </> : phase === "preparing" ? <>
        <rect x="72" y="77" width="176" height="166" rx="8" fill={`url(#${id}-paper)`} />
        <Corners />
        <path className="state-guide" d="M160 108v104M108 160h104" strokeDasharray="2 7" />
        <rect className="state-prepare-dot" x="155" y="155" width="10" height="10" rx="2" />
      </> : phase === "saving" ? <>
        <g className="state-saved-picture"><rect className="state-frame-paper" x="81" y="60" width="158" height="150" rx="12" /><Landscape compact /></g>
        <path className="state-save-trace" d="M160 222v19m-6-6 6 6 6-6" />
        <path className="state-tray" d="M65 243v13a9 9 0 0 0 9 9h172a9 9 0 0 0 9-9v-13M111 278h98" />
      </> : style === "pixels" ? <>
        <rect className="state-pixel-frame" x="67" y="67" width="186" height="186" rx="13" />
        {PIXELS.map((pixel, index) => <rect key={index} className="state-pixel" x={pixel.x} y={pixel.y} width="9.5" height="9.5" rx="1.5" fill="currentColor" fillOpacity={pixel.shade} />)}
        <Corners />
      </> : style === "gather" ? <>
        <path className="state-particle-path" d="M28 95c70 0 66 52 114 65M18 204c82 0 84-27 122-39M292 105c-59 0-71 39-112 55M300 217c-67 0-78-33-120-49" />
        <rect className="state-gather-outline" x="87" y="102" width="146" height="116" rx="12" />
        {PARTICLES.map((particle, index) => <rect key={index} className="state-particle" x={particle.x - 3.5} y={particle.y - 3.5} width="7" height="7" rx="2" fill="currentColor" />)}
      </> : <>
        <rect className="state-frame-paper" x="65" y="71" width="190" height="178" rx="13" />
        <Landscape />
        <g clipPath={`url(#${id}-clip)`}><g className="state-scan-sweep"><rect x="73" y="76" width="174" height="40" fill={`url(#${id}-scan)`} /><path d="M73 116h174" stroke="currentColor" strokeWidth="1.5" /><circle cx="73" cy="116" r="2" fill="currentColor" /><circle cx="247" cy="116" r="2" fill="currentColor" /></g></g>
        <Corners />
      </>}
    </svg>
  </div>;
});

function Corners() {
  return <g className="state-corners"><path className="state-corner" d="M54 92V67h25" /><path className="state-corner" d="M241 67h25v25" /><path className="state-corner" d="M54 228v25h25" /><path className="state-corner" d="M241 253h25v-25" /></g>;
}

function Landscape({ compact = false }) {
  return <g className="state-image-highlight" transform={compact ? "translate(22 4) scale(.86)" : undefined}>
    <circle cx="211" cy="116" r="12" />
    <path d="m87 215 53-65 36 44 30-33 29 54Z" />
    <path className="state-image-floor" d="M87 226h148" />
  </g>;
}
