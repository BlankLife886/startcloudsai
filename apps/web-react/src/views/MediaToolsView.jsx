import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { createTask, quoteTaskPrice, uploadFile, waitForTask } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "./MediaToolsView.css";

gsap.registerPlugin(useGSAP);

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    || document.documentElement.classList.contains("settings-no-animations");
}

const MEDIA_FIELDS = {
  img_urls: "image", images: "image", image_url: "image", reference_images: "image",
  video_urls: "video", video_url: "video", reference_videos: "video",
  audio_url: "audio", reference_audios: "audio", reference_medias: "media",
};

const OPERATION_LABELS = {
  "background-remove": "背景移除", "image-upscale": "图片高清放大",
  "watermark-remove": "去水印", "video-enhance": "视频增强",
  "lip-sync": "口型同步", "motion-control": "动作迁移",
  "animate-move": "动作生成", "animate-replace": "角色替换",
  "template-to-video": "模板视频",
};

function toolOperation(tool) {
  return String(tool?.operations?.[0] || tool?.tool || "").replaceAll("_", "-");
}

function toolLabel(tool) {
  return String(tool?.name || tool?.label || OPERATION_LABELS[toolOperation(tool)] || tool?.id || "媒体工具");
}

function operationLabel(tool) {
  return OPERATION_LABELS[toolOperation(tool)] || toolOperation(tool) || "媒体处理";
}

function fieldLabel(field, schema = {}) {
  const known = {
    img_urls: "图片", images: "图片", image_url: "图片", reference_images: "参考图片",
    video_urls: "视频", video_url: "视频", reference_videos: "参考视频",
    audio_url: "音频", reference_audios: "参考音频", reference_medias: "参考媒体",
    prompt: "描述", text: "文本", resolution: "分辨率", output_format: "输出格式",
    mode: "处理模式", scale_factor: "放大倍数", strength: "增强强度", scene: "场景",
    fps: "帧率", speed: "语速", volume: "音量", template_id: "模板 ID", template: "模板",
    character_orientation: "角色朝向", keep_original_sound: "保留原声",
  };
  return known[field] || schema.title || field;
}

function schemaType(schema = {}) {
  if (schema.type) return schema.type;
  return schema.anyOf?.find((item) => item?.type && item.type !== "null")?.type || "string";
}

function initialInput(tool) {
  const properties = tool?.inputSchema?.properties || {};
  return Object.fromEntries(Object.entries(properties).flatMap(([field, schema]) => {
    if (MEDIA_FIELDS[field] || schema?.default === null || schema?.default === undefined) return [];
    return [[field, schema.default]];
  }));
}

function localImageDimensions(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const result = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function clipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];
  const fromItems = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file" && item.type?.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const fromFiles = Array.from(clipboardData.files || []).filter((file) => file.type?.startsWith("image/"));
  const seen = new Set();
  return [...fromItems, ...fromFiles].flatMap((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const ext = file.type.includes("jpeg") ? "jpg" : file.type.includes("webp") ? "webp" : "png";
    if (file.name && file.name !== "image.png") return [file];
    return [new File([file], `paste-${Date.now()}.${ext}`, { type: file.type || "image/png" })];
  });
}

function acceptFor(kind) {
  if (kind === "image") return "image/png,image/jpeg,image/webp";
  if (kind === "video") return "video/mp4,video/webm";
  if (kind === "audio") return "audio/mpeg,audio/wav,audio/mp4,audio/ogg";
  return "image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg";
}

function optionChipLabel(field, value) {
  if (field === "scale_factor" && Number.isFinite(Number(value))) return `${Number(value)}×`;
  const labels = {
    face: "人脸增强",
    general: "通用增强",
    standard: "标准",
    anime: "插画",
    photo: "照片",
    png: "PNG",
    jpeg: "JPEG",
    jpg: "JPEG",
    webp: "WebP",
  };
  return labels[String(value)] || String(value);
}

