import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  Check,
  Copy,
  FileCode2,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import {
  createAPIKey,
  createWebhook,
  deleteWebhook,
  listAPIKeys,
  listDeveloperModels,
  listWebhookDeliveries,
  listWebhooks,
  retryWebhookDelivery,
  revokeAPIKey,
  rotateAPIKey,
  updateWebhook,
} from "@react/legacy-modules/services/developerApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "./DeveloperAPIView.css";

const SCOPES = [
  ["models:read", "读取模型"],
  ["files:write", "上传文件"],
  ["tasks:write", "创建任务"],
  ["tasks:read", "读取任务与文件"],
];

const EVENTS = [
  ["task.succeeded", "任务成功"],
  ["task.failed", "任务失败"],
  ["task.canceled", "任务取消"],
];

const emptyKeyDraft = () => ({
  label: "生产环境",
  scopes: SCOPES.map(([value]) => value),
  allowedModelIds: [],
  dailyTaskLimit: 100,
  monthlyTaskLimit: 2000,
  dailySpendLimitCents: 10000,
  monthlySpendLimitCents: 200000,
  expiresAt: "",
  ipAllowlistText: "",
  rateLimitPerMinute: 120,
  dailyByteLimitGiB: 2,
});

const emptyWebhookDraft = () => ({
  id: "",
  label: "任务回调",
  url: "",
  events: EVENTS.map(([value]) => value),
  enabled: true,
  rotateSecret: false,
});

function formatTime(value) {
  if (!value) return "从未";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

function formatPoints(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("zh-CN");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function SecretDialog({ value, title, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(value);
    setCopied(true);
    notificationService.success("密钥已复制");
  };
  return (
    <div className="devapi-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="devapi-dialog devapi-secret" role="dialog" aria-modal="true" aria-labelledby="devapi-secret-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="devapi-dialog__icon"><KeyRound size={20} /></span>
          <div><h2 id="devapi-secret-title">{title}</h2><p>关闭后无法再次查看，请立即保存到安全位置。</p></div>
          <button type="button" className="devapi-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <code data-no-translate>{value}</code>
        <footer>
          <button type="button" className="devapi-button is-primary" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "已复制" : "复制密钥"}</button>
          <button type="button" className="devapi-button" onClick={onClose}>我已保存</button>
        </footer>
      </section>
    </div>
  );
}

function KeyDialog({ models, onClose, onCreated }) {
  const [draft, setDraft] = useState(emptyKeyDraft);
  const [saving, setSaving] = useState(false);
  const toggle = (field, value) => setDraft((current) => ({
    ...current,
    [field]: current[field].includes(value)
      ? current[field].filter((item) => item !== value)
      : [...current[field], value],
  }));
  const submit = async (event) => {
    event.preventDefault();
    if (!draft.label.trim() || !draft.scopes.length || saving) return;
    setSaving(true);
    try {
      const payload = {
        ...draft,
        label: draft.label.trim(),
        expiresAt: draft.expiresAt ? new Date(`${draft.expiresAt}T23:59:59`).toISOString() : null,
        ipAllowlist: draft.ipAllowlistText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
        dailyByteLimit: Math.round(Math.max(0, draft.dailyByteLimitGiB) * (1024 ** 3)),
      };
	  delete payload.ipAllowlistText;
	  delete payload.dailyByteLimitGiB;
      const result = await createAPIKey(payload);
      onCreated(result);
    } catch (error) {
      notificationService.error(error?.message || "API Key 创建失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="devapi-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="devapi-dialog devapi-form-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>创建 API Key</h2><p>权限、模型和额度均可独立限制。</p></div><button type="button" className="devapi-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="devapi-form-grid">
          <label className="is-wide"><span>名称</span><input value={draft.label} maxLength={80} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <fieldset className="is-wide"><legend>权限</legend><div className="devapi-check-grid">{SCOPES.map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.scopes.includes(value)} onChange={() => toggle("scopes", value)} /><span>{label}<small data-no-translate>{value}</small></span></label>)}</div></fieldset>
          <fieldset className="is-wide"><legend>模型范围</legend><p>不选择代表允许所有已开放模型。</p><div className="devapi-model-grid">{models.map((model) => <label key={model.id}><input type="checkbox" checked={draft.allowedModelIds.includes(model.id)} onChange={() => toggle("allowedModelIds", model.id)} /><span>{model.name}<small>{formatPoints(model.priceCents)} 积分/次</small></span></label>)}</div></fieldset>
          <label><span>每日任务上限</span><input type="number" min="1" max="100000" value={draft.dailyTaskLimit} onChange={(event) => setDraft({ ...draft, dailyTaskLimit: Number(event.target.value) })} /></label>
          <label><span>每月任务上限</span><input type="number" min="1" max="1000000" value={draft.monthlyTaskLimit} onChange={(event) => setDraft({ ...draft, monthlyTaskLimit: Number(event.target.value) })} /></label>
          <label><span>每日积分额度</span><input type="number" min="1" value={draft.dailySpendLimitCents} onChange={(event) => setDraft({ ...draft, dailySpendLimitCents: Number(event.target.value) })} /></label>
          <label><span>每月积分额度</span><input type="number" min="1" value={draft.monthlySpendLimitCents} onChange={(event) => setDraft({ ...draft, monthlySpendLimitCents: Number(event.target.value) })} /></label>
          <label><span>每分钟请求上限</span><input type="number" min="1" max="10000" value={draft.rateLimitPerMinute} onChange={(event) => setDraft({ ...draft, rateLimitPerMinute: Number(event.target.value) })} /></label>
          <label><span>每日流量额度（GiB）</span><input type="number" min="0.001" max="1024" step="0.5" value={draft.dailyByteLimitGiB} onChange={(event) => setDraft({ ...draft, dailyByteLimitGiB: Number(event.target.value) })} /></label>
          <label className="is-wide"><span>IP 白名单（可选）</span><input placeholder="203.0.113.10, 10.0.0.0/24" value={draft.ipAllowlistText} onChange={(event) => setDraft({ ...draft, ipAllowlistText: event.target.value })} /><small>留空允许所有 IP，支持 IP 和 CIDR，最多 20 项。</small></label>
          <label className="is-wide"><span>到期日期（可选）</span><input type="date" value={draft.expiresAt} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} /></label>
        </div>
        <footer><button type="button" className="devapi-button" onClick={onClose}>取消</button><button type="submit" className="devapi-button is-primary" disabled={saving || !draft.scopes.length}>{saving ? "创建中…" : "创建"}</button></footer>
      </form>
    </div>
  );
}

