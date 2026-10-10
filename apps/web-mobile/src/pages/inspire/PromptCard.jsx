import { memo, useState } from "react";
import { HeartFill, HeartOutline } from "antd-mobile-icons";


function coverAspect(item) {
  const width = Number(item.coverWidth) || 0;
  const height = Number(item.coverHeight) || 0;
  if (!width || !height) return 1;
  // 极端长图/宽图会撑乱瀑布流，限制在 3:4 ~ 4:3 之外的范围收敛一些。
  return Math.min(1.6, Math.max(0.6, width / height));
}

export function estimateCardHeight(item) {
  return 1 / coverAspect(item) + 0.38;
}

/** 瀑布流卡片：单击看详情，双击封面点赞（带爱心动效）。 */
/** 瀑布流卡片：点一下立刻打开详情（不再为区分双击而等待），心形按钮点赞。 */
export const PromptCard = memo(function PromptCard({ item, onOpen, onLike }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <article className="m-prompt-card">
      <button type="button" className={`m-prompt-cover${loaded ? " is-loaded" : ""}`} style={{ aspectRatio: coverAspect(item) }} onClick={() => onOpen(item)}>
        {item.coverUrl ? (
          <img
            ref={(node) => { if (node?.complete && node.naturalWidth) setLoaded(true); }}
            src={item.coverUrl}
            alt={item.title || "灵感封面"}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <span className="m-prompt-cover-text">{item.prompt}</span>
        )}
      </button>
      <button type="button" className="m-prompt-body" onClick={() => onOpen(item)}>
        <span className="m-prompt-title">{item.prompt || item.title}</span>
      </button>
      <footer className="m-prompt-meta">
        <span className="m-prompt-tag">{item.tags?.[0] || "灵感"}</span>
        <button type="button" className={`m-like${item.liked ? " is-on" : ""}`} aria-pressed={item.liked} onClick={() => onLike(item)}>
          {item.liked ? <HeartFill /> : <HeartOutline />}
          <span>{item.likeCount || ""}</span>
        </button>
      </footer>
    </article>
  );
});
