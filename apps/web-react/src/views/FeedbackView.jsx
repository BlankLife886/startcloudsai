import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  listMyFeedback,
  submitFeedback,
} from "@react/legacy-modules/services/feedbackApi.js";
import "@react/legacy-styles/generated/views/FeedbackView.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { ProfileSectionShell } from "../components/ProfileSectionShell.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { useLocale } from "../i18n/index.js";

const categories = [
  { value: "bug", label: "功能异常", icon: "bi-bug", hint: "页面报错或功能无法使用" },
  { value: "generation", label: "生成问题", icon: "bi-stars", hint: "生图结果、任务或模型问题" },
  { value: "account", label: "账号问题", icon: "bi-person-gear", hint: "登录、资料与账号安全" },
  { value: "billing", label: "积分与兑换", icon: "bi-wallet2", hint: "积分、计费或兑换码问题" },
  { value: "suggestion", label: "产品建议", icon: "bi-lightbulb", hint: "希望增加或改进的功能" },
  { value: "other", label: "其他问题", icon: "bi-chat-square-text", hint: "其他需要协助的事项" },
];

const categoryMap = Object.fromEntries(categories.map((item) => [item.value, item]));
const statusMap = {
  open: { label: "待处理", icon: "bi-inbox" },
  in_progress: { label: "处理中", icon: "bi-hourglass-split" },
  resolved: { label: "已解决", icon: "bi-check2-circle" },
  closed: { label: "反馈已关闭", icon: "bi-archive" },
};

const processSteps = [
  ["01", "提交问题", "描述问题和复现步骤"],
  ["02", "开始处理", "管理员确认并跟进反馈"],
  ["03", "结果通知", "站内通知同步处理结果"],
];

const feedbackPageGroups = [
  {
    group: "创作",
    items: [
      { value: "/", label: "创作台" },
      { value: "/text-to-image", label: "文生图" },
      { value: "/canvas", label: "无限画布" },
      { value: "/assistant", label: "AI 助手" },
      { value: "/ai-illustration-coloring", label: "插画染色" },
      { value: "/design-workshop", label: "UI 设计稿" },
      { value: "/model-sheet", label: "模型设计" },
      { value: "/game-art", label: "游戏设计" },
      { value: "/ecommerce-design", label: "AI 电商" },
    ],
  },
  {
    group: "工具",
    items: [
      { value: "/tools/background-remove", label: "背景移除" },
      { value: "/tools/image-compress", label: "图片压缩" },
      { value: "/tools/puzzle", label: "拼图" },
      { value: "/prompts", label: "提示词" },
    ],
  },
  {
    group: "账户",
    items: [
      { value: "/assets", label: "我的资产" },
      { value: "/history", label: "历史记录" },
      { value: "/check-in", label: "每日签到" },
      { value: "/wallet", label: "我的钱包" },
      { value: "/pricing", label: "创作价格" },
      { value: "/profile", label: "个人中心" },
      { value: "/account", label: "账号设置" },
      { value: "/notifications", label: "通知中心" },
      { value: "/submissions", label: "我的投稿" },
    ],
  },
  {
    group: "激励与其他",
    items: [
      { value: "/incentive-plans", label: "创作激励" },
      { value: "/incentive-plans/group", label: "好友拼团" },
      { value: "/incentive-plans/membership", label: "会员计划" },
      { value: "/incentive-plans/failure", label: "失败补偿" },
      { value: "/incentive-plans/suggestion", label: "建议采纳" },
      { value: "/incentive-plans/usage", label: "用量计划" },
      { value: "/share", label: "社区" },
      { value: "/updates", label: "更新说明" },
      { value: "/app-space", label: "关于我们" },
      { value: "/feedback", label: "问题反馈" },
      { value: "/", label: "首页" },
    ],
  },
];

const feedbackPageMap = Object.fromEntries(
  feedbackPageGroups.flatMap((group) =>
    group.items.map((item) => [item.value, item.label]),
  ),
);

function normalizeFeedbackPage(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let path = value;
  try {
    path = new URL(value, "http://local.invalid").pathname || value;
  } catch {
    path = value.split("?")[0] || value;
  }
  path = path.replace(/\/+$/, "") || "/";
  if (feedbackPageMap[path]) return path;
  if (path.startsWith("/canvas")) return "/canvas";
  if (path.startsWith("/ecommerce-design")) return "/ecommerce-design";
  if (path.startsWith("/incentive-plans")) {
    return feedbackPageMap[path] ? path : "/incentive-plans";
  }
  return "";
}

