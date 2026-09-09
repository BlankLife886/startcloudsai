import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Copy, RefreshCw } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { apiRequest } from "../legacy-modules/services/apiClient.js";
import "./invitation.css";

const STATS = [
  ["成功邀请", "invitedCount"],
  ["充值好友", "paidCount"],
  ["累计到账积分", "totalPoints"],
];

function ruleText(config) {
  if (!config) return "";
  if (!config.enabled) return "邀请返利活动暂未开放";
  const frequency = config.firstRewardOnly ? "首次符合条件的充值" : "每笔充值";
  if (config.mode === "percent") return `好友注册后，${frequency}基础积分计提 ${config.percent}% 返利，月底统一结算`;
  return `好友注册后，${frequency}计提 ${config.fixedPoints} 积分，月底统一结算`;
}

const REWARD_STATUS = {pending_settlement:"待结算",voided:"已取消",granted:"已到账",skipped:"未计提",recovery_pending:"待追回",reversed:"已冲正"};
const REWARD_REASON = {disabled:"活动关闭",below_minimum:"未达到最低实付金额",pending_recovery:"存在待追回奖励",already_rewarded:"该好友已获得过奖励",rounded_to_zero:"不足1积分",daily_limit:"已达当日上限",daily_limit_partial:"按当日剩余额度发放"};

export function InvitationView() {
  const { user, loading: authLoading } = useAuth();
  const dark = useIsDark();
  const [snapshot, setSnapshot] = useState(null);
  const data = snapshot?.userId === user?.id ? snapshot.value : null;
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setSnapshot(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    apiRequest("/me/referrals", { query: { page }, signal: controller.signal })
      .then(value => {if(!controller.signal.aborted)setSnapshot({userId:user.id,value});})
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user?.id, page, reload]);

  useEffect(() => {
    setPage(1);
    setCopied(false);
    setCopiedCode(false);
  }, [user?.id]);

  useEffect(() => {
    if (!copied && !copiedCode) return;
    const timer = setTimeout(() => {setCopied(false);setCopiedCode(false);}, 2000);
    return () => clearTimeout(timer);
  }, [copied,copiedCode]);

  const invitation = data ? new URL(data.invitePath, window.location.origin).href : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation);
      setCopied(true);
    } catch {
      setError("复制失败，请选择链接后复制");
    }
  }

  return (
    <div className={`invitation-page${dark ? " is-dark" : ""}`}>
      <div className="invitation-atmosphere" aria-hidden="true">
        <div className="invitation-aurora" />
      </div>

      <div className="invitation-inner">
        <header className="invitation-intro">
          <span>创作伙伴</span>
          <h1>邀请好友</h1>
          <p>好友首次注册后充值积分包，返利按月累计，月底统一结算到账。</p>
        </header>

        {authLoading ? (
          <p className="invitation-note" role="status">
            正在加载…
          </p>
        ) : !user ? (
          <section className="invitation-share invitation-login">
            <h2>与朋友一起创作</h2>
            <p>登录后生成只属于你的邀请链接。</p>
            <Link to="/auth?redirect=%2Finvite">
              登录后获取邀请链接
              <ArrowRight size={16} />
            </Link>
          </section>
        ) : (
          <>
            {error ? (
              <div className="invitation-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={() => setReload((n) => n + 1)} aria-label="重试">
                  <RefreshCw size={16} />
                </button>
              </div>
            ) : null}

            {data ? (
              <section className="invitation-share">
                <h2>专属邀请链接</h2>
                <p>{ruleText(data.config)}</p>
                <div>
                  <input
                    aria-label="邀请链接"
                    readOnly
                    value={invitation}
                    onFocus={(event) => event.target.select()}
                  />
                  <button type="button" disabled={!data.config.enabled} onClick={copy}>
                    <Copy size={16} />
                    {copied ? "已复制" : "复制链接"}
                  </button>
                </div>
                <div className="invitation-code-row">
                  <span>邀请码</span><code>{data.code}</code>
                  <button type="button" disabled={!data.config.enabled} onClick={async()=>{try{await navigator.clipboard.writeText(data.code);setCopiedCode(true)}catch{setError("邀请码复制失败，请手动选择复制")}}}><Copy size={16}/>{copiedCode?"已复制":"复制邀请码"}</button>
                </div>
                <small>
                  仅限通过链接首次注册的好友。返利不含赠送积分、兑换码和订阅额度，按支付确认时的规则计提；百分比积分向下取整。
                </small>
                <small>
                  最低实付：{data.config.minimumAmountCents ? `¥${(data.config.minimumAmountCents / 100).toFixed(2)}` : "不限"}；
                  每人每日计提上限：{data.config.dailyLimitPoints || "不限"} 积分（北京时间）。
                  {data.config.firstRewardOnly ? "每位好友仅计提一次，取消或冲正也计入次数。" : "每笔合格订单独立计提。"}
                </small>
              </section>
            ) : null}

            <div className="invitation-stats" aria-busy={loading}>
              {STATS.map(([label, key]) => (
                <div key={label}>
                  <strong>{data?.[key]?.toLocaleString("zh-CN") ?? "—"}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {data && <section className="invitation-settlement-summary" aria-label="月度结算">
              <strong>待结算：{(data.pendingSettlementPoints || 0).toLocaleString("zh-CN")} 积分</strong>
              <p>按北京时间自然月汇总，次月1日00:05起结算上月返利。待结算积分暂不可消费。</p>
              {data.nextSettlementAt && <small>最早应结算时间：{new Date(data.nextSettlementAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}（北京时间）</small>}
            </section>}
            {data?.pendingRecoveryPoints > 0 && <p className="invitation-error" role="status">当前有 {data.pendingRecoveryPoints} 积分待追回，新返利暂停计提，已有待结算暂缓到账。请联系客服核对。</p>}
            {data?.reversedPoints > 0 && <p className="invitation-note">已冲正 {data.reversedPoints} 积分，累计到账已扣除此部分。</p>}

            <section className="invitation-records">
              <header>
                <h2>返利记录</h2>
                <button
                  type="button"
                  aria-label="刷新记录"
                  title="刷新记录"
                  disabled={loading}
                  onClick={() => setReload((n) => n + 1)}
                >
                  <RefreshCw size={16} />
                </button>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>归属月份</th>
                    <th>充值基础积分</th>
                    <th>返利积分</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items?.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                      <td>{item.settlementMonth?.slice(0,7) || "—"}</td>
                      <td>{item.basePoints}</td>
                      <td className="invitation-reward">{item.status === "reversed" ? "−" : item.points > 0 && !["pending_settlement","voided"].includes(item.status) ? "+" : ""}{item.points}</td>
                      <td>{REWARD_STATUS[item.status] || "已发放"}{item.decisionReason && <small> · {REWARD_REASON[item.decisionReason] || item.decisionReason}</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.items?.length ? (
                <p className="invitation-empty">{loading ? "正在加载…" : "暂无返利记录"}</p>
              ) : null}
              <footer>
                <button
                  type="button"
                  aria-label="上一页"
                  title="上一页"
                  disabled={loading || (data?.page || 1) === 1}
                  onClick={() => {setPage((data?.page || 1) - 1);setReload(n=>n+1);}}
                >
                  <ArrowLeft size={16} />
                </button>
                <span>第 {data?.page || 1} 页</span>
                <button
                  type="button"
                  aria-label="下一页"
                  title="下一页"
                  disabled={loading || !data?.hasMore}
                  onClick={() => {setPage((data?.page || 1) + 1);setReload(n=>n+1);}}
                >
                  <ArrowRight size={16} />
                </button>
              </footer>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
