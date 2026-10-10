import { useEffect, useRef, useState } from "react";
import { DotLoading } from "antd-mobile";
import { ActionSheet, BottomSheet } from "@mobile/components/overlay/index.js";
import {
  conversationMark,
  conversationThumbnail,
  formatConversationRelativeTime,
} from "@react/features/assistant/assistantWorkspaceCore.jsx";

const LONG_PRESS_MS = 480;

function ConversationRow({ item, active, pinned, running, onOpen, onMenu }) {
  const thumb = conversationThumbnail(item);
  const timer = useRef(0);
  const fired = useRef(false);
  const press = {
    onTouchStart() {
      fired.current = false;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(15);
        onMenu(item);
      }, LONG_PRESS_MS);
    },
    onTouchMove: () => window.clearTimeout(timer.current),
    onTouchEnd: () => window.clearTimeout(timer.current),
    onContextMenu: (event) => event.preventDefault(),
  };
  return (
    <div className={`m-as-conv${active ? " is-on" : ""}`}>
      <button type="button" className="m-as-conv-main" onClick={() => { if (!fired.current) onOpen(item); }} {...press}>
        <span className="m-as-conv-mark">{thumb ? <img src={thumb} alt="" loading="lazy" /> : conversationMark(item)}</span>
        <span className="m-as-conv-text">
          <strong>{pinned && <i className="bi bi-pin-angle-fill" />}{item.title || "新对话"}</strong>
          <small>{running ? "正在生成…" : formatConversationRelativeTime(item.updatedAt)}</small>
        </span>
      </button>
      <button type="button" className="m-as-conv-more" aria-label="对话操作" onClick={() => onMenu(item)}>
        <i className="bi bi-three-dots" />
      </button>
    </div>
  );
}

/** 历史对话：搜索、按时间分组、长按或“…”出操作（重命名 / 置顶 / 归档 / 删除），底部进入已归档。 */
export function HistorySheet({ visible, onClose, workspace }) {
  const {
    activeId,
    pinnedIds,
    activeRuns,
    searchQuery,
    setSearchQuery,
    searchGroups,
    selectConversation,
    startRename,
    togglePinned,
    archiveConversation,
    setDeleteTarget,
    openArchived,
    archivedItems,
    archivedLoading,
    archiveBusyId,
    restoreConversation,
    setArchivedOpen,
    conversationQuota,
  } = workspace;
  const [view, setView] = useState("list");

  useEffect(() => {
    if (!visible) {
      setView("list");
      setArchivedOpen(false);
    }
  }, [setArchivedOpen, visible]);

  const open = (item) => {
    selectConversation(item.id);
    onClose();
  };

  const menu = (item) => {
    const pinned = pinnedIds.includes(item.id);
    ActionSheet.show({
      cancelText: "取消",
      actions: [
        { key: "rename", text: "重命名", onClick: () => startRename(item) },
        { key: "pin", text: pinned ? "取消置顶" : "置顶", onClick: () => togglePinned(item) },
        { key: "archive", text: "归档", onClick: () => void archiveConversation(item) },
        { key: "delete", text: "删除", danger: true, onClick: () => setDeleteTarget(item) },
      ],
    });
  };

  const showArchived = () => {
    setView("archived");
    void openArchived();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={view === "archived" ? "已归档" : "历史对话"} className="m-as-sheet is-tall">
      {view === "archived" ? (
        <>
          <button type="button" className="m-as-back-link" onClick={() => { setView("list"); setArchivedOpen(false); }}>
            <i className="bi bi-chevron-left" />返回历史对话
          </button>
          {archivedLoading ? (
            <div className="m-as-sheet-loading"><DotLoading /></div>
          ) : archivedItems.length ? (
            <div className="m-as-group">
              {archivedItems.map((item) => (
                <div key={item.id} className="m-as-conv">
                  <span className="m-as-conv-main">
                    <span className="m-as-conv-mark">{conversationMark(item)}</span>
                    <span className="m-as-conv-text">
                      <strong>{item.title || "新对话"}</strong>
                      <small>{formatConversationRelativeTime(item.updatedAt)}</small>
                    </span>
                  </span>
                  <button type="button" className="m-as-text-btn" disabled={archiveBusyId === item.id} onClick={() => void restoreConversation(item)}>恢复</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-as-empty-line">没有已归档的对话</p>
          )}
        </>
      ) : (
        <>
          <label className="m-as-search">
            <i className="bi bi-search" />
            <input
              type="search"
              value={searchQuery}
              placeholder="搜索对话"
              enterKeyHint="search"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery && (
              <button type="button" aria-label="清除搜索" onClick={() => setSearchQuery("")}><i className="bi bi-x-circle-fill" /></button>
            )}
          </label>
          {searchGroups.length ? searchGroups.map((group) => (
            <section key={group.key} className="m-as-conv-group">
              <h3 className="m-as-sheet-label">{group.key}</h3>
              <div className="m-as-group">
                {group.items.map((item) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    active={item.id === activeId}
                    pinned={pinnedIds.includes(item.id)}
                    running={Boolean(activeRuns?.[item.id])}
                    onOpen={open}
                    onMenu={menu}
                  />
                ))}
              </div>
            </section>
          )) : (
            <p className="m-as-empty-line">{searchQuery ? "没有匹配的对话" : "还没有对话，发一条消息开始吧"}</p>
          )}
          <button type="button" className="m-as-archived-link" onClick={showArchived}>
            <i className="bi bi-archive" />
            <span>已归档的对话</span>
            {conversationQuota?.limit ? <small>{conversationQuota.used ?? ""}/{conversationQuota.limit}</small> : null}
            <i className="bi bi-chevron-right" />
          </button>
        </>
      )}
    </BottomSheet>
  );
}
