import { createPortal } from "react-dom";

export function AuthRequiredDialog({ open, featureLabel, detail, onClose, onContinue }) {
  if (!open) return null;
  return createPortal(
    <div className="auth-required-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="auth-required-dialog" role="dialog" aria-modal="true" aria-labelledby="global-auth-required-title">
        <button type="button" className="auth-required-close" aria-label="关闭登录提示" onClick={onClose}><i className="bi bi-x-lg" /></button>
        <div className="auth-required-copy">
          <p className="auth-required-eyebrow"><span />STARCLOUD CREATIVE</p>
          <h2 id="global-auth-required-title">准备开始创作？</h2>
          <p className="auth-required-lead">使用“{featureLabel}”前需要先登录账号。</p>
          <p className="auth-required-detail">{detail}</p>
          <div className="auth-required-actions">
            <button type="button" className="is-primary" onClick={() => onContinue?.("register")}>免费注册<i className="bi bi-arrow-up-right" /></button>
            <button type="button" className="is-secondary" onClick={() => onContinue?.("login")}>去登录</button>
          </div>
          <p className="auth-required-support"><i className="bi bi-shield-check" />支持 Gmail、Googlemail 与 QQ 邮箱验证码</p>
        </div>
        <figure className="auth-required-visual" aria-hidden="true">
          <img src="/sucai/1home-intro-02.png" alt="" />
          <span className="auth-required-visual__line is-one" />
          <span className="auth-required-visual__line is-two" />
          <figcaption><strong>CREATE WITHOUT LIMITS</strong><span>IMAGE · DESIGN · STORY</span></figcaption>
        </figure>
      </section>
    </div>,
    document.body,
  );
}
