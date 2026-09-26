import { useRef, useState } from "react";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import { QRCode } from "antd";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { formatCents, formatPoints } from "../legacy-modules/services/billingApi.js";

gsap.registerPlugin(useGSAP);

function motionDisabled() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.classList.contains("settings-no-animations");
}

export function checkoutCountdown(expiresAt, now) {
	const expiresAtMs = new Date(expiresAt || "").getTime();
	if (!Number.isFinite(expiresAtMs)) {
		return { expired: false, label: null };
	}
	const remaining = Math.max(0, expiresAtMs - now);
  const seconds = Math.ceil(remaining / 1000);
  return {
    expired: seconds <= 0,
    label: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
  };
}

export function mergePaymentOrder(previous, current) {
	if (!previous) return current;
	if (!current) return previous;
	const merged = { ...previous, ...current };
	if (!current.payUrl && previous.payUrl) merged.payUrl = previous.payUrl;
	if (!current.expiresAt && previous.expiresAt) merged.expiresAt = previous.expiresAt;
	if (!current.payUrl && previous.requiresManualAmount) merged.requiresManualAmount = true;
	return merged;
}

function successGrant(plan) {
  if (!plan || plan.preview) return null;
  if (plan.kind === "subscription" && Number(plan.dailyGrantCents || 0) > 0) {
    return { caption: "每天额度（不累计）", points: formatPoints(plan.dailyGrantCents, { withUnit: false }) };
  }
  const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0);
  return total > 0 ? { caption: "共入账", points: formatPoints(total, { withUnit: false }) } : null;
}

