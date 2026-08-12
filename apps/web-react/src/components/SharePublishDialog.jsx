import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getShareOverview } from "@legacy/services/shareGallery.js";
import "@react/legacy-styles/generated/features/share/components/SharePublishDialog.css";

export function SharePublishDialog({
  open,
  title,
  submitting,
  light,
  onClose,
  onSubmit,
}) {
  const [value, setValue] = useState(title || "AI 创作");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    setValue(title || "AI 创作");
    setCategory("");
    setLoading(true);
    let disposed = false;
    getShareOverview()
      .then((data) => {
        if (!disposed)
          setCategories(Array.isArray(data?.categories) ? data.categories : []);
      })
      .catch(() => {})
      .finally(() => !disposed && setLoading(false));
    const onKeyDown = (event) =>
      event.key === "Escape" && !submitting && onClose?.();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, submitting, title, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      className={`share-publish-backdrop${light ? " is-light" : ""}`}
      onMouseDown={(event) =>
        event.target === event.currentTarget && !submitting && onClose?.()
      }
    >
      <section
        className="share-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-publish-title"
      >
        <header>
          <div className="share-publish-heading">
            <span className="share-publish-heading-icon">
              <i className="bi bi-stars" />
            </span>
            <div>
              <small>社区画廊</small>
              <h2 id="share-publish-title">发布作品</h2>
            </div>
          </div>
          <button
            type="button"
            className="share-publish-close"
            aria-label="关闭"
            disabled={submitting}
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <form
          className="share-publish-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim())
              onSubmit?.({ title: value.trim(), categoryId: category });
          }}
        >
          <label className="share-publish-field">
            <span>
              <strong>作品标题</strong>
              <small>{value.length} / 120</small>
            </span>
            <textarea
              value={value}
              maxLength="120"
              rows="3"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {(loading || categories.length > 0) && (
            <fieldset className="share-publish-category">
              <legend>
                <strong>作品分类</strong>
                <small>可选</small>
              </legend>
              {loading ? (
                <div className="share-publish-category-loading">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <div className="share-publish-category-options">
                  {categories.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={category === item.key ? "is-selected" : ""}
                      onClick={() =>
                        setCategory(category === item.key ? "" : item.key)
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          <div className="share-publish-tip">
            <i className="bi bi-shield-check" />
            <span>
              <strong>提交后进入审核</strong>
              <small>通过后将展示在社区画廊，其他创作者也能看到</small>
            </span>
          </div>
        </form>
        <footer>
          <button
            type="button"
            className="is-secondary"
            disabled={submitting}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={submitting || !value.trim()}
            onClick={() =>
              onSubmit?.({ title: value.trim(), categoryId: category })
            }
          >
            <i
              className={`bi ${submitting ? "bi-arrow-repeat spin" : "bi-send-fill"}`}
            />
            <span>{submitting ? "提交中…" : "提交审核"}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
