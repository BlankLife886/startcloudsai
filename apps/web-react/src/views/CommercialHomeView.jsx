import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "@react/legacy-static/features/home-commercial/commercial-home.css";
import "@react/legacy-styles/generated/features/home-commercial/components/CapabilityLoop.css";
import "@react/legacy-styles/generated/features/home-commercial/components/StrandsBand.css";
import "@react/legacy-styles/generated/features/home-commercial/components/TypeLine.css";
import { COMMERCE_ENTRY_GROUPS } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { useLocale } from "../i18n/index.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import "./commercial-home-react.css";

gsap.registerPlugin(useGSAP);

const HOME_HERO_MEDIA_QUERY = "(min-width: 961px)";
const GradientBlindsHero = lazy(() =>
  import("../components/GradientBlindsHero.jsx").then((module) => ({
    default: module.GradientBlindsHero,
  })),
);

function useHomeHeroEnabled() {
  const [enabled, setEnabled] = useState(() =>
    window.matchMedia(HOME_HERO_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(HOME_HERO_MEDIA_QUERY);
    const update = () => setEnabled(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return enabled;
}

const studioEntries = [
  {
    id: "assistant",
    to: "/assistant",
    icon: "bi bi-chat-square-heart",
    index: "01",
    title: "AI 助手",
    english: "Assistant",
    description: "连续对话、理解图片，并把创作任务留在同一条上下文里。",
    tone: "mint",
    taskType: null,
    priceHint: "按用量计费",
    cover: "/sucai/studio-cover-assistant.webp",
  },
  {
    id: "text-to-image",
    to: "/text-to-image",
    icon: "bi bi-stars",
    index: "02",
    title: "文生图",
    english: "Text to image",
    description: "选择模型、比例与清晰度，把描述快速变成可交付图像。",
    tone: "blue",
    taskType: "t2i",
    cover: "/sucai/studio-cover-t2i.webp",
  },
  {
    id: "canvas",
    to: "/canvas",
    icon: "bi bi-bounding-box-circles",
    index: "03",
    title: "无限画布",
    english: "Infinite canvas",
    description: "在同一张画布上摆参考、改图并连续生成。",
    tone: "white",
    taskType: "infinite_canvas",
    cover: "/sucai/home-intro-sticker-sheet.png",
  },
  {
    id: "illustration-coloring",
    to: "/ai-illustration-coloring",
    icon: "bi bi-brush",
    index: "04",
    title: "插画染色",
    english: "Coloring",
    description: "保留线稿结构，重建颜色、材质与完整光影。",
    tone: "coral",
    taskType: "coloring",
    cover: "/sucai/studio-cover-coloring.webp",
  },
  {
    id: "ui-design",
    to: "/design-workshop",
    icon: "bi bi-bezier2",
    index: "05",
    title: "UI 设计稿",
    english: "UI design",
    description: "分析整张设计图，定位元素并衔接素材与前端还原。",
    tone: "yellow",
    taskType: "ui_design",
    cover: "/sucai/studio-cover-ui.webp",
  },
  {
    id: "ecommerce-design",
    to: "/ecommerce-design",
    icon: "bi bi-bag-check-fill",
    index: "06",
    title: "AI 电商",
    english: "Commerce design",
    description: "上传商品图，一次生成适配平台规范的主图、详情与营销视觉。",
    tone: "yellow",
    taskType: "ecommerce_design",
    cover: "/sucai/studio-cover-ecom-create.webp",
  },
  {
    id: "model-sheet",
    to: "/model-sheet",
    icon: "bi bi-person-bounding-box",
    index: "07",
    title: "模型设计",
    english: "Model design",
    description: "生成清晰、统一的多视角角色与模型参考。",
    tone: "violet",
    taskType: "model_sheet",
    cover: "/sucai/studio-cover-model.webp",
  },
  {
    id: "game-art",
    to: "/game-art",
    icon: "bi bi-controller",
    index: "08",
    title: "游戏设计",
    english: "Game art",
    description: "从角色、场景、道具到图标，组织完整游戏资产流程。",
    tone: "green",
    taskType: "game_art",
    cover: "/sucai/studio-cover-game.webp",
  },
];

const capabilityItems = [
  ["/sucai/ecom-thumb-tryon.webp", "AI 虚拟试衣", "AI 电商"],
  ["/sucai/ecom-thumb-handheld.webp", "手持商品图", "AI 电商"],
  ["/sucai/ecom-thumb-accessory.webp", "AI 饰品穿戴", "AI 电商"],
  ["/sucai/ecom-thumb-shoot.webp", "AI 创意商拍", "AI 电商"],
  ["/sucai/ecom-thumb-listing.webp", "商品套图", "AI 电商"],
  ["/sucai/ecom-thumb-detail.webp", "A+ / 详情页", "AI 电商"],
  ["/sucai/ecom-thumb-campaign.webp", "AI 营销图", "AI 电商"],
  ["/sucai/ecom-thumb-background.webp", "AI 背景图", "AI 电商"],
  ["/sucai/ecom-thumb-backdrop.webp", "背景复刻", "AI 电商"],
  ["/sucai/ecom-thumb-shadow.webp", "AI 商品阴影", "AI 电商"],
  ["/sucai/ecom-thumb-outpaint.webp", "智能扩图", "AI 电商"],
  ["/sucai/ecom-thumb-enhance.webp", "真实增强", "AI 电商"],
  ["/sucai/studio-cover-assistant.webp", "AI 助手", "图片设计"],
  ["/sucai/studio-cover-t2i.webp", "文生图", "图片设计"],
  ["/sucai/home-intro-sticker-sheet.png", "无限画布", "图片设计"],
  ["/sucai/studio-cover-coloring.webp", "插画染色", "图片设计"],
  ["/sucai/studio-cover-ui.webp", "UI 设计稿", "图片设计"],
  ["/sucai/studio-cover-model.webp", "模型设计", "图片设计"],
  ["/sucai/studio-cover-game.webp", "游戏设计", "图片设计"],
];

const processSteps = [
  [
    "01",
    "bi bi-sliders2",
    "选择模型",
    "按创作目标选择模型、分辨率、比例和参考图能力。",
    "mint",
  ],
  [
    "02",
    "bi bi-broadcast",
    "持续执行",
    "排队、生成和逐张结果持续同步到当前页面。",
    "yellow",
  ],
  [
    "03",
    "bi bi-box-arrow-down",
    "高清交付",
    "保留原图与任务记录，继续迭代或下载高清成品。",
    "coral",
  ],
];

const usageSteps = [
  [
    "01",
    "bi bi-person-check",
    "登录账号",
    "进入平台后登录，同步积分与创作记录。",
  ],
  [
    "02",
    "bi bi-grid-1x2",
    "选择工作室",
    "按目标打开文生图、染色、UI 或游戏等工作台。",
  ],
  ["03", "bi bi-magic", "生成交付", "设置参数并生成，完成后下载或继续迭代。"],
];

const narrative =
  "从选择模型、组织提示词和参考图，到持续接收生成结果、继续迭代与高清交付，星空云绘把分散的创作步骤收进一条清晰、可追踪的工作流。";
const floatTitle = "一套工作流，覆盖整条创作链";

function splitNarrative(text, locale) {
  if (locale === "en") return text.split(/(\s+)/).filter(Boolean);
  return text.split(/(\s+|(?<=[，。]))/u).filter(Boolean);
}
const introSlides = [
  "/sucai/home-intro-sticker-sheet.png",
  "/sucai/home-intro-02.png",
  "/sucai/home-intro-03.png",
];
const heroGradientColors = [
  "#ff003c",
  "#ff7a00",
  "#ffd400",
  "#2aff6a",
  "#00d4ff",
  "#3b5bff",
  "#b347ff",
];
const footerDiscover = [
  ["社区", "/share"],
  ["关于我们", "/app-space"],
  ["更新说明", "/updates"],
  ["价格与套餐", "/pricing"],
];
const footerAccount = [
  ["个人中心", "/profile"],
  ["AI 助手", "/assistant"],
];
const FOOTER_DESC =
  "一站式 AI 图像生产工作台。从模型选择到高清交付，把创作链路收进同一条可追踪流程。";

function CapabilityLoop() {
  return (
    <div className="capability-loop" role="region" aria-label="创作能力">
      <div className="capability-loop__track">
        {[1, 2].map((copy) => (
          <ul key={copy} aria-hidden={copy === 2 ? "true" : undefined}>
            {capabilityItems.map(([cover, label, detail]) => (
              <li key={`${copy}-${label}`}>
                <img src={cover} alt="" width="36" height="36" />
                <span>{label}</span>
                <small>{detail}</small>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

function IntroMediaFlip() {
  const rootRef = useRef(null);
  const curtainRef = useRef(null);
  const baseRef = useRef(null);
  const fillRef = useRef(null);
  const indexRef = useRef(0);
  useGSAP(
    (context, contextSafe) => {
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("settings-no-animations")
      )
        return undefined;
      let timer = 0;
      const run = contextSafe(() => {
        gsap.to(curtainRef.current, {
          width: 0,
          duration: 1.2,
          ease: "power3.inOut",
          onComplete: contextSafe(() => {
            indexRef.current = (indexRef.current + 1) % introSlides.length;
            fillRef.current.style.backgroundImage = `url("${introSlides[indexRef.current]}")`;
            baseRef.current.style.backgroundImage = `url("${introSlides[(indexRef.current + 1) % introSlides.length]}")`;
            gsap.set(curtainRef.current, { width: "100%" });
            timer = window.setTimeout(run, 4200);
          }),
        });
      });
      timer = window.setTimeout(run, 4200);
      return () => window.clearTimeout(timer);
    },
    { scope: rootRef },
  );
  return (
    <div
      ref={rootRef}
      className="commercial-intro-grid"
      style={{ "--intro-media-width": "100%" }}
      aria-hidden="true"
    >
      <div
        ref={baseRef}
        className="commercial-intro-grid__base"
        style={{ backgroundImage: `url("${introSlides[1]}")` }}
      />
      <div
        ref={curtainRef}
        className="commercial-intro-grid__curtain"
        style={{ width: "100%" }}
      >
        <div
          ref={fillRef}
          className="commercial-intro-grid__curtain-fill"
          style={{ backgroundImage: `url("${introSlides[0]}")` }}
        />
      </div>
    </div>
  );
}

const HERO_TYPE_LINES = [
  "从一句描述，到可交付图像",
  "让模型、进度与结果保持连续",
  "一个入口，连接完整创作链",
];
const HERO_SUMMARY =
  "AI 助手、文生图、无限画布、插画染色、UI 设计稿、模型设计、游戏美术与 AI 电商，由统一模型目录、任务系统和高清交付链路连接。";
const HERO_TYPE_SR = "从想法到可交付图像的 AI 创作工作流";

function TypeLine() {
  const rootRef = useRef(null);
  const { t } = useLocale();
  const texts = useMemo(() => HERO_TYPE_LINES.map((line) => t(line)), [t]);
  const [text, setText] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? texts[0]
      : "",
  );
  const reduced =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations");
  useEffect(() => {
    if (reduced) {
      setText(texts[0]);
      return undefined;
    }
    let timer = 0;
    let index = 0;
    let deleting = false;
    let value = "";
    let disposed = false;
    const step = () => {
      if (disposed) return;
      const current = texts[index];
      if (deleting) {
        value = value.slice(0, -1);
        setText(value);
        if (!value) {
          deleting = false;
          index = (index + 1) % texts.length;
          timer = window.setTimeout(step, 250);
        } else timer = window.setTimeout(step, 29);
        return;
      }
      value = current.slice(0, value.length + 1);
      setText(value);
      if (value.length === current.length) {
        deleting = true;
        timer = window.setTimeout(step, 1750);
      } else timer = window.setTimeout(step, 54 + Math.random() * 14);
    };
    timer = window.setTimeout(step, 880);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [reduced, texts]);
  return (
    <span ref={rootRef} className="type-line">
      <span className="sr-only">{t(HERO_TYPE_SR)}</span>
      <span aria-hidden="true">
        {text}
        {!reduced && <i />}
      </span>
    </span>
  );
}

function StrandsBand() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !container || !context) return undefined;
    const draw = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.3);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "lighter";
      const colors = ["#6ff7d2", "#5fb8ff", "#ff6b78", "#ffd45f", "#f7f7f2"];
      const centerY = height * 0.515;
      const step = Math.max(4, width / 150);
      for (let strand = 0; strand < 5; strand += 1) {
        const color = colors[strand];
        const phase = strand * 1.19;
        const frequency = 0.006 + strand * 0.0007;
        const amplitude = height * (0.052 + strand * 0.0055);
        const offset = (strand - 2) * 14;
        const trace = () => {
          context.beginPath();
          for (let x = -step; x <= width + step; x += step) {
            const envelope = Math.sin(
              Math.min(1, Math.max(0, x / width)) * Math.PI,
            );
            const wave =
              Math.sin(x * frequency + phase) * 0.66 +
              Math.sin(x * frequency * 1.8 + phase * 0.7) * 0.34;
            const y = centerY + offset + wave * amplitude * envelope;
            if (x <= 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
        };
        trace();
        context.strokeStyle = color;
        context.globalAlpha = 0.09;
        context.lineWidth = 10;
        context.shadowBlur = 16;
        context.shadowColor = color;
        context.stroke();
        trace();
        context.globalAlpha = 0.66;
        context.lineWidth = 1.15;
        context.shadowBlur = 5;
        context.stroke();
      }
      context.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="strands-band" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function CommercialHomeView() {
  const { locale, t } = useLocale();
  const { user } = useAuth();
  const { controls, isEntryVisible } = usePageControls();
  const heroEnabled = useHomeHeroEnabled();

  const workflowTitle = t(floatTitle);
  const workflowNarrative = t(narrative);
  const narrativeWords = useMemo(
    () => splitNarrative(workflowNarrative, locale),
    [locale, workflowNarrative],
  );
  const visibleStudioEntries = useMemo(
    () => studioEntries.filter((entry) => isEntryVisible(entry.to)),
    [isEntryVisible],
  );
  const visibleCommerceGroups = useMemo(
    () =>
      COMMERCE_ENTRY_GROUPS.map((group) => {
        const ids = group.ids.filter((id) =>
          isEntryVisible(`ecommerce.${id}`),
        );
        return ids.length
          ? { ...group, ids, to: `/ecommerce-design?tool=${ids[0]}` }
          : null;
      }).filter(Boolean),
    [controls, isEntryVisible],
  );
  const primaryCta = user
    ? {
        to: isEntryVisible("/text-to-image")
          ? "/text-to-image"
          : isEntryVisible("/studio")
            ? "/studio"
            : "/",
        label: locale === "en" ? "START" : t("开始创作"),
      }
    : { to: "/auth", label: locale === "en" ? "START" : t("登录开始创作") };
  return (
    <div className="commercial-home">
      {heroEnabled && (
        <section
          className="commercial-hero"
          aria-labelledby="commercial-home-title"
        >
          <Suspense fallback={null}>
            <GradientBlindsHero gradientColors={heroGradientColors} />
          </Suspense>
          <div className="commercial-hero__noise" aria-hidden="true" />
          <div className="commercial-shell commercial-hero__layout">
            <div className="commercial-hero__copy">
              <h1 id="commercial-home-title" data-commercial-hero="title">
                星空云绘
              </h1>
              <div data-commercial-hero="copy" className="commercial-hero__typed">
                <TypeLine />
              </div>
              <p data-commercial-hero="copy" className="commercial-hero__summary">
                {t(HERO_SUMMARY)}
              </p>
              <div
                data-commercial-hero="actions"
                className="commercial-hero__actions"
              >
                <Link
                  className="commercial-button commercial-button--hero-cta"
                  to={primaryCta.to}
                >
                  <span>{primaryCta.label}</span>
                  <span className="commercial-button__arrow" aria-hidden="true">
                    <i className="bi bi-arrow-up-right" />
                  </span>
                </Link>
              </div>
            </div>
          </div>
          <a
            className="commercial-hero__scroll"
            href="#creative-workflow"
            aria-label="继续浏览创作工作流"
          >
            <span>SCROLL</span>
            <i className="bi bi-arrow-down" aria-hidden="true" />
          </a>
          <section className="commercial-capabilities" aria-label="平台能力">
            <CapabilityLoop />
          </section>
        </section>
      )}

      <section
        id="creative-workflow"
        className="commercial-intro commercial-band"
      >
        <div className="commercial-shell commercial-intro__layout">
          <div className="commercial-intro__copy">
            <h2
              data-commercial-float
              className={`commercial-float-title${locale === "en" ? " is-en" : ""}`}
              aria-label={workflowTitle}
            >
              {[...workflowTitle].map((char, index) => (
                <span
                  key={`${char}-${index}`}
                  data-commercial-float-char
                  aria-hidden="true"
                >
                  {char === " " ? "\u00a0" : char}
                </span>
              ))}
            </h2>
            <p
              data-commercial-narrative
              className="commercial-intro__narrative"
            >
              {narrativeWords.map((word, index) => (
                <span key={`${word}-${index}`} data-commercial-word>
                  {word}
                </span>
              ))}
            </p>
          </div>
          <div className="commercial-intro__media" data-commercial-reveal>
            <IntroMediaFlip />
          </div>
        </div>
      </section>

      <section
        id="creative-modules"
        className="commercial-studios commercial-band"
        aria-labelledby="studios-title"
      >
        <div className="commercial-shell">
          <header className="commercial-section-head">
            <div>
              <span>STUDIOS</span>
              <h2 id="studios-title">{t("创作模块")}</h2>
            </div>
            <p>{t("按目标进入对应工作台，覆盖对话、生图、画布与电商。")}</p>
          </header>
          <div className="commercial-studio-grid">
            {visibleStudioEntries.map((entry) => (
              <Link
                key={entry.id}
                to={entry.to}
                className={`commercial-studio tone-${entry.tone}`}
              >
                <div className="commercial-studio__media">
                  <img
                    src={entry.cover}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="commercial-studio__body">
                  <div className="commercial-studio__meta">
                    <span className="commercial-studio__index">{entry.index}</span>
                    <i className={entry.icon} aria-hidden="true" />
                    <small>{entry.english}</small>
                    <i
                      className="bi bi-arrow-up-right commercial-studio__arrow"
                      aria-hidden="true"
                    />
                  </div>
                  <h3>{t(entry.title)}</h3>
                  <p>{t(entry.description)}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className="commercial-commerce">
            <header className="commercial-commerce__head">
              <div>
                <span>COMMERCE</span>
                <h3>{t("电商工作流")}</h3>
              </div>
              <p>{t("服饰模特、商品设计与图片处理，按业务分开进入。")}</p>
            </header>
            <div className="commercial-commerce-grid">
              {visibleCommerceGroups.map((group) => (
                <Link
                  key={group.id}
                  to={group.to}
                  className={`commercial-commerce-card is-${group.id}`}
                >
                  <img
                    src={group.cover}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="commercial-commerce-card__copy">
                    <strong>{t(group.label)}</strong>
                    <small>{t(group.description)}</small>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        className="commercial-process commercial-band"
        aria-labelledby="process-title"
      >
        <StrandsBand />
        <div className="commercial-process__shade" aria-hidden="true" />
        <div className="commercial-shell commercial-process__content">
          <header className="commercial-process__head" data-commercial-reveal>
            <h2 id="process-title">{t("每一次生成，都能被看见、继续和交付")}</h2>
            <p>{t("任务状态、生成结果与版本路径保持连续，不再让等待打断创作。")}</p>
          </header>
          <ol className="commercial-process__steps">
            {processSteps.map(([index, icon, title, description, tone]) => (
              <li
                key={index}
                className={`commercial-glass tone-${tone}`}
                data-commercial-reveal
              >
                <span>{index}</span>
                <i className={icon} aria-hidden="true" />
                <h3>{t(title)}</h3>
                <p>{t(description)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="commercial-final commercial-band"
        aria-labelledby="final-title"
      >
        <div className="commercial-shell commercial-final__layout">
          <header className="commercial-final__head" data-commercial-reveal>
            <h2 id="final-title">{t("三步开始使用")}</h2>
            <p>{t("登录、选工作室、生成交付——把想法推进到成品。")}</p>
          </header>
          <ol className="commercial-final__steps" data-commercial-reveal>
            {usageSteps.map(([index, icon, title, description]) => (
              <li key={index} className="commercial-final__step">
                <span
                  className="commercial-final__step-index"
                  aria-hidden="true"
                >
                  {index}
                </span>
                <div className="commercial-final__step-body">
                  <strong>
                    <i className={icon} aria-hidden="true" /> {t(title)}
                  </strong>
                  <p>{t(description)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="commercial-final__actions" data-commercial-reveal>
            <Link
              className="commercial-button commercial-button--primary"
              to={primaryCta.to}
            >
              <span>{primaryCta.label}</span>
              <i className="bi bi-arrow-up-right" aria-hidden="true" />
            </Link>
            {isEntryVisible("/pricing") && (
              <Link
                className="commercial-button commercial-button--ghost"
                to="/pricing"
              >
                <span>{t("查看积分价格")}</span>
                <i className="bi bi-arrow-right" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </section>

      <footer className="commercial-footer">
        <div className="commercial-shell">
          <div className="commercial-footer__top">
            <section
              className="commercial-footer__brand-block"
              aria-label={t("品牌")}
            >
              <Link
                className="commercial-footer__brand"
                to="/"
                aria-label={t("星空云绘首页")}
              >
                <img
                  src="/brand/starcloud-logo.svg"
                  alt=""
                  width="36"
                  height="36"
                />
                <span>
                  <strong>{t("星空云绘")}</strong>
                  <small>StarCloudIsAI</small>
                </span>
              </Link>
              <p className="commercial-footer__desc">{t(FOOTER_DESC)}</p>
              <Link className="commercial-footer__cta" to={primaryCta.to}>
                <span>{primaryCta.label}</span>
                <i className="bi bi-arrow-up-right" aria-hidden="true" />
              </Link>
            </section>
            <nav className="commercial-footer__columns" aria-label={t("站点地图")}>
              <section className="commercial-footer__col">
                <h2>{t("创作")}</h2>
                <ul>
                  {visibleStudioEntries.map((entry) => (
                    <li key={entry.id}>
                      <Link to={entry.to}>{t(entry.title)}</Link>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="commercial-footer__col">
                <h2>{t("发现")}</h2>
                <ul>
                  {footerDiscover
                    .filter(([, to]) => isEntryVisible(to))
                    .map(([label, to]) => (
                    <li key={to}>
                      <Link to={to}>{t(label)}</Link>
                    </li>
                    ))}
                </ul>
              </section>
              <section className="commercial-footer__col">
                <h2>{t("支持")}</h2>
                <ul>
                  {footerAccount.map(([label, to]) => (
                    <li key={to}>
                      <Link to={to}>{t(label)}</Link>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className="commercial-footer__text-btn"
                    >
                      {t("问题反馈")}
                    </button>
                  </li>
                </ul>
              </section>
            </nav>
          </div>
          <div className="commercial-footer__bottom">
            <div className="commercial-footer__legal">
              <span>© {new Date().getFullYear()} StarCloudIsAI</span>
              <span className="commercial-footer__dot" aria-hidden="true" />
              <span>All rights reserved</span>
            </div>
            <button type="button" className="commercial-footer__text-btn">
              {t("反馈")}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
