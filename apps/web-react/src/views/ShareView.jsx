import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ProgressiveImage } from "../components/ProgressiveImage.jsx";
import "@legacy/features/share/styles/share-view.css";

const PAGE_SIZE = 16;
gsap.registerPlugin(useGSAP);

async function apiGet(path, params = {}, signal) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== "" &&
      value !== null &&
      value !== undefined &&
      value !== false
    )
      query.set(key, String(value));
  });
  const response = await fetch(
    `/api/v1${path}${query.size ? `?${query}` : ""}`,
    { credentials: "include", signal },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true)
    throw new Error(payload?.error || "请求失败");
  return payload.data;
}

function normalizeItem(raw) {
  const cover = raw?.coverUrl || raw?.mediaUrls?.[0] || "";
  if (!raw?.id || !cover) return null;
  return {
    id: String(raw.id),
    title: String(raw.title || "").trim() || "AI 作品",
    cover,
    mediaUrls:
      Array.isArray(raw.mediaUrls) && raw.mediaUrls.length
        ? raw.mediaUrls
        : [cover],
    authorName: raw.author?.username || "社区创作者",
    authorAvatar: raw.author?.avatarUrl || "",
    createdAt: raw.createdAt || "",
    featured: Boolean(raw.featured),
    categoryName: String(raw.category?.name || "").trim(),
  };
}

