import {Clock,KeyRound,Pause,Pencil,Play,RotateCw,Trash2} from 'lucide-react';
import {Modal} from './Dialogs.jsx';
import {KEY_STATUSES,MODEL_STATUSES,ago,bytes,day,keyModels,keyStatus,number,ratio,time} from './presentation.js';

function Meter({used,limit,label,unit}){
 const percent=ratio(used,limit);
 return <div className={`dap-kd-meter${percent>=85?' is-high':''}`}>
  <span>{label}</span>
  <b>{number(used)}<small> / {number(limit)}{unit}</small></b>
  <i role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Number(limit)||1} aria-valuenow={Math.min(Number(used)||0,Number(limit)||1)}><em style={{width:`${percent}%`}}/></i>
 </div>;
}

function Row({label,children}){return <div className="dap-kd-row"><dt>{label}</dt><dd>{children===undefined||children===null||children===''?'—':children}</dd></div>}

// Status notes a caller needs before the numbers: why calls fail now, and
// which of its models are going away.
function Alerts({item,models}){
 const status=keyStatus(item),alerts=[];
 if(status==='frozen')alerts.push(['bad','已被风控冻结',`${(item.freezeReason||'未记录原因').trim().replace(/[。.！!]+$/,'')}。冻结期间调用返回 403 api_key_frozen，请联系客服核实后解冻；上游故障或超时不会触发冻结。`]);
 if(status==='paused')alerts.push(['info','已停用','调用返回 403 api_key_paused；重新启用后立即恢复，密钥不变。']);
 if(status==='expired')alerts.push(['bad','已过期','调用返回 401 api_key_expired。请创建新 Key 并撤销这把以释放保留名额。']);
 if(item.allowedModelIds?.length&&status!=='revoked'){
  const {deprecated,retired}=keyModels(item.allowedModelIds,models);
  for(const model of deprecated)alerts.push(['warn',`${model.model} 将于 ${day(model.sunsetAt)} 下线`,model.replacement?.model?`建议改用 ${model.replacement.model}，编辑这把 Key 加上它，并更新代码里的 model 参数。`:'下线后调用会返回 410，请尽快更换模型。']);
  if(retired)alerts.push(['bad',`${retired} 个指定模型已下线`,'用它们调用会失败；编辑保存时会自动移除。']);
 }
 return alerts.map(([tone,title,text])=><div key={title} className={`dap-kd-alert is-${tone}`}><strong>{title}</strong><p>{text}</p></div>);
}

// KeyDetail is a side drawer like the Key form: status and alerts first,
// then usage against the Key's limits, the models it may call, and settings.
export function KeyDetail({item,models,busy,onClose,onEdit,onPause,onRotate,onRevoke}){
 const status=keyStatus(item),closed=item.status==='revoked';
 const picked=(item.allowedModelIds||[]).map(id=>models.find(model=>model.id===id)||{id,model:'已下线的模型',status:'retired'});
 return <Modal title="Key 详情" onClose={onClose} drawer footer={<>
  <button className="dap-button danger" disabled={closed} onClick={()=>onRevoke(item)}><Trash2 size={15}/>撤销</button>
  <span className="dap-kd-spacer"/>
  {status==='paused'?<button className="dap-button" disabled={busy} onClick={()=>onPause(item,false)}><Play size={15}/>重新启用</button>:<button className="dap-button" disabled={busy||status!=='active'} onClick={()=>onPause(item,true)}><Pause size={15}/>停用</button>}
  <button className="dap-button" disabled={status!=='active'} onClick={()=>onRotate(item)}><RotateCw size={15}/>轮换</button>
  <button className="dap-button primary" disabled={closed} onClick={()=>onEdit(item)}><Pencil size={15}/>编辑</button>
 </>}>
  <div className="dap-kd">
   <header className="dap-kd-head">
    <span className="dap-glyph"><KeyRound size={20}/></span>
    <div><h3>{item.label}</h3><code>{item.prefix}••••••••</code></div>
    <span className={`dap-badge ${status}`}><i/>{KEY_STATUSES[status]}</span>
   </header>
   <Alerts item={item} models={models}/>
   {!closed&&<section className="dap-kd-section" aria-label="用量">
    <h4>用量<small>今日 / 本月</small></h4>
    <div className="dap-kd-meters">
     <Meter used={item.usage?.todayTasks} limit={item.dailyTaskLimit} label="今日请求" unit=" 次"/>
     <Meter used={item.usage?.monthTasks} limit={item.monthlyTaskLimit} label="本月请求" unit=" 次"/>
     <Meter used={item.usage?.todaySpendCents} limit={item.dailySpendLimitCents} label="今日积分"/>
     <Meter used={item.usage?.monthSpendCents} limit={item.monthlySpendLimitCents} label="本月积分"/>
    </div>
    <p className="dap-kd-note">今日流量 {bytes(item.usage?.todayBytes)} / {bytes(item.dailyByteLimit)}。图片与对话请求都会计入，明确失败的请求不计入。</p>
   </section>}
   <section className="dap-kd-section" aria-label="可用模型">
    <h4>可用模型<small>{picked.length?`指定 ${picked.length} 个`:'全部模型，含之后新开放的'}</small></h4>
    {picked.length?<ul className="dap-kd-models">{picked.map(model=>{const [label,tone]=MODEL_STATUSES[model.status]||MODEL_STATUSES.live;return <li key={model.id} className={`is-${model.status||'live'}`}><code>{model.model}</code>{model.status&&model.status!=='live'&&<span className={`dap-badge ${tone}`}><i/>{label}</span>}</li>})}</ul>
     :<p className="dap-kd-note">这把 Key 可以调用控制台「模型」页中所有可用的模型。</p>}
   </section>
   <section className="dap-kd-section" aria-label="设置">
    <h4>设置</h4>
    <dl className="dap-kd-rows">
     <Row label="每分钟请求上限">{number(item.rateLimitPerMinute)} 次</Row>
     <Row label="IP 白名单">{item.ipAllowlist?.length?item.ipAllowlist.join('、'):'未限制'}</Row>
     <Row label="有效期">{item.expiresAt?`${time(item.expiresAt)} 到期`:'长期有效'}</Row>
     <Row label="最近使用">{item.lastUsedAt?<span className="dap-when" title={time(item.lastUsedAt)}><Clock size={13}/>{ago(item.lastUsedAt)}{item.lastUsedIp&&<code className="dap-ip">{item.lastUsedIp}</code>}</span>:'尚未使用'}</Row>
     <Row label="创建时间">{time(item.createdAt)}</Row>
    </dl>
   </section>
  </div>
 </Modal>;
}
