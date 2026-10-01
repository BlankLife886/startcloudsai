import gsap from 'gsap';
import {useGSAP} from '@gsap/react';

gsap.registerPlugin(useGSAP);

export function useConsoleMotion(scope, tab, ready, signedIn) {
  useGSAP(() => {
    if (!ready || !signedIn || !scope.current) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const panels = scope.current.querySelectorAll('.dap-stats, .dap-start-grid, .dap-filterbar, .dap-content > .dap-panel');
      const visible = Array.from(panels).filter(panel => panel.getClientRects().length);
      if (!visible.length) return;
      gsap.fromTo(visible, {autoAlpha: 0.01, y: 12}, {
        autoAlpha: 1, y: 0, duration: 0.24, stagger: 0.025, ease: 'power2.out',
        clearProps: 'opacity,visibility,transform',
      });
    }, scope);
    return () => media.revert();
  }, {scope, dependencies: [tab, ready, signedIn], revertOnUpdate: true});
}

export function useDialogMotion(ref, drawer = false) {
  useGSAP(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector('[data-autofocus]')?.focus({preventScroll: true});
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      // A drawer slides in from the right edge; a dialog rises into place.
      const from = drawer ? {autoAlpha: 0.01, x: 48} : {autoAlpha: 0.01, y: 14, scale: 0.985};
      const to = drawer ? {autoAlpha: 1, x: 0, duration: 0.26, ease: 'power3.out'} : {autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out'};
      gsap.fromTo(dialog, from, {...to, clearProps: 'opacity,visibility,transform'});
    }, ref);
    return () => { media.revert(); dialog.close(); };
  }, {scope: ref});
}

// playDialogExit runs the exit before the caller unmounts the dialog: a drawer
// slides back out to the right. Reduced motion closes at once.
export function playDialogExit(dialog, drawer, done) {
  if (!dialog || !drawer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }
  dialog.classList.add('is-closing');
  gsap.to(dialog, {x: 56, autoAlpha: 0, duration: 0.2, ease: 'power2.in', onComplete: done});
}
