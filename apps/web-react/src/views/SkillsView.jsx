import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Copy,
  Globe2,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import SkillBindingBoard from "../features/skills/SkillBindingBoard.jsx";
import SkillEditorDialog from "../features/skills/SkillEditorDialog.jsx";
import SkillPickerDialog from "../features/skills/SkillPickerDialog.jsx";
import {
  SKILL_GLOBAL_SCOPE,
  SKILL_TASK_TYPES,
  skillAppliesTo,
  skillTaskTypeLabel,
} from "../features/skills/skillComposition.js";
import {
  createMySkill,
  deleteMySkill,
  listMySkills,
  setSkillBinding,
  updateMySkill,
} from "../features/skills/skillRuntime.js";
import "./skills.css";

const ORIGIN_TABS = [
  { value: "all", label: "全部" },
  { value: "official", label: "官方" },
  { value: "mine", label: "我的" },
];

function errorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return message || fallback;
}

/** 装载位列表：全局在前，其后是六个生图页面。 */
const ALL_SCOPES = [SKILL_GLOBAL_SCOPE, ...SKILL_TASK_TYPES];

function SkillDetail({
  skill,
  bindings,
  busyScope,
  maxPerScope,
  onToggleScope,
  onEdit,
  onDelete,
  onDuplicate,
}) {
  const globalIds = bindings[SKILL_GLOBAL_SCOPE] || [];
  const scopeState = ALL_SCOPES.map((scope) => {
    const ids = bindings[scope] || [];
    return {
      scope,
      loaded: ids.includes(skill.id),
      eligible: skillAppliesTo(skill, scope),
      full: ids.length >= maxPerScope && !ids.includes(skill.id),
    };
  });
  const loadedScopes = scopeState.filter((item) => item.loaded);

  return (
    <section className="skills-detail" aria-label={`${skill.name} 详情`}>
      <header className="skills-detail__head">
        <div className="skills-detail__identity">
          <span className={"skills-detail__emblem" + (skill.official ? " is-official" : "")}>
            {skill.official ? <BadgeCheck size={22} /> : <UserRound size={22} />}
          </span>
          <div>
            <div className="skills-detail__meta">
              <span>{skill.official ? "官方 Skill" : "我的 Skill"}</span>
              {skill.category && (
                <>
                  <i />
                  <span>{skill.category}</span>
                </>
              )}
            </div>
            <h2>{skill.name}</h2>
            <p>{skill.description || "没有填写简介"}</p>
          </div>
        </div>
        <div className="skills-detail__actions">
          {skill.official ? (
            <button type="button" className="skills-button" onClick={() => onDuplicate(skill)}>
              <Copy size={15} />
              复制为我的
            </button>
          ) : (
            <>
              <button type="button" className="skills-button" onClick={() => onEdit(skill)}>
                <Pencil size={15} />
                编辑
              </button>
              <button type="button" className="skills-button is-danger" onClick={() => onDelete(skill)}>
                <Trash2 size={15} />
                删除
              </button>
            </>
          )}
        </div>
      </header>

      {skill.tags?.length > 0 && (
        <ul className="skills-detail__tags">
          {skill.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}

      <section className="skills-detail__block">
        <h3>
          <Sparkles size={15} aria-hidden="true" />
          指令内容
        </h3>
        <pre className="skills-detail__instruction">{skill.instruction}</pre>
        <p className="skills-detail__note">生图提交时会自动拼在你的提示词前面，你无需手动复制。</p>
      </section>

      <section className="skills-detail__block">
        <h3>
          <Layers3 size={15} aria-hidden="true" />
          适用页面
        </h3>
        {skill.taskTypes?.length ? (
          <ul className="skills-detail__tags is-plain">
            {skill.taskTypes.map((taskType) => (
              <li key={taskType}>{skillTaskTypeLabel(taskType)}</li>
            ))}
          </ul>
        ) : (
          <p className="skills-detail__note">全部生图页面均可装载。</p>
        )}
      </section>

      <section className="skills-detail__block">
        <h3>
          <Globe2 size={15} aria-hidden="true" />
          装载位置
        </h3>
        <div className="skills-chipset">
          {scopeState.map(({ scope, loaded, eligible, full }) => {
            const isGlobal = scope === SKILL_GLOBAL_SCOPE;
            const label = isGlobal ? "全局" : skillTaskTypeLabel(scope);
            const disabled = !eligible || full || busyScope === scope;
            return (
              <button
                key={scope}
                type="button"
                className={"skills-chip" + (isGlobal ? " is-global" : "")}
                aria-pressed={loaded}
                disabled={disabled}
                title={
                  !eligible
                    ? "该 Skill 不适用于这个页面"
                    : full
                      ? `这个装载位已满（最多 ${maxPerScope} 个）`
                      : undefined
                }
                onClick={() => onToggleScope(scope, skill, loaded)}
              >
                {busyScope === scope ? <Loader2 className="skills-spin" size={13} /> : null}
                {label}
              </button>
            );
          })}
        </div>
        <p className="skills-detail__note">
          {loadedScopes.length === 0
            ? "尚未装载，生图时不会使用这个 Skill。"
            : loadedScopes.some((item) => item.scope === SKILL_GLOBAL_SCOPE) &&
                loadedScopes.length === 1
              ? globalIds.length > 1
                ? "已全局生效，但单独配置过的页面会改用该页面自己的 Skill。"
                : "已对所有页面生效（单独配置过的页面除外）。"
              : "已在选中的页面生效。"}
        </p>
      </section>
    </section>
  );
}

export function SkillsView() {
  const { user, loading: authLoading } = useAuth();
  const { requestAuth } = useAuthPrompt();
  const [tab, setTab] = useState("library");
  const [origin, setOrigin] = useState("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [bindings, setBindings] = useState({});
  const [maxPerScope, setMaxPerScope] = useState(5);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busyScope, setBusyScope] = useState("");
  const [editor, setEditor] = useState({ open: false, skill: null, saving: false, error: "" });
  const [picker, setPicker] = useState({ open: false, scope: "", saving: false, error: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await listMySkills();
      setItems(data.items);
      setBindings(data.bindings);
      if (data.maxPerScope) setMaxPerScope(data.maxPerScope);
    } catch (error) {
      setLoadError(errorMessage(error, "加载 Skill 失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    load();
  }, [authLoading, user, load]);

  const skillsById = useMemo(() => new Map(items.map((skill) => [skill.id, skill])), [items]);

  const loadedIds = useMemo(() => {
    const ids = new Set();
    for (const scope of ALL_SCOPES) for (const id of bindings[scope] || []) ids.add(id);
    return ids;
  }, [bindings]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items.filter((skill) => {
      if (origin === "official" && !skill.official) return false;
      if (origin === "mine" && skill.official) return false;
      if (!keyword) return true;
      return `${skill.name} ${skill.description} ${(skill.tags || []).join(" ")}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [items, origin, query]);

  const selected = useMemo(
    () => visible.find((skill) => skill.id === selectedId) || visible[0] || null,
    [visible, selectedId],
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      official: items.filter((skill) => skill.official).length,
      mine: items.filter((skill) => !skill.official).length,
    }),
    [items],
  );

  /** 写入一个装载位，失败时回滚到服务端的当前状态。 */
  const commitBinding = useCallback(
    async (scope, skillIds) => {
      setBusyScope(scope);
      try {
        const next = await setSkillBinding(scope, skillIds);
        setBindings(next);
        return true;
      } catch (error) {
        setLoadError(errorMessage(error, "装载失败，请稍后重试"));
        await load();
        return false;
      } finally {
        setBusyScope("");
      }
    },
    [load],
  );

  const toggleScope = useCallback(
    (scope, skill, loaded) => {
      const current = bindings[scope] || [];
      commitBinding(
        scope,
        loaded ? current.filter((id) => id !== skill.id) : [...current, skill.id],
      );
    },
    [bindings, commitBinding],
  );

  const removeBinding = useCallback(
    (scope, skill) => {
      commitBinding(scope, (bindings[scope] || []).filter((id) => id !== skill.id));
    },
    [bindings, commitBinding],
  );

  const clearBinding = useCallback(
    (scope) => commitBinding(scope, []),
    [commitBinding],
  );

  async function submitEditor(input) {
    setEditor((current) => ({ ...current, saving: true, error: "" }));
    try {
      const saved = editor.skill?.id
        ? await updateMySkill(editor.skill.id, input)
        : await createMySkill(input);
      setEditor({ open: false, skill: null, saving: false, error: "" });
      await load();
      if (saved?.id) {
        setSelectedId(saved.id);
        setOrigin("mine");
      }
    } catch (error) {
      setEditor((current) => ({
        ...current,
        saving: false,
        error: errorMessage(error, "保存失败，请稍后重试"),
      }));
    }
  }

  async function removeSkill(skill) {
    // 装载记录随外键级联清理，这里只要确认一次。
    if (!window.confirm(`删除「${skill.name}」？它会从所有装载位移除。`)) return;
    try {
      await deleteMySkill(skill.id);
      if (selectedId === skill.id) setSelectedId("");
      await load();
    } catch (error) {
      setLoadError(errorMessage(error, "删除失败，请稍后重试"));
    }
  }

  function duplicateSkill(skill) {
    setEditor({
      open: true,
      // 不带 id 即新建：官方 Skill 只读，复制一份再改。
      skill: {
        name: `${skill.name}（副本）`,
        description: skill.description,
        instruction: skill.instruction,
        taskTypes: skill.taskTypes,
      },
      saving: false,
      error: "",
    });
  }

  async function confirmPicker(skillIds) {
    const scope = picker.scope;
    setPicker((current) => ({ ...current, saving: true, error: "" }));
    const ok = await commitBinding(scope, [...(bindings[scope] || []), ...skillIds]);
    setPicker(ok ? { open: false, scope: "", saving: false, error: "" } : (current) => ({
      ...current,
      saving: false,
      error: "装载失败，请稍后重试",
    }));
  }

  if (authLoading) {
    return (
      <div className="skills-page">
        <div className="skills-page__inner skills-page__state">
          <Loader2 className="skills-spin" size={22} />
          <p>正在加载…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="skills-page">
        <div className="skills-page__inner skills-page__state">
          <span className="skills-page__state-icon">
            <Layers3 size={26} />
          </span>
          <h1>Skill 中心</h1>
          <p>
            登录后即可装载 Skill：装载之后，每次生图都会自动带上它的要求，不用每次重复输入。
          </p>
          <button
            type="button"
            className="skills-button is-primary"
            onClick={() =>
              requestAuth({
                featureLabel: "Skill 中心",
                detail: "登录后即可装载官方或自建 Skill，之后每次生图都会自动带上它的画面要求。",
                returnTo: "/skills",
              })
            }
          >
            登录后使用
          </button>
        </div>
      </div>
    );
  }

  const pickerScope = picker.scope;
  const pickerBound = pickerScope ? bindings[pickerScope] || [] : [];

  return (
    <div className="skills-page" data-testid="skills-page">
      <div className="skills-page__inner">
        <header className="skills-page__head">
          <div>
            <div className="skills-page__title">
              <span>
                <Layers3 size={23} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <h1>Skill 中心</h1>
            </div>
            <p>装载一次，之后每次生图都自动带上它的画面要求。</p>
          </div>
          <div className="skills-page__head-actions">
            <button
              type="button"
              className="skills-button"
              disabled={loading}
              aria-label="刷新"
              onClick={load}
            >
              <RefreshCw className={loading ? "skills-spin" : ""} size={15} />
              刷新
            </button>
            <button
              type="button"
              className="skills-button is-primary"
              onClick={() => setEditor({ open: true, skill: null, saving: false, error: "" })}
            >
              <Plus size={15} />
              新建 Skill
            </button>
          </div>
        </header>

        <div className="skills-page__tabs" role="tablist" aria-label="Skill 视图">
          <button type="button" role="tab" aria-selected={tab === "library"} onClick={() => setTab("library")}>
            技能库
            <em className="tnum">{counts.all}</em>
          </button>
          <button type="button" role="tab" aria-selected={tab === "board"} onClick={() => setTab("board")}>
            装载配置
            <em className="tnum">{loadedIds.size}</em>
          </button>
        </div>

        {loadError && (
          <p className="skills-page__error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            {loadError}
            <button type="button" aria-label="关闭提示" onClick={() => setLoadError("")}>
              <X size={13} />
            </button>
          </p>
        )}

        {loading ? (
          <div className="skills-page__state is-inline">
            <Loader2 className="skills-spin" size={20} />
            <p>正在加载 Skill…</p>
          </div>
        ) : tab === "board" ? (
          <SkillBindingBoard
            bindings={bindings}
            skillsById={skillsById}
            maxPerScope={maxPerScope}
            busyScope={busyScope}
            onRemove={removeBinding}
            onClear={clearBinding}
            onAdd={(scope) => setPicker({ open: true, scope, saving: false, error: "" })}
          />
        ) : (
          <>
            <div className="skills-page__toolbar">
              <div className="skills-page__segmented" role="tablist" aria-label="Skill 来源">
                {ORIGIN_TABS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={origin === item.value}
                    onClick={() => setOrigin(item.value)}
                  >
                    {item.label}
                    <em className="tnum">{counts[item.value]}</em>
                  </button>
                ))}
              </div>
              <label className="skills-search">
                <Search size={16} aria-hidden="true" />
                <input
                  value={query}
                  aria-label="搜索 Skill"
                  placeholder="搜索名称、简介或标签"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}>
                    <X size={14} />
                  </button>
                )}
              </label>
            </div>

            {visible.length === 0 ? (
              <div className="skills-page__state is-inline">
                <span className="skills-page__state-icon">
                  {origin === "mine" ? <Plus size={24} /> : <Search size={24} />}
                </span>
                <h2>
                  {origin === "mine" && !counts.mine
                    ? "把自己的画面要求存成 Skill"
                    : "没有找到符合条件的 Skill"}
                </h2>
                <p>
                  {origin === "mine" && !counts.mine
                    ? "写一段固定的画面要求，装载之后每次生图都会自动带上。"
                    : "换一个关键词，或看看其他来源。"}
                </p>
                {origin === "mine" && !counts.mine ? (
                  <button
                    type="button"
                    className="skills-button is-primary"
                    onClick={() => setEditor({ open: true, skill: null, saving: false, error: "" })}
                  >
                    <Plus size={15} />
                    新建 Skill
                  </button>
                ) : (
                  <button
                    type="button"
                    className="skills-button"
                    onClick={() => {
                      setQuery("");
                      setOrigin("all");
                    }}
                  >
                    查看全部
                  </button>
                )}
              </div>
            ) : (
              <div className="skills-page__layout">
                <aside className="skills-list" aria-label="Skill 列表">
                  <div className="skills-list__scroll">
                    {visible.map((skill) => (
                      <article
                        key={skill.id}
                        className={"skills-card" + (selected?.id === skill.id ? " is-selected" : "")}
                      >
                        <button
                          type="button"
                          aria-label={`查看 ${skill.name}`}
                          aria-pressed={selected?.id === skill.id}
                          onClick={() => setSelectedId(skill.id)}
                        >
                          <span className={"skills-card__glyph" + (skill.official ? " is-official" : "")}>
                            {skill.official ? <BadgeCheck size={17} /> : <UserRound size={17} />}
                          </span>
                          <span className="skills-card__copy">
                            <strong>{skill.name}</strong>
                            <small>{skill.description || "没有填写简介"}</small>
                          </span>
                          {loadedIds.has(skill.id) && (
                            <span className="skills-card__mark" title="已装载">
                              已装载
                            </span>
                          )}
                        </button>
                      </article>
                    ))}
                  </div>
                </aside>
                {selected && (
                  <SkillDetail
                    key={selected.id}
                    skill={selected}
                    bindings={bindings}
                    busyScope={busyScope}
                    maxPerScope={maxPerScope}
                    onToggleScope={toggleScope}
                    onEdit={(skill) => setEditor({ open: true, skill, saving: false, error: "" })}
                    onDelete={removeSkill}
                    onDuplicate={duplicateSkill}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <SkillEditorDialog
        open={editor.open}
        skill={editor.skill}
        saving={editor.saving}
        error={editor.error}
        onClose={() => setEditor({ open: false, skill: null, saving: false, error: "" })}
        onSubmit={submitEditor}
      />
      <SkillPickerDialog
        open={picker.open}
        scope={pickerScope}
        skills={items}
        boundIds={pickerBound}
        remaining={Math.max(0, maxPerScope - pickerBound.length)}
        saving={picker.saving}
        error={picker.error}
        onClose={() => setPicker({ open: false, scope: "", saving: false, error: "" })}
        onConfirm={confirmPicker}
      />
    </div>
  );
}
