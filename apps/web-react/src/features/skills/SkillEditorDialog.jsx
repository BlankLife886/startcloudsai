import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, ChevronDown, Cloud, Download, FileUp, HardDrive, Loader2, PencilLine, X } from "lucide-react";

import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_FILE_EXTENSIONS,
  SKILL_FILE_MAX_BYTES,
  SKILL_INSTRUCTION_MAX_LENGTH,
  SKILL_MARKDOWN_TEMPLATE,
  SKILL_USAGE_GUIDE_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_SLUG_MAX_LENGTH,
  SKILL_STORAGE_CLOUD,
  SKILL_STORAGE_LABELS,
  SKILL_STORAGE_LOCAL,
  SKILL_TAG_MAX_LENGTH,
  SKILL_TAGS_MAX,
  isValidSkillSlug,
  parseSkillMarkdown,
  readSkillFile,
  sanitizeSkillTags,
  serializeSkillMarkdown,
  skillMentionToken,
  slugifySkillName,
} from "./skillComposition.js";

function parseTags(text) {
  return String(text || "")
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function initialForm(skill) {
  return {
    name: skill?.name || "",
    slug: skill?.slug || slugifySkillName(skill?.name) || "",
    description: skill?.description || "",
    instruction: skill?.instruction || "",
    usageGuide: skill?.usageGuide || "",
    tags: Array.isArray(skill?.tags) ? skill.tags.join("，") : "",
  };
}

function formFromParsed(skill) {
  return {
    name: skill?.name || "",
    slug: skill?.slug || "",
    description: skill?.description || "",
    instruction: skill?.instruction || "",
    usageGuide: skill?.usageGuide || "",
    tags: Array.isArray(skill?.tags) ? skill.tags.join("，") : "",
  };
}

function asSkillFields(form) {
  return {
    slug: String(form.slug || "").trim(),
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim(),
    instruction: String(form.instruction || "").trim(),
    // 使用说明随 SKILL.md 导入导出（metadata.usage），编辑时必须带上，否则保存会把它清空。
    usageGuide: String(form.usageGuide || "").trim(),
    tags: parseTags(form.tags),
  };
}

function slugError(slug) {
  const value = String(slug || "").trim();
  if (!value) return "";
  return isValidSkillSlug(value) ? "" : "调用名只能用小写字母、数字和连字符，以字母开头";
}

function charCount(text) {
  return Array.from(String(text || "")).length;
}

function downloadTemplate() {
  const blob = new Blob([SKILL_MARKDOWN_TEMPLATE], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "SKILL.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 带字数统计的字段标题行。 */
function FieldLabel({ children, tag, count, max }) {
  return (
    <span className="skills-field__label">
      {children}
      {tag ? <i>{tag}</i> : null}
      {max ? (
        <span className={`skills-field__count${count > max ? " is-over" : ""}`}>
          {count}
          <i>/ {max}</i>
        </span>
      ) : null}
    </span>
  );
}

/** SKILL.md 格式说明：写给要上传文件的用户看。 */
function SkillFormatHelp() {
  return (
    <details className="skills-format-help">
      <summary>
        SKILL.md 怎么写
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <ul>
        <li>
          开头用两行 <code>---</code> 包住信息区：<code>name</code> 是调用名（小写字母、数字、连字符），
          <code>description</code> 是一句话简介。
        </li>
        <li>
          中文显示名、标签、使用说明写在 <code>metadata</code> 下的 <code>display-name</code>、<code>tags</code>、
          <code>usage</code>。没有显示名时取正文第一个 <code># 标题</code>。
        </li>
        <li>第二个 <code>---</code> 之后都是正文，就是调用时拼进提示词的要求，最多 {SKILL_INSTRUCTION_MAX_LENGTH} 字。</li>
        <li>
          只读这一个文件，Codex / Claude 技能目录里配套的 <code>scripts/</code>、<code>references/</code> 不会带上，需要的内容请直接写进正文。
        </li>
        <li>
          支持 {SKILL_FILE_EXTENSIONS.join(" / ")}，不超过 {Math.round(SKILL_FILE_MAX_BYTES / 1024)} KB，UTF-8 或 GBK 编码。
        </li>
      </ul>
      <pre className="skills-format-help__sample">{SKILL_MARKDOWN_TEMPLATE.trim()}</pre>
    </details>
  );
}

/**
 * 新建 / 编辑技能。表单与 SKILL.md 互通；新建时可选本地或云端。
 */
const EXIT_MS = 200;

export default function SkillEditorDialog({
  open,
  skill: skillProp,
  saving,
  error,
  initialWarnings,
  signedIn,
  quota,
  existingSkills = [],
  onClose,
  onSubmit,
  onRequestAuth,
}) {
  // 关闭时父组件会立刻清空 skill，退场动画期间沿用最后一次打开时的内容。
  const lastSkillRef = useRef(skillProp);
  if (open) lastSkillRef.current = skillProp;
  const skill = open ? skillProp : lastSkillRef.current;
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const isEdit = Boolean(skill?.id);
  const [form, setForm] = useState(() => initialForm(skill));
  const [slugManual, setSlugManual] = useState(Boolean(skill?.slug));
  const [mode, setMode] = useState("form");
  const [markdown, setMarkdown] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [touched, setTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [storage, setStorage] = useState(skill?.storage || SKILL_STORAGE_LOCAL);
  const initialSnapshotRef = useRef("");
  const nameRef = useRef(null);
  const importRef = useRef(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const next = initialForm(skill);
    setForm(next);
    initialSnapshotRef.current = JSON.stringify(next);
    setSlugManual(Boolean(skill?.slug));
    setMode("form");
    setMarkdown("");
    setWarnings(Array.isArray(initialWarnings) ? [...initialWarnings] : []);
    setTouched(false);
    setDragging(false);
    dragDepthRef.current = 0;
    setStorage(skill?.storage === SKILL_STORAGE_CLOUD ? SKILL_STORAGE_CLOUD : SKILL_STORAGE_LOCAL);
    const timer = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open, skill, initialWarnings]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const currentSlugError = slugError(form.slug);
  const invalid = useMemo(
    () => !form.name.trim() || !form.instruction.trim() || Boolean(currentSlugError),
    [form.name, form.instruction, currentSlugError],
  );
  const dirty = mode === "markdown" || JSON.stringify(form) !== initialSnapshotRef.current;

  const tagPreview = useMemo(() => sanitizeSkillTags(form.tags), [form.tags]);
  const rawTagCount = parseTags(form.tags).length;
  const longTag = parseTags(form.tags).some((tag) => charCount(tag) > SKILL_TAG_MAX_LENGTH);
  const token = skillMentionToken({ name: form.name.trim(), slug: form.slug.trim() });

  // 同名或同调用名会让 @ 只命中其中一个，保存前提醒（本地同调用名保存时会被拦下）。
  const conflict = useMemo(() => {
    const name = form.name.trim();
    const slug = form.slug.trim();
    if (!name && !slug) return null;
    return (
      existingSkills.find(
        (item) =>
          item.id !== skill?.id &&
          ((name && String(item.name || "").trim() === name) || (slug && item.slug === slug)),
      ) || null
    );
  }, [existingSkills, form.name, form.slug, skill?.id]);

  const cloudUsed = quota?.cloud?.used ?? 0;
  const cloudMax = quota?.cloud?.max ?? 5;
  const cloudFull = cloudUsed >= cloudMax;
  const cloudDisabled = !signedIn || cloudFull;
  const cloudHint = !signedIn
    ? "登录后才能保存到云端"
    : cloudFull
      ? `云端已满（${cloudUsed}/${cloudMax}），删除或移到本地后再试`
      : `跟随账号同步，最多 ${cloudMax} 个`;

  if (!open && !mounted) return null;

  function update(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateName(name) {
    setForm((current) => ({
      ...current,
      name,
      slug: slugManual ? current.slug : slugifySkillName(name),
    }));
  }

  function applyParsed({ skill: parsed, warnings: nextWarnings }) {
    const next = formFromParsed(parsed);
    setForm(next);
    setSlugManual(Boolean(next.slug));
    setWarnings(nextWarnings);
    setMode("form");
    setMarkdown("");
  }

  function switchMode(next) {
    if (next === mode) return;
    if (next === "markdown") {
      setMarkdown(serializeSkillMarkdown(asSkillFields(form)));
      setMode("markdown");
      return;
    }
    applyParsed(parseSkillMarkdown(markdown));
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const parsed = parseSkillMarkdown(await readSkillFile(file));
      applyParsed({ skill: parsed.skill, warnings: [`已导入「${file.name}」，保存前请检查内容。`, ...parsed.warnings] });
    } catch (importError) {
      setWarnings([importError instanceof Error ? importError.message : "导入 SKILL.md 失败"]);
    }
  }

  function importFromInput(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    importFile(file);
  }

  function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function onDragEnter(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function onDragLeave(event) {
    if (!hasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  function onDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    importFile(event.dataTransfer.files?.[0]);
  }

  function chooseStorage(next) {
    if (next === SKILL_STORAGE_CLOUD && cloudDisabled) {
      if (!signedIn) onRequestAuth?.();
      return;
    }
    setStorage(next);
  }

  function submit(event) {
    event.preventDefault();
    setTouched(true);
    let payload = asSkillFields(form);
    if (mode === "markdown") {
      const parsed = parseSkillMarkdown(markdown);
      const nextForm = formFromParsed(parsed.skill);
      payload = asSkillFields(nextForm);
      setForm(nextForm);
      setWarnings(parsed.warnings);
      setSlugManual(Boolean(nextForm.slug));
      // 解析不出名称或正文时回到表单，让用户直接看到哪里缺了。
      if (!payload.name || !payload.instruction) setMode("form");
    }
    const nextInvalid = !payload.name || !payload.instruction || Boolean(slugError(payload.slug));
    if (nextInvalid || saving) return;
    const target = isEdit ? skill.storage : storage;
    if (!isEdit && target === SKILL_STORAGE_CLOUD && cloudDisabled) {
      if (!signedIn) onRequestAuth?.();
      return;
    }
    onSubmit(payload, target);
  }

  const storageOptions = [
    {
      value: SKILL_STORAGE_LOCAL,
      icon: HardDrive,
      label: "本地",
      hint: "只存在这个浏览器",
      disabled: false,
    },
    {
      value: SKILL_STORAGE_CLOUD,
      icon: Cloud,
      label: `云端 ${cloudUsed}/${cloudMax}`,
      hint: cloudHint,
      disabled: cloudDisabled,
    },
  ];

  return (
    <div
      className={`skills-scrim is-center is-modal${closing ? " is-closing" : ""}`}
      role="presentation"
      // 填了内容时点遮罩不关闭，避免误触丢稿；✕ / 取消 / Esc 仍可关闭。
      onMouseDown={open && !dirty ? onClose : undefined}
    >
      <form
        className={`skills-modal skills-editor${dragging ? " is-dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
        onDragEnter={onDragEnter}
        onDragOver={(event) => hasFiles(event) && event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        noValidate
      >
        <header className="skills-modal__head">
          <span className="skills-editor__head-icon" aria-hidden="true">
            <PencilLine size={18} />
          </span>
          <div className="skills-editor__head-text">
            <h2 id="skill-editor-title">{isEdit ? "编辑技能" : "新建技能"}</h2>
            <p>把反复要写的要求存成技能，在输入框里 @ 它就会拼进提示词。</p>
          </div>
          <div className="skills-modal__head-tools">
            <div className="skills-tabs is-mini" role="tablist" aria-label="编辑方式">
              <button type="button" role="tab" aria-selected={mode === "form"} onClick={() => switchMode("form")}>
                表单
              </button>
              <button type="button" role="tab" aria-selected={mode === "markdown"} onClick={() => switchMode("markdown")}>
                SKILL.md
              </button>
            </div>
            <button type="button" className="skills-icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="skills-modal__body">
          <input
            ref={importRef}
            className="skills-sr-file"
            type="file"
            accept={SKILL_FILE_EXTENSIONS.join(",")}
            aria-hidden="true"
            tabIndex={-1}
            onChange={importFromInput}
          />

          <div className="skills-editor__grid">
            <div className="skills-editor__main">
              {mode === "markdown" ? (
                <label className="skills-field">
                  <FieldLabel tag="frontmatter 的 name 即调用名">SKILL.md</FieldLabel>
                  <textarea
                    className="is-mono"
                    value={markdown}
                    rows={20}
                    spellCheck={false}
                    aria-label="SKILL.md"
                    onChange={(event) => setMarkdown(event.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label className="skills-field">
                    <FieldLabel tag="必填" count={charCount(form.name)} max={SKILL_NAME_MAX_LENGTH}>
                      名称
                    </FieldLabel>
                    <input
                      ref={nameRef}
                      value={form.name}
                      maxLength={SKILL_NAME_MAX_LENGTH}
                      placeholder="例如：柔光人像"
                      aria-invalid={touched && !form.name.trim()}
                      onChange={(event) => updateName(event.target.value)}
                    />
                    {conflict ? (
                      <span className="skills-field__warn">
                        和{SKILL_STORAGE_LABELS[conflict.storage] || ""}技能「{conflict.name}」重名，@ 时可能调到它，建议换个名字
                      </span>
                    ) : null}
                  </label>

                  <label className="skills-field">
                    <FieldLabel count={charCount(form.description)} max={SKILL_DESCRIPTION_MAX_LENGTH}>
                      简介
                    </FieldLabel>
                    <input
                      value={form.description}
                      maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
                      placeholder="一句话说明做什么、什么时候用，会显示在 @ 菜单里"
                      onChange={(event) => update({ description: event.target.value })}
                    />
                  </label>

                  <label className="skills-field">
                    <FieldLabel tag="必填" count={charCount(form.instruction)} max={SKILL_INSTRUCTION_MAX_LENGTH}>
                      正文
                    </FieldLabel>
                    <textarea
                      value={form.instruction}
                      maxLength={SKILL_INSTRUCTION_MAX_LENGTH}
                      rows={9}
                      placeholder={"调用时拼进提示词的具体要求，例如：\n使用柔和顶光，背景纯净，主体居中，肤色自然通透。"}
                      aria-invalid={touched && !form.instruction.trim()}
                      onChange={(event) => update({ instruction: event.target.value })}
                    />
                  </label>

                  <label className="skills-field">
                    <FieldLabel tag="选填" count={charCount(form.usageGuide)} max={SKILL_USAGE_GUIDE_MAX_LENGTH}>
                      使用说明
                    </FieldLabel>
                    <textarea
                      className="is-short"
                      value={form.usageGuide}
                      maxLength={SKILL_USAGE_GUIDE_MAX_LENGTH}
                      rows={3}
                      placeholder="写给自己或分享对象看的用法和示例，以 @ 开头的行会显示为可复制的示例。"
                      onChange={(event) => update({ usageGuide: event.target.value })}
                    />
                  </label>
                </>
              )}
            </div>

            <aside className="skills-editor__side">
              <section className="skills-editor__card">
                <h3>保存到</h3>
                {isEdit ? (
                  <p className="skills-editor__storage-note">
                    保存在{SKILL_STORAGE_LABELS[skill.storage] || "本地"}，编辑时不能更改位置；可在详情里移动。
                  </p>
                ) : (
                  <div className="skills-storage-options" role="radiogroup" aria-label="保存到">
                    {storageOptions.map(({ value, icon: Icon, label, hint, disabled }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={storage === value}
                        aria-disabled={disabled}
                        className={`skills-storage-option${storage === value ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
                        onClick={() => chooseStorage(value)}
                      >
                        <Icon size={16} aria-hidden="true" />
                        <span>
                          <strong>{label}</strong>
                          <small>{hint}</small>
                        </span>
                      </button>
                    ))}
                    {!signedIn && (
                      <button type="button" className="skills-text-link" onClick={() => onRequestAuth?.()}>
                        登录后可存到云端
                      </button>
                    )}
                  </div>
                )}
              </section>

              {mode === "form" && (
                <section className="skills-editor__card">
                  <h3>调用方式</h3>
                  <label className="skills-field">
                    <FieldLabel tag="选填">调用名</FieldLabel>
                    <input
                      value={form.slug}
                      maxLength={SKILL_SLUG_MAX_LENGTH}
                      placeholder="例如：soft-light"
                      spellCheck={false}
                      aria-invalid={Boolean(form.slug.trim() && currentSlugError)}
                      onChange={(event) => {
                        setSlugManual(true);
                        update({ slug: event.target.value.toLowerCase() });
                      }}
                    />
                    {form.slug.trim() && currentSlugError ? (
                      <span className="skills-field__error">{currentSlugError}</span>
                    ) : (
                      <span className="skills-field__hint">SKILL.md 里的 name，留空自动生成</span>
                    )}
                  </label>
                  <div className="skills-editor__token">
                    <AtSign size={14} aria-hidden="true" />
                    <span>输入框里这样调用</span>
                    {token ? <code className="skill-token">{token}</code> : <em>填写名称后显示</em>}
                  </div>
                </section>
              )}

              {mode === "form" && (
                <section className="skills-editor__card">
                  <h3>标签</h3>
                  <label className="skills-field">
                    <input
                      value={form.tags}
                      aria-label="标签"
                      placeholder="人像，产品，室内"
                      onChange={(event) => update({ tags: event.target.value })}
                    />
                    <span className={`skills-field__hint${rawTagCount > SKILL_TAGS_MAX || longTag ? " is-warn" : ""}`}>
                      逗号分隔，最多 {SKILL_TAGS_MAX} 个，每个不超过 {SKILL_TAG_MAX_LENGTH} 字
                    </span>
                  </label>
                  {tagPreview.length > 0 && (
                    <ul className="skills-editor__tags">
                      {tagPreview.map((tag) => (
                        <li key={tag}>#{tag}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="skills-editor__card">
                <h3>从文件导入</h3>
                <button type="button" className="skills-dropzone" onClick={() => importRef.current?.click()}>
                  <FileUp size={20} aria-hidden="true" />
                  <strong>选择或拖入 SKILL.md</strong>
                  <small>
                    {SKILL_FILE_EXTENSIONS.join(" / ")} · 不超过 {Math.round(SKILL_FILE_MAX_BYTES / 1024)} KB
                  </small>
                </button>
                <button type="button" className="skills-text-link skills-editor__template" onClick={downloadTemplate}>
                  <Download size={13} aria-hidden="true" />
                  下载模板
                </button>
                <SkillFormatHelp />
              </section>
            </aside>
          </div>

          {(warnings.length > 0 || (touched && invalid) || error) && (
            <div className="skills-editor__messages">
              {warnings.map((warning) => (
                <p key={warning} className="skills-inline-warn" role="status">
                  {warning}
                </p>
              ))}
              {touched && invalid && (
                <p className="skills-inline-error" role="alert">
                  {currentSlugError || "名称和正文都要填写。"}
                </p>
              )}
              {error && (
                <p className="skills-inline-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="skills-modal__foot">
          <span>保存后在文生图、AI 电商、AI 助手、无限画布输入 @ 即可调用</span>
          <div>
            <button type="button" className="skill-btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="skill-btn is-primary" disabled={saving}>
              {saving && <Loader2 className="skills-spin" size={15} />}
              {isEdit ? "保存修改" : "创建技能"}
            </button>
          </div>
        </footer>

        {dragging && (
          <div className="skills-editor__drop" aria-hidden="true">
            <FileUp size={28} />
            <strong>松开导入 SKILL.md</strong>
            <span>会覆盖当前填写的内容</span>
          </div>
        )}
      </form>
    </div>
  );
}
