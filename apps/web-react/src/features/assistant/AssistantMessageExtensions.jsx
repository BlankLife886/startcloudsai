import { useMemo, useState } from "react";
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

/* 2. 批量生成：逐张状态，失败单张重试 */
const BATCH_STATUS = {
  succeeded: { label: "已完成", icon: "bi-check2" },
  generating: { label: "生成中", icon: "bi-arrow-repeat" },
  queued: { label: "排队中", icon: "bi-hourglass-split" },
  failed: { label: "失败", icon: "bi-exclamation-triangle" },
};

export function AssistantBatchProgress({ items = [], onRetry }) {
  const count = (status) => items.filter((item) => item.status === status).length;
  return (
    <section className="assistant-ext-batch" aria-label="批量生成进度">
      <header>
        <strong>批量生成 · {items.length} 张</strong>
        <small>{count("succeeded")} 完成 · {count("generating")} 生成中 · {count("queued")} 排队 · {count("failed")} 失败</small>
      </header>
      <ul>
        {items.map((item, index) => {
          const status = BATCH_STATUS[item.status] || BATCH_STATUS.queued;
          return (
            <li key={item.id} className={`is-${item.status}`}>
              <div className="assistant-ext-batch-frame">
                {item.status === "succeeded" ? <img src={item.imageUrl} alt={item.title} /> : <i className={`bi ${status.icon}${item.status === "generating" ? " assistant-tool-spin" : ""}`} aria-hidden="true" />}
                <span className="assistant-ext-batch-badge">{status.label}</span>
              </div>
              <p><em>{String(index + 1).padStart(2, "0")}</em>{item.title}</p>
              {item.status === "failed" ? (
                <div className="assistant-ext-batch-error">
                  <small>{item.error}</small>
                  <button type="button" onClick={() => onRetry?.(item)}><i className="bi bi-arrow-clockwise" />重试这张</button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* 3. 积分确认：本次花费与余额 */
export function AssistantCostConfirm({ costPoints, balancePoints, onRecharge }) {
  const after = balancePoints - costPoints;
  const short = after < 0;
  return (
    <div className={`assistant-ext-cost${short ? " is-short" : ""}`}>
      <i className={`bi ${short ? "bi-exclamation-circle" : "bi-coin"}`} aria-hidden="true" />
      <span>
        本次预计 <b>{costPoints.toLocaleString("zh-CN")}</b> 积分
        <small>{short ? `余额 ${balancePoints.toLocaleString("zh-CN")}，还差 ${(-after).toLocaleString("zh-CN")} 积分` : `余额 ${balancePoints.toLocaleString("zh-CN")} → ${after.toLocaleString("zh-CN")}`}</small>
      </span>
      {short ? <button type="button" onClick={onRecharge}>去充值</button> : null}
    </div>
  );
}

/* 4. 错误卡片：按错误类型给出可执行的下一步 */
const ERROR_KINDS = {
  timeout: { icon: "bi-hourglass-bottom", title: "模型响应超时", detail: "图片服务繁忙，本次未扣积分。", actions: [["重试", "bi-arrow-clockwise", true], ["换个模型", "bi-shuffle"]] },
  moderation: { icon: "bi-shield-exclamation", title: "内容未通过审核", detail: "提示词中可能包含受限内容，修改后再试。", actions: [["修改提示词", "bi-pencil", true], ["查看规范", "bi-journal-text"]] },
  balance: { icon: "bi-wallet2", title: "积分不足", detail: "本次需要 40 积分，当前可用 30 积分。", actions: [["去充值", "bi-plus-circle", true], ["改成 1 张", "bi-dash-circle"]] },
  upload: { icon: "bi-cloud-slash", title: "参考图上传失败", detail: "网络中断，产品图.png 没有上传成功。", actions: [["重新上传", "bi-cloud-arrow-up", true], ["不用参考图", "bi-x-circle"]] },
};

export function AssistantErrorCard({ kind, detail }) {
  const item = ERROR_KINDS[kind] || ERROR_KINDS.timeout;
  return (
    <section className={`assistant-ext-error is-${kind}`} role="alert">
      <span className="assistant-ext-error-icon"><i className={`bi ${item.icon}`} aria-hidden="true" /></span>
      <div>
        <strong>{item.title}</strong>
        <small>{detail || item.detail}</small>
      </div>
      <footer>
        {item.actions.map(([label, icon, primary]) => (
          <button key={label} type="button" className={primary ? "is-primary" : ""}><i className={`bi ${icon}`} aria-hidden="true" />{label}</button>
        ))}
      </footer>
    </section>
  );
}

/* 5. 已存入素材库标记 */
export function AssistantSavedImages({ images = [] }) {
  return (
    <div className="assistant-ext-saved">
      {images.map((image) => (
        <figure key={image.id}>
          <img src={image.url} alt="" />
          {image.savedGroup ? (
            <figcaption className="is-saved"><i className="bi bi-bookmark-check-fill" aria-hidden="true" />已存入 · {image.savedGroup}<a href="/assets">查看</a></figcaption>
          ) : (
            <figcaption><button type="button"><i className="bi bi-bookmark-plus" aria-hidden="true" />存入素材库</button></figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

/* 6a. Mermaid 流程图（草案用静态示意，接入时换成 mermaid 渲染） */
export function AssistantDiagramPreview({ title, steps = [] }) {
  return (
    <figure className="assistant-ext-diagram">
      <header><span><i className="bi bi-diagram-3" aria-hidden="true" />{title}</span><button type="button" title="查看源码"><i className="bi bi-code-slash" /></button></header>
      <div className="assistant-ext-diagram-flow">
        {steps.map((step, index) => (
          <span key={step} className="assistant-ext-diagram-node-wrap">
            {index ? <i className="bi bi-arrow-right" aria-hidden="true" /> : null}
            <span className={`assistant-ext-diagram-node${index === steps.length - 1 ? " is-end" : ""}`}>{step}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

/* 6b. 表格：可排序、可复制为 CSV */
export function AssistantDataTable({ columns = [], rows = [] }) {
  const [sort, setSort] = useState({ index: -1, dir: 1 });
  const [copied, setCopied] = useState(false);
  const sorted = useMemo(() => {
    if (sort.index < 0) return rows;
    return [...rows].sort((a, b) => String(a[sort.index]).localeCompare(String(b[sort.index]), "zh-CN", { numeric: true }) * sort.dir);
  }, [rows, sort]);
  const copyCsv = async () => {
    const csv = [columns, ...sorted].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    try { await navigator.clipboard.writeText(csv); } catch { /* clipboard may be blocked in previews */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="assistant-ext-table">
      <header><small>{rows.length} 行 · 点表头排序</small><button type="button" onClick={copyCsv}><i className={`bi ${copied ? "bi-check2" : "bi-filetype-csv"}`} />{copied ? "已复制" : "复制 CSV"}</button></header>
      <table>
        <thead>
          <tr>{columns.map((column, index) => (
            <th key={column} aria-sort={sort.index === index ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => setSort((current) => ({ index, dir: current.index === index ? -current.dir : 1 }))}>
                {column}<i className={`bi ${sort.index !== index ? "bi-chevron-expand" : sort.dir > 0 ? "bi-chevron-up" : "bi-chevron-down"}`} aria-hidden="true" />
              </button>
            </th>
          ))}</tr>
        </thead>
        <tbody>{sorted.map((row) => <tr key={row.join("|")}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* 7. 正文引用角标，与联网来源编号对应 */
export function AssistantCitedText({ parts = [], sources = [] }) {
  return (
    <div className="assistant-ext-cited">
      <p>
        {parts.map((part, index) => typeof part === "number" ? (
          <a key={index} className="assistant-ext-cite" href={sources[part - 1]?.url} target="_blank" rel="noreferrer" title={sources[part - 1]?.title}>{part}</a>
        ) : <span key={index}>{part}</span>)}
      </p>
      <ol className="assistant-ext-cited-sources">
        {sources.map((source, index) => (
          <li key={source.url}><span>{index + 1}</span><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{new URL(source.url).hostname.replace(/^www\./, "")}</small></li>
        ))}
      </ol>
    </div>
  );
}

/* 8. 追问建议 */
export function AssistantFollowUpSuggestions({ items = [], onPick }) {
  return (
    <div className="assistant-ext-suggestions" role="group" aria-label="追问建议">
      {items.map((item) => <button key={item} type="button" onClick={() => onPick?.(item)}><span>{item}</span><i className="bi bi-arrow-up-right" aria-hidden="true" /></button>)}
    </div>
  );
}

/* 9. 长回复目录 */
export function AssistantReplyOutline({ headings = [] }) {
  const [open, setOpen] = useState(true);
  return (
    <nav className="assistant-ext-outline" aria-label="回复目录">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <i className="bi bi-list-nested" aria-hidden="true" />目录 · {headings.length} 节<i className={`bi bi-chevron-down${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      {open ? <ol>{headings.map((heading) => <li key={heading.title} className={`is-level-${heading.level || 2}`}><a href={`#${heading.id || ""}`} onClick={(event) => event.preventDefault()}>{heading.title}</a></li>)}</ol> : null}
    </nav>
  );
}

/* 10. 视频结果卡 */
export function AssistantVideoCard({ poster, title, duration, meta = [] }) {
  return (
    <figure className="assistant-ext-video">
      <div className="assistant-ext-video-frame">
        <img src={poster} alt="" />
        <button type="button" aria-label="播放"><i className="bi bi-play-fill" /></button>
        <span className="assistant-ext-video-duration">{duration}</span>
      </div>
      <figcaption>
        <div><strong>{title}</strong><small>{meta.join(" · ")}</small></div>
        <span>
          <button type="button" title="设为参考"><i className="bi bi-image" /></button>
          <button type="button" title="下载"><i className="bi bi-download" /></button>
        </span>
      </figcaption>
    </figure>
  );
}

/* 11. 商品详情页长图预览 */
export function AssistantDetailPagePreview({ title, screens = [], size }) {
  return (
    <section className="assistant-ext-detail">
      <div className="assistant-ext-detail-phone">
        <div className="assistant-ext-detail-scroll">{screens.map((src, index) => <img key={`${src}-${index}`} src={src} alt={`第 ${index + 1} 屏`} />)}</div>
      </div>
      <div className="assistant-ext-detail-meta">
        <strong>{title}</strong>
        <small>{screens.length} 屏 · {size}</small>
        <ol>{screens.map((_, index) => <li key={index}>第 {index + 1} 屏</li>)}</ol>
        <button type="button" className="is-primary"><i className="bi bi-download" />下载长图</button>
        <button type="button"><i className="bi bi-box-arrow-up-right" />在工作台编辑</button>
      </div>
    </section>
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

/* 13. 选择卡：出图前补充信息 */
export function AssistantChoiceCard({ title, groups = [], submitLabel = "按这个出图" }) {
  const [picked, setPicked] = useState(() => Object.fromEntries(groups.map((group) => [group.id, group.defaultValue ?? group.options[0]])));
  return (
    <section className="assistant-ext-choice">
      <strong>{title}</strong>
      {groups.map((group) => (
        <div key={group.id} className="assistant-ext-choice-group">
          <span>{group.label}</span>
          <div role="radiogroup" aria-label={group.label}>
            {group.options.map((option) => (
              <button key={option} type="button" role="radio" aria-checked={picked[group.id] === option} className={picked[group.id] === option ? "is-active" : ""} onClick={() => setPicked((current) => ({ ...current, [group.id]: option }))}>{option}</button>
            ))}
          </div>
        </div>
      ))}
      <footer><small>{Object.values(picked).join(" · ")}</small><button type="button" className="is-primary">{submitLabel}</button></footer>
    </section>
  );
}

/* 14. 数据视图补充：时间段切换、对比、导出、订单跳转 */
export function AssistantDataToolbar({ ranges = [], compare = true }) {
  const [range, setRange] = useState(ranges[0]);
  const [withCompare, setWithCompare] = useState(compare);
  return (
    <div className="assistant-ext-datatools">
      <div className="assistant-ext-segment" role="tablist">
        {ranges.map((item) => <button key={item} type="button" role="tab" aria-selected={item === range} className={item === range ? "is-active" : ""} onClick={() => setRange(item)}>{item}</button>)}
      </div>
      <label><input type="checkbox" checked={withCompare} onChange={(event) => setWithCompare(event.target.checked)} />对比上一期</label>
      <button type="button"><i className="bi bi-download" />导出 CSV</button>
    </div>
  );
}

export function AssistantOrderLinks({ orderNo }) {
  return (
    <div className="assistant-ext-orderlinks">
      <span>订单 {orderNo}</span>
      <a href="/orders">查看订单详情<i className="bi bi-chevron-right" /></a>
      <a href="/orders">申请发票<i className="bi bi-chevron-right" /></a>
    </div>
  );
}

/* 15. 消息分支：重新生成后在版本间切换 */
export function AssistantVersionSwitcher({ versions = [] }) {
  const [index, setIndex] = useState(versions.length - 1);
  return (
    <div className="assistant-ext-versions">
      <p>{versions[index]}</p>
      <div className="assistant-ext-versions-nav">
        <button type="button" aria-label="上一版" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}><i className="bi bi-chevron-left" /></button>
        <span>{index + 1} / {versions.length}</span>
        <button type="button" aria-label="下一版" disabled={index === versions.length - 1} onClick={() => setIndex((value) => value + 1)}><i className="bi bi-chevron-right" /></button>
      </div>
    </div>
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

/* 17. 点踩原因 */
const DISLIKE_REASONS = ["不准确", "图不对", "没听懂我", "太慢了", "太啰嗦", "其他"];

export function AssistantDislikeReasons({ onSubmit }) {
  const [picked, setPicked] = useState(() => new Set());
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) return <p className="assistant-ext-dislike-done"><i className="bi bi-check2-circle" aria-hidden="true" />谢谢，已记下，会用来改进回答。</p>;
  const toggle = (reason) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(reason)) next.delete(reason); else next.add(reason);
    return next;
  });
  return (
    <section className="assistant-ext-dislike">
      <strong>哪里不对？</strong>
      <div>{DISLIKE_REASONS.map((reason) => <button key={reason} type="button" aria-pressed={picked.has(reason)} className={picked.has(reason) ? "is-active" : ""} onClick={() => toggle(reason)}>{reason}</button>)}</div>
      <textarea rows={2} placeholder="补充说明（可选）" value={note} onChange={(event) => setNote(event.target.value)} />
      <footer><button type="button" className="is-primary" disabled={!picked.size && !note.trim()} onClick={() => { onSubmit?.({ reasons: [...picked], note }); setSent(true); }}>提交</button></footer>
    </section>
  );
}
