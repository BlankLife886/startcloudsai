import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { useLocale } from "../i18n/index.js";
import {
  claimTrialAccessReward,
  getTrialAccessApplication,
  getTrialAccessCampaign,
  submitTrialAccessApplication,
} from "@react/legacy-modules/services/trialAccessApi.js";
import { formatPoints } from "@react/legacy-modules/services/billingApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { publishWalletSnapshot } from "@react/legacy-modules/services/walletSync.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import { DialogMotion } from "./motion/DialogMotion.jsx";
import "./TrialAccessDialog.css";

const OCCUPATIONS = [
  "平面设计师",
  "UI 设计师",
  "插画师",
  "自媒体创作者",
  "摄影师",
  "游戏美术",
  "产品经理",
  "前端开发工程师",
  "AI 工程师",
  "电商运营",
  "品牌运营",
  "学生",
  "教师",
  "自由职业者",
  "艺术家",
];
const MAX_OCCUPATIONS = 4;
const SCROLL_LOCK_OWNER = "trial-access-dialog-react";

function sourceFeatures(source) {
  if (Array.isArray(source?.features) && source.features.length) return source.features;
  return source?.feature ? [source.feature] : [];
}

function dateLocale(locale) {
  if (locale === "en-US") return "en-US";
  if (locale === "zh-TW") return "zh-TW";
  return "zh-CN";
}