export function CheckoutOrderStage({ checkout, now, quotaText, onClose, onCancel, onRequestCancel, onKeepPaying, onRetry, upgradeReturnLabel = '返回订阅管理', t }) {
  const order = checkout.order;
  const status = order.status;
  const terminal = ["cancelled", "expired", "failed"].includes(status);
  const completed = status === "completed";
  const confirming = ["paid", "uncertain"].includes(status);
  const [successReady, setSuccessReady] = useState(completed);
  const rootRef = useRef(null);
  const burstRef = useRef(null);
  const lastLiveRef = useRef(confirming ? "confirming" : "pay");
  const lastStatusRef = useRef(status);

  if (!completed) {
    lastLiveRef.current = confirming ? "confirming" : "pay";
    lastStatusRef.current = status;
  }

  useGSAP((context, contextSafe) => {
    if (!completed || successReady || terminal) return undefined;
    const finish = contextSafe(() => setSuccessReady(true));
    if (motionDisabled()) {
      finish();
      return undefined;
    }
    const live = rootRef.current?.querySelector("[data-checkout-scene='live']");
    const burst = burstRef.current;
    if (!live || !burst) {
      finish();
      return undefined;
    }
    const rings = burst.querySelectorAll(".pp-checkout__burst-ring");
    const flash = burst.querySelector(".pp-checkout__burst-flash");
    const dots = burst.querySelectorAll(".pp-checkout__burst-dot");
    gsap.set(burst, { autoAlpha: 1 });
    gsap.set(rings, { scale: 0.35, autoAlpha: 0.9 });
    gsap.set(flash, { autoAlpha: 0, scale: 0.4 });
    gsap.set(dots, { x: 0, y: 0, scale: 0.2, autoAlpha: 1 });
    const failsafe = window.setTimeout(finish, 780);
    const timeline = gsap.timeline({
      onComplete: () => {
        window.clearTimeout(failsafe);
        finish();
      },
    });
    timeline
      .to(live, { scale: 1.06, duration: 0.16, ease: "power2.out" }, 0)
      .to(flash, { autoAlpha: 1, scale: 1.15, duration: 0.1, ease: "power2.out" }, 0.08)
      .to(rings, { scale: 2.35, autoAlpha: 0, duration: 0.58, stagger: 0.07, ease: "power2.out" }, 0.1)
      .to(dots, {
        x: (index) => Math.cos((index / dots.length) * Math.PI * 2) * (118 + (index % 3) * 18),
        y: (index) => Math.sin((index / dots.length) * Math.PI * 2) * (96 + (index % 4) * 16),
        scale: 1,
        autoAlpha: 0,
        duration: 0.62,
        stagger: { each: 0.01, from: "random" },
        ease: "power3.out",
      }, 0.1)
      .to(flash, { autoAlpha: 0, scale: 1.6, duration: 0.28, ease: "power2.in" }, 0.18)
      .to(live, { scale: 1.28, autoAlpha: 0, duration: 0.34, ease: "power2.in" }, 0.2);
    return () => {
      window.clearTimeout(failsafe);
    };
  }, { dependencies: [completed, order.id], scope: rootRef });

  useGSAP(() => {
    if (!successReady || motionDisabled()) return undefined;
    const scene = rootRef.current?.querySelector(".pp-checkout__success");
    if (!scene) return undefined;
    const items = scene.querySelectorAll("[data-success-item]");
    gsap.from(items, {
      autoAlpha: 0,
      y: 18,
      scale: 0.88,
      duration: 0.52,
      stagger: 0.07,
      ease: "back.out(1.6)",
      clearProps: "all",
    });
    return undefined;
  }, { dependencies: [successReady], scope: rootRef });

  if (terminal) {
    return (
      <div className="pp-checkout__expired">
        <Clock3 size={38} aria-hidden="true" />
        <strong>{t(order.status === "cancelled" ? "支付订单已取消" : order.status === "failed" ? "支付订单创建失败" : "支付订单已过期")}</strong>
        <button type="button" onClick={onRetry}>
          <RefreshCw size={17} aria-hidden="true" />
          {t(order.subscriptionChangeId ? upgradeReturnLabel : "重新创建")}
        </button>
      </div>
    );
  }

  const liveKind = successReady ? "success" : lastLiveRef.current;
  const liveStatus = successReady ? status : lastStatusRef.current;
  const grant = successGrant(checkout.plan);

  return (
    <div ref={rootRef} className="pp-checkout__stage">
      {successReady ? (
        <div className="pp-checkout__success">
          <span className="pp-checkout__success-mark" data-success-item>
            <Sparkles size={18} aria-hidden="true" />
            <CheckCircle2 size={52} aria-hidden="true" />
          </span>
          <strong className="pp-checkout__success-title" data-success-item>{t("支付成功，积分已到账")}</strong>
          {grant || quotaText ? (
            <p className="pp-checkout__success-quota" data-success-item>
              {grant ? (
                <>
                  <small>{t(grant.caption)}</small>
                  <b>{grant.points}</b>
                  <em>{t("积分")}</em>
                </>
              ) : quotaText}
            </p>
          ) : null}
          <button type="button" data-success-item onClick={onClose}>
            {t("完成")}
          </button>
        </div>
      ) : liveKind === "confirming" ? (
        <div className="pp-checkout__confirming" data-checkout-scene="live" role="status">
          <Clock3 size={30} aria-hidden="true" />
          <strong>{t(liveStatus === "uncertain" ? "订单已记录，正在核实支付渠道结果" : "已收到付款，正在确认积分到账")}</strong>
          <span>{t("请勿重复下单或支付")}</span>
          {liveStatus === "uncertain" && <Link to="/orders">{t("查看我的订单")}</Link>}
          {checkout.error && <p className="pp-checkout__error">{t(checkout.error)}</p>}
        </div>
      ) : (
        <PaymentQRCode
          checkout={checkout}
          now={now}
          onCancel={onCancel}
          onRequestCancel={onRequestCancel}
          onKeepPaying={onKeepPaying}
          t={t}
        />
      )}
      <div ref={burstRef} className="pp-checkout__burst" aria-hidden="true">
        <span className="pp-checkout__burst-flash" />
        <span className="pp-checkout__burst-ring" />
        <span className="pp-checkout__burst-ring" />
        {Array.from({ length: 18 }, (_, index) => (
          <i key={index} className="pp-checkout__burst-dot" />
        ))}
      </div>
    </div>
  );
}

