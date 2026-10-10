import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { HomeBannerCarousel } from "../../components/HomeBannerCarousel.jsx";
import "./HomeHeroImmersive.css";

const PREVIEW_SLIDES = [
  { id: "preview-creation", title: "星空云绘", subtitle: "让想象，成为作品。", imageUrl: "/sucai/studio-cover-t2i.webp", durationMs: 5000, linkUrl: "/studio", buttonText: "进入创作台" },
  { id: "preview-commerce", title: "AI 电商设计", subtitle: "让商品拥有自己的视觉语言。", imageUrl: "/sucai/studio-cover-ecom-create.webp", linkUrl: "/ecommerce-design?tool=shoot", buttonText: "探索电商创作", durationMs: 5000 },
  { id: "preview-canvas", title: "无限画布", subtitle: "将灵感串联成完整的创作。", imageUrl: "/sucai/canvas-hero.webp", linkUrl: "/canvas", buttonText: "打开无限画布", durationMs: 5000 },
];

// 文案先整体渐隐，再换成新一张的文案依次渐现；首屏第一次由 useHomeMotion 负责入场。
const HERO_FADE_OUT_MS = 220;

function SparkleStar({ className }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.7 6 4.5 9.8 10.5 10.5-6 .7-9.8 4.5-10.5 10.5C11.3 16.5 7.5 12.7 1.5 12 7.5 11.3 11.3 7.5 12 1.5Z" fill="currentColor" /></svg>;
}

function HeroCta({ slide }) {
  const label = slide.buttonText || "查看详情";
  const content = <>
    <span className="home-banner__cta-orbit" aria-hidden="true"><SparkleStar className="home-banner__cta-orbit-star" /></span>
    <span className="home-banner__cta-leaf" aria-hidden="true" />
    <span className="home-banner__cta-shine" aria-hidden="true" />
    <SparkleStar className="home-banner__cta-star" />
    <span className="home-banner__cta-label">{label}</span>
    <span className="home-banner__cta-icon" aria-hidden="true"><ArrowRight size={18} strokeWidth={2.6} /></span>
  </>;
  if (slide.linkUrl.startsWith("/") && !slide.newTab) {
    return <Link className="home-banner__cta" to={slide.linkUrl} title={label}>{content}</Link>;
  }
  return <a className="home-banner__cta" href={slide.linkUrl} title={label} target={slide.newTab ? "_blank" : undefined} rel="noopener noreferrer">{content}</a>;
}

function HeroContent({ slide }) {
  const [shown, setShown] = useState(slide);
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    // 淡出途中又切回正在显示的这一张：直接恢复显示，不能停在淡出状态。
    if (slide.id === shown.id) {
      if (slide !== shown) setShown(slide);
      setPhase((current) => (current === "out" ? "in" : current));
      return undefined;
    }
    setPhase("out");
    const timer = setTimeout(() => {
      setShown(slide);
      setPhase("in");
    }, HERO_FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [slide, shown]);

  const showCta = Boolean(shown.linkUrl && shown.isLinkVisible);
  return (
    <div className="home-shell home-hero__inner" data-hero-phase={phase}>
      <div className="home-hero__copy" key={`copy-${shown.id}`}>
        {shown.title && <h1 id="home-title" data-title-size={shown.title.length > 28 ? "long" : shown.title.length > 12 ? "medium" : "short"} title={shown.title} data-home-enter data-hero-fade="1"><span>{shown.title}</span></h1>}
        {shown.subtitle && <p className="home-hero__tagline" title={shown.subtitle} data-home-enter data-hero-fade="2"><span>{shown.subtitle}</span></p>}
      </div>
      {showCta && <div className="home-hero__links" key={`links-${shown.id}`} data-home-enter data-hero-fade="3">
        <HeroCta slide={shown} />
      </div>}
    </div>
  );
}

export function HomeHero() {
  const [searchParams] = useSearchParams();
  const previewItems = import.meta.env.DEV && searchParams.get("previewBanners") === "1" ? PREVIEW_SLIDES : null;

  return <HomeBannerCarousel hero previewItems={previewItems} renderContent={(slide) => <HeroContent slide={slide} />} />;
}
