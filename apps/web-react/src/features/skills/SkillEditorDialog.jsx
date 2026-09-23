import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";

import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_FILE_EXTENSIONS,
  SKILL_INSTRUCTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_SLUG_MAX_LENGTH,
  SKILL_STORAGE_CLOUD,
  SKILL_STORAGE_LABELS,
  SKILL_STORAGE_LOCAL,
  isValidSkillSlug,
  parseSkillMarkdown,
  readSkillFile,
  serializeSkillMarkdown,
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
    tags: Array.isArray(skill?.tags) ? skill.tags.join("，") : "",
  };
}

function formFromParsed(skill) {
  return {
    name: skill?.name || "",
    slug: skill?.slug || "",
    description: skill?.description || "",
    instruction: skill?.instruction || "",
    tags: Array.isArray(skill?.tags) ? skill.tags.join("，") : "",
  };
}

function asSkillFields(form) {
  return {
    slug: String(form.slug || "").trim(),
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim(),
    instruction: String(form.instruction || "").trim(),
    tags: parseTags(form.tags),
  };
}

function slugError(slug) {
  const value = String(slug || "").trim();
  if (!value) return "";
  return isValidSkillSlug(value) ? "" : "调用名只能用小写字母、数字和连字符，以字母开头";
}

/**
 * 新建 / 编辑技能。表单与 SKILL.md 互通；新建时可选本地或云端。
 */
