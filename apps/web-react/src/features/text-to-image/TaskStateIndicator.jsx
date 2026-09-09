import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "./TaskStateIndicator.css";

gsap.registerPlugin(useGSAP);

export function TaskStateIndicator({ state = "waiting", compact = false }) {
  const root = useRef(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ reduce: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)" }, (context) => {
      if (context.conditions.reduce || document.documentElement.classList.contains("settings-no-animations")) return;
      const icon = root.current.querySelector("svg");
      gsap.fromTo(icon, { scale: 0.96 }, { scale: 1, duration: 0.24, ease: "power2.out" });
      if (["submitting", "recovering", "uploading", "generating", "saving", "quoting", "loading"].includes(state)) {
        gsap.to(root.current.querySelector(".t2i-state-orbit"), { rotation: 360, transformOrigin: "50% 50%", duration: state === "generating" ? 3 : 1.5, repeat: -1, ease: "none" });
      } else if (state === "waiting") {
        gsap.to(root.current.querySelector(".t2i-state-core"), { opacity: 0.5, duration: 1.4, repeat: -1, yoyo: true, ease: "sine.inOut" });
      }
    });
    return () => media.revert();
  }, { scope: root, dependencies: [state], revertOnUpdate: true });
  const warning = ["warning", "full"].includes(state);
  return (
    <span ref={root} className={`t2i-state-indicator is-${state}${compact ? " is-compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle className="t2i-state-track" cx="24" cy="24" r="20" />
        <circle className="t2i-state-orbit" cx="24" cy="24" r="20" strokeDasharray="28 98" />
        <g className="t2i-state-core">
          {warning ? <path d="M24 15v12m0 6h.01" />
            : state === "waiting" ? <><circle cx="24" cy="24" r="9" /><path d="M24 18v6l4 3" /></>
            : state === "uploading" ? <path d="M24 32V16m-6 6 6-6 6 6M16 32h16" />
            : state === "saving" ? <path d="M24 14v15m-5-5 5 5 5-5M15 31v4h18v-4" />
            : state === "submitting" ? <path d="M15 24h17m-6-6 6 6-6 6" />
            : state === "recovering" ? <><circle cx="22" cy="22" r="7" /><path d="m27 27 6 6" /></>
            : <path d="m24 14 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />}
        </g>
      </svg>
    </span>
  );
}

export function GenerationButtonContent({ state, label, detail, points }) {
  const root = useRef(null);
  const busy = ["submitting", "recovering", "uploading", "quoting"].includes(state);
  const [showBusy, setShowBusy] = useState(false);
  const idle = useRef({ state, label, detail, points });
  if (!busy) idle.current = { state, label, detail, points };
  useEffect(() => {
    if (!busy) { setShowBusy(false); return; }
    const timer = window.setTimeout(() => setShowBusy(true), 160);
    return () => window.clearTimeout(timer);
  }, [busy]);
  const visible = busy && !showBusy ? idle.current : { state, label, detail, points: busy ? idle.current.points : points };
  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("settings-no-animations")) return;
    gsap.fromTo(root.current.querySelector(".t2i-submit-copy"), { y: 1.5 }, { y: 0, duration: 0.18, ease: "power2.out" });
    if (["submitting", "recovering", "uploading", "quoting"].includes(visible.state)) {
      gsap.fromTo(root.current.querySelector(".t2i-submit-sweep"), { xPercent: -120 }, { xPercent: 340, duration: 1.8, repeat: -1, ease: "sine.inOut" });
    }
  }, { scope: root, dependencies: [visible.state, visible.label], revertOnUpdate: true });
  const knownPoints = visible.points !== null && visible.points !== undefined && Number.isFinite(Number(visible.points));
  return <span ref={root} className="t2i-submit-content" data-visible-state={visible.state}>
    <span className="t2i-submit-copy"><span className="t2i-submit-label">{visible.label}</span></span>
    <span className="t2i-submit-summary">
      {visible.points !== undefined ? <span className={`t2i-submit-price${knownPoints && Number(visible.points) === 0 ? " is-free" : ""}`}>
        {knownPoints ? Number(visible.points) === 0 ? <b>免费</b> : <><b>{Number(visible.points).toLocaleString("zh-CN")}</b><span>积分</span></> : <span>待核价</span>}
      </span> : visible.detail ? <span className="t2i-submit-note">{visible.detail}</span> : null}
    </span>
    <span className="t2i-submit-track" aria-hidden="true"><span className="t2i-submit-sweep" /></span>
  </span>;
}
