import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import "@legacy/features/creator-hub/creator-hub.css";

const taskTypes = [
  ["t2i", "文生图", "/text-to-image"],
  ["coloring", "插画染色", "/ai-illustration-coloring"],
  ["ui_design", "UI 设计稿", "/design-workshop"],
  ["ecommerce_design", "AI 电商", "/ecommerce-design"],
  ["model_sheet", "模型设计", "/model-sheet"],
  ["game_art", "游戏设计", "/game-art"],
  ["assistant", "AI 助手", "/assistant"],
].map(([id, label, to]) => ({ id, label, to }));

async function getJson(path) {
  const response = await fetch(path, { credentials: "include" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error(payload?.error || "请求失败");
  return payload.data || {};
}

export function PromptLibraryView() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState("t2i");
  const [activeCategory, setActiveCategory] = useState("all");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    document.documentElement.classList.add("creator-hub-sticky-page");
    return () => document.documentElement.classList.remove("creator-hub-sticky-page");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.allSettled([
      getJson(`/api/v1/prompts/categories?type=${encodeURIComponent(activeType)}`),
      getJson(`/api/v1/prompts?type=${encodeURIComponent(activeType)}&category=${activeCategory === "all" ? "" : encodeURIComponent(activeCategory)}&sort=recommended&limit=24`),
    ]).then(([categoryResult, promptResult]) => {
      if (controller.signal.aborted) return;
      setCategories(categoryResult.status === "fulfilled" && Array.isArray(categoryResult.value?.items) ? categoryResult.value.items : []);
      setItems(promptResult.status === "fulfilled" && Array.isArray(promptResult.value?.items) ? promptResult.value.items : []);
      setLoading(false);
    });
    return () => controller.abort();
  }, [activeType, activeCategory]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => `${item.title || ""} ${item.prompt || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(query));
  }, [items, search]);

  function usePrompt(item) {
    const type = item.taskType || activeType;
    const target = taskTypes.find((entry) => entry.id === type)?.to || "/text-to-image";
    localStorage.setItem("starclouds:pending-prompt", JSON.stringify({ version: 2, prompt: item.prompt || "", taskType: type, config: {}, at: Date.now() }));
    navigate(target);
  }

  const activeTypeLabel = taskTypes.find((entry) => entry.id === activeType)?.label || "文生图";
  const categoryItems = [{ key: "all", label: "全部" }, { key: "today", label: "今日最新" }, ...categories];

  return (
    <main className="ch-page ch-page--prompts">
      <div className="ch-shell">
        <div className="ch-sticky-bar">
          <div className="ch-toolbar"><label className="ch-search"><i className="bi bi-search" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="搜索标题、提示词或标签" /></label></div>
          <div className="ch-chips" aria-label="工作台">{taskTypes.map((type) => <button key={type.id} type="button" className={`ch-chip${activeType === type.id ? " is-active" : ""}`} onClick={() => { setActiveType(type.id); setActiveCategory("all"); }}>{type.label}</button>)}</div>
          <div className="ch-chips" aria-label="分类">{categoryItems.map((category) => <button key={category.key || category.id} type="button" className={`ch-chip${activeCategory === (category.key || category.id) ? " is-active" : ""}`} onClick={() => setActiveCategory(category.key || category.id)}>{category.label}</button>)}</div>
        </div>

        <section className="ch-section">
          {loading && !filtered.length ? <div className="ch-loading">正在加载提示词…</div> : !filtered.length ? <div className="ch-empty"><strong>暂无提示词</strong><span>换个分类试试，或稍后再来看官方更新</span></div> : (
            <div className="ch-prompt-masonry" style={{ height: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {filtered.map((item) => <article key={item.id} className="ch-card"><button type="button" className="ch-card__media ch-prompt-card__media" onClick={() => setPreview(item)}>{item.coverUrl ? <img src={item.coverUrl} alt={item.title || "提示词"} loading="lazy" decoding="async" /> : <div className="ch-card__placeholder"><i className="bi bi-quote" />{item.title || "灵感"}</div>}</button><div className="ch-card__body"><div className="ch-card__meta"><span className="ch-pill">{item.category || activeTypeLabel}</span></div><h3 className="ch-card__title">{item.title || "未命名灵感"}</h3><p className="ch-card__prompt" data-no-translate>{item.prompt}</p><div className="ch-card__actions"><button type="button" className="is-primary" onClick={() => usePrompt(item)}>去做图</button><button type="button" onClick={() => navigator.clipboard.writeText(item.prompt || "")}>复制</button><button type="button">{item.favorited ? "已收藏" : "收藏"}</button></div></div></article>)}
            </div>
          )}
        </section>
      </div>

      {preview && createPortal(<div className="ch-preview-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div className="ch-preview" role="dialog" aria-modal="true" aria-label="提示词详情"><div className="ch-preview__media">{preview.coverUrl ? <img src={preview.coverUrl} alt={preview.title || "提示词"} /> : <div className="ch-preview__empty">暂无预览图</div>}</div><aside className="ch-preview__body"><div className="ch-preview__top"><div className="ch-card__meta"><span className="ch-pill">{preview.category || activeTypeLabel}</span></div><h2 className="ch-card__title" style={{ marginTop: 10 }}>{preview.title || "未命名灵感"}</h2></div><div className="ch-preview__mid"><p className="ch-preview__prompt" data-no-translate>{preview.prompt || "暂无提示词"}</p></div><div className="ch-preview__bottom"><div className="ch-card__actions"><button type="button" className="is-primary" onClick={() => navigator.clipboard.writeText(preview.prompt || "")}>复制提示词</button><button type="button" onClick={() => usePrompt(preview)}>去做图</button><button type="button" onClick={() => setPreview(null)}>关闭</button></div></div></aside></div></div>, document.body)}
    </main>
  );
}
