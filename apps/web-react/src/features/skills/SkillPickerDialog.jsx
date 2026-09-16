import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";

import {
  SKILL_GLOBAL_SCOPE,
  skillAppliesTo,
  skillTaskTypeLabel,
} from "./skillComposition.js";

/**
 * 往某个装载位添加 Skill。
 *
 * 只列出该装载位真正能用的 Skill：适用页面不匹配的、已经装载的都不再出现，
 * 免得用户选完才被服务端拒绝。
 */
export default function SkillPickerDialog({
  open,
  scope,
  skills,
  boundIds,
  remaining,
  saving,
  error,
  onClose,
  onConfirm,
}) {
  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setQuery("");
  }, [open, scope]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const candidates = useMemo(() => {
    if (!open) return [];
    const bound = new Set(boundIds);
    const keyword = query.trim().toLocaleLowerCase();
    return skills.filter((skill) => {
      if (bound.has(skill.id)) return false;
      if (!skillAppliesTo(skill, scope)) return false;
      if (!keyword) return true;
      return `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(keyword);
    });
  }, [open, skills, boundIds, scope, query]);

  if (!open) return null;

  const scopeLabel = scope === SKILL_GLOBAL_SCOPE ? "全局" : skillTaskTypeLabel(scope);
  const full = picked.length >= remaining;

  function toggle(skill) {
    setPicked((current) =>
      current.includes(skill.id)
        ? current.filter((id) => id !== skill.id)
        : current.length >= remaining
          ? current
          : [...current, skill.id],
    );
  }

  return (
    <div className="skills-modal" role="presentation" onMouseDown={onClose}>
      <div
        className="skills-modal__panel is-compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="skills-modal__head">
          <div>
            <h2 id="skill-picker-title">装载到{scopeLabel}</h2>
            <p>还可以再添加 {remaining} 个</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="skills-modal__body">
          <label className="skills-search is-inset">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              aria-label="搜索可装载的 Skill"
              placeholder="搜索 Skill"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {candidates.length ? (
            <ul className="skills-picker">
              {candidates.map((skill) => {
                const active = picked.includes(skill.id);
                return (
                  <li key={skill.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      disabled={!active && full}
                      onClick={() => toggle(skill)}
                    >
                      <span className="skills-picker__mark">{active && <Check size={13} />}</span>
                      <span className="skills-picker__copy">
                        <strong>{skill.name}</strong>
                        <small>{skill.description || "没有填写简介"}</small>
                      </span>
                      <span className="skills-picker__origin">{skill.official ? "官方" : "自建"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="skills-modal__empty">
              {query.trim() ? "没有匹配的 Skill。" : `没有可装载到${scopeLabel}的 Skill 了。`}
            </p>
          )}

          {error && (
            <p className="skills-inline-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="skills-modal__foot">
          <span>已选 {picked.length} 个</span>
          <div>
            <button type="button" className="skills-button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="skills-button is-primary"
              disabled={!picked.length || saving}
              onClick={() => onConfirm(picked)}
            >
              {saving && <Loader2 className="skills-spin" size={15} />}
              确认装载
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
