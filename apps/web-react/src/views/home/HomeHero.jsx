import { Link, useSearchParams } from "react-router";
import { ArrowDown, ArrowRight } from "lucide-react";
import { HomeBannerCarousel } from "../../components/HomeBannerCarousel.jsx";

const DEFAULT_SLIDE = {
  id: "home-default", title: "星空云绘", subtitle: "让想象，成为作品。",
  imageUrl: "/sucai/home-intro-03.png", fallbackImageUrl: "/sucai/studio-cover-assistant.webp",
};

const PREVIEW_SLIDES = [
  { ...DEFAULT_SLIDE, id: "preview-creation", durationMs: 5000, linkUrl: "/studio", buttonText: "进入创作台" },
  { id: "preview-commerce", title: "AI 电商设计", subtitle: "让商品拥有自己的视觉语言。", imageUrl: "/sucai/studio-cover-ecom-create.webp", linkUrl: "/ecommerce-design?tool=shoot", buttonText: "探索电商创作", durationMs: 5000 },
  { id: "preview-canvas", title: "无限画布", subtitle: "将灵感串联成完整的创作。", imageUrl: "/sucai/canvas-hero.webp", linkUrl: "/canvas", buttonText: "打开无限画布", durationMs: 5000 },
];

export function HomeHero({ studioVisible }) {
  const [searchParams] = useSearchParams();
  const previewItems = import.meta.env.DEV && searchParams.get("previewBanners") === "1" ? PREVIEW_SLIDES : null;

  return (
    <HomeBannerCarousel hero fallbackSlide={DEFAULT_SLIDE} previewItems={previewItems} renderContent={(slide, { isFallback }) =>
      <div className="home-shell home-hero__inner">
        <div className="home-hero__copy">
          {slide.title && <h1 id="home-title" data-title-size={slide.title.length > 28 ? "long" : slide.title.length > 12 ? "medium" : "short"} title={slide.title} data-home-enter><span>{slide.title}</span></h1>}
          {slide.subtitle && <p className="home-hero__tagline" title={slide.subtitle} data-home-enter><span>{slide.subtitle}</span></p>}
        </div>
        {(isFallback || slide.linkUrl) && <div className="home-hero__links" data-home-enter>
          {slide.linkUrl ? slide.isLinkVisible && (slide.linkUrl.startsWith("/") && !slide.newTab
            ? <Link className="home-banner__cta" to={slide.linkUrl} title={slide.buttonText || "查看详情"}><span>{slide.buttonText || "查看详情"}</span><ArrowRight size={16} aria-hidden="true" /></Link>
            : <a className="home-banner__cta" href={slide.linkUrl} title={slide.buttonText || "查看详情"} target={slide.newTab ? "_blank" : undefined} rel="noopener noreferrer"><span>{slide.buttonText || "查看详情"}</span><ArrowRight size={16} aria-hidden="true" /></a>)
            : isFallback && studioVisible && <Link className="home-banner__cta" to="/studio"><span>进入创作台</span><ArrowRight size={16} aria-hidden="true" /></Link>}
          <a className="home-hero__secondary" href="#home-directory"><span>探索全部工具</span><ArrowDown size={15} aria-hidden="true" /></a>
        </div>}
      </div>
    } />
  );
}
