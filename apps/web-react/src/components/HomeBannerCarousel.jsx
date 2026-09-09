import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { apiRequest } from "../legacy-modules/services/apiClient.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import { createBannerParticles } from "../views/home/createBannerParticles.js";
import "./HomeBannerCarousel.css";

gsap.registerPlugin(useGSAP);

function safeURL(value) {
  if (typeof value !== "string" || /[\\\u0000-\u0020]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? value : ""; }
  catch { return ""; }
}

export function HomeBannerCarousel({ hero = false, fallbackSlide = null, previewItems = null, renderContent }) {
  const { isEntryVisible } = usePageControls();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [motionDisabled, setMotionDisabled] = useState(() => document.documentElement.classList.contains("settings-no-animations"));
  const [failed, setFailed] = useState({});
  const [transitioning, setTransitioning] = useState(false);
  const rootRef = useRef(null);
  const touchStart = useRef(null);
  const requestedIndexRef = useRef(0);
  const directionRef = useRef(1);
  const queuedRef = useRef(null);
  const animatingRef = useRef(false);
  const waitingForImageRef = useRef(false);
  const presentedRef = useRef({ node: null, signature: null });

  useEffect(() => {
    if (previewItems) return;
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const data = await apiRequest("/home-banners", { signal: controller.signal, cache: "no-store" });
        if (!controller.signal.aborted) setItems(Array.isArray(data?.items) ? data.items : []);
      } catch { /* Optional promotional content must not block the home page. */ }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(load, 60000); }
    }
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [previewItems]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    const settings = new MutationObserver(() => setMotionDisabled(document.documentElement.classList.contains("settings-no-animations")));
    settings.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => { media.removeEventListener("change", motion); document.removeEventListener("visibilitychange", visibility); settings.disconnect(); };
  }, []);

  const configureLink = (item) => {
    const linkUrl = safeURL(typeof item.linkUrl === "string" ? item.linkUrl.trim() : item.linkUrl);
    const target = linkUrl ? new URL(linkUrl, window.location.href) : null;
    const isLinkVisible = Boolean(target) && (target.origin !== window.location.origin || isEntryVisible(`${target.pathname}${target.search}`));
    return {
      ...item,
      title: String(item.title || "").trim(),
      subtitle: String(item.subtitle || "").trim(),
      buttonText: String(item.buttonText || "").trim(),
      linkUrl,
      isLinkVisible,
    };
  };
  const configured = (previewItems || items).filter(item => item && safeURL(item.imageUrl) && !failed[item.imageUrl] && item.active !== false && (!item.startsAt || Date.parse(item.startsAt) <= Date.now()) && (!item.endsAt || Date.parse(item.endsAt) > Date.now()))
    .map(configureLink);
  const isFallback = !configured.length;
  const fallbackImage = failed[fallbackSlide?.imageUrl] ? fallbackSlide?.fallbackImageUrl : fallbackSlide?.imageUrl;
  const slides = configured.length ? configured : fallbackSlide ? [configureLink({ ...fallbackSlide, imageUrl: failed[fallbackImage] ? "" : fallbackImage })] : [];
  const index = selected % Math.max(1, slides.length);
  const current = slides[index];
  const motionEnabled = hero && !reduced && !motionDisabled;
  const slideSignature = JSON.stringify(slides.map(slide => [slide.id, slide.imageUrl]));
  const playing = slides.length > 1 && !transitioning && (hero || !paused) && !hovered && !focused && !hidden && !reduced && !motionDisabled;
  const duration = Math.max(3000, Math.min(20000, Number(current?.durationMs) || 5000));

  function selectSlide(nextIndex, direction = nextIndex >= requestedIndexRef.current ? 1 : -1) {
    if (!slides.length) return;
    const target = ((nextIndex % slides.length) + slides.length) % slides.length;
    requestedIndexRef.current = target;
    if (motionEnabled && animatingRef.current && !waitingForImageRef.current) {
      queuedRef.current = { index: target, direction };
      return;
    }
    queuedRef.current = null;
    directionRef.current = direction;
    setSelected(target);
  }

  const move = delta => selectSlide(requestedIndexRef.current + delta, delta < 0 ? -1 : 1);

  useGSAP((context, contextSafe) => {
    const root = rootRef.current;
    const nodes = root ? [...root.querySelectorAll('.home-banner__slide')] : [];
    const incoming = nodes[index];
    const previous = presentedRef.current;
    const sameSlides = previous.signature === slideSignature;
    const finish = contextSafe(() => {
      animatingRef.current = false;
      waitingForImageRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued && queued.index !== index) {
        directionRef.current = queued.direction;
        requestedIndexRef.current = queued.index;
        setSelected(queued.index);
      } else {
        requestedIndexRef.current = index;
        setTransitioning(false);
      }
    });

    if (!incoming || !motionEnabled || !sameSlides || previous.node === incoming || !root.contains(previous.node)) {
      presentedRef.current = { node: incoming || null, signature: slideSignature };
      if (!sameSlides) queuedRef.current = null;
      finish();
      return;
    }

    const outgoing = previous.node;
    const incomingImage = incoming.querySelector('img');
    const outgoingImage = outgoing.querySelector('img');
    const images = [incomingImage, outgoingImage].filter(Boolean);
    const copy = [...root.querySelectorAll('.home-hero h1 > span, .home-hero__tagline > span, .home-hero__links > a')];
    const compact = root.clientWidth <= 800;
    const transitionDuration = compact ? .95 : 1.15;
    let timeline;
    let particles;
    let cancelled = false;

    animatingRef.current = true;
    setTransitioning(true);
    // Keep the previous image visible until the requested image can be drawn.
    gsap.set(outgoing, { autoAlpha: 1, xPercent: 0, zIndex: 2 });
    gsap.set(incoming, { autoAlpha: 0, xPercent: 0, zIndex: 1 });
    if (copy.length) gsap.set(copy, { autoAlpha: 0 });

    const begin = contextSafe(() => {
      if (cancelled) return;
      waitingForImageRef.current = false;
      presentedRef.current = { node: incoming, signature: slideSignature };
      gsap.set(incoming, { autoAlpha: 1, xPercent: 0, zIndex: 1 });
      particles = createBannerParticles(root.querySelector('.home-hero__visual'), outgoingImage);
      timeline = gsap.timeline({ onComplete: contextSafe(() => {
        particles?.dispose();
        gsap.set([outgoing, incoming], { clearProps: 'transform,opacity,visibility,zIndex,willChange' });
        if (images.length) gsap.set(images, { clearProps: 'transform,willChange' });
        if (copy.length) gsap.set(copy, { clearProps: 'transform,opacity,visibility,willChange' });
        finish();
      }) });
      if (particles) {
        const dissolve = { progress: 0 };
        timeline.to(dissolve, {
          progress: 1, duration: transitionDuration, ease: 'none',
          onUpdate: () => particles.draw(dissolve.progress),
        }, 0);
      }
      gsap.set(outgoing, { willChange: 'opacity' });
      timeline.to(outgoing, { autoAlpha: 0, duration: transitionDuration, ease: 'sine.inOut' }, 0);
      if (copy.length) timeline.fromTo(copy,
        { autoAlpha: 0, willChange: 'opacity' },
        { autoAlpha: 1, duration: .35, stagger: .04, ease: 'sine.out' }, .18);
    });

    if (incomingImage && (!incomingImage.complete || !incomingImage.naturalWidth)) {
      waitingForImageRef.current = true;
      incomingImage.addEventListener('load', begin, { once: true });
    } else {
      begin();
    }
    return () => {
      cancelled = true;
      incomingImage?.removeEventListener('load', begin);
      timeline?.kill();
      particles?.dispose();
      animatingRef.current = false;
      waitingForImageRef.current = false;
    };
  }, { scope: rootRef, dependencies: [index, slideSignature, motionEnabled], revertOnUpdate: true });

  useGSAP((context, contextSafe) => {
    if (!playing) return;
    const progress = rootRef.current?.querySelector("[aria-current] .home-banner__progress");
    if (!progress) return;
    // One tween keeps the visible countdown and the actual slide advance in sync.
    gsap.fromTo(progress, { scaleX: 0 }, {
      scaleX: 1,
      duration: duration / 1000,
      ease: "none",
      onComplete: contextSafe(() => selectSlide(index + 1, 1)),
    });
  }, { scope: rootRef, dependencies: [playing, index, duration, current?.id, slides.length], revertOnUpdate: true });

  if (!current) return null;
  const hasControls = slides.length > 1;
  const indicators = <div className="home-banner__dots" aria-label="选择轮播图">{slides.map((slide, i) => <button key={slide.id} type="button" aria-label={slide.title ? `第 ${i + 1} 张：${slide.title}` : `第 ${i + 1} 张轮播图`} aria-current={i === index ? "true" : undefined} title={slide.title || undefined} onClick={() => selectSlide(i)}><span className="home-banner__dot" aria-hidden="true"><span className="home-banner__progress" /></span></button>)}</div>;
  const playControl = <button className="home-banner__play" type="button" disabled={motionDisabled} onClick={() => { if (reduced) setReduced(false); setPaused(reduced ? false : !paused); }} aria-label={paused || reduced || motionDisabled ? "播放轮播" : "暂停轮播"} title={motionDisabled ? "动态效果已关闭" : paused || reduced ? "播放轮播" : "暂停轮播"}>{paused || reduced || motionDisabled ? <Play size={16}/> : <Pause size={16}/>}</button>;
  const images = slides.map((slide, slideIndex) => {
    const active = slideIndex === index;
    const href = slide.isLinkVisible ? slide.linkUrl : "";
    const linkBody = <>{slide.buttonText || "查看详情"}<ArrowRight size={17} aria-hidden="true" /></>;
    return <article key={slide.id} data-banner-slide={slide.id} className={`home-banner__slide${active ? " is-active" : ""}`} aria-hidden={hero || !active} inert={hero || !active} role="group" aria-roledescription="幻灯片" aria-label={slide.title ? `${slideIndex + 1} / ${slides.length}：${slide.title}` : `第 ${slideIndex + 1} 张轮播图`}>
      {slide.imageUrl && <img className={`home-banner__image${hero ? " home-hero__image" : ""}`} src={slide.imageUrl} alt="" loading={active ? "eager" : "lazy"} fetchPriority={active ? "high" : "auto"} decoding="async" onError={() => setFailed(previous => ({...previous, [slide.imageUrl]: true}))} />}
      {!hero && <><div className="home-banner__shade" />
        <div className="home-banner__copy">{slide.title && <h2 style={slide.title.length > 30 ? {fontSize:24} : undefined}>{slide.title}</h2>}{slide.subtitle && <p>{slide.subtitle}</p>}
          {href && (href.startsWith("/") && !slide.newTab ? <Link className="home-banner__cta" to={href}>{linkBody}</Link> : <a className="home-banner__cta" href={href} target={slide.newTab ? "_blank" : undefined} rel="noopener noreferrer">{linkBody}</a>)}
        </div></>}
    </article>;
  });
  return (
    <section ref={rootRef} className={`${hero ? "home-hero" : ""}${!isFallback || !hero ? " home-banner" : ""}`} role="region" aria-roledescription={hasControls ? "轮播图" : undefined}
      aria-label={isFallback && hero ? undefined : "首页精选"} aria-labelledby={isFallback && hero ? "home-title" : undefined}
      data-banners-source={isFallback ? "default" : previewItems ? "preview" : "configured"}
      data-banner-motion={motionEnabled ? "on" : "off"}
      data-banner-transition={transitioning ? "running" : "idle"}
      data-banner-direction={directionRef.current > 0 ? "next" : "previous"}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onKeyDown={event => { if (event.target.closest("input, textarea, select, [contenteditable='true']")) return; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); } }}
      onTouchStart={event => {
        const touch = event.touches[0];
        touchStart.current = touch && event.touches.length === 1 && !event.target.closest("form")
          ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={event => {
        const start = touchStart.current;
        const touch = event.changedTouches[0];
        touchStart.current = null;
        if (!start || !touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
      }}
      onTouchCancel={() => { touchStart.current = null; }}>
      {hero ? <div className="home-hero__visual" aria-hidden="true">{images}</div> : images}
      {renderContent?.(current, { hasControls, isFallback })}
      {hasControls && <div className={`home-banner__controls${hero ? " home-shell" : ""}`} data-click-guard="repeat">
        {hero ? <div className="home-banner__pagination" role="group" aria-label="轮播进度">{indicators}</div> : indicators}
        <div className="home-banner__navigation"><span className="home-banner__counter">{String(index + 1).padStart(2,"0")} / {String(slides.length).padStart(2,"0")}</span>
          {!hero && playControl}
          <button className="home-banner__previous" type="button" onClick={() => move(-1)} aria-label="上一张" title="上一张">{hero ? <ChevronLeft size={20}/> : <ArrowLeft size={18}/>}</button>
          <button className="home-banner__next" type="button" onClick={() => move(1)} aria-label="下一张" title="下一张">{hero ? <ChevronRight size={20}/> : <ArrowRight size={18}/>}</button>
        </div>
      </div>}
    </section>
  );
}
