import {Activity,ArrowRight,Box,KeyRound,Webhook} from 'lucide-react';
import {number} from './presentation.js';

export function OverviewHighlights({data,ready,summary,onKeys,onQuickstart,onDeliveries}) {
  const total = data.deliveries.length;
  const delivered = data.deliveries.filter(item => item.status === 'delivered').length;
  const pending = data.deliveries.filter(item => item.status === 'pending').length;
  const failed = data.deliveries.filter(item => item.status === 'dead').length;
  const deliveredAngle = total ? delivered / total * 360 : 0;
  const pendingAngle = total ? (delivered + pending) / total * 360 : 0;
  const segments = total
    ? `conic-gradient(var(--d-green) 0deg ${deliveredAngle}deg, var(--d-amber) ${deliveredAngle}deg ${pendingAngle}deg, var(--d-red) ${pendingAngle}deg 360deg)`
    : 'var(--d-line)';
  const resources = [
    {label:'可用 Key',value:ready.keys ? summary.usableKeys : '—',note:ready.keys ? `${summary.retained} / 10 个保留名额` : '名额待同步',Icon:KeyRound,tone:'violet'},
    {label:'开放模型',value:ready.models ? data.models.length : '—',note:'当前可接入的模型',Icon:Box,tone:'blue'},
    {label:'启用回调',value:ready.webhooks ? data.webhooks.filter(item=>item.enabled).length : '—',note:ready.webhooks ? `共 ${data.webhooks.length} 个端点` : '端点待同步',Icon:Webhook,tone:'green'},
    {label:'等待投递',value:ready.deliveries ? pending : '—',note:'最近100条回调记录',Icon:Activity,tone:'amber'},
  ];

  return <>
    <section className="dap-overview-stage" aria-label="工作区概览">
      <article className="dap-primary-metric">
        <header><span className="dap-primary-label"><Activity size={16}/>今日任务概览</span><span className="dap-primary-period">UTC 自然日</span></header>
        <div className="dap-primary-body">
          <div><span className="dap-primary-caption">今日提交任务</span><strong className="dap-primary-number">{ready.keys ? number(summary.todayTasks) : '—'}<small>次</small></strong></div>
          <div className="dap-primary-budget"><span>今日提交预算</span><strong>{ready.keys ? number(summary.todayBudget) : '—'}<small>积分</small></strong><small>累计预留预算，非最终净消费</small></div>
        </div>
        <footer><button type="button" onClick={onKeys}>管理访问凭据<ArrowRight size={15}/></button><button type="button" className="subtle" onClick={onQuickstart}>开始接入<ArrowRight size={14}/></button></footer>
      </article>

      <article className="dap-callback-health">
        <header><div><h3>回调运行状态</h3><p>{ready.deliveries ? `基于最近返回的 ${total} 条记录` : '回调记录待同步'}</p></div><button className="dap-text-button" type="button" onClick={()=>onDeliveries('all')}>详情<ArrowRight size={14}/></button></header>
        <div className="dap-health-body">
          <div className="dap-health-ring" style={{background:segments}} role="img" aria-label={ready.deliveries ? `已送达${delivered}条，等待${pending}条，失败${failed}条` : '回调状态尚未读取'}>
            <div><strong>{ready.deliveries && total ? `${Math.round(delivered / total * 100)}%` : '—'}</strong><span>最近送达率</span></div>
          </div>
          <ul className="dap-health-legend">
            {[['delivered','已送达',delivered],['pending','等待中',pending],['dead','投递失败',failed]].map(([state,label,count])=><li key={state}><span><i className={state}/>{label}</span><strong>{ready.deliveries ? count : '—'}</strong></li>)}
          </ul>
        </div>
        <footer>{failed ? <button type="button" onClick={()=>onDeliveries('dead')}><span><i/>{failed} 条失败回调待关注</span><ArrowRight size={14}/></button> : <span>最多统计最近100条回调记录</span>}</footer>
      </article>
    </section>

    <section className="dap-resource-summary" aria-label="资源摘要">
      {resources.map(({label,value,note,Icon,tone})=><div className="dap-resource" key={label}><span className={`dap-resource-icon ${tone}`}><Icon size={20}/></span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>)}
    </section>
  </>;
}
