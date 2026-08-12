import { useEffect, useMemo, useRef, useState } from "react";
import { CHANGELOG, CHANGELOG_TAG_FILTERS, getChangelogTagMeta } from "@legacy/config/changelog.js";
import "@react/legacy-static/features/updates/styles/updates-page.css";

function timestamp(value) { const time = new Date(value || 0).getTime(); return Number.isFinite(time) ? time : 0; }
function formatDate(value, options = { year: "numeric", month: "short", day: "numeric" }) { const date = new Date(value || 0); return Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", options) : value || "-"; }

export function UpdatesView() {
  const timelineRef = useRef(null);
  const [activeTag, setActiveTag] = useState("all");
  const [entries, setEntries] = useState(CHANGELOG);

  useEffect(() => {
    document.documentElement.classList.add("updates-gallery-page");
    Promise.allSettled([fetch("/api/v1/announcements", { credentials: "include" }).then((response) => response.json()), fetch("/api/v1/meta/changelog", { credentials: "include" }).then((response) => response.json())]).then(([, changelog]) => {
      const remote = changelog.status === "fulfilled" ? changelog.value?.data : null;
      if (Array.isArray(remote) && remote.length) setEntries(remote);
    });
    return () => document.documentElement.classList.remove("updates-gallery-page");
  }, []);

  const timeline = useMemo(() => [...entries].sort((a, b) => timestamp(b.date) - timestamp(a.date)), [entries]);
  const filtered = activeTag === "all" ? timeline : timeline.filter((entry) => entry.tag === activeTag);
  const featured = filtered.find((entry) => entry.highlight) || filtered[0] || null;
  const rest = featured ? filtered.filter((entry) => entry.id !== featured.id) : filtered;
  const groups = [];
  for (const entry of rest) {
    const date = new Date(entry.date || 0);
    const key = Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${date.getMonth()}` : "unknown";
    let group = groups.find((item) => item.key === key);
    if (!group) { group = { key, label: formatDate(entry.date, { year: "numeric", month: "long" }), entries: [] }; groups.push(group); }
    group.entries.push(entry);
  }
  const stats = { total: entries.length, features: entries.filter((entry) => entry.tag === "feature").length, experience: entries.filter((entry) => entry.tag === "experience").length, latest: entries.find((entry) => entry.highlight)?.version || entries[0]?.version || "-" };
  const recent = [...new Map(timeline.map((entry) => [entry.version, entry])).values()].slice(0, 3);

  return (
    <main className="updates-page is-ready">
      <div className="updates-atmosphere" aria-hidden="true"><span className="updates-atmosphere__orb updates-atmosphere__orb--a" /><span className="updates-atmosphere__orb updates-atmosphere__orb--b" /><span className="updates-atmosphere__grid" /></div>
      <section className="updates-intro">
        <div className="updates-copy" data-updates-motion><div className="updates-copy__spine" aria-hidden="true"><span>StarCloud</span><i /><em>Vol.Notes</em></div><div className="updates-copy__body"><span className="updates-copy__eyebrow">StarCloudIsAI · Updates</span><h1><span className="updates-copy__title">更新说明</span><span className="updates-copy__seal" aria-hidden="true">更</span></h1><p className="updates-copy__lead">每一版可见的变化，都在这里立档。新功能、体验打磨与平台公告，按时间展陈。</p><div className="updates-copy__meta" aria-label="更新统计">{[[stats.total, "版本记录"], [stats.features, "新功能"], [stats.experience, "体验"], [stats.latest, "最新"]].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div><div className="updates-copy__actions"><div className="updates-filter" role="tablist" aria-label="按类型筛选">{CHANGELOG_TAG_FILTERS.map((filter) => <button key={filter.id} type="button" role="tab" className={`updates-filter__btn${activeTag === filter.id ? " active" : ""}`} aria-selected={activeTag === filter.id} onClick={() => setActiveTag(filter.id)}>{filter.label}</button>)}</div><button type="button" className="updates-copy__cta" onClick={() => timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>浏览时间线 <i className="bi bi-arrow-down" /></button></div></div></div>
        <aside className="updates-catalogue" data-updates-motion aria-label="近期版本"><div className="updates-catalogue__head"><span className="updates-catalogue__kicker">Catalogue</span><strong>近期版本</strong></div><ol className="updates-catalogue__list">{recent.map((row, index) => { const meta = getChangelogTagMeta(row.tag); return <li key={row.version}><span className="updates-catalogue__index">{String(index + 1).padStart(2, "0")}</span><div className="updates-catalogue__main"><div className="updates-catalogue__row"><span className="updates-catalogue__version">{row.version}</span><span className={`updates-tag ${meta.className}`}>{meta.label}</span></div><p>{row.title}</p><time>{formatDate(row.date)}</time></div></li>; })}</ol></aside>
      </section>
      <div className="updates-shell">{!filtered.length ? <div className="updates-empty"><p>暂无更新记录</p></div> : <div ref={timelineRef} className="updates-feed">{featured && <article className="updates-spotlight" data-updates-motion><div className="updates-spotlight__watermark" aria-hidden="true">{featured.version}</div><div className="updates-spotlight__rail" aria-hidden="true" /><div className="updates-spotlight__body"><div className="updates-spotlight__head"><div className="updates-spotlight__meta"><span className="updates-spotlight__badge">本期焦点</span><span className="updates-spotlight__version">{featured.version}</span><span className={`updates-tag ${getChangelogTagMeta(featured.tag).className}`}>{getChangelogTagMeta(featured.tag).label}</span></div><time className="updates-date">{formatDate(featured.date)}</time></div><h2>{featured.title}</h2>{featured.summary && <p>{featured.summary}</p>}{featured.items?.length > 0 && <ul className="updates-items updates-items--featured">{featured.items.map((item) => <li key={item}>{item}</li>)}</ul>}</div></article>}<div className="updates-timeline">{groups.map((group) => <section key={group.key} className="updates-month-group"><div className="updates-month-head"><h2 className="updates-month-label">{group.label}</h2><span className="updates-month-line" aria-hidden="true" /><span className="updates-month-count">{group.entries.length} 条</span></div><div className="updates-month-rail">{group.entries.map((entry) => { const meta = getChangelogTagMeta(entry.tag); return <article key={entry.id} className="updates-entry"><div className="updates-entry__aside"><span className="updates-entry__dot" aria-hidden="true" /><time className="updates-entry__date">{formatDate(entry.date)}</time><span className="updates-entry__version">{entry.version}</span></div><div className="updates-card"><div className="updates-card__top"><h3>{entry.title}</h3><span className={`updates-tag ${meta.className}`}>{meta.label}</span></div>{entry.summary && <p>{entry.summary}</p>}{entry.items?.length > 0 && <ul className="updates-items">{entry.items.map((item) => <li key={item}>{item}</li>)}</ul>}</div></article>; })}</div></section>)}</div></div>}</div>
    </main>
  );
}
