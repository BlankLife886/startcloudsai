import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "./StageTransition.css";

gsap.registerPlugin(useGSAP);

const StageMediaContext = createContext(null);
export const useStageMediaReady = () => useContext(StageMediaContext);
export const stageMediaKey = (id, source) => JSON.stringify([id, source || ""]);

function StageScene({ scene, role, onReady, onImageSize, backdrop }) {
  const loaded = useRef(new Set());
  const [revision, setRevision] = useState(0);
  const sizeCallback = useRef(onImageSize);
  useLayoutEffect(() => { sizeCallback.current = onImageSize; }, [onImageSize]);
  const mediaReady = useCallback(({ id, source, width, height }) => {
    const key = stageMediaKey(id, source);
    if (width > 0 && height > 0) sizeCallback.current?.(id, width, height);
    if (!loaded.current.has(key)) {
      loaded.current.add(key);
      setRevision(value => value + 1);
    }
  }, []);
  const signature = JSON.stringify(scene.mediaKeys);
  const ready = scene.mediaKeys.every(key => loaded.current.has(key));
  useLayoutEffect(() => {
    if (role !== "incoming" || !ready) return;
    // Image dimensions and React's loaded classes must be committed before reveal.
    let second;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => onReady(scene.key)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [onReady, ready, revision, role, scene.key, signature]);
  return <StageMediaContext.Provider value={mediaReady}>
    <div className="t2i-stage-scene" data-stage-role={role} data-stage-key={scene.key} data-stage-ready={ready} aria-hidden={role !== "current"} inert={role !== "current"}>
      {role === "incoming" && <div className="t2i-stage-backdrop" aria-hidden="true" style={backdrop} />}
      {scene.content}
    </div>
  </StageMediaContext.Provider>;
}

export function StageTransition({ sceneKey, mediaKeys, onImageSize, children }) {
  const root = useRef(null);
  const [backdrop, setBackdrop] = useState(null);
  const [frontKey, setFrontKey] = useState(sceneKey);
  const [readyKey, setReadyKey] = useState(null);
  const current = useMemo(() => ({ key: sceneKey, mediaKeys, content: children }), [sceneKey, mediaKeys, children]);
  const committed = useRef(current);
  const latest = useRef(current);
  const lastReady = useRef(null);
  useLayoutEffect(() => {
    const element = root.current;
    const owner = element.closest('.t2i-main') || element.closest('.t2i-panel') || element.parentElement;
    const page = element.closest('.t2i-page');
    const sync = () => {
      const area = element.getBoundingClientRect(), background = owner.getBoundingClientRect();
      const paint = getComputedStyle(owner);
      const next = {
        left: background.left - area.left, top: background.top - area.top,
        width: background.width, height: background.height,
        backgroundColor: paint.backgroundColor, backgroundImage: paint.backgroundImage,
        backgroundPosition: paint.backgroundPosition, backgroundSize: paint.backgroundSize,
        backgroundRepeat: paint.backgroundRepeat, backgroundOrigin: paint.backgroundOrigin,
        backgroundClip: paint.backgroundClip, borderWidth: paint.borderWidth,
      };
      setBackdrop(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    sync();
    const size = new ResizeObserver(sync);
    size.observe(element); size.observe(owner);
    const theme = new MutationObserver(sync);
    theme.observe(owner, { attributes: true, attributeFilter: ['class', 'style'] });
    if (page && page !== owner) theme.observe(page, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => { size.disconnect(); theme.disconnect(); };
  }, []);
  // A decoded scene already fading in is the best source for a rapid next switch.
  const promoted = lastReady.current && lastReady.current.key !== sceneKey && lastReady.current.key !== frontKey ? lastReady.current : null;
  const front = promoted || (frontKey === sceneKey ? current : committed.current);
  const switching = front.key !== sceneKey;
  useLayoutEffect(() => {
    latest.current = current;
    if (promoted) { committed.current = promoted; setFrontKey(promoted.key); }
    else if (!switching) committed.current = current;
  }, [current, promoted, switching]);
  const onReady = useCallback(key => {
    if (latest.current.key !== key) return;
    lastReady.current = latest.current;
    setReadyKey(key);
  }, []);

  useGSAP(() => {
    if (!switching || readyKey !== sceneKey) return;
    const layer = root.current.querySelector('[data-stage-role="incoming"]');
    if (!layer) return;
    const commit = () => {
      if (latest.current.key !== sceneKey) return;
      committed.current = latest.current;
      setFrontKey(sceneKey);
    };
    const media = gsap.matchMedia();
    media.add({ reduce: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)" }, ({ conditions }) => {
      if (conditions.reduce || document.documentElement.classList.contains("settings-no-animations")) { commit(); return; }
      gsap.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.24, ease: "power2.inOut", onComplete: commit });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [sceneKey, front.key, readyKey, switching], revertOnUpdate: true });

  const scenes = switching ? [front, current] : [current];
  return <div ref={root} className="t2i-stage-transition" aria-busy={switching}>
    {scenes.map(scene => <StageScene key={scene.key} scene={scene} role={!switching ? "current" : scene.key === sceneKey ? "incoming" : "outgoing"} onReady={onReady} onImageSize={onImageSize} backdrop={backdrop} />)}
  </div>;
}
