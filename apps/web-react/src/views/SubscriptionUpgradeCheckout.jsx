import { useEffect, useRef, useState } from "react";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import { ArrowRight, LoaderCircle, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import { useLocale } from "../i18n/index.js";
import { apiGet, apiPost } from "../legacy-modules/services/apiClient.js";
import { formatCents, formatPoints } from "../legacy-modules/services/billingApi.js";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { CheckoutOrderStage, mergePaymentOrder } from "./CheckoutOrderStage.jsx";
import { PaymentMethodSwitch } from "./PaymentMethodSwitch.jsx";
import { upgradeComparison } from './subscriptionUpgrade.js';
import "@react/legacy-styles/generated/views/PricingView.css";
import "./PricingView.css";
import "./PricingCheckout.css";

function mergeObservedOrder(previous, next) {
  if (previous?.status === "completed" && next.status !== "completed") return previous;
  if (["cancelled", "expired", "failed"].includes(previous?.status) && ["pending", "uncertain"].includes(next.status)) return previous;
  return mergePaymentOrder(previous, next);
}

export function SubscriptionUpgradeCheckout({ quoteId, returnLabel = '返回订阅管理', dark, onClose, onChanged }) {
  const { t } = useLocale();
  const [checkout, setCheckout] = useState({ checking: true, plan: {} });
  const [methods, setMethods] = useState([]);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [exchangeAccepted, setExchangeAccepted] = useState(false);
  const panel = useRef(null);
  const mounted = useRef(false);
  const mutation = useRef(null);
  const callbacks = useRef({ onClose, onChanged });
  callbacks.current = { onClose, onChanged };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; mutation.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setCheckout({ checking: true, plan: {} });
    setExchangeAccepted(false);
    const load = async () => {
      try {
        const quote = await apiGet(`/me/subscription-changes/${encodeURIComponent(quoteId)}`, options);
        if (quote.kind !== "upgrade" || !["quoted", "pending", "completed"].includes(quote.status)) throw new Error("升级报价已结束，请返回重新选择套餐");
        const snapshot = quote.snapshot || {};
        const plan = { id: quote.targetPlanId, name: snapshot.planName, kind: "subscription", priceCents: quote.amountCents, dailyGrantCents: snapshot.dailyPoints, durationDays: snapshot.durationDays };
        let order = null, paymentMethods = [];
        if (quote.status === "pending") {
          const data = await apiGet("/orders", { ...options, query: { limit: 100 } });
          const existing = data.items?.find(item => item.subscriptionChangeId === quoteId);
          if (!existing) throw new Error("升级订单状态已变化，请重新读取或查看订单");
          const current = await apiGet(`/orders/${encodeURIComponent(existing.id)}`, options);
          if (current?.id !== existing.id || current.subscriptionChangeId !== quoteId) throw new Error("升级订单信息不匹配，请重新读取");
          order = mergePaymentOrder(existing, current);
        } else if (quote.status === "quoted") {
          const catalog = await apiGet("/plans", options);
          if (!catalog.paymentEnabled) throw new Error("支付渠道暂不可用，请稍后再试");
          paymentMethods = (catalog.paymentMethods || []).filter(method => ["alipay", "wechat"].includes(method));
          if (!paymentMethods.length) throw new Error("暂无可用支付方式");
        }
        if (controller.signal.aborted) return;
        setMethods(paymentMethods);
        setCheckout({ plan, quote, order, method: order?.paymentMethod || paymentMethods[0], checking: false, loading: false, error: order?.syncError || "" });
      } catch (error) {
        if (!controller.signal.aborted) setCheckout({ plan: {}, checking: false, checkFailed: true, error: error.message });
      }
    };
    void load();
    return () => controller.abort();
  }, [quoteId, version]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trap = event => {
      if (event.key !== "Tab" || !panel.current) return;
      const root = panel.current.querySelector('[role="alertdialog"]') || panel.current;
      const focusable = [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); panel.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { window.clearInterval(timer); document.body.style.overflow = overflow; document.removeEventListener("keydown", trap); };
  }, []);

  useEffect(() => {
    const order = checkout.order;
    if (!order?.id || !["pending", "uncertain", "paid"].includes(order.status)) return;
    const controller = new AbortController();
    let timer, inFlight = false, stopped = false;
    const poll = async () => {
      if (inFlight || stopped) return;
      window.clearTimeout(timer);
      if (document.hidden) return;
      inFlight = true;
      let terminal = false;
      try {
        const next = await apiGet(`/orders/${encodeURIComponent(order.id)}`, { signal: controller.signal });
        if (next?.id !== order.id) throw new Error("无法确认订单状态");
        const wallet = next.status === "completed" ? await apiGet("/me/wallet", { signal: controller.signal }).catch(() => null) : null;
        if (controller.signal.aborted) return;
        terminal = ["completed", "cancelled", "expired", "failed"].includes(next.status);
        setCheckout(value => value.order?.id === order.id ? { ...value, order: mergeObservedOrder(value.order, next), error: next.syncError || "" } : value);
        if (wallet) window.dispatchEvent(new CustomEvent("starclouds:wallet-updated", { detail: wallet }));
        if (terminal) callbacks.current.onChanged();
      } catch (error) {
        if (!controller.signal.aborted) setCheckout(value => ({ ...value, error: "支付状态确认失败，正在重试" }));
      } finally {
        inFlight = false;
        if (!stopped && !terminal) timer = window.setTimeout(poll, 2000);
      }
    };
    timer = window.setTimeout(poll, 1000);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll); };
  }, [checkout.order?.id, checkout.order?.status]);

  async function changeOrder(cancel = false) {
    if (checkout.loading || mutation.current) return;
    if (!cancel && checkout.quote?.snapshot?.upgradeMode === 'restart' && !exchangeAccepted) return;
    const controller = new AbortController();
    mutation.current = controller;
    setCheckout(value => ({ ...value, loading: true, error: "", errorCode: "" }));
    try {
      const next = cancel
        ? await apiPost(`/orders/${encodeURIComponent(checkout.order.id)}/close`, null, { signal: controller.signal })
        : await apiPost("/orders", { planId: checkout.plan.id, paymentMethod: checkout.method, upgradeQuoteId: quoteId }, { signal: controller.signal });
      if (!next?.id) throw new Error("无法确认订单状态，请查看我的订单");
      if (next.subscriptionChangeId !== quoteId) throw new Error("升级订单信息不匹配，请查看我的订单");
      const wallet = next.status === "completed" ? await apiGet("/me/wallet", { signal: controller.signal }).catch(() => null) : null;
      if (!mounted.current) return;
      setCheckout(value => ({ ...value, order: mergeObservedOrder(value.order, next), method: next.paymentMethod || value.method, loading: false, cancelConfirm: false, error: next.syncError || "" }));
      callbacks.current.onChanged();
      if (wallet) window.dispatchEvent(new CustomEvent("starclouds:wallet-updated", { detail: wallet }));
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setCheckout(value => ({ ...value, loading: false, cancelConfirm: false, error: error.message, errorCode: error.code }));
    } finally { if (mutation.current === controller) mutation.current = null; }
  }

  const rights = checkout.quote?.snapshot.contract;
  const comparisons = upgradeComparison(checkout.quote?.snapshot);
  const protectionCopy = rights?.lockModelPrices
    ? '模型价格按本次升级重新锁定，原锁价不再沿用。'
    : '模型按实时价格计费，不提供锁价保护。';

  return <DialogMotion open layerClassName={`pp pp-pricing pp-checkout-backdrop${dark ? " is-dark" : ""}`} panelClassName={`pp-checkout${!checkout.checking && !checkout.checkFailed && !checkout.order && checkout.quote?.status !== 'completed' ? ' pp-upgrade-quote' : ''}`} panelRef={panel} variant="checkout" ariaLabelledby="subscription-payment-title" closeOnBackdrop={false} closeDisabled={Boolean(checkout.loading)} onClose={() => checkout.cancelConfirm ? setCheckout(value => ({ ...value, cancelConfirm: false })) : onClose()}>
    <header className="pp-checkout__head"><div><h2 id="subscription-payment-title"><Wallet size={22} />{t("订阅升级支付")}</h2></div><button type="button" className="pp-icon-button" aria-label={t("关闭")} title={t("关闭")} disabled={checkout.loading} onClick={onClose}><X size={18} /></button></header>
    {checkout.checking ? <div className="pp-checkout__confirming" role="status"><LoaderCircle className="is-spinning" size={30} /><strong>{t("正在读取升级订单")}</strong></div>
      : checkout.checkFailed ? <div className="pp-checkout__confirming"><p className="pp-checkout__error" role="alert">{checkout.error}</p><button className="pp-checkout__submit" onClick={() => setVersion(value => value + 1)}><RefreshCw size={17} />{t("重新读取")}</button><Link to="/orders">{t("查看我的订单")}</Link></div>
      : checkout.order ? <CheckoutOrderStage key={checkout.order.id} checkout={checkout} now={now} quotaText={checkout.plan.name} upgradeReturnLabel={returnLabel} onClose={onClose} onRetry={onClose} onCancel={() => changeOrder(true)} onRequestCancel={() => setCheckout(value => ({ ...value, cancelConfirm: true }))} onKeepPaying={() => setCheckout(value => ({ ...value, cancelConfirm: false }))} t={t} />
      : checkout.quote?.status === "completed" ? <div className="pp-checkout__confirming"><strong>{t("订阅升级已完成")}</strong><button className="pp-checkout__submit" onClick={onClose}>{t(returnLabel)}</button></div>
      : <div className="pp-checkout__body">
        <div className="pp-upgrade-scroll" role="region" aria-label={t('升级方案与抵扣明细')} tabIndex={0}>
        <div className="pp-checkout__hero is-upgrade"><div className="pp-checkout__summary"><span className="pp-upgrade-amount-label">{t('本次升级补差价')}</span><strong>{formatCents(checkout.plan.priceCents)}</strong></div><img className="pp-checkout__art" src="/pricing/subscription-upgrade.webp" alt="" /></div>
        {checkout.quote?.snapshot.upgradeMode === "restart" && <p className="pp-checkout__notice">{t(`升级开通起完整 ${checkout.plan.durationDays} 天，旧未用订阅积分将回收置换。`)}</p>}
        <div className="pp-upgrade-details">
        <table className="pp-upgrade-comparison" aria-label={t('升级前后权益对比')}>
          <colgroup><col className="pp-upgrade-comparison__label" /><col /><col /></colgroup>
          <thead><tr><th scope="col">{t('对比项目')}</th><th scope="col"><span>{t('原套餐')}</span><strong className="pp-upgrade-source">{checkout.quote.snapshot.sourcePlan?.planName || t('原套餐名称未记录')}</strong></th><th scope="col"><span>{t('升级后套餐')}</span><strong className="pp-upgrade-target">{checkout.plan.name}</strong></th></tr></thead>
          <tbody>{comparisons.map(row => <tr key={row.key} className={row.changed ? 'is-changed' : undefined}>
            <th scope="row">{t(row.label)}</th>
            <td className="pp-upgrade-before">{t(row.before)}</td>
            <td className="pp-upgrade-after"><strong>{t(row.after)}</strong>{row.before !== '未记录' && row.before === row.after ? <small>{t('不变')}</small> : null}</td>
          </tr>)}</tbody>
        </table>
        <div className="pp-upgrade-pricing">
        {checkout.quote?.snapshot.upgradeCredit && <>
          <dl className="pp-upgrade-breakdown">
            <div><dt>{t('新套餐价格')}</dt><dd>{formatCents(checkout.quote.snapshot.priceCents)}</dd></div>
            <div className="pp-upgrade-credit"><dt>{t('原订阅抵扣')}</dt><dd>-{formatCents(checkout.quote.snapshot.upgradeCredit.creditCents)}</dd></div>
            <div className="pp-upgrade-total"><dt>{t('本次应付')}</dt><dd>{formatCents(checkout.quote.amountCents)}</dd></div>
          </dl>
          <section className="pp-upgrade-calculation" aria-label={t('抵扣明细')}>
            <dl className="pp-upgrade-calculation__rows">
              <div><dt>{t('剩余时间价值')}</dt><dd>{formatCents(checkout.quote.snapshot.upgradeCredit.timeValueCents)}</dd></div>
              <div><dt>{t('未消耗积分价值')}</dt><dd>{formatCents(checkout.quote.snapshot.upgradeCredit.unusedValueCents)}</dd></div>
              <div><dt>{t('旧未用积分回收')}</dt><dd>{formatPoints(checkout.quote.snapshot.upgradeCredit.reclaimPoints)}</dd></div>
              <div><dt>{t('报价有效至')}</dt><dd>{new Date(checkout.quote.expiresAt).toLocaleString('zh-CN', { hour12:false })}</dd></div>
            </dl>
            <p>{t('抵扣额按剩余时间价值与未消耗积分价值取低计算，不超过原订阅剩余实付金额。')}</p>
          </section>
        </>}
        {rights && <p className="pp-checkout__notice">{t(protectionCopy)}</p>}
        </div>
        </div>
        </div>
        <footer className="pp-upgrade-payment" aria-label={t('升级支付操作')}>
        <PaymentMethodSwitch methods={methods} value={checkout.method} onChange={method => setCheckout(value => ({ ...value, method }))} disabled={checkout.loading} t={t} />
        {checkout.error && <p className="pp-checkout__error" role="alert">{checkout.error}</p>}
        {checkout.errorCode === "user_unsettled_order" && <Link to="/orders">{t("查看我的订单")}</Link>}
        {checkout.quote?.snapshot.upgradeMode === 'restart' && <label className="pp-upgrade-consent"><input type="checkbox" checked={exchangeAccepted} onChange={event => setExchangeAccepted(event.target.checked)} /><span>{t('确认以抵扣额置换新周期，并回收旧订阅未用积分')}</span></label>}
        {checkout.errorCode === "upgrade_quote_invalid" ? <button type="button" className="pp-checkout__submit" onClick={onClose}>{t('重新选择套餐')}</button> : <button type="button" className="pp-checkout__submit" disabled={checkout.loading || !methods.includes(checkout.method) || checkout.quote?.snapshot.upgradeMode === 'restart' && !exchangeAccepted} onClick={() => changeOrder()}>{checkout.loading ? <LoaderCircle size={18} className="is-spinning" /> : <ShieldCheck size={18} />}{t(checkout.loading ? "正在创建订单" : `使用${checkout.method === "wechat" ? "微信" : "支付宝"}支付`)}<ArrowRight size={18} /></button>}
        </footer>
      </div>}
  </DialogMotion>;
}
