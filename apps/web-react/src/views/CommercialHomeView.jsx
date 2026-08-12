import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ProgressiveImage } from "../components/ProgressiveImage.jsx";
import { GradientBlindsHero } from "../components/GradientBlindsHero.jsx";
import "@legacy/features/home-commercial/commercial-home.css";
import "@react/legacy-styles/generated/features/home-commercial/components/CapabilityLoop.css";
import "@react/legacy-styles/generated/features/home-commercial/components/CardSwapGallery.css";
import "@react/legacy-styles/generated/features/home-commercial/components/FlowingMenu.css";
import "@react/legacy-styles/generated/features/home-commercial/components/GradientBlindsHero.css";
import "@react/legacy-styles/generated/features/home-commercial/components/StrandsBand.css";
import "@react/legacy-styles/generated/features/home-commercial/components/TypeLine.css";
import "./commercial-home-react.css";

gsap.registerPlugin(useGSAP);

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
    cover:
      "/sucai/ai-wallpaper-server-459defa9-9acc-4f92-8d1b-9a6b8e96fdec-1.webp",
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
    cover:
      "/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.webp",
  },
  {
    id: "illustration-coloring",
    to: "/ai-illustration-coloring",
    icon: "bi bi-brush",
    index: "03",
    title: "插画染色",
    english: "Coloring",
    description: "保留线稿结构，重建颜色、材质与完整光影。",
    tone: "coral",
    taskType: "coloring",
    cover: "/sucai/game-character-1785420185589.webp",
  },
  {
    id: "ui-design",
    to: "/design-workshop",
    icon: "bi bi-bezier2",
    index: "04",
    title: "UI 设计稿",
    english: "UI design",
    description: "分析整张设计图，定位元素并衔接素材与前端还原。",
    tone: "yellow",
    taskType: "ui_design",
    cover: "/sucai/ui-design-1785420316960.webp",
  },
  {
    id: "model-sheet",
    to: "/model-sheet",
    icon: "bi bi-person-bounding-box",
    index: "05",
    title: "模型设计",
    english: "Model design",
    description: "生成清晰、统一的多视角角色与模型参考。",
    tone: "violet",
    taskType: "model_sheet",
    cover: "/sucai/ultra-model-sheet-board-1785420340076.webp",
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
    cover: "",
  },
  {
    id: "game-art",
    to: "/game-art",
    icon: "bi bi-controller",
    index: "07",
    title: "游戏设计",
    english: "Game art",
    description: "从角色、场景、道具到图标，组织完整游戏资产流程。",
    tone: "green",
    taskType: "game_art",
    cover: "/sucai/game-ui-1785420083438.webp",
  },
];

const capabilityItems = [
  ["bi bi-cpu", "多模型目录", "按任务自由选择"],
  ["bi bi-lightning-charge", "快速生成", "快速模型通道"],
  ["bi bi-badge-hd", "2K / 4K", "支持高清输出"],
  ["bi bi-aspect-ratio", "多种比例", "适配不同场景"],
  ["bi bi-layers", "参考图工作流", "保持视觉一致性"],
  ["bi bi-broadcast-pin", "任务状态回传", "结果逐张返回"],
  ["bi bi-coin", "积分透明计费", "标准价与折扣价"],
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
const narrativeWords = narrative.split(/(\s+|(?<=[，。]))/u).filter(Boolean);
const floatTitle = "一套工作流，覆盖整条创作链";
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

async function apiGet(path, signal) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true)
    throw new Error(payload?.error || "请求失败");
  return payload.data;
}

function formatPoints(points) {
  return `${Math.round(Number(points || 0)).toLocaleString("zh-CN")} 积分`;
}

