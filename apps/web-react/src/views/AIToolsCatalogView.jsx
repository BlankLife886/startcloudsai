import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Search, ShieldCheck, Wrench } from "lucide-react";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { TOOL_GROUPS, TOOL_STATUS, runtimeMediaTools } from "../features/tool-catalog/toolCatalog.js";
import { useIsDark } from "../hooks/useIsDark.js";
import "./ai-tools-catalog.css";

export function AIToolsCatalogView() {
  const isDark = useIsDark();
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [runtimeConfig, setRuntimeConfig] = useState(null);

  useEffect(() => {
    let active = true;
    fetchRuntimeConfig().then((config) => active && setRuntimeConfig(config)).catch(() => null);
    return () => { active = false; };
  }, []);

  const groups = useMemo(() => TOOL_GROUPS.map((group) => group.id === "utility"
    ? { ...group, tools: [...group.tools, ...runtimeMediaTools(runtimeConfig)] }
    : group), [runtimeConfig]);
  const total = groups.reduce((sum, group) => sum + group.tools.length, 0);
  const visibleGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return groups
      .filter((group) => activeGroup === "all" || group.id === activeGroup)
      .map((group) => ({
        ...group,
        tools: group.tools.filter((item) => !keyword || `${item.name} ${item.description} ${item.id} ${item.surface}`.toLowerCase().includes(keyword)),
      }))
      .filter((group) => group.tools.length);
  }, [activeGroup, groups, query]);

  useEffect(() => {
    const previous = document.title;
    document.title = "全部 AI 工具 · 星空云绘";
    return () => { document.title = previous; };
  }, []);

  return (
    <main className={`ai-tools-page${isDark ? " is-dark" : ""}`}>
      <header className="ai-tools-head">
        <div>
          <Link to="/" className="ai-tools-back" aria-label="返回首页"><ArrowLeft /></Link>
          <span><strong>全部工具</strong><small>当前收录 {total} 项，包含后台动态配置</small></span>
        </div>
        <div className="ai-tools-policy"><ShieldCheck /><span>写入或付费操作需要确认</span></div>
      </header>

      <section className="ai-tools-controls" aria-label="筛选工具">
        <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具、能力或页面" /></label>
        <div role="tablist" aria-label="工具分类">
          {[{ id: "all", label: "全部", tools: Array(total) }, ...groups].map((group) => (
            <button key={group.id} type="button" role="tab" aria-selected={activeGroup === group.id} className={activeGroup === group.id ? "is-on" : ""} onClick={() => setActiveGroup(group.id)}>
              {group.label}<span>{group.id === "all" ? total : group.tools.length}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="ai-tools-groups">
        {visibleGroups.map((group) => (
          <section key={group.id} className="ai-tools-group" aria-labelledby={`tools-${group.id}`}>
            <header><span><Wrench /></span><div><h2 id={`tools-${group.id}`}>{group.label}</h2><p>{group.description}</p></div><b>{group.tools.length}</b></header>
            <div className="ai-tools-list">
              {group.tools.map((item) => {
                const status = TOOL_STATUS[item.status] || TOOL_STATUS.available;
                return (
                  <Link key={`${group.id}-${item.id}`} to={item.to || "/"} className="ai-tool-row">
                    <span className="ai-tool-row__copy"><strong>{item.name}{item.isNew ? <em>新增</em> : null}</strong><small>{item.description}</small></span>
                    <span className="ai-tool-row__meta"><i>{item.surface}</i><b data-tone={status.tone}>{status.label}</b><ArrowRight /></span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
        {!visibleGroups.length ? <div className="ai-tools-empty"><Search /><strong>没有匹配的工具</strong><span>换一个关键词试试</span></div> : null}
      </div>
    </main>
  );
}
