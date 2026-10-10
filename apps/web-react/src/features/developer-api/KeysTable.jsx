import {Clock,Pause,Pencil,Play,RotateCw,Trash2} from 'lucide-react';
import {KEY_STATUSES,ago,day,expiresSoon,keyModels,keyStatus,number,ratio,time} from './presentation.js';

function Badge({status}){return <span className={`dap-badge ${status}`}><i/>{KEY_STATUSES[status]}</span>}

// One value per cell: used / limit on a single line, amber from 85%.
function Usage({used,limit}){
 const percent=ratio(used,limit);
 return <span className={`dap-usage${percent>=85?' is-high':''}`} title={`已用 ${Math.round(percent)}%`}><b>{number(used)}</b><small> / {number(limit)}</small></span>;
}

// Model access reads as model names; hover lists them all. A model about to
// be retired marks the Key amber, a retired or withdrawn one red, since calls
// with it fail with 410 or 404.
function Models({ids,models}){
 if(!ids?.length)return <span className="dap-chip is-all">全部模型</span>;
 const {usable,deprecated,retired,paused}=keyModels(ids,models);
 const names=[...usable,...paused].map(model=>model.model);
 const title=[names.join('、'),...deprecated.map(model=>`${model.model} 将于 ${day(model.sunsetAt)} 下线`),retired?`另有 ${retired} 个模型已下线或不再开放`:''].filter(Boolean).join('\n');
 if(!names.length)return <span className="dap-chip is-bad" title="这把 Key 选的模型都已下线或不再开放，调用会失败，请编辑后重新选择">无可用模型</span>;
 return <span className="dap-chips" title={title}><span className="dap-chip">{names[0]}</span>{names.length>1&&<span className="dap-chip is-more">+{names.length-1}</span>}{deprecated.length>0&&<span className="dap-chip is-warn">{deprecated.length} 个即将下线</span>}{retired>0&&<span className="dap-chip is-bad">{retired} 个已下线</span>}</span>;
}

function Expiry({item}){
 if(!item.expiresAt)return <span className="dap-muted-text">长期有效</span>;
 const soon=expiresSoon(item),expired=keyStatus(item)==='expired';
 return <span className={soon||expired?'dap-warn-text':''}>{expired?'已于 ':''}{time(item.expiresAt,true).split(' ')[0]}{expired?' 过期':''}</span>;
}

export function KeysTable({keys,models,onOpen,onEdit,onPause,onRotate,onRevoke}){
 return <table className="dap-keys-table">
  <thead><tr><th>名称</th><th>Key</th><th>状态</th><th>可用模型</th><th>今日请求（次）</th><th>今日积分</th><th>最近使用</th><th>最近 IP</th><th>有效期</th><th><span className="dap-sr-only">操作</span></th></tr></thead>
  <tbody>{keys.map(item=>{const status=keyStatus(item),closed=item.status==='revoked',none=<span className="dap-muted-text">—</span>;return <tr key={item.id} className={closed?'is-closed':''}>
   <td><button className="dap-row-title" onClick={()=>onOpen(item)}>{item.label}</button></td>
   <td><code className="dap-key-prefix">{item.prefix}…</code></td>
   <td><Badge status={status}/></td>
   <td><Models ids={item.allowedModelIds} models={models}/></td>
   <td>{closed?none:<Usage used={item.usage?.todayTasks} limit={item.dailyTaskLimit}/>}</td>
   <td>{closed?none:<Usage used={item.usage?.todaySpendCents} limit={item.dailySpendLimitCents}/>}</td>
   <td>{item.lastUsedAt?<span className="dap-when" title={time(item.lastUsedAt)}><Clock size={13}/>{ago(item.lastUsedAt)}</span>:<span className="dap-muted-text">尚未使用</span>}</td>
   <td>{item.lastUsedIp?<code className="dap-ip">{item.lastUsedIp}</code>:none}</td>
   <td>{closed?none:<Expiry item={item}/>}</td>
   <td>{!closed&&<div className="dap-row-actions"><button className="dap-icon" aria-label={`编辑 ${item.label}`} title="编辑" onClick={()=>onEdit(item)}><Pencil size={15}/></button>{status==='paused'?<button className="dap-icon" aria-label={`启用 ${item.label}`} title="重新启用" onClick={()=>onPause(item,false)}><Play size={15}/></button>:<button className="dap-icon" aria-label={`停用 ${item.label}`} title="停用（可随时启用）" disabled={status!=='active'} onClick={()=>onPause(item,true)}><Pause size={15}/></button>}<button className="dap-icon" aria-label={`轮换 ${item.label}`} title="轮换密钥" disabled={status!=='active'} onClick={()=>onRotate(item)}><RotateCw size={15}/></button><button className="dap-icon danger" aria-label={`撤销 ${item.label}`} title="撤销" onClick={()=>onRevoke(item)}><Trash2 size={15}/></button></div>}</td>
  </tr>})}</tbody>
 </table>;
}
