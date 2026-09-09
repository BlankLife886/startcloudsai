import { useEffect, useRef, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import './holo-feedback.css';

gsap.registerPlugin(useGSAP);

export function useHoloFeedback() {
  const sequence = useRef(0);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2800);
    return () => clearTimeout(timer);
  }, [feedback]);
  return { feedback, notify: (message, kind = 'success') => setFeedback({ message, kind, id: ++sequence.current }), dismiss: () => setFeedback(null) };
}

export function HoloFeedback({ feedback, onDismiss }) {
  const rootRef = useRef(null);
  useGSAP(() => {
    if (!feedback || !rootRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { gsap.set(rootRef.current, { autoAlpha: 1, y: 0 }); return; }
    gsap.fromTo(rootRef.current, { autoAlpha: 0, y: -7 }, { autoAlpha: 1, y: 0, duration: .32, ease: 'power3.out', overwrite: true });
  }, { scope: rootRef, dependencies: [feedback?.id], revertOnUpdate: true });
  return feedback ? <div className="holo-feedback-position"><div ref={rootRef} className="holo-feedback" role="status"><span className="holo-feedback-mark"><Check size={14}/></span><span>{feedback.message}</span><button type="button" aria-label="关闭提示" onClick={onDismiss}><X size={13}/></button></div></div> : null;
}

export function HoloLoadingState({ active, label = '正在装裱图片' }) {
  return active ? <div className="holo-card-loading" role="status"><span className="holo-loading-glyph"><Sparkles size={20}/></span><span>{label}</span></div> : null;
}