function feedbackPageLabel(raw) {
  const path = normalizeFeedbackPage(raw);
  if (path && feedbackPageMap[path]) return feedbackPageMap[path];
  return String(raw || "").trim();
}

function FeedbackPageSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedLabel = value ? feedbackPageMap[value] || value : "不指定页面";

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`feedback-page-select${open ? " is-open" : ""}`}
    >
      <button
        type="button"
        className="feedback-page-select__trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedLabel}</span>
      </button>
      {open && (
        <div className="feedback-page-select__menu" role="listbox">
          <button
            type="button"
            role="option"
            className={!value ? "is-active" : ""}
            aria-selected={!value}
            onClick={() => choose("")}
          >
            不指定页面
          </button>
          {feedbackPageGroups.map((group) => (
            <div key={group.group} className="feedback-page-select__group">
              <strong>{group.group}</strong>
              {group.items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="option"
                  className={value === item.value ? "is-active" : ""}
                  aria-selected={value === item.value}
                  onClick={() => choose(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(value, locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const tag = locale === "en" ? "en-US" : locale === "zh-TW" ? "zh-TW" : "zh-CN";
  return date.toLocaleString(tag, { hour12: false });
}

export function FeedbackView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const { locale } = useLocale();
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedCategory = query.get("category") || "";
  const [form, setForm] = useState({
    category: categoryMap[requestedCategory] ? requestedCategory : "bug",
    title: "",
    content: "",
    pageUrl: normalizeFeedbackPage(query.get("from") || ""),
  });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submitNotice, setSubmitNotice] = useState("");
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const canSubmit =
    form.title.trim().length >= 5 &&
    form.content.trim().length >= 10 &&
    !submitting;

  const loadFeedback = useCallback(
    async ({ append = false, signal } = {}) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadError("");
      }
      try {
        const page = await listMyFeedback({
          limit: 12,
          cursor: append ? nextCursor || "" : "",
          signal,
        });
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setLoadError(error?.message || "反馈记录读取失败");
        }
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [nextCursor],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadFeedback({ signal: controller.signal });
    return () => controller.abort();
  }, []);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSubmitNotice("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (requestAuth({ featureLabel: "问题反馈" })) return;
    if (!canSubmit) {
      setSubmitNotice("请填写至少 5 个字符的标题和 10 个字符的问题描述");
      return;
    }
    setSubmitting(true);
    setSubmitNotice("");
    try {
      const created = await submitFeedback(form);
      setItems((current) => [created, ...current]);
      setForm((current) => ({ ...current, title: "", content: "", pageUrl: "" }));
      setSubmitNotice("反馈已提交，我们会尽快处理");
    } catch (error) {
      setSubmitNotice(error?.message || "反馈提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const actions = (
    <span className="feedback-account">
      <i className="bi bi-person-check" aria-hidden="true" />
      {auth.user?.email}
    </span>
  );

  return (
    <div className={`feedback-page ${isDark ? "is-dark" : "is-light"}`}>
      <ProfileSectionShell
        title="问题反馈"
        description="遇到问题或有产品建议，告诉我们具体情况和复现方式。"
        actions={actions}
      >
        <div className="feedback-layout">
          <form className="feedback-form" onSubmit={submit}>
            <header className="feedback-card-head">
              <span className="feedback-card-icon"><i className="bi bi-send" /></span>
              <div>
                <h2>提交新反馈</h2>
                <p>信息越具体，我们定位和处理得越快。</p>
              </div>
            </header>

            <ol className="feedback-steps">
              {processSteps.map(([step, title, note]) => (
                <li key={step}>
                  <span>{step}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{note}</small>
                  </div>
                </li>
              ))}
            </ol>

            <fieldset className="feedback-fieldset">
              <legend>问题分类</legend>
              <div className="category-grid">
                {categories.map((category) => (
                  <label
                    key={category.value}
                    className={`category-option${form.category === category.value ? " is-selected" : ""}`}
                  >
                    <input
                      checked={form.category === category.value}
                      type="radio"
                      value={category.value}
                      onChange={() => updateForm("category", category.value)}
                    />
                    <span className="category-option__icon"><i className={`bi ${category.icon}`} /></span>
                    <span>
                      <strong>{category.label}</strong>
                      <small>{category.hint}</small>
                    </span>
                    <i className="bi bi-check-circle-fill category-option__check" aria-hidden="true" />
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="feedback-field">
              <span>问题标题 <em>必填</em></span>
              <input
                value={form.title}
                type="text"
                minLength={5}
                maxLength={120}
                placeholder="用一句话概括你遇到的问题"
                required
                onChange={(event) => updateForm("title", event.target.value)}
              />
              <small>{form.title.trim().length} / 120</small>
            </label>

            <label className="feedback-field">
              <span>详细描述 <em>必填</em></span>
              <textarea
                value={form.content}
                rows={7}
                minLength={10}
                maxLength={3000}
                placeholder="请说明操作步骤、预期结果和实际结果。如有错误提示，也请一并填写。"
                required
                onChange={(event) => updateForm("content", event.target.value)}
              />
              <small>{form.content.trim().length} / 3000</small>
            </label>

            <div className="feedback-field">
              <span>问题发生页面 <i>可选</i></span>
              <FeedbackPageSelect
                value={form.pageUrl}
                onChange={(next) => updateForm("pageUrl", next)}
              />
            </div>

            {submitNotice && <p className="feedback-form-notice" role="status">{submitNotice}</p>}
            <div className="feedback-submit-row">
              <p><i className="bi bi-shield-check" /> 浏览器信息会随反馈提交，仅用于排查问题。</p>
              <button
                type={auth.isAuthenticated ? "submit" : "button"}
                disabled={auth.isAuthenticated && !canSubmit}
                onClick={() => { if (!auth.isAuthenticated) requestAuth({ featureLabel: "问题反馈" }); }}
              >
                <i className={`bi ${submitting ? "bi-arrow-repeat spin" : "bi-send-check"}`} />
                {submitting ? "正在提交…" : "提交反馈"}
              </button>
            </div>
          </form>

          <section className="feedback-history">
            <header>
              <div>
                <h2>我的反馈</h2>
                <p>查看提交记录、处理状态和管理员回复。</p>
              </div>
              <button type="button" disabled={loading} onClick={() => loadFeedback()}>
                <i className={`bi bi-arrow-repeat${loading ? " spin" : ""}`} />
                刷新
              </button>
            </header>
            {loading && !items.length ? (
              <div className="feedback-skeleton" aria-hidden="true"><span /><span /><span /></div>
            ) : loadError && !items.length ? (
              <div className="feedback-empty is-error">
                <i className="bi bi-cloud-slash" />
                <strong>反馈记录加载失败</strong>
                <p>{loadError}</p>
                <button type="button" onClick={() => loadFeedback()}>重试</button>
              </div>
            ) : !items.length ? (
              <div className="feedback-empty">
                <i className="bi bi-chat-square-text" />
                <strong>还没有反馈记录</strong>
                <p>提交后可在这里持续查看处理进度。</p>
              </div>
            ) : (
              <div className="feedback-list">
                {items.map((item) => (
                  <article key={item.id} className="feedback-item">
                    <div className="feedback-item__top">
                      <span className="feedback-category">
                        <i className={`bi ${categoryMap[item.category]?.icon || "bi-chat-square-text"}`} />
                        {categoryMap[item.category]?.label || item.category}
                      </span>
                      <span className={`feedback-status is-${item.status}`}>
                        <i className={`bi ${statusMap[item.status]?.icon || "bi-circle"}`} />
                        {statusMap[item.status]?.label || item.status}
                      </span>
                      {item.adopted && (
                        <span className="feedback-adopted">
                          <i className="bi bi-lightbulb-fill" />
                          已采纳 · +{item.rewardCents} 积分
                        </span>
                      )}
                    </div>
                    <h3>{item.title}</h3>
                    <p className="feedback-item__content">{item.content}</p>
                    {item.adminReply && (
                      <div className="feedback-reply">
                        <span><i className="bi bi-person-check-fill" />管理员回复</span>
                        <p>{item.adminReply}</p>
                      </div>
                    )}
                    <footer>
                      <span><i className="bi bi-clock" />{formatTime(item.createdAt, locale)}</span>
                      {item.pageUrl && (
                        <a href={item.pageUrl}>
                          <i className="bi bi-geo-alt" />
                          {feedbackPageLabel(item.pageUrl)}
                        </a>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            )}
            {nextCursor && (
              <button
                type="button"
                className="feedback-more"
                disabled={loadingMore}
                onClick={() => loadFeedback({ append: true })}
              >
                {loadingMore ? "加载中…" : "加载更多反馈"}
              </button>
            )}
          </section>
        </div>
      </ProfileSectionShell>
    </div>
  );
}
