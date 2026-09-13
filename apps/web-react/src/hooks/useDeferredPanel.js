import { useEffect, useRef, useState } from "react";

function motionReduced() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

/** Keep a panel mounted through a short exit animation after `activeId` clears. */
export function useDeferredPanel(activeId = "", duration = 150) {
  const [renderedId, setRenderedId] = useState(activeId || "");
  const [phase, setPhase] = useState(activeId ? "open" : "closed");
  const renderedRef = useRef(renderedId);
  renderedRef.current = renderedId;

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const reduce = motionReduced();

    if (activeId) {
      setRenderedId(activeId);
      if (reduce) {
        setPhase("open");
        return undefined;
      }
      setPhase("entering");
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setPhase("open"));
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!renderedRef.current) {
      setPhase("closed");
      return undefined;
    }

    if (reduce) {
      setRenderedId("");
      setPhase("closed");
      return undefined;
    }

    setPhase("closing");
    timer = window.setTimeout(() => {
      setRenderedId("");
      setPhase("closed");
    }, duration);
    return () => window.clearTimeout(timer);
  }, [activeId, duration]);

  const className =
    phase === "closing"
      ? "is-closing"
      : phase === "entering"
        ? "is-entering"
        : phase === "open"
          ? "is-open"
          : "";

  return {
    id: renderedId,
    phase,
    mounted: Boolean(renderedId),
    className,
  };
}
