import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,History,RefreshCw,TriangleAlert} from 'lucide-react';
import {number,time} from './presentation.js';
import {ConsoleSelect} from './Controls.jsx';

const STATUSES={charged:['active','已扣费'],refunded:['revoked','已退回'],pending:['pending','进行中']};

function usage(call){
 if(call.kind==='image')return call.images?`${call.images} 张`:'—';
 const total=call.tokens?.total;
 if(total==null)return '—';
 return <>{number(total)} tokens{call.tokens.prompt!=null&&<small className="dap-subtext">输入 {number(call.tokens.prompt)} · 输出 {number(call.tokens.completion)}</small>}</>;
}

// CallsPanel lists /v1 requests and what each one cost. API charges are not
// shown in the wallet history; this is where developers reconcile them.
export function CallsPanel({client,keys}){
 const [keyFilter,setKeyFilter]=useState('all'),[page,setPage]=useState(1);
 const [result,setResult]=useState({items:[],total:0,pageSize:20}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const pending=useRef(null);
 const load=useCallback(async()=>{
  pending.current?.abort();const controller=new AbortController();pending.current=controller;
  setLoading(true);setError('');
  try{const next=await client.listAPICalls({page,key:keyFilter==='all'?'':keyFilter,signal:controller.signal});if(!controller.signal.aborted)setResult(next)}
  catch(err){if(!controller.signal.aborted)setError(err.message||'读取失败')}
  finally{if(!controller.signal.aborted)setLoading(false)}
 },[client,page,keyFilter]);
 useEffect(()=>{void load();return()=>pending.current?.abort()},[load]);
 const pages=Math.max(1,Math.ceil(result.total/result.pageSize));
 const keyOptions=[{value:'all',label:'全部 Key'},...keys.map(key=>({value:key.id,label:`${key.label}（${key.prefix}…）`}))];
 return <>
  <div className="dap-filterbar"><ConsoleSelect label="Key 筛选" value={keyFilter} onChange={value=>{setKeyFilter(value);setPage(1)}} options={keyOptions}/><span className="dap-filter-spacer"/><button className="dap-icon" aria-label="刷新调用记录" title="刷新调用记录" disabled={loading} onClick={()=>void load()}><RefreshCw size={16} className={loading?'dap-spin':''}/></button></div>
  {error&&<div className="dap-error" role="alert"><TriangleAlert size={16}/><span>调用记录读取失败：{error}</span><button onClick={()=>void load()} disabled={loading}>重试</button></div>}
  <section className="dap-panel"><div className="dap-table-wrap"><table className="dap-calls-table"><thead><tr><th>时间</th><th>接口 / 模型</th><th>Key</th><th>用量</th><th>积分</th><th>结果</th></tr></thead><tbody>{result.items.map((call,index)=>{const [tone,label]=STATUSES[call.status]||STATUSES.pending;return <tr key={`${call.createdAt}-${index}`}><td>{time(call.createdAt,true)}</td><td><strong>{call.operation}</strong><span className="dap-subtext">{call.model||'—'}</span></td><td>{call.key?<>{call.key.label}<code className="dap-subtext">{call.key.prefix}••••</code></>:'已删除的 Key'}</td><td>{usage(call)}</td><td>{call.status==='charged'?`-${number(call.chargedCents)}`:'0'}</td><td><span className={`dap-badge ${tone}`}><i/>{label}</span>{call.reason&&<small className="dap-subtext">{call.reason}</small>}</td></tr>})}</tbody></table></div>
   {!loading&&!error&&!result.items.length&&<div className="dap-empty"><span><History size={25}/></span><h3>还没有调用记录</h3><p>通过 /v1 发起的生图和对话请求会显示在这里，包括扣费与退回。</p></div>}
   <footer className="dap-pagination"><span>共 {result.total}{result.totalCapped?'+':''} 条 · API 调用的扣费只在这里显示，不进入钱包明细</span><div><button className="dap-icon" title="上一页" aria-label="上一页" disabled={loading||page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><span>{page} / {pages}</span><button className="dap-icon" title="下一页" aria-label="下一页" disabled={loading||page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div></footer>
  </section>
 </>;
}
