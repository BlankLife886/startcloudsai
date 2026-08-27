import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Link, useLocation, useNavigate } from "react-router";
import "@react/legacy-static/views/auth/auth-page.css";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useIsDark } from "../../hooks/useIsDark.js";

gsap.registerPlugin(useGSAP);

const mangaPanels = [
  "polygon(0 0, 47.5% 0, 0 63%)",
  "polygon(49% 0, 75% 0, 66% 53%, 49% 0)",
  "polygon(76.5% 0, 100% 0, 100% 35%, 68% 53%, 76.5% 0)",
  "polygon(0 65.5%, 0 100%, 42% 100%, 54% 55%, 0 65.5%)",
  "polygon(56% 55%, 68% 55%, 100% 37%, 100% 100%, 44% 100%)",
];

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...options,
    headers: options.body
      ? { "Content-Type": "application/json", ...options.headers }
      : options.headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || `请求失败（${response.status}）`);
  }
  return payload.data;
}

function safeRedirect(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function AuthAccountView() {
  const pageRef = useRef(null);
  const isDark = useIsDark();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const query = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const [providers, setProviders] = useState({
    email: true,
    verificationCode: true,
  });
  const [email, setEmail] = useState(query.get("email") || "");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState(query.get("error") || "");
  const [info, setInfo] = useState("");

  useEffect(() => {
    let disposed = false;
    Promise.allSettled([apiRequest("/auth/providers")]).then(([providerResult]) => {
      if (disposed) return;
      if (providerResult.status === "fulfilled" && providerResult.value) {
        setProviders((current) => ({ ...current, ...providerResult.value }));
      }
    });
    return () => {
      disposed = true;
    };
  }, [navigate, query]);

  useEffect(() => {
    if (auth.user?.id) {
      navigate(safeRedirect(query.get("redirect")), { replace: true });
    }
  }, [auth.user, navigate, query]);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds > 0]);

  async function sendCode() {
    if (!providers.email) {
      setError("邮箱验证码服务暂不可用，请联系管理员");
      return;
    }
    setError("");
    setInfo("");
    setSending(true);
    try {
      const result = await apiRequest("/auth/email-verification-codes", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setCodeSent(true);
      setResendSeconds(Number(result?.resendAfter) || 60);
      setInfo(
        result?.developmentCode
          ? `开发环境验证码：${result.developmentCode}`
          : "验证码已发送，请检查邮箱。",
      );
    } catch (caught) {
      setError(caught?.message || "验证码发送失败");
    } finally {
      setSending(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    if (!/^\d{6}$/.test(code)) {
      setError("请输入六位邮箱验证码");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiRequest("/auth/session", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      auth.setUser(result?.user || null);
      navigate(safeRedirect(query.get("redirect")), { replace: true });
    } catch (caught) {
      setError(caught?.message || "验证失败");
    } finally {
      setSubmitting(false);
    }
  }

  const codeButtonLabel = sending
    ? "发送中…"
    : resendSeconds > 0
      ? `${resendSeconds}s 后重发`
      : codeSent
        ? "重新发送"
        : "获取验证码";

  useGSAP(
    () => {
      const root = pageRef.current;
      if (!root) return undefined;
      const topItems = gsap.utils.toArray("[data-auth-top]", root);
      const card = root.querySelector("[data-auth-card]");
      const cardSections = card
        ? Array.from(card.children).filter((element) => element instanceof HTMLElement)
        : [];
      const targets = [...topItems, card, ...cardSections].filter(Boolean);
      root.dataset.authMotionState = "entering";

      const disabled =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("settings-no-animations");
      if (disabled) {
        gsap.set(targets, { clearProps: "opacity,visibility,transform" });
        root.dataset.authMotionState = "entered";
        return undefined;
      }

      const timeline = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => {
          root.dataset.authMotionState = "entered";
        },
      });
      timeline
        .fromTo(
          topItems,
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.05, clearProps: "opacity,visibility,transform" },
        )
        .fromTo(
          card,
          { autoAlpha: 0, y: 12 },
          { autoAlpha: 1, y: 0, duration: 0.44, clearProps: "opacity,visibility,transform" },
          "-=0.2",
        )
        .fromTo(
          cardSections,
          { autoAlpha: 0, y: 6 },
          { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.055, clearProps: "opacity,visibility,transform" },
          "-=0.27",
        );
      return () => timeline.kill();
    },
    { scope: pageRef },
  );

  return (
    <main
      ref={pageRef}
      className={`auth-page is-single is-ready${isDark ? " is-dark" : ""}`}
      data-auth-motion-state="idle"
      style={{ "--auth-manga-image": 'url("/brand/auth-manga-bg.png")' }}
    >
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-manga">
          {mangaPanels.map((clipPath, index) => (
            <div
              key={index}
              className="auth-manga__panel"
              style={{ clipPath }}
            />
          ))}
          <div className="auth-manga__shade" />
        </div>
        <div className="auth-split-white" />
      </div>

      <header className="auth-topbar">
        <Link data-auth-top to="/" className="auth-brand">
          <img src="/brand/starcloud-logo.svg" alt="" />
          <span>
            <strong>星空云绘</strong>
            <small>StarCloudIsAI</small>
          </span>
        </Link>
        <Link data-auth-top to="/" className="auth-back">
          <i className="bi bi-arrow-left" />
          返回首页
        </Link>
      </header>

      <div className="auth-stage">
        <div data-auth-card className="auth-unified-card">
          <section className="auth-hero" aria-label="账号入口介绍">
            <div className="auth-hero-copy">
              <p data-auth-hero className="auth-hero-brandline">
                StarCloudIsAI · CREATIVE WORKSPACE
              </p>
              <p data-auth-hero className="auth-kicker">
                欢迎回来
              </p>
              <h1 data-auth-hero className="auth-site-name">
                继续你的创作
              </h1>
              <p data-auth-hero className="auth-hero-lead">
                一个账号连接创作记录、云端任务与个人资产，让每次灵感都能继续生长。
              </p>
            </div>
            <p className="auth-hero-footnote">
              <i className="bi bi-stars" aria-hidden="true" />
              首次验证将自动创建星空云绘账号
            </p>
          </section>

          <div className="auth-panel-shell auth-panel-shell--single">
            <div className="auth-panel-motion">
              <article className="auth-panel-card auth-flow-card is-active">
              <div className="auth-panel-head">
                <span className="auth-panel-brandmark" aria-hidden="true">
                  <img src="/brand/starcloud-logo.svg" alt="" />
                </span>
                <div className="auth-panel-head__copy">
                  <h2>登录</h2>
                  <small>STARCLOUD ACCOUNT</small>
                </div>
              </div>

              <div className="auth-panel-meta" aria-label="验证说明">
                <span><i className="bi bi-clock" aria-hidden="true" />3 分钟有效</span>
                <span><i className="bi bi-person-plus" aria-hidden="true" />首次验证自动建号</span>
              </div>

              {(error || info) && (
                <div className="auth-panel-alerts" aria-live="polite">
                  {error && (
                    <p className="auth-notice is-error" role="alert">
                      <i className="bi bi-exclamation-triangle" />
                      {error}
                    </p>
                  )}
                  {info && (
                    <p className="auth-notice is-info" role="status">
                      <i className="bi bi-check-circle" />
                      {info}
                    </p>
                  )}
                </div>
              )}

              <div className="auth-panel-body">
                <form className="auth-form" onSubmit={submit}>
                  <label className="auth-field auth-field-email">
                    <span>Gmail / QQ 邮箱</span>
                    <div className="input-wrap">
                      <i className="bi bi-envelope" />
                      <input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        type="email"
                        autoComplete="email"
                        placeholder="name@gmail.com"
                        required
                      />
                    </div>
                  </label>
                  <div className="auth-code-row">
                    <label className="auth-field">
                      <span>六位验证码</span>
                      <div className="input-wrap">
                        <i className="bi bi-shield-check" />
                        <input
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          pattern="[0-9]{6}"
                          placeholder="6 位验证码"
                          required
                        />
                      </div>
                    </label>
                    <button
                      className="auth-code-btn"
                      type="button"
                      disabled={
                        sending || resendSeconds > 0 || !providers.email
                      }
                      onClick={sendCode}
                    >
                      {codeButtonLabel}
                    </button>
                  </div>
                  <button
                    className="auth-submit"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting ? "验证中…" : "继续 →"}
                  </button>
                </form>
              </div>

              <footer className="auth-panel-footer auth-mode-footer">
                <div className="auth-provider-list" aria-label="支持的邮箱">
                  <span><i className="bi bi-google" aria-hidden="true" />谷歌邮箱</span>
                  <span><i className="bi bi-tencent-qq" aria-hidden="true" />QQ 邮箱</span>
                </div>
                <p><i className="bi bi-lock" aria-hidden="true" />邮箱仅用于账号验证与安全通知</p>
              </footer>
              </article>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
