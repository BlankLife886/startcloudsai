import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Layers3,
  Palette,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { DEMO_SKILLS } from "../features/skills/demoCatalog.js";
import SkillEmblem from "../features/skills/SkillEmblem.jsx";
import {
  DEMO_SKILL_GUIDES,
  createDemoSkillRun,
} from "../features/skills/demoGuides.js";
import "./skills.css";

const ICONS = {
  shopping: ShoppingBag,
  image: ImageIcon,
  character: UserRound,
  palette: Palette,
  copy: Type,
  document: FileText,
};
const CATEGORIES = ["全部方向", "图像创作", "设计策划", "日常效率"];

function SkillGlyph({ skill, size = 22 }) {
  const Icon = ICONS[skill.icon] || Sparkles;
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true" />;
}

function sectionTitle(value) {
  return value.replace(/^\d+\s*\/\s*/, "");
}

function sectionExcerpt(section) {
  const text = section.body || section.bullets?.[0] || "";
  return text.length > 78 ? text.slice(0, 78) + "…" : text;
}

function PalettePreview({ palette }) {
  return (
    <div className="skills-demo__colors" aria-label="示例配色">
      {palette.map((color) => (
        <div key={color.hex}>
          <span style={{ backgroundColor: color.hex }} />
          <strong>{color.name}</strong>
          <small>{color.hex}</small>
        </div>
      ))}
    </div>
  );
}

