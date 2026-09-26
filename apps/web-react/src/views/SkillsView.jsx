import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Cloud,
  Copy,
  Download,
  HardDrive,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import SkillEditorDialog from "../features/skills/SkillEditorDialog.jsx";
import {
  SKILL_FILE_EXTENSIONS,
  SKILL_STORAGE_CLOUD,
  SKILL_STORAGE_LABELS,
  SKILL_STORAGE_LOCAL,
  SKILL_STORAGE_OFFICIAL,
  parseSkillMarkdown,
  readSkillFile,
  serializeSkillMarkdown,
  skillMentionToken,
} from "../features/skills/skillComposition.js";
import {
  SKILL_LIBRARY_UPDATED_EVENT,
  createSkill,
  deleteSkill,
  loadSkillLibrary,
  moveSkill,
  updateSkill,
} from "../features/skills/skillLibrary.js";
import "@react/legacy-static/features/creator-hub/creator-hub.css";
import "./skills.css";

const EMPTY_EDITOR = { open: false, skill: null, saving: false, error: "", warnings: [] };
const EMPTY_LIBRARY = {
  items: [],
  local: [],
  cloud: [],
  official: [],
  quota: { local: { used: 0, max: 50 }, cloud: { used: 0, max: 5 } },
  signedIn: false,
  remoteError: null,
};

function errorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message || fallback;
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function downloadSkillMarkdown(skill) {
  const text = serializeSkillMarkdown(skill);
  const slug = String(skill?.slug || "").trim() || "untitled";
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}.SKILL.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function useCopyFeedback() {
  const [copied, setCopied] = useState("");
  const copy = useCallback(async (key, text) => {
    if (!(await copyText(text))) return;
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? "" : current)), 1500);
  }, []);
  return [copied, copy];
}

function cardSummary(skill) {
  const description = String(skill?.description || "").trim();
  if (!description || description === String(skill?.name || "").trim()) return "";
  return description;
}

function extraTags(skill) {
  const name = String(skill?.name || "");
  return (skill?.tags || []).filter((tag) => tag && !name.includes(tag));
}

function StorageBadge({ storage }) {
  return <span className="ch-pill">{SKILL_STORAGE_LABELS[storage]}</span>;
}

function Btn({ variant = "is-ghost", icon: Icon, children, className = "", ...rest }) {
  return (
    <button type="button" className={`ch-btn ${variant} ${className}`.trim()} {...rest}>
      {Icon && <Icon size={15} strokeWidth={2} aria-hidden="true" />}
      {children}
    </button>
  );
}

function StorageNav({ filter, onFilter, counts, quota }) {
  const nav = [
    { value: "all", label: "全部", count: counts.all },
    { value: SKILL_STORAGE_LOCAL, label: "本地", count: counts.local },
    { value: SKILL_STORAGE_CLOUD, label: "云端", count: `${quota.cloud.used}/${quota.cloud.max}` },
    { value: SKILL_STORAGE_OFFICIAL, label: "官方", count: counts.official },
  ];
  return (
    <nav className="ch-chips" aria-label="存储位置">
      {nav.map(({ value, label, count }) => (
        <button
          key={value}
          type="button"
          className={`ch-chip${filter === value ? " is-active" : ""}`}
          aria-pressed={filter === value}
          onClick={() => onFilter(value)}
        >
          {label} {count}
        </button>
      ))}
    </nav>
  );
}

// ---------- 卡片 ----------