function WebhookDialog({ initialValue, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => initialValue ? { ...emptyWebhookDraft(), ...initialValue, rotateSecret: false } : emptyWebhookDraft());
  const [saving, setSaving] = useState(false);
  const toggleEvent = (value) => setDraft((current) => ({ ...current, events: current.events.includes(value) ? current.events.filter((item) => item !== value) : [...current.events, value] }));
  const submit = async (event) => {
    event.preventDefault();
    if (!draft.label.trim() || !draft.url.trim() || !draft.events.length || saving) return;
    setSaving(true);
    try {
      const payload = { label: draft.label.trim(), url: draft.url.trim(), events: draft.events, enabled: draft.enabled, rotateSecret: draft.rotateSecret };
      const result = draft.id ? await updateWebhook(draft.id, payload) : await createWebhook(payload);
      onSaved(result);
    } catch (error) {
      notificationService.error(error?.message || "Webhook 保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="devapi-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="devapi-dialog devapi-form-dialog is-compact" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>{draft.id ? "编辑 Webhook" : "创建 Webhook"}</h2><p>仅支持公网 HTTPS 地址。</p></div><button type="button" className="devapi-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="devapi-form-grid">
          <label className="is-wide"><span>名称</span><input value={draft.label} maxLength={80} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label className="is-wide"><span>回调地址</span><input type="url" placeholder="https://example.com/webhooks/starcloud" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label>
          <fieldset className="is-wide"><legend>订阅事件</legend><div className="devapi-check-grid">{EVENTS.map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.events.includes(value)} onChange={() => toggleEvent(value)} /><span>{label}<small data-no-translate>{value}</small></span></label>)}</div></fieldset>
          <label className="devapi-switch is-wide"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>启用此 Webhook</span></label>
          {draft.id && <label className="devapi-switch is-wide"><input type="checkbox" checked={draft.rotateSecret} onChange={(event) => setDraft({ ...draft, rotateSecret: event.target.checked })} /><span>保存时轮换签名密钥</span></label>}
        </div>
        <footer><button type="button" className="devapi-button" onClick={onClose}>取消</button><button type="submit" className="devapi-button is-primary" disabled={saving || !draft.events.length}>{saving ? "保存中…" : "保存"}</button></footer>
      </form>
    </div>
  );
}

