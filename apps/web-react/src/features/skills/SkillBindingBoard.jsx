import {
  Box,
  Gamepad2,
  Globe2,
  Info,
  LayoutTemplate,
  Palette,
  Plus,
  ShoppingBag,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";

import {
  SKILL_GLOBAL_SCOPE,
  SKILL_TASK_TYPES,
  SKILL_TASK_TYPE_META,
  resolveBoundSkillIds,
  skillTaskTypeLabel,
} from "./skillComposition.js";

const SCOPE_ICONS = {
  t2i: Sparkles,
  coloring: Palette,
  ui_design: LayoutTemplate,
  ecommerce_design: ShoppingBag,
  model_sheet: Box,
  game_art: Gamepad2,
};

function SkillChips({ skills, onRemove, muted }) {
  return (
    <ul className={"skills-slot__chips" + (muted ? " is-muted" : "")}>
      {skills.map((skill) => (
        <li key={skill.id}>
          <span>{skill.name}</span>
          {onRemove && (
            <button type="button" aria-label={`取消装载 ${skill.name}`} onClick={() => onRemove(skill)}>
              <X size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SlotCount({ current, max }) {
  return (
    <em className="skills-slot__count tnum" aria-label={`已装载 ${current} / ${max}`}>
      {current}
      <i>/</i>
      {max}
    </em>
  );
}

/**
 * 装载总览：一眼看清每个生图页面最终生效哪些 Skill。
 *
 * 页面绑定会完整覆盖全局，这条规则只靠单个 Skill 的开关是看不出来的，
 * 所以这里按"装载位"组织，并把被覆盖的全局 Skill 明确标出来。
 */
export default function SkillBindingBoard({
  bindings,
  skillsById,
  maxPerScope,
  busyScope,
  onRemove,
  onClear,
  onAdd,
}) {
  const globalIds = bindings[SKILL_GLOBAL_SCOPE] || [];
  const globalSkills = globalIds.map((id) => skillsById.get(id)).filter(Boolean);

  return (
    <div className="skills-board">
      <p className="skills-board__intro">
        <Info size={15} aria-hidden="true" />
        <span>
          全局装载对所有生图页面生效。某个页面单独装载后，该页面<strong>只用它自己的</strong>
          Skill，不再叠加全局 —— 每个装载位最多 {maxPerScope} 个。
        </span>
      </p>

      <section className={"skills-slot is-global" + (busyScope === SKILL_GLOBAL_SCOPE ? " is-busy" : "")}>
        <header>
          <span className="skills-slot__icon">
            <Globe2 size={17} aria-hidden="true" />
          </span>
          <div>
            <h3>全局装载</h3>
            <p>没有单独配置的页面都用这里的 Skill</p>
          </div>
          <div className="skills-slot__actions">
            <SlotCount current={globalSkills.length} max={maxPerScope} />
            <button
              type="button"
              className="skills-button is-ghost"
              disabled={globalSkills.length >= maxPerScope}
              onClick={() => onAdd(SKILL_GLOBAL_SCOPE)}
            >
              <Plus size={14} />
              添加
            </button>
          </div>
        </header>
        {globalSkills.length ? (
          <SkillChips skills={globalSkills} onRemove={(skill) => onRemove(SKILL_GLOBAL_SCOPE, skill)} />
        ) : (
          <p className="skills-slot__empty">未装载，生图时不会附加任何 Skill</p>
        )}
      </section>

      <div className="skills-board__grid">
        {SKILL_TASK_TYPES.map((taskType) => {
          const own = bindings[taskType] || [];
          const overrides = own.length > 0;
          const effective = resolveBoundSkillIds(bindings, taskType)
            .map((id) => skillsById.get(id))
            .filter(Boolean);
          const meta = SKILL_TASK_TYPE_META[taskType];
          const Icon = SCOPE_ICONS[taskType] || Sparkles;
          return (
            <section
              key={taskType}
              className={
                "skills-slot" +
                (overrides ? " is-overriding" : "") +
                (busyScope === taskType ? " is-busy" : "")
              }
            >
              <header>
                <span className="skills-slot__icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div>
                  <h3>
                    {meta?.href ? (
                      <a href={meta.href}>{skillTaskTypeLabel(taskType)}</a>
                    ) : (
                      skillTaskTypeLabel(taskType)
                    )}
                  </h3>
                  <p>{overrides ? "已覆盖全局" : "跟随全局"}</p>
                </div>
                <div className="skills-slot__actions">
                  <SlotCount current={overrides ? own.length : 0} max={maxPerScope} />
                  <button
                    type="button"
                    className="skills-button is-ghost"
                    disabled={own.length >= maxPerScope}
                    onClick={() => onAdd(taskType)}
                  >
                    <Plus size={14} />
                    添加
                  </button>
                </div>
              </header>
              {effective.length ? (
                <SkillChips
                  skills={effective}
                  muted={!overrides}
                  onRemove={overrides ? (skill) => onRemove(taskType, skill) : undefined}
                />
              ) : (
                <p className="skills-slot__empty">不附加任何 Skill</p>
              )}
              {!overrides && effective.length > 0 && (
                <p className="skills-slot__hint">来自全局装载</p>
              )}
              {overrides && (
                <button
                  type="button"
                  className="skills-slot__restore"
                  onClick={() => onClear(taskType)}
                >
                  <Undo2 size={13} />
                  恢复跟随全局
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