function formatDate(value, locale) {
  if (!value) return "长期有效";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "长期有效";
  return date.toLocaleString(dateLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function joinLabels(items, t, locale) {
  const parts = (items || []).map((item) => t(item)).filter(Boolean);
  if (!parts.length) return "—";
  return parts.join(locale === "en-US" ? ", " : "、");
}

export function TrialAccessDialog({ open, initialCampaign = null, onClose }) {
  const auth = useAuth();
  const isDark = useIsDark();
  const { t, locale } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [occupations, setOccupations] = useState([]);
  const [customOccupation, setCustomOccupation] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (open) setBodyScrollLock(SCROLL_LOCK_OWNER, true, { freezeViewport: true });
  }, [open]);

  useEffect(
    () => () => setBodyScrollLock(SCROLL_LOCK_OWNER, false),
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      getTrialAccessCampaign({ signal: controller.signal }),
      auth.isAuthenticated
        ? getTrialAccessApplication({ signal: controller.signal })
        : Promise.resolve(null),
    ])
      .then(([nextCampaign, nextApplication]) => {
        if (controller.signal.aborted) return;
        setCampaign(nextCampaign);
        setApplication(nextApplication);
        if (nextApplication?.status === "rejected") {
          setOccupations(
            String(nextApplication.occupation || "")
              .split(/\s*(?:、|;)\s*/)
              .filter(Boolean)
              .slice(0, MAX_OCCUPATIONS),
          );
          setReason(nextApplication.reason || "");
        }
      })
      .catch((caught) => {
        if (caught?.name !== "AbortError") setError(caught?.message || t("体验活动读取失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [auth.isAuthenticated, open]);

  const status = application?.status || "";
  const rewardStatus = application?.rewardStatus || "";
  const features = useMemo(
    () => sourceFeatures(["pending", "approved"].includes(status) ? application : campaign),
    [application, campaign, status],
  );
  const campaignOpen = campaign?.enabled === true && campaign?.status === "active" && !campaign?.expired;
  const unavailable = !campaignOpen || campaign?.full === true;
  const screen = loading
    ? "loading"
    : error
      ? "error"
      : unavailable
        ? "unavailable"
        : !auth.isAuthenticated
          ? "auth"
          : status === "pending"
            ? "pending"
            : status === "approved" && rewardStatus === "expired"
              ? "expired"
              : status === "approved" && rewardStatus === "redeemed"
                ? "redeemed"
                : status === "approved"
                  ? "approved"
                  : "apply";
  const applied = Math.max(0, Number(campaign?.displayApplied || 0));
  const capacity = Math.max(0, Number(campaign?.capacity || 0));
  const progress = capacity ? Math.min(100, (applied / capacity) * 100) : 0;

  function continueToAuth(mode) {
    const returnTarget = `${location.pathname}?${new URLSearchParams({
      ...Object.fromEntries(new URLSearchParams(location.search)),
      trial: "apply",
    }).toString()}`;
    onClose?.();
    navigate(`/auth?mode=${mode}&redirect=${encodeURIComponent(returnTarget)}`);
  }

  function toggleOccupation(value) {
    setOccupations((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= MAX_OCCUPATIONS) {
        notificationService.info(t("最多只能选择 4 个职业"));
        return current;
      }
      return [...current, value];
    });
  }

  function addCustomOccupation() {
    const value = customOccupation.trim().slice(0, 50);
    if (value.length < 2) {
      notificationService.info(t("请输入至少 2 个字的职业名称"));
      return;
    }
    if (!occupations.includes(value)) toggleOccupation(value);
    setCustomOccupation("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!occupations.length) {
      notificationService.info(t("请至少选择一个职业"));
      return;
    }
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10) {
      notificationService.info(t("申请理由至少需要 10 个字"));
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await submitTrialAccessApplication({
        occupation: occupations.join("、"),
        reason: normalizedReason,
      });
      setApplication(result?.application || result || null);
      notificationService.success(t("体验资格申请已提交"));
    } catch (caught) {
      if (["trial_application_pending", "trial_application_approved"].includes(caught?.code)) {
        const next = await getTrialAccessApplication().catch(() => null);
        if (next) setApplication(next);
      } else {
        notificationService.error(caught?.message || t("体验资格申请提交失败"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshApplication() {
    setLoading(true);
    setError("");
    try {
      setApplication(await getTrialAccessApplication());
    } catch (caught) {
      setError(caught?.message || t("体验资格申请读取失败"));
    } finally {
      setLoading(false);
    }
  }

  async function claimReward() {
    if (claiming) return;
    setClaiming(true);
    try {
      const result = await claimTrialAccessReward();
      publishWalletSnapshot(result);
      setApplication(await getTrialAccessApplication());
      notificationService.success(t(`体验积分已到账 +${formatPoints(result?.grantCents || 0)}`));
    } catch (caught) {
      notificationService.error(caught?.message || t("体验积分领取失败"));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <DialogMotion
      open={open}
      variant="detail"
      layerClassName={`trial-dialog-layer${isDark ? " is-dark" : ""}`}
      panelClassName="trial-dialog"
      ariaLabelledby="trial-dialog-title"
      closeDisabled={submitting || claiming}
      onClose={onClose}
      onExited={() => setBodyScrollLock(SCROLL_LOCK_OWNER, false)}
    >
        <button type="button" className="trial-dialog__close" aria-label={t("关闭体验资格弹窗")} disabled={submitting || claiming} onClick={onClose}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
        <aside className="trial-dialog__story" data-dialog-motion-item>
          <span className="trial-dialog__mark" aria-hidden="true"><i className="bi bi-stars" /></span>
          <p className="trial-dialog__eyebrow">EARLY CREATOR PROGRAM</p>
          <h2 id="trial-dialog-title">{t(campaign?.title || "申请体验")}</h2>
          <p className="trial-dialog__intro">{t("告诉我们你的创作方式。审核通过后，可领取体验积分并进入获批工作台。")}</p>
          {campaign && (
            <section className="trial-dialog__campaign" aria-label={t("体验活动名额")}>
              <header><span>{t("本期体验功能")}</span><strong>{campaign.full ? t("名额已满") : t(`剩余 ${campaign.remaining ?? 0} 名`)}</strong></header>
              <div className="trial-dialog__features">
                {sourceFeatures(campaign).map((feature) => <span key={feature.key}><i className={`bi ${feature.icon || "bi-stars"}`} />{t(feature.label)}</span>)}
              </div>
              <div className="trial-dialog__track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
              <dl><div><dt>{t("已申请")}</dt><dd>{applied}</dd></div><div><dt>{t("总名额")}</dt><dd>{capacity || "—"}</dd></div><div><dt>{t("活动截止")}</dt><dd>{t(formatDate(campaign.expiresAt, locale))}</dd></div></dl>
            </section>
          )}
          <ol className="trial-dialog__steps"><li><span>01</span>{t("登录账号")}</li><li><span>02</span>{t("提交职业与申请理由")}</li><li><span>03</span>{t("审核通过后领取积分")}</li></ol>
        </aside>
        <main className="trial-dialog__content" aria-live="polite" data-dialog-motion-item>
          {screen === "loading" && <div className="trial-dialog__loading"><i className="bi bi-stars" /><span>{t("正在读取体验活动…")}</span></div>}
          {screen === "error" && <State icon="bi-cloud-slash" title={t("体验活动读取失败")} text={t(error)}><div className="trial-dialog__button-row"><button type="button" className="is-primary" onClick={refreshApplication}>{t("重试")}</button></div></State>}
          {screen === "unavailable" && <State icon="bi-calendar2-x" title={t("本期申请已结束")} text={t("本期体验名额已满或活动已经关闭，暂时不能提交新的申请。")}><div className="trial-dialog__button-row"><button type="button" className="is-secondary" onClick={onClose}>{t("关闭")}</button></div></State>}
          {screen === "auth" && <State icon="bi-person-plus" title={t("请先登录账号")} text={t("申请进度、审核结果和体验积分都会绑定到你的账号。")}><div className="trial-dialog__button-row"><button type="button" className="is-primary" onClick={() => continueToAuth("register")}>{t("免费注册")}</button><button type="button" className="is-secondary" onClick={() => continueToAuth("login")}>{t("已有账号，去登录")}</button></div></State>}
          {screen === "pending" && <State icon="bi-hourglass-split" title={t("申请审核中")} text={t("申请已收到，审核结果会显示在这里并通过站内通知提醒你。")}><Summary application={application} features={features} t={t} locale={locale} /><div className="trial-dialog__button-row"><button type="button" className="is-primary" onClick={refreshApplication}>{t("刷新状态")}</button><button type="button" className="is-secondary" onClick={onClose}>{t("我知道了")}</button></div></State>}
          {screen === "approved" && <State icon="bi-patch-check-fill" title={t("体验资格已通过")} text={t("真实功能权限已经生效，领取后积分可用于全部获批功能。")}><Reward application={application} t={t} locale={locale} /><button type="button" className="is-primary is-wide" disabled={claiming} onClick={claimReward}>{claiming ? t("领取中…") : t("立即领取")}</button></State>}
          {screen === "expired" && <State icon="bi-clock-history" title={t("体验积分已过期")} text={t("领取期限已经结束，请等待管理员重新发放体验积分。")}><Reward application={application} t={t} locale={locale} /></State>}
          {screen === "redeemed" && <State icon="bi-check-lg" title={t("体验积分已到账")} text={t("活动积分已经存入钱包，现在可以进入获批工作台开始体验。")}><Reward application={application} t={t} locale={locale} /><div className="trial-dialog__launchers">{features.map((feature) => <button key={feature.key} type="button" onClick={() => { onClose?.(); navigate(feature.route || "/studio"); }}><i className={`bi ${feature.icon || "bi-stars"}`} /><span>{t(feature.label)}</span><i className="bi bi-arrow-right" /></button>)}</div><div className="trial-dialog__button-row"><button type="button" className="is-secondary" onClick={() => { onClose?.(); navigate("/wallet"); }}>{t("查看钱包")}</button></div></State>}
          {screen === "apply" && (
            <form className="trial-dialog__form" onSubmit={submit}>
              {status === "rejected" && <div className="trial-dialog__rejected"><strong>{t("上次申请未通过")}</strong><p>{t(application?.reviewNote || "可以更新资料后重新提交。")}</p></div>}
              <header><span className="trial-dialog__state-icon"><i className="bi bi-send-check" /></span><h3>{t("申请体验资格")}</h3><p>{t("选择你的职业，并简单说明准备如何使用这些功能。")}</p>{campaign?.nextPosition && <small>{t(`下一位申请者 #${campaign.nextPosition}`)}</small>}</header>
              <fieldset><legend>{t("你的职业")} <em>{occupations.length}/{MAX_OCCUPATIONS}</em></legend><div className="trial-dialog__occupation-list">{OCCUPATIONS.map((item) => <button key={item} type="button" className={occupations.includes(item) ? "is-selected" : ""} onClick={() => toggleOccupation(item)}>{t(item)}{occupations.includes(item) && <i className="bi bi-check-lg" />}</button>)}</div><div className="trial-dialog__custom"><input value={customOccupation} maxLength={50} placeholder={t("列表中没有？输入你的职业")} onChange={(event) => setCustomOccupation(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomOccupation(); } }} /><button type="button" onClick={addCustomOccupation}>{t("添加")}</button></div></fieldset>
              <label><span>{t("申请理由")}</span><textarea value={reason} rows={5} minLength={10} maxLength={1000} required placeholder={t("请说明你想创作什么，以及准备如何使用平台…")} onChange={(event) => setReason(event.target.value)} /><small>{reason.trim().length} / 1000</small></label>
              <button type="submit" className="is-primary is-wide" disabled={submitting}>{submitting ? t("正在提交…") : t("提交申请")}<i className="bi bi-arrow-right" /></button>
            </form>
          )}
        </main>
    </DialogMotion>
  );
}

function State({ icon, title, text, children }) {
  return <div className="trial-dialog__message"><span className="trial-dialog__state-icon"><i className={`bi ${icon}`} /></span><h3>{title}</h3><p>{text}</p><div className="trial-dialog__actions">{children}</div></div>;
}

function Summary({ application, features, t, locale }) {
  const occupations = String(application?.occupation || "")
    .split(/\s*(?:、|;)\s*/)
    .filter(Boolean);
  return <dl className="trial-dialog__summary"><div><dt>{t("体验功能")}</dt><dd>{joinLabels(features.map((item) => item.label), t, locale)}</dd></div><div><dt>{t("你的职业")}</dt><dd>{joinLabels(occupations, t, locale)}</dd></div><div><dt>{t("申请理由")}</dt><dd>{application?.reason || "—"}</dd></div></dl>;
}

function Reward({ application, t, locale }) {
  return <div className="trial-dialog__reward"><span>{t("体验积分")}</span><strong>{t(formatPoints(application?.rewardCents || 0))}</strong><small>{t(`领取有效期至 ${formatDate(application?.rewardExpiresAt, locale)}`)}</small></div>;
}
