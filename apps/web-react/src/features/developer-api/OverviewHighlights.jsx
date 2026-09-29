import {Activity,ArrowRight,Box,CalendarDays,KeyRound} from 'lucide-react';
import {number} from './presentation.js';

export function OverviewHighlights({data,ready,summary,onKeys,onQuickstart,onModels}) {
  const resources = [
    {label:'可用 Key',value:ready.keys ? summary.usableKeys : '—',note:ready.keys ? `${summary.retained} / 10 个保留名额` : '名额待同步',Icon:KeyRound,onClick:onKeys},
    {label:'可调用模型',value:ready.models ? data.models.length : '—',note:'图片与对话，按模型名调用',Icon:Box,onClick:onModels},
    {label:'本月请求',value:ready.keys ? number(summary.monthTasks) : '—',note:'全部 Key 合计，UTC 自然月',Icon:CalendarDays},
  ];

  return <>
    <section className="dap-overview-stage" aria-label="工作区概览">
      <article className="dap-primary-metric">
        <header><span className="dap-primary-label"><Activity size={16}/>今日调用概览</span><span className="dap-primary-period">UTC 自然日</span></header>
        <div className="dap-primary-body">
          <div><span className="dap-primary-caption">今日计费请求</span><strong className="dap-primary-number">{ready.keys ? number(summary.todayTasks) : '—'}<small>次</small></strong></div>
          <div className="dap-primary-budget"><span>今日提交预算</span><strong>{ready.keys ? number(summary.todayBudget) : '—'}<small>积分</small></strong><small>按提交时预留累计，明确失败已扣除</small></div>
        </div>
        <footer><button type="button" onClick={onKeys}>管理访问凭据<ArrowRight size={15}/></button><button type="button" className="subtle" onClick={onQuickstart}>开始接入<ArrowRight size={14}/></button></footer>
      </article>
    </section>

    <section className="dap-resource-summary" aria-label="资源摘要">
      {resources.map(({label,value,note,Icon,onClick})=>{
        const body = <><span className="dap-resource-icon"><Icon size={20}/></span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></>;
        return onClick
          ? <button type="button" className="dap-resource" key={label} onClick={onClick}>{body}</button>
          : <div className="dap-resource" key={label}>{body}</div>;
      })}
    </section>
  </>;
}
