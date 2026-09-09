import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "./GenerationReveal.css";

gsap.registerPlugin(useGSAP);

// Keep the same particle surface alive while the result image loads underneath it.
export function GenerationReveal({ complete, sourceKey = "", pending, children }) {
  const root = useRef(null);
  const media = useRef(null);
  const cover = useRef(null);
  const completeRef = useRef(complete);
  const mounted = useRef(true);
  const token = useRef(0);
  const preview = useRef(null);
  const [overlay, setOverlay] = useState(!complete);
  const [ready, setReady] = useState(complete);
  const [failed, setFailed] = useState(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current++; }; }, []);
  useLayoutEffect(() => {
    completeRef.current = complete;
    token.current++;
    preview.current = null;
    setFailed(false);
    if (!complete) { setOverlay(true); setReady(false); }
  }, [complete, sourceKey]);

  const onReady = useCallback(async (event) => {
    const image = event?.currentTarget;
    if (!image?.naturalWidth) return;
    const currentToken = token.current;
    const src = image.currentSrc || image.src;
    try { await image.decode?.(); } catch { /* A loaded fallback can still be displayed. */ }
    if (!mounted.current || !completeRef.current || token.current !== currentToken || !image.isConnected
      || (image.currentSrc || image.src) !== src || !image.complete || !image.naturalWidth) return;
    setFailed(false);
    setReady(true);
  }, []);
  const onPreviewReady = useCallback(event => { preview.current = event.currentTarget; }, []);
  const onFailure = useCallback(() => {
    if (preview.current?.naturalWidth && preview.current.complete) {
      void onReady({ currentTarget: preview.current });
      return;
    }
    setFailed(true);
    setOverlay(false);
  }, [onReady]);

  useGSAP(() => {
    if (!complete || !ready || !overlay) return;
    const finish = () => { if (mounted.current) setOverlay(false); };
    const mediaQuery = gsap.matchMedia();
    mediaQuery.add({ reduce: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)" }, ({ conditions }) => {
      if (conditions.reduce || document.documentElement.classList.contains("settings-no-animations")) { finish(); return; }
      gsap.fromTo(media.current, { scale: 1.018 }, { scale: 1, duration: 0.82, ease: "power2.out", onComplete: finish });
      gsap.to(cover.current, { opacity: 0, duration: 0.7, ease: "power2.inOut" });
      const preferences = new MutationObserver(() => {
        if (document.documentElement.classList.contains("settings-no-animations")) finish();
      });
      preferences.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => preferences.disconnect();
    });
    return () => mediaQuery.revert();
  }, { scope: root, dependencies: [complete, ready, overlay], revertOnUpdate: true });

  const covered = !complete || overlay;
  return <div ref={root} className={`t2i-generation-reveal${covered ? " is-covered" : ""}${ready ? " is-ready" : ""}`}>
    {complete && <div ref={media} className="t2i-generation-result" aria-hidden={!ready && !failed}>
      {children({ onReady, onPreviewReady, onFailure })}
    </div>}
    {covered && <div ref={cover} className="t2i-generation-cover">{pending}</div>}
    {failed && <div className="t2i-generation-result-error" role="alert">图片暂时无法读取</div>}
  </div>;
}
