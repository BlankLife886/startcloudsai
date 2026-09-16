import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import {
  SKILL_TASK_TYPES,
  skillTaskTypeLabel,
} from "./skillComposition.js";

const NAME_MAX = 64;
const DESCRIPTION_MAX = 500;
const INSTRUCTION_MAX = 4000;

function initialForm(skill) {
  return {
    name: skill?.name || "",
    description: skill?.description || "",
    instruction: skill?.instruction || "",
    taskTypes: Array.isArray(skill?.taskTypes) ? [...skill.taskTypes] : [],
  };
}

/**
 * 自建 Skill 的新建/编辑弹层。
 *
 * 自建 Skill 只有一段自由填写的指令，和官方 Skill 同构；启用状态不开放给用户，
 * 要停止生效应当取消装载。
 */
export default function SkillEditorDialog({ open, skill, saving, error, onClose, onSubmit }) {
  const [form, setForm] = useState(() => initialForm(skill));
  const [touched, setTouched] = useState(false);
  const nameRef = useRef(null);

  // 每次打开都按当前 skill 重置，避免残留上一次的编辑内容。
  useEffect(() => {
    if (!open) return;
    setForm(initialForm(skill));
    setTouched(false);
    const timer = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open, skill]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const invalid = useMemo(
    () => !form.name.trim() || !form.instruction.trim(),
    [form.name, form.instruction],
  );

  if (!open) return null;

  function update(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggleTaskType(taskType) {
    update({
      taskTypes: form.taskTypes.includes(taskType)
        ? form.taskTypes.filter((item) => item !== taskType)
        : [...form.taskTypes, taskType],
    });
  }

  function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (invalid || saving) return;
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim(),
      instruction: form.instruction.trim(),
      taskTypes: form.taskTypes,
    });
  }

  return (
    <div className="skills-modal" role="presentation" onMouseDown={onClose}>
      <form
        className="skills-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <header className="skills-modal__head">
          <div>
            <h2 id="skill-editor-title">
              {skill?.id ? "编辑 Skill" : skill?.name ? "复制为自建 Skill" : "新建 Skill"}
            </h2>
            <p>
              {skill?.id
                ? "指令会拼进你的生图提示词，写成可直接执行的画面要求"
                : skill?.name
                  ? "官方 Skill 只读，复制一份后可以按自己的习惯改"
                  : "指令会拼进你的生图提示词，写成可直接执行的画面要求"}
            </p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="skills-modal__body">
          <label className="skills-field">
            <span className="skills-field__label">
              名称
              <i>必填</i>
            </span>
            <input
              ref={nameRef}
              value={form.name}
              maxLength={NAME_MAX}
              placeholder="例如：柔光人像"
              aria-invalid={touched && !form.name.trim()}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>

          <label className="skills-field">
            <span className="skills-field__label">简介</span>
            <input
              value={form.description}
              maxLength={DESCRIPTION_MAX}
              placeholder="一句话说明它解决什么问题，便于日后自己辨认"
              onChange={(event) => update({ description: event.target.value })}
            />
          </label>

          <label className="skills-field">
            <span className="skills-field__label">
              指令内容
              <i>必填</i>
            </span>
            <textarea
              value={form.instruction}
              maxLength={INSTRUCTION_MAX}
              rows={7}
              placeholder="例如：使用柔和顶光，背景纯净，主体居中，肤色自然通透。"
              aria-invalid={touched && !form.instruction.trim()}
              onChange={(event) => update({ instruction: event.target.value })}
            />
            <span className="skills-field__count">
              {form.instruction.length}
              <i>/ {INSTRUCTION_MAX}</i>
            </span>
          </label>

          <div className="skills-field">
            <span className="skills-field__label">
              适用页面
              <i>不选即全部通用</i>
            </span>
            <div className="skills-chipset" role="group" aria-label="适用页面">
              {SKILL_TASK_TYPES.map((taskType) => (
                <button
                  key={taskType}
                  type="button"
                  className="skills-chip"
                  aria-pressed={form.taskTypes.includes(taskType)}
                  onClick={() => toggleTaskType(taskType)}
                >
                  {skillTaskTypeLabel(taskType)}
                </button>
              ))}
            </div>
          </div>

          {touched && invalid && (
            <p className="skills-inline-error" role="alert">
              名称和指令内容都要填写。
            </p>
          )}
          {error && (
            <p className="skills-inline-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="skills-modal__foot">
          <span>保存后可在装载配置里选择生效范围</span>
          <div>
            <button type="button" className="skills-button" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="skills-button is-primary" disabled={saving}>
              {saving && <Loader2 className="skills-spin" size={15} />}
              {skill?.id ? "保存修改" : "创建 Skill"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
