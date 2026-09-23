import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ProgressiveImage } from "../components/ProgressiveImage.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import "@react/legacy-static/features/share/styles/share-view.css";

const PAGE_SIZE = 16;
const HERO_ROTATE_MS = 6400;
const REVEAL_SRC = "/sucai/community-gallery-atmosphere.webp";
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

function firstUrl(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = value.find(Boolean);
      if (found) return String(found);
      continue;
    }
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function normalizeItem(raw) {
  const cover = firstUrl(raw?.coverUrl, raw?.mediaUrls);
  if (!raw?.id || !cover) return null;
  const mediaUrls =
    Array.isArray(raw.mediaUrls) && raw.mediaUrls.length
      ? raw.mediaUrls.map(String)
      : [cover];
  const mediaDisplayUrls =
    Array.isArray(raw.mediaDisplayUrls) && raw.mediaDisplayUrls.length
      ? raw.mediaDisplayUrls.map((url, index) =>
          String(url || mediaUrls[index] || cover),
        )
      : mediaUrls;
  return {
    id: String(raw.id),
    title: String(raw.title || "").trim() || "AI 作品",
    cover,
    thumb: firstUrl(raw.coverThumbUrl, cover),
    original: firstUrl(mediaUrls, cover),
    display: firstUrl(raw.mediaDisplayUrls, raw.coverDisplayUrl, mediaUrls, cover),
    mediaUrls,
    mediaDisplayUrls,
    authorName: raw.author?.username || "社区创作者",
    authorAvatar: raw.author?.avatarUrl || "",
    createdAt: raw.createdAt || "",
    featured: Boolean(raw.featured),
    categoryName: String(raw.category?.name || "").trim(),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter(Boolean).map(String).slice(0, 8)
      : [],
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

function authorInitial(name) {
  return String(name || "创").slice(0, 1).toUpperCase();
}

const PROMPT_HINT = /参考图|用途：|高清优化|提示词|\bprompt\b|\blora\b/i;

function looksLikePrompt(title) {
  const text = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 22 && PROMPT_HINT.test(text);
}

function clampTitle(title, max = 16) {
  const text = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "未命名作品";
  const first = text.split(/[\n；;]/)[0].trim() || text;
  if (first.length <= max) return first;
  return `${first.slice(0, max).replace(/[，,。.\s]+$/, "")}…`;
}

function itemHeadline(item, max = 18) {
  return clampTitle(item?.title, max);
}

function AuthorMark({ name, src, className }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  return (
    <span className={className}>
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        authorInitial(name)
      )}
    </span>
  );
}

