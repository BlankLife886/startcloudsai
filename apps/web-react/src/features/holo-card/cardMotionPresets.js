const TAU = Math.PI * 2;

export const CARD_MOTION_DURATIONS = Object.freeze({ orbit: 12, sway: 10, figure8: 14, float: 16 });

export function cardMotionStyle(value) {
  return typeof value === 'string' && Object.hasOwn(CARD_MOTION_DURATIONS, value) ? value : 'orbit';
}

// All paths close with a continuous tangent. They only change the existing tilt
// axes, so a selected back face and authored layer registration stay intact.
export function sampleCardMotion(style, phase) {
  const angle = Number.isFinite(phase) ? phase : 0;
  switch (cardMotionStyle(style)) {
    case 'sway':
      return { x: Math.sin(angle) * .82, y: Math.cos(angle * 2) * .045 };
    case 'figure8':
      return { x: Math.sin(angle) * .62, y: Math.sin(angle * 2) * .34 };
    case 'float':
      return { x: Math.sin(angle) * .075, y: .07 + Math.cos(angle) * .19 };
    default:
      return { x: Math.sin(angle) * .64, y: Math.sin(angle + Math.PI / 3) * .22 };
  }
}

// One stage-owned GSAP timeline is injected and reused for every path/resume.
// This helper never creates a context, ticker, timer or independent loop.
export function createCardMotionTour({ timeline, pose, onUpdate = () => {} }) {
  const motion = { phase: 0, blend: 0 };
  let style = 'orbit';
  let running = false;
  let disposed = false;
  let generation = 0;

  function stop() {
    running = false;
    generation += 1;
    timeline.pause();
  }

  return {
    start(nextStyle = 'orbit') {
      if (disposed) return false;
      const selected = cardMotionStyle(nextStyle);
      if (running && style === selected) return true;
      const origin = { x: pose.x, y: pose.y };
      stop();
      timeline.clear();
      style = selected;
      const currentGeneration = generation;
      const phaseStart = motion.phase % TAU;
      motion.blend = 0;
      running = true;
      const update = () => {
        if (disposed || !running || generation !== currentGeneration) return;
        const next = sampleCardMotion(style, motion.phase);
        pose.x = origin.x + (next.x - origin.x) * motion.blend;
        pose.y = origin.y + (next.y - origin.y) * motion.blend;
        onUpdate();
      };
      timeline
        .fromTo(motion, { phase: phaseStart }, {
          phase: phaseStart + TAU, duration: CARD_MOTION_DURATIONS[style],
          ease: 'none', repeat: -1, onUpdate: update,
        }, 0)
        .to(motion, { blend: 1, duration: 1.5, ease: 'power2.inOut', onUpdate: update }, 0)
        .restart();
      return true;
    },
    stop,
    isRunning() { return running && !disposed && timeline.isActive(); },
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      timeline.kill();
    },
  };
}