function ChipControl({ field, schema, value, onChange }) {
  const options = Array.isArray(schema?.enum) ? schema.enum.filter((item) => item !== null) : [];
  return (
    <div className="mt-chips" role="listbox" aria-label={fieldLabel(field, schema)}>
      {!schema?.required && (
        <button type="button" role="option" aria-selected={value == null || value === ""} className={value == null || value === "" ? "is-selected" : ""} onClick={() => onChange(undefined)}>默认</button>
      )}
      {options.map((item) => (
        <button key={String(item)} type="button" role="option" aria-selected={String(value) === String(item)} className={String(value) === String(item) ? "is-selected" : ""} onClick={() => onChange(item)}>{optionChipLabel(field, item)}</button>
      ))}
    </div>
  );
}

function UploadDropzone({ files = [], accept, multiple, onChange }) {
  const file = files[0];
  const preview = useMemo(
    () => (file && String(file.type || "").startsWith("image/") ? URL.createObjectURL(file) : ""),
    [file],
  );
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div className={`mt-upload${preview ? " has-preview" : ""}`}>
      <input type="file" accept={accept} multiple={multiple} onChange={(event) => onChange(Array.from(event.target.files || []))} />
      {preview ? (
        <>
          <img src={preview} alt={file?.name || "已选原图"} />
          <em>{files.map((item) => item.name).join("、")}</em>
        </>
      ) : (
        <>
          <i className="bi bi-image" />
          <strong>拖入、点击或粘贴原图</strong>
          <span>支持 PNG / JPEG / WebP，也可 Ctrl / ⌘ + V</span>
        </>
      )}
    </div>
  );
}

function FieldControl({ field, schema, value, onChange, chips }) {
  const options = Array.isArray(schema?.enum) ? schema.enum.filter((item) => item !== null) : [];
  const type = schemaType(schema);
  if (options.length && chips) return <ChipControl field={field} schema={schema} value={value} onChange={onChange} />;
  if (options.length) {
    return (
      <select value={value ?? ""} onChange={(event) => {
        const raw = event.target.value;
        const matched = options.find((item) => String(item) === raw);
        onChange(raw === "" ? undefined : matched);
      }}>
        {!schema?.required && <option value="">使用上游默认值</option>}
        {options.map((item) => <option key={String(item)} value={String(item)}>{optionChipLabel(field, item)}</option>)}
      </select>
    );
  }
  if (type === "boolean") {
    return <label className="mt-switch"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span /></label>;
  }
  if (type === "number" || type === "integer") {
    return <input type="number" value={value ?? ""} min={schema?.minimum} max={schema?.maximum} step={type === "integer" ? 1 : "any"} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />;
  }
  if (type === "object" || type === "array") {
    return <textarea rows="4" value={typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2)} placeholder={type === "object" ? "{}" : "[]"} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field === "prompt" || field === "text" || Number(schema?.maxLength) > 300) {
    return <textarea rows="4" value={value ?? ""} maxLength={schema?.maxLength} onChange={(event) => onChange(event.target.value || undefined)} />;
  }
  return <input type="text" value={value ?? ""} minLength={schema?.minLength} maxLength={schema?.maxLength} onChange={(event) => onChange(event.target.value || undefined)} />;
}

