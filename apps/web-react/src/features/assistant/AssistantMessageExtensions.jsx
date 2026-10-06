import { useState } from "react";
import "./assistant-extensions.css";

// UI drafts for the planned conversation extensions. Each component is purely
// presentational and takes plain data, so it can be wired to real messages later.

/* 1. 图片对比：改前 / 改后滑块。before / after 可以是图片地址，也可以是现成的图片元素。 */
function compareLayer(value, alt) {
  return typeof value === "string" ? <img src={value} alt={alt} /> : value;
}

export function AssistantImageCompare({ before, after, beforeLabel = "改前", afterLabel = "改后", className = "" }) {
  const [position, setPosition] = useState(50);
  return (
    <figure className={`assistant-ext-compare${className ? ` ${className}` : ""}`} style={{ "--compare-position": `${position}%` }}>
      {compareLayer(before, beforeLabel)}
      <div className="assistant-ext-compare-after">
        {compareLayer(after, afterLabel)}
      </div>
      <span className="assistant-ext-compare-divider" aria-hidden="true"><i className="bi bi-arrow-left-right" /></span>
      <span className="assistant-ext-compare-tag is-before">{beforeLabel}</span>
      <span className="assistant-ext-compare-tag is-after">{afterLabel}</span>
      <input type="range" min="0" max="100" value={position} aria-label={`拖动对比${beforeLabel}和${afterLabel}`} onChange={(event) => setPosition(Number(event.target.value))} />
    </figure>
  );
}

/* 12. 后台任务卡 */
export function AssistantTaskCard({ title, done, total, state = "running", eta }) {
  const percent = Math.round((done / Math.max(1, total)) * 100);
  const finished = state === "done";
  return (
    <section className={`assistant-ext-task is-${state}`}>
      <header>
        <span className="assistant-ext-task-icon"><i className={`bi ${finished ? "bi-check2-circle" : "bi-cpu"}`} aria-hidden="true" /></span>
        <div><strong>{title}</strong><small>{finished ? "已完成，结果已存入素材库" : `后台运行中 · ${done}/${total} · 预计还需 ${eta}`}</small></div>
        <span className="assistant-ext-task-state">{finished ? "已完成" : "进行中"}</span>
      </header>
      <div className="assistant-ext-task-bar"><i style={{ width: `${percent}%` }} /></div>
      <footer>
        {finished ? <button type="button" className="is-primary">查看结果</button> : <><small><i className="bi bi-bell" aria-hidden="true" />完成后会主动通知你</small><button type="button">取消任务</button></>}
      </footer>
    </section>
  );
}

/* 16. 分享与导出 */
export function AssistantSharePanel() {
  const [withImages, setWithImages] = useState(true);
  const [scope, setScope] = useState("message");
  return (
    <section className="assistant-ext-share">
      <header><strong>分享与导出</strong></header>
      <div className="assistant-ext-segment">
        <button type="button" className={scope === "message" ? "is-active" : ""} onClick={() => setScope("message")}>这条回复</button>
        <button type="button" className={scope === "thread" ? "is-active" : ""} onClick={() => setScope("thread")}>整段对话</button>
      </div>
      <label><input type="checkbox" checked={withImages} onChange={(event) => setWithImages(event.target.checked)} />包含图片</label>
      <div className="assistant-ext-share-actions">
        <button type="button"><i className="bi bi-file-earmark-image" />导出图片</button>
        <button type="button"><i className="bi bi-filetype-pdf" />导出 PDF</button>
        <button type="button" className="is-primary"><i className="bi bi-link-45deg" />复制分享链接</button>
      </div>
    </section>
  );
}

