import { useEffect, useRef, useState } from "react";
import { Button } from "antd-mobile";
import { BottomSheet, Toast } from "@mobile/components/overlay/index.js";
import { FileOutline, HeartFill, HeartOutline, StarFill, StarOutline } from "antd-mobile-icons";

/** 灵感详情：大图 + 完整提示词，主操作“用这个创作”。 */
export function PromptDetailSheet({ item: liveItem, onClose, onToggle, onUse }) {
  // 收起动画期间父组件已清空选中项，继续显示最后一次的内容，避免弹层先变空再滑走。
  const [lastItem, setLastItem] = useState(liveItem);
  useEffect(() => {
    if (liveItem) setLastItem(liveItem);
  }, [liveItem]);
  const item = liveItem || lastItem;
  const lastTap = useRef(0);
  const [burst, setBurst] = useState(0);

  // 详情大图双击点赞（这里单击没有别的动作，所以不会带来点击延迟）。
  const onCoverTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      setBurst((value) => value + 1);
      navigator.vibrate?.(12);
      if (!item.liked) onToggle(item, "like");
      return;
    }
    lastTap.current = now;
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      Toast.show({ content: "提示词已复制" });
    } catch {
      Toast.show({ content: "复制失败，请长按文字手动复制" });
    }
  };

  return (
    <BottomSheet
      visible={Boolean(liveItem)}
      onClose={onClose}
      className="m-prompt-sheet"
      bodyClassName="m-prompt-detail-scroll"
      footer={item && (
        <div className="m-prompt-detail-actions">
          <button type="button" className={`m-round-action${item.liked ? " is-on" : ""}`} onClick={() => onToggle(item, "like")}>
            {item.liked ? <HeartFill /> : <HeartOutline />}
            <small>{item.likeCount || "点赞"}</small>
          </button>
          <button type="button" className={`m-round-action is-fav${item.favorited ? " is-on" : ""}`} onClick={() => onToggle(item, "favorite")}>
            {item.favorited ? <StarFill /> : <StarOutline />}
            <small>{item.favorited ? "已收藏" : "收藏"}</small>
          </button>
          <button type="button" className="m-round-action" onClick={copy}>
            <FileOutline />
            <small>复制</small>
          </button>
          <Button className="m-use-btn" color="primary" shape="rounded" size="large" onClick={() => onUse(item)}>
            用这个创作
          </Button>
        </div>
      )}
    >
      {item && (
        <>
          {item.coverUrl && (
            <div className="m-prompt-detail-media" onClick={onCoverTap}>
              <img className="m-prompt-detail-cover" src={item.coverUrl} alt={item.title || "灵感封面"} referrerPolicy="no-referrer" decoding="async" />
              {burst > 0 && <HeartFill key={burst} className="m-heart-burst" />}
            </div>
          )}
          {item.title && <h2 className="m-prompt-detail-title">{item.title}</h2>}
          <p className="m-prompt-detail-text">{item.prompt}</p>
          {item.tags?.length > 0 && (
            <div className="m-prompt-detail-tags">
              {item.tags.map((tag) => <span key={tag}>#{tag}</span>)}
            </div>
          )}
          <div className="m-prompt-detail-stats">
            <span>{item.useCount || 0} 次使用</span>
            <span>{item.favoriteCount || 0} 收藏</span>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