function SamplePreview({ result }) {
  return (
    <section className="skills-demo__sample-result" aria-label="示例结果">
      <div className="skills-demo__sample-result-label">
        <Sparkles size={14} aria-hidden="true" />
        <span>使用 Skill 后 · 示例节选</span>
      </div>
      {result.palette ? (
        <PalettePreview palette={result.palette} />
      ) : (
        <div className="skills-demo__sample-columns">
          {result.sections.slice(0, 2).map((section) => (
            <div key={section.title}>
              <h4>{sectionTitle(section.title)}</h4>
              <p>{sectionExcerpt(section)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SkillDetail({ skill, added, onToggleAdded, onBack }) {
  const guide = DEMO_SKILL_GUIDES[skill.id];
  const [mode, setMode] = useState("overview");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [request, setRequest] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const requestRef = useRef(null);
  const example = guide.examples[exampleIndex];
  const preview = useMemo(
    () => createDemoSkillRun(skill, example.request),
    [skill, example.request],
  );

  function tryExample() {
    setRequest(example.request);
    setResult(null);
    setError("");
    setMode("try");
  }

  function useExample() {
    setRequest(example.request);
    setResult(null);
    setError("");
  }

  function generate(event) {
    event.preventDefault();
    const value = request.trim();
    if (!value || value.length > 1200) {
      setError(
        !value
          ? "先写下这次想完成的事，或者使用一个示例。"
          : "请将需求控制在 1200 字以内。",
      );
      requestRef.current?.focus();
      return;
    }
    // The demo applies local sample data only. It never creates a real task.
    setResult(createDemoSkillRun(skill, value));
    setCopyState("");
    setError("");
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(result.text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  function downloadResult() {
    const link = document.createElement("a");
    link.href =
      "data:text/plain;charset=utf-8," + encodeURIComponent(result.text);
    link.download = skill.name + "-演示结果.txt";
    link.click();
  }

  return (
    <section className="skills-demo__detail" aria-label={skill.name + "详情"}>
      <button className="skills-demo__back" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        返回技能库
      </button>
      <header className="skills-demo__detail-head">
        <div className="skills-demo__detail-identity">
          <SkillEmblem tone={skill.icon}>
            <SkillGlyph skill={skill} size={32} />
          </SkillEmblem>
          <div className="skills-demo__title-copy">
            <div className="skills-demo__detail-meta">
              <span>{skill.category}</span>
              <i />
              <span>官方示例</span>
            </div>
            <h2>{skill.name}</h2>
            <p className="skills-demo__detail-summary">{guide.summary}</p>
          </div>
        </div>
        <div className="skills-demo__detail-actions">
          <button
            className={"skills-demo__add" + (added ? " is-added" : "")}
            type="button"
            aria-label={(added ? "移除" : "添加") + skill.name}
            aria-pressed={added}
            onClick={onToggleAdded}
          >
            {added ? <Check size={16} /> : <Plus size={16} />}
            {added ? "已添加" : "添加 Skill"}
          </button>
          <button
            className="skills-demo__primary"
            type="button"
            aria-label={"试用" + skill.name}
            onClick={() => setMode("try")}
          >
            试用 Skill
            <ArrowUpRight size={16} />
          </button>
        </div>
      </header>
      <div className="skills-demo__detail-tabs" aria-label="技能内容">
        <button
          type="button"
          aria-pressed={mode === "overview"}
          onClick={() => setMode("overview")}
        >
          方法与示例
        </button>
        <button
          type="button"
          aria-pressed={mode === "try"}
          onClick={() => setMode("try")}
        >
          试用
        </button>
        <span>
          {skill.outputLabel}
          <FileText size={13} aria-hidden="true" />
        </span>
      </div>

      {mode === "overview" ? (
        <div className="skills-demo__overview">
          <section className="skills-demo__method" aria-label="使用方法">
            <header>
              <h3>工作方式</h3>
              <p>{guide.whenToUse}</p>
            </header>
            <ol>
              {guide.rules.map((rule, index) => (
                <li key={rule.title}>
                  <span className="skills-demo__rule-number">
                    {"0" + (index + 1)}
                  </span>
                  <h4>{rule.title}</h4>
                  <p>{rule.description}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className="skills-demo__examples" aria-label="使用示例">
            <header>
              <div>
                <h3>使用示例</h3>
              </div>
              <div className="skills-demo__example-switch">
                {guide.examples.map((item, index) => (
                  <button
                    key={item.label}
                    type="button"
                    aria-label={"示例：" + item.label}
                    aria-pressed={exampleIndex === index}
                    onClick={() => setExampleIndex(index)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </header>
            <div className="skills-demo__sample">
              <div className="skills-demo__sample-request">
                <span>需求</span>
                <p>{example.request}</p>
              </div>
              <SamplePreview result={preview} />
              <footer>
                <button
                  className="skills-demo__text-button"
                  type="button"
                  onClick={tryExample}
                >
                  用这个示例试用
                  <ArrowRight size={15} />
                </button>
              </footer>
            </div>
          </section>
        </div>
      ) : (
        <div className="skills-demo__trial">
          <div className="skills-demo__trial-top">
            <span>
              <span className="skills-demo__status-dot" />
              正在试用 · {skill.name}
            </span>
            <small>预设演示，不调用 AI</small>
          </div>
          <div className="skills-demo__trial-grid">
            <form
              className="skills-demo__request-form"
              onSubmit={generate}
              noValidate
            >
              <div className="skills-demo__request-heading">
                <label htmlFor="skill-demo-request">这次想完成什么</label>
                <button
                  className="skills-demo__text-button"
                  type="button"
                  onClick={useExample}
                >
                  使用示例
                  <ArrowUpRight size={13} />
                </button>
              </div>
              <textarea
                ref={requestRef}
                id="skill-demo-request"
                aria-label="这次想完成什么"
                value={request}
                maxLength={1200}
                placeholder={
                  "写下你的具体需求，或先试试「" + example.label + "」…"
                }
                onChange={(event) => {
                  setRequest(event.target.value);
                  setError("");
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "skill-demo-error" : undefined}
              />
              {error && (
                <p
                  id="skill-demo-error"
                  className="skills-demo__error"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="skills-demo__request-foot">
                <span>
                  {request.length}
                  <i>/ 1200</i>
                </span>
                <button className="skills-demo__primary" type="submit">
                  生成演示结果
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="skills-demo__applied">
                <h4>这套方法继续生效</h4>
                <ul>
                  {guide.rules.map((rule) => (
                    <li key={rule.title}>
                      <Check size={13} aria-hidden="true" />
                      {rule.title}
                    </li>
                  ))}
                </ul>
              </div>
            </form>
            {result ? (
              <section
                className="skills-demo__run-result"
                aria-label="演示结果"
                aria-live="polite"
              >
                <header>
                  <span>
                    <FileText size={15} aria-hidden="true" />
                    演示结果
                  </span>
                  <div>
                    <button
                      type="button"
                      aria-label="下载演示结果"
                      title="下载文本"
                      onClick={downloadResult}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="复制演示结果"
                      title={copyState === "copied" ? "已复制" : "复制内容"}
                      onClick={copyResult}
                    >
                      {copyState === "copied" ? (
                        <Check size={16} />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                  </div>
                </header>
                <div className="skills-demo__result-content">
                  <h3>{result.title}</h3>
                  <p className="skills-demo__result-lead">{result.summary}</p>
                  {result.palette && (
                    <PalettePreview palette={result.palette} />
                  )}
                  {result.sections.map((section) => (
                    <article key={section.title}>
                      <h4>{sectionTitle(section.title)}</h4>
                      {section.body && <p>{section.body}</p>}
                      {section.bullets && (
                        <ul>
                          {section.bullets.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  ))}
                  <p className="skills-demo__result-note">
                    这是用于体验 Skill 使用方式的示例内容。
                  </p>
                </div>
                <span className="skills-demo__sr-only" role="status">
                  {copyState === "copied" ? "演示结果已复制" : ""}
                </span>
                {copyState === "error" && (
                  <p className="skills-demo__error" role="alert">
                    复制未成功，可以下载文本。
                  </p>
                )}
              </section>
            ) : (
              <div className="skills-demo__result-placeholder">
                <div className="skills-demo__paper" aria-hidden="true">
                  <span>
                    <Layers3 size={20} />
                  </span>
                  <i />
                  <i />
                  <i />
                  <b />
                  <i />
                  <i />
                </div>
                <h3>你的需求，它的方法</h3>
                <p>
                  写下一句话，看看这个 Skill
                  <br />
                  如何组织一份清楚的结果。
                </p>
                <span>演示结果会出现在这里</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function SkillsView() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部方向");
  const [addedOnly, setAddedOnly] = useState(false);
  const [added, setAdded] = useState([]);
  const [selectedId, setSelectedId] = useState(DEMO_SKILLS[0].id);
  const [detailOpen, setDetailOpen] = useState(false);
  const items = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return DEMO_SKILLS.filter(
      (skill) =>
        (!addedOnly || added.includes(skill.id)) &&
        (category === "全部方向" || skill.category === category) &&
        (skill.name + " " + skill.description + " " + skill.outputLabel)
          .toLocaleLowerCase()
          .includes(value),
    );
  }, [query, category, addedOnly, added]);
  const selected = items.find((skill) => skill.id === selectedId) || items[0];

  function toggleAdded(id) {
    setAdded((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function resetFilters() {
    setQuery("");
    setCategory("全部方向");
    setAddedOnly(false);
    setDetailOpen(false);
  }

  function selectSkill(id) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  return (
    <div
      className="skills-demo"
      data-testid="skills-demo"
      data-detail-open={detailOpen}
    >
      <div className="skills-demo__inner">
        <header className="skills-demo__page-head">
          <div>
            <div className="skills-demo__page-title">
              <span>
                <Layers3 size={23} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <h1>Skill 中心</h1>
            </div>
            <p>为 AI 准备好的专业方法，按需选用，反复复用。</p>
          </div>
          <span className="skills-demo__demo-badge">
            <i />
            独立 Demo<span>仅在本页体验</span>
          </span>
        </header>
        <div className="skills-demo__toolbar">
          <div className="skills-demo__collection-tabs" aria-label="技能集合">
            <button
              type="button"
              aria-pressed={!addedOnly}
              onClick={() => {
                setAddedOnly(false);
                setDetailOpen(false);
              }}
            >
              全部技能
            </button>
            <button
              type="button"
              aria-label="已添加"
              aria-pressed={addedOnly}
              onClick={() => {
                setAddedOnly(true);
                setDetailOpen(false);
              }}
            >
              已添加{added.length > 0 && <span>{added.length}</span>}
            </button>
          </div>
          <label className="skills-demo__search">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="搜索 Skill"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能或用途"
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </label>
        </div>
        <div className="skills-demo__layout">
          <aside className="skills-demo__library" aria-label="技能列表">
            <div className="skills-demo__library-head">
              <span>{addedOnly ? "我的技能" : "选择一个技能"}</span>
              <label>
                <select
                  value={category}
                  aria-label="技能分类"
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {CATEGORIES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
            </div>
            <div className="skills-demo__list">
              {items.map((skill) => (
                <article
                  className={
                    "skills-demo__card" +
                    (selected?.id === skill.id ? " is-selected" : "")
                  }
                  key={skill.id}
                >
                  <button
                    type="button"
                    aria-label={"查看" + skill.name}
                    aria-pressed={selected?.id === skill.id}
                    onClick={() => selectSkill(skill.id)}
                  >
                    <span className={"skills-demo__glyph is-" + skill.icon}>
                      <SkillGlyph skill={skill} size={19} />
                    </span>
                    <span className="skills-demo__card-copy">
                      <strong>{skill.name}</strong>
                      <small>{skill.description}</small>
                    </span>
                    {added.includes(skill.id) && (
                      <Check
                        className="skills-demo__saved-mark"
                        size={14}
                        aria-label="已添加"
                      />
                    )}
                  </button>
                </article>
              ))}
            </div>
            <div className="skills-demo__library-note">
              <span>一个 Skill，一套好方法。</span>
              <p>先看看它如何处理不同的需求，再决定是否添加。</p>
            </div>
          </aside>
          {selected ? (
            <SkillDetail
              key={selected.id}
              skill={selected}
              added={added.includes(selected.id)}
              onToggleAdded={() => toggleAdded(selected.id)}
              onBack={() => setDetailOpen(false)}
            />
          ) : (
            <div className="skills-demo__empty">
              <span>
                {addedOnly ? <Plus size={27} /> : <Search size={27} />}
              </span>
              <h2>
                {addedOnly && !added.length
                  ? "把常用的方法，留在手边"
                  : "暂时没有找到合适的 Skill"}
              </h2>
              <p>
                {addedOnly && !added.length
                  ? "从全部技能中选一个，了解它的方法后点击添加。"
                  : "换一个关键词，或看看其他方向。"}
                <br />
                添加与试用都只在当前 Demo 中生效。
              </p>
              <button
                className="skills-demo__primary"
                type="button"
                onClick={resetFilters}
              >
                浏览全部技能
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
        <p className="skills-demo__page-note">
          演示数据 · 不调用 AI、不消耗积分 · 刷新后清空本页添加记录
        </p>
      </div>
    </div>
  );
}
