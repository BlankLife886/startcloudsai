import { useEffect, useMemo, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { CommerceSelect } from "./CommerceSelect.jsx";
import {
  APLUS_CATEGORIES,
  APLUS_MARKETPLACES,
  APLUS_TIERS,
  aplusCategoryById,
  searchAplusCategories,
} from "./aplus/amazonAplus.js";
import "./HandheldStudio.css";
import "./DetailStudio.css";

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return value >= 100 ? String(value) : String(value).padStart(2, "0");
}

function isDirectPreviewUrl(src = "") {
  return /^(blob:|data:)/i.test(String(src));
}

function ProductThumb({ src, alt }) {
  if (isDirectPreviewUrl(src)) {
    return <img src={src} alt={alt} draggable="false" />;
  }
  return (
    <AuthenticatedImage src={src} alt={alt} loading="eager" keepLoaded />
  );
}

function channelRatioVar(ratio) {
  const [w, h] = String(ratio || "16:9").split(":");
  return `${w || 16} / ${h || 9}`;
}

function groupDetailHistory(history) {
  const groups = [];
  const seen = new Map();
  for (const row of history || []) {
    const id = String(row.groupId || row.task?.id || row.url || "");
    if (!id) continue;
    let group = seen.get(id);
    if (!group) {
      group = { id, rows: [] };
      seen.set(id, group);
      groups.push(group);
    }
    const index = Number(row.index || 0);
    if (!group.rows.some((item) => Number(item.index || 0) === index)) {
      group.rows.push(row);
    }
  }
  for (const group of groups) {
    group.rows.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  }
  return groups;
}