function SkillCard({ skill, selected, onOpen, showStorage }) {
  const summary = cardSummary(skill);
  return (
    <button
      type="button"
      className={`ch-card skill-card${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={`查看 ${skill.name}`}
      onClick={() => onOpen(skill.id)}
    >
      <span className="ch-card__body">
        {showStorage ? <StorageBadge storage={skill.storage} /> : null}
        <h3 className="ch-card__title">{skill.name}</h3>
        {summary ? <p className="ch-card__prompt">{summary}</p> : null}
      </span>
    </button>
  );
}

// ---------- 详情抽屉 ----------

function SkillDetail({ skill, signedIn, cloudFull, localFull, busy, onClose, onEdit, onDelete, onMove, onRequestAuth }) {
  const [bodyView, setBodyView] = useState("instruction");
  const [copied, copy] = useCopyFeedback();
  const token = skillMentionToken(skill);
  const summary = cardSummary(skill);
  const tags = extraTags(skill);
  const markdown = useMemo(() => serializeSkillMarkdown(skill), [skill]);
  const isOfficial = skill.storage === SKILL_STORAGE_OFFICIAL;
  const isLocal = skill.storage === SKILL_STORAGE_LOCAL;
  const cloudHint = !signedIn ? "登录后才能保存到云端" : cloudFull ? "云端已满，先删一个" : "";
  const localHint = localFull ? "本地已满" : "";

  function toCloud() {
    if (!signedIn) return onRequestAuth();
    onMove(skill, SKILL_STORAGE_CLOUD);
  }

  return (
    <div className="skills-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        className={`skills-drawer is-${skill.storage}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="skills-drawer__head">
          <StorageBadge storage={skill.storage} />
          <button type="button" className="skills-icon-btn" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="skills-drawer__body">
          <h2 id="skill-detail-title">{skill.name}</h2>
          {token && (
            <div className="skills-token-row">
              <code className="skill-token is-lg">{token}</code>
              <button type="button" className="skills-link" onClick={() => copy("token", token)}>
                {copied === "token" ? (
                  <>
                    <Check size={13} /> 已复制
                  </>
                ) : (
                  "复制"
                )}
              </button>
            </div>
          )}
          {summary ? <p className="skills-drawer__lead">{summary}</p> : null}
          {tags.length > 0 && (
            <ul className="skills-drawer__tags">
              {tags.map((tag) => (
                <li key={tag}>#{tag}</li>
              ))}
            </ul>
          )}

          <section className="skills-drawer__section">
            <div className="skills-drawer__section-head">
              <div className="skills-tabs is-mini" role="tablist" aria-label="正文视图">
                <button type="button" role="tab" aria-selected={bodyView === "instruction"} onClick={() => setBodyView("instruction")}>
                  正文
                </button>
                <button type="button" role="tab" aria-selected={bodyView === "markdown"} onClick={() => setBodyView("markdown")}>
                  SKILL.md
                </button>
              </div>
            </div>
            <pre className={"skills-pre" + (bodyView === "markdown" ? " is-mono" : "")}>
              {bodyView === "markdown" ? markdown : skill.instruction}
            </pre>
            <div className="skills-drawer__tools">
              <button type="button" className="skills-link" onClick={() => copy("markdown", markdown)}>
                <Copy size={13} />
                {copied === "markdown" ? "已复制" : "复制 SKILL.md"}
              </button>
              <button type="button" className="skills-link" onClick={() => downloadSkillMarkdown(skill)}>
                <Download size={13} />
                导出 SKILL.md
              </button>
            </div>
          </section>
        </div>

        <footer className="skills-drawer__foot">
          {isOfficial ? (
            <>
              <Btn variant="is-primary" icon={HardDrive} disabled={busy || localFull} title={localHint || undefined} onClick={() => onMove(skill, SKILL_STORAGE_LOCAL)}>
                复制到本地
              </Btn>
              <Btn icon={Cloud} disabled={busy || (signedIn && cloudFull)} title={cloudHint || undefined} onClick={toCloud}>
                复制到云端
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="is-primary" icon={Pencil} disabled={busy} onClick={() => onEdit(skill)}>
                编辑
              </Btn>
              {isLocal ? (
                <Btn icon={Cloud} disabled={busy || (signedIn && cloudFull)} title={cloudHint || undefined} onClick={toCloud}>
                  移到云端
                </Btn>
              ) : (
                <Btn icon={HardDrive} disabled={busy || localFull} title={localHint || undefined} onClick={() => onMove(skill, SKILL_STORAGE_LOCAL)}>
                  移到本地
                </Btn>
              )}
              <Btn variant="is-danger" icon={Trash2} className="skills-btn-end" disabled={busy} onClick={() => onDelete(skill)}>
                删除
              </Btn>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}

// ---------- 页面 ----------

export function SkillsView() {
  const { user, loading: authLoading } = useAuth();
  const { requestAuth } = useAuthPrompt();
  const importRef = useRef(null);
  const [library, setLibrary] = useState(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState(EMPTY_EDITOR);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [deleting, setDeleting] = useState(false);

  const signedIn = Boolean(user);
  const promptCloudAuth = useCallback(() => {
    requestAuth({
      featureLabel: "技能库",
      detail: "登录后即可把技能同步到云端，在其他设备上继续使用。",
      returnTo: "/skills",
    });
  }, [requestAuth]);

  const load = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      setLibrary(await loadSkillLibrary({ fresh }));
    } catch (error) {
      setActionError(errorMessage(error, "加载技能失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, user, load]);

  useEffect(() => {
    const onUpdated = () => load({ fresh: true, silent: true });
    window.addEventListener(SKILL_LIBRARY_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SKILL_LIBRARY_UPDATED_EVENT, onUpdated);
  }, [load]);

  useEffect(() => {
    document.documentElement.classList.add("creator-hub-sticky-page");
    return () => {
      document.documentElement.classList.remove("creator-hub-sticky-page");
    };
  }, []);

  useEffect(() => {
    if (!confirmDelete && !selectedId) return undefined;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(null);
      else setSelectedId("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDelete, selectedId]);

  const { items, quota } = library;
  const cloudFull = quota.cloud.used >= quota.cloud.max;
  const localFull = quota.local.used >= quota.local.max;

  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items.filter((skill) => {
      if (filter !== "all" && skill.storage !== filter) return false;
      if (!keyword) return true;
      return `${skill.name} ${skill.description} ${skill.slug || ""} ${skillMentionToken(skill)} ${(skill.tags || []).join(" ")}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [items, filter, query]);

  const selected = useMemo(() => items.find((skill) => skill.id === selectedId) || null, [items, selectedId]);

  function openEditor(skill = null, warnings = []) {
    setEditor({ open: true, skill, saving: false, error: "", warnings });
  }

  async function submitEditor(input, storage) {
    setEditor((current) => ({ ...current, saving: true, error: "" }));
    try {
      const saved = editor.skill?.id ? await updateSkill(editor.skill, input) : await createSkill(input, storage);
      setEditor(EMPTY_EDITOR);
      await load({ fresh: true });
      if (saved?.id) {
        setSelectedId(saved.id);
        setFilter("all");
      }
    } catch (error) {
      setEditor((current) => ({ ...current, saving: false, error: errorMessage(error, "保存失败，请稍后重试") }));
    }
  }

  async function confirmRemoveSkill() {
    const skill = confirmDelete;
    if (!skill) return;
    setDeleting(true);
    try {
      await deleteSkill(skill);
      if (selectedId === skill.id) setSelectedId("");
      await load({ fresh: true });
    } catch (error) {
      setActionError(errorMessage(error, "删除失败，请稍后重试"));
    } finally {
      setConfirmDelete(null);
      setDeleting(false);
    }
  }

  async function handleMove(skill, targetStorage) {
    if (skill.storage === targetStorage) return;
    if (targetStorage === SKILL_STORAGE_CLOUD && !signedIn) return promptCloudAuth();
    setBusyId(skill.id);
    setActionError("");
    try {
      const moved = await moveSkill(skill, targetStorage);
      await load({ fresh: true });
      if (moved?.id) setSelectedId(moved.id);
    } catch (error) {
      setActionError(errorMessage(error, "操作失败，请稍后重试"));
    } finally {
      setBusyId("");
    }
  }

  async function importSkillFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setActionError("");
    try {
      const { skill, warnings } = parseSkillMarkdown(await readSkillFile(file));
      openEditor(skill, ["文件内容已填入表单，保存前请检查正文。", ...warnings]);
    } catch (error) {
      setActionError(errorMessage(error, "导入 SKILL.md 失败"));
    }
  }

  const counts = { all: items.length, local: library.local.length, official: library.official.length };
  const busyLoading = loading || authLoading;
  const emptyLibrary = !busyLoading && items.length === 0;
  const emptyFilter = !busyLoading && items.length > 0 && visible.length === 0;
  const cloudSignedOut = filter === SKILL_STORAGE_CLOUD && !signedIn;

  return (
    <div className="ch-page ch-page--skills" data-testid="skills-page">
      <div className="ch-shell">
        <header className="ch-hero skills-hero">
          <h1>技能库</h1>
          <p>输入 @ 调用，提交时自动展开进提示词。</p>
        </header>

        <div className="ch-sticky-bar">
          <div className="ch-toolbar">
            <label className="ch-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                value={query}
                aria-label="搜索技能"
                placeholder="搜索名称或简介"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <input
              ref={importRef}
              className="skills-sr-file"
              type="file"
              accept={SKILL_FILE_EXTENSIONS.join(",")}
              aria-hidden="true"
              tabIndex={-1}
              onChange={importSkillFile}
            />
            <Btn icon={Upload} onClick={() => importRef.current?.click()}>
              上传 SKILL.md
            </Btn>
            <Btn variant="is-primary" icon={Plus} onClick={() => openEditor()}>
              新建技能
            </Btn>
          </div>
          <StorageNav filter={filter} onFilter={setFilter} counts={counts} quota={quota} />
        </div>

        <section className="ch-section">
            {library.remoteError && (
              <p className="skills-alert is-warn" role="status">
                <AlertCircle size={15} aria-hidden="true" />
                <span>云端技能读取失败，本地技能仍可使用。</span>
                <button type="button" className="skills-link" onClick={() => load({ fresh: true })}>
                  重试
                </button>
                <button type="button" className="skills-icon-btn is-sm" aria-label="关闭提示" onClick={() => setLibrary((current) => ({ ...current, remoteError: null }))}>
                  <X size={13} />
                </button>
              </p>
            )}
            {actionError && (
              <p className="skills-alert" role="alert">
                <AlertCircle size={15} aria-hidden="true" />
                <span>{actionError}</span>
                <button type="button" className="skills-icon-btn is-sm" aria-label="关闭提示" onClick={() => setActionError("")}>
                  <X size={13} />
                </button>
              </p>
            )}

            {busyLoading ? (
              <div className="skills-grid" aria-busy="true" aria-label="正在加载技能">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div key={index} className="ch-card skill-card is-skeleton" aria-hidden="true">
                    <span className="ch-card__body">
                      <i style={{ width: "28%" }} />
                      <i style={{ width: "72%" }} />
                    </span>
                  </div>
                ))}
              </div>
            ) : emptyLibrary ? (
              <div className="ch-empty">
                <strong>还没有技能</strong>
                <span>把反复要写的要求存下来，未登录也能先存在本地。</span>
                <div className="skills-empty__actions">
                  <Btn variant="is-primary" icon={Plus} onClick={() => openEditor()}>
                    新建技能
                  </Btn>
                  <Btn icon={Upload} onClick={() => importRef.current?.click()}>
                    上传 SKILL.md
                  </Btn>
                </div>
              </div>
            ) : emptyFilter ? (
              <div className="ch-empty">
                <strong>
                  {cloudSignedOut ? "登录后查看云端技能" : query ? "没有匹配的技能" : "这里还没有技能"}
                </strong>
                <span>
                  {cloudSignedOut
                    ? "云端技能跟随账号，换设备也能用。"
                    : query
                      ? "换个词试试，或看看其他位置。"
                      : "换一个位置，或新建一个。"}
                </span>
                {cloudSignedOut ? (
                  <Btn variant="is-primary" onClick={promptCloudAuth}>
                    登录
                  </Btn>
                ) : (
                  <Btn
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    查看全部
                  </Btn>
                )}
              </div>
            ) : (
              <div className="skills-grid" aria-label="技能列表">
                {visible.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    selected={selected?.id === skill.id}
                    showStorage={filter === "all"}
                    onOpen={setSelectedId}
                  />
                ))}
              </div>
            )}
        </section>
      </div>

      {selected && (
        <SkillDetail
          key={selected.id}
          skill={selected}
          signedIn={signedIn}
          cloudFull={cloudFull}
          localFull={localFull}
          busy={busyId === selected.id}
          onClose={() => setSelectedId("")}
          onEdit={(skill) => openEditor(skill)}
          onDelete={setConfirmDelete}
          onMove={handleMove}
          onRequestAuth={promptCloudAuth}
        />
      )}

      <SkillEditorDialog
        open={editor.open}
        skill={editor.skill}
        saving={editor.saving}
        error={editor.error}
        initialWarnings={editor.warnings}
        signedIn={signedIn}
        quota={quota}
        onClose={() => setEditor(EMPTY_EDITOR)}
        onSubmit={submitEditor}
        onRequestAuth={promptCloudAuth}
      />

      {confirmDelete && (
        <div className="skills-scrim is-center" role="presentation" onMouseDown={() => setConfirmDelete(null)}>
          <div
            className="skills-modal is-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="skills-modal__head">
              <div>
                <h2 id="skill-delete-title">删除技能</h2>
                <p>删除「{confirmDelete.name}」？这一步不能撤销。</p>
              </div>
            </header>
            <footer className="skills-modal__foot">
              <span>只删这一份，不影响其他存储位置</span>
              <div>
                <Btn onClick={() => setConfirmDelete(null)}>取消</Btn>
                <Btn variant="is-danger is-solid" disabled={deleting} onClick={confirmRemoveSkill}>
                  {deleting && <Loader2 className="skills-spin" size={15} />}
                  删除
                </Btn>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillsView;