export function ShareView() {
  const { user } = useAuth();
  const isDark = useIsDark();
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
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursors, setPageCursors] = useState([""]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [categoryStuck, setCategoryStuck] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [detailMediaIndex, setDetailMediaIndex] = useState(0);

  const spotlightSource =
    featuredItems.length >= 3 ? featuredItems : spotlightItems;
  const heroItems = spotlightSource.slice(0, 5);
  const currentHero =
    heroItems[heroIndex % Math.max(1, heroItems.length)] || null;
  const currentHeroHeadline =
    currentHero && !looksLikePrompt(currentHero.title)
      ? itemHeadline(currentHero, 22)
      : "";
  const hotItems = useMemo(() => {
    const pool = [...seenItems.values()];
    const source = pool.length ? pool : spotlightSource;
    return source
      .filter((item) => item.id !== currentHero?.id)
      .slice(0, 5);
  }, [seenItems, spotlightSource, currentHero?.id]);
  const galleryStats = useMemo(() => {
    const rows = [...seenItems.values()];
    return {
      works: rows.length,
      creators: new Set(rows.map((item) => item.authorName)).size,
      featured: rows.filter((item) => item.featured).length,
    };
  }, [seenItems]);
  const topCreators = useMemo(() => {
    const creators = new Map();
    seenItems.forEach((item) => {
      const row = creators.get(item.authorName) || {
        name: item.authorName,
        avatar: "",
        workCount: 0,
        latestAt: "",
        latestId: "",
      };
      row.workCount += 1;
      if (item.authorAvatar && !row.avatar) row.avatar = item.authorAvatar;
      if (String(item.createdAt) > String(row.latestAt)) {
        row.latestAt = item.createdAt;
        row.latestId = item.id;
      }
      creators.set(item.authorName, row);
    });
    return [...creators.values()]
      .sort((a, b) => b.workCount - a.workCount)
      .slice(0, 6);
  }, [seenItems]);
  const relatedItems = useMemo(() => {
    if (!detailItem) return [];
    const rows = [...seenItems.values()].filter(
      (item) => item.id !== detailItem.id,
    );
    const sameCategory = detailItem.categoryName
      ? rows.filter((item) => item.categoryName === detailItem.categoryName)
      : [];
    const pool = (sameCategory.length ? sameCategory : rows).slice(0, 4);
    return pool;
  }, [detailItem, seenItems]);
  const activeCategoryName =
    categories.find((item) => item.id === activeCategory)?.name || "";
  const feedTitle = featuredOnly
    ? "精选展出"
    : activeCategoryName || "最新入馆";

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
        { opacity: 0, y: 26, filter: "blur(8px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.78,
          stagger: 0.09,
          ease: "power4.out",
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
        { opacity: 0, y: soft ? 10 : 32, scale: soft ? 1 : 0.96 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: soft ? 0.28 : 0.52,
          stagger: soft ? 0.012 : { each: 0.045, from: "start" },
          ease: "power3.out",
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
        .timeline({ defaults: { ease: "power3.out" } })
        .fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.22 }, 0)
        .fromTo(
          panel,
          { opacity: 0, y: 40, scale: 0.94, rotateX: 8 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            rotateX: 0,
            duration: 0.42,
            clearProps: "transform",
          },
          0.02,
        );
      const visual = detailRef.current.querySelector(
        ".share-detail__visual .share-progressive-image",
      );
      const beats = detailRef.current.querySelectorAll(
        ".share-detail__author, .share-detail__intro, .share-detail__cta, .share-detail__related",
      );
      if (visual)
        gsap.fromTo(
          visual,
          { scale: 1.1 },
          { scale: 1, duration: 0.7, ease: "power3.out" },
        );
      if (beats.length)
        gsap.fromTo(
          beats,
          { opacity: 0, y: 16 },
          {
            opacity: 1,
            y: 0,
            duration: 0.38,
            stagger: 0.05,
            delay: 0.12,
            ease: "power3.out",
            clearProps: "transform",
          },
        );
    },
    {
      scope: pageRef,
      dependencies: [detailItem?.id],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      const root = pageRef.current;
      if (!root || reduceMotion()) return undefined;
      const reveal = isDark ? root.querySelector(".community-reveal") : null;
      const art = reveal?.querySelector(".community-reveal__art") || null;
      const canReveal =
        Boolean(reveal && art) && !navigator.connection?.saveData;
      let beamX = null;
      let beamY = null;
      let artX = null;
      let artY = null;
      let half = 0;
      let idleId = 0;
      if (canReveal) {
        const size = window.matchMedia("(pointer: coarse)").matches ? 560 : 520;
        half = size / 2;
        reveal.style.setProperty("--reveal-size", `${size}px`);
        const move = { duration: 0.16, ease: "power3.out" };
        beamX = gsap.quickTo(reveal, "x", move);
        beamY = gsap.quickTo(reveal, "y", move);
        artX = gsap.quickTo(art, "x", move);
        artY = gsap.quickTo(art, "y", move);
      }
      let hovered = null;
      let lit = false;
      let raf = 0;
      let nextX = 0;
      let nextY = 0;
      let nextTarget = null;
      const warmArt = () => {
        if (!art || art.dataset.ready === "1") return;
        art.dataset.ready = "1";
        art.style.backgroundImage = `url("${REVEAL_SRC}")`;
      };
      if (canReveal) {
        const preload = () => {
          const image = new Image();
          image.decoding = "async";
          image.src = REVEAL_SRC;
          if (image.decode) image.decode().then(warmArt).catch(warmArt);
          else image.onload = warmArt;
        };
        if (typeof requestIdleCallback === "function")
          idleId = requestIdleCallback(preload, { timeout: 1800 });
        else idleId = window.setTimeout(preload, 400);
      }
      const release = (node) => {
        if (!node) return;
        gsap.to(node, {
          rotateX: 0,
          rotateY: 0,
          duration: 0.55,
          ease: "power3.out",
          overwrite: "auto",
        });
        if (node.classList.contains("community-featured")) {
          const slides = node.querySelector(".community-featured__slides");
          if (slides)
            gsap.to(slides, {
              x: 0,
              y: 0,
              scale: 1,
              duration: 0.7,
              ease: "power3.out",
              overwrite: "auto",
            });
        }
      };
      const flush = () => {
        raf = 0;
        const x = nextX;
        const y = nextY;
        const target = nextTarget?.closest?.(".community-featured") || null;
        nextTarget = null;
        if (hovered && hovered !== target) release(hovered);
        hovered = target;
        if (canReveal) {
          if (!lit) {
            lit = true;
            warmArt();
            root.classList.add("is-lit");
          }
          beamX?.(x);
          beamY?.(y);
          artX?.(-x + half);
          artY?.(-y + half);
        }
        if (!target || target.classList.contains("is-empty")) return;
        const rect = target.getBoundingClientRect();
        const px = (x - rect.left) / rect.width - 0.5;
        const py = (y - rect.top) / rect.height - 0.5;
        target.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
        target.style.setProperty("--my", `${(py + 0.5) * 100}%`);
        gsap.to(target, {
          rotateY: px * 7,
          rotateX: -py * 5,
          duration: 0.4,
          ease: "power3.out",
          overwrite: "auto",
        });
        const slides = target.querySelector(".community-featured__slides");
        if (slides)
          gsap.to(slides, {
            x: px * 16,
            y: py * 12,
            scale: 1.05,
            duration: 0.55,
            ease: "power3.out",
            overwrite: "auto",
          });
      };
      const onMove = (event) => {
        nextX = event.clientX;
        nextY = event.clientY;
        nextTarget = event.target;
        if (!raf) raf = requestAnimationFrame(flush);
      };
      const onLeave = () => {
        lit = false;
        root.classList.remove("is-lit");
        release(hovered);
        hovered = null;
      };
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
      return () => {
        root.removeEventListener("pointermove", onMove);
        root.removeEventListener("pointerleave", onLeave);
        if (raf) cancelAnimationFrame(raf);
        if (typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
        else clearTimeout(idleId);
        root.classList.remove("is-lit");
        release(hovered);
      };
    },
    { scope: pageRef, dependencies: [isDark], revertOnUpdate: true },
  );

  async function loadItems({
    targetPage = page,
    category = activeCategory,
    featured = featuredOnly,
    resetSpotlight = false,
  } = {}) {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet("/gallery/submissions", {
        limit: PAGE_SIZE,
        cursor: pageCursors[targetPage - 1] || "",
        category,
        featured: featured ? 1 : undefined,
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
        !featured &&
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
    ]).then(([listResult, featuredResult, categoryResult]) => {
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
    if (heroItems.length < 2 || heroPaused || detailItem || reduceMotion())
      return undefined;
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroItems.length);
    }, HERO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [heroItems.length, heroPaused, detailItem]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeDetail();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (detailItem) {
        const total = detailItem.mediaUrls.length;
        if (total < 2) return;
        event.preventDefault();
        setDetailMediaIndex((current) =>
          event.key === "ArrowRight"
            ? (current + 1) % total
            : (current - 1 + total) % total,
        );
        return;
      }
      if (heroItems.length < 2) return;
      event.preventDefault();
      setHeroIndex((current) =>
        event.key === "ArrowRight"
          ? (current + 1) % heroItems.length
          : (current - 1 + heroItems.length) % heroItems.length,
      );
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
  function resetFeed(next) {
    setActiveCategory(next.category);
    setFeaturedOnly(next.featured);
    setPage(1);
    setItems([]);
    setHasMore(false);
    setPageCursors([""]);
    void loadItems({
      targetPage: 1,
      category: next.category,
      featured: next.featured,
      resetSpotlight: !next.category && !next.featured,
    });
  }
  function selectCategory(id) {
    if (id === activeCategory && !featuredOnly) return;
    resetFeed({ category: id, featured: false });
  }
  function selectFeatured() {
    if (featuredOnly && !activeCategory) return;
    resetFeed({ category: "", featured: true });
  }
  function refresh() {
    setPage(1);
    setItems([]);
    setHasMore(false);
    setPageCursors([""]);
    void loadItems({
      targetPage: 1,
      resetSpotlight: !activeCategory && !featuredOnly,
    });
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
          .to(panel, { opacity: 0, y: 12, scale: 0.99, duration: 0.16 }, 0)
          .to(scrim, { opacity: 0, duration: 0.12 }, 0.02);
      });
    }
    setDetailItem(null);
    document.body.classList.remove("share-detail-open");
    if (new URLSearchParams(location.search).has("item"))
      navigate("/share", { replace: true });
  });
  function openCreator(creator) {
    const found =
      seenItems.get(creator.latestId) ||
      [...seenItems.values()].find((item) => item.authorName === creator.name);
    if (found) openDetail(found);
  }

  return (
    <main ref={pageRef} className="community-page">
      {isDark ? (
        <div className="community-reveal" aria-hidden="true">
          <div className="community-reveal__art" />
        </div>
      ) : null}
      <div className="community-atmosphere" aria-hidden="true">
        <i className="community-orb is-a" />
        <i className="community-orb is-b" />
        <i className="community-orb is-c" />
      </div>
      <div className="community-grain" aria-hidden="true" />
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
                灵感在此汇聚。浏览通过审核的作品，也把你的创作挂上展墙。
              </p>
              <div className="community-copy__actions">
                <button
                  type="button"
                  className="is-primary"
                  onClick={scrollFeed}
                >
                  进入画廊<span aria-hidden="true">→</span>
                </button>
                <button type="button" className="is-ghost" onClick={goSubmit}>
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
                  <strong>{compactNumber(galleryStats.featured)}</strong>
                  <span>精选</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={`community-featured${currentHero ? "" : " is-empty"}${heroPaused ? " is-paused" : ""}`}
          data-share-motion
          role="button"
          tabIndex="0"
          style={{ "--hero-rotate-ms": `${HERO_ROTATE_MS}ms` }}
          aria-label={
            currentHero ? `查看精选作品：${currentHero.title}` : "等待精选作品"
          }
          onMouseEnter={() => setHeroPaused(true)}
          onMouseLeave={() => setHeroPaused(false)}
          onFocus={() => setHeroPaused(true)}
          onBlur={() => setHeroPaused(false)}
          onClick={() => currentHero && openDetail(currentHero)}
          onKeyDown={(event) =>
            event.key === "Enter" && currentHero && openDetail(currentHero)
          }
        >
          {currentHero ? (
            <>
              <div className="community-featured__slides">
                {heroItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`community-featured__slide${index === heroIndex ? " is-active" : ""}`}
                    aria-hidden={index !== heroIndex}
                  >
                    <ProgressiveImage
                      className="community-featured__image"
                      src={item.original || item.cover}
                      previewSrc={item.thumb || item.cover}
                      fallbackSrc={item.cover}
                      alt={item.title}
                      eager
                    />
                  </div>
                ))}
              </div>
              <div className="community-featured__shine" aria-hidden="true" />
              <div className="community-featured__shade" />
              {currentHero.featured ? (
                <span className="community-featured__badge">精选</span>
              ) : null}
              <div className="community-featured__meta" key={currentHero.id}>
                {currentHeroHeadline ? (
                  <strong title={currentHero.title}>{currentHeroHeadline}</strong>
                ) : null}
                <small>
                  {currentHero.authorName}
                  {shortDate(currentHero.createdAt)
                    ? ` · ${shortDate(currentHero.createdAt)}`
                    : ""}
                  {currentHero.categoryName &&
                  currentHeroHeadline !== currentHero.categoryName
                    ? ` · ${currentHero.categoryName}`
                    : ""}
                </small>
              </div>
              {heroItems.length > 1 ? (
                <>
                  <button
                    className="community-featured__arrow is-prev"
                    type="button"
                    aria-label="上一张"
                    data-click-guard="off"
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
                    data-click-guard="off"
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
                        aria-label={`切换到 ${itemHeadline(item) || item.authorName}`}
                        data-click-guard="off"
                        onClick={(event) => {
                          event.stopPropagation();
                          setHeroIndex(index);
                        }}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <div className="community-featured__placeholder">
              <i className="bi bi-images" />
              <span>等待精选作品</span>
              <small>通过审核的投稿会在这里展出</small>
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
            {hotItems.map((item, index) => {
              const headline = itemHeadline(item);
              return (
                <li key={item.id} onClick={() => openDetail(item)}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <ProgressiveImage src={item.cover} alt="" />
                  <span>
                    <strong title={item.title}>
                      {headline || item.authorName}
                    </strong>
                    <small>
                      {headline ? item.authorName : shortDate(item.createdAt)}
                    </small>
                  </span>
                  <em>{shortDate(item.createdAt)}</em>
                </li>
              );
            })}
            {!hotItems.length && (
              <li className="community-hot-panel__empty">
                <span>
                  <strong>展墙整理中</strong>
                  <small>第一件入馆作品会出现在这里</small>
                </span>
              </li>
            )}
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
          <div className="community-categories__track">
            <button
              type="button"
              className={!activeCategory && !featuredOnly ? "is-active" : ""}
              onClick={() => selectCategory("")}
            >
              <i className="bi bi-grid" />
              全部
            </button>
            <button
              type="button"
              className={featuredOnly ? "is-active" : ""}
              onClick={selectFeatured}
            >
              <i className="bi bi-stars" />
              精选
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
          </div>
          <button
            type="button"
            className="is-refresh"
            disabled={loading}
            aria-label="刷新馆藏"
            onClick={refresh}
          >
            <i className={`bi bi-arrow-clockwise${loading ? " spin" : ""}`} />
          </button>
        </nav>
        <div className="community-main" data-share-motion>
          <div className="community-feed-head">
            <div>
              <strong>{feedTitle}</strong>
              <span>
                已收录 {galleryStats.works}
                {hasMore ? "+" : ""} 件
              </span>
            </div>
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
                  {featuredOnly
                    ? "还没有精选作品"
                    : activeCategory
                      ? "该分类暂时没有作品"
                      : "画廊还没有作品"}
                </strong>
                <span>
                  {featuredOnly
                    ? "策展完成后，精选作品会显示在这里。"
                    : activeCategory
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
                {items.map((item) => {
                  const headline = itemHeadline(item);
                  return (
                    <article
                      key={item.id}
                      className="community-card"
                      title={item.title}
                      onClick={() => openDetail(item)}
                    >
                      <div className="community-card__media">
                        <ProgressiveImage
                          src={item.original || item.cover}
                          previewSrc={item.thumb || item.cover}
                          fallbackSrc={item.cover}
                          alt={item.title}
                        />
                        {item.featured && (
                          <span className="community-card__featured">精选</span>
                        )}
                        {item.categoryName && (
                          <span className="community-card__category">
                            {item.categoryName}
                          </span>
                        )}
                      </div>
                      <footer>
                        <strong title={item.title}>{headline}</strong>
                        <div className="community-card__meta">
                          <div className="community-card__author">
                            <AuthorMark
                              name={item.authorName}
                              src={item.authorAvatar}
                            />
                            <small>{item.authorName}</small>
                          </div>
                          <time dateTime={item.createdAt || undefined}>
                            {shortDate(item.createdAt)}
                          </time>
                        </div>
                      </footer>
                    </article>
                  );
                })}
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
                <li key={creator.name} onClick={() => openCreator(creator)}>
                  <AuthorMark
                    name={creator.name}
                    src={creator.avatar}
                    className="community-creator-avatar"
                  />
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
              <p>在工作台完成后，到个人中心把满意的一幅投稿进社区画廊。</p>
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
              <ProgressiveImage
                src={
                  detailItem.mediaUrls[detailMediaIndex] ||
                  detailItem.cover
                }
                alt={detailItem.title}
                eager
              />
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
                    <AuthorMark
                      name={detailItem.authorName}
                      src={detailItem.authorAvatar}
                    />
                    <div>
                      <strong>{detailItem.authorName}</strong>
                      <small>AI 创作 · 社区投稿</small>
                    </div>
                  </div>
                </header>
                <div className="share-detail__intro">
                  <em>Work</em>
                  <h2 title={detailItem.title}>
                    {looksLikePrompt(detailItem.title)
                      ? detailItem.categoryName || "社区作品"
                      : itemHeadline(detailItem, 28)}
                  </h2>
                  {looksLikePrompt(detailItem.title) ? (
                    <p>{detailItem.title}</p>
                  ) : null}
                  {(detailItem.featured ||
                    detailItem.categoryName ||
                    detailItem.tags.length > 0) && (
                    <div className="share-detail__tags">
                      {detailItem.featured ? <span>精选</span> : null}
                      {detailItem.categoryName ? (
                        <span>{detailItem.categoryName}</span>
                      ) : null}
                      {detailItem.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
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
                <div className="share-detail__cta">
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => navigate("/text-to-image")}
                  >
                    去创作同款灵感
                  </button>
                  <button type="button" onClick={goSubmit}>
                    投稿我的作品
                  </button>
                </div>
                {relatedItems.length > 0 && (
                  <div className="share-detail__related">
                    <em>More</em>
                    <strong>同一展墙</strong>
                    <div>
                      {relatedItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openDetail(item)}
                        >
                          <ProgressiveImage
                            src={item.cover}
                            alt={item.title}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