function compactNumber(value = 0) {
  const number = Number(value || 0);
  if (number >= 10000)
    return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`;
  if (number >= 1000)
    return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(number);
}

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export function ShareView() {
  const navigate = useNavigate();
  const location = useLocation();
  const pageRef = useRef(null);
  const feedRef = useRef(null);
  const detailRef = useRef(null);
  const detailTimelineRef = useRef(null);
  const feedPlayedRef = useRef(false);
  const categorySentinelRef = useRef(null);
  const [items, setItems] = useState([]);
  const [spotlightItems, setSpotlightItems] = useState([]);
  const [featuredItems, setFeaturedItems] = useState([]);
  const [seenItems, setSeenItems] = useState(new Map());
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursors, setPageCursors] = useState([""]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [categoryStuck, setCategoryStuck] = useState(false);
  const [user, setUser] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [detailMediaIndex, setDetailMediaIndex] = useState(0);

  const spotlightSource =
    featuredItems.length >= 3 ? featuredItems : spotlightItems;
  const heroItems = spotlightSource.slice(0, 5);
  const currentHero =
    heroItems[heroIndex % Math.max(1, heroItems.length)] || null;
  const hotItems =
    spotlightSource.length > 5
      ? spotlightSource.slice(5, 10)
      : spotlightSource.slice(0, 5);
  const galleryStats = useMemo(() => {
    const rows = [...seenItems.values()];
    return {
      works: rows.length,
      creators: new Set(rows.map((item) => item.authorName)).size,
    };
  }, [seenItems]);
  const topCreators = useMemo(() => {
    const creators = new Map();
    seenItems.forEach((item) => {
      const row = creators.get(item.authorName) || {
        name: item.authorName,
        workCount: 0,
        latestAt: "",
      };
      row.workCount += 1;
      if (String(item.createdAt) > String(row.latestAt))
        row.latestAt = item.createdAt;
      creators.set(item.authorName, row);
    });
    return [...creators.values()]
      .sort((a, b) => b.workCount - a.workCount)
      .slice(0, 6);
  }, [seenItems]);
  const activeCategoryName =
    categories.find((item) => item.id === activeCategory)?.name || "";

  const reduceMotion = () =>
    document.documentElement.classList.contains("settings-no-animations") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const { contextSafe } = useGSAP(
    () => {
      const parts = pageRef.current?.querySelectorAll("[data-share-motion]");
      if (!parts?.length) return undefined;
      if (reduceMotion()) {
        gsap.set(parts, {
          clearProps: "opacity,transform,filter,visibility",
        });
        return undefined;
      }
      gsap.fromTo(
        parts,
        { opacity: 0, y: 18, filter: "blur(4px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.62,
          stagger: 0.07,
          ease: "power3.out",
          clearProps: "filter,transform",
        },
      );
      return () => detailTimelineRef.current?.kill();
    },
    { scope: pageRef },
  );

  useGSAP(
    () => {
      if (loading) return;
      const cards = feedRef.current?.querySelectorAll(
        ".community-card:not(.is-skeleton)",
      );
      if (!cards?.length) return;
      if (reduceMotion()) {
        gsap.set(cards, { clearProps: "opacity,transform,visibility" });
        return;
      }
      const soft = feedPlayedRef.current;
      feedPlayedRef.current = true;
      gsap.fromTo(
        cards,
        { opacity: 0, y: soft ? 6 : 14 },
        {
          opacity: 1,
          y: 0,
          duration: soft ? 0.2 : 0.34,
          stagger: soft ? 0.008 : { each: 0.024, from: "start" },
          ease: "power2.out",
          clearProps: "transform",
        },
      );
    },
    {
      scope: pageRef,
      dependencies: [loading, items.length, items[0]?.id],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      if (!detailItem || !detailRef.current) return;
      const scrim = detailRef.current.querySelector(".share-detail__scrim");
      const panel = detailRef.current.querySelector(".share-detail__panel");
      detailTimelineRef.current?.kill();
      if (reduceMotion()) {
        gsap.set([detailRef.current, scrim, panel].filter(Boolean), {
          opacity: 1,
          clearProps: "transform",
        });
        return;
      }
      detailTimelineRef.current = gsap
        .timeline({ defaults: { ease: "power2.out" } })
        .fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.16 }, 0)
        .fromTo(
          panel,
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: 0.24,
            clearProps: "transform",
          },
          0.02,
        );
    },
    {
      scope: pageRef,
      dependencies: [detailItem?.id],
      revertOnUpdate: true,
    },
  );

  async function loadItems({
    targetPage = page,
    category = activeCategory,
    resetSpotlight = false,
  } = {}) {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet("/gallery/submissions", {
        limit: PAGE_SIZE,
        cursor: pageCursors[targetPage - 1] || "",
        category,
      });
      const rows = (Array.isArray(data?.items) ? data.items : [])
        .map(normalizeItem)
        .filter(Boolean);
      setItems(rows);
      setHasMore(Boolean(data?.nextCursor));
      setPageCursors((current) => {
        const next = current.slice(0, targetPage);
        next[targetPage] = String(data?.nextCursor || "");
        return next;
      });
      setSeenItems((current) => {
        const next = new Map(current);
        rows.forEach((item) => next.set(item.id, item));
        return next;
      });
      if (
        targetPage === 1 &&
        !category &&
        (resetSpotlight || !spotlightItems.length)
      )
        setSpotlightItems(rows.slice(0, 10));
    } catch (caught) {
      if (caught?.name !== "AbortError")
        setError(caught?.message || "画廊作品读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.documentElement.classList.add("share-gallery-page");
    const controller = new AbortController();
    Promise.allSettled([
      apiGet("/gallery/submissions", { limit: PAGE_SIZE }, controller.signal),
      apiGet(
        "/gallery/submissions",
        { limit: 10, featured: 1 },
        controller.signal,
      ),
      apiGet("/gallery/categories", {}, controller.signal),
      apiGet("/auth/session", {}, controller.signal),
    ]).then(([listResult, featuredResult, categoryResult, sessionResult]) => {
      if (controller.signal.aborted) return;
      if (listResult.status === "fulfilled") {
        const rows = (
          Array.isArray(listResult.value?.items) ? listResult.value.items : []
        )
          .map(normalizeItem)
          .filter(Boolean);
        setItems(rows);
        setSpotlightItems(rows.slice(0, 10));
        setHasMore(Boolean(listResult.value?.nextCursor));
        setPageCursors(["", String(listResult.value?.nextCursor || "")]);
        setSeenItems(new Map(rows.map((item) => [item.id, item])));
      } else setError(listResult.reason?.message || "画廊作品读取失败");
      if (featuredResult.status === "fulfilled") {
        const rows = (
          Array.isArray(featuredResult.value?.items)
            ? featuredResult.value.items
            : []
        )
          .map(normalizeItem)
          .filter(Boolean);
        setFeaturedItems(rows.length >= 3 ? rows : []);
        setSeenItems((current) => {
          const next = new Map(current);
          rows.forEach((item) => next.set(item.id, item));
          return next;
        });
      }
      if (categoryResult.status === "fulfilled") {
        const raw = Array.isArray(categoryResult.value?.items)
          ? categoryResult.value.items
          : Array.isArray(categoryResult.value)
            ? categoryResult.value
            : [];
        setCategories(
          raw
            .map((row) => ({
              id: String(row?.id || ""),
              name: String(row?.name || "").trim(),
            }))
            .filter((row) => row.id && row.name),
        );
      }
      setUser(
        sessionResult.status === "fulfilled"
          ? sessionResult.value?.user || null
          : null,
      );
      setLoading(false);
    });
    return () => {
      controller.abort();
      document.documentElement.classList.remove("share-gallery-page");
      document.body.classList.remove("share-detail-open");
    };
  }, []);

  useEffect(() => {
    const itemId = new URLSearchParams(location.search).get("item");
    if (!itemId || detailItem?.id === itemId) return;
    const found = [...seenItems.values()].find((item) => item.id === itemId);
    if (found) openDetail(found, false);
  }, [location.search, seenItems]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (
      !categorySentinelRef.current ||
      typeof IntersectionObserver === "undefined"
    )
      return undefined;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setCategoryStuck(Boolean(entry) && entry.intersectionRatio < 1),
      { threshold: [1], rootMargin: "-88px 0px 0px 0px" },
    );
    observer.observe(categorySentinelRef.current);
    return () => observer.disconnect();
  }, []);

  function scrollFeed() {
    document
      .getElementById("share-feed")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function goSubmit() {
    navigate(user ? "/profile" : "/auth?mode=login&redirect=%2Fprofile");
  }
  function selectCategory(id) {
    if (id === activeCategory) return;
    setActiveCategory(id);
    setPage(1);
    setItems([]);
    setHasMore(false);
    setPageCursors([""]);
    void loadItems({ targetPage: 1, category: id, resetSpotlight: !id });
  }
  function refresh() {
    setPage(1);
    setItems([]);
    setHasMore(false);
    setPageCursors([""]);
    void loadItems({ targetPage: 1, resetSpotlight: !activeCategory });
  }
  function changePage(nextPage) {
    if (
      loading ||
      nextPage < 1 ||
      (nextPage > page && !hasMore) ||
      (nextPage > 1 && !pageCursors[nextPage - 1])
    )
      return;
    setPage(nextPage);
    setItems([]);
    document.getElementById("share-feed")?.scrollIntoView({ block: "start" });
    void loadItems({ targetPage: nextPage });
  }
  function openDetail(item, updateUrl = true) {
    setDetailItem(item);
    setDetailMediaIndex(0);
    document.body.classList.add("share-detail-open");
    if (updateUrl)
      navigate(`/share?item=${encodeURIComponent(item.id)}`, { replace: true });
  }
  const closeDetail = contextSafe(async () => {
    if (!detailItem) return;
    if (!reduceMotion() && detailRef.current) {
      const scrim = detailRef.current.querySelector(".share-detail__scrim");
      const panel = detailRef.current.querySelector(".share-detail__panel");
      detailTimelineRef.current?.kill();
      await new Promise((resolve) => {
        detailTimelineRef.current = gsap
          .timeline({
            defaults: { ease: "power2.in" },
            onComplete: resolve,
          })
          .to(panel, { opacity: 0, y: 10, duration: 0.14 }, 0)
          .to(scrim, { opacity: 0, duration: 0.12 }, 0.02);
      });
    }
    setDetailItem(null);
    document.body.classList.remove("share-detail-open");
    if (new URLSearchParams(location.search).has("item"))
      navigate("/share", { replace: true });
  });

  return (
    <main ref={pageRef} className="community-page">
      <div className="community-atmosphere" aria-hidden="true" />
      <section className="community-intro">
        <div className="community-copy" data-share-motion>
          <div className="community-copy__spine" aria-hidden="true">
            <span>StarCloud Gallery</span>
            <i />
            <em>Vol.01</em>
          </div>
          <div className="community-copy__body">
            <div className="community-copy__top">
              <span className="community-eyebrow">StarCloudIsAI</span>
              <h1>
                <span className="community-copy__title">社区画廊</span>
                <span className="community-copy__seal" aria-hidden="true">
                  画
                </span>
              </h1>
              <p className="community-copy__lead">
                灵感在此汇聚。浏览创作者分享并通过审核的 AI
                作品，也把你的创作挂上展墙。
              </p>
              <div className="community-copy__actions">
                <button
                  type="button"
                  className="is-primary"
                  onClick={scrollFeed}
                >
                  进入画廊<span aria-hidden="true">→</span>
                </button>
                <button type="button" className="is-text" onClick={goSubmit}>
                  我要投稿
                </button>
              </div>
            </div>
            <div className="community-copy__foot">
              {heroItems.length > 0 && (
                <div className="community-copy__thumbs" aria-hidden="true">
                  {heroItems.slice(0, 3).map((item, index) => (
                    <span
                      key={item.id}
                      className="community-copy__thumb"
                      style={{ "--i": index }}
                    >
                      <ProgressiveImage
                        src={item.cover}
                        alt={item.title}
                        eager
                      />
                    </span>
                  ))}
                </div>
              )}
              <div
                className={`community-stats is-comments-off${loading ? " is-loading" : ""}`}
              >
                <div>
                  <strong>{compactNumber(galleryStats.creators)}+</strong>
                  <span>创作者</span>
                </div>
                <div>
                  <strong>{compactNumber(galleryStats.works)}+</strong>
                  <span>作品</span>
                </div>
                <div>
                  <strong>6</strong>
                  <span>创作工坊</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={`community-featured${currentHero ? "" : " is-empty"}`}
          data-share-motion
          role="button"
          tabIndex="0"
          aria-label={
            currentHero ? `查看精选作品：${currentHero.title}` : "等待精选作品"
          }
          onClick={() => currentHero && openDetail(currentHero)}
          onKeyDown={(event) =>
            event.key === "Enter" && currentHero && openDetail(currentHero)
          }
        >
          {currentHero ? (
            <>
              <ProgressiveImage
                className="community-featured__image"
                src={currentHero.cover}
                alt={currentHero.title}
                eager
              />
              <div className="community-featured__shade" />
              <div className="community-featured__frame" aria-hidden="true" />
              <div className="community-featured__meta">
                <span className="community-featured__index">
                  Featured {String(heroIndex + 1).padStart(2, "0")}
                </span>
                <span className="community-featured__tag">
                  {shortDate(currentHero.createdAt)}
                </span>
                <strong>{currentHero.title}</strong>
                <small>{currentHero.authorName}</small>
              </div>
              <button
                className="community-featured__arrow is-prev"
                type="button"
                aria-label="上一张"
                onClick={(event) => {
                  event.stopPropagation();
                  setHeroIndex(
                    (heroIndex - 1 + heroItems.length) % heroItems.length,
                  );
                }}
              >
                <i className="bi bi-chevron-left" />
              </button>
              <button
                className="community-featured__arrow is-next"
                type="button"
                aria-label="下一张"
                onClick={(event) => {
                  event.stopPropagation();
                  setHeroIndex((heroIndex + 1) % heroItems.length);
                }}
              >
                <i className="bi bi-chevron-right" />
              </button>
              <div className="community-featured__dots">
                {heroItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={index === heroIndex ? "is-active" : ""}
                    aria-label={`切换到 ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setHeroIndex(index);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="community-featured__placeholder">
              <i className="bi bi-images" />
              <span>等待精选作品</span>
            </div>
          )}
        </div>
        <aside className="community-hot-panel" data-share-motion>
          <header>
            <div>
              <em>Board</em>
              <strong>近期入馆</strong>
            </div>
            <button type="button" onClick={scrollFeed}>
              完整馆藏 →
            </button>
          </header>
          <ol>
            {hotItems.map((item, index) => (
              <li key={item.id} onClick={() => openDetail(item)}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <ProgressiveImage src={item.cover} alt="" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.authorName}</small>
                </span>
                <em>
                  <i className="bi bi-calendar3" />
                  {shortDate(item.createdAt)}
                </em>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section id="share-feed" className="community-body">
        <div
          ref={categorySentinelRef}
          className="community-categories-sentinel"
          aria-hidden="true"
        />
        <nav
          className={`community-categories${categoryStuck ? " is-stuck" : ""}`}
          aria-label="画廊导航"
        >
          <button
            type="button"
            className={!activeCategory ? "is-active" : ""}
            onClick={() => selectCategory("")}
          >
            <i className="bi bi-grid" />
            全部
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activeCategory === category.id ? "is-active" : ""}
              onClick={() => selectCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
          <button type="button" disabled={loading} onClick={refresh}>
            <i className={`bi bi-arrow-clockwise${loading ? " spin" : ""}`} />
            刷新馆藏
          </button>
          <span className="community-categories__split" aria-hidden="true" />
          <button type="button" onClick={goSubmit}>
            <i className="bi bi-plus-square" />
            我要投稿
          </button>
        </nav>
        <div className="community-main" data-share-motion>
          <div className="community-feed-head">
            <div>
              <strong>{activeCategoryName || "最新入馆"}</strong>
              <span>
                已收录 {galleryStats.works}
                {hasMore ? "+" : ""} 件
              </span>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => loadItems()}
            >
              <i className={`bi bi-arrow-clockwise${loading ? " spin" : ""}`} />
              刷新
            </button>
          </div>
          <div
            ref={feedRef}
            className={`community-feed-body${loading ? " is-loading" : ""}`}
          >
            {loading && !items.length ? (
              <div
                className="community-grid"
                aria-label="加载作品"
                aria-busy="true"
              >
                {Array.from({ length: PAGE_SIZE }, (_, index) => (
                  <article key={index} className="community-card is-skeleton">
                    <div className="community-card__media" />
                    <footer>
                      <strong />
                      <small />
                    </footer>
                  </article>
                ))}
              </div>
            ) : error ? (
              <div className="community-empty is-error">
                <i className="bi bi-exclamation-circle" />
                <strong>{error}</strong>
                <button type="button" onClick={() => loadItems()}>
                  重新加载
                </button>
              </div>
            ) : !items.length ? (
              <div className="community-empty">
                <i className="bi bi-images" />
                <strong>
                  {activeCategory ? "该分类暂时没有作品" : "画廊还没有作品"}
                </strong>
                <span>
                  {activeCategory
                    ? "切换其他分类，或成为这个分类的第一位创作者。"
                    : "去工作台创作，并在个人中心把满意的一幅投稿进来。"}
                </span>
                <button
                  type="button"
                  onClick={() => navigate("/text-to-image")}
                >
                  开始创作
                </button>
              </div>
            ) : (
              <div
                className="community-grid"
                aria-label="社区作品"
                aria-busy={loading}
              >
                {items.map((item) => (
                  <article
                    key={item.id}
                    className="community-card"
                    onClick={() => openDetail(item)}
                  >
                    <div className="community-card__media">
                      <ProgressiveImage src={item.cover} alt={item.title} />
                      {item.categoryName && (
                        <span className="community-card__category">
                          {item.categoryName}
                        </span>
                      )}
                      <div className="community-card__overlay">
                        <span>查看</span>
                      </div>
                    </div>
                    <footer>
                      <strong title={item.title}>{item.title}</strong>
                      <div className="community-card__meta">
                        <small>{item.authorName}</small>
                        <div className="community-card__actions">
                          <button type="button">
                            <i className="bi bi-calendar3" />
                            {shortDate(item.createdAt)}
                          </button>
                        </div>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </div>
          {(hasMore || page > 1) && (
            <nav className="community-pagination" aria-label="作品分页">
              <button
                type="button"
                disabled={loading || page <= 1}
                onClick={() => changePage(page - 1)}
              >
                <i className="bi bi-chevron-left" />
                <span>上一页</span>
              </button>
              <div className="community-pagination__meta">
                <em>Page</em>
                <strong>{String(page).padStart(2, "0")}</strong>
                <small>
                  已收录 {galleryStats.works}
                  {hasMore ? "+" : ""} 件作品
                </small>
              </div>
              <button
                type="button"
                disabled={loading || !hasMore}
                onClick={() => changePage(page + 1)}
              >
                <span>下一页</span>
                <i className="bi bi-chevron-right" />
              </button>
            </nav>
          )}
        </div>
        <aside className="community-sidebar">
          <section className="community-side-card community-side-card--creators">
            <header>
              <div>
                <em>Creators</em>
                <strong>活跃创作者</strong>
              </div>
            </header>
            <ul className="community-creators">
              {topCreators.map((creator) => (
                <li key={creator.name}>
                  <span className="community-creator-avatar">
                    {creator.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{creator.name}</strong>
                    <small>
                      {creator.workCount} 件作品
                      {creator.latestAt
                        ? ` · 最近 ${shortDate(creator.latestAt)}`
                        : ""}
                    </small>
                  </div>
                  <span className="community-creator-badge">创作者</span>
                </li>
              ))}
              {!topCreators.length && (
                <li className="community-creators__empty">
                  <div>
                    <strong>虚位以待</strong>
                    <small>第一位创作者就是你</small>
                  </div>
                </li>
              )}
            </ul>
          </section>
          <section className="community-side-card community-side-card--submit">
            <header>
              <div>
                <em>Submit</em>
                <strong>分享你的创作</strong>
              </div>
            </header>
            <div className="community-submit">
              <p>
                在任意工坊完成创作后，到「个人中心 ·
                我的作品」一键投稿，通过审核即挂上展墙。
              </p>
              <div className="community-submit__actions">
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => navigate("/text-to-image")}
                >
                  去创作
                </button>
                <button type="button" onClick={goSubmit}>
                  去投稿
                </button>
              </div>
            </div>
          </section>
        </aside>
      </section>

      {detailItem && (
        <div ref={detailRef} className="share-detail">
          <div
            className="share-detail__scrim"
            aria-hidden="true"
            onClick={closeDetail}
          />
          <section
            className="share-detail__panel"
            role="dialog"
            aria-modal="true"
            aria-label={detailItem.title}
          >
            <button
              className="share-detail__close"
              type="button"
              aria-label="关闭"
              onClick={closeDetail}
            >
              <i className="bi bi-x-lg" />
            </button>
            <div className="share-detail__visual">
              <div className="share-detail__frame" aria-hidden="true" />
              <ProgressiveImage
                src={detailItem.mediaUrls[detailMediaIndex] || detailItem.cover}
                alt={detailItem.title}
                eager
              />
              <span className="share-detail__visual-mark">Artwork</span>
              {detailItem.mediaUrls.length > 1 && (
                <div className="share-detail__thumbs">
                  {detailItem.mediaUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      className={index === detailMediaIndex ? "is-active" : ""}
                      aria-label={`查看第 ${index + 1} 张`}
                      onClick={() => setDetailMediaIndex(index)}
                    >
                      <img src={url} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="share-detail__content">
              <div className="share-detail__spine" aria-hidden="true">
                <span>StarCloud Gallery</span>
                <i />
                <em>Detail</em>
              </div>
              <div className="share-detail__body">
                <header className="share-detail__top">
                  <div className="share-detail__author">
                    <span>
                      {String(detailItem.authorName || "创")
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <div>
                      <strong>{detailItem.authorName}</strong>
                      <small>AI 创作 · 社区投稿</small>
                    </div>
                  </div>
                </header>
                <div className="share-detail__intro">
                  <em>Work</em>
                  <h2>{detailItem.title}</h2>
                  <div className="share-detail__stats">
                    <span>
                      <i className="bi bi-calendar3" />
                      {formatDate(detailItem.createdAt) || "未知日期"} 入馆
                    </span>
                    <span>
                      <i className="bi bi-images" />
                      {detailItem.mediaUrls.length} 张画面
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
