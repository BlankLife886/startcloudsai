import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

const methodMeta = {
  alipay: { label: "支付宝", logo: "/pricing/alipay.svg" },
  wechat: { label: "微信支付", logo: "/pricing/wechat-pay.svg" },
};

export function PaymentMethodSwitch({ methods, value, onChange, disabled = false, t }) {
  const available = [...new Set(methods)].filter(method => methodMeta[method]);
  const selected = Math.max(0, available.indexOf(value));
  const methodKey = available.join(",");
  const root = useRef(null);
  const thumb = useRef(null);
  const previous = useRef(null);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useGSAP(() => {
    if (!thumb.current) return;
    const instant = reduced || document.documentElement.classList.contains("settings-no-animations") || previous.current === null || previous.current !== methodKey;
    gsap.to(thumb.current, { xPercent: selected * 100, x: selected * 4, duration: instant ? 0 : 0.32, ease: "power3.out", overwrite: true });
    previous.current = methodKey;
  }, { scope: root, dependencies: [selected, methodKey, reduced] });

  if (!available.length) return null;
  return <div ref={root} className="pp-pay-methods" role="radiogroup" aria-label={t("支付方式")} aria-disabled={disabled} data-selected-method={available[selected]} style={{ "--method-count": available.length, "--method-gaps": `${(available.length - 1) * 4}px` }} data-dialog-motion-item
    onKeyDown={event => {
      if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (selected + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + available.length) % available.length;
      onChange(available[index]);
      root.current?.querySelectorAll('[role="radio"]')[index]?.focus();
    }}>
    <span ref={thumb} className="pp-pay-methods__thumb" aria-hidden="true" />
    {available.map((method, index) => <button key={method} type="button" role="radio" data-payment-method={method} aria-checked={index === selected} tabIndex={index === selected ? 0 : -1} className={index === selected ? "is-active" : ""} disabled={disabled} onClick={() => onChange(method)}>
      <img className="pp-pay-methods__logo" src={methodMeta[method].logo} alt="" />
      <span>{t(methodMeta[method].label)}</span>
    </button>)}
  </div>;
}
