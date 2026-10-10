import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Cloud,
  Copy,
  Download,
  ExternalLink,
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
  SKILL_ENTRY_POINTS,
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

const DRAWER_EXIT_MS = 220;
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

const LIBRARY_TAB_OFFICIAL = "official";
const LIBRARY_TAB_MINE = "mine";

/** 顶部切换：内置技能库 / 我的技能库；选中底色滑到当前项。 */
function LibraryTabs({ tab, onTab, counts }) {
  const tabs = [
    { value: LIBRARY_TAB_OFFICIAL, label: "内置技能库", count: counts.official },
    { value: LIBRARY_TAB_MINE, label: "我的技能库", count: counts.mine },
  ];
  const buttonRefs = useRef({});
  const [indicator, setIndicator] = useState(null);

  useLayoutEffect(() => {
    function measure() {
      const button = buttonRefs.current[tab];
      if (button) setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab, counts.official, counts.mine]);

  return (
    <div className="skills-tabs skills-library-tabs" role="tablist" aria-label="技能库">
      {indicator ? (
        <span
          className="skills-library-tabs__indicator"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
          aria-hidden="true"
        />
      ) : null}
      {tabs.map(({ value, label, count }) => (
        <button
          key={value}
          ref={(node) => {
            buttonRefs.current[value] = node;
          }}
          type="button"
          role="tab"
          id={`skills-tab-${value}`}
          aria-selected={tab === value}
          aria-controls="skills-tabpanel"
          onClick={() => onTab(value)}
        >
          {label}
          <span className="skills-library-tabs__count">{count}</span>
        </button>
      ))}
    </div>
  );
}

/** 我的技能库内按存储位置筛选。 */
function StorageNav({ filter, onFilter, counts, quota }) {
  const nav = [
    { value: "all", label: "全部", count: counts.mine },
    { value: SKILL_STORAGE_LOCAL, label: "本地", count: counts.local },
    { value: SKILL_STORAGE_CLOUD, label: "云端", count: `${quota.cloud.used}/${quota.cloud.max}` },
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

const PLACEHOLDER_TONES = 4;

/** 没有封面的内置技能用名称首字做占位封面，色调按名称稳定取一种。 */
function placeholderTone(name) {
  let hash = 0;
  for (const char of String(name || "")) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % PLACEHOLDER_TONES;
}

function SkillCardFooter({ skill }) {
  const token = skillMentionToken(skill);
  const tags = extraTags(skill).slice(0, 2);
  if (!token && !tags.length) return null;
  return (
    <span className="skill-card__foot">
      {token ? <code className="skill-token">{token}</code> : null}
      {tags.map((tag) => (
        <span key={tag} className="skill-card__tag">
          #{tag}
        </span>
      ))}
    </span>
  );
}

/** 内置技能卡：封面（或占位封面）+ 名称 + 简介 + 调用写法。 */
function OfficialSkillCard({ skill, selected, onOpen }) {
  const summary = cardSummary(skill);
  const initial = Array.from(String(skill.name || "技"))[0];
  return (
    <button
      type="button"
      className={`ch-card skill-card is-official${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={`查看 ${skill.name}`}
      onClick={() => onOpen(skill.id)}
    >
      <span className="ch-card__media skill-card__cover">
        {skill.coverUrl ? (
          <img src={skill.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className={`skill-card__placeholder is-tone-${placeholderTone(skill.name)}`} aria-hidden="true">
            {initial}
          </span>
        )}
        <span className="skill-card__badge">内置</span>
      </span>
      <span className="ch-card__body">
        <h3 className="ch-card__title">{skill.name}</h3>
        {summary ? <p className="ch-card__prompt">{summary}</p> : null}
        <SkillCardFooter skill={skill} />
      </span>
    </button>
  );
}

/** 自己的技能卡：紧凑文本卡，标出存在本地还是云端。 */
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
        <span className="skill-card__head">
          <h3 className="ch-card__title">{skill.name}</h3>
          {showStorage ? <StorageBadge storage={skill.storage} /> : null}
        </span>
        {summary ? <p className="ch-card__prompt">{summary}</p> : <p className="ch-card__prompt is-muted">没有简介</p>}
        <SkillCardFooter skill={skill} />
      </span>
    </button>
  );
}

function SkillGrid({ skills, selectedId, onOpen, showStorage, label }) {
  const official = skills.length > 0 && skills.every((skill) => skill.storage === SKILL_STORAGE_OFFICIAL);
  return (
    <div className={`skills-grid${official ? " is-official" : ""}`} aria-label={label}>
      {skills.map((skill) =>
        skill.storage === SKILL_STORAGE_OFFICIAL ? (
          <OfficialSkillCard key={skill.id} skill={skill} selected={selectedId === skill.id} onOpen={onOpen} />
        ) : (
          <SkillCard key={skill.id} skill={skill} selected={selectedId === skill.id} showStorage={showStorage} onOpen={onOpen} />
        ),
      )}
    </div>
  );
}

// ---------- 详情抽屉 ----------

/**
 * 把使用说明切成文字段与示例段：以 `@` 开头的行是示例提示词，可一键复制；
 * 单独一行的“示例：”标题由示例段自己的小标题代替。
 */
function usageSegments(text) {
  const segments = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (/^示例[:：]?$/.test(line)) continue;
    const kind = line.startsWith("@") ? "examples" : "text";
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.lines.push(raw);
    else segments.push({ kind, lines: [raw] });
  }
  return segments
    .map((segment) => ({ ...segment, lines: segment.kind === "examples" ? segment.lines.map((line) => line.trim()) : segment.lines }))
    .filter((segment) => segment.lines.join("").trim());
}

function CopyButton({ copied, label = "复制", copiedLabel = "已复制", onClick, className = "skills-link" }) {
  return (
    <button type="button" className={className} onClick={onClick}>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

/** 效果示例图：按原比例完整展示，不可点击；说明是 `@` 开头的提示词时可一键复制。 */
function SkillSampleGallery({ samples, copied, copy }) {
  if (!samples?.length) return null;
  return (
    <ul className={`skills-samples${samples.length === 1 ? " is-single" : ""}`}>
      {samples.map((sample, index) => (
        <li key={sample.url}>
          <div className="skills-samples__img">
            <img src={sample.url} alt={sample.caption || `效果示例 ${index + 1}`} loading="lazy" />
          </div>
          {sample.caption ? (
            <div className="skills-samples__caption">
              <p>{sample.caption}</p>
              {sample.caption.trim().startsWith("@") ? (
                <CopyButton
                  copied={copied === `sample:${sample.url}`}
                  label="复制提示词"
                  onClick={() => copy(`sample:${sample.url}`, sample.caption.trim())}
                />
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** GitHub 标志（lucide 不再提供品牌图标）。 */
function GitHubMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** 内置技能的改编来源：GitHub 显示标志，其它站点显示外链图标；点击在新标签页打开。 */
function SkillSourceLink({ url }) {
  let host = "";
  let label = url;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, "");
    label = `${host}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
  const isGitHub = host === "github.com";
  return (
    <a
      className="skills-icon-btn"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`来源：${label}`}
      aria-label={`查看来源 ${label}（新标签页打开）`}
    >
      {isGitHub ? <GitHubMark /> : <ExternalLink size={18} />}
    </a>
  );
}

/** 详情里的一节：小标题 + 内容。 */
function DrawerSection({ title, extra, children }) {
  return (
    <section className="skills-drawer__section">
      <div className="skills-drawer__section-head">
        <h3 className="skills-drawer__section-title">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 使用说明：文字段落 + 以 `@` 开头的示例提示词（可复制）。 */
function SkillUsageGuide({ text, copied, copy }) {
  const segments = usageSegments(text);
  const textSegments = segments.filter((segment) => segment.kind === "text");
  const examples = segments.filter((segment) => segment.kind === "examples").flatMap((segment) => segment.lines);
  return (
    <>
      {textSegments.map((segment, index) => (
        <p key={index} className="skills-guide">
          {segment.lines.join("\n").trim()}
        </p>
      ))}
      {examples.length > 0 && (
        <div className="skills-examples">
          <span className="skills-examples__label">示例提示词</span>
          <ul>
            {examples.map((line) => (
              <li key={line}>
                <p>{line}</p>
                <CopyButton copied={copied === `example:${line}`} onClick={() => copy(`example:${line}`, line)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function SkillDetail({ skill, closing, signedIn, cloudFull, localFull, busy, onClose, onEdit, onDelete, onMove, onRequestAuth }) {
  const [bodyView, setBodyView] = useState("instruction");
  const [copied, copy] = useCopyFeedback();
  const token = skillMentionToken(skill);
  const summary = cardSummary(skill);
  const tags = extraTags(skill);
  const markdown = useMemo(() => serializeSkillMarkdown(skill), [skill]);
  const isOfficial = skill.storage === SKILL_STORAGE_OFFICIAL;
  const isLocal = skill.storage === SKILL_STORAGE_LOCAL;
  const navigate = useNavigate();
  const cloudHint = !signedIn ? "登录后才能保存到云端" : cloudFull ? "云端已满，先删一个" : "";
  const localHint = localFull ? "本地已满" : "";
  const initial = Array.from(String(skill.name || "技"))[0];
  const updated = formatDate(skill.updatedAt);
  const meta = isOfficial
    ? "由平台维护"
    : [isLocal ? "仅此浏览器" : "跟随账号同步", updated ? `更新于 ${updated}` : ""].filter(Boolean).join(" · ");

  function toCloud() {
    if (!signedIn) return onRequestAuth();
    onMove(skill, SKILL_STORAGE_CLOUD);
  }

  return (
    <div className={`skills-scrim is-drawer${closing ? " is-closing" : ""}`} role="presentation" onMouseDown={onClose}>
      <aside
        className={`skills-drawer is-${skill.storage}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="skills-drawer__head">
          <span className="skills-drawer__head-meta">
            <StorageBadge storage={skill.storage} />
            <span>{meta}</span>
          </span>
          <span className="skills-drawer__head-actions">
            {isOfficial && skill.sourceUrl ? <SkillSourceLink url={skill.sourceUrl} /> : null}
            <button type="button" className="skills-icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={18} />
            </button>
          </span>
        </header>

        <div className="skills-drawer__body">
          {skill.coverUrl ? <img className="skills-drawer__cover" src={skill.coverUrl} alt="" /> : null}

          <div className="skills-drawer__hero">
            {!skill.coverUrl ? (
              <span className={`skills-drawer__avatar is-tone-${placeholderTone(skill.name)}`} aria-hidden="true">
                {initial}
              </span>
            ) : null}
            <div className="skills-drawer__hero-text">
              <h2 id="skill-detail-title">{skill.name}</h2>
              {summary ? <p className="skills-drawer__lead">{summary}</p> : null}
            </div>
          </div>

          {token && (
            <div className="skills-drawer__call">
              <span className="skills-drawer__call-label">调用</span>
              <code className="skill-token is-lg">{token}</code>
              <CopyButton copied={copied === "token"} onClick={() => copy("token", token)} />
            </div>
          )}

          {tags.length > 0 && (
            <ul className="skills-drawer__tags">
              {tags.map((tag) => (
                <li key={tag}>#{tag}</li>
              ))}
            </ul>
          )}

          {isOfficial ? (
            <>
              {skill.sampleImages?.length ? (
                <DrawerSection title="效果示例">
                  <SkillSampleGallery samples={skill.sampleImages} copied={copied} copy={copy} />
                </DrawerSection>
              ) : null}
              <DrawerSection title="怎么用">
                {skill.usageGuide ? (
                  <SkillUsageGuide text={skill.usageGuide} copied={copied} copy={copy} />
                ) : (
                  <p className="skills-guide">在支持的输入框里输入 {token}，后面接着写你的需求即可。</p>
                )}
                <p className="skills-drawer__note">内置技能的具体规则由平台维护，调用时自动生效。</p>
              </DrawerSection>
            </>
          ) : (
            <>
              <DrawerSection
                title="正文"
                extra={
                  <div className="skills-tabs is-mini" role="tablist" aria-label="正文视图">
                    <button type="button" role="tab" aria-selected={bodyView === "instruction"} onClick={() => setBodyView("instruction")}>
                      正文
                    </button>
                    <button type="button" role="tab" aria-selected={bodyView === "markdown"} onClick={() => setBodyView("markdown")}>
                      SKILL.md
                    </button>
                  </div>
                }
              >
                <div className="skills-codebox">
                  <pre className={"skills-pre" + (bodyView === "markdown" ? " is-mono" : "")}>
                    {bodyView === "markdown" ? markdown : skill.instruction}
                  </pre>
                  <div className="skills-codebox__tools">
                    <CopyButton
                      copied={copied === "markdown"}
                      label={bodyView === "markdown" ? "复制 SKILL.md" : "复制正文"}
                      onClick={() => copy("markdown", bodyView === "markdown" ? markdown : skill.instruction)}
                    />
                    <button type="button" className="skills-link" onClick={() => downloadSkillMarkdown(skill)}>
                      <Download size={13} aria-hidden="true" />
                      导出 SKILL.md
                    </button>
                  </div>
                </div>
              </DrawerSection>

              {skill.usageGuide ? (
                <DrawerSection title="使用说明">
                  <SkillUsageGuide text={skill.usageGuide} copied={copied} copy={copy} />
                </DrawerSection>
              ) : null}

              <DrawerSection title="信息">
                <dl className="skills-drawer__meta">
                  <div>
                    <dt>调用名</dt>
                    <dd>
                      <code>{skill.slug || "—"}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>保存在</dt>
                    <dd>{isLocal ? "本地（仅此浏览器）" : "云端（跟随账号）"}</dd>
                  </div>
                  {updated ? (
                    <div>
                      <dt>更新时间</dt>
                      <dd>{updated}</dd>
                    </div>
                  ) : null}
                </dl>
              </DrawerSection>
            </>
          )}
        </div>

        <footer className="skills-drawer__foot">
          {isOfficial ? (
            <div className="skills-drawer__entries">
              <Btn variant="is-primary" icon={ArrowRight} onClick={() => navigate(SKILL_ENTRY_POINTS[0].href)}>
                去{SKILL_ENTRY_POINTS[0].label}使用
              </Btn>
              <span className="skills-drawer__entry-links">
                也可以在
                {SKILL_ENTRY_POINTS.slice(1).map((entry) => (
                  <button key={entry.key} type="button" className="skills-link" onClick={() => navigate(entry.href)}>
                    {entry.label}
                  </button>
                ))}
                里 @ 它
              </span>
            </div>
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
  const [tab, setTab] = useState(LIBRARY_TAB_OFFICIAL);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimerRef = useRef(0);
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

  // 关抽屉先播退场动画，结束后再卸载。
  const closeDrawer = useCallback(() => {
    setDrawerClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setSelectedId("");
      setDrawerClosing(false);
    }, DRAWER_EXIT_MS);
  }, []);

  const openDrawer = useCallback((id) => {
    window.clearTimeout(closeTimerRef.current);
    setDrawerClosing(false);
    setSelectedId(id);
  }, []);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  useEffect(() => {
    if (editor.open || (!confirmDelete && !selectedId)) return undefined;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(null);
      else closeDrawer();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor.open, confirmDelete, selectedId, closeDrawer]);

  const { items, quota } = library;
  const cloudFull = quota.cloud.used >= quota.cloud.max;
  const localFull = quota.local.used >= quota.local.max;

  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items.filter((skill) => {
      const isOfficial = skill.storage === SKILL_STORAGE_OFFICIAL;
      if (tab === LIBRARY_TAB_OFFICIAL ? !isOfficial : isOfficial) return false;
      if (tab === LIBRARY_TAB_MINE && filter !== "all" && skill.storage !== filter) return false;
      if (!keyword) return true;
      return `${skill.name} ${skill.description} ${skill.slug || ""} ${skillMentionToken(skill)} ${(skill.tags || []).join(" ")}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [items, tab, filter, query]);

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
        openDrawer(saved.id);
        setTab(LIBRARY_TAB_MINE);
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
      if (moved?.id) openDrawer(moved.id);
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

  const mineCount = library.local.length + library.cloud.length;
  const counts = { official: library.official.length, mine: mineCount, local: library.local.length };
  const busyLoading = loading || authLoading;
  const isMineTab = tab === LIBRARY_TAB_MINE;
  const emptyMine = !busyLoading && isMineTab && mineCount === 0;
  const emptyResult = !busyLoading && visible.length === 0;
  const cloudSignedOut = isMineTab && filter === SKILL_STORAGE_CLOUD && !signedIn;

  function switchTab(next) {
    setTab(next);
    setFilter("all");
  }

  return (
    <div className="ch-page ch-page--skills" data-testid="skills-page">
      <div className="ch-shell">
        <h1 className="skills-sr-only">技能库</h1>

        <div className="ch-sticky-bar">
          <div className="ch-toolbar skills-toolbar">
            <LibraryTabs tab={tab} onTab={switchTab} counts={counts} />
            <label className="ch-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                value={query}
                aria-label="搜索技能"
                placeholder={isMineTab ? "搜索我的技能" : "搜索内置技能"}
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
            <span className="skills-toolbar__actions">
              <Btn icon={Upload} onClick={() => importRef.current?.click()}>
                上传 SKILL.md
              </Btn>
              <Btn variant="is-primary" icon={Plus} onClick={() => openEditor()}>
                新建技能
              </Btn>
            </span>
          </div>
          {isMineTab && <StorageNav filter={filter} onFilter={setFilter} counts={counts} quota={quota} />}
        </div>

        <section className="ch-section" id="skills-tabpanel" role="tabpanel" aria-labelledby={`skills-tab-${tab}`}>
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

            <div key={`${tab}:${filter}`} className="skills-panel">
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
              ) : emptyMine ? (
                <div className="ch-empty">
                  <strong>还没有自己的技能</strong>
                  <span>把反复要写的要求存成技能，下次输入 @ 就能调用；未登录也能先存在本地。</span>
                  <div className="skills-empty__actions">
                    <Btn variant="is-primary" icon={Plus} onClick={() => openEditor()}>
                      新建技能
                    </Btn>
                    <Btn icon={Upload} onClick={() => importRef.current?.click()}>
                      上传 SKILL.md
                    </Btn>
                  </div>
                </div>
              ) : emptyResult ? (
                <div className="ch-empty">
                  <strong>
                    {cloudSignedOut
                      ? "登录后查看云端技能"
                      : query
                        ? "没有匹配的技能"
                        : isMineTab
                          ? "这里还没有技能"
                          : "暂时还没有内置技能"}
                  </strong>
                  <span>
                    {cloudSignedOut
                      ? "云端技能跟随账号，换设备也能用。"
                      : query
                        ? "换个词试试，或切换到另一个技能库。"
                        : isMineTab
                          ? "换一个位置，或新建一个。"
                          : "先看看我的技能库，或新建一个。"}
                  </span>
                  {cloudSignedOut ? (
                    <Btn variant="is-primary" onClick={promptCloudAuth}>
                      登录
                    </Btn>
                  ) : query || (isMineTab && filter !== "all") ? (
                    <Btn
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      {query ? "清除搜索" : "查看全部"}
                    </Btn>
                  ) : null}
                </div>
              ) : (
                <SkillGrid
                  skills={visible}
                  selectedId={selected?.id}
                  onOpen={openDrawer}
                  showStorage={isMineTab && filter === "all"}
                  label={isMineTab ? "我的技能" : "内置技能"}
                />
              )}
            </div>
        </section>
      </div>

      {selected && (
        <SkillDetail
          key={selected.id}
          skill={selected}
          closing={drawerClosing}
          signedIn={signedIn}
          cloudFull={cloudFull}
          localFull={localFull}
          busy={busyId === selected.id}
          onClose={closeDrawer}
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
        existingSkills={items}
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
