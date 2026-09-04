import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DialogMotion.css";

gsap.registerPlugin(useGSAP);

const variants = {
  dialog: { enterY: 18, enterScale: 0.975, enterDuration: 0.36, exitY: 12, exitScale: 0.985, exitDuration: 0.2 },
  detail: { enterY: 12, enterScale: 0.985, enterDuration: 0.4, exitY: 8, exitScale: 0.99, exitDuration: 0.22 },
};

function assignRef(ref, value) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function motionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

export function DialogMotion({
  open,
  children,
  layerExtras,
  layerClassName,
  panelClassName,
  variant = "dialog",
  role = "dialog",
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  closeOnBackdrop = true,
  closeDisabled = false,
  initialFocusRef,
  panelRef,
  onClose,
  onExited,
}) {
  const [present, setPresent] = useState(Boolean(open));
  const [motionState, setMotionState] = useState(open ? "entered" : "idle");
  const layerRef = useRef(null);
  const internalPanelRef = useRef(null);
  const openerRef = useRef(null);
  const contentRef = useRef({ children, layerExtras });
  const closeRef = useRef(onClose);
  const settleTimerRef = useRef(0);

  if (open) contentRef.current = { children, layerExtras };
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    setPresent(true);
  }, [open]);

  useEffect(() => {
    if (!present || !open || closeDisabled) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDisabled, open, present]);

  useGSAP(
    (context, contextSafe) => {
      const layer = layerRef.current;
      const panel = internalPanelRef.current;
      if (!present || !layer || !panel) return undefined;
      const settings = variants[variant] || variants.dialog;
      const items = Array.from(panel.querySelectorAll("[data-dialog-motion-item]"));
      const motionTargets = [layer, panel, ...items];
      const finishExit = contextSafe(() => {
        window.clearTimeout(settleTimerRef.current);
        setPresent(false);
        setMotionState("idle");
        onExited?.();
        const opener = openerRef.current;
        if (opener instanceof HTMLElement && document.contains(opener)) {
          opener.focus({ preventScroll: true });
        }
      });

      gsap.killTweensOf(motionTargets);
      if (motionDisabled()) {
        gsap.set(motionTargets, { autoAlpha: 1, clearProps: "transform" });
        if (open) {
          setMotionState("entered");
          window.requestAnimationFrame(() => (initialFocusRef?.current || panel).focus?.({ preventScroll: true }));
        } else {
          finishExit();
        }
        return undefined;
      }

      if (!open) {
        setMotionState("exiting");
        settleTimerRef.current = window.setTimeout(finishExit, Math.ceil(settings.exitDuration * 1000) + 80);
        const timeline = gsap.timeline({ onComplete: finishExit });
        if (items.length) {
          timeline.to(items, { autoAlpha: 0, y: -4, duration: 0.1, stagger: 0.01, ease: "power1.in" }, 0);
        }
        timeline
          .to(panel, {
            autoAlpha: 0,
            y: settings.exitY,
            scale: settings.exitScale,
            duration: settings.exitDuration,
            ease: "power2.in",
          }, 0)
          .to(layer, { autoAlpha: 0, duration: Math.min(0.2, settings.exitDuration), ease: "power1.inOut" }, 0.04);
        return () => window.clearTimeout(settleTimerRef.current);
      }

      setMotionState("entering");
      const finishEnter = contextSafe(() => {
        window.clearTimeout(settleTimerRef.current);
        setMotionState("entered");
        (initialFocusRef?.current || panel).focus?.({ preventScroll: true });
      });
      settleTimerRef.current = window.setTimeout(finishEnter, Math.ceil(settings.enterDuration * 1000) + 80);
      const timeline = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: finishEnter,
      });
      timeline
        .fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22 }, 0)
        .fromTo(panel, {
          autoAlpha: 0,
          y: settings.enterY,
          scale: settings.enterScale,
        }, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: settings.enterDuration,
          clearProps: "transform",
        }, 0.025);
      if (items.length) {
        timeline.fromTo(items, { autoAlpha: 0, y: 9 }, {
          autoAlpha: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.025,
          clearProps: "transform",
        }, 0.12);
      }
      return () => window.clearTimeout(settleTimerRef.current);
    },
    { dependencies: [open, present, variant], scope: layerRef, revertOnUpdate: true },
  );

  if (!present) return null;
  const cached = contentRef.current;
  return createPortal(
    <div
      ref={layerRef}
      className={layerClassName}
      data-dialog-motion-state={motionState}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !closeDisabled) onClose?.();
      }}
    >
      {typeof cached.layerExtras === "function" ? cached.layerExtras() : cached.layerExtras}
      <section
        ref={(node) => {
          internalPanelRef.current = node;
          assignRef(panelRef, node);
        }}
        className={panelClassName}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        tabIndex={-1}
      >
        {cached.children}
      </section>
    </div>,
    document.body,
  );
}
