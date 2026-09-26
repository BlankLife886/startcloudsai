import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { cardMotionStyle, createCardMotionTour } from './cardMotionPresets.js';

gsap.registerPlugin(useGSAP);

const clamp = (value) => Math.max(-1, Math.min(1, value));

// Both card renderers share one interaction lifetime. All delayed work belongs
// to this stage's GSAP context, including events and asynchronous asset reveals.
export function useCardMotion({ containerRef, createRenderer, settings, hasArtwork, onReady, onError, initialPose, initializationError }) {
  const engineRef = useRef(null);
  const controlsRef = useRef(null);
  const latestRef = useRef(null);
  latestRef.current = { settings, hasArtwork, onReady, onError };
  const [state, setState] = useState(hasArtwork ? 'loading' : 'empty');

  useGSAP((context, contextSafe) => {
    const container = containerRef.current;
    let alive = true;
    let engine;
    let ready = false;
    let reduced = false;
    let inViewport = true;
    let pointerInside = false;
    let keyboardActive = false;
    let drag = null;
    let flipping = false;
    let reveal = null;
    let hasRevealed = false;
    let inspectionOrigin = null;
    let handleReadiness = () => {};
    let previousSettings = { ...latestRef.current.settings };
    const restingPose = { x: initialPose?.x || 0, y: initialPose?.y || 0 };
    const pose = {
      x: previousSettings.exploded ? .78 : restingPose.x,
      y: previousSettings.exploded ? .12 : restingPose.y,
      flip: previousSettings.flipped ? Math.PI : 0,
    };
    if (previousSettings.exploded) inspectionOrigin = restingPose;
    const currentSettings = () => latestRef.current.settings;
    const visible = () => !document.hidden && inViewport;
    const canAnimate = () => alive && visible() && !reduced && !currentSettings().paused;

    try {
      engine = createRenderer(container, {
        onReady: contextSafe((value) => {
          if (!alive) return;
          const becameReady = Boolean(value) && !ready;
          ready = Boolean(value);
          setState(ready ? 'ready' : latestRef.current.hasArtwork ? 'loading' : 'empty');
          latestRef.current.onReady?.(ready);
          handleReadiness(becameReady);
        }),
        onError: contextSafe((message) => {
          if (!alive) return;
          ready = false;
          setState('error');
          latestRef.current.onReady?.(false);
          latestRef.current.onError?.(message);
          handleReadiness(false);
        }),
      });
      engineRef.current = engine;
      engine.setSettings(currentSettings());
      engine.setPose(pose);
    } catch {
      engine?.dispose();
      engineRef.current = null;
      setState('error');
      latestRef.current.onReady?.(false);
      latestRef.current.onError?.(initializationError);
      return () => { alive = false; };
    }

    const draw = () => { if (alive) engine.setPose(pose); };
    const orbit = createCardMotionTour({ timeline: gsap.timeline({ paused: true }), pose, onUpdate: draw });
    const xTo = gsap.quickTo(pose, 'x', { duration: .58, ease: 'power3.out', onUpdate: draw });
    const yTo = gsap.quickTo(pose, 'y', { duration: .58, ease: 'power3.out', onUpdate: draw });
    let syncOrbit = () => {};
    const flipTo = gsap.quickTo(pose, 'flip', {
      duration: .88,
      ease: 'power3.inOut',
      onUpdate: draw,
      onComplete: contextSafe(() => { flipping = false; syncOrbit(); }),
    });
    const stopOrbit = () => {
      orbit.stop();
      container.dataset.cardOrbit = 'idle';
    };
    const stopPose = () => {
      xTo.tween.pause();
      yTo.tween.pause();
      flipTo.tween.pause();
      flipping = false;
    };
    const finishReveal = contextSafe(() => {
      reveal?.kill();
      reveal = null;
      const canvas = container.querySelector('canvas');
      if (canvas) gsap.set(canvas, { clearProps: 'opacity,visibility,transform,willChange' });
    });
    const revealCard = contextSafe(() => {
      const canvas = container.querySelector('canvas');
      if (!canvas) return;
      reveal?.kill();
      if (!canAnimate()) {
        finishReveal();
        hasRevealed = true;
        return;
      }
      gsap.set(canvas, { willChange: 'opacity,transform' });
      reveal = gsap.fromTo(canvas,
        { autoAlpha: hasRevealed ? .68 : 0, y: hasRevealed ? 10 : 24, scale: hasRevealed ? .986 : .968 },
        {
          autoAlpha: 1, y: 0, scale: 1, duration: hasRevealed ? .65 : 1.1,
          ease: 'power3.out', overwrite: 'auto',
          onComplete: contextSafe(() => { reveal = null; gsap.set(canvas, { clearProps: 'opacity,visibility,transform,willChange' }); }),
        });
      hasRevealed = true;
    });
    const stop = contextSafe(() => { stopOrbit(); stopPose(); finishReveal(); });
    syncOrbit = contextSafe(() => {
      const allowed = canAnimate() && (ready || !latestRef.current.hasArtwork)
        && currentSettings().autoOrbit && !currentSettings().exploded
        && !pointerInside && !keyboardActive && !drag && !flipping;
      if (!allowed) { stopOrbit(); return; }
      xTo.tween.pause();
      yTo.tween.pause();
      orbit.start(currentSettings().orbitStyle);
      container.dataset.cardOrbit = 'running';
    });
    const move = contextSafe((x, y, explicit = false, duration = .58) => {
      if (!alive || (!explicit && !canAnimate())) return;
      if (!canAnimate()) {
        xTo.tween.pause();
        yTo.tween.pause();
        pose.x = clamp(x);
        pose.y = clamp(y);
        draw();
        return;
      }
      xTo.tween.duration(duration);
      yTo.tween.duration(duration);
      xTo(clamp(x));
      yTo(clamp(y));
    });
    const flip = contextSafe((flipped) => {
      if (!alive) return;
      const target = flipped ? Math.PI : 0;
      if (Math.abs(pose.flip - target) < .0001) {
        flipTo.tween.pause();
        flipping = false;
        return;
      }
      stopOrbit();
      if (!canAnimate()) {
        flipTo.tween.pause();
        pose.flip = target;
        flipping = false;
        draw();
      } else {
        flipping = true;
        flipTo(target);
      }
    });
    const rest = contextSafe(() => {
      if (currentSettings().autoOrbit && !currentSettings().exploded) syncOrbit();
      else move(currentSettings().exploded ? .78 : 0, currentSettings().exploded ? .12 : 0, false, .85);
    });
    const reset = contextSafe(() => {
      stopOrbit();
      keyboardActive = true;
      inspectionOrigin = null;
      move(0, 0, true, .85);
      flip(false);
    });
    const shine = contextSafe(() => {
      if (!ready || !canAnimate()) return false;
      return engine.shine();
    });
    handleReadiness = contextSafe((becameReady) => {
      if (!ready && !latestRef.current.hasArtwork && !hasRevealed) revealCard();
      else if (!ready) finishReveal();
      else if (becameReady) revealCard();
      syncOrbit();
    });
    const syncEnvironment = contextSafe(() => {
      engine.setMotionAllowed(!reduced && visible());
      engine.setVisible(visible());
      if (!canAnimate()) {
        stop();
        // A hidden or reduced-motion tab must not resume a half-finished flip.
        pose.flip = currentSettings().flipped ? Math.PI : 0;
        draw();
      }
      syncOrbit();
    });
    const syncSettings = contextSafe(() => {
      if (!alive) return;
      const next = currentSettings();
      engine.setSettings(next);
      if (next.paused) stop();
      if (next.exploded !== previousSettings.exploded) {
        stopOrbit();
        if (next.exploded) {
          inspectionOrigin = { x: pose.x, y: pose.y };
          move(.78, .12, true, .9);
        } else {
          const restore = inspectionOrigin || { x: 0, y: 0 };
          inspectionOrigin = null;
          move(restore.x, restore.y, true, .9);
        }
      }
      if (next.flipped !== previousSettings.flipped || next.paused !== previousSettings.paused) flip(next.flipped);
      if (!next.autoOrbit && previousSettings.autoOrbit) stopOrbit();
      const motionStyleChanged = cardMotionStyle(next.orbitStyle) !== cardMotionStyle(previousSettings.orbitStyle);
      if (next.autoOrbit && (!previousSettings.autoOrbit || motionStyleChanged)) { keyboardActive = false; pointerInside = false; }
      previousSettings = { ...next };
      syncOrbit();
    });
    controlsRef.current = {
      stop, reset, shine, syncSettings,
      getState() {
        return {
          ...engine.getState(), pose: { x: pose.x, y: pose.y, flip: pose.flip }, autoOrbit: Boolean(currentSettings().autoOrbit),
          orbitRunning: orbit.isRunning(), orbitStyle: cardMotionStyle(currentSettings().orbitStyle), reducedMotion: reduced,
          motionAllowed: !reduced && visible(), paused: Boolean(currentSettings().paused),
          exploded: Boolean(currentSettings().exploded),
        };
      },
    };

    const keepInspectionAngle = (event) => !currentSettings().autoOrbit
      && Boolean(event.relatedTarget?.closest?.('[data-holo-preserve-pose]'));
    const pointerEnter = contextSafe((event) => {
      pointerInside = event.pointerType !== 'touch';
      if (pointerInside) stopOrbit();
    });
    const pointerMove = contextSafe((event) => {
      if (event.pointerType === 'touch' && !drag) return;
      if (event.pointerType !== 'touch') pointerInside = true;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      stopOrbit();
      if (drag?.id === event.pointerId) {
        move(drag.poseX + (event.clientX - drag.x) / rect.width * 3,
          drag.poseY - (event.clientY - drag.y) / rect.height * 3, false, .32);
      } else {
        move((event.clientX - rect.left) / rect.width * 2 - 1,
          1 - (event.clientY - rect.top) / rect.height * 2);
      }
    });
    const pointerDown = contextSafe((event) => {
      if (event.button !== 0 || !canAnimate()) return;
      stopOrbit();
      keyboardActive = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, poseX: pose.x, poseY: pose.y };
      container.setPointerCapture(event.pointerId);
      container.dataset.holoDragging = 'true';
      container.dataset.sampleDragging = 'true';
      container.focus({ preventScroll: true });
      if (event.pointerType !== 'touch') event.preventDefault();
    });
    const pointerUp = contextSafe((event) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      container.dataset.holoDragging = 'false';
      container.dataset.sampleDragging = 'false';
      const rect = container.getBoundingClientRect();
      pointerInside = event.pointerType !== 'touch' && event.type !== 'pointercancel'
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      if (!pointerInside) rest();
    });
    const pointerLeave = contextSafe((event) => {
      pointerInside = false;
      keyboardActive = false;
      // Editing controls can appear underneath a stationary cursor. Keep the
      // chosen inspection angle while adjusting its coating; an enabled tour
      // can still resume, and leaving into the open surround returns to rest.
      if (!drag && keepInspectionAngle(event)) return;
      if (!drag) rest();
    });
    const keyDown = contextSafe((event) => {
      if (!['Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      keyboardActive = true;
      stopOrbit();
      const step = .24;
      if (event.key === 'Home') move(0, 0, true, .85);
      if (event.key === 'ArrowLeft') move(pose.x - step, pose.y, true);
      if (event.key === 'ArrowRight') move(pose.x + step, pose.y, true);
      if (event.key === 'ArrowUp') move(pose.x, pose.y + step, true);
      if (event.key === 'ArrowDown') move(pose.x, pose.y - step, true);
      event.preventDefault();
    });
    const blur = contextSafe((event) => {
      keyboardActive = false;
      if (!pointerInside && !drag && !keepInspectionAngle(event)) rest();
    });
    const observer = new IntersectionObserver(([entry]) => {
      if (!alive) return;
      inViewport = entry.isIntersecting;
      syncEnvironment();
    });
    observer.observe(container);
    // Preference changes must stop cyclic motion immediately, independently of
    // GSAP's shared media-query refresh/debounce or other mounted card stages.
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = contextSafe(() => {
      reduced = motionQuery.matches;
      syncEnvironment();
    });
    motionQuery.addEventListener('change', preferenceChanged);
    preferenceChanged();
    const events = {
      pointerenter: pointerEnter, pointermove: pointerMove, pointerdown: pointerDown,
      pointerup: pointerUp, pointercancel: pointerUp, lostpointercapture: pointerUp,
      pointerleave: pointerLeave, keydown: keyDown, blur, dblclick: shine,
    };
    Object.entries(events).forEach(([name, handler]) => container.addEventListener(name, handler));
    document.addEventListener('visibilitychange', syncEnvironment);
    syncEnvironment();
    if (ready) revealCard();

    return () => {
      alive = false;
      stopOrbit();
      orbit.dispose();
      stopPose();
      reveal?.kill();
      motionQuery.removeEventListener('change', preferenceChanged);
      observer.disconnect();
      Object.entries(events).forEach(([name, handler]) => container.removeEventListener(name, handler));
      document.removeEventListener('visibilitychange', syncEnvironment);
      if (drag && container.hasPointerCapture(drag.id)) container.releasePointerCapture(drag.id);
      engine.dispose();
      engineRef.current = null;
      controlsRef.current = null;
    };
  }, { scope: containerRef });

  useEffect(() => { controlsRef.current?.syncSettings(); }, [settings]);

  return { engineRef, controlsRef, state };
}