function ResultPreview({ task, tool, sourcePreview, upscale, busy }) {
  const stageRef = useRef(null);
  const url = task?.originalUrls?.[0] || task?.outputUrls?.[0] || "";
  const succeeded = task?.status === "succeeded" && Boolean(url);
  const processing = Boolean(upscale && busy && !succeeded);
  const modality = String(tool?.modality || "image");

  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [url]);

  useEffect(() => {
    if (!succeeded || revealed) return undefined;
    const timer = window.setTimeout(() => setRevealed(true), 1600);
    return () => window.clearTimeout(timer);
  }, [revealed, succeeded]);

  useGSAP(() => {
    if (!upscale || !processing || !stageRef.current || prefersReducedMotion()) return;
    const copy = stageRef.current.querySelector(".mt-result-copy");
    const source = stageRef.current.querySelector(".mt-result-source");
    if (copy) gsap.fromTo(copy, { autoAlpha: 0.45, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.36, ease: "power2.out" });
    if (source) {
      gsap.fromTo(source, { scale: 1, filter: "blur(8px) saturate(0.8)" }, {
        scale: 1.045,
        filter: "blur(10px) saturate(1.05)",
        duration: 1.7,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    }
  }, { dependencies: [processing], scope: stageRef });

  useGSAP(() => {
    if (!upscale || !succeeded || !stageRef.current) return;
    const media = stageRef.current.querySelector(".mt-result-media");
    const actions = stageRef.current.querySelector(".mt-result-actions");
    const veil = stageRef.current.querySelector(".mt-result-veil");
    if (!media) return;
    if (prefersReducedMotion()) {
      gsap.set(media, { autoAlpha: 1, clearProps: "filter,transform" });
      if (actions) gsap.set(actions, { autoAlpha: 1, clearProps: "transform" });
      if (veil) gsap.set(veil, { autoAlpha: 0 });
      return;
    }
    if (!revealed) {
      gsap.set(media, { autoAlpha: 0, scale: 0.94, filter: "blur(16px)" });
      if (actions) gsap.set(actions, { autoAlpha: 0, y: 10 });
      return;
    }
    gsap.to(media, { autoAlpha: 1, scale: 1, filter: "blur(0px)", duration: 0.72, ease: "power3.out", clearProps: "filter" });
    if (veil) gsap.fromTo(veil, { yPercent: -8, autoAlpha: 0.88 }, { yPercent: 110, autoAlpha: 0, duration: 0.7, ease: "power2.inOut" });
    if (actions) gsap.to(actions, { autoAlpha: 1, y: 0, duration: 0.4, delay: 0.26, ease: "power2.out" });
  }, { dependencies: [revealed, succeeded, url], scope: stageRef });

  if (upscale) {
    return (
      <div ref={stageRef} className={`mt-result-stage${processing ? " is-processing" : ""}${succeeded ? " is-ready" : " is-empty"}`}>
        {sourcePreview && !succeeded ? <img className="mt-result-source" src={sourcePreview} alt="待放大原图" /> : null}
        {succeeded ? (
          <>
            <div className="mt-result-media">
              <AuthenticatedImage
                src={url}
                alt="高清放大结果"
                loading="eager"
                keepLoaded
                maxDimension={1800}
                onLoad={() => setRevealed(true)}
                onError={() => setRevealed(true)}
              />
            </div>
            <span className="mt-result-veil" aria-hidden="true" />
            <a className="mt-button is-secondary mt-result-actions" href={`${url}${url.includes("?") ? "&" : "?"}download=1`}><i className="bi bi-download" />下载结果</a>
          </>
        ) : (
          <div className="mt-result-copy">
            <i className={`bi ${processing ? "bi-arrows-fullscreen" : "bi-stars"}`} />
            <strong>{processing ? "正在放大细节" : sourcePreview ? "原图已就绪，开始放大后在此对照" : "放大结果会显示在这里"}</strong>
            <span>{processing ? "保持页面打开，完成后会在这里显现" : "完成后可预览高清图并下载"}</span>
          </div>
        )}
        {processing ? <span className="mt-result-scan" aria-hidden="true" /> : null}
      </div>
    );
  }

  if (!url) {
    return (
      <div className="mt-result-empty">
        <i className="bi bi-stars" />
        <strong>结果会显示在这里</strong>
        <span>任务完成后可直接预览和下载</span>
      </div>
    );
  }
  return (
    <div className="mt-result-ready">
      {modality === "video" ? <video src={url} controls playsInline /> : modality === "audio" ? <audio src={url} controls /> : <AuthenticatedImage src={url} alt="工具处理结果" maxDimension={1800} />}
      <a className="mt-button is-secondary" href={`${url}${url.includes("?") ? "&" : "?"}download=1`}><i className="bi bi-download" />下载结果</a>
    </div>
  );
}

export function MediaToolsView() {
  const { modelId = "" } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState({});
  const [files, setFiles] = useState({});
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceDimensions, setSourceDimensions] = useState(null);
  const pageRef = useRef(null);
  const runButtonRef = useRef(null);
  const { contextSafe } = useGSAP({ scope: pageRef });

  useEffect(() => {
    let active = true;
    fetchRuntimeConfig({ force: true }).then((config) => {
      const values = config?.features?.["ai.mediaTools"]?.config?.tools;
      if (active) setTools(Array.isArray(values) ? values.filter((item) => item?.id) : []);
    }).catch((reason) => active && setError(reason?.message || "工具配置读取失败")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => tools.find((tool) => tool.id === modelId) || null, [modelId, tools]);
  const properties = selected?.inputSchema?.properties || {};
  const required = new Set(selected?.requiredInputFields || selected?.inputSchema?.required || []);
  const operation = toolOperation(selected);
  const isImageUpscale = operation === "image-upscale";
  const sourceFile = Object.values(files).flat().find((item) => item instanceof File);
  const sourcePreview = useMemo(
    () => (sourceFile && String(sourceFile.type || "").startsWith("image/") ? URL.createObjectURL(sourceFile) : ""),
    [sourceFile],
  );
  useEffect(() => () => { if (sourcePreview) URL.revokeObjectURL(sourcePreview); }, [sourcePreview]);
  useEffect(() => {
    let active = true;
    setSourceDimensions(null);
    localImageDimensions(sourceFile).then((dimensions) => {
      if (active) setSourceDimensions(dimensions);
    });
    return () => { active = false; };
  }, [sourceFile]);
  const displayedPrice = useMemo(() => {
    if (!isImageUpscale || !selected?.imageUpscalePricing) return String(selected?.pricePoints || 0);
    const pricing = selected.imageUpscalePricing;
    const low = Number(pricing.lowPricePoints) || 0;
    const high = Number(pricing.highPricePoints) || 0;
    const scale = Number(input.scale_factor);
    if (sourceDimensions && scale > 0) {
      const targetLongEdge = Math.max(sourceDimensions.width, sourceDimensions.height) * scale;
      return String(targetLongEdge <= Number(pricing.thresholdPixels || 2048) ? low : high);
    }
    return low === high ? String(low) : `${Math.min(low, high)}–${Math.max(low, high)}`;
  }, [input.scale_factor, isImageUpscale, selected, sourceDimensions]);
  const playSubmitMotion = contextSafe(() => {
    if (toolOperation(selected) !== "image-upscale" || prefersReducedMotion()) return;
    const button = runButtonRef.current;
    const pane = pageRef.current?.querySelector(".mt-result-pane");
    if (button) {
      gsap.fromTo(button, { scale: 1 }, { scale: 0.96, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.inOut" });
    }
    if (pane) {
      gsap.fromTo(pane, { scale: 1 }, { scale: 1.012, duration: 0.22, yoyo: true, repeat: 1, ease: "power2.out" });
    }
  });

  useEffect(() => {
    setInput(initialInput(selected)); setFiles({}); setTask(null); setError("");
  }, [selected?.id]);

  useEffect(() => {
    if (!loading && (!modelId || !selected)) navigate("/", { replace: true });
  }, [loading, modelId, navigate, selected]);

  const submit = useCallback(async () => {
    if (!selected || requestAuth({ featureLabel: toolLabel(selected) })) return;
    if (busy) return;
    setBusy(true); setError(""); setTask(null);
    try {
      const toolFiles = {};
      const inputKeys = [];
      for (const [field, fieldFiles] of Object.entries(files)) {
        if (!fieldFiles?.length) continue;
        const uploaded = await Promise.all(fieldFiles.map((file) => uploadFile(file)));
        toolFiles[field] = uploaded.map((item) => item.key);
        inputKeys.push(...toolFiles[field]);
      }
      const toolInput = {};
      for (const [field, value] of Object.entries(input)) {
        if (value === undefined || value === "") continue;
        const type = schemaType(properties[field] || {});
        if ((type === "object" || type === "array") && typeof value === "string") {
          try { toolInput[field] = JSON.parse(value); } catch { throw new Error(`${fieldLabel(field, properties[field])} 的 JSON 格式无效`); }
        } else toolInput[field] = value;
      }
      for (const field of required) {
        if (toolInput[field] === undefined && !toolFiles[field]?.length) throw new Error(`请填写${fieldLabel(field, properties[field])}`);
      }
      const params = { publicModelKey: selected.id, toolInput, toolFiles, _kind: "media-tool", _source: "media-tools" };
      const quote = await quoteTaskPrice({ type: "media_tool", params, inputKeys, count: 1 });
      if (
        auth.user?.requireCostConfirm !== false
        && !window.confirm(`本次将扣除 ${quote.unitPriceCents || 0} 积分，是否继续？`)
      ) return;
      const created = await createTask({
        type: "media_tool", prompt: `使用${toolLabel(selected)}`,
        params,
        inputKeys, count: 1, idempotencyKey: crypto.randomUUID(),
        expectedUnitPriceCents: quote.unitPriceCents,
      });
      setTask(created);
      const completed = await waitForTask(created.id, { maxWaitMs: 60 * 60 * 1000, onUpdate: setTask });
      setTask(completed);
      if (completed.status !== "succeeded") throw new Error(completed.errorMessage || "工具处理失败，积分已按任务状态退回");
      notificationService.success("处理完成");
    } catch (reason) {
      const message = reason?.message || "工具处理失败";
      setError(message); notificationService.error(message);
    } finally { setBusy(false); }
  }, [auth.user?.requireCostConfirm, busy, files, input, properties, requestAuth, required, selected]);

  const imageField = useMemo(
    () => Object.keys(properties).find((field) => MEDIA_FIELDS[field] === "image") || "",
    [properties],
  );
  const applyImageFiles = useCallback((next, { notifyPaste } = {}) => {
    if (!imageField || !next.length) return;
    const schema = properties[imageField] || {};
    const multiple = schema?.type === "array" && Number(schema?.maxItems || 1) > 1;
    setFiles((current) => ({ ...current, [imageField]: multiple ? next : next.slice(0, 1) }));
    if (notifyPaste) notificationService.success("已粘贴图片");
  }, [imageField, properties]);

  useEffect(() => {
    if (toolOperation(selected) !== "image-upscale") return undefined;
    const onPaste = (event) => {
      if (busy) return;
      if (event.target?.closest?.("input:not([type='file']), textarea, select, [contenteditable='true']")) return;
      const images = clipboardImageFiles(event.clipboardData);
      if (!images.length) return;
      event.preventDefault();
      applyImageFiles(images, { notifyPaste: true });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [applyImageFiles, busy, selected]);

  if (loading || !selected) return null;

  return (
    <main ref={pageRef} className={`mt-page mt-page--${operation}`}>
      {isImageUpscale ? <div className="mt-atmosphere" aria-hidden="true"><div className="mt-aurora" /></div> : null}
      <header className="mt-header">
        <div className="mt-heading">
          {isImageUpscale ? null : <span className="mt-kicker"><i className="bi bi-tools" />创作工具</span>}
          <div className="mt-heading-copy">
            <h1>{toolLabel(selected)}</h1>
            <p>{selected.description || (isImageUpscale ? "上传原图，选择倍数后生成更清晰的大图。" : operationLabel(selected))}</p>
          </div>
        </div>
        <div className="mt-header-meta">
          <span><i className="bi bi-shield-check" />{isImageUpscale ? "原图细节保留" : operationLabel(selected)}</span>
          <span><i className="bi bi-coin" />{displayedPrice} 积分 / 次</span>
        </div>
      </header>
      <div className="mt-shell">
        <section className="mt-workspace">
            <div className="mt-form-pane">
              <div className="mt-pane-title">
                <span>
                  <strong>{isImageUpscale ? "原图与放大参数" : "上传与设置"}</strong>
                  <small>{isImageUpscale ? "先选图，再确认倍数和模式" : "选择原图并设置放大参数"}</small>
                </span>
                <span className="mt-step">01</span>
              </div>
              <div className="mt-fields">{Object.entries(properties).map(([field, schema]) => {
                const mediaKind = MEDIA_FIELDS[field];
                const FieldTag = mediaKind ? "label" : "div";
                return (
                  <FieldTag key={field} className={`mt-field${mediaKind ? " is-upload" : ""}`}>
                    <span className="mt-field-label">
                      <strong>{fieldLabel(field, schema)}</strong>
                      {required.has(field) && <em>必填</em>}
                      <small>{schema?.description || (isImageUpscale && field === "scale_factor" ? "按长边倍率放大" : field)}</small>
                    </span>
                    {mediaKind ? (
                      isImageUpscale && mediaKind === "image" ? (
                        <UploadDropzone
                          files={files[field] || []}
                          accept={acceptFor(mediaKind)}
                          multiple={schema?.type === "array" && Number(schema?.maxItems || 1) > 1}
                          onChange={(next) => setFiles((current) => ({ ...current, [field]: next }))}
                        />
                      ) : (
                        <div className="mt-upload">
                          <input type="file" accept={acceptFor(mediaKind)} multiple={schema?.type === "array" && Number(schema?.maxItems || 1) > 1} onChange={(event) => setFiles((current) => ({ ...current, [field]: Array.from(event.target.files || []) }))} />
                          <i className="bi bi-cloud-arrow-up" />
                          <span>{files[field]?.length ? files[field].map((file) => file.name).join("、") : `选择${mediaKind === "image" ? "图片" : mediaKind === "video" ? "视频" : mediaKind === "audio" ? "音频" : "媒体"}`}</span>
                        </div>
                      )
                    ) : (
                      <FieldControl
                        field={field}
                        schema={{ ...schema, required: required.has(field) }}
                        value={input[field]}
                        chips={isImageUpscale}
                        onChange={(value) => setInput((current) => ({ ...current, [field]: value }))}
                      />
                    )}
                  </FieldTag>
                );
              })}</div>
              {error && <div className="mt-error"><i className="bi bi-exclamation-circle" />{error}</div>}
              <button
                ref={runButtonRef}
                type="button"
                className={`mt-button is-primary${isImageUpscale ? " is-upscale-run" : ""}${isImageUpscale && busy ? " is-busy" : ""}`}
                disabled={busy}
                onClick={() => {
                  if (isImageUpscale) playSubmitMotion();
                  submit();
                }}
              >
                {isImageUpscale ? (
                  <>
                    <span className="mt-button-icon">
                      <i className={`bi ${busy ? "bi-arrow-repeat mt-spin" : "bi-arrows-fullscreen"}`} />
                    </span>
                    <span className="mt-button-copy">
                      <strong>{busy ? task?.status === "running" ? "正在放大" : "正在提交" : "开始放大"}</strong>
                      {!busy ? <small>{displayedPrice} 积分</small> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <i className={`bi ${busy ? "bi-arrow-repeat mt-spin" : "bi-play-fill"}`} />
                    {busy ? task?.status === "running" ? "正在处理" : "正在提交" : `开始处理 · ${selected.pricePoints || 0} 积分`}
                  </>
                )}
              </button>
            </div>
            <div className={`mt-result-pane${isImageUpscale && busy ? " is-live" : ""}`}>
              <div className="mt-pane-title">
                <span>
                  <strong>{isImageUpscale ? "高清结果预览" : "处理结果预览"}</strong>
                  <small>{task ? ({ queued: "排队中", running: "处理中", succeeded: "已完成", failed: "处理失败" }[task.status] || task.status) : "完成后将在此显示"}</small>
                </span>
                {busy ? <span className="mt-live"><i />任务进行中</span> : <span className="mt-step">02</span>}
              </div>
              <ResultPreview task={task} tool={selected} sourcePreview={sourcePreview} upscale={isImageUpscale} busy={busy} />
            </div>
        </section>
      </div>
    </main>
  );
}
