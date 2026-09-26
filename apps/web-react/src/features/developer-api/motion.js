import gsap from 'gsap';
import {useGSAP} from '@gsap/react';

gsap.registerPlugin(useGSAP);

export function useConsoleMotion(scope, tab, ready, signedIn) {
  useGSAP(() => {
    if (!ready || !signedIn || !scope.current) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const panels = scope.current.querySelectorAll('.dap-content-heading, .dap-overview-stage, .dap-resource-summary, .dap-overview-grid, .dap-filterbar, .dap-content > .dap-panel, .dap-quickstart');
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

export function useDialogMotion(ref) {
  useGSAP(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector('[data-autofocus]')?.focus({preventScroll: true});
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(dialog, {autoAlpha: 0.01, y: 14, scale: 0.985}, {
        autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out',
        clearProps: 'opacity,visibility,transform',
      });
    }, ref);
    return () => { media.revert(); dialog.close(); };
  }, {scope: ref});
}
