import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { DotLoading, Skeleton } from "antd-mobile";
import { HeartOutline, PictureOutline, StarOutline } from "antd-mobile-icons";
import { useAuth } from "@react/auth/AuthContext.jsx";
import { goLogin } from "@mobile/app/login.js";
import { sendToCreate } from "@mobile/app/createInbox.js";
import { ArrowForwardIcon, SparkleIcon } from "@mobile/components/icons.jsx";
import { PullRefresh } from "@mobile/components/PullRefresh.jsx";
import { PromptDetailSheet } from "../inspire/PromptDetailSheet.jsx";
import { usePromptFeed } from "../inspire/usePromptFeed.js";
import "./home.css";

const InspirePage = lazy(() => import("../inspire/InspirePage.jsx"));

// 与 App 首页相同的三个子 Tab。
const SUB_TABS = [
  { key: "home", label: "首页" },
  { key: "prompts", label: "提示词" },
  { key: "community", label: "社区" },
];

const FEATURED_COUNT = 6;

function HomeComposer({ onCreate, onAssistant }) {
  const [prompt, setPrompt] = useState("");
  return (
    <section className="m-home-composer m-card-surface">
      <textarea
        value={prompt}
        rows={2}
        maxLength={20000}
        placeholder="描述你想创作的画面"
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="m-home-composer-actions">
        <button type="button" className="m-btn-ghost m-pressable" onClick={onAssistant}>
          <SparkleIcon size={18} />
          AI 助手
        </button>
        <button type="button" className="m-btn-primary m-pressable" onClick={() => onCreate(prompt.trim())}>
          <ArrowForwardIcon size={18} />
          文生图
        </button>
      </div>
    </section>
  );
}

function PromptRow({ item, onOpen }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button type="button" className="m-home-prompt m-card-surface m-pressable" onClick={() => onOpen(item)}>
      <span className={`m-home-prompt-cover${loaded ? " is-loaded" : ""}`}>
        {item.coverUrl ? (
          <img
            ref={(node) => { if (node?.complete && node.naturalWidth) setLoaded(true); }}
            src={item.coverUrl}
            alt=""
            loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} />
        ) : (
          <PictureOutline />
        )}
      </span>
      <span className="m-home-prompt-body">
        <strong>{item.title || item.tags?.[0] || "灵感"}</strong>
        <span className="m-home-prompt-text">{item.prompt}</span>
        <span className="m-home-prompt-stats">
          <span><HeartOutline />{item.likeCount || 0}</span>
          <span><StarOutline />{item.favoriteCount || 0}</span>
        </span>
      </span>
    </button>
  );
}

function FeaturedSkeleton() {
  return [0, 1, 2].map((index) => (
    <div key={index} className="m-home-prompt m-card-surface">
      <Skeleton animated className="m-home-prompt-cover" />
      <span className="m-home-prompt-body"><Skeleton.Paragraph lineCount={3} animated /></span>
    </div>
  ));
}

function HomeTab({ onShowAll, onShowCommunity }) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const feed = usePromptFeed({ authenticated: isAuthenticated });
  const [selectedId, setSelectedId] = useState("");
  const featured = feed.items.slice(0, FEATURED_COUNT);
  const selected = featured.find((item) => item.id === selectedId) || null;

  const create = (prompt) => {
    if (prompt) sendToCreate({ prompt, source: "home" });
    navigate("/create");
  };

  const toggle = useCallback((item, action) => {
    if (!isAuthenticated) {
      goLogin();
      return;
    }
    void feed.toggle(item, action);
  }, [feed, isAuthenticated]);

  const use = (item) => {
    feed.markUsed(item);
    sendToCreate({ prompt: item.prompt, source: "home", promptId: item.id });
    setSelectedId("");
    navigate("/create");
  };

  let list;
  if (feed.loading && !feed.items.length) list = <FeaturedSkeleton />;
  else if (feed.error && !feed.items.length) {
    list = (
      <div className="m-home-inline-error">
        <span>创作灵感加载失败</span>
        <button type="button" className="m-btn-ghost m-pressable" onClick={feed.refresh}>重试</button>
      </div>
    );
  } else list = featured.map((item) => <PromptRow key={item.id} item={item} onOpen={(entry) => setSelectedId(entry.id)} />);

  return (
    <PullRefresh onRefresh={feed.refresh}>
      <div className="m-home-body">
        <HomeComposer onCreate={create} onAssistant={() => navigate("/assistant")} />
        <div className="m-section-title">
          <h2>灵感精选</h2>
          <button type="button" className="m-pressable" onClick={onShowAll}>全部</button>
        </div>
        <div className="m-home-prompts">{list}</div>
        <button type="button" className="m-btn-ghost m-home-community-link m-pressable" onClick={onShowCommunity}>
          浏览社区作品
        </button>
      </div>
      <PromptDetailSheet item={selected} onClose={() => setSelectedId("")} onToggle={toggle} onUse={use} />
    </PullRefresh>
  );
}

function CommunityTab() {
  return (
    <div className="m-home-body m-home-soon">
      <strong>社区作品</strong>
      <span>手机版正在制作中，先用电脑版逛逛大家的作品</span>
      <button type="button" className="m-btn-primary m-pressable" onClick={() => window.location.assign("/share")}>
        打开电脑版社区
      </button>
    </div>
  );
}

function SubFallback() {
  return <div className="m-home-sub-fallback"><DotLoading color="primary" /></div>;
}

export default function HomePage({ active }) {
  const [params, setParams] = useSearchParams();
  const current = SUB_TABS.some((tab) => tab.key === params.get("tab")) ? params.get("tab") : "home";
  const [opened, setOpened] = useState(() => new Set([current]));
  const scrolls = useRef(new Map());
  const previous = useRef(current);

  // 每个子 Tab 记住自己的滚动位置。
  useLayoutEffect(() => {
    if (previous.current === current) return;
    previous.current = current;
    window.scrollTo(0, scrolls.current.get(current) || 0);
  }, [current]);

  const select = (key) => {
    if (key === current) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrolls.current.set(current, window.scrollY);
    setOpened((set) => (set.has(key) ? set : new Set(set).add(key)));
    setParams(key === "home" ? {} : { tab: key }, { replace: true });
  };

  const index = SUB_TABS.findIndex((tab) => tab.key === current);
  return (
    <div className="m-home">
      <header className="m-home-head">
        <div className="m-home-brand">
          <span className="m-home-logo"><img src={`${import.meta.env.BASE_URL}brand/brand_mark.svg`} alt="" /></span>
          <h1>星空云绘</h1>
        </div>
        <nav className="m-home-tabs" style={{ "--m-sub-index": index }} aria-label="首页分区">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`m-home-tab${tab.key === current ? " is-on" : ""}`}
              aria-current={tab.key === current ? "page" : undefined}
              onClick={() => select(tab.key)}
            >
              {tab.label}
            </button>
          ))}
          <span className="m-home-tab-indicator" aria-hidden="true" />
        </nav>
      </header>

      <div hidden={current !== "home"}>
        {(opened.has("home") || current === "home") && (
          <HomeTab onShowAll={() => select("prompts")} onShowCommunity={() => select("community")} />
        )}
      </div>
      <div hidden={current !== "prompts"}>
        {(opened.has("prompts") || current === "prompts") && (
          <Suspense fallback={<SubFallback />}>
            <InspirePage embedded active={active && current === "prompts"} />
          </Suspense>
        )}
      </div>
      <div hidden={current !== "community"}>
        {current === "community" && <CommunityTab />}
      </div>
    </div>
  );
}