export function DetailStudio({
  previews = [],
  modules = [],
  selectedModules = [],
  onToggleModule,
  aplus = {},
  resultUrl = "",
  history = [],
  running,
  failed,
  failMessage = "",
  elapsedSeconds = 0,
  generateDisabled,
  generateHint = "",
  shotCount = 1,
  costLabel = "",
  generateLabel = "一键生成",
  onGenerate,
  onCancel,
  onUpload,
  onRemoveFile,
  onDropFiles,
  onSelectHistory,
  onPreview,
  onResultPreview,
  onMaskEdit,
  onDownload,
  onExport,
  actionBusy = false,
  onSaveAsset,
  cancelling,
  showcaseSrc = "",
  showcaseAlt = "详情页案例预览",
  revision,
}) {
  const [runSeconds, setRunSeconds] = useState(0);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [device, setDevice] = useState("pc");

  useEffect(() => {
    if (!running) return undefined;
    setRunSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setRunSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const waitSeconds = running ? runSeconds : elapsedSeconds;
  const historyGroups = groupDetailHistory(history);
  const activeGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) || historyGroups[0];
  const planModules = aplus.plan?.modules || [];
  const stacked = useMemo(() => {
    const rows = activeGroup?.rows || [];
    if (planModules.length) {
      return planModules.map((module, index) => ({
        module,
        row: rows[index] || null,
      }));
    }
    if (rows.length) {
      return rows.map((row, index) => ({
        module: {
          id: `row-${index}`,
          amazonName: `模块 ${index + 1}`,
          pepcf: "",
          width: 970,
          height: 600,
        },
        row,
      }));
    }
    return [];
  }, [activeGroup, planModules]);
  const hasImage = stacked.some((item) => item.row?.url) && !running && !failed;
  const selectedCount = selectedModules.length;
  const categoryOptions = searchAplusCategories(categoryQuery);

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) onDropFiles?.(files);
  }

  return (
    <div className="detail-studio" aria-label="A+详情出图工作台">
      <section
        className={`detail-output${running ? " is-running" : ""}`}
        aria-label="A+详情画布"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <aside className="detail-board" aria-label="详情画布输入">
          <section className="detail-film">
            <header className="detail-board__head">
              <strong>商品图</strong>
              <small>{previews.length}/6</small>
            </header>
            {previews.length ? (
              <div className="detail-film__list upload-grid">
                {previews.map((item, index) => (
                  <figure key={`${item.url}-${index}`}>
                    <button
                      type="button"
                      className="detail-film__shot"
                      aria-label={`查看参考图 ${index + 1}`}
                      onClick={() => onPreview?.(item.url)}
                    >
                      <ProductThumb
                        src={item.url}
                        alt={`参考图 ${index + 1}`}
                      />
                    </button>
                    <button
                      type="button"
                      className="detail-film__remove"
                      aria-label={`移除参考图 ${index + 1}`}
                      disabled={running}
                      onClick={() => onRemoveFile?.(index)}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </figure>
                ))}
                {previews.length < 6 ? (
                  <button
                    type="button"
                    className="detail-film__add"
                    aria-label="继续添加参考图"
                    disabled={running}
                    onClick={onUpload}
                  >
                    <i className="bi bi-plus-lg" />
                    <span>添加</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="detail-film__empty"
                aria-label="上传参考图片"
                disabled={running}
                onClick={onUpload}
              >
                <i className="bi bi-cloud-arrow-up" />
                <strong>上传商品图</strong>
                <small>PNG / JPG / WebP，最多 6 张，可拖到这里</small>
              </button>
            )}
          </section>

          <section className="detail-brief">
            <header className="detail-board__head">
              <strong>站点与品类</strong>
            </header>
            <label>
              <span>品类</span>
              <input
                value={categoryQuery || aplus.categoryLabel || ""}
                onChange={(event) => {
                  setCategoryQuery(event.target.value);
                  const match = aplusCategoryById(event.target.value);
                  if (match && match.id !== "generic") {
                    aplus.onChangeCategory?.(match.id);
                  } else {
                    const labeled = APLUS_CATEGORIES.find(
                      (item) => item.label === event.target.value,
                    );
                    if (labeled) aplus.onChangeCategory?.(labeled.id);
                  }
                }}
                list="detail-aplus-categories"
                placeholder="灯泡、3C、家居…"
                disabled={running}
              />
              <datalist id="detail-aplus-categories">
                {categoryOptions.map((item) => (
                  <option key={item.id} value={item.label} />
                ))}
              </datalist>
            </label>
            <div className="detail-brief__row">
              <label>
                <span>目标站</span>
                <CommerceSelect
                  value={aplus.marketplaceId}
                  options={APLUS_MARKETPLACES.map((item) => ({
                    value: item.id,
                    label: item.label,
                  }))}
                  onChange={aplus.onChangeMarketplace}
                  ariaLabel="选择亚马逊站点"
                  disabled={running}
                />
              </label>
              <label>
                <span>档位</span>
                <CommerceSelect
                  value={aplus.tier}
                  options={APLUS_TIERS.map((item) => ({
                    value: item.id,
                    label: item.label,
                  }))}
                  onChange={aplus.onChangeTier}
                  ariaLabel="选择 A+ 档位"
                  disabled={running}
                />
              </label>
            </div>
            <div className="detail-brief__row">
              <label>
                <span>ASIN</span>
                <input
                  value={aplus.asin || ""}
                  onChange={(event) => aplus.onChangeAsin?.(event.target.value)}
                  placeholder="可选"
                  disabled={running}
                />
              </label>
              <label>
                <span>竞品 ASIN</span>
                <input
                  value={aplus.competitorAsin || ""}
                  onChange={(event) =>
                    aplus.onChangeCompetitorAsin?.(event.target.value)
                  }
                  placeholder="可选"
                  disabled={running}
                />
              </label>
            </div>
            <label className="detail-disclosure">
              <input
                type="checkbox"
                checked={Boolean(aplus.disclosure)}
                disabled={running}
                onChange={(event) =>
                  aplus.onChangeDisclosure?.(event.target.checked)
                }
              />
              <span>Seller Central 手动勾选 AI Disclosure</span>
            </label>
            {aplus.batchText !== undefined ? (
              <details className="detail-more">
                <summary>批量 ASIN</summary>
                <textarea
                  rows={2}
                  value={aplus.batchText || ""}
                  onChange={(event) =>
                    aplus.onChangeBatchText?.(event.target.value)
                  }
                  placeholder="每行一个，最多 100 个"
                  disabled={running}
                />
              </details>
            ) : null}
          </section>

          <section className="detail-analyze" aria-label="AI 分析">
            <header className="detail-board__head">
              <strong>AI 分析</strong>
              <small>
                {aplus.planning
                  ? "诊断中"
                  : aplus.analyzed
                    ? "已完成"
                    : "买家痛点 + 模块"}
              </small>
            </header>
            <button
              type="button"
              className={`detail-analyze__run${aplus.planning ? " is-busy" : ""}${aplus.analyzed ? " is-done" : ""}`}
              disabled={
                running || aplus.planning || Boolean(aplus.analyzeDisabled)
              }
              title={aplus.analyzeHint || undefined}
              onClick={aplus.onAnalyze}
            >
              {aplus.planning ? (
                <>
                  <i className="detail-page__spin" aria-hidden="true" />
                  正在分析痛点与模块
                </>
              ) : aplus.analyzed ? (
                <>
                  <i className="bi bi-arrow-repeat" />
                  重新分析
                </>
              ) : (
                <>
                  <i className="bi bi-stars" />
                  AI 分析
                </>
              )}
            </button>
            {aplus.analyzeError ? (
              <p className="detail-analyze__error" role="alert">
                {aplus.analyzeError}
              </p>
            ) : null}
            {aplus.analyzed ? (
              <div className="detail-analyze__result">
                {aplus.plan?.painPoints?.length ? (
                  <div>
                    <span>痛点</span>
                    <ul>
                      {aplus.plan.painPoints.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {aplus.plan?.pepcf?.length ? (
                  <p className="detail-analyze__pepcf">
                    <span>结构</span>
                    {aplus.plan.pepcf.join(" → ")}
                  </p>
                ) : null}
                <ol className="detail-analyze__mods">
                  {(aplus.plan?.modules || []).map((item, index) => (
                    <li key={item.id || index}>
                      <b>{item.pepcf || String(index + 1).padStart(2, "0")}</b>
                      <strong>{item.headline || item.amazonName}</strong>
                      <small>
                        {item.width}×{item.height}
                      </small>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="detail-analyze__hint">
                上传商品图后点分析：文本模型会诊断痛点、排出 PEPCF
                模块，并写好合规文案。
              </p>
            )}
          </section>

          <section className="detail-modules" aria-label="视觉模块">
            <header className="detail-board__head">
              <strong>页面模块</strong>
              <small>{selectedCount} 个</small>
            </header>
            <div className="module-grid">
              {modules.map((item) => (
                <label key={item.value}>
                  <input
                    type="checkbox"
                    value={item.value}
                    checked={selectedModules.includes(item.value)}
                    disabled={
                      running ||
                      (item.value === "angles" && previews.length < 2)
                    }
                    onChange={() => onToggleModule?.(item.value)}
                  />
                  <span className="module-check">
                    <i className="bi bi-check" />
                  </span>
                  <strong>{item.label}</strong>
                </label>
              ))}
            </div>
          </section>
        </aside>

        <main className="detail-page" aria-label="详情长图舞台">
          <header className="detail-page__toolbar">
            <div>
              <em>
                {aplus.marketplaceLabel || "Amazon A+"} ·{" "}
                {aplus.tier === "premium" ? "Premium" : "基础版"}
              </em>
              <span>
                {planModules.length || shotCount} 个官方尺寸模块 ·{" "}
                {aplus.language || "英文"}
              </span>
            </div>
            <div className="detail-page__devices" role="tablist" aria-label="预览设备">
              <button
                type="button"
                className={device === "pc" ? "is-active" : ""}
                onClick={() => setDevice("pc")}
              >
                PC
              </button>
              <button
                type="button"
                className={device === "mobile" ? "is-active" : ""}
                onClick={() => setDevice("mobile")}
              >
                手机
              </button>
            </div>
          </header>

          <div
            className={`detail-page__stage is-${device}${hasImage ? " has-image" : ""}${running ? " is-running" : ""}${failed && !hasImage ? " is-failed" : ""}`}
          >
            {stacked.length &&
            (hasImage || running || failed || aplus.analyzed) ? (
              <div className="detail-aplus" data-device={device}>
                {stacked.map(({ module, row }, index) => {
                  const url = row?.display || row?.url || "";
                  return (
                    <article
                      key={module.id || index}
                      className={`detail-aplus__module${url ? " has-shot" : ""}`}
                      style={{
                        "--aplus-ratio": `${module.width || 970} / ${module.height || 600}`,
                      }}
                    >
                      <header>
                        <b>{module.pepcf || String(index + 1).padStart(2, "0")}</b>
                        <strong>{module.amazonName}</strong>
                        <small>
                          {module.width}×{module.height}
                        </small>
                      </header>
                      {url && !running ? (
                        <button
                          type="button"
                          className="detail-page__shot"
                          aria-label={`查看${module.amazonName}`}
                          onClick={(event) => {
                            onSelectHistory?.(row.url);
                            onResultPreview?.(event, {
                              url: row.url,
                              alt: module.amazonName,
                              title: module.headline || module.amazonName,
                            });
                          }}
                        >
                          <AuthenticatedImage
                            src={url}
                            fallbackSrc={row.url}
                            alt={module.headline || module.amazonName}
                          />
                        </button>
                      ) : running ? (
                        <div className="detail-page__generating" role="status">
                          <i className="detail-page__spin" aria-hidden="true" />
                          <span>
                            {index === 0
                              ? `正在生成 ${formatSeconds(waitSeconds)}s`
                              : "排队中"}
                          </span>
                        </div>
                      ) : (
                        <div className="detail-aplus__slot">
                          <strong>{module.headline || "待生成"}</strong>
                          <span>{module.body || "一键生成后按官方尺寸出图"}</span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : failed ? (
              <div className="detail-page__status" role="alert">
                <strong>本次生成未完成</strong>
                <span>{failMessage || "调整参考图或模块后重新生成"}</span>
              </div>
            ) : (
              <div className="detail-page__empty">
                {showcaseSrc ? (
                  <div className="showcase-demo is-detail">
                    <div className="showcase-demo__frame">
                      <div className="showcase-demo__stage">
                        <img src={showcaseSrc} alt={showcaseAlt} />
                      </div>
                    </div>
                  </div>
                ) : null}
                <strong>还没有 A+ 模块图</strong>
                <span>
                  {previews.length
                    ? "先点左侧 AI 分析，再一键生成官方尺寸模块图"
                    : "先上传商品图，再选品类和站点"}
                </span>
              </div>
            )}
            {hasImage && waitSeconds > 0 ? (
              <span className="detail-page__elapsed">
                {formatSeconds(waitSeconds)}秒
              </span>
            ) : null}
            {revision?.available ? (
              <aside
                className={`revision-panel${revision.open ? " open" : ""}`}
                aria-label="继续调整当前成品"
              >
                <header>
                  <button
                    type="button"
                    className="revision-panel__toggle"
                    aria-label={
                      revision.open ? "收起连续优化" : "展开连续优化"
                    }
                    aria-expanded={revision.open}
                    disabled={running}
                    onClick={revision.onToggle}
                  >
                    <i
                      className={`bi ${revision.open ? "bi-chevron-right" : "bi-sliders2"}`}
                    />
                  </button>
                  <div className="revision-panel__title">
                    <small>连续优化</small>
                    <strong>继续调整当前成品</strong>
                  </div>
                </header>
                {revision.open ? (
                  <div className="revision-panel__body">
                    <p>只描述这一轮需要改变的内容，未提及部分会继续锁定。</p>
                    <label className="revision-field">
                      <span>调整方向</span>
                      <CommerceSelect
                        value={revision.direction}
                        options={revision.directionOptions}
                        onChange={revision.onChangeDirection}
                        ariaLabel="选择调整方向"
                      />
                    </label>
                    <label className="revision-field revision-field--brief">
                      <span>本轮只修改</span>
                      <textarea
                        value={revision.brief}
                        onChange={(event) =>
                          revision.onChangeBrief?.(event.target.value)
                        }
                        placeholder="例如：商品再放大 15%，背景改为浅灰影棚，其他内容保持不变"
                      />
                      <small>{(revision.brief || "").length}/600</small>
                    </label>
                    <button
                      type="button"
                      className="revision-submit"
                      disabled={
                        String(revision.brief || "").trim().length < 4 ||
                        running
                      }
                      onClick={revision.onSubmit}
                    >
                      <i className="bi bi-arrow-repeat" />
                      生成 V{Number(revision.version || 1) + 1}
                    </button>
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>

          <footer className="detail-page__bar">
            <button
              type="button"
              className={`detail-page__generate${running ? " is-running" : ""}${failed ? " is-failed" : ""}`}
              disabled={running ? cancelling : generateDisabled}
              title={!running && generateDisabled ? generateHint : undefined}
              onClick={running ? onCancel : onGenerate}
            >
              <i
                className={`bi ${running ? "bi-stop-fill" : failed ? "bi-arrow-clockwise" : "bi-layout-text-window-reverse"}`}
              />
              <span>
                {running
                  ? cancelling
                    ? "正在停止"
                    : "停止生成"
                  : failed
                    ? "重新生成"
                    : generateLabel}
              </span>
              <small>
                {running
                  ? aplus.planning
                    ? "文本模型规划中"
                    : "进行中"
                  : `${shotCount}张${costLabel ? ` · ${costLabel}` : ""}`}
              </small>
            </button>
            {hasImage ? (
              <div className="detail-page__actions">
                <button type="button" disabled={!onMaskEdit} onClick={onMaskEdit}>
                  局部修正
                </button>
                <button
                  type="button"
                  disabled={!onDownload}
                  onClick={onDownload}
                >
                  下载当前
                </button>
                <button
                  type="button"
                  disabled={!onExport || actionBusy}
                  onClick={onExport}
                >
                  导出图片+文案
                </button>
                <button
                  type="button"
                  disabled={!onSaveAsset || actionBusy}
                  onClick={onSaveAsset}
                >
                  存入素材库
                </button>
              </div>
            ) : null}
          </footer>
        </main>

        <aside className="handheld-history" aria-label="详情生成历史">
          <p className="handheld-history__label">历史</p>
          {historyGroups.length ? (
            <div className="handheld-history__list" role="list">
              {historyGroups.map((group) => {
                const cover = group.rows[0];
                const count = Math.max(
                  group.rows.length,
                  Number(cover?.groupSize) || 0,
                );
                const active = group === activeGroup;
                const mosaic = count > 1 ? group.rows.slice(0, 4) : [];
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="listitem"
                    className={`handheld-history__item${count > 1 ? " is-set" : ""}${active ? " is-active" : ""}`}
                    disabled={running}
                    aria-pressed={active}
                    onClick={() => {
                      const current = group.rows.find(
                        (row) => row.url === resultUrl,
                      );
                      onSelectHistory?.(current?.url || cover?.url);
                    }}
                  >
                    <span
                      className="handheld-history__shot"
                      style={{
                        "--handheld-history-ratio": channelRatioVar(
                          cover?.aspectRatio || "16:9",
                        ),
                      }}
                    >
                      {mosaic.length ? (
                        <span
                          className="handheld-history__mosaic"
                          data-count={Math.min(4, mosaic.length)}
                        >
                          {mosaic.map((row) => (
                            <AuthenticatedImage
                              key={row.url}
                              src={row.preview || row.url}
                              alt=""
                            />
                          ))}
                        </span>
                      ) : (
                        <AuthenticatedImage
                          src={cover?.preview || cover?.url}
                          alt=""
                        />
                      )}
                      {count > 1 ? (
                        <span className="handheld-history__count">{count}</span>
                      ) : null}
                    </span>
                    <span className="handheld-history__meta">
                      <strong>A+ 详情</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="handheld-history__empty">
              <i className="bi bi-clock-history" />
              <span>暂无记录</span>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
