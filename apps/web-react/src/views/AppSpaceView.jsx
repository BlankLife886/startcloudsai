import { useMemo, useState } from "react";
import { APP_CATALOG, APP_SCOPE_EMPTY, APP_SCOPE_LABELS, APP_TYPE_LABELS } from "@react/legacy-modules/config/appCatalog.js";
import "@react/legacy-static/features/app-space/styles/app-space.css";

const scopeOrder = ["site", "other"];

function enrich(app) {
  const status = app.status === "published" || app.status === "draft" ? app.status : app.href ? "published" : "draft";
  return { ...app, status, scopeLabel: APP_SCOPE_LABELS[app.scope] || app.scope, typeLabel: APP_TYPE_LABELS[app.type] || app.type, href: status === "published" ? app.href : "" };
}

export function AppSpaceView() {
  const [filter, setFilter] = useState("all");
  const apps = useMemo(() => APP_CATALOG.map(enrich).sort((a, b) => a.sort - b.sort), []);
  const published = apps.filter((app) => app.status === "published");
  const drafts = apps.filter((app) => app.status === "draft");
  const visible = filter === "published" ? published : filter === "draft" ? drafts : apps;
  const groups = scopeOrder.map((scope) => ({ scope, label: APP_SCOPE_LABELS[scope], emptyText: APP_SCOPE_EMPTY[scope], apps: visible.filter((app) => app.scope === scope) }));

  return (
    <main className="app-space-page">
      <div className="app-space-rings" aria-hidden="true" />
      <div className="app-space-orb" aria-hidden="true" />
      <div className="app-space-shell">
        <header className="app-space-hero"><span className="app-space-kicker"><i className="bi bi-columns-gap" /> ABOUT US</span><h1 className="app-space-title">关于我们</h1><p className="app-space-lead">本站 App、小程序，以及其他站点产品的下载与打开入口</p></header>
        <nav className="app-space-toolbar" aria-label="产品筛选">
          <button type="button" className={`app-space-filter${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>全部 {apps.length}</button>
          <button type="button" className={`app-space-filter${filter === "published" ? " active" : ""}`} onClick={() => setFilter("published")}>已上线 {published.length}</button>
          <button type="button" className={`app-space-filter${filter === "draft" ? " active" : ""}`} onClick={() => setFilter("draft")}>筹备中 {drafts.length}</button>
        </nav>
        {groups.map((group) => (
          <section key={group.scope} className="app-space-section">
            <div className="app-space-section-head"><h2>{group.label}</h2>{group.apps.length > 0 && <span>{group.apps.length}</span>}</div>
            {group.apps.length ? <div className="app-space-grid">{group.apps.map((app) => {
              const content = <><span className="app-card-glow" /><span className={`app-card-badge ${app.href ? "is-live" : "is-soon"}`}>{app.typeLabel}</span><span className="app-card-icon"><i className={`bi ${app.icon}`} /></span><div className="app-card-body"><span className="app-card-category">{app.scopeLabel} · {app.typeLabel}{app.platform ? ` · ${app.platform}` : ""}</span><h3 className="app-card-name">{app.name}</h3><p className="app-card-tagline">{app.tagline}</p></div><div className="app-card-foot"><span>{app.href ? app.type === "miniprogram" ? "打开小程序" : "前往下载" : "敬请期待"}</span><i className={`bi ${app.href ? "bi-box-arrow-up-right" : "bi-hourglass-split"}`} /></div></>;
              const style = { "--card-accent": app.accent, "--card-accent-rgb": app.accentRgb };
              return app.href ? <a key={app.id} href={app.href} target="_blank" rel="noopener noreferrer" className={`app-card${app.featured ? " is-featured" : ""}`} style={style}><span className="app-card-shimmer" />{content}</a> : <div key={app.id} className="app-card is-draft" style={style}>{content}</div>;
            })}</div> : <div className="app-space-scope-empty">{group.emptyText}</div>}
          </section>
        ))}
      </div>
    </main>
  );
}