function CapabilityLoop() {
  return (
    <div className="capability-loop" role="region" aria-label="创作能力">
      <div className="capability-loop__track">
        {[1, 2].map((copy) => (
          <ul key={copy} aria-hidden={copy === 2 ? "true" : undefined}>
            {capabilityItems.map(([icon, label, detail]) => (
              <li key={`${copy}-${label}`}>
                <i className={icon} aria-hidden="true" />
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

function CardSwapGallery({ items }) {
  const rootRef = useRef(null);
  const orderRef = useRef([]);
  useGSAP(
    (context, contextSafe) => {
      const cards = [...rootRef.current.querySelectorAll("[data-swap-card]")];
      orderRef.current = cards.map((_, index) => index);
      cards.forEach((card, index) =>
        gsap.set(card, {
          width: 800,
          height: 450,
          x: index * 55,
          y: -index * 120,
          z: -index * 82.5,
          xPercent: -50,
          yPercent: -50,
          zIndex: cards.length - index,
          transformOrigin: "center center",
          force3D: true,
        }),
      );
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("settings-no-animations") ||
        cards.length < 2
      )
        return undefined;
      let timeline = null;
      const swap = contextSafe(() => {
        const [front, ...rest] = orderRef.current;
        const frontCard = cards[front];
        timeline?.kill();
        timeline = gsap.timeline();
        timeline
          .to(frontCard, {
            y: "+=500",
            duration: 2,
            ease: "elastic.out(0.6,0.9)",
          })
          .addLabel("promote", "-=1.8");
        rest.forEach((cardIndex, index) =>
          timeline.to(
            cards[cardIndex],
            {
              x: index * 55,
              y: -index * 120,
              z: -index * 82.5,
              zIndex: cards.length - index,
              duration: 2,
              ease: "elastic.out(0.6,0.9)",
            },
            `promote+=${index * 0.15}`,
          ),
        );
        timeline
          .to(
            frontCard,
            {
              x: (cards.length - 1) * 55,
              y: -(cards.length - 1) * 120,
              z: -(cards.length - 1) * 82.5,
              zIndex: 1,
              duration: 2,
              ease: "elastic.out(0.6,0.9)",
            },
            "promote+=0.1",
          )
          .call(() => {
            orderRef.current = [...rest, front];
          });
      });
      const interval = window.setInterval(swap, 3000);
      return () => {
        window.clearInterval(interval);
        timeline?.kill();
      };
    },
    { scope: rootRef, dependencies: [items], revertOnUpdate: true },
  );
  return (
    <div
      ref={rootRef}
      className="card-swap-gallery"
      role="region"
      aria-roledescription="carousel"
      aria-label="创作工作台预览"
      style={{ width: "800px", height: "450px" }}
    >
      {items.slice(0, 4).map((item, index) => (
        <article
          key={item.id}
          data-swap-card
          className={`swap-art-card tone-${item.tone || "mint"}${index === 0 ? " is-front" : ""}`}
          aria-hidden={index === 0 ? undefined : "true"}
          style={{
            width: "800px",
            height: "450px",
            zIndex: 4 - index,
            transform: `translate(-50%, -50%) translate3d(${index * 55}px, ${-index * 120}px, ${-index * 82.5}px)`,
          }}
        >
          <div className="swap-art-card__windowbar">
            <i className={item.icon || "bi bi-stars"} aria-hidden="true" />
            <strong>{item.title || "AI 图像创作"}</strong>
          </div>
          {item.cover ? (
            <ProgressiveImage
              className="swap-art-card__media"
              src={item.cover}
              alt={item.title || "AI 生成作品"}
              eager={index === 0}
            />
          ) : (
            <div className="swap-art-card__placeholder" aria-hidden="true">
              <span className="swap-art-card__fluid swap-art-card__fluid--one" />
              <span className="swap-art-card__fluid swap-art-card__fluid--two" />
              <span className="swap-art-card__fluid swap-art-card__fluid--three" />
              <span className="swap-art-card__orb">
                {item.index || String(index + 1).padStart(2, "0")}
              </span>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function FlowingMenu({ items }) {
  const rootRef = useRef(null);
  const { contextSafe } = useGSAP(
    () => {
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("settings-no-animations")
      )
        return;
      rootRef.current
        .querySelectorAll(".flowing-menu__marquee-inner")
        .forEach((inner) => {
          const width =
            inner.querySelector(".flowing-menu__part")?.offsetWidth || 1;
          gsap.to(inner, { x: -width, duration: 15, ease: "none", repeat: -1 });
        });
    },
    { scope: rootRef, dependencies: [items], revertOnUpdate: true },
  );
  const findEdge = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return (x - rect.width / 2) ** 2 + y ** 2 <
      (x - rect.width / 2) ** 2 + (y - rect.height) ** 2
      ? "top"
      : "bottom";
  };
  const enter = contextSafe((event) => {
    const marquee = event.currentTarget.querySelector(".flowing-menu__marquee");
    const inner = event.currentTarget.querySelector(
      ".flowing-menu__marquee-inner",
    );
    const edge = findEdge(event);
    gsap
      .timeline({ defaults: { duration: 0.6, ease: "expo" } })
      .set(marquee, { y: edge === "top" ? "-101%" : "101%" })
      .set(inner, { y: edge === "top" ? "101%" : "-101%" }, 0)
      .to([marquee, inner], { y: "0%" }, 0);
  });
  const leave = contextSafe((event) => {
    const marquee = event.currentTarget.querySelector(".flowing-menu__marquee");
    const inner = event.currentTarget.querySelector(
      ".flowing-menu__marquee-inner",
    );
    const edge = findEdge(event);
    gsap
      .timeline({ defaults: { duration: 0.6, ease: "expo" } })
      .to(marquee, { y: edge === "top" ? "-101%" : "101%" })
      .to(inner, { y: edge === "top" ? "101%" : "-101%" }, 0);
  });
  return (
    <div
      ref={rootRef}
      className="flowing-menu"
      style={{ backgroundColor: "#111111" }}
    >
      <nav className="flowing-menu__nav" aria-label="创作入口">
        {items.map((item, index) => (
          <div
            key={item.text}
            className="flowing-menu__item"
            style={{ borderTop: index === 0 ? "none" : "1px solid #ffffff" }}
            onMouseEnter={enter}
            onMouseLeave={leave}
          >
            <Link
              className="flowing-menu__link"
              to={item.link}
              style={{ color: "#ffffff" }}
            >
              {item.text}
            </Link>
            <div
              className="flowing-menu__marquee"
              style={{ backgroundColor: "#ffffff" }}
            >
              <div className="flowing-menu__marquee-inner">
                {[1, 2, 3, 4].map((copy) => (
                  <div key={copy} className="flowing-menu__part">
                    <span
                      className="flowing-menu__label"
                      style={{ color: "#111111" }}
                    >
                      {item.text}
                    </span>
                    <div
                      className="flowing-menu__thumb"
                      style={{ backgroundImage: `url(${item.image})` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </nav>
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

function TypeLine() {
  const rootRef = useRef(null);
  const texts = [
    "从一句描述，到可交付图像",
    "让模型、进度与结果保持连续",
    "一个入口，连接完整创作链",
  ];
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
  }, [reduced]);
  return (
    <span ref={rootRef} className="type-line">
      <span className="sr-only">从想法到可交付图像的 AI 创作工作流</span>
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
  const [taskPrices, setTaskPrices] = useState({});
  const [user, setUser] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      apiGet("/pricing", controller.signal),
      apiGet("/auth/session", controller.signal),
    ]).then(([pricing, session]) => {
      if (controller.signal.aborted) return;
      setTaskPrices(
        pricing.status === "fulfilled"
          ? pricing.value?.taskPointPrices || pricing.value?.taskPrices || {}
          : {},
      );
      setUser(
        session.status === "fulfilled" ? session.value?.user || null : null,
      );
    });
    return () => controller.abort();
  }, []);

  const primaryCta = user
    ? { to: "/text-to-image", label: "开始创作" }
    : { to: "/auth", label: "登录开始创作" };
  const heroArtworks = useMemo(
    () => studioEntries.filter((entry) => entry.cover).slice(0, 4),
    [],
  );
  const showcaseArtworks = useMemo(
    () =>
      studioEntries.map((entry) => {
        if (!entry.taskType)
          return {
            ...entry,
            priceAmount: entry.priceHint || "按用量计费",
            priceSuffix: "",
          };
        const points = Number(taskPrices[entry.taskType]);
        return Number.isFinite(points) && points > 0
          ? {
              ...entry,
              priceAmount: formatPoints(points),
              priceSuffix: "/ 张起",
            }
          : { ...entry, priceAmount: "价格待定", priceSuffix: "" };
      }),
    [taskPrices],
  );
  const fallbacks = [
    "/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.webp",
    "/sucai/ai-wallpaper-server-459defa9-9acc-4f92-8d1b-9a6b8e96fdec-1.webp",
    "/sucai/ui-design-1785420323803.webp",
    "/sucai/game-character-1785420168113.webp",
  ];
  const flowingItems = useMemo(
    () =>
      studioEntries.map((entry, index) => ({
        link: entry.to,
        text: entry.title,
        image: entry.cover || fallbacks[index % fallbacks.length],
      })),
    [],
  );

  return (
    <div className="commercial-home">
      <section
        className="commercial-hero"
        aria-labelledby="commercial-home-title"
      >
        <GradientBlindsHero gradientColors={heroGradientColors} />
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
              AI 助手、文生图、插画染色、UI
              设计稿、模型设计与游戏美术，由统一模型目录、任务系统和高清交付链路连接。
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
            <dl data-commercial-hero="proof" className="commercial-hero__proof">
              <div>
                <dt>多模型</dt>
                <dd>按任务选择</dd>
              </div>
              <div>
                <dt>2K / 4K</dt>
                <dd>支持高清输出</dd>
              </div>
              <div>
                <dt>持续回传</dt>
                <dd>任务状态可见</dd>
              </div>
            </dl>
          </div>
          <div
            data-commercial-hero="gallery"
            className="commercial-hero__gallery"
          >
            <CardSwapGallery items={heroArtworks} />
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

      <section
        id="creative-workflow"
        className="commercial-intro commercial-band"
      >
        <div className="commercial-shell commercial-intro__layout">
          <div className="commercial-intro__copy">
            <h2
              data-commercial-float
              className="commercial-float-title"
              aria-label={floatTitle}
            >
              {[...floatTitle].map((char, index) => (
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
        id="flowing-menu"
        className="commercial-flowing commercial-band"
        aria-label="创作入口菜单"
      >
        <FlowingMenu items={flowingItems} />
      </section>

      <section
        className="commercial-process commercial-band"
        aria-labelledby="process-title"
      >
        <StrandsBand />
        <div className="commercial-process__shade" aria-hidden="true" />
        <div className="commercial-shell commercial-process__content">
          <header className="commercial-process__head" data-commercial-reveal>
            <h2 id="process-title">每一次生成，都能被看见、继续和交付</h2>
            <p>任务状态、生成结果与版本路径保持连续，不再让等待打断创作。</p>
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
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="commercial-gallery commercial-band"
        data-commercial-gallery-section
        aria-labelledby="showcase-title"
      >
        <div className="commercial-shell">
          <header className="commercial-section-head" data-commercial-reveal>
            <div>
              <h2 id="showcase-title">不同场景，各自保持完整语境</h2>
            </div>
            <p>从交互到最终画面，为不同创作目标保留清晰、独立的视觉语境。</p>
          </header>
          <div
            data-commercial-parallax="gallery"
            className="commercial-gallery__grid"
          >
            {showcaseArtworks.map((item) => (
              <Link key={item.id} to={item.to} className="commercial-artwork">
                {item.cover ? (
                  <div className="commercial-artwork__media">
                    <img
                      src={item.cover}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ) : (
                  <div
                    className="commercial-artwork__placeholder"
                    aria-hidden="true"
                  >
                    <span>{item.english}</span>
                    <i className={item.icon} />
                    <small>SC / {item.index}</small>
                  </div>
                )}
                <div className="commercial-artwork__meta">
                  <span>{item.title}</span>
                  <strong>{item.priceAmount}</strong>
                  <small>{item.priceSuffix || "查看详情"}</small>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        className="commercial-final commercial-band"
        aria-labelledby="final-title"
      >
        <div className="commercial-shell commercial-final__layout">
          <header className="commercial-final__head" data-commercial-reveal>
            <h2 id="final-title">三步开始使用</h2>
            <p>登录、选工作室、生成交付——把想法推进到成品。</p>
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
                    <i className={icon} aria-hidden="true" /> {title}
                  </strong>
                  <p>{description}</p>
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
            <Link
              className="commercial-button commercial-button--ghost"
              to="/pricing"
            >
              <span>查看积分价格</span>
              <i className="bi bi-arrow-right" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="commercial-footer">
        <div className="commercial-shell">
          <div className="commercial-footer__top">
            <section
              className="commercial-footer__brand-block"
              aria-label="品牌"
            >
              <Link
                className="commercial-footer__brand"
                to="/"
                aria-label="星空云绘首页"
              >
                <img
                  src="/brand/starcloud-logo.svg"
                  alt=""
                  width="36"
                  height="36"
                />
                <span>
                  <strong>星空云绘</strong>
                  <small>StarCloudIsAI</small>
                </span>
              </Link>
              <p className="commercial-footer__desc">
                一站式 AI
                图像生产工作台。从模型选择到高清交付，把创作链路收进同一条可追踪流程。
              </p>
              <Link className="commercial-footer__cta" to={primaryCta.to}>
                <span>{primaryCta.label}</span>
                <i className="bi bi-arrow-up-right" aria-hidden="true" />
              </Link>
            </section>
            <nav className="commercial-footer__columns" aria-label="站点地图">
              <section className="commercial-footer__col">
                <h2>创作</h2>
                <ul>
                  {studioEntries.map((entry) => (
                    <li key={entry.id}>
                      <Link to={entry.to}>{entry.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="commercial-footer__col">
                <h2>发现</h2>
                <ul>
                  {footerDiscover.map(([label, to]) => (
                    <li key={to}>
                      <Link to={to}>{label}</Link>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="commercial-footer__col">
                <h2>支持</h2>
                <ul>
                  {footerAccount.map(([label, to]) => (
                    <li key={to}>
                      <Link to={to}>{label}</Link>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className="commercial-footer__text-btn"
                    >
                      问题反馈
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
              反馈
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