export default function SkillEditorDialog({
  open,
  skill,
  saving,
  error,
  initialWarnings,
  signedIn,
  quota,
  onClose,
  onSubmit,
  onRequestAuth,
}) {
  const isEdit = Boolean(skill?.id);
  const [form, setForm] = useState(() => initialForm(skill));
  const [slugManual, setSlugManual] = useState(Boolean(skill?.slug));
  const [mode, setMode] = useState("form");
  const [markdown, setMarkdown] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [touched, setTouched] = useState(false);
  const [storage, setStorage] = useState(skill?.storage || SKILL_STORAGE_LOCAL);
  const nameRef = useRef(null);
  const importRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const next = initialForm(skill);
    setForm(next);
    setSlugManual(Boolean(skill?.slug));
    setMode("form");
    setMarkdown("");
    setWarnings(Array.isArray(initialWarnings) ? [...initialWarnings] : []);
    setTouched(false);
    setStorage(skill?.storage === SKILL_STORAGE_CLOUD ? SKILL_STORAGE_CLOUD : SKILL_STORAGE_LOCAL);
    const timer = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open, skill, initialWarnings]);

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

  const cloudUsed = quota?.cloud?.used ?? 0;
  const cloudMax = quota?.cloud?.max ?? 5;
  const cloudFull = cloudUsed >= cloudMax;
  const cloudDisabled = !signedIn || cloudFull;
  const cloudHint = !signedIn
    ? "登录后才能保存到云端"
    : cloudFull
      ? `云端已满（${cloudUsed}/${cloudMax}），删除或移到本地后再试`
      : `将同步到当前账号，最多 ${cloudMax} 个`;

  if (!open) return null;

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

  async function importFromFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseSkillMarkdown(await readSkillFile(file));
      applyParsed({ skill: parsed.skill, warnings: ["文件内容已填入表单，保存前请检查正文。", ...parsed.warnings] });
    } catch (importError) {
      setWarnings([importError instanceof Error ? importError.message : "导入 SKILL.md 失败"]);
    }
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
    }
    const nextInvalid =
      !payload.name || !payload.instruction || Boolean(slugError(payload.slug));
    if (nextInvalid || saving) return;
    const target = isEdit ? skill.storage : storage;
    if (!isEdit && target === SKILL_STORAGE_CLOUD && cloudDisabled) {
      if (!signedIn) onRequestAuth?.();
      return;
    }
    onSubmit(payload, target);
  }

  return (
    <div className="skills-scrim is-center" role="presentation" onMouseDown={onClose}>
      <form
        className="skills-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <header className="skills-modal__head">
          <div>
            <h2 id="skill-editor-title">{isEdit ? "编辑技能" : "新建技能"}</h2>
            <p>名称和简介用来挑选；正文只在提交时展开进提示词。</p>
          </div>
          <div className="skills-modal__head-tools">
            <div className="skills-tabs is-mini" role="tablist" aria-label="编辑方式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "form"}
                onClick={() => switchMode("form")}
              >
                表单
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "markdown"}
                onClick={() => switchMode("markdown")}
              >
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
            onChange={importFromFile}
          />

          {isEdit ? (
            <p className="skills-editor__storage-note">
              保存在{SKILL_STORAGE_LABELS[skill.storage] || "本地"}，编辑时不可更改位置
            </p>
          ) : (
            <div className="skills-field">
              <span className="skills-field__label">保存到</span>
              <div className="skills-tabs" role="group" aria-label="保存到">
                <button
                  type="button"
                  aria-pressed={storage === SKILL_STORAGE_LOCAL}
                  onClick={() => chooseStorage(SKILL_STORAGE_LOCAL)}
                >
                  本地
                </button>
                <button
                  type="button"
                  aria-pressed={storage === SKILL_STORAGE_CLOUD}
                  aria-disabled={cloudDisabled}
                  disabled={cloudDisabled}
                  title={cloudHint}
                  onClick={() => chooseStorage(SKILL_STORAGE_CLOUD)}
                >
                  云端（{cloudUsed}/{cloudMax}）
                </button>
              </div>
              <span className="skills-field__hint">
                {storage === SKILL_STORAGE_CLOUD ? cloudHint : "仅保存在此浏览器"}
                {!signedIn && (
                  <>
                    {" · "}
                    <button type="button" className="skills-text-link" onClick={() => onRequestAuth?.()}>
                      登录
                    </button>
                  </>
                )}
              </span>
            </div>
          )}

          {mode === "markdown" ? (
            <label className="skills-field">
              <span className="skills-field__label">
                SKILL.md
                <i>frontmatter 的 name 即调用名</i>
              </span>
              <textarea
                className="is-mono"
                value={markdown}
                rows={16}
                spellCheck={false}
                aria-label="SKILL.md"
                onChange={(event) => setMarkdown(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="skills-field">
                <span className="skills-field__label">
                  名称
                  <i>必填</i>
                </span>
                <input
                  ref={nameRef}
                  value={form.name}
                  maxLength={SKILL_NAME_MAX_LENGTH}
                  placeholder="例如：柔光人像"
                  aria-invalid={touched && !form.name.trim()}
                  onChange={(event) => updateName(event.target.value)}
                />
              </label>

              <label className="skills-field">
                <span className="skills-field__label">
                  调用名
                  <i>选填</i>
                </span>
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
                  <span className="skills-field__hint">用于 SKILL.md 与 @ 调用，留空自动生成</span>
                )}
              </label>

              <label className="skills-field">
                <span className="skills-field__label">简介</span>
                <input
                  value={form.description}
                  maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
                  placeholder="例如：柔和顶光，背景干净，适合人像与产品特写"
                  onChange={(event) => update({ description: event.target.value })}
                />
                <span className="skills-field__hint">一句话说明做什么、什么时候用</span>
              </label>

              <label className="skills-field">
                <span className="skills-field__label">
                  正文
                  <i>必填</i>
                </span>
                <textarea
                  value={form.instruction}
                  maxLength={SKILL_INSTRUCTION_MAX_LENGTH}
                  rows={7}
                  placeholder="例如：使用柔和顶光，背景纯净，主体居中，肤色自然通透。"
                  aria-invalid={touched && !form.instruction.trim()}
                  onChange={(event) => update({ instruction: event.target.value })}
                />
                <span className="skills-field__count">
                  {form.instruction.length}
                  <i>/ {SKILL_INSTRUCTION_MAX_LENGTH}</i>
                </span>
              </label>

              <label className="skills-field">
                <span className="skills-field__label">标签</span>
                <input
                  value={form.tags}
                  placeholder="人像，产品，室内"
                  onChange={(event) => update({ tags: event.target.value })}
                />
                <span className="skills-field__hint">逗号分隔，可留空</span>
              </label>
            </>
          )}

          <div className="skills-editor__import">
            <button type="button" className="skill-btn" onClick={() => importRef.current?.click()}>
              <Upload size={15} />
              从文件导入
            </button>
          </div>

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

        <footer className="skills-modal__foot">
          <span>保存后在输入框输入 @ 即可调用</span>
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
      </form>
    </div>
  );
}
