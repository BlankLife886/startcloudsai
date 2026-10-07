import { useEffect, useRef, useState } from "react";
import { DotLoading } from "antd-mobile";
import { AddOutline, CloseOutline } from "antd-mobile-icons";
import { qualityLabel, ratioLabel } from "./workGroups.js";

const VISIBLE_REFERENCES = 4;

function TuneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 18c0 .55.45 1 1 1h5v-2H4c-.55 0-1 .45-1 1zM3 6c0 .55.45 1 1 1h9V5H4c-.55 0-1 .45-1 1zm10 14v-1h7c.55 0 1-.45 1-1s-.45-1-1-1h-7v-1c0-.55-.45-1-1-1s-1 .45-1 1v4c0 .55.45 1 1 1s1-.45 1-1zM7 10v1H4c-.55 0-1 .45-1 1s.45 1 1 1h3v1c0 .55.45 1 1 1s1-.45 1-1v-4c0-.55-.45-1-1-1s-1 .45-1 1zm14 2c0-.55-.45-1-1-1h-9v2h9c.55 0 1-.45 1-1zm-5-3c.55 0 1-.45 1-1V7h3c.55 0 1-.45 1-1s-.45-1-1-1h-3V4c0-.55-.45-1-1-1s-1 .45-1 1v4c0 .55.45 1 1 1z" />
    </svg>
  );
}

/**
 * 底部区域，与 App 一致：参数条（点开生成设置）+ 输入卡片（描述、“+”参考图、消耗积分按钮）。
 * 键盘弹出时整体跟着上移。
 */
export function Composer({
  form,
  references,
  notice,
  onAddFiles,
  onRemoveReference,
  onOpenReferences,
  onOpenSettings,
  onGenerate,
  busy,
  busyLabel,
  keyboardInset,
  inputRef,
}) {
  const rootRef = useRef(null);
  const fileRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const { settings, update, model, unitCost, maxReferences, promptMaxChars, resolutionOptions, qualityOptions } = form;
  const total = unitCost * settings.count;
  const canAddReference = maxReferences > 0 && references.length < maxReferences;
  const dock = [
    model?.label,
    ratioLabel(settings.ratio),
    resolutionOptions.length ? settings.resolution : "",
    qualityOptions.length ? qualityLabel(settings.quality) : "",
    `${settings.count} 张`,
  ].filter(Boolean);
  const shown = references.slice(0, VISIBLE_REFERENCES);
  const overflow = references.length - shown.length;

  // 页面底部留白跟随实际高度，最新一组作品不会被挡住。
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--m-composer-h", `${node.offsetHeight}px`);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className={`m-composer${focused ? " is-focused" : ""}`}
      style={keyboardInset ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
    >
      {notice}
      <button type="button" className="m-dock m-pressable" aria-label="生成设置" disabled={busy} onClick={onOpenSettings}>
        <span className="m-dock-items">
          {dock.map((item, index) => (
            <span key={`${index}-${item}`}>
              {index > 0 && <i aria-hidden="true">·</i>}
              {item}
            </span>
          ))}
        </span>
        <TuneIcon />
      </button>

      <div className="m-composer-card">
        <textarea
          ref={inputRef}
          className="m-composer-text"
          value={settings.prompt}
          rows={3}
          maxLength={promptMaxChars}
          placeholder="想画什么，直接写下来"
          readOnly={busy}
          onChange={(event) => update({ prompt: event.target.value })}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <div className="m-composer-actions">
          {canAddReference && references.length <= VISIBLE_REFERENCES && (
            <button type="button" className="m-add-ref m-pressable" aria-label="添加参考图" disabled={busy} onClick={() => fileRef.current?.click()}>
              <AddOutline />
            </button>
          )}
          {shown.map((item, index) => (
            <figure key={item.id} className="m-ref">
              <img src={item.preview || item.url} alt={`参考图 ${index + 1}`} />
              <button type="button" className="m-ref-remove" aria-label="移除参考图" disabled={busy} onClick={() => onRemoveReference(item.id)}>
                <CloseOutline fontSize={9} />
              </button>
            </figure>
          ))}
          {overflow > 0 && (
            <button type="button" className="m-ref m-ref-more m-pressable" aria-label="查看全部参考图" onClick={onOpenReferences}>
              +{overflow}
            </button>
          )}
          <button
            type="button"
            className="m-send m-pressable"
            disabled={busy}
            onClick={() => {
              navigator.vibrate?.(10);
              onGenerate();
            }}
          >
            {busy ? <><DotLoading color="currentColor" />{busyLabel}</> : total > 0 ? `消耗 ${total} 积分` : "生成"}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          onAddFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