export function DeveloperAPIView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const [tab, setTab] = useState("keys");
  const [keys, setKeys] = useState([]);
  const [models, setModels] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const [webhookDialog, setWebhookDialog] = useState(null);
  const [secret, setSecret] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!auth.isAuthenticated) return;
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const [nextKeys, nextModels, nextWebhooks, nextDeliveries] = await Promise.all([
        listAPIKeys(), listDeveloperModels(), listWebhooks(), listWebhookDeliveries(),
      ]);
      setKeys(nextKeys); setModels(nextModels); setWebhooks(nextWebhooks); setDeliveries(nextDeliveries);
    } catch (error) {
      notificationService.error(error?.message || "开发者配置读取失败");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [auth.isAuthenticated]);

  useEffect(() => { void load(); }, [load]);

  const activeKeys = useMemo(() => keys.filter((item) => item.status === "active"), [keys]);
  const pendingDeliveries = useMemo(() => deliveries.filter((item) => item.status === "pending").length, [deliveries]);

  const revoke = async (item) => {
    if (!window.confirm(`撤销 API Key「${item.label}」？撤销后立即失效。`)) return;
    try { await revokeAPIKey(item.id); notificationService.success("API Key 已撤销"); await load({ quiet: true }); }
    catch (error) { notificationService.error(error?.message || "撤销失败"); }
  };

  const rotate = async (item) => {
    if (!window.confirm(`轮换「${item.label}」后，旧 Key 会立即失效。继续吗？`)) return;
    try {
      const result = await rotateAPIKey(item.id);
      setSecret({ title: "API Key 已轮换", value: result.secret });
      await load({ quiet: true });
    } catch (error) {
      notificationService.error(error?.message || "API Key 轮换失败");
    }
  };
  const removeWebhook = async (item) => {
    if (!window.confirm(`删除 Webhook「${item.label}」及其投递记录？`)) return;
    try { await deleteWebhook(item.id); notificationService.success("Webhook 已删除"); await load({ quiet: true }); }
    catch (error) { notificationService.error(error?.message || "删除失败"); }
  };
  const retry = async (item) => {
    try { await retryWebhookDelivery(item.id); notificationService.success("已重新加入投递队列"); await load({ quiet: true }); }
    catch (error) { notificationService.error(error?.message || "重试失败"); }
  };
  const copyBaseURL = async () => {
    await copyText(`${window.location.origin}/api/open/v1`);
    notificationService.success("Open API 地址已复制");
  };

  if (!auth.loading && !auth.isAuthenticated) {
    return <main className={`devapi${isDark ? " is-dark" : ""}`}><section className="devapi-auth"><KeyRound size={28} /><h1>开发者 API</h1><p>登录后管理 API Key、Webhook 和投递记录。</p><Link className="devapi-button is-primary" to="/auth?mode=login">登录账号</Link></section></main>;
  }

  return (
    <main className={`devapi${isDark ? " is-dark" : ""}`}>
      <header className="devapi-top">
        <div><h1>开发者 API</h1><p>通过稳定接口接入模型任务与结果回调</p></div>
        <div className="devapi-top__actions"><button type="button" className="devapi-button" onClick={() => void copyBaseURL()}><FileCode2 size={16} />复制 API 地址</button><button type="button" className="devapi-icon-button" title="刷新" aria-label="刷新" disabled={refreshing} onClick={() => void load({ quiet: true })}><RefreshCw size={17} className={refreshing ? "is-spin" : ""} /></button></div>
      </header>
      <section className="devapi-summary" aria-label="开发者 API 概览">
        <div><KeyRound size={18} /><span>有效 Key</span><strong>{activeKeys.length}</strong></div>
        <div><Webhook size={18} /><span>Webhook</span><strong>{webhooks.length}</strong></div>
        <div><Activity size={18} /><span>待投递</span><strong>{pendingDeliveries}</strong></div>
      </section>
      <nav className="devapi-tabs" role="tablist">
        {[["keys", KeyRound, "API Key"], ["webhooks", Webhook, "Webhook"], ["deliveries", Activity, "投递记录"]].map(([id, Icon, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
      </nav>
      <section className="devapi-workspace">
        {loading ? <div className="devapi-empty"><RefreshCw size={22} className="is-spin" /><p>正在读取开发者配置…</p></div> : tab === "keys" ? <>
          <header className="devapi-section-head"><div><h2>API Key</h2><p>密钥仅在创建时显示一次，最多保留 10 个有效 Key。</p></div><button type="button" className="devapi-button is-primary" onClick={() => setKeyDialog(true)}><Plus size={16} />创建 Key</button></header>
          <div className="devapi-list">{keys.map((item) => <article key={item.id} className={`devapi-row${item.status !== "active" ? " is-muted" : ""}`}>
            <span className="devapi-row__mark"><KeyRound size={17} /></span><div className="devapi-row__main"><div><strong>{item.label}</strong><span className={`devapi-status is-${item.status}`}>{item.status === "active" ? "有效" : item.status === "frozen" ? "已冻结" : "已撤销"}</span></div><code data-no-translate>{item.prefix}••••••••</code><small>{item.allowedModelIds?.length ? `${item.allowedModelIds.length} 个指定模型` : "全部开放模型"} · 最近使用 {formatTime(item.lastUsedAt)}{item.lastUsedIp ? ` · ${item.lastUsedIp}` : ""}</small>{item.freezeReason && <small>{item.freezeReason}</small>}</div>
            <div className="devapi-usage"><span>今日 {item.usage?.todayTasks || 0}/{item.dailyTaskLimit}</span><span>{formatPoints(item.usage?.todaySpendCents)}/{formatPoints(item.dailySpendLimitCents)} 积分</span><span>{((item.usage?.todayBytes || 0) / (1024 ** 3)).toFixed(2)}/{(item.dailyByteLimit / (1024 ** 3)).toFixed(1)} GiB</span></div>
            {item.status !== "revoked" && <div className="devapi-row__actions"><button type="button" className="devapi-icon-button" title="轮换 Key" aria-label={`轮换 ${item.label}`} onClick={() => void rotate(item)}><RotateCw size={16} /></button><button type="button" className="devapi-icon-button is-danger" title="撤销" aria-label={`撤销 ${item.label}`} onClick={() => void revoke(item)}><Trash2 size={16} /></button></div>}
          </article>)}{!keys.length && <div className="devapi-empty"><KeyRound size={24} /><strong>还没有 API Key</strong><p>创建后即可通过 Open API 提交任务。</p></div>}</div>
        </> : tab === "webhooks" ? <>
          <header className="devapi-section-head"><div><h2>Webhook</h2><p>任务终态会签名投递到公网 HTTPS 地址。</p></div><button type="button" className="devapi-button is-primary" onClick={() => setWebhookDialog(emptyWebhookDraft())}><Plus size={16} />添加 Webhook</button></header>
          <div className="devapi-list">{webhooks.map((item) => <article key={item.id} className={`devapi-row${!item.enabled ? " is-muted" : ""}`}>
            <span className="devapi-row__mark"><Webhook size={17} /></span><div className="devapi-row__main"><div><strong>{item.label}</strong><span className={`devapi-status is-${item.enabled ? "active" : "paused"}`}>{item.enabled ? "启用" : "停用"}</span></div><code data-no-translate>{item.url}</code><small>{item.events?.map((value) => EVENTS.find(([id]) => id === value)?.[1] || value).join("、")}</small></div>
            <div className="devapi-row__actions"><button type="button" className="devapi-button is-small" onClick={() => setWebhookDialog(item)}>编辑</button><button type="button" className="devapi-icon-button is-danger" title="删除" aria-label={`删除 ${item.label}`} onClick={() => void removeWebhook(item)}><Trash2 size={16} /></button></div>
          </article>)}{!webhooks.length && <div className="devapi-empty"><Webhook size={24} /><strong>还没有 Webhook</strong><p>添加后可接收任务成功、失败和取消事件。</p></div>}</div>
        </> : <>
          <header className="devapi-section-head"><div><h2>投递记录</h2><p>系统自动指数退避重试；死信可手动重新投递。</p></div></header>
          <div className="devapi-delivery-table"><div className="devapi-delivery-head"><span>事件</span><span>状态</span><span>响应</span><span>尝试</span><span>时间</span><span /></div>{deliveries.map((item) => <div key={item.id} className="devapi-delivery-row"><span><strong>{EVENTS.find(([id]) => id === item.eventType)?.[1] || item.eventType}</strong><small data-no-translate>{item.sourceId}</small></span><span><em className={`devapi-status is-${item.status}`}>{item.status === "delivered" ? "已送达" : item.status === "dead" ? "失败" : "等待中"}</em></span><span>{item.responseStatus || "—"}{item.lastError && <small title={item.lastError}>{item.lastError}</small>}</span><span>{item.attempts}</span><span>{formatTime(item.deliveredAt || item.createdAt)}</span><span>{item.status === "dead" && <button type="button" className="devapi-icon-button" title="重新投递" aria-label="重新投递" onClick={() => void retry(item)}><RotateCw size={16} /></button>}</span></div>)}{!deliveries.length && <div className="devapi-empty"><Activity size={24} /><strong>暂无投递记录</strong><p>通过 API 创建的任务进入终态后会显示在这里。</p></div>}</div>
        </>}
      </section>
      {keyDialog && <KeyDialog models={models} onClose={() => setKeyDialog(false)} onCreated={(result) => { setKeyDialog(false); setSecret({ title: "API Key 已创建", value: result.secret }); void load({ quiet: true }); }} />}
      {webhookDialog && <WebhookDialog initialValue={webhookDialog.id ? webhookDialog : null} onClose={() => setWebhookDialog(null)} onSaved={(result) => { setWebhookDialog(null); if (result.secret) setSecret({ title: "Webhook 签名密钥", value: result.secret }); notificationService.success("Webhook 已保存"); void load({ quiet: true }); }} />}
      {secret && <SecretDialog title={secret.title} value={secret.value} onClose={() => setSecret(null)} />}
    </main>
  );
}
