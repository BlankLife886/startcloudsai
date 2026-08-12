import { useCallback, useEffect, useMemo, useState } from "react";
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
  closed: { label: "已关闭", icon: "bi-archive" },
};

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function FeedbackView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedCategory = query.get("category") || "";
  const [form, setForm] = useState({
    category: categoryMap[requestedCategory] ? requestedCategory : "bug",
    title: "",
    content: "",
    pageUrl: query.get("from") || "",
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
      <div className="feedback-atmosphere" aria-hidden="true"><span /><span /></div>
      <ProfileSectionShell
        title="问题反馈"
        description="遇到问题或有产品建议，告诉我们具体情况和复现方式。"
        actions={actions}
      >
        <div className="feedback-layout">
          <form className="feedback-form" onSubmit={submit}>
            <header className="feedback-card-head">
              <span className="feedback-card-icon"><i className="bi bi-send" /></span>
              <div><h2>提交新反馈</h2><p>信息越具体，我们定位和处理得越快。</p></div>
            </header>

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
                    <span><strong>{category.label}</strong><small>{category.hint}</small></span>
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

            <label className="feedback-field">
              <span>问题发生页面 <i>可选</i></span>
              <div className="feedback-url-input">
                <i className="bi bi-link-45deg" aria-hidden="true" />
                <input
                  value={form.pageUrl}
                  type="text"
                  maxLength={500}
                  placeholder="例如：https://example.com/text-to-image"
                  onChange={(event) => updateForm("pageUrl", event.target.value)}
                />
              </div>
            </label>

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

          <aside className="feedback-guide">
            <div className="feedback-guide__visual"><span><i className="bi bi-chat-heart" /></span><p>YOUR VOICE<br />SHAPES THE PRODUCT</p></div>
            <h3>反馈处理流程</h3>
            <ol>
              <li><span>01</span><div><strong>提交问题</strong><small>描述问题和复现步骤</small></div></li>
              <li><span>02</span><div><strong>开始处理</strong><small>管理员确认并跟进反馈</small></div></li>
              <li><span>03</span><div><strong>结果通知</strong><small>站内通知同步处理结果</small></div></li>
            </ol>
            <div className="feedback-guide__tip"><i className="bi bi-lightbulb" /><p><strong>更快获得帮助</strong>请避免提交账号密码、验证码或 API 密钥。</p></div>
          </aside>
        </div>

        <section className="feedback-history">
          <header>
            <div><h2>我的反馈</h2><p>查看提交记录、处理状态和管理员回复。</p></div>
            <button type="button" disabled={loading} onClick={() => loadFeedback()}><i className={`bi bi-arrow-repeat${loading ? " spin" : ""}`} />刷新</button>
          </header>
          {loading && !items.length ? (
            <div className="feedback-skeleton" aria-hidden="true"><span /><span /><span /></div>
          ) : loadError && !items.length ? (
            <div className="feedback-empty is-error"><i className="bi bi-cloud-slash" /><strong>反馈记录加载失败</strong><p>{loadError}</p><button type="button" onClick={() => loadFeedback()}>重试</button></div>
          ) : !items.length ? (
            <div className="feedback-empty"><i className="bi bi-chat-square-text" /><strong>还没有反馈记录</strong><p>提交后可在这里持续查看处理进度。</p></div>
          ) : (
            <div className="feedback-list">
              {items.map((item) => (
                <article key={item.id} className="feedback-item">
                  <div className="feedback-item__top">
                    <span className="feedback-category"><i className={`bi ${categoryMap[item.category]?.icon || "bi-chat-square-text"}`} />{categoryMap[item.category]?.label || item.category}</span>
                    <span className={`feedback-status is-${item.status}`}><i className={`bi ${statusMap[item.status]?.icon || "bi-circle"}`} />{statusMap[item.status]?.label || item.status}</span>
                    {item.adopted && <span className="feedback-adopted"><i className="bi bi-lightbulb-fill" />已采纳 · +{item.rewardCents} 积分</span>}
                  </div>
                  <h3>{item.title}</h3>
                  <p className="feedback-item__content">{item.content}</p>
                  {item.adminReply && <div className="feedback-reply"><span><i className="bi bi-person-check-fill" />管理员回复</span><p>{item.adminReply}</p></div>}
                  <footer><span><i className="bi bi-clock" />{formatTime(item.createdAt)}</span>{item.pageUrl && <a href={item.pageUrl} target="_blank" rel="noopener noreferrer"><i className="bi bi-box-arrow-up-right" />问题页面</a>}</footer>
                </article>
              ))}
            </div>
          )}
          {nextCursor && <button type="button" className="feedback-more" disabled={loadingMore} onClick={() => loadFeedback({ append: true })}>{loadingMore ? "加载中…" : "加载更多反馈"}</button>}
        </section>
      </ProfileSectionShell>
    </div>
  );
}
