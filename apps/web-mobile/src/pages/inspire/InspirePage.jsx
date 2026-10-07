import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, DotLoading, ErrorBlock, SearchBar, Skeleton } from "antd-mobile";
import { ActionSheet } from "@mobile/components/overlay/index.js";
import { SearchOutline, UnorderedListOutline } from "antd-mobile-icons";
import { useAuth } from "@react/auth/AuthContext.jsx";
import { goLogin } from "@mobile/app/login.js";
import { sendToCreate } from "@mobile/app/createInbox.js";
import { PullRefresh } from "@mobile/components/PullRefresh.jsx";
import { PromptCard, estimateCardHeight } from "./PromptCard.jsx";
import { PromptDetailSheet } from "./PromptDetailSheet.jsx";
import { SORT_OPTIONS, usePromptFeed } from "./usePromptFeed.js";
import "./inspire.css";

// 双列瀑布流：按估算高度把新卡片放进较矮的一列；已分好的卡片不再挪动，加载更多时不会跳。
function useWaterfall(items) {
  const placement = useRef(new Map());
  return useMemo(() => {
    const live = new Set(items.map((item) => item.id));
    for (const id of placement.current.keys()) if (!live.has(id)) placement.current.delete(id);
    const columns = [[], []];
    const heights = [0, 0];
    for (const item of items) {
      let column = placement.current.get(item.id);
      if (column === undefined) {
        column = heights[0] <= heights[1] ? 0 : 1;
        placement.current.set(item.id, column);
      }
      columns[column].push(item);
      heights[column] += estimateCardHeight(item);
    }
    return columns;
  }, [items]);
}

function FeedSkeleton() {
  return (
    <div className="m-waterfall">
      {[0, 1].map((column) => (
        <div key={column} className="m-waterfall-col">
          {[0, 1, 2].map((row) => (
            <div key={row} className="m-prompt-card">
              <Skeleton animated className="m-prompt-skeleton" style={{ "--height": `${(column + row) % 2 ? 210 : 160}px` }} />
              <Skeleton.Paragraph lineCount={1} animated />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function InspirePage({ embedded = false }) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const feed = usePromptFeed({ authenticated: isAuthenticated });
  const columns = useWaterfall(feed.items);
  const [selectedId, setSelectedId] = useState("");
  const [searching, setSearching] = useState(false);
  const [keyword, setKeyword] = useState("");
  const sentinelRef = useRef(null);
  const selected = feed.items.find((item) => item.id === selectedId) || null;

  const { loadMore, hasMore, loadingMore } = feed;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !loadingMore) void loadMore();
    }, { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadingMore]);

  const requireLogin = useCallback(() => {
    if (isAuthenticated) return false;
    goLogin();
    return true;
  }, [isAuthenticated]);

  const like = useCallback((item) => {
    if (requireLogin()) return;
    void feed.toggle(item, "like");
  }, [feed, requireLogin]);

  const toggle = useCallback((item, action) => {
    if (requireLogin()) return;
    void feed.toggle(item, action);
  }, [feed, requireLogin]);

  const use = useCallback((item) => {
    feed.markUsed(item);
    sendToCreate({ prompt: item.prompt, source: "inspire", promptId: item.id });
    setSelectedId("");
    navigate("/create");
  }, [feed, navigate]);

  const pickChannel = (key) => {
    if (key === "favorites" && requireLogin()) return;
    window.scrollTo({ top: 0 });
    feed.setChannel(key);
  };

  const openSort = () => {
    ActionSheet.show({
      closeOnAction: true,
      cancelText: "取消",
      actions: SORT_OPTIONS.map((option) => ({
        key: option.key,
        text: option.key === feed.sort ? `✓ ${option.label}` : option.label,
        onClick: () => feed.setSort(option.key),
      })),
    });
  };

  const sortable = feed.channel !== "today";

  let body;
  if (feed.loading && !feed.items.length) {
    body = <FeedSkeleton />;
  } else if (feed.error && !feed.items.length) {
    body = (
      <ErrorBlock status="disconnected" title="灵感加载失败" description={feed.error}>
        <Button color="primary" shape="rounded" onClick={feed.refresh}>重试</Button>
      </ErrorBlock>
    );
  } else if (!feed.items.length) {
    body = (
      <ErrorBlock
        status="empty"
        title={feed.search ? `没有找到“${feed.search}”` : feed.channel === "favorites" ? "还没有收藏" : feed.channel === "today" ? "24 小时内还没有新灵感" : "这里还没有内容"}
        description={feed.search ? "换个关键词试试" : feed.channel === "favorites" ? "看到喜欢的灵感，点星标收藏" : "去“推荐”看看大家都在画什么"}
      />
    );
  } else {
    body = (
      <>
        <div className="m-waterfall">
          {columns.map((column, index) => (
            <div key={index} className="m-waterfall-col">
              {column.map((item) => (
                <PromptCard key={item.id} item={item} onOpen={(entry) => setSelectedId(entry.id)} onLike={like} />
              ))}
            </div>
          ))}
        </div>
        <div ref={sentinelRef} className="m-feed-end">
          {feed.loadingMore ? <DotLoading /> : feed.hasMore ? "" : "到底了"}
        </div>
      </>
    );
  }

  return (
    <div className="m-inspire">
      <header className={`m-inspire-head${embedded ? " is-embedded" : ""}`}>
        {searching ? (
          <SearchBar
            className="m-inspire-search"
            placeholder="搜索提示词"
            value={keyword}
            autoFocus
            showCancelButton={() => true}
            onChange={setKeyword}
            onSearch={(value) => { window.scrollTo({ top: 0 }); feed.setSearch(value.trim()); }}
            onClear={() => feed.setSearch("")}
            onCancel={() => { setSearching(false); setKeyword(""); feed.setSearch(""); }}
          />
        ) : embedded ? (
          <div className="m-inspire-searchrow">
            <button type="button" className="m-inspire-searchbox" onClick={() => setSearching(true)}>
              <SearchOutline />
              <span>{feed.search || "搜索提示词"}</span>
            </button>
            {sortable && (
              <button type="button" className="m-head-btn m-pressable" onClick={openSort}>
                <UnorderedListOutline />
                <span>{SORT_OPTIONS.find((item) => item.key === feed.sort)?.label}</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <h1>灵感</h1>
            <div className="m-inspire-tools">
              {sortable && (
                <button type="button" className="m-head-btn m-pressable" onClick={openSort}>
                  <UnorderedListOutline />
                  <span>{SORT_OPTIONS.find((item) => item.key === feed.sort)?.label}</span>
                </button>
              )}
              <button type="button" className="m-head-btn is-icon m-pressable" aria-label="搜索" onClick={() => setSearching(true)}>
                <SearchOutline />
              </button>
            </div>
          </>
        )}
        <nav className="m-channels" aria-label="灵感分类">
          {feed.channels.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`m-channel${feed.channel === item.key ? " is-on" : ""}`}
              onClick={(event) => {
                event.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
                pickChannel(item.key);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="m-inspire-main">
        <PullRefresh onRefresh={feed.refresh}>{body}</PullRefresh>
      </main>

      <PromptDetailSheet item={selected} onClose={() => setSelectedId("")} onToggle={toggle} onUse={use} />
    </div>
  );
}