function PaymentQRCode({ checkout, now, onCancel, onRequestCancel, onKeepPaying, t }) {
  const order = checkout.order;
  const rootRef = useRef(null);
  const keepPayingRef = useRef(null);
  const countdown = checkoutCountdown(order.expiresAt, now);
  const amount = formatCents(order.payAmountCents ?? order.amountCents);
  const method = (order.paymentMethod || checkout.method) === "wechat" ? "wechat" : "alipay";
  const paymentName = method === "wechat" ? "微信" : "支付宝";
  const qrPaused = countdown.expired || Boolean(checkout.error);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root || motionDisabled()) return undefined;
    const board = root.querySelector(".pp-checkout__pay-board");
    const timer = root.querySelector(".pp-checkout__timer");
    const qr = root.querySelector(".pp-checkout__qr");
    const laser = root.querySelector(".pp-checkout__laser");
    const corners = Array.from(root.querySelectorAll(".pp-checkout__corner"));
    const enter = gsap.timeline();
    if (board) gsap.set(board, { autoAlpha: 0, y: -14 });
    if (timer) gsap.set(timer, { autoAlpha: 0, y: 12 });
    if (qr && !qrPaused) gsap.set(qr, { autoAlpha: 0, scale: 0.9 });
    corners.forEach((corner) => {
      const right = corner.classList.contains("is-tr") || corner.classList.contains("is-br");
      const bottom = corner.classList.contains("is-bl") || corner.classList.contains("is-br");
      gsap.set(corner, { autoAlpha: 0, x: right ? 12 : -12, y: bottom ? 12 : -12 });
    });
    if (board) enter.to(board, { autoAlpha: 1, y: 0, duration: 0.46, ease: "expo.out", clearProps: "transform" }, 0);
    if (qr && !qrPaused) {
      enter.to(qr, { autoAlpha: 1, scale: 1, duration: 0.54, ease: "expo.out", clearProps: "transform" }, 0.06);
    }
    if (corners.length) {
      enter.to(corners, { autoAlpha: 1, x: 0, y: 0, duration: 0.42, stagger: 0.05, ease: "expo.out", clearProps: "transform" }, 0.14);
    }
    if (timer) enter.to(timer, { autoAlpha: 1, y: 0, duration: 0.4, ease: "expo.out", clearProps: "transform" }, 0.16);
    if (laser && !qrPaused) {
      const travel = Math.max(160, (qr?.clientHeight || 280) - 24);
      gsap.set(laser, { y: 20, autoAlpha: 0, force3D: true });
      const scan = gsap.timeline({ repeat: -1, delay: 0.82 });
      scan
        .to(laser, { autoAlpha: 1, duration: 0.2, ease: "power1.out" })
        .to(laser, { y: travel, duration: 1.62, ease: "sine.inOut" }, 0)
        .to(laser, { autoAlpha: 0.35, duration: 0.14 }, ">-0.14")
        .to(laser, { y: 20, autoAlpha: 1, duration: 1.62, ease: "sine.inOut" })
        .to(laser, { autoAlpha: 0, duration: 0.16 }, ">-0.16");
      gsap.to(corners, {
        opacity: 1,
        duration: 1.15,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        stagger: { each: 0.06, from: "edges" },
        delay: 0.6,
      });
    }
    return undefined;
  }, { scope: rootRef, dependencies: [qrPaused], revertOnUpdate: true });

  useGSAP((context, contextSafe) => {
    const layer = rootRef.current?.querySelector(".pp-checkout__cancel-layer");
    const card = rootRef.current?.querySelector(".pp-checkout__cancel-card");
    if (!checkout.cancelConfirm || !layer || !card) return undefined;
    const focusKeep = contextSafe(() => keepPayingRef.current?.focus?.({ preventScroll: true }));
    if (motionDisabled()) {
      gsap.set([layer, card], { autoAlpha: 1, clearProps: "transform" });
      focusKeep();
      return undefined;
    }
    gsap.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "power2.out" });
    gsap.fromTo(card, { autoAlpha: 0, y: 18, scale: 0.92 }, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.38,
      ease: "back.out(1.5)",
      clearProps: "transform",
      onComplete: focusKeep,
    });
    return undefined;
  }, { dependencies: [checkout.cancelConfirm], scope: rootRef, revertOnUpdate: true });

  return (
    <div ref={rootRef} className="pp-checkout__pay" data-checkout-scene="live" data-payment-method={method}>
      <div className="pp-checkout__pay-board" data-qr-item>
        <div className="pp-checkout__amount">
          <small>{t("应付金额")}</small>
          <strong>{amount}</strong>
        </div>
        <div className="pp-checkout__method">
          <img
            className="pp-checkout__method-logo"
            src={method === "wechat" ? "/pricing/wechat-pay.svg" : "/pricing/alipay.svg"}
            alt=""
          />
          <span>{t(`${paymentName}扫码支付`)}</span>
        </div>
      </div>
      <div className="pp-checkout__scan">
        <div className="pp-checkout__scan-frame">
          {["tl", "tr", "bl", "br"].map((position) => (
            <span key={position} className={`pp-checkout__corner is-${position}`} aria-hidden="true">
              <svg viewBox="0 0 42 42" fill="none">
                <path d="M39.5 2.5H26A23.5 23.5 0 0 0 2.5 26V39.5" />
              </svg>
            </span>
          ))}
          <div className={`pp-checkout__qr${qrPaused ? " is-paused" : ""}`}>
            {qrPaused ? <div className="pp-checkout__qr-paused" role="status">
              <Clock3 size={30} aria-hidden="true" />
              <strong>{t(checkout.error ? "暂时无法确认支付状态" : "支付时间已截止")}</strong>
              <span>{t("正在确认订单状态")}</span>
            </div> : (
              <>
                <QRCode
                  value={String(order.payUrl || "")}
                  size={256}
                  color="#191c24"
                  bgColor="#ffffff"
                  bordered={false}
                  errorLevel="H"
                  icon={method === "wechat" ? "/pricing/wechat-pay.svg" : "/pricing/alipay.svg"}
                  iconSize={52}
                />
                <span className="pp-checkout__laser" aria-hidden="true">
                  <i className="pp-checkout__laser-glow" />
                  <i className="pp-checkout__laser-beam" />
                </span>
              </>
            )}
          </div>
        </div>
        <div className={`pp-checkout__timer${qrPaused ? " is-paused" : ""}`} data-qr-item>
          <Clock3 size={14} aria-hidden="true" />
          <span>{t(qrPaused ? "等待状态更新" : "等待支付")}</span>
          {!qrPaused && countdown.label && <strong>{countdown.label}</strong>}
        </div>
      </div>
      {order.requiresManualAmount && (
        <p className="pp-checkout__notice">
          {t(`扫码后请手动输入 ${amount}，付款金额必须完全一致`)}
        </p>
      )}
      {checkout.error && <p className="pp-checkout__error">{t(checkout.error)}</p>}
      <div className="pp-checkout__decision">
        <div className="pp-checkout__pay-actions">
          <button type="button" disabled={checkout.loading || checkout.cancelConfirm} onClick={onRequestCancel}>
            {t("取消订单")}
          </button>
        </div>
      </div>
      {checkout.cancelConfirm && order.status !== "completed" && (
        <div
          className="pp-checkout__cancel-layer"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="pp-checkout-cancel-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !checkout.loading) onKeepPaying();
          }}
        >
          <div className="pp-checkout__cancel-card">
            <strong id="pp-checkout-cancel-title">{t("确认取消订单？")}</strong>
            <span>{t("确认后当前二维码将失效，未付款不会产生扣款。")}</span>
            <div>
              <button ref={keepPayingRef} type="button" disabled={checkout.loading} onClick={onKeepPaying}>{t("返回支付")}</button>
              <button type="button" disabled={checkout.loading} onClick={onCancel}>
                {checkout.loading && <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />}
                {t(checkout.loading ? "取消中" : "确认取消")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
