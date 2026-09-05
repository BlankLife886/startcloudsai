import { DialogMotion } from "../components/motion/DialogMotion.jsx";

export function AuthRequiredDialog({ open, featureLabel, detail, onClose, onContinue }) {
  return (
    <DialogMotion
      open={open}
      layerClassName="auth-required-layer"
      panelClassName="auth-required-dialog"
      ariaLabelledby="global-auth-required-title"
      onClose={onClose}
    >
      <button type="button" className="auth-required-close" aria-label="关闭登录提示" onClick={onClose}><i className="bi bi-x-lg" /></button>
      <div className="auth-required-copy">
        <p className="auth-required-eyebrow" data-dialog-motion-item><span />STARCLOUD CREATIVE</p>
        <h2 id="global-auth-required-title" data-dialog-motion-item>准备开始创作？</h2>
        <p className="auth-required-lead" data-dialog-motion-item>使用“{featureLabel}”前需要先登录账号。</p>
        <p className="auth-required-detail" data-dialog-motion-item>{detail}</p>
        <div className="auth-required-actions" data-dialog-motion-item>
          <button type="button" className="is-primary" onClick={() => onContinue?.("register")}>免费注册<i className="bi bi-arrow-up-right" /></button>
          <button type="button" className="is-secondary" onClick={() => onContinue?.("login")}>去登录</button>
        </div>
        <p className="auth-required-support" data-dialog-motion-item><i className="bi bi-shield-check" />仅支持谷歌邮箱与 QQ 邮箱注册登录</p>
      </div>
      <figure className="auth-required-visual" aria-hidden="true" data-dialog-motion-item>
        <img src="/sucai/1home-intro-02.png" alt="" />
        <span className="auth-required-visual__line is-one" />
        <span className="auth-required-visual__line is-two" />
        <figcaption><strong>CREATE WITHOUT LIMITS</strong><span>IMAGE · DESIGN · STORY</span></figcaption>
      </figure>
    </DialogMotion>
  );
}
